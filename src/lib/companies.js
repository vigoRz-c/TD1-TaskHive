'use strict';

const { HttpError } = require('./http');

function slugify(name) {
  const base = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return base.length >= 2 ? base : `entreprise-${base}`.replace(/-+$/, '').slice(0, 50);
}

/** Crée une entreprise avec un identifiant (slug) unique : base, base-2, base-3... */
async function createCompany(db, name, plan = 'free') {
  const now = new Date();
  const base = slugify(name);
  for (let i = 1; i <= 50; i += 1) {
    const slug = i === 1 ? base : `${base}-${i}`;
    try {
      const doc = { name, slug, plan, createdAt: now, updatedAt: now };
      const { insertedId } = await db.collection('companies').insertOne(doc);
      return { _id: insertedId, ...doc };
    } catch (err) {
      // L'index unique sur slug tranche en cas d'accès concurrent
      if (err.code !== 11000) throw err;
    }
  }
  throw new HttpError(409, "Impossible de générer un identifiant d'entreprise unique");
}

/** Suppression en cascade de toutes les données d'une entreprise. */
async function deleteCompanyCascade(db, companyId) {
  const filter = { companyId };
  const [tasks, activities, projects, users] = await Promise.all([
    db.collection('tasks').deleteMany(filter),
    db.collection('activities').deleteMany(filter),
    db.collection('projects').deleteMany(filter),
    db.collection('users').deleteMany(filter),
  ]);
  const company = await db.collection('companies').deleteOne({ _id: companyId });
  return {
    company: company.deletedCount,
    tasks: tasks.deletedCount,
    activities: activities.deletedCount,
    projects: projects.deletedCount,
    users: users.deletedCount,
  };
}

module.exports = { slugify, createCompany, deleteCompanyCascade };
