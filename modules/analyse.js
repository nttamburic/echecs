// Module « Analyse » : liste des parties chess.com et analyse détaillée d'une partie.
import { Chess } from '../vendor/chess.js';
import { Board } from '../board.js';
import { classifyMove, classifyGame, summarize, CLASSES, SUMMARY_ORDER, fmtScore, winPct, epd } from '../analysis.js';
import { frSan, explainMove } from '../explain.js';
import { $, esc, fr1, uciOf, local, toast, badge } from '../core/ui.js';
import { analyzePosition, parallelism, SOURCE_LABEL, engineInfo } from '../core/engine.js';
import { syncNow, cfg as syncCfg } from '../core/sync.js';
import * as store from '../core/store.js';
import * as chesscom from '../core/chesscom.js';

const TIME_FR = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par jour' };
const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

// ------------------------------------------------------------------ état
export let BOOK = {};
const S = {
  user: '',
  games: [],
  index: {},
  shown: 100,
  g: null, // partie ouverte
  cycle: {},
  batch: null, // l'analyse multiple en cours : { stop, done, total, cur, failed }
};

export const getUser = () => S.user;
export const getGames = () => S.games;

// ------------------------------------------------------------------ accueil
function resultFor(game, user) {
  const me = game.white.name.toLowerCase() === user.toLowerCase() ? 'white' : 'black';
  const r = game[me].result;
  if (r === 'win') return { txt: 'Victoire', cls: 'win' };
  if (DRAWS.includes(r)) return { txt: 'Nulle', cls: 'draw' };
  return { txt: 'Défaite', cls: 'loss' };
}

async function setUser(user) {
  S.user = user;
  local.set('user', user);
  const cur = await store.get('settings', 'profile');
  if (!cur || cur.chesscomUser !== user) await store.put('settings', 'profile', { ...(cur || {}), chesscomUser: user }, { file: 'settings.json' });
}

// Pseudo choisi dans Paramètres → Profil chess.com : on enregistre puis on recharge les parties.
export async function changeUser(user) {
  user = (user || '').trim();
  if (!user || user === S.user) return;
  await setUser(user);
  showUser();
  S.loading = loadGames();
}

function showUser() {
  const has = !!S.user;
  $('#hist-user').textContent = has ? S.user : '';
  $('#hist-nouser').classList.toggle('hidden', has);
  $('#load').classList.toggle('hidden', !has);
  $('#clear-hist').classList.toggle('hidden', !has);
  $('#load-progress').classList.toggle('hidden', !has);
}

export async function loadGames() {
  const user = S.user;
  if (!user) return;
  S.games = [];
  S.shown = 100;
  const token = (S.loadToken = {}); // un nouveau chargement annule le précédent
  const prog = $('#load-progress');
  try {
    prog.textContent = 'Recherche du compte…';
    const months = await chesscom.archives(user);
    if (token !== S.loadToken) return;
    months.reverse(); // les plus récents d'abord
    let done = 0;
    for (const month of months) {
      const games = await chesscom.month(user, month);
      if (token !== S.loadToken) return;
      S.games.push(...games);
      done++;
      prog.textContent = `Récupération des parties : mois ${done}/${months.length} (${S.games.length} parties)`;
      if (done % 3 === 0 || done === months.length) renderList();
    }
    S.games.sort((a, b) => b.end - a.end);
    prog.textContent = `${S.games.length} parties terminées récupérées (${months.length} mois depuis la création du compte).`;
  } catch (e) {
    if (token === S.loadToken) prog.textContent = 'Erreur : ' + e.message;
  } finally {
    if (token === S.loadToken) { await backfillOpenings(); renderList(); renderBatch(); }
  }
}

function renderList() {
  const q = $('#filter').value.trim().toLowerCase();
  const tc = $('#tc').value;
  const op = $('#op').value;
  renderOpeningFilter();
  const list = S.games.filter((g) => {
    if (tc && g.timeClass !== tc) return false;
    if (op) {
      const name = S.index[g.id] && S.index[g.id].opening;
      if (!name || (op[0] === 'f' ? family(name) !== op.slice(2) : name !== op.slice(2))) return false;
    }
    if (q) {
      const opp = (g.white.name.toLowerCase() === S.user.toLowerCase() ? g.black.name : g.white.name).toLowerCase();
      if (!opp.includes(q)) return false;
    }
    return true;
  });
  const rows = list.slice(0, S.shown).map((g) => {
    const meWhite = g.white.name.toLowerCase() === S.user.toLowerCase();
    const opp = meWhite ? g.black : g.white;
    const me = meWhite ? g.white : g.black;
    const res = resultFor(g, S.user);
    const a = S.index[g.id];
    let acc = '';
    if (a) {
      const myAcc = meWhite ? a.accW : a.accB;
      acc = a.complete ? `<span class="acc">${fr1(myAcc)} %</span>` : '<span class="acc partial">en partie</span>';
    }
    const d = new Date(g.end * 1000);
    return `<tr data-id="${esc(g.id)}">
      <td>${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
      <td class="opt">${TIME_FR[g.timeClass] || esc(g.timeClass)}</td>
      <td><span class="color-dot ${meWhite ? 'w' : 'b'}"></span>${esc(me.rating)}</td>
      <td class="opp">${esc(opp.name)} <span class="muted">(${esc(opp.rating)})</span></td>
      <td class="${res.cls}">${res.txt}</td>
      <td>${acc}</td></tr>`;
  }).join('');
  $('#games tbody').innerHTML = rows || `<tr><td colspan="6" class="muted">${S.games.length ? 'Aucune partie ne correspond.' : 'Aucune partie pour le moment.'}</td></tr>`;
  $('#more').classList.toggle('hidden', list.length <= S.shown);
  $('#count').textContent = S.games.length ? `${list.length} partie(s)` : '';
  renderBatch();
}

