'use strict';

const { getDb } = require('../db');
const { notFound, forbidden, badRequest } = require('./http');
const { isManager } = require('./auth');

/**
 * Ajoute systématiquement le companyId de l'utilisateur connecté au filtre.
 * Toutes les requêtes sur users / projects / tasks / activities passent par là :
 * une entreprise ne peut donc jamais lire ni modifier les données d'une autre.
 */
const scoped = (auth, filter = {}) => ({ ...filter, companyId: auth.companyId });

function canAccessProject(auth, project) {
  return isManager(auth) || project.memberIds.some((id) => id.equals(auth.userId));
}

/** Charge un projet de l'entreprise courante et vérifie que l'utilisateur y a accès. */
async function loadProject(auth, projectId) {
  const project = await getDb().collection('projects').findOne(scoped(auth, { _id: projectId }));
  if (!project) throw notFound('Projet');
  if (!canAccessProject(auth, project)) throw forbidden("Vous n'êtes pas membre de ce projet");
  return project;
}

/** Vérifie qu'une liste d'ids d'utilisateurs appartient bien à l'entreprise courante. */
async function assertUsersInCompany(auth, userIds) {
  if (userIds.length === 0) return;
  const count = await getDb().collection('users').countDocuments(scoped(auth, { _id: { $in: userIds } }));
  if (count !== userIds.length) throw badRequest("Un ou plusieurs utilisateurs n'appartiennent pas à l'entreprise");
}

async function logActivity(auth, projectId, action, details = {}) {
  await getDb().collection('activities').insertOne({
    companyId: auth.companyId,
    projectId,
    userId: auth.userId,
    action,
    details,
    at: new Date(),
  });
}

module.exports = { scoped, canAccessProject, loadProject, assertUsersInCompany, logActivity };
