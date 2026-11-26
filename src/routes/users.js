'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { requireRole } = require('../lib/auth');
const { str, oneOf, email, password, compact, toObjectId, notFound, forbidden, badRequest } = require('../lib/http');
const { scoped } = require('../lib/tenant');

const router = express.Router();
const ROLES = ['admin', 'manager', 'member'];
const NO_HASH = { projection: { passwordHash: 0 } };

router.get('/', async (req, res) => {
  const users = await getDb().collection('users')
    .find(scoped(req.auth), NO_HASH)
    .sort({ lastName: 1, firstName: 1 })
    .toArray();
  res.json({ users });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  const now = new Date();
  const user = {
    companyId: req.auth.companyId, // jamais lu depuis le corps de la requête
    email: email(body, 'email', { required: true }),
    passwordHash: await bcrypt.hash(password(body, 'password', { required: true }), 10),
    firstName: str(body, 'firstName', { required: true, min: 1, max: 60 }),
    lastName: str(body, 'lastName', { max: 60 }) ?? '', // facultatif (nom inconnu)
    role: oneOf(body, 'role', ROLES) || 'member',
    jobTitle: str(body, 'jobTitle', { max: 80, nullable: true }) ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await getDb().collection('users').insertOne(user);
  const { passwordHash, ...publicUser } = { _id: insertedId, ...user };
  res.status(201).json({ user: publicUser });
});

/** Un admin modifie n'importe quel utilisateur ; un utilisateur peut modifier son propre profil (sans son rôle). */
router.put('/:id', async (req, res) => {
  const id = toObjectId(req.params.id);
  const isSelf = id.equals(req.auth.userId);
  const isAdmin = req.auth.role === 'admin';
  if (!isSelf && !isAdmin) throw forbidden();

  const body = req.body || {};
  const role = oneOf(body, 'role', ROLES);
  if (role !== undefined && !isAdmin) throw forbidden('Seul un administrateur peut changer un rôle');
  if (role !== undefined && isSelf && role !== 'admin') {
    throw badRequest('Vous ne pouvez pas retirer votre propre rôle administrateur');
  }
  const pwd = password(body, 'password');

  const update = compact({
    email: email(body, 'email'),
    firstName: str(body, 'firstName', { min: 1, max: 60 }),
    lastName: str(body, 'lastName', { max: 60 }),
    jobTitle: str(body, 'jobTitle', { max: 80, nullable: true }),
    role,
    passwordHash: pwd ? await bcrypt.hash(pwd, 10) : undefined,
  });

  const user = await getDb().collection('users').findOneAndUpdate(
    scoped(req.auth, { _id: id }),
    { $set: { ...update, updatedAt: new Date() } },
    { returnDocument: 'after', ...NO_HASH },
  );
  if (!user) throw notFound('Utilisateur');
  res.json({ user });
});

/** Suppression : retire l'utilisateur des projets et désassigne ses tâches. */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = toObjectId(req.params.id);
  if (id.equals(req.auth.userId)) throw badRequest('Vous ne pouvez pas supprimer votre propre compte');
  const db = getDb();
  const { deletedCount } = await db.collection('users').deleteOne(scoped(req.auth, { _id: id }));
  if (!deletedCount) throw notFound('Utilisateur');
  await Promise.all([
    db.collection('projects').updateMany(scoped(req.auth, { memberIds: id }), { $pull: { memberIds: id } }),
    db.collection('tasks').updateMany(scoped(req.auth, { assigneeId: id }), { $set: { assigneeId: null } }),
  ]);
  res.status(204).end();
});

module.exports = router;
