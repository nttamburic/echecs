// Point d'entrée : navigation entre les modules, état du moteur et de la synchronisation.
import { $, $$ } from './core/ui.js';
import { detectBoost, onStatus, engineLabel } from './core/engine.js';
import { onSync, syncNow, cfg, state as syncState } from './core/sync.js';
import * as analyse from './modules/analyse.js';
import * as settings from './modules/settings.js';
import { soon } from './modules/soon.js';

const VIEWS = ['home', 'game', 'openings', 'middlegame', 'endgames', 'settings'];

export function showView(v) {
  for (const name of VIEWS) $(`#${name}-view`).classList.toggle('hidden', name !== v);
  const tab = v === 'home' || v === 'game' ? 'analyse' : v;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.body.dataset.view = v;
}

function route() {
  const h = location.hash || '#/';
  const m = /^#\/game\/(.+)$/.exec(h);
  if (!m) analyse.leave();
  if (m) { showView('game'); analyse.openGame(decodeURIComponent(m[1])); return; }
  if (h.startsWith('#/openings')) { showView('openings'); soon($('#openings-view'), 'openings'); return; }
  if (h.startsWith('#/middlegame')) { showView('middlegame'); soon($('#middlegame-view'), 'middlegame'); return; }
  if (h.startsWith('#/endgames')) { showView('endgames'); soon($('#endgames-view'), 'endgames'); return; }
  if (h.startsWith('#/settings')) { showView('settings'); settings.render($('#settings-view')); return; }
  showView('home');
  analyse.showHome();
}

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(t).toLocaleDateString('fr-FR');
}

function renderSyncStatus(st) {
  const el = $('#sync-status');
  if (!cfg.configured) { el.innerHTML = '<a href="#/settings">☁ synchronisation non configurée</a>'; return; }
  if (st.running) el.textContent = '☁ synchronisation…';
  else if (st.error) el.innerHTML = `<a href="#/settings" class="err" title="${st.error.replace(/"/g, '&quot;')}">☁ erreur de synchronisation</a>`;
  else el.textContent = st.lastSync ? `☁ synchronisé ${timeAgo(st.lastSync)}` : '☁ jamais synchronisé';
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  onStatus(() => { $('#engine').textContent = engineLabel(); });
  onSync(renderSyncStatus);
  setInterval(() => renderSyncStatus(syncState), 60000);
  await analyse.init();
  window.addEventListener('hashchange', route);
  route();
  detectBoost();
  if (cfg.configured) syncNow();
}

init();
