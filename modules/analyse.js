// Module « Analyse » : liste des parties chess.com et analyse détaillée d'une partie.
import { initSheet } from '../core/sheet.js';
import { fmtGameDate, fmtPct } from '../core/format.js';
import { Chess } from '../vendor/chess.js';
import { Board } from '../board.js';
import { classifyMove, classifyGame, summarize, CLASSES, SUMMARY_ORDER, fmtScore, winPct, epd } from '../analysis.js';
import { frSan, explainMove } from '../explain.js';
import { frOpening } from './opening-names.js';
import { $, esc, fr1, uciOf, local, toast, badge, keyActivate } from '../core/ui.js';
import {
  analyzePosition, parallelism, SOURCE_LABEL, analysisSettings, maxTime, nLines, pcDepth, wasmDepth,
  PC_DEPTHS, WEB_DEPTHS, boostEnabled, detectBoost, status as engineStatus, onStatus as onEngineStatus,
  MAX_THREADS, wasmThreads,
} from '../core/engine.js';
import { syncNow, cfg as syncCfg } from '../core/sync.js';
import * as store from '../core/store.js';
import * as chesscom from '../core/chesscom.js';
import { scanGames, setBook } from './openings.js';

const TIME_FR = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par jour' };
const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

// ------------------------------------------------------------------ état
export let BOOK = {};
const S = {
  user: '',
  games: [],
  index: {},
  shown: 100,
  tc: '', // puce de cadence active
  err: '', // dernière erreur de chargement
  busy: false, // chargement des parties en cours
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
  const HOW = { resigned: 'abandon', checkmated: 'mat', timeout: 'temps', abandoned: 'abandon', agreed: 'accord', repetition: 'répétition', stalemate: 'pat', insufficient: 'matériel', timevsinsufficient: 'matériel', '50move': '50 coups' };
  const other = game[me === 'white' ? 'black' : 'white'].result;
  if (r === 'win') return { txt: 'Victoire', sym: '+', how: HOW[other] || '', cls: 'win' };
  if (DRAWS.includes(r)) return { txt: 'Nulle', sym: '=', how: HOW[r] || '', cls: 'draw' };
  return { txt: 'Défaite', sym: '−', how: HOW[r] || '', cls: 'loss' };
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
  $('#hist-user').textContent = has ? ' · ' + S.user : '';
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
  S.err = '';
  S.busy = true;
  renderList();
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
    if (token === S.loadToken) { S.err = e.message || 'Erreur inconnue'; prog.textContent = ''; }
  } finally {
    if (token === S.loadToken) {
      S.busy = false;
      await backfillOpenings(); renderList(); renderBatch();
      scanGames(S.games, user); // situations du module Ouvertures tirées des parties récentes
    }
  }
}

