// Module « Analyse » : liste des parties chess.com et analyse détaillée d'une partie.
import { Chess } from '../vendor/chess.js';
import { Board } from '../board.js';
import { classifyMove, classifyGame, summarize, CLASSES, SUMMARY_ORDER, fmtScore, winPct, epd } from '../analysis.js';
import { frSan, explainMove } from '../explain.js';
import { $, esc, fr1, uciOf, local, toast, badge } from '../core/ui.js';
import {
  analyzePosition, parallelism, SOURCE_LABEL, analysisSettings, maxTime, nLines, pcDepth, wasmDepth,
  PC_DEPTHS, WEB_DEPTHS, boostEnabled, detectBoost, status as engineStatus, onStatus as onEngineStatus,
  MAX_THREADS, wasmThreads,
} from '../core/engine.js';
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
// Débits mesurés sur le PC (Ryzen 5 5600X), en positions / s, ≈ 61 demi-coups par partie.
// Boost PC : 6 moteurs natifs. Lite : par moteur, tant qu'il y a un cœur physique par moteur ;
// au-delà, les moteurs en plus ne rapportent presque rien (≈ 10 % chacun).
const BOOST_RATE = { 16: 10.5, 18: 5.3, 20: 2.9, 22: 1.43, 24: 0.74 };
const LITE_RATE = { 12: 3, 14: 1.5, 16: 0.75, 18: 0.38, 20: 0.2 };
const PLIES_PER_GAME = 61;
function estRate({ boost, depth, movetime, threads }) {
  let rate, engines;
  if (boost) { engines = engineStatus.boost.engines || 6; rate = (BOOST_RATE[depth] || 0) * engines / 6; }
  else {
    const cores = Math.max(1, Math.round(MAX_THREADS / 2));
    engines = threads;
    rate = (LITE_RATE[depth] || 0) * (Math.min(threads, cores) + 0.1 * Math.max(0, threads - cores));
  }
  // Le temps maximum plafonne chaque recherche : au pire « movetime » par position et par moteur.
  if (rate && movetime) rate = Math.max(rate, engines / (movetime / 1000));
  return rate;
}
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
    : `Analyse multiple (${b.label}, profondeur ${b.depth}${b.movetime ? `, ${b.movetime / 1000} s max` : ''}) : ${b.done}/${b.total} terminées${c ? ` — en cours : ${c.game.white.name} – ${c.game.black.name} (${c.positions.filter(Boolean).length}/${c.moves.length} coups)` : ''}.`;
}

