'use strict';

const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { isManager } = require('../lib/auth');
const {
  str, oneOf, dateOrNull, tags, compact, toObjectId, badRequest, notFound, forbidden,
} = require('../lib/http');
const { scoped, loadProject, logActivity } = require('../lib/tenant');

const router = express.Router();
const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** assigneeId : null (désassigner) ou un membre du projet. */
function parseAssignee(body, project) {
  if (body.assigneeId === undefined) return undefined;
  if (body.assigneeId === null || body.assigneeId === '') return null;
  const id = toObjectId(body.assigneeId, 'assigneeId');
  if (!project.memberIds.some((m) => m.equals(id))) throw badRequest("L'utilisateur assigné doit être membre du projet");
  return id;
}

function parsePosition(body) {
  if (body.position === undefined) return undefined;
  const n = Number(body.position);
  if (!Number.isFinite(n)) throw badRequest('position invalide');
  return n;
}

async function nextPosition(auth, projectId, status) {
  const last = await getDb().collection('tasks')
    .find(scoped(auth, { projectId, status }), { projection: { position: 1 } })
    .sort({ position: -1 }).limit(1).next();
  return last ? last.position + 1000 : 1000;
}

/** Charge une tâche de l'entreprise + son projet (avec contrôle d'accès). */
async function loadTask(auth, rawId, { write = true } = {}) {
  const task = await getDb().collection('tasks').findOne(scoped(auth, { _id: toObjectId(rawId) }));
  if (!task) throw notFound('Tâche');
  const project = await loadProject(auth, task.projectId);
  if (write && project.status === 'archived') throw badRequest('Projet archivé : lecture seule');
  return { task, project };
}

/* ---------- Tâches d'un projet (tableau Kanban) ---------- */

router.get('/projects/:projectId/tasks', async (req, res) => {
  const project = await loadProject(req.auth, toObjectId(req.params.projectId, 'projectId'));
  const filter = scoped(req.auth, { projectId: project._id });

  const { assignee, priority, q, tag } = req.query;
  if (assignee === 'none') filter.assigneeId = null;
  else if (assignee) filter.assigneeId = toObjectId(assignee, 'assignee');
  if (priority) filter.priority = oneOf({ priority }, 'priority', PRIORITIES);
  if (tag) filter.tags = String(tag).toLowerCase();
  if (q) filter.title = { $regex: escapeRegex(String(q).slice(0, 100)), $options: 'i' };

  const tasks = await getDb().collection('tasks').find(filter).sort({ status: 1, position: 1 }).toArray();
  res.json({ tasks });
});