async function loadIndex() {
  const rows = await store.all('analysisIndex').catch(() => []);
  S.index = {};
  for (const r of rows) S.index[r.id] = r.data;
}

// ----- ouvertures jouées (enregistrées avec chaque analyse)
const family = (name) => name.split(':')[0].trim();

// Liste déroulante : une entrée par famille (« Italian Game »), suivie de ses variantes.
function renderOpeningFilter() {
  const sel = $('#op');
  const fams = new Map();
  for (const g of S.games) {
    const name = S.index[g.id] && S.index[g.id].opening;
    if (!name) continue;
    const f = family(name);
    if (!fams.has(f)) fams.set(f, { n: 0, vars: new Map() });
    const e = fams.get(f);
    e.n++;
    if (name !== f) e.vars.set(name, (e.vars.get(name) || 0) + 1);
  }
  let html = '<option value="">Toutes ouvertures</option>';
  for (const [f, e] of [...fams].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) {
    html += `<option value="f:${esc(f)}">${esc(f)} (${e.n})</option>`;
    for (const [v, n] of [...e.vars].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      html += `<option value="v:${esc(v)}">   ${esc(v.slice(f.length + 1).trim())} (${n})</option>`;
    }
  }
  if (sel.dataset.html === html) return;
  const cur = sel.value;
  sel.innerHTML = html;
  sel.dataset.html = html;
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
}

// Dernière position de la partie connue de la théorie → nom de l'ouverture (sans code ECO).
function openingOfMoves(moves) {
  let name = null;
  for (const m of moves) { const o = BOOK[epd(m.after)]; if (o && o.length) name = o[1]; }
  return name;
}

// Analyses faites avant que l'ouverture soit mémorisée : on la complète à partir du PGN.
async function backfillOpenings() {
  if (!Object.keys(BOOK).length) return;
  let changed = false;
  for (const game of S.games) {
    const a = S.index[game.id];
    if (!a || a.opening !== undefined) continue;
    let name = null;
    try { const c = new Chess(); c.loadPgn(game.pgn); name = openingOfMoves(c.history({ verbose: true })); } catch { /* PGN illisible */ }
    const summary = { ...a, opening: name };
    S.index[game.id] = summary;
    await store.put('analysisIndex', game.id, summary, { file: 'analyses/index.json' }).catch(() => {});
    changed = true;
  }
  if (changed && !S.g) renderList();
}

// ----- « Analyse multiple » : analyse une par une les parties pas encore (complètement) analysées,
// sur toute la période ou sur les N derniers jours, à la profondeur choisie dans la fenêtre.
// Les résultats sont enregistrés comme une analyse normale, donc synchronisés sur GitHub.
// Pause quand on ouvre une autre partie, reprise au retour à la liste.
const needsAnalysis = (game) => !S.index[game.id] || !S.index[game.id].complete;
const PERIODS = [['all', 'Toutes les parties'], ['15', '15 derniers jours'], ['30', '30 derniers jours'], ['60', '60 derniers jours'], ['90', '90 derniers jours']];
const inPeriod = (game, period) => period === 'all' || game.end * 1000 >= Date.now() - Number(period) * 86400000;
// Débit mesuré sur le Boost PC avec 6 moteurs (positions / s, profondeur 16 extrapolée) ; ≈ 61 demi-coups par partie.
const BOOST_RATE = { 16: 10.5, 18: 5.3, 20: 2.9, 22: 1.43, 24: 0.74 };
const PLIES_PER_GAME = 61;

function renderBatch() {
  const b = S.batch;
  const btn = $('#multi');
  btn.textContent = b ? 'Arrêter l\'analyse' : 'Analyse multiple';
  btn.disabled = !b && !S.games.length;
  btn.title = b ? 'Arrêter l\'analyse multiple (ce qui est déjà analysé est conservé)' : S.games.length ? 'Analyser plusieurs parties d\'un coup' : 'Récupérez d\'abord vos parties (Actualiser)';
  const el = $('#batch-progress');
  el.classList.toggle('hidden', !b);
  if (!b) return;
  const c = b.cur;
  el.textContent = S.g && S.g !== c
    ? `Analyse multiple en pause pendant que vous consultez une partie (${b.done}/${b.total} terminées).`
    : `Analyse multiple (${b.label}, profondeur ${b.depth}) : ${b.done}/${b.total} terminées${c ? ` — en cours : ${c.game.white.name} – ${c.game.black.name} (${c.positions.filter(Boolean).length}/${c.moves.length} coups)` : ''}.`;
}