function setTc(v) {
  S.tc = v;
  document.querySelectorAll('#tc .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.tc === v)));
}

function renderList() {
  const q = $('#filter').value.trim().toLowerCase();
  const tc = S.tc;
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
      acc = a.complete ? `<span class="acc">${fmtPct(myAcc, 1)}</span>` : '<span class="acc partial">en cours</span>';
    }
    const when = fmtGameDate(g.end * 1000);
    const tcl = TIME_FR[g.timeClass] || esc(g.timeClass);
    const label = `${when}, ${tcl}, contre ${opp.name} (${opp.rating}), ${res.txt}${a && a.complete ? `, précision ${fmtPct(meWhite ? a.accW : a.accB, 1)}` : ''}. Ouvrir la partie.`;
    return `<tr role="row" class="grow" data-id="${esc(g.id)}" tabindex="0" aria-label="${esc(label)}">
      <td role="cell" class="c-date">${when}</td>
      <td role="cell" class="c-tc">${tcl}</td>
      <td role="cell" class="c-me"><img class="cdot" src="pieces/${meWhite ? 'wK' : 'bK'}.svg" alt="${meWhite ? 'Blancs' : 'Noirs'}" width="20" height="20">${esc(me.rating)}</td>
      <td role="cell" class="c-opp opp">${esc(opp.name)} <span class="muted">(${esc(opp.rating)})</span></td>
      <td role="cell" class="c-res"><span class="rpill ${res.cls}"><span aria-hidden="true">${res.sym}</span> ${res.txt}</span>${res.how ? ` <span class="muted small rhow">${res.how}</span>` : ''}</td>
      <td role="cell" class="c-acc">${acc}</td></tr>`;
  });
  let html = rows.join('');
  const st = $('#hist-state');
  let state = '';
  if (!S.games.length) {
    if (S.err) state = `<div role="alert" class="hs err"><strong>Impossible de récupérer les parties.</strong><span class="muted">${esc(S.err)}</span><button class="btn" id="hs-retry">Réessayer</button></div>`;
    else if (S.busy) html = Array.from({ length: 6 }, () => '<tr role="row" class="skel" aria-hidden="true"><td role="cell" colspan="6"><span></span></td></tr>').join('');
    else if (S.user) state = '<div class="hs"><strong>Aucune partie pour le moment.</strong><span class="muted">Récupérez vos parties terminées depuis chess.com.</span><button class="btn primary" id="hs-load">Actualiser</button></div>';
  } else if (!list.length) {
    state = '<div class="hs"><strong>Aucune partie ne correspond.</strong><span class="muted">Essayez d\'élargir les filtres.</span><button class="btn" id="hs-reset">Réinitialiser les filtres</button></div>';
  }
  $('#games tbody').innerHTML = html;
  $('#games').setAttribute('aria-busy', S.busy ? 'true' : 'false');
  st.innerHTML = state;
  st.classList.toggle('hidden', !state);
  const bind = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  bind('#hs-retry', () => { S.loading = loadGames(); });
  bind('#hs-load', () => { S.loading = loadGames(); });
  bind('#hs-reset', () => { $('#filter').value = ''; $('#op').value = ''; setTc(''); S.shown = 100; renderList(); });
  $('#more').classList.toggle('hidden', list.length <= S.shown);
  $('#count').textContent = S.games.length ? `${list.length} partie${list.length > 1 ? 's' : ''}` : '';
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
    html += `<option value="f:${esc(f)}">${esc(frOpening(f))} (${e.n})</option>`;
    for (const [v, n] of [...e.vars].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      html += `<option value="v:${esc(v)}">   ${esc(frOpening(v).slice(frOpening(f).length).replace(/^\s*:\s*/, '').trim())} (${n})</option>`;
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
function renderBatch() {
  const b = S.batch;
  const btn = $('#multi');
  btn.textContent = b ? 'Arrêter l\'analyse' : 'Analyse multiple';
  btn.disabled = !b && !S.games.length;
  btn.title = b ? 'Arrêter l\'analyse multiple (ce qui est déjà analysé est conservé)' : S.games.length ? 'Analyser plusieurs parties d\'un coup' : 'Récupérez d\'abord vos parties (Actualiser)';
  const el = $('#batch-progress');
  el.classList.toggle('hidden', !b);
  if (!b) return;
  el.dataset.paused = b.paused ? '1' : '';
  const c = b.cur;
  const paused = b.paused || (S.g && S.g !== c);
  const eta = b.done >= 1 ? Math.max(1, Math.round(((Date.now() - b.t0) / b.done) * (b.total - b.done) / 60000)) : 0;
  const me = (S.user || '').toLowerCase();
  const opp = c ? (c.game.white.name.toLowerCase() === me ? c.game.black.name : c.game.white.name) : '';
  const detail = b.paused ? 'en pause — touchez « Reprendre » pour continuer'
    : paused ? 'en pause pendant que vous consultez une partie'
    : `${c ? `en cours : contre ${opp}, coup ${c.positions.filter(Boolean).length}` : 'préparation…'}${eta ? ` · reste ≈ ${eta} min` : ''}`;
  el.title = `${b.label}, profondeur ${b.depth}${b.movetime ? `, ${b.movetime / 1000} s max` : ''}`;
  el.innerHTML = `<span class="bs-spin" aria-hidden="true"></span><span class="bs-main"><span class="bs-line"><strong>Analyse multiple · ${b.done} / ${b.total} parties</strong> <span class="muted bs-detail">— ${esc(detail)}</span></span>
    <span class="bs-bar" aria-hidden="true"><span style="width:${(100 * b.done / Math.max(1, b.total)).toFixed(1)}%"></span></span></span><button type="button" id="batch-pause" class="btn small" aria-pressed="${!!b.paused}">${b.paused ? 'Reprendre' : 'Pause'}</button><button type="button" id="batch-stop" class="btn small">Arrêter</button>`;
  $('#batch-pause').onclick = () => {
    b.paused = !b.paused;
    // en pause, la partie en cours s'arrête là (ce qui est analysé est conservé) ; à la reprise elle repart de ces coups
    if (b.paused && b.cur) b.cur.abort = true;
    renderBatch();
  };
  $('#batch-stop').onclick = openMultiDialog;
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
  };
  const f = engineFields($('#multi-fields'), 'multi');
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
  const b = (S.batch = { stop: false, done: 0, total: queue.size, cur: null, failed: new Set(), label, depth: shownDepth, movetime, t0: Date.now() });
  renderBatch();
  try {
    while (!b.stop) {
      while ((S.g || b.paused) && !b.stop) await new Promise((r) => setTimeout(r, b.paused ? 300 : 1000)); // pause demandée, ou consultation d'une partie
      if (b.stop) break;
      const game = S.games.find((x) => queue.has(x.id) && needsAnalysis(x) && !b.failed.has(x.id));
      if (!game) break;
      const saved = await store.get('analysis', game.id).catch(() => null);
      let g;
      try { g = prepareGame(game.id, game, saved); } catch { b.failed.add(game.id); continue; }
      if (b.paused || b.stop) continue; // pause ou arrêt demandés pendant la lecture de la partie
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

const isComplete = (g) => g.free || g.positions.every(Boolean);

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

// ----- « Analyse libre » : position de départ ou position définie, coups joués librement (jamais sauvegardés).
// Réutilise toute la vue partie : roue dentée, lignes du moteur, coach, classification, variantes.
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let freeStash = null;
// Prépare la prochaine analyse libre (position, coups déjà joués, orientation), ouverte par la route #/free/new.
export function stashFree(x) { freeStash = x; }
export function openFree() {
  stopAuto();
  const { fen = START_FEN, ucis = [], orient = null } = freeStash || {};
  freeStash = null;
  if (S.g) S.g.abort = true;
  if (S.batch && S.batch.cur) S.batch.cur.abort = true;
  const c = new Chess(fen);
  for (const u of ucis) { try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; } }
  const moves = c.history({ verbose: true });
  const g = {
    id: 'free', free: true, custom: fen !== START_FEN,
    game: { white: { name: 'Blancs', rating: '' }, black: { name: 'Noirs', rating: '' }, end: Date.now() / 1000 },
    moves, startFen: fen, positions: new Array(moves.length).fill(null),
    ply: moves.length, var: null, analyzing: false, abort: false, playerColor: null,
    ratings: { w: 1500, b: 1500 },
  };
  computeOpenings(g);
  recompute(g);
  S.g = g;
  S.cycle = {};
  board.setOrientation(orient || fen.split(' ')[1]);
  renderGame();
  if (moves.length) startAnalysis(); // partie importée (module Jouer) : analyse complète
}

// Analyse libre : analyse un coup ajouté à la ligne principale.
async function analyzeFreeMove(g, i) {
  const m = g.moves[i];
  try {
    const st = analysisSettings();
    const pos = await analyzePosition(m.before, uciOf(m), { cloud: true, priority: true, depth: st.fixed ? null : st.depth, movetime: maxTime() });
    if (g.moves[i] !== m || pos.miss) return;
    g.positions[i] = pos;
    recompute(g);
  } catch (e) { toast('Analyse impossible : ' + esc(e.message)); }
  if (S.g === g) renderGame();
}

async function saveAnalysis(g) {
  if (g.discard || g.free) return; // historique effacé pendant l'analyse / analyse libre (jamais sauvegardée)
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
  if (g.free && !g.var && g.ply === g.moves.length) {
    const c = new Chess(fen);
    const m = c.move({ from, to, promotion: promo });
    g.moves.push(m);
    g.positions.push(null);
    computeOpenings(g);
    recompute(g);
    g.ply = g.moves.length;
    renderGame();
    analyzeFreeMove(g, g.moves.length - 1);
    return;
  }
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

// « Suivant » : saute au coup clé suivant (Bilan), sinon à la fin ; en variante ou analyse libre, un coup.
function nextKey() {
  const g = S.g;
  if (!g) return;
  if (g.var || g.free || !isComplete(g)) return step(1);
  for (let j = g.ply; j < g.moves.length; j++) {
    const r = g.results[j];
    if (r && NOTABLE.includes(r.cls)) return setPly(j + 1);
  }
  setPly(g.moves.length);
}

// « Suivant · 4/9 » : rang du prochain coup clé parmi tous ceux de la partie
function suivantLabel(g, review) {
  if (!review || g.var || g.free || !isComplete(g)) return 'Suivant';
  const keys = [];
  g.results.forEach((r, j) => { if (r && NOTABLE.includes(r.cls)) keys.push(j + 1); });
  const n = keys.filter((p) => p <= g.ply).length + 1;
  return n <= keys.length ? `Suivant · ${n}/${keys.length}` : 'Suivant';
}

// ----- onglets du panneau (Coups · Bilan · Moteur)
function selectTab(name) {
  document.querySelectorAll('#gpanel .ptabs [role=tab]').forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    const pane = document.getElementById(b.getAttribute('aria-controls'));
    if (pane && pane.classList.contains('tabpane')) pane.classList.toggle('hidden', !on);
  });
  $('#gpanel').dataset.ptab = name;
  try { if (name !== 'coach') local.set('gtab', name); } catch { /* ignoré */ }
  if (name === 'moves') { const c = document.querySelector('#moves .mv.cur'); if (c) c.scrollIntoView({ block: 'nearest' }); }
}
function initPanelTabs() {
  const all = [...document.querySelectorAll('#gpanel .ptabs [role=tab]')];
  const vis = () => all.filter((b) => b.offsetParent !== null);
  all.forEach((b) => {
    b.onclick = () => selectTab(b.dataset.tab);
    b.onkeydown = (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d && e.key !== 'Home' && e.key !== 'End') return;
      const tabs = vis(), i = tabs.indexOf(b);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + d + tabs.length) % tabs.length;
      selectTab(tabs[n].dataset.tab); tabs[n].focus(); e.preventDefault(); e.stopPropagation();
    };
  });
  const saved = local.get('gtab', 'moves');
  selectTab(['moves', 'review', 'engine'].includes(saved) ? saved : 'moves');
}
// Réglages locaux de l'analyse (onglet Moteur) : appliqués tout de suite.
function initAnalysisSettings() {
  $('#ar-lines').value = String(nLines());
  $('#ui-arrows').value = uiArrows();
  $('#ui-keys').value = uiOn('keyMoves') ? '1' : '0';
  $('#ui-class').value = uiOn('boardClass') ? '1' : '0';
  $('#ar-lines').onchange = (e) => { local.set('multipv', e.target.value); S.liveRes = null; S.livePending = null; S.bestRes = null; S.bestPending = null; if (S.g) renderGame(); };
  $('#ui-arrows').onchange = (e) => { local.set('arrows', e.target.value); if (S.g) renderGame(); };
  $('#ui-keys').onchange = (e) => { local.set('keyMoves', e.target.value); if (S.g) renderGame(); };
  $('#ui-class').onchange = (e) => { local.set('boardClass', e.target.value); if (S.g) renderGame(); };
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

// Meilleur coup (uci) de la position affichée : analyse du coup suivant (partie ou variante),
// sinon analyse en direct, sinon petite analyse dédiée (fin de partie, analyse libre…).
function bestHere(g, fen) {
  const c = new Chess(fen);
  if (c.isGameOver()) return null;
  const next = g.var ? g.var.items[g.var.idx]?.pos : g.positions[g.ply];
  if (next && next.lines[0]) return next.lines[0].pv[0];
  for (const r of [S.liveRes, S.bestRes]) if (r && r.fen === fen && r.res.lines[0]) return r.res.lines[0].pv[0];
  if (S.bestPending === fen) return null;
  S.bestPending = fen;
  const st = analysisSettings();
  analyzePosition(fen, null, { cloud: true, priority: true, multipv: 1, depth: st.fixed ? null : st.depth, movetime: maxTime() })
    .then((res) => { if (S.bestPending !== fen) return; S.bestPending = null; if (!res.miss) { S.bestRes = { fen, res }; if (S.g === g && currentFen(g) === fen) renderGame(); } })
    .catch(() => { if (S.bestPending === fen) S.bestPending = null; });
  return null;
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
export function figSan(san, color) {
  const m = /^([NBRQK])(.*)$/.exec(san);
  if (!m) return esc(frSan(san));
  return `<img class="fig${color === 'b' ? ' dark' : ''}" src="pieces/w${m[1]}.svg" alt="${esc(frSan(m[1]))}">${esc(frSan(m[2]))}`;
}

// ------------------------------------------------------------------ rendu partie
// Réglages de l'onglet « Interface » de la roue dentée.
// Flèche verte : meilleur coup de la position affichée (anciens réglages « coach » / « both » = oui).
const uiArrows = () => (local.get('arrows', 'best') === 'none' ? 'none' : 'best');
const uiOn = (k) => local.get(k, '1') !== '0';

// Matériel : pièces adverses capturées par chaque camp et avantage matériel (P 1, C/F 3, T 5, D 9).
const MAT_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const MAT_START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
export function material(fen) {
  const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const ch of fen.split(' ')[0]) {
    const l = ch.toLowerCase();
    if (MAT_VAL[l]) cnt[ch === l ? 'b' : 'w'][l]++;
  }
  return cnt;
}
export function capturedHtml(cnt, c) {
  const opp = c === 'w' ? 'b' : 'w';
  const score = (x) => Object.entries(cnt[x]).reduce((a, [t, n]) => a + MAT_VAL[t] * n, 0);
  let html = '';
  for (const t of ['p', 'b', 'n', 'r', 'q']) {
    const k = Math.max(0, MAT_START[t] - cnt[opp][t]);
    if (k) html += `<span class="capg">${`<img src="pieces/${opp}${t.toUpperCase()}.svg" alt="">`.repeat(k)}</span>`;
  }
  const adv = score(c) - score(opp);
  return `<span class="captured">${html}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</span>`;
}

function renderGame() {
  const g = S.g;
  if (!g) return;
  const review = isComplete(g);
  const fen = currentFen(g);
  const d = displayed(g);
  if (d && d.inVar && !d.pos && !d.pending) analyzeVarItem(g, g.var.items[d.varIdx], d.varIdx);
  const annotate = d && d.r && (review || d.inVar);

  // échiquier : case du coup coloriée et annotée (Brillant, Théorique, Gaffe…), flèche du meilleur coup
  // de la position affichée (avant que le coup suivant ne soit joué)
  const arrows = [];
  const best = uiArrows() === 'best' && (review || g.var) ? bestHere(g, fen) : null;
  if (best) arrows.push({ from: best.slice(0, 2), to: best.slice(2, 4), color: 'var(--arrow-best)' });
  const mark = annotate && uiOn('boardClass') ? { sq: d.uci.slice(2, 4), color: CLASSES[d.r.cls].color, sym: CLASSES[d.r.cls].sym, label: CLASSES[d.r.cls].label } : null;
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
  $('#evalbar').style.setProperty('--wp', wp + '%');
  $('#evalbar .label').textContent = label;
  $('#evalbar .label').className = 'label ' + (wp >= 50 ? 'on-white' : 'on-black');

  // joueurs
  const top = flipped ? 'w' : 'b';
  const bot = flipped ? 'b' : 'w';
  const mat = material(fen);
  const pl = (c) => {
    const p = c === 'w' ? g.game.white : g.game.black;
    return `<span class="avatar-sm ${c}"><img src="pieces/${c}P.svg" alt=""></span>
      <span class="pinfo"><span><b>${esc(p.name)}</b>${p.rating ? ` <span class="muted">(${esc(p.rating)})</span>` : ''}</span>${capturedHtml(mat, c)}</span>`;
  };
  $('#player-top').innerHTML = pl(top);
  $('#player-bottom').innerHTML = pl(bot);

  // panneau
  $('#gpanel').classList.toggle('review', review);
  $('#review-empty').classList.toggle('hidden', review);
  $('#ptitle').innerHTML = g.free ? 'Analyse libre' : review ? `<span class="badge" style="background:${CLASSES.best.color}">★</span> Bilan` : 'Analyse';
  const tt = $('#topbar-title');
  if (tt) {
    const oppN = g.free ? '' : (g.game.white.name.toLowerCase() === (S.user || '').toLowerCase() ? g.game.black.name : g.game.white.name);
    tt.innerHTML = (g.free ? 'Analyse libre' : review ? 'Bilan' : 'Analyse') + (oppN ? ` <span class="tt-opp">· vs ${esc(oppN)}</span>` : '');
  }
  $('#cc-link').href = g.game.url || '#';
  $('#cc-link').classList.toggle('hidden', !!g.free);
  $('#back').title = g.free ? 'Retour à l\'analyse libre' : 'Retour à l\'historique des parties';
  $('#reanalyze').parentElement.classList.toggle('hidden', !!g.free);
  const k = g.var ? g.var.basePly : g.ply;
  $('#opening').textContent = k === 0 && !g.var ? (g.custom ? 'Position définie' : 'Position de départ') : frOpening(g.openingAt[k] || g.openingAt[g.openingAt.length - 1]) || 'Ouverture inconnue';
  const date = fmtGameDate(g.game.end * 1000);
  $('#game-meta').textContent = g.free ? '' : `${TIME_FR[g.game.timeClass] || ''} · ${date} · ${g.game.result || ''}`;

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
  const strip = $('#astrip');
  if (strip) {
    strip.classList.toggle('hidden', !g.analyzing);
    if (g.analyzing) {
      const pct = Math.round(100 * done / Math.max(1, total));
      strip.querySelector('.as-txt').innerHTML = `<strong>Coup ${done} / ${total}</strong> · ${pct} %`;
      strip.querySelector('.as-fill').style.width = pct + '%';
      strip.querySelector('button').classList.toggle('hidden', S.batch && S.batch.cur === g);
    }
  }
  $('#pfoot').classList.toggle('hidden', (review || g.free) && !g.analyzing);
  if (g.analyzing) {
    prog.classList.remove('hidden');
    btn.classList.add('hidden');
    const pct = Math.round(100 * done / Math.max(1, total));
    prog.querySelector('.fill').style.width = pct + '%';
    const batch = S.batch && S.batch.cur === g;
    prog.querySelector('.txt').textContent = `${batch ? 'Analyse multiple' : 'Analyse'} · coup ${done} / ${total}`;
    prog.querySelector('.pct').textContent = `${pct} %`;
    // temps restant : cadence mesurée depuis le début de cette analyse
    if (!g.pT) g.pT = { t0: Date.now(), d0: done };
    const rate = done > g.pT.d0 ? (Date.now() - g.pT.t0) / (done - g.pT.d0) : 0;
    const secs = rate ? Math.max(1, Math.round(rate * (total - done) / 1000)) : 0;
    prog.querySelector('.eta').textContent = secs ? `≈ ${secs >= 90 ? Math.round(secs / 60) + ' min' : secs + ' s'} restantes` : '';
    $('#stop').classList.toggle('hidden', batch);
    // la partie bascule en « Bilan » dès qu'elle est complète
    if (review && !$('#gpanel').classList.contains('review')) renderGame();
    return;
  }
  g.pT = null;
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
    return `<div class="lrow" role="button" tabindex="0" data-li="${i}" title="Cliquez pour jouer cette ligne sur l'échiquier"><span class="lscore${neg ? ' neg' : ''}">${fmtScore(sc)}</span><span class="lmoves">${moves}</span></div>`;
  }).join('') + `<div class="lfoot muted small">${esc(SOURCE_LABEL(res))}</div>`;
}