router.post('/projects/:projectId/tasks', async (req, res) => {
  const project = await loadProject(req.auth, toObjectId(req.params.projectId, 'projectId'));
  if (project.status === 'archived') throw badRequest('Projet archivé : création de tâche impossible');
  const body = req.body || {};
  const status = oneOf(body, 'status', STATUSES) || 'todo';
  const now = new Date();

  const task = {
    companyId: req.auth.companyId,
    projectId: project._id,
    title: str(body, 'title', { required: true, min: 1, max: 200 }),
    description: str(body, 'description', { max: 5000, nullable: true }) ?? null,
    status,
    priority: oneOf(body, 'priority', PRIORITIES) || 'medium',
    assigneeId: parseAssignee(body, project) ?? null,
    dueDate: dateOrNull(body, 'dueDate') ?? null,
    tags: tags(body) || [],
    position: await nextPosition(req.auth, project._id, status),
    comments: [],
    createdBy: req.auth.userId,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await getDb().collection('tasks').insertOne(task);
  task._id = insertedId;
  await logActivity(req.auth, project._id, 'task.created', { taskId: insertedId, title: task.title });
  res.status(201).json({ task });
});

/* ---------- Tâche individuelle ---------- */

/** "Mes tâches" : tâches assignées à l'utilisateur connecté, tous projets confondus. */
router.get('/tasks/mine', async (req, res) => {
  const tasks = await getDb().collection('tasks').aggregate([
    { $match: scoped(req.auth, { assigneeId: req.auth.userId, status: { $ne: 'done' } }) },
    { $sort: { dueDate: 1, createdAt: 1 } },
    { $limit: 200 },
    {
      $lookup: {
        from: 'projects',
        let: { pid: '$projectId', cid: '$companyId' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$_id', '$$pid'] }, { $eq: ['$companyId', '$$cid'] }] } } },
          { $project: { name: 1, color: 1 } },
        ],
        as: 'project',
      },
    },
    { $unwind: '$project' },
    { $project: { comments: 0 } },
  ]).toArray();
  res.json({ tasks });
});

router.get('/tasks/:id', async (req, res) => {
  const { task } = await loadTask(req.auth, req.params.id, { write: false });
  res.json({ task });
});

router.put('/tasks/:id', async (req, res) => {
  const { task, project } = await loadTask(req.auth, req.params.id);
  const body = req.body || {};
  const update = compact({
    title: str(body, 'title', { min: 1, max: 200 }),
    description: str(body, 'description', { max: 5000, nullable: true }),
    status: oneOf(body, 'status', STATUSES),
    priority: oneOf(body, 'priority', PRIORITIES),
    assigneeId: parseAssignee(body, project),
    dueDate: dateOrNull(body, 'dueDate'),
    tags: tags(body),
  });
  if (update.status && update.status !== task.status) {
    update.position = await nextPosition(req.auth, task.projectId, update.status);
  }

  const updated = await getDb().collection('tasks').findOneAndUpdate(
    scoped(req.auth, { _id: task._id }),
    { $set: { ...update, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  await logActivity(req.auth, task.projectId, 'task.updated', {
    taskId: task._id, title: updated.title, fields: Object.keys(update),
  });
  res.json({ task: updated });
});

/** Déplacement dans le Kanban (glisser-déposer) : nouvelle colonne et/ou nouvelle position. */
router.patch('/tasks/:id/move', async (req, res) => {
  const { task } = await loadTask(req.auth, req.params.id);
  const body = req.body || {};
  const status = oneOf(body, 'status', STATUSES, { required: true });
  const position = parsePosition(body) ?? (await nextPosition(req.auth, task.projectId, status));

  const updated = await getDb().collection('tasks').findOneAndUpdate(
    scoped(req.auth, { _id: task._id }),
    { $set: { status, position, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (status !== task.status) {
    await logActivity(req.auth, task.projectId, 'task.moved', {
      taskId: task._id, title: task.title, from: task.status, to: status,
    });
  }
  res.json({ task: updated });
});

router.delete('/tasks/:id', async (req, res) => {
  const { task } = await loadTask(req.auth, req.params.id);
  if (!isManager(req.auth) && !task.createdBy?.equals(req.auth.userId)) {
    throw forbidden('Seul le créateur de la tâche ou un manager peut la supprimer');
  }
  await getDb().collection('tasks').deleteOne(scoped(req.auth, { _id: task._id }));
  await logActivity(req.auth, task.projectId, 'task.deleted', { taskId: task._id, title: task.title });
  res.status(204).end();
});

/* ---------- Commentaires (embarqués dans la tâche) ---------- */

router.post('/tasks/:id/comments', async (req, res) => {
  const { task } = await loadTask(req.auth, req.params.id);
  if ((task.comments || []).length >= 500) throw badRequest('Nombre maximal de commentaires atteint');
  const comment = {
    _id: new ObjectId(),
    authorId: req.auth.userId,
    text: str(req.body || {}, 'text', { required: true, min: 1, max: 2000 }),
    createdAt: new Date(),
  };
  const updated = await getDb().collection('tasks').findOneAndUpdate(
    scoped(req.auth, { _id: task._id }),
    { $push: { comments: comment }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  await logActivity(req.auth, task.projectId, 'task.commented', { taskId: task._id, title: task.title });
  res.status(201).json({ task: updated });
});

router.delete('/tasks/:id/comments/:commentId', async (req, res) => {
  const { task } = await loadTask(req.auth, req.params.id);
  const commentId = toObjectId(req.params.commentId, 'commentId');
  const comment = (task.comments || []).find((c) => c._id.equals(commentId));
  if (!comment) throw notFound('Commentaire');
  if (!comment.authorId.equals(req.auth.userId) && !isManager(req.auth)) throw forbidden();
  const updated = await getDb().collection('tasks').findOneAndUpdate(
    scoped(req.auth, { _id: task._id }),
    { $pull: { comments: { _id: commentId } } },
    { returnDocument: 'after' },
  );
  res.json({ task: updated });
});

module.exports = router;