function fmtDuration(s) {
  if (s < 60) return 'moins d\'une minute';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

// Fenêtre de choix : période, moteur et profondeur.
async function openMultiDialog() {
  if (S.batch) { // le bouton sert alors à arrêter (la partie en cours garde ce qui est déjà analysé)
    S.batch.stop = true;
    if (S.batch.cur && S.batch.cur !== S.g) S.batch.cur.abort = true;
    renderBatch();
    return;
  }
  if (!S.games.length) return;
  const dlg = $('#multi-dlg');
  const eng = engineInfo();
  const todo = (p) => S.games.filter((x) => inPeriod(x, p) && needsAnalysis(x)).length;
  const prevPeriod = local.get('multiPeriod', 'all');
  $('#multi-periods').innerHTML = PERIODS.map(([v, label]) => {
    const n = todo(v), all = S.games.filter((x) => inPeriod(x, v)).length;
    return `<label class="choice${n ? '' : ' off'}"><input type="radio" name="period" value="${v}"${n ? '' : ' disabled'}>
      <span>${label}</span><span class="muted">${n ? `${n} à analyser sur ${all}` : all ? `déjà analysées (${all})` : 'aucune partie'}</span></label>`;
  }).join('');
  const radios = [...dlg.querySelectorAll('input[name=period]')];
  (radios.find((r) => r.value === prevPeriod && !r.disabled) || radios.find((r) => !r.disabled) || {}).checked = true;
  $('#multi-engine').textContent = eng.label;
  const sel = $('#multi-depth');
  const prevDepth = Number(local.get(eng.boost ? 'multiDepthPc' : 'multiDepthWeb', eng.def));
  sel.innerHTML = eng.depths.map((d) => `<option value="${d}">${d}${d === eng.def ? ' (recommandé)' : ''}</option>`).join('');
  sel.value = eng.depths.includes(prevDepth) ? prevDepth : eng.def;
  sel.disabled = eng.fixed;
  $('#multi-fixed').classList.toggle('hidden', !eng.fixed);
  const update = () => {
    const r = radios.find((x) => x.checked);
    const n = r ? todo(r.value) : 0;
    $('#multi-go').disabled = !n;
    const rate = eng.boost && BOOST_RATE[sel.value] ? BOOST_RATE[sel.value] * eng.engines / 6 : 0;
    $('#multi-est').textContent = !n ? 'Rien à analyser pour cette période.'
      : rate ? `Durée estimée : environ ${fmtDuration(n * PLIES_PER_GAME / rate)} pour ${n} partie(s) (un peu moins grâce à l'analyse cloud Lichess).`
      : `${n} partie(s) à analyser. Dans le navigateur, comptez nettement plus longtemps qu'avec le Boost PC.`;
  };
  radios.forEach((r) => { r.onchange = update; });
  sel.onchange = update;
  update();
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue !== 'go') return;
    const r = radios.find((x) => x.checked);
    if (!r) return;
    const depth = Number(sel.value);
    local.set('multiPeriod', r.value);
    local.set(eng.boost ? 'multiDepthPc' : 'multiDepthWeb', String(depth));
    analyzeMany(r.value, eng.fixed ? null : depth, PERIODS.find((p) => p[0] === r.value)[1].toLowerCase(), depth);
  };
}

async function analyzeMany(period, depth, label, shownDepth) {
  if (S.batch) return;
  if (S.loading) await S.loading;
  const queue = new Set(S.games.filter((x) => inPeriod(x, period) && needsAnalysis(x)).map((x) => x.id));
  if (!queue.size) return;
  const b = (S.batch = { stop: false, done: 0, total: queue.size, cur: null, failed: new Set(), label, depth: shownDepth });
  renderBatch();
  try {
    while (!b.stop) {
      while (S.g && !b.stop) await new Promise((r) => setTimeout(r, 1000)); // pause pendant la consultation d'une partie
      if (b.stop) break;
      const game = S.games.find((x) => queue.has(x.id) && needsAnalysis(x) && !b.failed.has(x.id));
      if (!game) break;
      const saved = await store.get('analysis', game.id).catch(() => null);
      let g;
      try { g = prepareGame(game.id, game, saved); } catch { b.failed.add(game.id); continue; }
      g.depth = depth;
      b.cur = g;
      g.onProgress = renderBatch;
      renderBatch();
      await runAnalysis(g);
      b.cur = null;
      if (g.positions.every(Boolean)) b.done++;
      else if (!g.abort) b.failed.add(game.id); // échec : on passe à la suivante
      if (!S.g) renderList();
      renderBatch();
    }
  } finally {
    if (S.batch === b) S.batch = null;
    renderBatch();
    if (!S.g) renderList();
  }
}

