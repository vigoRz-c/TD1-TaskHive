'use strict';

const bcrypt = require('bcryptjs');

/**
 * Jeu de données de démonstration (activé par SEED_DEMO=true dans config.env).
 * Deux entreprises distinctes pour pouvoir constater l'isolation des données.
 * Mot de passe de démonstration commun à tous les comptes : demo1234
 */
const DEMO_PASSWORD = 'demo1234';

const DEMO = [
  {
    company: { name: 'Kodexa', slug: 'kodexa' },
    users: [
      { key: 'loic', firstName: 'Loïc', lastName: 'Restout', email: 'loic.restout@kodexa.test', role: 'admin', jobTitle: 'CEO' },
      { key: 'camille', firstName: 'Camille', lastName: 'Perrin', email: 'camille.perrin@kodexa.test', role: 'manager', jobTitle: 'Cheffe de projet' },
      { key: 'nathan', firstName: 'Nathan', lastName: 'Leroy', email: 'nathan.leroy@kodexa.test', role: 'manager', jobTitle: 'Lead développeur' },
      { key: 'mathis', firstName: 'Mathis', lastName: 'Caron', email: 'mathis.caron@kodexa.test', role: 'member', jobTitle: 'Développeur' },
    ],
    projects: [
      {
        name: 'Refonte du site web', description: 'Nouvelle version du site vitrine.', color: '#4f46e5',
        members: ['loic', 'camille', 'nathan', 'mathis'],
        tasks: [
          { title: 'Maquettes de la page d\'accueil', status: 'done', priority: 'high', assignee: 'mathis', tags: ['design'] },
          { title: 'Intégrer la page d\'accueil', status: 'in_progress', priority: 'high', assignee: 'camille', tags: ['front'], due: 7 },
          { title: 'Formulaire de contact', status: 'todo', priority: 'medium', assignee: 'nathan', tags: ['front'], due: 14 },
          { title: 'Optimiser les images', status: 'todo', priority: 'low', assignee: null, tags: ['perf'] },
          { title: 'Relecture des contenus', status: 'review', priority: 'medium', assignee: 'loic', tags: ['contenu'], due: 3 },
        ],
      },
      {
        name: 'Application mobile', description: 'MVP de l\'application iOS/Android.', color: '#059669',
        members: ['loic', 'camille', 'nathan'],
        tasks: [
          { title: 'Choisir le framework mobile', status: 'done', priority: 'urgent', assignee: 'loic', tags: ['archi'] },
          { title: 'Écran de connexion', status: 'todo', priority: 'high', assignee: 'camille', tags: ['mobile'], due: 10 },
        ],
      },
    ],
  },
  {
    company: { name: 'Fumosolution', slug: 'fumosolution' },
    // Postes tirés des projets réels de l'équipe (Fumobilite, Fumotion, Fumovolution)
    // et des parcours BUT : développement (Léanne, Louka, Loïc), réseau (Noa, Raphael), BD (Maxence).
    users: [
      { key: 'clement', firstName: 'Clément', lastName: 'Lemaire', email: 'clement.lemaire@fumosolution.test', role: 'admin', jobTitle: 'CEO' },
      { key: 'leanne', firstName: 'Léanne', lastName: 'Basin', email: 'leanne.basin@fumosolution.test', role: 'manager', jobTitle: 'Lead développeuse front-end' },
      { key: 'louka', firstName: 'Louka', lastName: 'Carpentier', email: 'louka.carpentier@fumosolution.test', role: 'manager', jobTitle: 'Lead développeur back-end' },
      { key: 'loic', firstName: 'Loïc', lastName: 'Restout', email: 'loic.restout@fumosolution.test', role: 'member', jobTitle: 'Développeur back-end' },
      { key: 'maxence', firstName: 'Maxence', lastName: 'Lepeuve', email: 'maxence.lepeuve@fumosolution.test', role: 'member', jobTitle: 'Administrateur bases de données' },
      { key: 'noa', firstName: 'Noa', lastName: 'Arnould', email: 'noa.arnould@fumosolution.test', role: 'member', jobTitle: 'Administrateur réseau' },
      // Nom de famille inconnu : champ laissé vide
      { key: 'raphael', firstName: 'Raphael', lastName: '', email: 'raphael@fumosolution.test', role: 'member', jobTitle: 'Administrateur réseau' },
    ],
    projects: [
      {
        name: 'Fumovolution', description: "Simulateur d'évolution : moteur côté serveur, interface React, base de données et infrastructure Docker.", color: '#dc2626',
        members: ['clement', 'leanne', 'louka', 'loic', 'maxence'],
        tasks: [
          { title: "Valider l'architecture (moteur séparé de l'API)", status: 'review', priority: 'high', assignee: 'clement', tags: ['architecture'], due: 4 },
          { title: "Écran de création d'une simulation", status: 'in_progress', priority: 'high', assignee: 'leanne', tags: ['interface'], due: 10 },
          { title: 'Moteur : cycle des générations', status: 'in_progress', priority: 'urgent', assignee: 'louka', tags: ['moteur'], due: 6 },
          { title: 'Hérédité et mutation des traits', status: 'todo', priority: 'high', assignee: 'loic', tags: ['évolution'], due: 14 },
          { title: 'Modèle de données des journaux et statistiques', status: 'done', priority: 'high', assignee: 'maxence', tags: ['bd'] },
          { title: 'Conteneurs Docker Compose', status: 'in_progress', priority: 'medium', assignee: 'clement', tags: ['infra'], due: 12 },
        ],
      },
      {
        name: 'Jeu de stratégie en ligne', description: 'Jeu de stratégie multijoueur (type Clash of Clans) : serveurs de jeu et réseau.', color: '#f59e0b',
        members: ['clement', 'noa'],
        tasks: [
          { title: 'Serveurs de jeu et répartition de charge', status: 'in_progress', priority: 'high', assignee: 'noa', tags: ['réseau'], due: 9 },
          { title: 'Mesurer la latence entre joueurs', status: 'todo', priority: 'medium', assignee: 'noa', tags: ['réseau'], due: 16 },
          { title: 'Protection anti-DDoS et pare-feu', status: 'todo', priority: 'high', assignee: 'noa', tags: ['sécurité'], due: 21 },
        ],
      },
      {
        name: 'Infrastructure réseau', description: "Réseau interne de l'entreprise : adressage, pare-feu et accès distant.", color: '#0891b2',
        members: ['clement', 'raphael'],
        tasks: [
          { title: "Plan d'adressage et VLAN", status: 'done', priority: 'high', assignee: 'raphael', tags: ['réseau'] },
          { title: 'Configurer le pare-feu', status: 'in_progress', priority: 'high', assignee: 'raphael', tags: ['sécurité'], due: 7 },
          { title: 'VPN pour le télétravail', status: 'todo', priority: 'medium', assignee: 'raphael', tags: ['réseau'], due: 15 },
        ],
      },
    ],
  },
];

