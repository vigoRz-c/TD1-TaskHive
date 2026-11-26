'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getDb } = require('../db');
const { signToken, signPlatformToken, platformUser, requireSession, DEMO_PLATFORM_EMAIL } = require('../lib/auth');
const { DEMO_PASSWORD } = require('../seed');
const { HttpError, str, email, password } = require('../lib/http');
const { createCompany } = require('../lib/companies');

const router = express.Router();

const publicUser = ({ passwordHash, ...rest }) => rest;
// Hash factice : bcrypt.compare est toujours exécuté, le temps de réponse ne révèle pas si le compte existe
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

/** Crée une entreprise + son premier administrateur. */
router.post('/register', async (req, res) => {
  const body = req.body || {};
  const companyName = str(body, 'companyName', { required: true, min: 2, max: 80 });
  const firstName = str(body, 'firstName', { required: true, min: 1, max: 60 });
  const lastName = str(body, 'lastName', { required: true, min: 1, max: 60 });
  const userEmail = email(body, 'email', { required: true });
  const pwd = password(body, 'password', { required: true });

  const db = getDb();
  const company = await createCompany(db, companyName);
  try {
    const now = new Date();
    const user = {
      companyId: company._id,
      email: userEmail,
      passwordHash: await bcrypt.hash(pwd, 10),
      firstName,
      lastName,
      role: 'admin',
      jobTitle: null,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db.collection('users').insertOne(user);
    user._id = insertedId;
    res.status(201).json({ token: signToken(user), user: publicUser(user), company });
  } catch (err) {
    // Pas de transaction possible sur un mongod autonome : on compense à la main.
    await db.collection('companies').deleteOne({ _id: company._id });
    throw err;
  }
});

/**
 * Connexion : identifiant d'entreprise (slug) + e-mail + mot de passe.
 * Cas particulier : l'administrateur de la plateforme (configuré dans config.env)
 * se connecte avec son e-mail et son mot de passe, l'identifiant d'entreprise est ignoré.
 */
let demoHashPromise = null;
const demoPlatformHash = () => (demoHashPromise ??= bcrypt.hash(DEMO_PASSWORD, 10));

router.post('/login', async (req, res) => {
  const body = req.body || {};
  const userEmail = email(body, 'email', { required: true });
  const pwd = typeof body.password === 'string' ? body.password : '';

  const sa = config.superAdmin;
  if (sa.enabled && userEmail === sa.email) {
    if (!(await bcrypt.compare(pwd, sa.passwordHash))) throw new HttpError(401, 'Identifiants incorrects');
    return res.json({ token: signPlatformToken(null), user: platformUser(), company: null });
  }
  // Compte administrateur de la plateforme pour la démonstration (SEED_DEMO=true uniquement)
  if (config.seedDemo && userEmail === DEMO_PLATFORM_EMAIL) {
    if (!(await bcrypt.compare(pwd, await demoPlatformHash()))) throw new HttpError(401, 'Identifiants incorrects');
    return res.json({ token: signPlatformToken(null, 'demo'), user: platformUser('demo'), company: null });
  }

  const companySlug = str(body, 'companySlug', { required: true, max: 60 }).toLowerCase();
  const db = getDb();
  const company = await db.collection('companies').findOne({ slug: companySlug });
  const user = company && (await db.collection('users').findOne({ companyId: company._id, email: userEmail }));
  const ok = (await bcrypt.compare(pwd, user ? user.passwordHash : DUMMY_HASH)) && Boolean(user);
  // Même message dans tous les cas : pas d'énumération des comptes
  if (!ok) throw new HttpError(401, 'Identifiants incorrects');

  res.json({ token: signToken(user), user: publicUser(user), company });
});

router.get('/me', requireSession, async (req, res) => {
  const company = req.auth.companyId
    ? await getDb().collection('companies').findOne({ _id: req.auth.companyId })
    : null;
  res.json({ user: req.auth.user, company });
});

module.exports = router;
