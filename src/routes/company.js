'use strict';

const express = require('express');
const { getDb } = require('../db');
const { requireRole } = require('../lib/auth');
const { str, oneOf, compact, notFound } = require('../lib/http');
const { scoped } = require('../lib/tenant');
const { deleteCompanyCascade } = require('../lib/companies');

const router = express.Router();

/** L'entreprise de l'utilisateur connecté + quelques statistiques. */
router.get('/', async (req, res) => {
  const db = getDb();
  const company = await db.collection('companies').findOne({ _id: req.auth.companyId });
  if (!company) throw notFound('Entreprise');
  const [users, projects, taskStats] = await Promise.all([
    db.collection('users').countDocuments(scoped(req.auth)),
    db.collection('projects').countDocuments(scoped(req.auth)),
    db.collection('tasks').aggregate([
      { $match: scoped(req.auth) },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const tasks = Object.fromEntries(taskStats.map((s) => [s._id, s.count]));
  res.json({ company, stats: { users, projects, tasks } });
});

router.put('/', requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  const update = compact({
    name: str(body, 'name', { min: 2, max: 80 }),
    plan: oneOf(body, 'plan', ['free', 'pro', 'enterprise']),
  });
  const company = await getDb().collection('companies').findOneAndUpdate(
    { _id: req.auth.companyId },
    { $set: { ...update, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  res.json({ company });
});

/** Suppression de l'entreprise et de TOUTES ses données (cascade). */
router.delete('/', requireRole('admin'), async (req, res) => {
  const { company, ...deleted } = await deleteCompanyCascade(getDb(), req.auth.companyId);
  res.json({ deleted });
});

module.exports = router;
