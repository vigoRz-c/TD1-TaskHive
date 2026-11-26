'use strict';

/**
 * Toute la configuration vient des variables d'environnement (fichier config.env
 * chargé par docker compose). Aucune valeur de connexion n'est écrite en dur :
 * pour utiliser une autre base MongoDB, il suffit
 * de modifier MONGO_URI dans config.env.
 */

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`Variable ${name} invalide : "${raw}" n'est pas un entier`);
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement obligatoire manquante : ${name}`);
  return value;
}

const config = {
  port: int('PORT', 3000),
  mongo: {
    uri: required('MONGO_URI'),
    dbName: process.env.MONGO_DB_NAME || 'taskhive',
    maxPoolSize: int('MONGO_MAX_POOL_SIZE', 20),
    serverSelectionTimeoutMS: int('MONGO_SERVER_SELECTION_TIMEOUT_MS', 5000),
    connectRetries: int('MONGO_CONNECT_RETRIES', 20),
    connectRetryDelayMS: int('MONGO_CONNECT_RETRY_DELAY_MS', 3000),
  },
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  seedDemo: (process.env.SEED_DEMO || 'false').toLowerCase() === 'true',
  // Administrateur de la plateforme (facultatif : désactivé si l'une des deux valeurs manque)
  superAdmin: {
    email: (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase() || null,
    passwordHash: process.env.SUPERADMIN_PASSWORD_HASH || null,
  },
};
config.superAdmin.enabled = Boolean(config.superAdmin.email && config.superAdmin.passwordHash);

module.exports = config;