function fmtDuration(s) {
  if (s < 60) return 'moins d\'une minute';
  const t = Math.round(s / 60), h = Math.floor(t / 60), m = t % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

// Fenêtre de choix : période (menu déroulant) et réglages du moteur (les mêmes que la roue dentée).
async function openMultiDialog() {
  if (S.batch) { // le bouton sert alors à arrêter (la partie en cours garde ce qui est déjà analysé)
    S.batch.stop = true;
    if (S.batch.cur && S.batch.cur !== S.g) S.batch.cur.abort = true;
    renderBatch();
    return;
  }
  if (!S.games.length) return;
  const dlg = $('#multi-dlg');
  const todo = (p) => S.games.filter((x) => inPeriod(x, p) && needsAnalysis(x)).length;
  const total = (p) => S.games.filter((x) => inPeriod(x, p)).length;
  const sel = $('#multi-period');
  sel.innerHTML = PERIODS.map(([v, label]) => `<option value="${v}"${todo(v) ? '' : ' disabled'}>${label} (${todo(v) || 'aucune'})</option>`).join('');
  const prev = local.get('multiPeriod', 'all');
  const opts = [...sel.options];
  sel.value = (opts.find((o) => o.value === prev && !o.disabled) || opts.find((o) => !o.disabled) || opts[0]).value;
  const update = () => {
    const n = todo(sel.value), all = total(sel.value);
    $('#multi-count').textContent = n ? `${n} à analyser sur ${all}.` : all ? `Déjà toutes analysées (${all}).` : 'Aucune partie.';
    $('#multi-go').disabled = !n;
    const st = f.read();
    const rate = estRate(st);
    $('#multi-est').textContent = !n ? 'Rien à analyser pour cette période.'
      : rate ? `Durée estimée : environ ${fmtDuration(n * PLIES_PER_GAME / rate)} pour ${n} partie(s) (un peu moins grâce à l'analyse cloud Lichess${st.boost ? '' : ' ; dans le navigateur, l\'estimation est approximative'}).`
      : `${n} partie(s) à analyser.`;
  };
  const f = engineFields($('#multi-fields'), 'multi', update);
  sel.onchange = update;
  update();
  dlg.returnValue = '';
  dlg.showModal();
  dlg.querySelector('form').onsubmit = async (e) => {
    if (!e.submitter || e.submitter.value !== 'go' || !todo(sel.value)) return;
    local.set('multiPeriod', sel.value);
    await f.save(); // mêmes réglages que la roue dentée
    const st = analysisSettings();
    analyzeMany(sel.value, st.fixed ? null : st.depth, maxTime(), PERIODS.find((p) => p[0] === sel.value)[1].toLowerCase(), st.depth);
  };
}

async function analyzeMany(period, depth, movetime, label, shownDepth) {
  if (S.batch) return;
  if (S.loading) await S.loading;
  const queue = new Set(S.games.filter((x) => inPeriod(x, period) && needsAnalysis(x)).map((x) => x.id));
  if (!queue.size) return;
  const b = (S.batch = { stop: false, done: 0, total: queue.size, cur: null, failed: new Set(), label, depth: shownDepth, movetime });
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
      g.movetime = movetime;
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
// Mise en page façon chess.com : échiquier au centre, barre d'évaluation à gauche, panneau à droite.
// À l'ouverture, seule la liste des coups est affichée ; l'analyse ne démarre qu'avec le bouton « Analyser ».
// Une fois toute la partie analysée, le panneau passe en mode « Bilan » (coach, Suivant, coups annotés, graphique).
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

const isComplete = (g) => g.positions.every(Boolean);

export async function openGame(id) {
  stopAuto();
  if (S.g && S.g.id === id) { renderGame(); return; }
  if (S.g) S.g.abort = true;
  $('#moves').innerHTML = '<p class="muted pad">Chargement de la partie…</p>';
  let game = S.games.find((x) => x.id === id);
  const saved = await store.get('analysis', id).catch(() => null);
  if (!game && saved) game = saved.game;
  if (!game && S.loading) {
    $('#moves').innerHTML = '<p class="muted pad">Récupération des parties chess.com…</p>';
    await S.loading;
    game = S.games.find((x) => x.id === id);
  }
  if (!game) {
    $('#moves').innerHTML = '<p class="err pad">Partie inconnue sur cet appareil : récupérez d\'abord vos parties (Historique des parties → Actualiser).</p>';
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
    $('#moves').innerHTML = `<p class="err pad">PGN illisible : ${esc(e.message)}</p>`;
    return;
  }
  S.g = g;
  S.cycle = {};
  board.setOrientation(g.playerColor || 'w');
  renderGame(); // pas d'analyse automatique : bouton « Analyser »
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
  if (S.g === g) renderGame();
  const todo = [];
  g.positions.forEach((p, i) => { if (!p) todo.push(i); });
  const doOne = async (i, cloud, cloudOnly = false) => {
    const m = g.moves[i];
    const pos = await analyzePosition(m.before, uciOf(m), { cloud, cloudOnly, depth: g.depth || null, movetime: g.movetime || 0 });
    if (pos.miss) return pos;
    g.positions[i] = pos;
    recompute(g);
    if (S.g === g) renderFoot(g);
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

// Bouton « Analyser » / « Reprendre » : analyse avec les réglages de la roue dentée.
function startAnalysis() {
  const g = S.g;
  if (!g || g.analyzing) return;
  const st = analysisSettings();
  g.depth = st.fixed ? null : st.depth;
  g.movetime = maxTime();
  g.abort = false;
  runAnalysis(g);
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

function lineItems(fen, pv) {
  const items = [];
  let f = fen;
  for (const u of pv.slice(0, 12)) {
    const it = makeVarItem(f, u.slice(0, 2), u.slice(2, 4), u[4]);
    if (!it) break;
    items.push(it);
    f = it.fenAfter;
  }
  return items;
}

function onBoardMove(from, to, promo) {
  const g = S.g;
  if (!g) return;
  stopAuto();
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

// Joue une ligne (meilleure suite, ligne du moteur…) comme variante à partir de la position affichée.
function playLine(fen, pv) {
  const g = S.g;
  if (!g) return;
  stopAuto();
  const items = lineItems(fen, pv);
  if (!items.length) return;
  if (g.var) {
    g.var.items = g.var.items.slice(0, g.var.idx).concat(items);
    g.var.idx = g.var.idx + 1;
  } else g.var = { basePly: g.ply, items, idx: 1 };
  renderGame();
}

async function analyzeVarItem(g, item, idx) {
  if (item.pos || item.pending) return;
  item.pending = true;
  try {
    const st = analysisSettings();
    item.pos = await analyzePosition(item.fenBefore, item.uci, { cloud: true, priority: true, depth: st.fixed ? null : st.depth, movetime: maxTime() });
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

// Lecture automatique (bouton ▶ du panneau).
function atEnd(g) { return g.var ? g.var.idx >= g.var.items.length : g.ply >= g.moves.length; }
function stopAuto() { if (S.auto) { clearInterval(S.auto); S.auto = null; renderNav(); } }
function toggleAuto() {
  const g = S.g;
  if (!g) return;
  if (S.auto) return stopAuto();
  if (atEnd(g)) setPly(0);
  S.auto = setInterval(() => { if (!S.g || atEnd(S.g)) stopAuto(); else step(1); }, 1000);
  renderNav();
}
const nav = (f) => () => { stopAuto(); f(); };

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

// Notation en figurines (comme chess.com) : « Cf3 » → icône du cavalier + « f3 ».
function figSan(san, color) {
  const m = /^([NBRQK])(.*)$/.exec(san);
  if (!m) return esc(frSan(san));
  return `<img class="fig${color === 'b' ? ' dark' : ''}" src="pieces/w${m[1]}.svg" alt="${esc(frSan(m[1]))}">${esc(frSan(m[2]))}`;
}

// ------------------------------------------------------------------ rendu partie
function renderGame() {
  const g = S.g;
  if (!g) return;
  const review = isComplete(g);
  const fen = currentFen(g);
  const d = displayed(g);
  if (d && d.inVar && !d.pos && !d.pending) analyzeVarItem(g, g.var.items[d.varIdx], d.varIdx);
  const annotate = d && d.r && (review || d.inVar);

  // échiquier : case du coup coloriée et annotée (Brillant, Théorique, Gaffe…), flèche du meilleur coup
  const arrows = [];
  if (annotate && d.pos && !d.r.isBest && d.r.cls !== 'book' && d.pos.lines[0]) {
    const b = d.pos.lines[0].pv[0];
    arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4), color: '#4caf50' });
  }
  const nextPos = review && !g.var && g.ply < g.moves.length ? g.positions[g.ply] : null;
  if ($('#show-next').checked && nextPos && nextPos.lines[0]) {
    const b = nextPos.lines[0].pv[0];
    arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4), color: '#3b82f6', opacity: 0.6 });
  }
  const mark = annotate ? { sq: d.uci.slice(2, 4), color: CLASSES[d.r.cls].color, sym: CLASSES[d.r.cls].sym, label: CLASSES[d.r.cls].label } : null;
  board.setPosition(fen, { lastMove: d ? [d.uci.slice(0, 2), d.uci.slice(2, 4)] : null, arrows, mark });

  // barre d'évaluation (analyse de la partie, sinon analyse en direct de la position)
  const chess = new Chess(fen);
  let wp, label;
  if (chess.isCheckmate()) { wp = chess.turn() === 'w' ? 0 : 100; label = chess.turn() === 'w' ? '0-1' : '1-0'; }
  else if (chess.isDraw()) { wp = 50; label = '½-½'; }
  else {
    let s = review || d?.inVar ? scoreAfter(g) : null;
    if (!s && S.liveRes && S.liveRes.fen === fen && S.liveRes.res.lines[0]) s = S.liveRes.res.lines[0].score;
    wp = s ? winPct(s, 'w') : 50;
    label = s ? fmtScore(s) : '';
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
    return `<span class="avatar-sm ${c}"><img src="pieces/${c}P.svg" alt=""></span><b>${esc(p.name)}</b> <span class="muted">(${esc(p.rating)})</span>
      ${review ? `<span class="pill" title="Précision">${fr1(s.accuracy)} %</span>` : ''}`;
  };
  $('#player-top').innerHTML = pl(top);
  $('#player-bottom').innerHTML = pl(bot);

  // panneau
  $('#gpanel').classList.toggle('review', review);
  $('#ptitle').innerHTML = review ? `<span class="badge" style="background:${CLASSES.best.color}">★</span> Bilan` : 'Analyse';
  $('#cc-link').href = g.game.url || '#';
  const k = g.var ? g.var.basePly : g.ply;
  $('#opening').textContent = k === 0 && !g.var ? 'Position de départ' : (g.openingAt[k] || g.openingAt[g.openingAt.length - 1] || 'Ouverture inconnue');
  const date = new Date(g.game.end * 1000).toLocaleDateString('fr-FR');
  $('#game-meta').textContent = `${TIME_FR[g.game.timeClass] || ''} · ${date} · ${g.game.result || ''}`;

  renderEngine();
  renderLive(g);
  renderCoach(g, d, review);
  renderMoves(g, review);
  renderFoot(g);
  renderSummary(g, review);
  renderGraph(g, review);
  renderNav();
}

// Ligne « Analyse · profondeur 22 | Stockfish 19 ⚙ »
function renderEngine() {
  const el = $('#eng-desc');
  if (!engineStatus.checked) { el.textContent = 'recherche du moteur…'; return; }
  const st = analysisSettings();
  const t = maxTime();
  const thr = st.boost ? '' : ` · ${wasmThreads()} threads`;
  el.textContent = `profondeur ${st.depth}${t ? ` · ${t / 1000} s max` : ''} | ${st.name}${st.boost ? ' (PC)' : thr}`;
}

// Bas du panneau : bouton « Analyser », progression ou « Reprendre ».
function renderFoot(g) {
  if (S.g !== g) return;
  const done = g.positions.filter(Boolean).length;
  const total = g.moves.length;
  const review = isComplete(g);
  const prog = $('#progress');
  const btn = $('#analyze');
  $('#pfoot').classList.toggle('hidden', review && !g.analyzing);
  if (g.analyzing) {
    prog.classList.remove('hidden');
    btn.classList.add('hidden');
    prog.querySelector('.fill').style.width = (100 * done / Math.max(1, total)) + '%';
    const batch = S.batch && S.batch.cur === g;
    prog.querySelector('.txt').textContent = `${batch ? 'Analyse multiple' : 'Analyse'} : ${done}/${total} coups…`;
    $('#stop').classList.toggle('hidden', batch);
    // la partie bascule en « Bilan » dès qu'elle est complète
    if (review && !$('#gpanel').classList.contains('review')) renderGame();
    return;
  }
  prog.classList.add('hidden');
  btn.classList.remove('hidden');
  btn.textContent = done ? `Reprendre l'analyse (${done}/${total})` : 'Analyser';
  btn.disabled = !total;
}

// ----- analyse en direct (interrupteur « Analyse ») : meilleures lignes du moteur pour la position affichée
function liveKey(fen) { const st = analysisSettings(); return `${fen}|${st.boost}|${st.depth}|${maxTime()}|${nLines()}`; }

function renderLive(g) {
  const el = $('#lines');
  el.classList.toggle('hidden', !S.live);
  if (!S.live) return;
  const fen = currentFen(g);
  const c = new Chess(fen);
  if (c.isGameOver()) { el.innerHTML = `<div class="lrow muted">${c.isCheckmate() ? 'Échec et mat' : 'Partie nulle'}</div>`; return; }
  const key = liveKey(fen);
  if (S.liveRes && S.liveRes.key === key) { el.innerHTML = linesHtml(fen, S.liveRes.res); bindLines(el, fen, S.liveRes.res); return; }
  if (S.livePending === key) return; // calcul déjà en cours pour cette position
  S.livePending = key;
  el.innerHTML = '<div class="lrow muted">Calcul en cours…</div>';
  clearTimeout(S.liveTimer);
  S.liveTimer = setTimeout(async () => {
    if (S.livePending !== key) return;
    try {
      const st = analysisSettings();
      const res = await analyzePosition(fen, null, { cloud: true, priority: true, multipv: nLines(), depth: st.fixed ? null : st.depth, movetime: maxTime() });
      if (S.livePending !== key) return;
      S.livePending = null;
      if (res.miss) { el.innerHTML = '<div class="lrow muted">Pas d\'analyse disponible.</div>'; return; }
      S.liveRes = { key, fen, res };
      if (S.g === g) renderGame();
    } catch (e) {
      if (S.livePending === key) { S.livePending = null; el.innerHTML = `<div class="lrow err">Analyse impossible : ${esc(e.message)}</div>`; }
    }
  }, 200);
}

function linesHtml(fen, res) {
  const n = nLines();
  return res.lines.slice(0, n).map((l, i) => {
    const items = lineItems(fen, l.pv);
    let moves = '';
    items.slice(0, 10).forEach((it, j) => {
      const no = it.fenBefore.split(' ')[5];
      if (it.color === 'w') moves += `${no}. `;
      else if (j === 0) moves += `${no}… `;
      moves += figSan(it.san, it.color) + ' ';
    });
    const sc = l.score;
    const neg = sc.mate !== undefined ? sc.mate < 0 : sc.cp < 0;
    return `<div class="lrow" data-li="${i}" title="Cliquez pour jouer cette ligne sur l'échiquier"><span class="lscore${neg ? ' neg' : ''}">${fmtScore(sc)}</span><span class="lmoves">${moves}</span></div>`;
  }).join('') + `<div class="lfoot muted small">${esc(SOURCE_LABEL(res))}</div>`;
}

function bindLines(el, fen, res) {
  el.querySelectorAll('.lrow[data-li]').forEach((r) => { r.onclick = () => playLine(fen, res.lines[+r.dataset.li].pv); });
}

// ----- coach (bulle façon chess.com) : en mode Bilan, ou pendant une variante
function renderCoach(g, d, review) {
  const el = $('#coach');
  const show = review || !!g.var;
  el.classList.toggle('hidden', !show);
  $('#next-wrap').classList.toggle('hidden', !review);
  $('#suivant').disabled = atEnd(g);
  if (!show) { el.innerHTML = ''; return; }
  let html = '';
  if (g.var) {
    const items = g.var.items.map((it, i) => {
      const num = it.color === 'w' ? `${it.move.before.split(' ')[5]}. ` : (i === 0 ? `${it.move.before.split(' ')[5]}… ` : '');
      return `<span class="vmove${i === g.var.idx - 1 ? ' cur' : ''}" data-vi="${i + 1}">${num}${esc(frSan(it.san))}${it.r ? badge(it.r.cls, true) : ''}</span>`;
    }).join(' ');
    html += `<div class="variation"><div class="vhead">Variante <button id="exit-var" class="btn small">↩ Revenir à la partie</button></div><div class="vmoves">${items || '<span class="muted">Jouez un coup…</span>'}</div></div>`;
  }
  if (!d) {
    if (review) {
      const s = g.summary;
      const me = g.playerColor;
      const who = (c) => esc((c === 'w' ? g.game.white : g.game.black).name);
      html += `<div class="coach-title">Bilan de la partie</div>
        <p>Précision : <b>${who('w')}</b> ${fr1(s.w.accuracy)} % · <b>${who('b')}</b> ${fr1(s.b.accuracy)} %.</p>`;
      if (me) {
        const n = (cls) => s[me].counts[cls] || 0;
        const bad = ['blunder', 'mistake', 'miss', 'inaccuracy'].filter((c) => n(c)).map((c) => `${n(c)} ${CLASSES[c].label.toLowerCase()}${n(c) > 1 && !/s$/.test(CLASSES[c].label) ? 's' : ''}`);
        html += `<p>${bad.length ? `De votre côté : ${bad.join(', ')}.` : 'Aucune erreur de votre côté : bravo !'}</p>`;
      }
      html += '<p class="muted">Cliquez sur « Suivant » pour revoir la partie coup par coup.</p>';
    } else html += '<p class="muted">Jouez vos propres coups : Stockfish les note.</p>';
    el.innerHTML = coachWrap(html);
    bindCoach(g);
    return;
  }
  if (!d.pos || !d.r) {
    html += `<div class="coach-title">${esc(frSan(d.san))}</div><p class="muted">${d.pending || g.analyzing ? 'Analyse en cours…' : 'Pas encore analysé.'}</p>`;
    el.innerHTML = coachWrap(html);
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
  html += `<div class="coach-foot muted">${esc(SOURCE_LABEL(d.pos))}</div>`;
  el.innerHTML = coachWrap(html);
  bindCoach(g, d);
}

const coachWrap = (html) => `<div class="coach-wrap"><div class="avatar"><img src="pieces/wN.svg" alt=""></div><div class="bubble">${html}</div></div>`;

function bindCoach(g, d) {
  const ev = $('#exit-var');
  if (ev) ev.onclick = exitVar;
  document.querySelectorAll('.vmove').forEach((s) => { s.onclick = () => { stopAuto(); g.var.idx = +s.dataset.vi; renderGame(); }; });
  if (!d) return;
  document.querySelectorAll('[data-line]').forEach((b) => {
    b.onclick = () => {
      stopAuto();
      const pv = b.dataset.line === 'best' ? d.pos.lines[0].pv : d.pos.played.pv;
      if (d.inVar) {
        // remplace la suite de la variante à partir de ce coup
        const vi = d.varIdx;
        g.var.items = g.var.items.slice(0, vi).concat(lineItems(d.fenBefore, pv));
        g.var.idx = vi + 1;
        renderGame();
      } else {
        g.var = { basePly: g.ply - 1, items: lineItems(d.fenBefore, pv), idx: 1 };
        renderGame();
      }
    };
  });
}

// Liste des coups. En mode Bilan : icône de la classification (coups notables) et couleur.
const NOTABLE = ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'];
function renderMoves(g, review) {
  const el = $('#moves');
  // icône « théorie » seulement sur le dernier coup théorique de chaque camp
  const lastBook = { w: -1, b: -1 };
  if (review) g.results.forEach((r, i) => { if (r && r.cls === 'book') lastBook[g.moves[i].color] = i; });
  let html = '';
  for (let i = 0; i < g.moves.length; i += 2) {
    html += `<div class="mrow"><span class="mno">${i / 2 + 1}.</span>`;
    for (const j of [i, i + 1]) {
      const m = g.moves[j];
      if (!m) { html += '<span class="mv empty"></span>'; continue; }
      const r = review ? g.results[j] : null;
      const cur = !g.var && g.ply === j + 1 ? ' cur' : g.var && g.var.basePly === j + 1 ? ' base' : '';
      const icon = r && (NOTABLE.includes(r.cls) || (r.cls === 'book' && lastBook[m.color] === j));
      const col = r && NOTABLE.includes(r.cls) ? ` style="color:${CLASSES[r.cls].color}"` : '';
      html += `<span class="mv${cur}" data-ply="${j + 1}"${r ? ` title="${CLASSES[r.cls].label}"` : ''}><span class="ico">${icon ? badge(r.cls, true) : ''}</span><span class="san"${col}>${figSan(m.san, m.color)}</span></span>`;
    }
    html += '</div>';
  }
  el.innerHTML = html || '<p class="muted pad">Aucun coup joué.</p>';
  el.querySelectorAll('.mv[data-ply]').forEach((s) => { s.onclick = () => { stopAuto(); setPly(+s.dataset.ply); }; });
  const cur = el.querySelector('.mv.cur');
  if (cur) {
    const top = cur.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 30) el.scrollTop = top - el.clientHeight / 2;
  } else if (!g.var && g.ply === 0) el.scrollTop = 0;
}

function renderSummary(g, review) {
  $('#stats').classList.toggle('hidden', !review);
  if (!review) return;
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
      stopAuto();
      setPly(plies[S.cycle[key]]);
    };
  });
}

