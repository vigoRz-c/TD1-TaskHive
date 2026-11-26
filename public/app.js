'use strict';

/* =========================================================
   TaskHive — client web (SPA en JavaScript natif)
   ========================================================= */

const STATUSES = [
  { key: 'todo', label: 'À faire' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'review', label: 'En revue' },
  { key: 'done', label: 'Terminé' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
const PRIORITIES = { low: 'Basse', medium: 'Moyenne', high: 'Haute', urgent: 'Urgente' };
const ROLES = { admin: 'Administrateur', manager: 'Manager', member: 'Membre', superadmin: 'Administrateur de la plateforme' };
const PLANS = { free: 'Gratuit', pro: 'Pro', enterprise: 'Entreprise' };

const state = {
  token: localStorage.getItem('th_token'),
  user: null,
  company: null,
  users: [],
  projects: [],
  current: null, // { project, members, filters, tasks }
};

/* ---------- Utilitaires ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && state.token) {
    logout();
    throw new Error('Session expirée. Reconnectez-vous.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

const isSuperAdmin = () => state.user?.role === 'superadmin';
const isAdmin = () => ['admin', 'superadmin'].includes(state.user?.role);
const isManager = () => ['admin', 'manager', 'superadmin'].includes(state.user?.role);
const userById = (id) => state.users.find((u) => u._id === id) || (state.user?._id === id ? state.user : undefined);
const fullName = (u) => (u ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Personne');
const initials = (u) => (u ? `${u.firstName[0] || ''}${(u.lastName || '')[0] || ''}`.toUpperCase() : '');
// Couleur d'avatar stable : dérivée de l'identifiant de la personne
const avatarHue = (u) => [...String(u._id || u.email || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 6;
const avatar = (u) => (u
  ? `<span class="avatar av-${avatarHue(u)}" title="${esc(fullName(u))}">${esc(initials(u))}</span>`
  : '<span class="avatar empty" title="Personne"></span>');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const isLate = (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date(new Date().toDateString());
const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const swatch = (color) => `<span class="swatch" style="background:${esc(color)}"></span>`;
const statusTag = (status) => `<span class="tag st-${status}">${STATUS_LABEL[status]}</span>`;
const dueHtml = (t) => (t.dueDate
  ? (isLate(t)
    ? `<span class="tag on" title="Échéance dépassée">En retard, ${fmtDate(t.dueDate)}</span>`
    : `<time datetime="${toInputDate(t.dueDate)}" title="Échéance">${fmtDate(t.dueDate)}</time>`)
  : '');

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor"/>
  <path class="logo-mark" d="M7 8h5v16H7zM20 8h5v6h-5z"/><path class="logo-mark in" d="M13.5 8h5v10h-5z"/></svg>`;
const brand = () => `<a class="brand" href="#/" aria-label="TaskHive, accueil">${LOGO}<span>TaskHive</span></a>`;

const skeletonPage = () => `<div aria-busy="true"><span class="sr-only">Chargement</span>
  <span class="skeleton title"></span>
  ${'<span class="skeleton line"></span>'.repeat(5)}</div>`;
const skeletonBoard = () => STATUSES.map(() => `<section class="column" aria-hidden="true">
  <span class="skeleton line"></span><span class="skeleton card"></span><span class="skeleton card"></span></section>`).join('');

/* ---------- Session ---------- */

function saveSession({ token, user, company }) {
  state.token = token;
  state.user = user;
  state.company = company;
  localStorage.setItem('th_token', token);
}

function logout() {
  localStorage.removeItem('th_token');
  Object.assign(state, { token: null, user: null, company: null, users: [], projects: [], current: null });
  location.hash = '#/login';
  route();
}

async function loadSession() {
  const me = await api('GET', '/api/auth/me');
  state.user = me.user;
  state.company = me.company;
  if (state.company) await Promise.all([refreshUsers(), refreshProjects()]);
  else Object.assign(state, { users: [], projects: [], current: null });
}

/** Admin plateforme : entrer dans une entreprise (jeton scopé) ou revenir à la vue plateforme. */
async function enterCompany(companyId) {
  const { token } = await api('POST', `/api/platform/companies/${companyId}/enter`);
  state.token = token;
  localStorage.setItem('th_token', token);
  state.current = null;
  await loadSession();
  location.hash = '#/projects';
}

async function leaveCompany() {
  const { token } = await api('POST', '/api/platform/leave');
  state.token = token;
  localStorage.setItem('th_token', token);
  await loadSession();
}

async function refreshUsers() { state.users = (await api('GET', '/api/users')).users; }
async function refreshProjects() { state.projects = (await api('GET', '/api/projects?status=all')).projects; }

/* ---------- Routage (hash) ---------- */

async function route() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (!state.token) return renderAuth(parts[0] === 'register' ? 'register' : 'login');

  try {
    if (!state.user) await loadSession();
    if (isSuperAdmin() && (!state.company || parts[0] === 'platform')) {
      if (state.company) await leaveCompany();
      if (parts[0] !== 'platform') { location.hash = '#/platform'; return; }
      await viewPlatform();
      return;
    }
    if (parts[0] === 'platform') { location.hash = '#/projects'; return; }
    renderLayout(parts[0] === 'projects' && parts[1] ? `p:${parts[1]}` : parts[0] || 'projects');
    switch (parts[0]) {
      case 'projects':
        if (parts[1]) await viewProject(parts[1], parts[2]);
        else await viewDashboard();
        break;
      case 'mine': await viewMyTasks(); break;
      case 'team': await viewTeam(); break;
      case 'company': await viewCompany(); break;
      default: location.hash = '#/projects';
    }
  } catch (err) {
    if (state.token) {
      toast(err.message, true);
      const main = $('#main');
      if (main) {
        main.innerHTML = `<div class="empty-state" role="alert"><h2>Cette page ne s'affiche pas</h2>
          <p>${esc(err.message)}</p><button class="btn" type="button" id="retry">Réessayer</button></div>`;
        $('#retry').addEventListener('click', route);
      }
    }
  }
}

/* ---------- Écran de connexion / inscription ---------- */

/* Comptes de démonstration affichés à côté du formulaire (un clic remplit le formulaire).
   Le compte SUPERADMIN réel n'y figure jamais. */
const DEMO_ACCOUNTS = [
  { title: 'Admin plateforme', slug: '', note: "sans identifiant d'entreprise", accounts: [
    ['admin@taskhive.test', 'Administrateur', 'toutes les entreprises'],
  ] },
  { title: 'Kodexa', slug: 'kodexa', accounts: [
    ['loic.restout@kodexa.test', 'Loïc Restout', 'CEO, admin'],
    ['camille.perrin@kodexa.test', 'Camille Perrin', 'manager'],
    ['mathis.caron@kodexa.test', 'Mathis Caron', 'membre'],
  ] },
  { title: 'Fumosolution', slug: 'fumosolution', accounts: [
    ['clement.lemaire@fumosolution.test', 'Clément Lemaire', 'CEO, admin'],
    ['leanne.basin@fumosolution.test', 'Léanne Basin', 'manager'],
    ['loic.restout@fumosolution.test', 'Loïc Restout', 'membre'],
  ] },
];

function demoAccountsHint() {
  const groups = DEMO_ACCOUNTS.map((g) => `
    <div class="demo-group">
      <h3>${esc(g.title)} <span>${g.slug ? `identifiant <code>${esc(g.slug)}</code>` : esc(g.note)}</span></h3>
      <ul>${g.accounts.map(([mail, name, role]) => `
        <li><button type="button" class="demo-account" data-slug="${esc(g.slug)}" data-email="${esc(mail)}">
          <span class="who">${esc(name)}</span><span class="role">${esc(role)}</span><code>${esc(mail)}</code>
        </button></li>`).join('')}
      </ul>
    </div>`).join('');
  return `<aside class="auth-demo" aria-labelledby="demo-title">
    <h2 id="demo-title">Comptes de démonstration</h2>
    <p>Mot de passe commun : <code>demo1234</code>. Cliquez sur un compte pour remplir le formulaire.</p>
    ${groups}
  </aside>`;
}

const pwdField = (attrs) => `<div class="pwd-field"><input ${attrs}><button type="button" class="pwd-toggle" aria-label="Afficher le mot de passe" aria-pressed="false">Afficher</button></div>`;

function renderAuth(mode) {
  $('#app').innerHTML = `
    <div class="auth"><div class="auth-inner">
      <section class="auth-form-col">
        ${brand()}
        <h1 class="sr-only">${mode === 'login' ? 'Connexion à TaskHive' : 'Créer une entreprise sur TaskHive'}</h1>
        <div class="tabs">
          <button type="button" data-mode="login" class="${mode === 'login' ? 'active' : ''}" ${mode === 'login' ? 'aria-current="page"' : ''}>Connexion</button>
          <button type="button" data-mode="register" class="${mode === 'register' ? 'active' : ''}" ${mode === 'register' ? 'aria-current="page"' : ''}>Créer une entreprise</button>
        </div>
        <form id="auth-form" novalidate>
          ${mode === 'login' ? `
            <label for="f-slug">Identifiant de l'entreprise</label>
            <input id="f-slug" name="companySlug" placeholder="kodexa" autocomplete="organization" required>
            <label for="f-email">E-mail</label>
            <input id="f-email" name="email" type="email" autocomplete="username" required>
            <label for="f-pwd">Mot de passe</label>
            ${pwdField('id="f-pwd" name="password" type="password" autocomplete="current-password" required')}
          ` : `
            <label for="f-company">Nom de l'entreprise</label>
            <input id="f-company" name="companyName" autocomplete="organization" required>
            <div class="row">
              <div><label for="f-first">Prénom</label><input id="f-first" name="firstName" autocomplete="given-name" required></div>
              <div><label for="f-last">Nom</label><input id="f-last" name="lastName" autocomplete="family-name" required></div>
            </div>
            <label for="f-email">E-mail</label>
            <input id="f-email" name="email" type="email" autocomplete="username" required>
            <label for="f-pwd">Mot de passe (8 caractères minimum)</label>
            ${pwdField('id="f-pwd" name="password" type="password" autocomplete="new-password" minlength="8" required')}
          `}
          <div class="error-msg" id="auth-error" role="alert"></div>
          <button class="btn primary" type="submit">${mode === 'login' ? 'Se connecter' : "Créer l'entreprise"}</button>
        </form>
      </section>
      ${mode === 'login' ? demoAccountsHint() : ''}
    </div></div>`;

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    location.hash = b.dataset.mode === 'register' ? '#/register' : '#/login';
  }));
  $$('.demo-account').forEach((b) => b.addEventListener('click', () => {
    $('#f-slug').value = b.dataset.slug;
    $('#f-email').value = b.dataset.email;
    $('#f-pwd').value = 'demo1234';
    $('#auth-form button[type=submit]').focus();
  }));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = $('button[type=submit]', e.target);
    const body = Object.fromEntries(new FormData(e.target));
    submit.disabled = true;
    try {
      const data = await api('POST', mode === 'login' ? '/api/auth/login' : '/api/auth/register', body);
      saveSession(data);
      if (mode === 'register') toast(`Entreprise créée. Identifiant de connexion : ${data.company.slug}`);
      await loadSession();
      location.hash = '#/projects';
      route();
    } catch (err) {
      $('#auth-error').textContent = err.message;
      submit.disabled = false;
    }
  });
}

