'use strict';

/**
 * Administration de la plateforme : réservé au compte SUPERADMIN de config.env.
 * C'est le seul endroit de l'application qui lit plusieurs entreprises à la fois.
 */

const express = require('express');
const { getDb } = require('../db');
const { requirePlatformAdmin, signPlatformToken } = require('../lib/auth');
const { str, oneOf, toObjectId, notFound } = require('../lib/http');
const { createCompany, deleteCompanyCascade } = require('../lib/companies');

const router = express.Router();
router.use(requirePlatformAdmin);

async function countBy(db, collection) {
  const rows = await db.collection(collection).aggregate([{ $group: { _id: '$companyId', n: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id.toString(), r.n]));
}

/** Toutes les entreprises clientes, avec leurs volumes. */
router.get('/companies', async (req, res) => {
  const db = getDb();
  const [companies, users, projects, tasks] = await Promise.all([
    db.collection('companies').find().sort({ name: 1 }).toArray(),
    countBy(db, 'users'),
    countBy(db, 'projects'),
    countBy(db, 'tasks'),
  ]);
  res.json({
    companies: companies.map((c) => {
      const id = c._id.toString();
      return { ...c, stats: { users: users[id] || 0, projects: projects[id] || 0, tasks: tasks[id] || 0 } };
    }),
  });
});

router.post('/companies', async (req, res) => {
  const body = req.body || {};
  const name = str(body, 'name', { required: true, min: 2, max: 80 });
  const plan = oneOf(body, 'plan', ['free', 'pro', 'enterprise']) || 'free';
  const company = await createCompany(getDb(), name, plan);
  res.status(201).json({ company });
});

router.delete('/companies/:id', async (req, res) => {
  const deleted = await deleteCompanyCascade(getDb(), toObjectId(req.params.id));
  if (!deleted.company) throw notFound('Entreprise');
  res.json({ deleted });
});

/** « Entrer » dans une entreprise : nouveau jeton portant son companyId, droits d'admin. */
router.post('/companies/:id/enter', async (req, res) => {
  const company = await getDb().collection('companies').findOne({ _id: toObjectId(req.params.id) });
  if (!company) throw notFound('Entreprise');
  res.json({ token: signPlatformToken(company._id, req.auth.platformAccount), company });
});

/** Revenir à la vue plateforme (jeton sans entreprise). */
router.post('/leave', async (req, res) => {
  res.json({ token: signPlatformToken(null, req.auth.platformAccount) });
});

module.exports = router;
