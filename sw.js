// Service worker : permet d'installer l'appli et de l'ouvrir hors connexion.
// - code de l'appli : réseau d'abord (toujours la dernière version), cache si hors ligne ;
// - gros fichiers qui ne changent pas (moteur, pièces, ouvertures) : cache d'abord.
const VERSION = 'v2';
const CACHE = 'echecs-' + VERSION;
const SHELL = [
  './', 'index.html', 'style.css', 'main.js', 'manifest.webmanifest',
  'analysis.js', 'explain.js', 'board.js',
  'core/ui.js', 'core/engine.js', 'core/store.js', 'core/sync.js', 'core/chesscom.js', 'core/srs.js',
  'modules/analyse.js', 'modules/settings.js', 'modules/soon.js',
  'vendor/chess.js', 'vendor/stockfish/stockfish-19-lite-single.js', 'vendor/stockfish/stockfish-19-lite-single.wasm',
  'openings.json', 'icons/icon-192.png', 'icons/icon-512.png',
  ...['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((p) => `pieces/${c}${p}.svg`)),
];
const STATIC = /\/(vendor\/stockfish|pieces|icons|puzzles)\/|openings\.json$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('echecs-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))));
});