/* ---------- Coque principale ---------- */

function shell({ company, nav, me }) {
  return `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-top">${brand()}
          <button class="btn small menu-toggle" type="button" id="menu-toggle" aria-expanded="false" aria-controls="sidebar-body">Menu</button></div>
        <div class="sidebar-body" id="sidebar-body">
          <div class="company-name">${company}</div>
          ${nav}
          <div class="spacer"></div>
          <div class="me">${me}</div>
        </div>
      </aside>
      <main class="main" id="main">${skeletonPage()}</main>
    </div>`;
}

function bindShell() {
  $('#logout').addEventListener('click', logout);
  $('#menu-toggle').addEventListener('click', (e) => {
    const open = $('#sidebar').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
}

function renderLayout(active) {
  const projects = state.projects.filter((p) => p.status === 'active');
  const link = (key, href, label) => `<a class="nav-link ${active === key ? 'active' : ''}" href="${href}" ${active === key ? 'aria-current="page"' : ''}><span class="label">${label}</span></a>`;
  $('#app').innerHTML = shell({
    company: `<strong>${esc(state.company.name)}</strong>identifiant <code>${esc(state.company.slug)}</code>`,
    nav: `
      ${isSuperAdmin() ? '<a class="nav-link platform-link" href="#/platform"><span class="label">Toutes les entreprises</span></a>' : ''}
      ${link('projects', '#/projects', 'Tableau de bord')}
      ${link('mine', '#/mine', 'Mes tâches')}
      ${link('team', '#/team', 'Équipe')}
      ${link('company', '#/company', 'Entreprise')}
      <div class="nav-title">Projets ${isManager() ? '<button type="button" id="new-project" aria-label="Nouveau projet" title="Nouveau projet">+</button>' : ''}</div>
      ${projects.map((p) => `
        <a class="nav-link ${active === `p:${p._id}` ? 'active' : ''}" href="#/projects/${p._id}" ${active === `p:${p._id}` ? 'aria-current="page"' : ''}>
          ${swatch(p.color)}<span class="label">${esc(p.name)}</span>
        </a>`).join('') || '<div class="nav-empty">Aucun projet actif</div>'}`,
    me: `
      ${isSuperAdmin()
        ? `<div class="nav-link">${avatar(state.user)} <span class="label">${esc(fullName(state.user))}</span></div>`
        : `<a href="#" id="edit-me" class="nav-link" title="Modifier mon profil">${avatar(state.user)} <span class="label">${esc(fullName(state.user))}</span></a>`}
      <div class="role">${esc(ROLES[state.user.role])}</div>
      <button class="btn small" type="button" id="logout">Se déconnecter</button>`,
  });
  bindShell();
  $('#edit-me')?.addEventListener('click', (e) => { e.preventDefault(); openUserModal(state.user); });
  $('#new-project')?.addEventListener('click', () => openProjectModal());
}

/* ---------- Administration de la plateforme ---------- */

async function viewPlatform() {
  const { companies } = await api('GET', '/api/platform/companies');
  const totals = companies.reduce((t, c) => ({
    users: t.users + c.stats.users, projects: t.projects + c.stats.projects, tasks: t.tasks + c.stats.tasks,
  }), { users: 0, projects: 0, tasks: 0 });

  $('#app').innerHTML = shell({
    company: '<strong>Administration</strong>de la plateforme',
    nav: '<a class="nav-link active" href="#/platform" aria-current="page"><span class="label">Entreprises clientes</span></a>',
    me: `<div class="nav-link">${avatar(state.user)} <span class="label">${esc(fullName(state.user))}</span></div>
      <div class="role">${esc(ROLES.superadmin)}</div>
      <button class="btn small" type="button" id="logout">Se déconnecter</button>`,
  });
  bindShell();
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Entreprises clientes</h1>
      <p>Ouvrez une entreprise pour la gérer avec les droits de son administrateur.</p></div>
      <div class="actions"><button class="btn primary" type="button" id="pf-new">Nouvelle entreprise</button></div></div>
    <div class="stats">
      <div class="stat"><div class="value">${companies.length}</div><div class="label">Entreprises</div></div>
      <div class="stat"><div class="value">${totals.users}</div><div class="label">Utilisateurs</div></div>
      <div class="stat"><div class="value">${totals.projects}</div><div class="label">Projets</div></div>
      <div class="stat"><div class="value">${totals.tasks}</div><div class="label">Tâches</div></div>
    </div>
    ${companies.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Entreprise</th><th>Identifiant</th><th>Offre</th><th class="num">Utilisateurs</th><th class="num">Projets</th><th class="num">Tâches</th><th>Créée le</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${companies.map((c) => `<tr>
        <td class="row-title">${esc(c.name)}</td><td><code>${esc(c.slug)}</code></td><td>${PLANS[c.plan]}</td>
        <td class="num">${c.stats.users}</td><td class="num">${c.stats.projects}</td><td class="num">${c.stats.tasks}</td><td class="nowrap">${fmtDate(c.createdAt)}</td>
        <td><div class="actions"><button class="btn small primary" type="button" data-enter="${c._id}">Ouvrir</button>
          <button class="btn small danger" type="button" data-del="${c._id}">Supprimer</button></div></td></tr>`).join('')}</tbody>
    </table></div>`
    : '<div class="empty-state"><h2>Aucune entreprise</h2><p>Créez la première avec le bouton « Nouvelle entreprise ».</p></div>'}`;

  $$('[data-enter]').forEach((b) => b.addEventListener('click', async () => {
    try { await enterCompany(b.dataset.enter); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const c = companies.find((x) => x._id === b.dataset.del);
    const typed = prompt(`Supprimer « ${c.name} » et toutes ses données ? Saisissez son identifiant pour confirmer : ${c.slug}`);
    if (typed !== c.slug) { if (typed !== null) toast('Identifiant incorrect. Rien n\'a été supprimé.', true); return; }
    await api('DELETE', `/api/platform/companies/${c._id}`);
    toast('Entreprise supprimée');
    viewPlatform();
  }));
  $('#pf-new').addEventListener('click', () => openModal(`
    ${modalHead('Nouvelle entreprise')}
    <label for="pf-name">Nom de l'entreprise</label><input id="pf-name" name="name" maxlength="80" required>
    <label for="pf-plan">Offre</label><select id="pf-plan" name="plan">
      ${Object.entries(PLANS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <p class="sub" style="margin-top:12px">Ouvrez ensuite l'entreprise pour créer ses utilisateurs, dans l'onglet Équipe.</p>
    <div class="error-msg" role="alert"></div>
    <div class="modal-foot"><div class="right"><button class="btn" type="button" data-close>Annuler</button>
      <button class="btn primary" type="submit">Créer l'entreprise</button></div></div>
  `, async (data) => {
    const { company } = await api('POST', '/api/platform/companies', data);
    toast(`Entreprise créée. Identifiant : ${company.slug}`);
    viewPlatform();
  }));
}

/* ---------- Modale générique ---------- */

function openModal(html, onSubmit, onReady) {
  const dialog = $('#modal');
  const form = $('#modal-form');
  form.innerHTML = html;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = $('.error-msg', form);
    const submit = $('button[type=submit]', form);
    if (errorEl) errorEl.textContent = '';
    if (submit) submit.disabled = true;
    try {
      const keepOpen = await onSubmit(Object.fromEntries(new FormData(form)), form);
      if (!keepOpen) dialog.close();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message; else toast(err.message, true);
    } finally {
      if (submit) submit.disabled = false;
    }
  };
  $$('[data-close]', form).forEach((b) => b.addEventListener('click', () => dialog.close()));
  if (onReady) onReady(form);
  if (!dialog.open) dialog.showModal();
}

const modalHead = (title) => `<div class="modal-head"><h2>${esc(title)}</h2>
  <button class="btn ghost small" type="button" data-close aria-label="Fermer">Fermer</button></div>`;

/* ---------- Tableau de bord ---------- */

function progressBar(c, total) {
  if (!total) return '<div class="progress"></div>';
  return `<div class="progress" role="img" aria-label="${c.done} sur ${total} terminées">${['done', 'review', 'in_progress', 'todo']
    .map((k) => (c[k] ? `<span class="s-${k}" style="width:${(c[k] / total) * 100}%"></span>` : '')).join('')}</div>`;
}

async function viewDashboard() {
  await refreshProjects();
  const main = $('#main');
  const row = (p) => {
    const c = p.taskCounts;
    const total = c.todo + c.in_progress + c.review + c.done;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    return `<tr data-href="#/projects/${p._id}">
      <td><div class="cell-name">${swatch(p.color)}<a class="row-title" href="#/projects/${p._id}">${esc(p.name)}</a>
        ${p.status === 'archived' ? '<span class="tag out">Archivé</span>' : ''}</div></td>
      <td><div class="progress-cell">${progressBar(c, total)}<span class="pct">${pct} %</span></div></td>
      <td class="num">${c.todo}</td><td class="num ${c.in_progress ? 'in' : ''}">${c.in_progress}</td><td class="num">${c.review}</td><td class="num">${c.done}</td>
    </tr>`;
  };
  const table = (list) => `<div class="table-wrap"><table>
    <thead><tr><th>Projet</th><th>Avancement</th><th class="num">À faire</th><th class="num">En cours</th><th class="num">En revue</th><th class="num">Terminé</th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody></table></div>`;
  const active = state.projects.filter((p) => p.status === 'active');
  const archived = state.projects.filter((p) => p.status === 'archived');
  main.innerHTML = `
    <div class="page-head"><div><h1>Tableau de bord</h1></div>
      <div class="actions">${isManager() ? '<button class="btn primary" type="button" id="dash-new">Nouveau projet</button>' : ''}</div></div>
    <section class="section"><h2>Projets actifs <span class="n">${active.length}</span></h2>
      ${active.length ? table(active) : `<div class="empty-state"><h2>Aucun projet actif</h2><p>${isManager()
        ? 'Créez le premier avec le bouton « Nouveau projet ».'
        : 'Un manager doit vous ajouter à un projet pour qu\'il apparaisse ici.'}</p></div>`}</section>
    ${archived.length ? `<section class="section"><h2>Projets archivés <span class="n">${archived.length}</span></h2>${table(archived)}</section>` : ''}`;
  $('#dash-new')?.addEventListener('click', () => openProjectModal());
  $$('tr[data-href]', main).forEach((el) => el.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.hash = el.dataset.href;
  }));
}

/* ---------- Vue projet + Kanban ---------- */

async function viewProject(projectId, openTaskId) {
  const { project, members } = await api('GET', `/api/projects/${projectId}`);
  const sameProject = state.current?.project._id === projectId;
  state.current = { project, members, tasks: [], filters: sameProject ? state.current.filters : { q: '', assignee: '', priority: '' } };
  const f = state.current.filters;
  const archived = project.status === 'archived';

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <h1>${swatch(project.color)}${esc(project.name)}
          ${archived ? '<span class="tag out">Archivé</span>' : ''}</h1>
        ${project.description ? `<p>${esc(project.description)}</p>` : ''}
        <div class="people" aria-label="Membres du projet">${members.map(avatar).join('')}</div>
      </div>
      <div class="actions">
        ${isManager() ? `
          <button class="btn" type="button" id="p-edit">Modifier le projet</button>
          <button class="btn" type="button" id="p-archive">${archived ? 'Réactiver' : 'Archiver'}</button>
          <button class="btn danger" type="button" id="p-delete">Supprimer</button>` : ''}
      </div>
    </div>
    <div class="filters" role="search">
      <label class="sr-only" for="flt-q">Rechercher une tâche</label>
      <input id="flt-q" type="search" placeholder="Rechercher une tâche" value="${esc(f.q)}">
      <label class="sr-only" for="flt-assignee">Filtrer par membre</label>
      <select id="flt-assignee">
        <option value="">Tous les membres</option>
        <option value="none" ${f.assignee === 'none' ? 'selected' : ''}>Non assignées</option>
        ${members.map((m) => `<option value="${m._id}" ${f.assignee === m._id ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('')}
      </select>
      <label class="sr-only" for="flt-priority">Filtrer par priorité</label>
      <select id="flt-priority">
        <option value="">Toutes les priorités</option>
        ${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${f.priority === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="project-grid">
      <div class="board" id="board">${skeletonBoard()}</div>
      <aside class="side-panel"><h2>Activité récente</h2><div id="activity">
        ${'<span class="skeleton line"></span>'.repeat(4)}</div></aside>
    </div>`;

  $('#p-edit')?.addEventListener('click', () => openProjectModal(project));
  $('#p-archive')?.addEventListener('click', async () => {
    await api('PUT', `/api/projects/${project._id}`, { status: archived ? 'active' : 'archived' });
    toast(archived ? 'Projet réactivé' : 'Projet archivé');
    await refreshProjects();
    route();
  });
  $('#p-delete')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer définitivement le projet « ${project.name} » et toutes ses tâches ?`)) return;
    await api('DELETE', `/api/projects/${project._id}`);
    toast('Projet supprimé');
    await refreshProjects();
    location.hash = '#/projects';
  });

  let searchTimer;
  $('#flt-q').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { f.q = e.target.value; loadBoard(); }, 250);
  });
  $('#flt-assignee').addEventListener('change', (e) => { f.assignee = e.target.value; loadBoard(); });
  $('#flt-priority').addEventListener('change', (e) => { f.priority = e.target.value; loadBoard(); });

  await Promise.all([loadBoard(), loadActivity()]);
  if (openTaskId) {
    const task = state.current.tasks.find((t) => t._id === openTaskId);
    if (task) openTaskModal(task);
  }
}

async function loadBoard() {
  const { project, filters } = state.current;
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const { tasks } = await api('GET', `/api/projects/${project._id}/tasks?${params}`);
  state.current.tasks = tasks;
  renderBoard();
}

function taskCard(t) {
  const assignee = state.current.members.find((m) => m._id === t.assigneeId);
  return `<div class="card" draggable="true" tabindex="0" role="button" data-id="${t._id}" data-position="${t.position}">
    <div class="title">${esc(t.title)}</div>
    <div class="meta">
      <span class="prio prio-${t.priority}">${PRIORITIES[t.priority]}</span>
      ${t.tags.map((tag) => `<span class="label-tag">${esc(tag)}</span>`).join('')}
      ${t.comments?.length ? `<span>${plural(t.comments.length, 'commentaire')}</span>` : ''}
      <span class="spacer"></span>
      ${dueHtml(t)}
      ${avatar(assignee)}
    </div>
  </div>`;
}

function renderBoard() {
  const board = $('#board');
  if (!board) return;
  const archived = state.current.project.status === 'archived';
  board.innerHTML = STATUSES.map((s) => {
    const tasks = state.current.tasks.filter((t) => t.status === s.key).sort((a, b) => a.position - b.position);
    return `<section class="column" data-status="${s.key}" aria-label="${s.label}">
      <div class="column-head"><h2>${s.label}</h2><span class="count">${tasks.length}</span></div>
      <div class="cards">${tasks.map(taskCard).join('')}</div>
      ${archived ? '' : `<button class="add-task" type="button" data-add="${s.key}">+ Ajouter une tâche</button>`}
    </section>`;
  }).join('');

  $$('.card', board).forEach((card) => {
    const open = () => openTaskModal(state.current.tasks.find((t) => t._id === card.dataset.id));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('[data-add]', board).forEach((b) => b.addEventListener('click', () => openTaskModal(null, b.dataset.add)));
  $$('.column', board).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop', (e) => onDrop(e, col));
  });
}

/** Calcule la nouvelle position (entre la carte du dessus et celle du dessous) puis appelle l'API. */
async function onDrop(e, col) {
  e.preventDefault();
  col.classList.remove('drag-over');
  const id = e.dataTransfer.getData('text/plain');
  const task = state.current.tasks.find((t) => t._id === id);
  if (!task) return;

  const cards = $$('.card', col).filter((c) => c.dataset.id !== id);
  const next = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
  const prev = next ? cards[cards.indexOf(next) - 1] : cards[cards.length - 1];
  const p = prev ? Number(prev.dataset.position) : null;
  const n = next ? Number(next.dataset.position) : null;
  const position = p !== null && n !== null ? (p + n) / 2 : n !== null ? n - 1000 : p !== null ? p + 1000 : 1000;
  const status = col.dataset.status;
  if (status === task.status && position === task.position) return;

  // Mise à jour optimiste puis synchronisation avec le serveur
  Object.assign(task, { status, position });
  renderBoard();
  try {
    await api('PATCH', `/api/tasks/${id}/move`, { status, position });
    loadActivity();
  } catch (err) {
    toast(err.message, true);
    loadBoard();
  }
}

const ACTIONS = {
  'project.created': (d) => `a créé le projet « ${esc(d.name)} »`,
  'project.updated': () => 'a modifié le projet',
  'task.created': (d) => `a créé la tâche « ${esc(d.title)} »`,
  'task.updated': (d) => `a modifié la tâche « ${esc(d.title)} »`,
  'task.moved': (d) => `a déplacé « ${esc(d.title)} » de ${STATUS_LABEL[d.from]} à ${STATUS_LABEL[d.to]}`,
  'task.deleted': (d) => `a supprimé la tâche « ${esc(d.title)} »`,
  'task.commented': (d) => `a commenté « ${esc(d.title)} »`,
};

async function loadActivity() {
  const el = $('#activity');
  if (!el) return;
  const { activities } = await api('GET', `/api/projects/${state.current.project._id}/activity`);
  el.innerHTML = activities.map((a) => `<div class="activity">
    <strong>${esc(a.user ? `${a.user.firstName} ${a.user.lastName || ''}`.trim() : 'Utilisateur supprimé')}</strong>
    ${(ACTIONS[a.action] || (() => esc(a.action)))(a.details || {})}
    <time datetime="${esc(a.at)}">${fmtDateTime(a.at)}</time></div>`).join('')
    || '<p class="empty-state">Aucune activité pour l\'instant.</p>';
}

/* ---------- Modale tâche ---------- */

function commentsHtml(task) {
  return (task.comments || []).map((c) => {
    const author = userById(c.authorId);
    const canDelete = c.authorId === state.user._id || isManager();
    return `<div class="comment"><div class="head"><span><strong>${esc(fullName(author))}</strong><time datetime="${esc(c.createdAt)}">${fmtDateTime(c.createdAt)}</time></span>
      ${canDelete ? `<button class="btn ghost small" type="button" data-del-comment="${c._id}">Supprimer</button>` : ''}</div>
      <div class="text">${esc(c.text)}</div></div>`;
  }).join('') || '<p class="sub" style="padding:10px 0">Aucun commentaire.</p>';
}

function openTaskModal(task, defaultStatus = 'todo') {
  const { members, project } = state.current;
  const isNew = !task;
  const t = task || { title: '', description: '', status: defaultStatus, priority: 'medium', assigneeId: null, dueDate: null, tags: [] };
  const canDelete = !isNew && (isManager() || t.createdBy === state.user._id);

  openModal(`
    ${modalHead(isNew ? 'Nouvelle tâche' : 'Modifier la tâche')}
    <label for="t-title">Titre</label>
    <input id="t-title" name="title" value="${esc(t.title)}" maxlength="200" required>
    <label for="t-desc">Description</label>
    <textarea id="t-desc" name="description" maxlength="5000">${esc(t.description || '')}</textarea>
    <div class="row">
      <div><label for="t-status">Statut</label><select id="t-status" name="status">
        ${STATUSES.map((s) => `<option value="${s.key}" ${t.status === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div><label for="t-prio">Priorité</label><select id="t-prio" name="priority">
        ${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${t.priority === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div><label for="t-assignee">Assignée à</label><select id="t-assignee" name="assigneeId">
        <option value="">Personne</option>
        ${members.map((m) => `<option value="${m._id}" ${t.assigneeId === m._id ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('')}</select></div>
      <div><label for="t-due">Échéance</label><input id="t-due" name="dueDate" type="date" value="${toInputDate(t.dueDate)}"></div>
    </div>
    <label for="t-tags">Étiquettes, séparées par des virgules</label>
    <input id="t-tags" name="tags" value="${esc(t.tags.join(', '))}" placeholder="front, bug, design">
    ${isNew ? '' : `<p class="sub" style="margin-top:12px">Créée le ${fmtDateTime(t.createdAt)} par ${esc(fullName(userById(t.createdBy)))}</p>`}
    <div class="error-msg" role="alert"></div>
    <div class="modal-foot">
      ${canDelete ? '<button class="btn danger" type="button" id="t-delete">Supprimer</button>' : ''}
      <div class="right"><button class="btn" type="button" data-close>Annuler</button>
      <button class="btn primary" type="submit">${isNew ? 'Créer la tâche' : 'Enregistrer'}</button></div>
    </div>
    ${isNew ? '' : `<div class="comments"><h3>Commentaires</h3><div id="comment-list">${commentsHtml(t)}</div>
      <label for="c-text">Ajouter un commentaire</label><textarea id="c-text" maxlength="2000"></textarea>
      <button class="btn small" type="button" id="c-add">Publier le commentaire</button></div>`}
  `, async (data) => {
    const body = {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      assigneeId: data.assigneeId || null,
      dueDate: data.dueDate || null,
      tags: data.tags.split(',').map((s) => s.trim()).filter(Boolean),
    };
    if (isNew) await api('POST', `/api/projects/${project._id}/tasks`, body);
    else await api('PUT', `/api/tasks/${t._id}`, body);
    toast(isNew ? 'Tâche créée' : 'Tâche enregistrée');
    await Promise.all([loadBoard(), loadActivity()]);
  }, (form) => {
    $('#t-delete', form)?.addEventListener('click', async () => {
      if (!confirm(`Supprimer la tâche « ${t.title} » ?`)) return;
      await api('DELETE', `/api/tasks/${t._id}`);
      $('#modal').close();
      toast('Tâche supprimée');
      await Promise.all([loadBoard(), loadActivity()]);
    });
    const bindComments = () => $$('[data-del-comment]', form).forEach((b) => b.addEventListener('click', async () => {
      const res = await api('DELETE', `/api/tasks/${t._id}/comments/${b.dataset.delComment}`);
      t.comments = res.task.comments;
      $('#comment-list', form).innerHTML = commentsHtml(t);
      bindComments();
      loadBoard();
    }));
    bindComments();
    $('#c-add', form)?.addEventListener('click', async () => {
      const text = $('#c-text', form).value.trim();
      if (!text) return;
      try {
        const res = await api('POST', `/api/tasks/${t._id}/comments`, { text });
        t.comments = res.task.comments;
        $('#c-text', form).value = '';
        $('#comment-list', form).innerHTML = commentsHtml(t);
        bindComments();
        loadBoard();
        loadActivity();
        toast('Commentaire publié');
      } catch (err) { toast(err.message, true); }
    });
  });
}

/* ---------- Modale projet ---------- */

function openProjectModal(project) {
  const isNew = !project;
  const p = project || { name: '', description: '', color: '#0f6e6e', memberIds: [state.user._id] };
  openModal(`
    ${modalHead(isNew ? 'Nouveau projet' : 'Modifier le projet')}
    <label for="p-name">Nom</label><input id="p-name" name="name" value="${esc(p.name)}" maxlength="100" required>
    <label for="p-desc">Description</label><textarea id="p-desc" name="description" maxlength="2000">${esc(p.description || '')}</textarea>
    <label for="p-color">Couleur</label><input id="p-color" name="color" type="color" value="${esc(p.color)}">
    <fieldset class="plain"><legend>Membres du projet</legend>
    <div class="checks">${state.users.map((u) => `<label><input type="checkbox" name="m-${u._id}" ${p.memberIds.includes(u._id) ? 'checked' : ''}>
      ${esc(fullName(u))} <span class="sub">${ROLES[u.role]}</span></label>`).join('')}</div></fieldset>
    <div class="error-msg" role="alert"></div>
    <div class="modal-foot"><div class="right"><button class="btn" type="button" data-close>Annuler</button>
      <button class="btn primary" type="submit">${isNew ? 'Créer le projet' : 'Enregistrer'}</button></div></div>
  `, async (data) => {
    const memberIds = Object.keys(data).filter((k) => k.startsWith('m-')).map((k) => k.slice(2));
    const body = { name: data.name, description: data.description, color: data.color, memberIds };
    const res = isNew
      ? await api('POST', '/api/projects', body)
      : await api('PUT', `/api/projects/${p._id}`, body);
    toast(isNew ? 'Projet créé' : 'Projet enregistré');
    await refreshProjects();
    if (location.hash === `#/projects/${res.project._id}`) route();
    else location.hash = `#/projects/${res.project._id}`;
  });
}

/* ---------- Mes tâches ---------- */

async function viewMyTasks() {
  const { tasks } = await api('GET', '/api/tasks/mine');
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Mes tâches</h1><p>Vos tâches non terminées, tous projets confondus.</p></div></div>
    ${tasks.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Tâche</th><th>Projet</th><th>Statut</th><th>Priorité</th><th>Échéance</th></tr></thead>
      <tbody>${tasks.map((t) => `<tr data-href="#/projects/${t.projectId}/${t._id}">
        <td><a class="row-title" href="#/projects/${t.projectId}/${t._id}">${esc(t.title)}</a></td>
        <td><div class="cell-name">${swatch(t.project.color)}${esc(t.project.name)}</div></td>
        <td>${statusTag(t.status)}</td>
        <td><span class="prio prio-${t.priority}">${PRIORITIES[t.priority]}</span></td>
        <td>${dueHtml(t)}</td>
      </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state"><h2>Rien à faire pour l\'instant</h2><p>Les tâches qu\'on vous assigne apparaîtront ici.</p></div>'}`;
  $$('tr[data-href]').forEach((el) => el.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.hash = el.dataset.href;
  }));
}

/* ---------- Équipe (utilisateurs) ---------- */

async function viewTeam() {
  await refreshUsers();
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Équipe</h1><p>${plural(state.users.length, 'utilisateur')} chez ${esc(state.company.name)}.</p></div>
      <div class="actions">${isAdmin() ? '<button class="btn primary" type="button" id="u-new">Ajouter un utilisateur</button>' : ''}</div></div>
    <div class="table-wrap"><table>
      <thead><tr><th><span class="sr-only">Initiales</span></th><th>Nom</th><th>E-mail</th><th>Poste</th><th>Rôle</th><th class="num">Projets</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${state.users.map((u) => {
        const count = state.projects.filter((p) => p.memberIds.includes(u._id)).length;
        return `<tr><td>${avatar(u)}</td><td class="row-title">${esc(fullName(u))}</td><td>${esc(u.email)}</td>
          <td>${esc(u.jobTitle || '')}</td><td><span class="tag ${u.role === 'admin' ? 'on' : 'out'}">${ROLES[u.role]}</span></td><td class="num">${count}</td>
          <td><div class="actions">${isAdmin() || u._id === state.user._id ? `<button class="btn small" type="button" data-edit="${u._id}">Modifier</button>` : ''}
            ${isAdmin() && u._id !== state.user._id ? `<button class="btn small danger" type="button" data-del="${u._id}">Supprimer</button>` : ''}</div></td></tr>`;
      }).join('')}</tbody></table></div>`;
  $('#u-new')?.addEventListener('click', () => openUserModal());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openUserModal(userById(b.dataset.edit))));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const u = userById(b.dataset.del);
    if (!confirm(`Supprimer ${fullName(u)} ? Ses tâches seront désassignées.`)) return;
    await api('DELETE', `/api/users/${u._id}`);
    toast('Utilisateur supprimé');
    await refreshProjects();
    viewTeam();
  }));
}

function openUserModal(user) {
  const isNew = !user;
  const u = user || { firstName: '', lastName: '', email: '', jobTitle: '', role: 'member' };
  const canChangeRole = isAdmin() && u._id !== state.user._id;
  openModal(`
    ${modalHead(isNew ? 'Nouvel utilisateur' : `Modifier ${fullName(u)}`)}
    <div class="row">
      <div><label for="u-first">Prénom</label><input id="u-first" name="firstName" value="${esc(u.firstName)}" autocomplete="off" required></div>
      <div><label for="u-last">Nom</label><input id="u-last" name="lastName" value="${esc(u.lastName)}" autocomplete="off" required></div>
    </div>
    <label for="u-email">E-mail</label><input id="u-email" name="email" type="email" value="${esc(u.email)}" autocomplete="off" required>
    <label for="u-job">Poste</label><input id="u-job" name="jobTitle" value="${esc(u.jobTitle || '')}" maxlength="80">
    ${canChangeRole || isNew ? `<label for="u-role">Rôle</label><select id="u-role" name="role">
      ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ''}
    <label for="u-pwd">${isNew ? 'Mot de passe (8 caractères minimum)' : 'Nouveau mot de passe (laisser vide pour le garder)'}</label>
    ${pwdField('id="u-pwd" name="password" type="password" autocomplete="new-password"')}
    <div class="error-msg" role="alert"></div>
    <div class="modal-foot"><div class="right"><button class="btn" type="button" data-close>Annuler</button>
      <button class="btn primary" type="submit">${isNew ? "Créer l'utilisateur" : 'Enregistrer'}</button></div></div>
  `, async (data) => {
    const body = { ...data };
    if (!body.password) delete body.password;
    if (isNew) await api('POST', '/api/users', body);
    else {
      const res = await api('PUT', `/api/users/${u._id}`, body);
      if (u._id === state.user._id) state.user = res.user;
    }
    toast(isNew ? 'Utilisateur créé' : 'Utilisateur enregistré');
    await refreshUsers();
    route();
  });
}

/* ---------- Entreprise ---------- */

async function viewCompany() {
  const { company, stats } = await api('GET', '/api/company');
  state.company = company;
  const total = Object.values(stats.tasks).reduce((a, b) => a + b, 0);
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>${esc(company.name)}</h1>
      <dl class="facts">
        <div><dt>Identifiant de connexion</dt><dd><code>${esc(company.slug)}</code></dd></div>
        <div><dt>Offre</dt><dd>${PLANS[company.plan]}</dd></div>
        <div><dt>Créée le</dt><dd>${fmtDate(company.createdAt)}</dd></div>
      </dl></div></div>
    <div class="stats">
      <div class="stat"><div class="value">${stats.users}</div><div class="label">Utilisateurs</div></div>
      <div class="stat"><div class="value">${stats.projects}</div><div class="label">Projets</div></div>
      <div class="stat"><div class="value">${total}</div><div class="label">Tâches</div></div>
      <div class="stat"><div class="value">${stats.tasks.done || 0}</div><div class="label">Tâches terminées</div></div>
    </div>
    ${isAdmin() ? `
    <section class="section" style="max-width:640px"><h2>Paramètres</h2>
      <form id="company-form" novalidate>
        <div class="row">
          <div><label for="c-name">Nom de l'entreprise</label><input id="c-name" name="name" value="${esc(company.name)}" required></div>
          <div><label for="c-plan">Offre</label><select id="c-plan" name="plan">
            ${Object.entries(PLANS).map(([k, v]) => `<option value="${k}" ${company.plan === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <button class="btn primary" type="submit" style="margin-top:16px">Enregistrer</button>
      </form></section>
    <section class="section" style="max-width:640px"><h2>Supprimer l'entreprise</h2>
      <p>L'entreprise, ses utilisateurs, ses projets et ses tâches sont effacés. On ne peut pas revenir en arrière.</p>
      <button class="btn danger solid" type="button" id="c-delete" style="margin-top:12px">Supprimer l'entreprise</button></section>` : ''}`;

  $('#company-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('PUT', '/api/company', Object.fromEntries(new FormData(e.target)));
      state.company = res.company;
      toast('Entreprise enregistrée');
      route();
    } catch (err) { toast(err.message, true); }
  });
  $('#c-delete')?.addEventListener('click', async () => {
    const typed = prompt(`Pour confirmer, saisissez l'identifiant de l'entreprise : ${company.slug}`);
    if (typed !== company.slug) { if (typed !== null) toast('Identifiant incorrect. Rien n\'a été supprimé.', true); return; }
    await api('DELETE', '/api/company');
    toast('Entreprise supprimée');
    if (isSuperAdmin()) location.hash = '#/platform';
    else logout();
  });
}

/* ---------- Démarrage ---------- */

// Bouton « Afficher / Masquer » des champs mot de passe (délégation : marche pour tous les formulaires)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pwd-toggle');
  if (!btn) return;
  const input = btn.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Masquer' : 'Afficher';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  input.focus();
});

window.addEventListener('hashchange', route);
route();