function renderGraph(g, review) {
  const el = $('#graph');
  const n = g.moves.length;
  el.classList.toggle('hidden', !review || !n);
  if (!review || !n) { el.innerHTML = ''; return; }
  const W = 600, H = 100;
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
  svg += `<rect width="${W}" height="${H}" fill="#403d39"/>`;
  if (pts.length > 1) {
    svg += `<path d="M0,${H} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0].toFixed(1)},${H} Z" fill="#fff"/>`;
  }
  svg += `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#888" stroke-width="0.6"/>`;
  g.results.forEach((r, i) => {
    if (!r || !['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(r.cls) || !pts[i + 1]) return;
    svg += `<circle cx="${pts[i + 1][0]}" cy="${pts[i + 1][1]}" r="4" fill="${CLASSES[r.cls].color}" stroke="#fff" stroke-width="1"/>`;
  });
  const cx = (g.var ? g.var.basePly : g.ply) / n * W;
  svg += `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#81b64c" stroke-width="2"/></svg>`;
  el.innerHTML = svg;
  el.onclick = (e) => {
    const rect = el.getBoundingClientRect();
    stopAuto();
    setPly(Math.round((e.clientX - rect.left) / rect.width * n));
  };
}

const PLAY_SVG = '<svg viewBox="0 0 24 24"><path class="fill" d="M8 5l11 7-11 7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path class="fill" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
function renderNav() {
  const b = $('#play');
  if (!b) return;
  const want = S.auto ? 'pause' : 'play';
  if (b.dataset.st !== want) { b.innerHTML = S.auto ? PAUSE_SVG : PLAY_SVG; b.dataset.st = want; }
}

// ----- roue dentée : moteur, profondeur, temps maximum, nombre de variantes
// Champs « moteur » partagés par la roue dentée et l'analyse multiple (préfixe p pour les id).
// onChange est appelé à chaque modification ; save() enregistre les réglages (mêmes clés pour les deux fenêtres).
function engineFields(root, p, onChange = () => {}) {
  root.innerHTML = `
    <div class="frow"><label for="${p}-choice">Moteur d'échecs</label><select id="${p}-choice">
      <option value="boost">Stockfish 19 (Boost PC)</option>
      <option value="lite">Stockfish 19 Lite (1,8 Mo)</option>
    </select></div>
    <p id="${p}-hint" class="muted small"></p>
    <div class="frow"><label for="${p}-depth">Profondeur</label><select id="${p}-depth"></select></div>
    <div class="frow"><label for="${p}-time">Temps maximum</label><select id="${p}-time">
      <option value="0">Sans limite</option><option value="1000">1 s</option><option value="2000">2 s</option><option value="3000">3 s</option>
      <option value="5000">5 s</option><option value="10000">10 s</option><option value="30000">30 s</option>
    </select></div>
    <div class="frow"><label for="${p}-lines">Nombre de variantes</label><select id="${p}-lines">
      <option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>
    </select></div>
    <div class="frow" id="${p}-threads-row"><label for="${p}-threads">Threads</label><input id="${p}-threads" type="number" min="1" step="1"></div>
    <p id="${p}-threads-hint" class="muted small"></p>`;
  const q = (id) => root.querySelector('#' + p + '-' + id);
  const choice = q('choice'), depthSel = q('depth'), thr = q('threads');
  choice.value = boostEnabled() ? 'boost' : 'lite';
  const fill = () => {
    const boost = choice.value === 'boost';
    const b = engineStatus.boost;
    const fixed = boost && b && !b.depthOption;
    const depths = fixed ? [b.depth] : boost ? PC_DEPTHS : WEB_DEPTHS;
    const cur = fixed ? b.depth : boost ? pcDepth() : wasmDepth();
    depthSel.innerHTML = depths.map((d) => `<option value="${d}">${d}</option>`).join('');
    depthSel.value = depths.includes(cur) ? cur : depths[Math.floor(depths.length / 2)];
    depthSel.disabled = fixed;
    q('hint').textContent = boost
      ? (b ? `Boost PC détecté : ${b.engine}, ${b.engines} moteurs en parallèle.${fixed ? ' Pour choisir la profondeur, fermez puis relancez « Lancer l\'analyseur.bat ».' : ''}`
        : 'Boost PC non détecté : lancez « Lancer l\'analyseur.bat » sur ce PC. En attendant, Stockfish 19 Lite (navigateur) est utilisé.')
      : 'Version allégée de Stockfish 19, directement dans le navigateur (aussi sur téléphone). Un peu moins forte et plus lente que le Boost PC.';
    const lite = !boost || !b;
    q('threads-row').classList.toggle('hidden', !lite);
    q('threads-hint').classList.toggle('hidden', !lite);
    q('threads-hint').textContent = `Nombre de moteurs Stockfish 19 Lite qui analysent en parallèle, un cœur chacun (1 à ${MAX_THREADS} sur cet appareil). Plus il y en a, plus l'analyse est rapide, mais plus l'appareil chauffe.`;
  };
  thr.max = MAX_THREADS;
  thr.value = wasmThreads();
  q('time').value = String(maxTime());
  q('lines').value = String(nLines());
  choice.onchange = () => { fill(); onChange(); };
  depthSel.onchange = q('time').onchange = q('lines').onchange = thr.oninput = () => onChange();
  fill();
  const threads = () => Math.min(MAX_THREADS, Math.max(1, Math.round(Number(thr.value)) || wasmThreads()));
  return {
    // Réglages tels qu'affichés (moteur réellement utilisé : Lite si le Boost PC n'est pas lancé).
    read: () => ({ boost: choice.value === 'boost' && !!engineStatus.boost, depth: Number(depthSel.value), movetime: Number(q('time').value), threads: threads() }),
    async save() {
      const boost = choice.value === 'boost';
      if (!depthSel.disabled) local.set(boost ? 'depthPc' : 'wasmDepth', depthSel.value);
      local.set('movetime', q('time').value === '0' ? '' : q('time').value);
      local.set('multipv', q('lines').value);
      local.set('threads', String(threads()));
      const changed = boost !== boostEnabled();
      local.set('boost', boost ? '1' : '0');
      S.liveRes = null; S.livePending = null;
      if (changed) {
        await detectBoost();
        if (boost && !engineStatus.boost) toast('Boost PC non trouvé : lancez « Lancer l\'analyseur.bat » sur ce PC. Stockfish 19 Lite (navigateur) est utilisé en attendant.', 6000);
      }
    },
  };
}

function openEngineDialog() {
  const dlg = $('#eng-dlg');
  const f = engineFields($('#eng-fields'), 'eng');
  dlg.returnValue = '';
  dlg.showModal();
  // « submit » (et non « close ») : déclenché tout de suite par le bouton Sauvegarder.
  dlg.querySelector('form').onsubmit = async (e) => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    await f.save();
    if (S.g) renderGame();
  };
}

// ------------------------------------------------------------------ navigation
export function leave() {
  stopAuto();
  if (!S.g) return;
  if (!S.batch || S.batch.cur !== S.g) S.g.abort = true; // la partie de l'analyse multiple continue
  S.g = null;
  S.livePending = null;
  renderBatch();
}
export function showHome() { renderList(); renderBatch(); }

export async function init() {
  board = new Board($('#board'), { onMove: onBoardMove });
  const profile = await store.get('settings', 'profile').catch(() => null);
  S.user = (profile && profile.chesscomUser) || local.get('user', '');
  S.live = local.get('liveEval', '0') === '1';
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
  $('#first').onclick = nav(() => setPly(0));
  $('#prev').onclick = nav(() => step(-1));
  $('#next').onclick = nav(() => step(1));
  $('#last').onclick = nav(() => { if (S.g) setPly(S.g.moves.length); });
  $('#play').onclick = toggleAuto;
  $('#suivant').onclick = nav(() => step(1));
  $('#flip').onclick = () => { board.flip(); renderGame(); };
  $('#show-next').onchange = () => renderGame();
  $('#analyze').onclick = startAnalysis;
  $('#stop').onclick = () => { if (S.g && S.g.analyzing) S.g.abort = true; };
  $('#eng-gear').onclick = openEngineDialog;
  $('#live').checked = S.live;
  $('#live').onchange = (e) => { S.live = e.target.checked; local.set('liveEval', S.live ? '1' : '0'); if (S.g) renderGame(); };
  $('#reanalyze').onclick = () => {
    const g = S.g;
    if (!g || g.analyzing || !confirm('Relancer l\'analyse complète de cette partie avec les réglages actuels ?')) return;
    g.positions = new Array(g.moves.length).fill(null);
    recompute(g);
    startAnalysis();
  };
  onEngineStatus(() => { if (S.g) { renderEngine(); renderLive(S.g); } });
  renderNav();
  document.addEventListener('keydown', (e) => {
    if (!S.g || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowLeft') { stopAuto(); step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { stopAuto(); step(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'Home') { stopAuto(); setPly(0); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'End') { stopAuto(); setPly(S.g.moves.length); e.preventDefault(); }
    else if (e.key === ' ') { toggleAuto(); e.preventDefault(); }
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