async function seedDemo(db) {
  if ((await db.collection('companies').countDocuments()) > 0) {
    console.log('[seed] base non vide : jeu de démonstration ignoré');
    return;
  }
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;

  for (const entry of DEMO) {
    const { insertedId: companyId } = await db.collection('companies').insertOne({
      ...entry.company, plan: 'pro', createdAt: now, updatedAt: now,
    });

    const ids = {};
    for (const { key, ...u } of entry.users) {
      const { insertedId } = await db.collection('users').insertOne({
        companyId, ...u, passwordHash, createdAt: now, updatedAt: now,
      });
      ids[key] = insertedId;
    }
    const admin = ids[entry.users[0].key];

    for (const p of entry.projects) {
      const { insertedId: projectId } = await db.collection('projects').insertOne({
        companyId, name: p.name, description: p.description, color: p.color, status: 'active',
        memberIds: p.members.map((k) => ids[k]), createdBy: admin, createdAt: now, updatedAt: now,
      });
      const positions = {};
      await db.collection('tasks').insertMany(p.tasks.map((t) => {
        positions[t.status] = (positions[t.status] || 0) + 1000;
        return {
          companyId, projectId, title: t.title, description: null, status: t.status, priority: t.priority,
          assigneeId: t.assignee ? ids[t.assignee] : null,
          dueDate: t.due ? new Date(now.getTime() + t.due * day) : null,
          tags: t.tags, position: positions[t.status], comments: [],
          createdBy: admin, createdAt: now, updatedAt: now,
        };
      }));
      await db.collection('activities').insertOne({
        companyId, projectId, userId: admin, action: 'project.created', details: { name: p.name }, at: now,
      });
    }
  }
  console.log(`[seed] jeu de démonstration créé (entreprises : kodexa, fumosolution — mot de passe : ${DEMO_PASSWORD})`);
}

module.exports = { seedDemo, DEMO_PASSWORD };
