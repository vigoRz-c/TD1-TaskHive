'use strict';

const { MongoClient } = require('mongodb');
const config = require('./config');

let client;
let db;

/** Validateurs $jsonSchema : MongoDB refuse tout document qui ne respecte pas la structure. */
const validators = {
  companies: {
    bsonType: 'object',
    required: ['name', 'slug', 'plan', 'createdAt', 'updatedAt'],
    properties: {
      name: { bsonType: 'string', minLength: 2, maxLength: 80 },
      slug: { bsonType: 'string', pattern: '^[a-z0-9-]{2,60}$' },
      plan: { enum: ['free', 'pro', 'enterprise'] },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
  users: {
    bsonType: 'object',
    required: ['companyId', 'email', 'passwordHash', 'firstName', 'lastName', 'role', 'createdAt', 'updatedAt'],
    properties: {
      companyId: { bsonType: 'objectId' },
      email: { bsonType: 'string', maxLength: 120 },
      passwordHash: { bsonType: 'string' },
      firstName: { bsonType: 'string', minLength: 1, maxLength: 60 },
      lastName: { bsonType: 'string', minLength: 0, maxLength: 60 },
      role: { enum: ['admin', 'manager', 'member'] },
      jobTitle: { bsonType: ['string', 'null'], maxLength: 80 },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
  projects: {
    bsonType: 'object',
    required: ['companyId', 'name', 'status', 'memberIds', 'createdBy', 'createdAt', 'updatedAt'],
    properties: {
      companyId: { bsonType: 'objectId' },
      name: { bsonType: 'string', minLength: 2, maxLength: 100 },
      description: { bsonType: ['string', 'null'], maxLength: 2000 },
      color: { bsonType: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      status: { enum: ['active', 'archived'] },
      memberIds: { bsonType: 'array', items: { bsonType: 'objectId' } },
      createdBy: { bsonType: 'objectId' },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
  tasks: {
    bsonType: 'object',
    required: ['companyId', 'projectId', 'title', 'status', 'priority', 'position', 'createdBy', 'createdAt', 'updatedAt'],
    properties: {
      companyId: { bsonType: 'objectId' },
      projectId: { bsonType: 'objectId' },
      title: { bsonType: 'string', minLength: 1, maxLength: 200 },
      description: { bsonType: ['string', 'null'], maxLength: 5000 },
      status: { enum: ['todo', 'in_progress', 'review', 'done'] },
      priority: { enum: ['low', 'medium', 'high', 'urgent'] },
      assigneeId: { bsonType: ['objectId', 'null'] },
      dueDate: { bsonType: ['date', 'null'] },
      tags: { bsonType: 'array', items: { bsonType: 'string' } },
      position: { bsonType: ['double', 'int', 'long'] },
      comments: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['_id', 'authorId', 'text', 'createdAt'],
          properties: {
            _id: { bsonType: 'objectId' },
            authorId: { bsonType: 'objectId' },
            text: { bsonType: 'string', minLength: 1, maxLength: 2000 },
            createdAt: { bsonType: 'date' },
          },
        },
      },
      createdBy: { bsonType: 'objectId' },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
  activities: {
    bsonType: 'object',
    required: ['companyId', 'projectId', 'userId', 'action', 'at'],
    properties: {
      companyId: { bsonType: 'objectId' },
      projectId: { bsonType: 'objectId' },
      userId: { bsonType: 'objectId' },
      action: { bsonType: 'string' },
      details: { bsonType: 'object' },
      at: { bsonType: 'date' },
    },
  },
};

/**
 * Index : companyId est TOUJOURS le préfixe. Cela sert l'isolation (toutes les
 * requêtes filtrent sur companyId) et les performances (requêtes par entreprise).
 */
const indexes = {
  companies: [{ key: { slug: 1 }, unique: true }],
  users: [
    { key: { companyId: 1, email: 1 }, unique: true },
    { key: { companyId: 1, lastName: 1, firstName: 1 } },
  ],
  projects: [
    { key: { companyId: 1, status: 1, name: 1 } },
    { key: { companyId: 1, memberIds: 1 } },
  ],
  tasks: [
    { key: { companyId: 1, projectId: 1, status: 1, position: 1 } },
    { key: { companyId: 1, assigneeId: 1, status: 1 } },
  ],
  activities: [
    { key: { companyId: 1, projectId: 1, at: -1 } },
    // Journal conservé 90 jours (index TTL)
    { key: { at: 1 }, expireAfterSeconds: 60 * 60 * 24 * 90 },
  ],
};

async function ensureSchema(database) {
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, schema] of Object.entries(validators)) {
    const options = { validator: { $jsonSchema: schema }, validationLevel: 'strict', validationAction: 'error' };
    if (existing.has(name)) {
      await database.command({ collMod: name, ...options });
    } else {
      await database.createCollection(name, options);
    }
  }
  for (const [name, specs] of Object.entries(indexes)) {
    for (const { key, ...opts } of specs) {
      await database.collection(name).createIndex(key, opts);
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Masque le mot de passe éventuel de l'URI avant de la journaliser. */
function redactUri(uri) {
  return uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
}

async function connect() {
  const { uri, dbName, maxPoolSize, serverSelectionTimeoutMS, connectRetries, connectRetryDelayMS } = config.mongo;
  for (let attempt = 1; attempt <= connectRetries; attempt += 1) {
    try {
      client = new MongoClient(uri, { maxPoolSize, serverSelectionTimeoutMS, appName: 'taskhive' });
      await client.connect();
      db = client.db(dbName);
      await db.command({ ping: 1 });
      console.log(`[db] connecté à ${redactUri(uri)} (base "${dbName}")`);
      await ensureSchema(db);
      console.log('[db] collections, validateurs et index prêts');
      return db;
    } catch (err) {
      console.warn(`[db] tentative ${attempt}/${connectRetries} échouée : ${err.message}`);
      if (client) await client.close().catch(() => {});
      if (attempt === connectRetries) throw err;
      await sleep(connectRetryDelayMS);
    }
  }
  throw new Error('connexion MongoDB impossible');
}

function getDb() {
  if (!db) throw new Error('Base de données non initialisée');
  return db;
}

async function close() {
  if (client) await client.close();
}

module.exports = { connect, getDb, close };
