'use strict';

const express = require('express');
const { getDb } = require('../db');
const { requireRole, isManager, PLATFORM_ADMIN_ID } = require('../lib/auth');
const { str, oneOf, compact, toObjectId, badRequest, notFound } = require('../lib/http');
const { scoped, loadProject, assertUsersInCompany, logActivity } = require('../lib/tenant');

const router = express.Router();
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function parseMemberIds(body) {
  if (body.memberIds === undefined) return undefined;
  if (!Array.isArray(body.memberIds) || body.memberIds.length > 200) throw badRequest('memberIds doit être une liste');
  const ids = body.memberIds.map((id) => toObjectId(id, 'memberIds'));
  // dédoublonnage
  return ids.filter((id, i) => ids.findIndex((other) => other.equals(id)) === i);
}

function parseColor(body) {
  if (body.color === undefined) return undefined;
  if (typeof body.color !== 'string' || !COLOR_RE.test(body.color)) throw badRequest('Couleur invalide (format #RRGGBB)');
  return body.color;
}

/** Liste des projets visibles : tous pour admin/manager, ceux dont on est membre sinon. */
router.get('/', async (req, res) => {
  const status = req.query.status === 'archived' ? 'archived' : req.query.status === 'all' ? undefined : 'active';
  const filter = scoped(req.auth, compact({ status }));
  if (!isManager(req.auth)) filter.memberIds = req.auth.userId;

  const db = getDb();
  const projects = await db.collection('projects').find(filter).sort({ name: 1 }).toArray();
  const counts = await db.collection('tasks').aggregate([
    { $match: scoped(req.auth, { projectId: { $in: projects.map((p) => p._id) } }) },
    { $group: { _id: { projectId: '$projectId', status: '$status' }, count: { $sum: 1 } } },
  ]).toArray();

  const byProject = {};
  for (const { _id, count } of counts) {
    const key = _id.projectId.toString();
    byProject[key] = byProject[key] || { todo: 0, in_progress: 0, review: 0, done: 0 };
    byProject[key][_id.status] = count;
  }
  res.json({
    projects: projects.map((p) => ({
      ...p,
      taskCounts: byProject[p._id.toString()] || { todo: 0, in_progress: 0, review: 0, done: 0 },
    })),
  });
});

router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const memberIds = parseMemberIds(body) || [];
  // Le créateur devient membre (sauf l'admin plateforme, qui n'est pas un utilisateur de l'entreprise)
  if (!req.auth.isSuperAdmin && !memberIds.some((id) => id.equals(req.auth.userId))) memberIds.push(req.auth.userId);
  await assertUsersInCompany(req.auth, memberIds);

  const now = new Date();
  const project = {
    companyId: req.auth.companyId,
    name: str(body, 'name', { required: true, min: 2, max: 100 }),
    description: str(body, 'description', { max: 2000, nullable: true }) ?? null,
    color: parseColor(body) || '#4f46e5',
    status: 'active',
    memberIds,
    createdBy: req.auth.userId,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await getDb().collection('projects').insertOne(project);
  project._id = insertedId;
  await logActivity(req.auth, insertedId, 'project.created', { name: project.name });
  res.status(201).json({ project });
});

router.get('/:id', async (req, res) => {
  const project = await loadProject(req.auth, toObjectId(req.params.id));
  const members = await getDb().collection('users')
    .find(scoped(req.auth, { _id: { $in: project.memberIds } }), { projection: { passwordHash: 0 } })
    .sort({ lastName: 1 })
    .toArray();
  res.json({ project, members });
});

router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  const id = toObjectId(req.params.id);
  const before = await loadProject(req.auth, id);
  const body = req.body || {};
  const memberIds = parseMemberIds(body);
  if (memberIds) await assertUsersInCompany(req.auth, memberIds);

  const update = compact({
    name: str(body, 'name', { min: 2, max: 100 }),
    description: str(body, 'description', { max: 2000, nullable: true }),
    color: parseColor(body),
    status: oneOf(body, 'status', ['active', 'archived']),
    memberIds,
  });

  const db = getDb();
  const project = await db.collection('projects').findOneAndUpdate(
    scoped(req.auth, { _id: id }),
    { $set: { ...update, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );

  if (memberIds) {
    // Les tâches des membres retirés du projet redeviennent non assignées
    const removed = before.memberIds.filter((old) => !memberIds.some((m) => m.equals(old)));
    if (removed.length) {
      await db.collection('tasks').updateMany(
        scoped(req.auth, { projectId: id, assigneeId: { $in: removed } }),
        { $set: { assigneeId: null, updatedAt: new Date() } },
      );
    }
  }
  await logActivity(req.auth, id, 'project.updated', { fields: Object.keys(update) });
  res.json({ project });
});

router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  const id = toObjectId(req.params.id);
  const db = getDb();
  const { deletedCount } = await db.collection('projects').deleteOne(scoped(req.auth, { _id: id }));
  if (!deletedCount) throw notFound('Projet');
  await Promise.all([
    db.collection('tasks').deleteMany(scoped(req.auth, { projectId: id })),
    db.collection('activities').deleteMany(scoped(req.auth, { projectId: id })),
  ]);
  res.status(204).end();
});

/** Journal d'activité du projet (50 derniers évènements). */
router.get('/:id/activity', async (req, res) => {
  const project = await loadProject(req.auth, toObjectId(req.params.id));
  const activities = await getDb().collection('activities').aggregate([
    { $match: scoped(req.auth, { projectId: project._id }) },
    { $sort: { at: -1 } },
    { $limit: 50 },
    {
      $lookup: {
        from: 'users',
        let: { uid: '$userId', cid: '$companyId' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$_id', '$$uid'] }, { $eq: ['$companyId', '$$cid'] }] } } },
          { $project: { firstName: 1, lastName: 1 } },
        ],
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  ]).toArray();
  for (const a of activities) {
    if (!a.user && a.userId.equals(PLATFORM_ADMIN_ID)) a.user = { firstName: 'Admin', lastName: 'Plateforme' };
  }
  res.json({ activities });
});

module.exports = router;
