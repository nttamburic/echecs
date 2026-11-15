// Point d'entrée : navigation entre les modules, démarrage du moteur et de la synchronisation.
import { $, $$ } from './core/ui.js';
import { detectBoost } from './core/engine.js';
import { onSync, syncNow, cfg } from './core/sync.js';
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

// L'état du moteur et de la synchronisation est affiché dans les Réglages ; ici, seulement
// une pastille rouge sur l'onglet ⚙ si la synchronisation échoue.
function markSyncError(st) {
  const tab = $('#tabs a[data-tab="settings"]');
  tab.classList.toggle('alert', !!st.error);
  tab.title = st.error ? 'Erreur de synchronisation : ' + st.error : 'Réglages et synchronisation';
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  onSync(markSyncError);
  await analyse.init();
  window.addEventListener('hashchange', route);
  route();
  detectBoost();
  if (cfg.configured) syncNow();
}

init();
