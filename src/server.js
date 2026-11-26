'use strict';

const path = require('node:path');
const express = require('express');
const config = require('./config');
const { connect, getDb, close } = require('./db');
const { requireAuth } = require('./lib/auth');
const { errorHandler } = require('./lib/http');
const { seedDemo } = require('./seed');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// En-têtes de sécurité minimaux
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
  });
  next();
});

app.get('/health', async (req, res) => {
  try {
    await getDb().command({ ping: 1 });
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'database-unavailable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/platform', require('./routes/platform'));
app.use('/api', requireAuth);
app.use('/api/company', require('./routes/company'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api', require('./routes/tasks'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// no-cache : le navigateur revalide (ETag) à chaque chargement, une nouvelle version de l'interface est prise en compte tout de suite
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
}));
app.use(errorHandler);

async function start() {
  await connect();
  if (config.seedDemo) await seedDemo(getDb());
  const server = app.listen(config.port, () => {
    console.log(`[app] TaskHive écoute sur le port ${config.port}`);
  });

  const shutdown = (signal) => {
    console.log(`[app] ${signal} reçu, arrêt propre`);
    server.close(() => close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[app] démarrage impossible :', err.message);
  process.exit(1);
});
