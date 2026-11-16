// Point d'entrée : barre latérale, navigation entre les modules, démarrage du moteur et de la synchronisation.
import { $, $$ } from './core/ui.js';
import { detectBoost } from './core/engine.js';
import { onSync, syncNow, cfg } from './core/sync.js';
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
function openMenu() { document.body.classList.add('menu-open'); $('#menu-btn').setAttribute('aria-expanded', 'true'); }
function closeMenu() { document.body.classList.remove('menu-open'); $('#menu-btn').setAttribute('aria-expanded', 'false'); }

// L'état du moteur et de la synchronisation est affiché dans les Paramètres ; ici, seulement
// une pastille rouge sur « Paramètres » si la synchronisation échoue.
function markSyncError(st) {
  const tab = $('#sidebar a[data-tab="settings"]');
  tab.classList.toggle('alert', !!st.error);
  tab.title = st.error ? 'Erreur de synchronisation : ' + st.error : 'Paramètres';
  $('#menu-btn').classList.toggle('alert', !!st.error);
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  $('#menu-btn').onclick = () => (document.body.classList.contains('menu-open') ? closeMenu() : openMenu());
  $('#scrim').onclick = closeMenu;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  onSync(markSyncError);
  await analyse.init();
  play.init();
  window.addEventListener('hashchange', route);
  route();
  detectBoost();
  if (cfg.configured) syncNow();
}

init();