// ----- « Effacer l'historique » : vide la liste et supprime toutes les analyses, sur cet appareil
// et sur GitHub (donc aussi sur les autres appareils à leur prochaine synchronisation).
async function clearHistory() {
  const n = Object.keys(S.index).length;
  const ok = confirm(`Effacer l'historique ?\n\n`
    + `• La liste des parties est vidée (cliquez ensuite sur « Actualiser » pour la récupérer à nouveau depuis chess.com).\n`
    + `• ${n ? `Les ${n} analyse(s) enregistrée(s) sont supprimées` : 'Toutes les analyses enregistrées sont supprimées'} de cet appareil ET de votre dépôt GitHub, donc aussi de vos autres appareils.\n\n`
    + `Cette action est définitive.`);
  if (!ok) return;
  const btn = $('#clear-hist');
  btn.disabled = true;
  try {
    if (S.batch) { S.batch.stop = true; if (S.batch.cur) { S.batch.cur.abort = true; S.batch.cur.discard = true; } }
    S.loadToken = {}; // annule un chargement en cours
    S.loading = null;
    S.games = [];
    S.index = {};
    await store.removeAll('analysis');
    await store.removeAll('analysisIndex');
    await store.cacheClear().catch(() => {});
    $('#load-progress').textContent = 'Historique effacé. Cliquez sur « Actualiser » pour récupérer à nouveau vos parties.';
    renderList();
    if (syncCfg.configured) {
      toast('Historique effacé. Suppression sur GitHub en cours…');
      toast(await syncNow() ? 'Historique effacé, aussi sur GitHub.' : 'Historique effacé sur cet appareil. La suppression sur GitHub sera refaite à la prochaine synchronisation.', 5000);
    } else toast('Historique effacé.');
  } catch (e) {
    toast('Effacement impossible : ' + esc(e.message), 6000);
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ partie
let board;

function fenAt(g, k) { return k === 0 ? g.startFen : g.moves[k - 1].after; }

function computeOpenings(g) {
  g.openingAt = [];
  let cur = null;
  for (let k = 0; k <= g.moves.length; k++) {
    const o = BOOK[epd(fenAt(g, k))];
    if (o && o.length) cur = o[1]; // nom seul, sans le code ECO
    g.openingAt.push(cur);
  }
}

function recompute(g) {
  g.results = classifyGame(g.moves, g.positions, g.ratings, BOOK);
  g.summary = summarize(g.moves, g.results);
}

export async function openGame(id) {
  if (S.g && S.g.id === id) { renderGame(); return; }
  if (S.g) S.g.abort = true;
  $('#coach').innerHTML = '<p class="muted">Chargement de la partie…</p>';
  let game = S.games.find((x) => x.id === id);
  const saved = await store.get('analysis', id).catch(() => null);
  if (!game && saved) game = saved.game;
  if (!game && S.loading) {
    $('#coach').innerHTML = '<p class="muted">Récupération des parties chess.com…</p>';
    await S.loading;
    game = S.games.find((x) => x.id === id);
  }
  if (!game) {
    $('#coach').innerHTML = '<p class="err">Partie inconnue sur cet appareil : récupérez d\'abord vos parties (onglet Analyse).</p>';
    return;
  }
  // Partie justement en cours d'analyse par l'analyse multiple : on l'affiche telle quelle.
  if (S.batch && S.batch.cur && S.batch.cur.id === id) {
    const g = S.batch.cur;
    S.g = g;
    S.cycle = {};
    g.ply = 0; g.var = null;
    board.setOrientation(g.playerColor || 'w');
    renderGame();
    return;
  }
  if (S.batch && S.batch.cur) S.batch.cur.abort = true; // l'analyse multiple se met en pause
  let g;
  try { g = prepareGame(id, game, saved); } catch (e) {
    $('#coach').innerHTML = `<p class="err">PGN illisible : ${esc(e.message)}</p>`;
    return;
  }
  S.g = g;
  S.cycle = {};
  board.setOrientation(g.playerColor || 'w');
  renderGame();
  if (g.positions.some((p) => !p)) runAnalysis(g);
}

function prepareGame(id, game, saved) {
  const c = new Chess();
  c.loadPgn(game.pgn);
  const moves = c.history({ verbose: true });
  const userLow = (S.user || '').toLowerCase();
  const playerColor = game.white.name.toLowerCase() === userLow ? 'w' : game.black.name.toLowerCase() === userLow ? 'b' : null;
  const g = {
    id, game, moves,
    startFen: moves.length ? moves[0].before : c.fen(),
    positions: saved && saved.positions && saved.positions.length === moves.length ? saved.positions : new Array(moves.length).fill(null),
    ply: 0, var: null, analyzing: false, abort: false, playerColor,
    ratings: { w: game.white.rating, b: game.black.rating },
  };
  computeOpenings(g);
  recompute(g);
  return g;
}

async function saveAnalysis(g) {
  if (g.discard) return; // historique effacé pendant l'analyse
  const s = g.summary;
  const analyzed = g.positions.filter(Boolean).length;
  const summary = {
    accW: s.w.accuracy, accB: s.b.accuracy,
    complete: analyzed === g.moves.length, analyzed, total: g.moves.length, date: Date.now(),
    month: g.game.month, end: g.game.end, white: g.game.white.name, black: g.game.black.name,
    opening: g.openingAt[g.openingAt.length - 1] || null, // ouverture jouée (nom, sans code ECO)
  };
  const month = g.game.month || new Date(g.game.end * 1000).toISOString().slice(0, 7);
  try {
    await store.put('analysis', g.id, { version: 1, game: g.game, positions: g.positions, summary }, { file: `analyses/${month}.json` });
    await store.put('analysisIndex', g.id, summary, { file: 'analyses/index.json' });
    S.index[g.id] = summary;
  } catch (e) { toast('Sauvegarde impossible : ' + esc(e.message)); }
}

async function runAnalysis(g) {
  if (g.analyzing) return;
  g.analyzing = true;
  let sinceSave = 0;
  if (S.g === g) renderProgress(g);
  const todo = [];
  g.positions.forEach((p, i) => { if (!p) todo.push(i); });
  const doOne = async (i, cloud, cloudOnly = false) => {
    const m = g.moves[i];
    const pos = await analyzePosition(m.before, uciOf(m), { cloud, cloudOnly, depth: g.depth || null });
    if (pos.miss) return pos;
    g.positions[i] = pos;
    recompute(g);
    if (S.g === g) renderGame();
    if (g.onProgress) g.onProgress();
    if (++sinceSave >= 12) { sinceSave = 0; saveAnalysis(g); }
    return pos;
  };
  try {
    // 1) Positions connues : analyse cloud Lichess, une requête à la fois, jusqu'à 2 positions inconnues de suite.
    let misses = 0;
    const later = [];
    while (todo.length && misses < 2 && !g.abort) {
      const i = todo.shift();
      const pos = await doOne(i, true, true);
      if (pos.miss) { misses++; later.push(i); } else misses = 0;
    }
    todo.unshift(...later);
    // 2) Le reste : Stockfish, plusieurs coups en parallèle (un moteur par cœur).
    const workers = Array.from({ length: parallelism() }, async () => {
      while (todo.length && !g.abort) await doOne(todo.shift(), false);
    });
    await Promise.all(workers);
  } catch (e) {
    toast('Erreur pendant l\'analyse : ' + esc(e.message), 6000);
  } finally {
    g.analyzing = false;
    await saveAnalysis(g);
    if (S.g === g) renderGame();
  }
}

// ----- variantes (coups joués par l'utilisateur sur l'échiquier)
function currentFen(g) {
  if (g.var) return g.var.idx > 0 ? g.var.items[g.var.idx - 1].fenAfter : fenAt(g, g.var.basePly);
  return fenAt(g, g.ply);
}

function makeVarItem(fenBefore, from, to, promotion) {
  const c = new Chess(fenBefore);
  let m;
  try { m = c.move({ from, to, promotion }); } catch { return null; }
  return { fenBefore, fenAfter: c.fen(), uci: uciOf(m), san: m.san, color: m.color, move: m, pos: null, r: null, pending: false };
}

function onBoardMove(from, to, promo) {
  const g = S.g;
  if (!g) return;
  const fen = currentFen(g);
  const item = makeVarItem(fen, from, to, promo);
  if (!item) return;
  if (!g.var && g.ply < g.moves.length && uciOf(g.moves[g.ply]) === item.uci) { setPly(g.ply + 1); return; }
  if (g.var && g.var.idx < g.var.items.length && g.var.items[g.var.idx].uci === item.uci) { g.var.idx++; renderGame(); return; }
  if (!g.var) g.var = { basePly: g.ply, items: [], idx: 0 };
  g.var.items = g.var.items.slice(0, g.var.idx);
  g.var.items.push(item);
  g.var.idx = g.var.items.length;
  renderGame();
}

function showLine(basePly, fen, pv) {
  const g = S.g;
  const items = [];
  let f = fen;
  for (const u of pv.slice(0, 12)) {
    const it = makeVarItem(f, u.slice(0, 2), u.slice(2, 4), u[4]);
    if (!it) break;
    items.push(it);
    f = it.fenAfter;
  }
  g.var = { basePly, items, idx: 1 };
  renderGame();
}

async function analyzeVarItem(g, item, idx) {
  if (item.pos || item.pending) return;
  item.pending = true;
  try {
    item.pos = await analyzePosition(item.fenBefore, item.uci, { cloud: true, priority: true });
    const prevMove = idx > 0 ? g.var.items[idx - 1].move : g.moves[g.var.basePly - 1] || null;
    item.r = classifyMove({
      fenBefore: item.fenBefore, fenAfter: item.fenAfter, uci: item.uci, color: item.color,
      rating: g.ratings[item.color], pos: item.pos, prevMove, book: BOOK,
      nLegal: new Chess(item.fenBefore).moves().length,
    });
  } catch (e) { toast('Analyse impossible : ' + esc(e.message)); }
  item.pending = false;
  if (S.g === g) renderGame();
}

function exitVar() { const g = S.g; if (!g || !g.var) return; g.ply = g.var.basePly; g.var = null; renderGame(); }

function setPly(k) {
  const g = S.g;
  if (!g) return;
  g.var = null;
  g.ply = Math.max(0, Math.min(g.moves.length, k));
  renderGame();
}

function step(d) {
  const g = S.g;
  if (!g) return;
  if (g.var) {
    const n = g.var.idx + d;
    if (n < 0) return exitVar();
    if (n > g.var.items.length) return;
    g.var.idx = n;
    return renderGame();
  }
  setPly(g.ply + d);
}

// ----- élément affiché : { fenBefore, san, uci, color, pos, r, inVar }
function displayed(g) {
  if (g.var) {
    if (g.var.idx === 0) return null;
    const it = g.var.items[g.var.idx - 1];
    return { ...it, inVar: true, varIdx: g.var.idx - 1 };
  }
  if (g.ply === 0) return null;
  const m = g.moves[g.ply - 1];
  return { fenBefore: m.before, fenAfter: m.after, san: m.san, uci: uciOf(m), color: m.color, pos: g.positions[g.ply - 1], r: g.results[g.ply - 1], move: m };
}

function scoreAfter(g) {
  const d = displayed(g);
  if (d) return d.pos && d.pos.played ? d.pos.played.score : null;
  const k = g.var ? g.var.basePly : 0;
  if (k === 0) return g.positions[0] ? g.positions[0].lines[0].score : null;
  const p = g.positions[k - 1];
  return p && p.played ? p.played.score : null;
}

// ------------------------------------------------------------------ rendu partie
function renderGame() {
  const g = S.g;
  if (!g) return;
  const fen = currentFen(g);
  const d = displayed(g);
  if (d && d.inVar && !d.pos && !d.pending) analyzeVarItem(g, g.var.items[d.varIdx], d.varIdx);

  // échiquier + flèches
  const arrows = [];
  if (d && d.pos && d.r && !d.r.isBest && d.r.cls !== 'book' && d.pos.lines[0]) {
    const b = d.pos.lines[0].pv[0];
    arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4), color: '#4caf50' });
  }
  const nextPos = !g.var && g.ply < g.moves.length ? g.positions[g.ply] : null;
  if ($('#show-next').checked && nextPos && nextPos.lines[0]) {
    const b = nextPos.lines[0].pv[0];
    arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4), color: '#3b82f6', opacity: 0.6 });
  }
  board.setPosition(fen, { lastMove: d ? [d.uci.slice(0, 2), d.uci.slice(2, 4)] : null, arrows });

  // barre d'évaluation
  const chess = new Chess(fen);
  let wp, label;
  if (chess.isCheckmate()) { wp = chess.turn() === 'w' ? 0 : 100; label = chess.turn() === 'w' ? '0-1' : '1-0'; }
  else if (chess.isDraw()) { wp = 50; label = '½-½'; }
  else {
    const s = scoreAfter(g);
    wp = s ? winPct(s, 'w') : 50;
    label = s ? fmtScore(s) : '…';
  }
  const flipped = board.orientation === 'b';
  $('#evalbar').classList.toggle('flipped', flipped);
  $('#evalbar .white').style.height = wp + '%';
  $('#evalbar .label').textContent = label;
  $('#evalbar .label').className = 'label ' + (wp >= 50 ? 'on-white' : 'on-black');

  // joueurs
  const top = flipped ? 'w' : 'b';
  const bot = flipped ? 'b' : 'w';
  const pl = (c) => {
    const p = c === 'w' ? g.game.white : g.game.black;
    const s = g.summary[c];
    return `<span class="color-dot ${c}"></span><b>${esc(p.name)}</b> <span class="muted">(${esc(p.rating)})</span>
      <span class="pill">Précision ${fr1(s.accuracy)} %</span>`;
  };
  $('#player-top').innerHTML = pl(top);
  $('#player-bottom').innerHTML = pl(bot);

  // en-tête
  const k = g.var ? g.var.basePly : g.ply;
  const op = g.openingAt[k] || g.openingAt[g.openingAt.length - 1];
  $('#opening').textContent = op ? op : 'Ouverture inconnue';
  const date = new Date(g.game.end * 1000).toLocaleDateString('fr-FR');
  $('#game-meta').innerHTML = `${TIME_FR[g.game.timeClass] || ''} · ${date} · ${esc(g.game.result)} · <a href="${esc(g.game.url)}" target="_blank" rel="noopener">voir sur chess.com</a>`;

  renderProgress(g);
  renderCoach(g, d);
  renderMoves(g);
  renderSummary(g);
  renderGraph(g);
}

