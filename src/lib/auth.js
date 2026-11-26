'use strict';

const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const config = require('../config');
const { getDb } = require('../db');
const { HttpError, forbidden, toObjectId } = require('./http');

/** Identifiant fixe de l'administrateur de la plateforme (il n'appartient à aucune entreprise). */
const PLATFORM_ADMIN_ID = new ObjectId('000000000000000000000001');

/**
 * Deux comptes peuvent administrer la plateforme :
 * - 'main' : le compte SUPERADMIN de config.env (jamais affiché dans l'interface) ;
 * - 'demo' : admin@taskhive.test / mot de passe de démo, actif seulement si SEED_DEMO=true.
 */
const DEMO_PLATFORM_EMAIL = 'admin@taskhive.test';
const platformAccountEnabled = (acct) => (acct === 'demo' ? config.seedDemo : config.superAdmin.enabled);

const platformUser = (acct = 'main') => ({
  _id: PLATFORM_ADMIN_ID,
  firstName: 'Admin',
  lastName: 'Plateforme',
  email: acct === 'demo' ? DEMO_PLATFORM_EMAIL : config.superAdmin.email,
  role: 'superadmin',
  jobTitle: 'Administrateur de la plateforme',
});

const signOptions = () => ({ expiresIn: config.jwt.expiresIn, algorithm: 'HS256' });

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), cid: user.companyId.toString(), role: user.role }, config.jwt.secret, signOptions());
}

/** Jeton de l'administrateur de la plateforme, éventuellement « entré » dans une entreprise. */
function signPlatformToken(companyId, acct = 'main') {
  const payload = { sub: 'platform', role: 'superadmin', acct: acct === 'demo' ? 'demo' : 'main' };
  if (companyId) payload.cid = companyId.toString();
  return jwt.sign(payload, config.jwt.secret, signOptions());
}

function verifyToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Authentification requise');
  try {
    return jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Session expirée ou jeton invalide');
  }
}

/**
 * Construit req.auth à partir du jeton. Pour un utilisateur normal, on recharge
 * l'utilisateur en base : un compte supprimé ou dont le rôle a changé perd
 * immédiatement ses anciens droits. req.auth.companyId est LA source de vérité
 * pour l'isolation : il ne vient jamais du corps ou de l'URL de la requête.
 */
async function resolveAuth(payload) {
  const db = getDb();
  if (payload.sub === 'platform') {
    const acct = payload.acct === 'demo' ? 'demo' : 'main';
    if (!platformAccountEnabled(acct)) throw new HttpError(401, 'Compte plateforme désactivé');
    const base = { userId: PLATFORM_ADMIN_ID, role: 'admin', isSuperAdmin: true, platformAccount: acct, user: platformUser(acct), companyId: null };
    if (!payload.cid) return base;
    const company = await db.collection('companies').findOne({ _id: toObjectId(payload.cid) }, { projection: { _id: 1 } });
    return company ? { ...base, companyId: company._id } : base;
  }

  const user = await db.collection('users').findOne(
    { _id: toObjectId(payload.sub), companyId: toObjectId(payload.cid) },
    { projection: { passwordHash: 0 } },
  );
  if (!user) throw new HttpError(401, 'Utilisateur introuvable');
  return { userId: user._id, companyId: user.companyId, role: user.role, isSuperAdmin: false, user };
}

/** Routes métier : exige une entreprise courante. */
async function requireAuth(req, _res, next) {
  req.auth = await resolveAuth(verifyToken(req));
  if (!req.auth.companyId) throw new HttpError(409, "Sélectionnez d'abord une entreprise");
  next();
}

/** Session valide, avec ou sans entreprise (utilisé par /api/auth/me). */
async function requireSession(req, _res, next) {
  req.auth = await resolveAuth(verifyToken(req));
  next();
}

/** Routes réservées à l'administrateur de la plateforme. */
async function requirePlatformAdmin(req, _res, next) {
  req.auth = await resolveAuth(verifyToken(req));
  if (!req.auth.isSuperAdmin) throw forbidden('Réservé à l\'administrateur de la plateforme');
  next();
}

const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.auth.role)) throw forbidden('Droits insuffisants pour cette action');
  next();
};

const isManager = (auth) => auth.role === 'admin' || auth.role === 'manager';

module.exports = {
  PLATFORM_ADMIN_ID,
  platformUser,
  DEMO_PLATFORM_EMAIL,
  signToken,
  signPlatformToken,
  requireAuth,
  requireSession,
  requirePlatformAdmin,
  requireRole,
  isManager,
};