function bindLines(el, fen, res) {
  el.querySelectorAll('.lrow[data-li]').forEach((r) => { r.onclick = () => playLine(fen, res.lines[+r.dataset.li].pv); keyActivate(r); });
}

// ----- coach (bulle façon chess.com) : en mode Bilan, ou pendant une variante
function renderCoach(g, d, review) {
  const el = $('#coach');
  const show = review || !!g.var;
  el.classList.toggle('hidden', !show);
  $('#gpanel').classList.toggle('has-coach', show);
  if (!show && $('#gpanel').dataset.ptab === 'coach') selectTab('moves');
  $('#next-wrap').classList.toggle('hidden', !review || !!g.free);
  $('#suivant').disabled = atEnd(g);
  $('#suivant').textContent = suivantLabel(g, review);
  if (!show) { el.innerHTML = ''; return; }
  let html = '';
  if (g.var) {
    const items = g.var.items.map((it, i) => {
      const num = it.color === 'w' ? `${it.move.before.split(' ')[5]}. ` : (i === 0 ? `${it.move.before.split(' ')[5]}… ` : '');
      return `<span class="vmove${i === g.var.idx - 1 ? ' cur' : ''}" role="button" tabindex="0" data-vi="${i + 1}">${num}${esc(frSan(it.san))}${it.r ? badge(it.r.cls, true) : ''}</span>`;
    }).join(' ');
    html += `<div class="variation"><div class="vhead">Variante <button id="exit-var" class="btn small">↩ Revenir ${g.free ? 'à la ligne principale' : 'à la partie'}</button></div><div class="vmoves">${items || '<span class="muted">Jouez un coup…</span>'}</div></div>`;
  }
  if (!d) {
    if (g.free) {
      html += `<div class="coach-title">Analyse libre</div>
        <p>Jouez les coups de votre choix, pour les deux camps : Stockfish note chaque coup.</p>
        <p class="muted">Revenez en arrière et jouez un autre coup pour ouvrir une variante.</p>`;
    } else if (review) {
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
    html += `<div class="coach-title">${esc(frSan(d.san))}</div><p class="muted">${d.pending || g.analyzing || g.free ? 'Analyse en cours…' : 'Pas encore analysé.'}</p>`;
    el.innerHTML = coachWrap(html);
    bindCoach(g);
    return;
  }
  const ex = explainMove({ fenBefore: d.fenBefore, san: d.san, uci: d.uci, color: d.color, r: d.r, pos: d.pos, openingName: frOpening(g.openingAt[g.ply]), playerColor: g.playerColor });
  html += `<div class="coach-title">${badge(d.r.cls)} <span>${esc(ex.title)}</span><span class="score${/^[−-]/.test(fmtScore(d.pos.played.score)) ? ' neg' : ''}">${fmtScore(d.pos.played.score)}</span></div>`;
  const open = S.coachOpen === g.ply + ':' + (g.var ? g.var.idx : '');
  html += ex.paras.map((p, i) => `<p${!open && i === 2 ? ' class="clamp"' : ''}${!open && i > 2 ? ' hidden' : ''}>${esc(p)}</p>`).join('');
  if (ex.paras.length > 3) html += `<button type="button" class="link coach-more" id="coach-more" aria-expanded="${open}">${open ? 'Réduire' : 'Lire la suite'}</button>`;
  const hasAfter = !!(ex.refutation && ex.refutation.items.length > 1);
  const bestLbl = ex.best ? (ex.best.isPlayed ? 'Suite prévue' : 'Meilleure suite') : '';
  const bestKey = ex.best && ex.best.isPlayed ? 'played' : 'best';
  // Boutons pleine largeur (feuille mobile repliée) : ▶ Meilleure suite / ▶ Après ce coup
  if (ex.best || hasAfter) {
    html += `<div class="coach-btns">${ex.best ? `<button type="button" class="cb good" data-line="${bestKey}">▶ ${bestLbl}</button>` : ''}${hasAfter ? '<button type="button" class="cb bad" data-line="played">▶ Après ce coup</button>' : ''}</div>`;
  }
  const lineRow = (cls, label, text, key) => `<div class="line ${cls}"><span class="lhead">${label}</span><span class="ltext" title="${esc(text)}">${esc(text)}</span><button type="button" class="btn small" data-line="${key}" aria-label="Voir : ${label}">▶ Voir</button></div>`;
  if (hasAfter) html += lineRow('bad', 'Après ce coup', ex.refutation.text, 'played');
  if (ex.best) html += lineRow('good', bestLbl, ex.best.text, bestKey);
  html += `<div class="coach-foot muted">${esc(SOURCE_LABEL(d.pos))}</div>`;
  el.innerHTML = coachWrap(html);
  bindCoach(g, d);
}

const coachWrap = (html) => `<div class="coach-wrap"><div class="avatar"><img src="pieces/wN.svg" alt=""></div><div class="bubble">${html}</div></div>`;

function bindCoach(g, d) {
  const ev = $('#exit-var');
  if (ev) ev.onclick = exitVar;
  const cm = $('#coach-more');
  if (cm) cm.onclick = () => { const k = g.ply + ':' + (g.var ? g.var.idx : ''); S.coachOpen = S.coachOpen === k ? null : k; renderGame(); };
  document.querySelectorAll('.vmove').forEach((s) => { s.onclick = () => { stopAuto(); g.var.idx = +s.dataset.vi; renderGame(); }; keyActivate(s); });
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
  const keys = uiOn('keyMoves');
  let html = '';
  // position définie avec les Noirs au trait : le premier coup va dans la colonne des Noirs
  const off = g.startFen.split(' ')[1] === 'b' ? 1 : 0;
  const no0 = Number(g.startFen.split(' ')[5]) || 1;
  for (let i = -off; i < g.moves.length; i += 2) {
    html += `<div class="mrow"><span class="mno">${no0 + (i + off) / 2}.</span>`;
    for (const j of [i, i + 1]) {
      const m = g.moves[j];
      if (!m) { html += '<span class="mv empty"></span>'; continue; }
      const r = review ? g.results[j] : null;
      const cur = !g.var && g.ply === j + 1 ? ' cur' : g.var && g.var.basePly === j + 1 ? ' base' : '';
      const icon = keys && r && (NOTABLE.includes(r.cls) || (r.cls === 'book' && lastBook[m.color] === j));
      const col = keys && r && NOTABLE.includes(r.cls) ? ` style="color:${CLASSES[r.cls].color}"` : '';
      html += `<span class="mv${cur}" role="button" tabindex="0" data-ply="${j + 1}"${r ? ` title="${CLASSES[r.cls].label}"` : ''}><span class="ico">${icon ? badge(r.cls, true) : ''}</span><span class="san"${col}>${figSan(m.san, m.color)}</span></span>`;
    }
    html += '</div>';
  }
  el.innerHTML = html || '<p class="muted pad">Aucun coup joué.</p>';
  el.querySelectorAll('.mv[data-ply]').forEach((s) => { s.onclick = () => { stopAuto(); setPly(+s.dataset.ply); }; keyActivate(s); });
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
      return `<td>${n ? `<button type="button" class="jump" data-c="${col}" data-cls="${cls}" style="color:${c.color}">${n}</button>` : '<span class="muted">0</span>'}</td>`;
    };
    html += `<tr><td>${badge(cls, true)} ${c.label}</td>${cell('w')}${cell('b')}</tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;
  el.querySelectorAll('button.jump').forEach((a) => {
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
  svg += `<rect width="${W}" height="${H}" style="fill:var(--eval-black)"/>`;
  if (pts.length > 1) {
    svg += `<path d="M0,${H} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0].toFixed(1)},${H} Z" fill="#fff"/>`;
  }
  svg += `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#888" stroke-width="0.6"/>`;
  g.results.forEach((r, i) => {
    if (!r || !['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(r.cls) || !pts[i + 1]) return;
    svg += `<circle cx="${pts[i + 1][0]}" cy="${pts[i + 1][1]}" r="4" style="fill:${CLASSES[r.cls].color}" stroke="#fff" stroke-width="1"/>`;
  });
  const cx = (g.var ? g.var.basePly : g.ply) / n * W;
  svg += `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" style="stroke:var(--accent)" stroke-width="2"/></svg>`;
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
export function engineFields(root, p, onChange = () => {}) {
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
      S.liveRes = null; S.livePending = null; S.bestRes = null; S.bestPending = null;
      if (changed) {
        await detectBoost();
        if (boost && !engineStatus.boost) toast('Boost PC non trouvé : lancez « Lancer l\'analyseur.bat » sur ce PC. Stockfish 19 Lite (navigateur) est utilisé en attendant.', 6000);
      }
    },
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
  document.querySelectorAll('#tc .chip').forEach((c) => { c.onclick = () => { setTc(c.dataset.tc); S.shown = 100; renderList(); }; });
  $('#op').onchange = () => { S.shown = 100; renderList(); };
  $('#multi').onclick = openMultiDialog;
  $('#clear-hist').onclick = clearHistory;
  $('#more').onclick = () => { S.shown += 200; renderList(); };
  $('#games tbody').onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = '#/game/' + encodeURIComponent(tr.dataset.id);
  };
  $('#games tbody').onkeydown = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tr.click(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      if (n && n.dataset.id) { e.preventDefault(); n.focus(); }
    }
  };
  $('#astrip-stop').onclick = () => $('#stop').click();
  $('#back').onclick = $('#tb-back').onclick = () => { location.hash = S.g && S.g.free ? '#/free' : '#/games'; };
  $('#first').onclick = nav(() => setPly(0));
  $('#prev').onclick = nav(() => step(-1));
  $('#next').onclick = nav(() => step(1));
  $('#last').onclick = nav(() => { if (S.g) setPly(S.g.moves.length); });
  $('#play').onclick = toggleAuto;
  $('#suivant').onclick = nav(nextKey);
  $('#flip').onclick = () => { board.flip(); renderGame(); };
  $('#analyze').onclick = startAnalysis;
  $('#stop').onclick = () => { if (S.g && S.g.analyzing) S.g.abort = true; };
  initPanelTabs();
  initAnalysisSettings();
  initSheet($('#gpanel'), $('#grab'));
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
  setBook(BOOK);
  await loadIndex();
  if (S.user) S.loading = loadGames();
}