function renderProgress(g) {
  const done = g.positions.filter(Boolean).length;
  const total = g.moves.length;
  const el = $('#progress');
  if (done >= total) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.querySelector('.fill').style.width = (100 * done / Math.max(1, total)) + '%';
  el.querySelector('.txt').textContent = g.analyzing ? `Analyse Stockfish : ${done}/${total} coups…` : `Analyse incomplète (${done}/${total})`;
  $('#resume').classList.toggle('hidden', g.analyzing);
}

function renderCoach(g, d) {
  const el = $('#coach');
  let html = '';
  if (g.var) {
    const items = g.var.items.map((it, i) => {
      const num = it.color === 'w' ? `${it.move.before.split(' ')[5]}. ` : (i === 0 ? `${it.move.before.split(' ')[5]}… ` : '');
      return `<span class="vmove${i === g.var.idx - 1 ? ' cur' : ''}" data-vi="${i + 1}">${num}${esc(frSan(it.san))}${it.r ? badge(it.r.cls, true) : ''}</span>`;
    }).join(' ');
    html += `<div class="variation"><div class="vhead">Variante <button id="exit-var" class="btn small">↩ Revenir à la partie</button></div><div class="vmoves">${items || '<span class="muted">Jouez un coup…</span>'}</div></div>`;
  }
  if (!d) {
    const nextPos = !g.var && g.positions[0];
    html += `<div class="coach-title">Position de départ</div><p class="muted">Utilisez les flèches ← → (ou les boutons ◀ ▶), cliquez sur un coup, ou jouez vos propres coups sur l'échiquier : Stockfish les notera.</p>`;
    if (nextPos) html += `<p>Évaluation : ${fmtScore(nextPos.lines[0].score)}</p>`;
    el.innerHTML = html;
    bindCoach(g);
    return;
  }
  if (!d.pos || !d.r) {
    html += `<div class="coach-title">${esc(frSan(d.san))}</div><p class="muted">${d.pending || g.analyzing ? 'Analyse en cours…' : 'Pas encore analysé.'}</p>`;
    el.innerHTML = html;
    bindCoach(g);
    return;
  }
  const ex = explainMove({ fenBefore: d.fenBefore, san: d.san, uci: d.uci, color: d.color, r: d.r, pos: d.pos, openingName: g.openingAt[g.ply], playerColor: g.playerColor });
  html += `<div class="coach-title">${badge(d.r.cls)} <span>${esc(ex.title)}</span><span class="score">${fmtScore(d.pos.played.score)}</span></div>`;
  html += ex.paras.map((p) => `<p>${esc(p)}</p>`).join('');
  if (ex.refutation && ex.refutation.items.length > 1) {
    html += `<div class="line bad"><div class="lhead">Après ce coup <button class="btn small" data-line="played">▶ Voir</button></div>${esc(ex.refutation.text)}</div>`;
  }
  if (ex.best) {
    html += `<div class="line good"><div class="lhead">${ex.best.isPlayed ? 'Suite prévue' : 'Meilleure suite'} <button class="btn small" data-line="${ex.best.isPlayed ? 'played' : 'best'}">▶ Voir</button></div>${esc(ex.best.text)}</div>`;
  }
  html += `<div class="coach-foot"><span class="muted">${esc(SOURCE_LABEL(d.pos))}</span></div>`;
  el.innerHTML = html;
  bindCoach(g, d);
}

