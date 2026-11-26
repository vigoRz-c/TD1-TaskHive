'use strict';

const { ObjectId } = require('mongodb');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const notFound = (what = 'Ressource') => new HttpError(404, `${what} introuvable`);
const forbidden = (msg = 'Action non autorisée') => new HttpError(403, msg);

/** Convertit une chaîne en ObjectId ou lève une 400. */
function toObjectId(value, field = 'id') {
  if (value instanceof ObjectId) return value;
  if (typeof value !== 'string' || value.length !== 24 || !ObjectId.isValid(value)) {
    throw badRequest(`${field} invalide`);
  }
  return new ObjectId(value);
}

/** Validation de chaîne : trim + longueur. undefined = champ absent ; null = champ vidé (si nullable). */
function str(body, field, { required = false, min = 0, max = 500, nullable = false } = {}) {
  const value = body[field];
  if (value === undefined || value === '' || value === null) {
    if (required) throw badRequest(`Le champ "${field}" est obligatoire`);
    if (value === undefined) return undefined;
    return nullable ? null : undefined;
  }
  if (typeof value !== 'string') throw badRequest(`Le champ "${field}" doit être une chaîne`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw badRequest(`Le champ "${field}" doit contenir entre ${min} et ${max} caractères`);
  }
  return trimmed;
}

function oneOf(body, field, allowed, { required = false } = {}) {
  const value = body[field];
  if (value === undefined) {
    if (required) throw badRequest(`Le champ "${field}" est obligatoire`);
    return undefined;
  }
  if (!allowed.includes(value)) throw badRequest(`Le champ "${field}" doit valoir : ${allowed.join(', ')}`);
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function email(body, field = 'email', opts = {}) {
  const value = str(body, field, { ...opts, max: 120 });
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (!EMAIL_RE.test(lower)) throw badRequest('Adresse e-mail invalide');
  return lower;
}

function password(body, field = 'password', { required = false } = {}) {
  const value = body[field];
  if (value === undefined || value === '') {
    if (required) throw badRequest('Le mot de passe est obligatoire');
    return undefined;
  }
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw badRequest('Le mot de passe doit contenir entre 8 et 128 caractères');
  }
  return value;
}

function dateOrNull(body, field) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Le champ "${field}" n'est pas une date valide`);
  return d;
}

function tags(body, field = 'tags') {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) throw badRequest('Les tags doivent être une liste (10 max)');
  return [...new Set(value.map((t) => {
    if (typeof t !== 'string' || !t.trim() || t.trim().length > 30) throw badRequest('Tag invalide (30 caractères max)');
    return t.trim().toLowerCase();
  }))];
}

/** Retire les clés undefined d'un objet (pour construire un $set partiel). */
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide' });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ error: 'Cette valeur existe déjà (doublon)' });
  }
  if (err && err.code === 121) {
    return res.status(400).json({ error: 'Document refusé par le validateur MongoDB' });
  }
  console.error('[erreur]', err);
  return res.status(500).json({ error: 'Erreur interne du serveur' });
}

module.exports = {
  HttpError, badRequest, notFound, forbidden,
  toObjectId, str, oneOf, email, password, dateOrNull, tags, compact, errorHandler,
};
