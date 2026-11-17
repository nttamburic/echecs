// Point d'entrée : barre latérale, navigation entre les modules, démarrage du moteur et de la synchronisation.
import { $, $$, esc, toast } from './core/ui.js';
import { applyBoardPrefs } from './board.js';
import { detectBoost } from './core/engine.js';
import { onSync, syncNow, cfg, resolveConflict, loadConflicts, state as syncState } from './core/sync.js';
import { fmtAgo } from './core/format.js';
import * as analyse from './modules/analyse.js';
import * as settings from './modules/settings.js';
import { soon } from './modules/soon.js';
import * as play from './modules/play.js';
import * as setup from './modules/setup.js';
import * as openingsUi from './modules/openings-ui.js';
import * as train from './modules/openings-train.js';

const VIEWS = ['home', 'game', 'play', 'free', 'setup', 'openings', 'rep', 'train', 'puzzles', 'strategy', 'endgames', 'settings'];
const MODULES = ['puzzles', 'strategy', 'endgames']; // modules pas encore livrés

export function showView(v, tab = v === 'home' || v === 'game' ? 'games' : v === 'setup' ? 'free' : v) {
  for (const name of VIEWS) $(`#${name}-view`).classList.toggle('hidden', name !== v);
  $$('#sidebar nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.body.dataset.view = v;
  closeMenu();
  window.scrollTo(0, 0);
}

function route() {
  const h = location.hash || '#/games';
  const m = /^#\/game\/(.+)$/.exec(h);
  if (!m) analyse.leave();
  if (!/^#\/openings\/./.test(h) || /^#\/openings\/train/.test(h)) openingsUi.leaveRepertoire();
  if (!/^#\/openings\/train/.test(h)) train.leave();
  if (m) { showView('game'); analyse.openGame(decodeURIComponent(m[1])); return; }
  const [, name, sub] = /^#\/([^/]*)\/?(.*)$/.exec(h) || [];
  if (name === 'play') { showView('play'); play.show(); return; }
  if (name === 'free') {
    if (sub === 'new') { showView('game', 'free'); analyse.openFree(); return; }
    if (sub === 'setup') { showView('setup'); setup.renderEditor($('#setup-view')); return; }
    showView('free'); setup.renderHome($('#free-view')); return;
  }
  if (name === 'openings') {
    if (sub.startsWith('train')) {
      const [, mode, id] = sub.split('/');
      showView('train', 'openings'); train.start($('#train-view'), mode, id && decodeURIComponent(id)); return;
    }
    if (sub) { showView('rep', 'openings'); openingsUi.openRepertoire($('#rep-view'), decodeURIComponent(sub)); return; }
    showView('openings'); openingsUi.renderHome($('#openings-view')); return;
  }
  if (MODULES.includes(name)) { showView(name); soon($(`#${name}-view`), name); return; }
  if (name === 'settings') { showView('settings'); settings.render($('#settings-view'), sub); return; }
  if (name !== 'games') { history.replaceState(null, '', '#/games'); }
  showView('home');
  analyse.showHome();
}

// ---- menu latéral sur téléphone (tiroir) ----
function openMenu() {
  document.body.classList.add('menu-open'); $('#menu-btn').setAttribute('aria-expanded', 'true');
  setTimeout(() => { const a = $('#sidebar nav a.active') || $('#sidebar nav a'); if (a) a.focus(); }, 0);
}
function closeMenu() {
  const was = document.body.classList.contains('menu-open');
  document.body.classList.remove('menu-open'); $('#menu-btn').setAttribute('aria-expanded', 'false');
  if (was && $('#sidebar').contains(document.activeElement)) $('#menu-btn').focus();
}

// ---- état de la synchronisation dans la navigation ----
// Pastille sur « Paramètres » (et sur le bouton du menu en mobile) : en cours (anneau), erreur (rouge),
// conflit (orange), hors ligne (gris). Le texte de l'état est dans le titre et le nom accessible.
let lastErr = null, lastConflicts = 0;
function markSync(st) {
  const kind = st.conflicts.length ? 'conflict' : st.running ? 'running' : st.error ? (st.offline ? 'offline' : 'error') : '';
  const label = { conflict: 'conflit à résoudre', running: 'synchronisation en cours', error: 'erreur de synchronisation : ' + st.error, offline: 'hors ligne, synchronisation en attente' }[kind];
  const tab = $('#sidebar a[data-tab="settings"]');
  for (const el of [tab, $('#menu-btn')]) { if (kind) el.dataset.sync = kind; else delete el.dataset.sync; }
  tab.title = label ? 'Paramètres (' + label + ')' : 'Paramètres';
  tab.setAttribute('aria-label', tab.title);
  $('#menu-btn').setAttribute('aria-label', label ? 'Menu (' + label + ')' : 'Menu');
  // Erreur réelle (pas simplement hors ligne) : un toast une seule fois par message.
  if (st.error && !st.offline && st.error !== lastErr) toast('Synchronisation impossible : ' + esc(st.error), { type: 'err', action: { label: 'Voir', fn: () => { location.hash = '#/settings/connection'; } } });
  lastErr = st.error;
  if (st.conflicts.length > lastConflicts) toast(st.conflicts.length > 1 ? `${st.conflicts.length} répertoires modifiés sur deux appareils.` : 'Un répertoire a été modifié sur deux appareils.', { type: 'info', ms: 12000, action: { label: 'Résoudre', fn: openConflicts } });
  lastConflicts = st.conflicts.length;
}

// ---- conflits (répertoires seulement) ----
const countEdges = (d) => (d && d.edges ? d.edges.length : 0);
function openConflicts() {
  const list = syncState.conflicts;
  if (!list.length) return;
  const dlg = $('#conflict-dlg');
  $('#cf-list').innerHTML = list.map((c, i) => {
    const key = (e) => e.fenBefore + '|' + e.uci;
    const L = new Set((c.local.edges || []).map(key)), R = new Set((c.remote.edges || []).map(key));
    const onlyL = [...L].filter((k) => !R.has(k)).length, onlyR = [...R].filter((k) => !L.has(k)).length;
    return `<fieldset class="cf-item"><legend>${esc(c.local.name || 'Répertoire')}</legend>
      <p class="muted small">Cet appareil : ${countEdges(c.local)} coups, modifié ${esc(fmtAgo(new Date(c.localAt)))} (${onlyL} que l’autre n’a pas).<br>
      Autre appareil : ${countEdges(c.remote)} coups, modifié ${esc(fmtAgo(new Date(c.remoteAt)))} (${onlyR} que celui-ci n’a pas).</p>
      <div class="seg" role="radiogroup" aria-label="Que garder pour ${esc(c.local.name || 'ce répertoire')} ?">
        ${[['merge', 'Fusionner'], ['local', 'Cet appareil'], ['remote', 'L’autre appareil']].map(([v, t], j) =>
          `<label><input type="radio" name="cf${i}" value="${v}"${j === 0 ? ' checked' : ''}><span>${t}</span></label>`).join('')}
      </div></fieldset>`;
  }).join('');
  const apply = async (all) => {
    const picks = list.map((c, i) => [c.key, all || ($(`input[name="cf${i}"]:checked`, dlg) || {}).value || 'merge']);
    dlg.close();
    for (const [k, ch] of picks) await resolveConflict(k, ch);
    toast(picks.length > 1 ? 'Conflits résolus.' : 'Conflit résolu.');
    syncNow();
    if (/^#\/openings/.test(location.hash)) route();
  };
  $('#cf-merge').onclick = () => apply('merge');
  $('#cf-apply').onclick = () => apply(null);
  dlg.showModal();
}

// ---- hors ligne ----
function markOnline() {
  const off = navigator.onLine === false;
  const b = $('#offline');
  const was = !b.hidden;
  b.hidden = !off;
  if (off) syncState.offline = true;
  else if (was) { toast('Connexion rétablie.', { type: 'info' }); if (cfg.configured) syncNow(); }
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  $('#menu-btn').onclick = () => (document.body.classList.contains('menu-open') ? closeMenu() : openMenu());
  $('#scrim').onclick = closeMenu;
  applyBoardPrefs();
  $('#skip').onclick = (e) => { e.preventDefault(); $('#content').focus(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  onSync(markSync);
  window.addEventListener('online', markOnline); window.addEventListener('offline', markOnline);
  window.addEventListener('cj:conflicts', openConflicts);
  markOnline();
  loadConflicts();
  await analyse.init();
  play.init();
  window.addEventListener('hashchange', route);
  route();
  detectBoost();
  if (cfg.configured) syncNow();
}

init();