function bindCoach(g, d) {
  const ev = $('#exit-var');
  if (ev) ev.onclick = exitVar;
  document.querySelectorAll('.vmove').forEach((s) => { s.onclick = () => { g.var.idx = +s.dataset.vi; renderGame(); }; });
  if (!d) return;
  const base = d.inVar ? null : g.ply - 1;
  document.querySelectorAll('[data-line]').forEach((b) => {
    b.onclick = () => {
      const pv = b.dataset.line === 'best' ? d.pos.lines[0].pv : d.pos.played.pv;
      if (d.inVar) {
        // remplace la suite de la variante à partir de ce coup
        const vi = d.varIdx;
        const before = g.var.items.slice(0, vi);
        let f = d.fenBefore;
        const items = [];
        for (const u of pv.slice(0, 12)) { const it = makeVarItem(f, u.slice(0, 2), u.slice(2, 4), u[4]); if (!it) break; items.push(it); f = it.fenAfter; }
        g.var.items = before.concat(items);
        g.var.idx = vi + 1;
        renderGame();
      } else showLine(base, d.fenBefore, pv);
    };
  });
}

function renderMoves(g) {
  const el = $('#moves');
  let html = '';
  for (let i = 0; i < g.moves.length; i += 2) {
    html += `<div class="mrow"><span class="mno">${i / 2 + 1}.</span>`;
    for (const j of [i, i + 1]) {
      const m = g.moves[j];
      if (!m) { html += '<span class="mv empty"></span>'; continue; }
      const r = g.results[j];
      const cur = !g.var && g.ply === j + 1 ? ' cur' : g.var && g.var.basePly === j + 1 ? ' base' : '';
      const col = r && ['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(r.cls) ? ` style="color:${CLASSES[r.cls].color}"` : '';
      html += `<span class="mv${cur}" data-ply="${j + 1}"><span${col}>${esc(frSan(m.san))}</span>${r ? badge(r.cls, true) : ''}</span>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.mv[data-ply]').forEach((s) => { s.onclick = () => setPly(+s.dataset.ply); });
  const cur = el.querySelector('.mv.cur');
  if (cur) {
    const top = cur.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 30) el.scrollTop = top - el.clientHeight / 2;
  }
}

function renderSummary(g) {
  const el = $('#summary');
  const s = g.summary;
  const name = (c) => esc((c === 'w' ? g.game.white : g.game.black).name);
  let html = `<table><thead><tr><th></th><th><span class="color-dot w"></span>${name('w')}</th><th><span class="color-dot b"></span>${name('b')}</th></tr></thead><tbody>`;
  html += `<tr class="acc-row"><td>Précision</td><td>${fr1(s.w.accuracy)} %</td><td>${fr1(s.b.accuracy)} %</td></tr>`;
  for (const cls of SUMMARY_ORDER) {
    const c = CLASSES[cls];
    const cell = (col) => {
      const n = s[col].counts[cls] || 0;
      return `<td>${n ? `<a class="jump" data-c="${col}" data-cls="${cls}" style="color:${c.color}">${n}</a>` : '<span class="muted">0</span>'}</td>`;
    };
    html += `<tr><td>${badge(cls, true)} ${c.label}</td>${cell('w')}${cell('b')}</tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;
  el.querySelectorAll('a.jump').forEach((a) => {
    a.onclick = () => {
      const col = a.dataset.c, cls = a.dataset.cls;
      const plies = [];
      g.results.forEach((r, i) => { if (r && r.cls === cls && g.moves[i].color === col) plies.push(i + 1); });
      if (!plies.length) return;
      const key = col + cls;
      S.cycle[key] = ((S.cycle[key] ?? -1) + 1) % plies.length;
      setPly(plies[S.cycle[key]]);
    };
  });
}

function renderGraph(g) {
  const el = $('#graph');
  const n = g.moves.length;
  if (!n) { el.innerHTML = ''; return; }
  const W = 600, H = 80;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    let s = null;
    if (k === 0) s = g.positions[0] && g.positions[0].lines[0].score;
    else { const p = g.positions[k - 1]; s = p && p.played ? p.played.score : null; }
    if (s == null) break;
    let w = winPct(s, 'w');
    const ch = k === n ? new Chess(fenAt(g, k)) : null;
    if (ch && ch.isCheckmate()) w = ch.turn() === 'w' ? 0 : 100;
    pts.push([k / n * W, H - w / 100 * H]);
  }
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<rect width="${W}" height="${H}" fill="#3a3835"/>`;
  if (pts.length > 1) {
    svg += `<path d="M0,${H} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0].toFixed(1)},${H} Z" fill="#e8e6e1"/>`;
  }
  svg += `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#888" stroke-width="0.5" stroke-dasharray="3,3"/>`;
  g.results.forEach((r, i) => {
    if (!r || !['mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(r.cls) || !pts[i + 1]) return;
    svg += `<circle cx="${pts[i + 1][0]}" cy="${pts[i + 1][1]}" r="3.5" fill="${CLASSES[r.cls].color}" stroke="#222" stroke-width="0.8"/>`;
  });
  const cx = (g.var ? g.var.basePly : g.ply) / n * W;
  svg += `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#f0a020" stroke-width="1.5"/></svg>`;
  el.innerHTML = svg;
  el.onclick = (e) => {
    const rect = el.getBoundingClientRect();
    setPly(Math.round((e.clientX - rect.left) / rect.width * n));
  };
}

// ------------------------------------------------------------------ navigation
export function leave() {
  if (!S.g) return;
  if (!S.batch || S.batch.cur !== S.g) S.g.abort = true; // la partie de l'analyse multiple continue
  S.g = null;
  renderBatch();
}
export function showHome() { renderList(); renderBatch(); }

export async function init() {
  board = new Board($('#board'), { onMove: onBoardMove });
  const profile = await store.get('settings', 'profile').catch(() => null);
  S.user = (profile && profile.chesscomUser) || local.get('user', '');
  showUser();
  $('#load').onclick = () => { S.loading = loadGames(); };
  $('#filter').oninput = () => { S.shown = 100; renderList(); };
  $('#tc').onchange = renderList;
  $('#op').onchange = () => { S.shown = 100; renderList(); };
  $('#multi').onclick = openMultiDialog;
  $('#clear-hist').onclick = clearHistory;
  $('#more').onclick = () => { S.shown += 200; renderList(); };
  $('#games tbody').onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = '#/game/' + encodeURIComponent(tr.dataset.id);
  };
  $('#back').onclick = () => { location.hash = '#/games'; };
  $('#first').onclick = () => setPly(0);
  $('#prev').onclick = () => step(-1);
  $('#next').onclick = () => step(1);
  $('#last').onclick = () => setPly(S.g ? S.g.moves.length : 0);
  $('#flip').onclick = () => { board.flip(); renderGame(); };
  $('#show-next').onchange = () => renderGame();
  $('#resume').onclick = () => S.g && runAnalysis(S.g);
  $('#reanalyze').onclick = async () => {
    const g = S.g;
    if (!g || g.analyzing || !confirm('Relancer l\'analyse complète de cette partie ?')) return;
    g.positions = new Array(g.moves.length).fill(null);
    recompute(g);
    renderGame();
    runAnalysis(g);
  };
  document.addEventListener('keydown', (e) => {
    if (!S.g || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'Home') { setPly(0); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'End') { setPly(S.g.moves.length); e.preventDefault(); }
    else if (e.key === 'Escape') exitVar();
    else if (e.key === 'f') { board.flip(); renderGame(); }
  });

  // Données arrivées d'un autre appareil (synchronisation) : on rafraîchit la liste.
  store.onChange(async (info) => {
    if (!info.remote) return;
    if (info.col === 'analysisIndex') { await loadIndex(); await backfillOpenings(); if (!S.g) { renderList(); renderBatch(); } }
    if (info.col === 'settings') {
      const p = await store.get('settings', 'profile');
      if (p && p.chesscomUser && !S.user) { S.user = p.chesscomUser; showUser(); loadGames(); }
    }
  });

  try { BOOK = await (await fetch('openings.json')).json(); } catch { BOOK = {}; }
  await loadIndex();
  if (S.user) S.loading = loadGames();
}
