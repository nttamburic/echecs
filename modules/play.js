// Module « Jouer » : parties contre Maia3, un bot qui joue comme un humain du niveau choisi (600 à 2800 Elo).
// Les parties ne sont jamais sauvegardées. Stockfish (Boost PC ou navigateur) sert à l'aide, aux flèches et à la barre d'évaluation.
import { Chess } from '../vendor/chess.js';
import { Board } from '../board.js';
import { fmtScore, winPct, epd } from '../analysis.js';
import { $, esc, uciOf, local, toast, keyActivate } from '../core/ui.js';
import { analyzePosition, analysisSettings, maxTime } from '../core/engine.js';
import { maiaMove, loadMaia, maiaModel, setMaiaProgress, MAIA_MODELS } from '../core/maia.js';
import { BOOK, figSan, material, capturedHtml, stashFree } from './analyse.js';

const P = {
  phase: 'setup', // setup | play | over
  chess: null, // partie en cours (chess.js, pour la répétition et les fins de partie)
  moves: [], // coups verbose chess.js (before, after, san, from, to, color…)
  startFen: null,
  ply: 0, // position affichée
  user: 'w',
  elo: 1500,
  thinking: false,
  token: 0, // change à chaque nouvelle partie / coup repris : les réponses en retard sont ignorées
  result: null, // { text, score, resigned }
  hint: null, // { fen, uci, san }
  evals: new Map(),
  evalPending: new Set(),
};
let board;

const ELO_MIN = 600, ELO_MAX = 2800;
const opt = (k) => local.get(k, '1') !== '0';
const fenAt = (k) => (k === 0 ? P.startFen : P.moves[k - 1].after);
const atLatest = () => P.ply === P.moves.length;

// ------------------------------------------------------------------ écran de départ
function renderSetup() {
  $('#play-setup').classList.toggle('hidden', P.phase !== 'setup');
  $('#play-game').classList.toggle('hidden', P.phase === 'setup');
  if (P.phase !== 'setup') return;
  const elo = Number(local.get('playElo')) || 1500;
  $('#play-elo').value = elo;
  $('#play-elo-val').textContent = elo;
  const side = local.get('playSide', 'w');
  document.querySelectorAll('#play-side button').forEach((b) => b.classList.toggle('on', b.dataset.side === side));
}

async function startGame() {
  const side = local.get('playSide', 'w');
  P.user = side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
  P.elo = Number($('#play-elo').value) || 1500;
  local.set('playElo', String(P.elo));
  P.chess = new Chess();
  P.startFen = P.chess.fen();
  P.moves = [];
  P.ply = 0;
  P.result = null;
  P.hint = null;
  P.token++;
  P.phase = 'play';
  board.setOrientation(P.user);
  render();
  if (P.user === 'b') botMove();
  else loadMaia().catch(() => {}); // téléchargement du modèle pendant que l'on réfléchit au premier coup
}

// ------------------------------------------------------------------ coups
function push(uci) {
  const m = P.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  P.moves.push(m);
  P.ply = P.moves.length;
  P.hint = null;
  checkEnd();
}

function onBoardMove(from, to, promo) {
  if (P.phase !== 'play' || P.thinking || !atLatest() || P.chess.turn() !== P.user) return;
  try { push(from + to + (promo || '')); } catch { return; }
  render();
  if (P.phase === 'play') botMove();
}

async function botMove() {
  const token = P.token;
  P.thinking = true;
  render();
  const t0 = Date.now();
  try {
    const r = await maiaMove(P.chess.fen(), P.elo);
    const wait = 400 + Math.random() * 500 - (Date.now() - t0); // petit temps de « réflexion » naturel
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    if (token !== P.token || P.phase !== 'play') return;
    if (r.uci) push(r.uci);
  } catch (e) {
    if (token === P.token) toast('Maia : ' + esc(e.message), 6000);
  } finally {
    if (token === P.token) { P.thinking = false; setMaiaProgress(null); render(); }
  }
}

function checkEnd() {
  const c = P.chess;
  if (!c.isGameOver()) return;
  let text, score;
  if (c.isCheckmate()) {
    const winner = c.turn() === 'w' ? 'b' : 'w';
    score = winner === 'w' ? '1-0' : '0-1';
    text = winner === P.user ? 'Échec et mat : vous avez gagné !' : 'Échec et mat : Maia a gagné.';
  } else {
    score = '½-½';
    text = c.isStalemate() ? 'Pat : partie nulle.' : c.isThreefoldRepetition() ? 'Nulle par répétition de la position.'
      : c.isInsufficientMaterial() ? 'Nulle : matériel insuffisant pour mater.' : 'Nulle (règle des 50 coups).';
  }
  P.result = { text, score };
  P.phase = 'over';
}

// « Rejouer le coup » : annule votre dernier coup (et la réponse de Maia).
function undo() {
  if (!canUndo()) return;
  P.token++;
  P.thinking = false;
  setMaiaProgress(null);
  do {
    P.chess.undo();
    P.moves.pop();
  } while (P.moves.length && P.chess.turn() !== P.user);
  if (P.chess.turn() !== P.user) { P.token++; P.ply = P.moves.length; P.phase = 'play'; P.result = null; render(); botMove(); return; }
  P.ply = P.moves.length;
  P.phase = 'play';
  P.result = null;
  P.hint = null;
  render();
}
const canUndo = () => P.phase !== 'setup' && !(P.result && P.result.resigned) && P.moves.some((m) => m.color === P.user);

function resign() {
  if (P.phase !== 'play' || !confirm('Abandonner la partie ?')) return;
  P.token++;
  P.thinking = false;
  P.result = { text: 'Vous avez abandonné.', score: P.user === 'w' ? '0-1' : '1-0', resigned: true };
  P.phase = 'over';
  render();
}

function newGame() {
  if (P.phase === 'play' && P.moves.length && !confirm('Abandonner cette partie et en commencer une nouvelle ?')) return;
  P.token++;
  P.thinking = false;
  P.phase = 'setup';
  P.result = null;
  render();
}

function analyseGame() {
  stashFree({ fen: P.startFen, ucis: P.moves.map(uciOf), orient: P.user });
  location.hash = '#/free/new';
}

// ------------------------------------------------------------------ Stockfish : aide, flèches, barre d'évaluation
function evalKey(fen) { const st = analysisSettings(); return `${fen}|${st.boost}|${st.depth}|${maxTime()}`; }
function evalOf(fen, priority = false) {
  const key = evalKey(fen);
  if (P.evals.has(key)) return P.evals.get(key);
  if (P.evalPending.has(key)) return null;
  if (new Chess(fen).isGameOver()) return null;
  P.evalPending.add(key);
  const st = analysisSettings();
  analyzePosition(fen, null, { cloud: true, priority, multipv: 1, depth: st.fixed ? null : st.depth, movetime: maxTime() })
    .then((res) => { if (!res.miss) { P.evals.set(key, res); if (P.evals.size > 500) P.evals.delete(P.evals.keys().next().value); } })
    .catch(() => {})
    .finally(() => { P.evalPending.delete(key); if (document.body.dataset.view === 'play') render(); });
  return null;
}

async function hint() {
  if (P.phase !== 'play' || P.thinking || !atLatest() || P.chess.turn() !== P.user) return;
  const fen = P.chess.fen();
  P.hint = { fen, pending: true };
  render();
  const res = evalOf(fen, true);
  if (res) showHint(fen, res);
}
function showHint(fen, res) {
  const u = res.lines[0] && res.lines[0].pv[0];
  if (!u) { P.hint = null; return; }
  const c = new Chess(fen);
  let san = u;
  try { san = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san; } catch { /* */ }
  P.hint = { fen, uci: u, san, score: res.lines[0].score };
}

// ------------------------------------------------------------------ rendu
function render() {
  renderSetup();
  const fen = P.phase === 'setup' ? new Chess().fen() : fenAt(P.ply);
  const last = P.phase !== 'setup' && P.ply > 0 ? P.moves[P.ply - 1] : null;
  const myTurn = P.phase === 'play' && !P.thinking && atLatest() && P.chess.turn() === P.user;
  board.interactive = myTurn;

  // Stockfish (seulement si l'aide, les flèches ou la barre sont demandées)
  const showEval = opt('playEval');
  const showArrows = opt('playArrows');
  let res = null;
  if (P.phase !== 'setup' && (showEval || (showArrows && myTurn) || (P.hint && P.hint.fen === fen))) res = evalOf(fen, !!(P.hint && P.hint.pending));
  if (P.hint && P.hint.pending && P.hint.fen === fen && res) showHint(fen, res);
  if (P.hint && P.hint.fen !== fen) P.hint = null;

  const arrows = [];
  if (P.hint && P.hint.uci) arrows.push({ from: P.hint.uci.slice(0, 2), to: P.hint.uci.slice(2, 4), color: '#4caf50' });
  else if (showArrows && myTurn && res && res.lines[0]) {
    const b = res.lines[0].pv[0];
    arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4), color: '#3b82f6', opacity: 0.75 });
  }
  board.setPosition(fen, { lastMove: last ? [last.from, last.to] : null, arrows });

  // barre d'évaluation
  const bar = $('#play-evalbar');
  bar.classList.toggle('hidden', !showEval);
  if (showEval) {
    const c = new Chess(fen);
    let wp = 50, label = '';
    if (c.isCheckmate()) { wp = c.turn() === 'w' ? 0 : 100; label = c.turn() === 'w' ? '0-1' : '1-0'; }
    else if (c.isDraw()) label = '½-½';
    else if (res && res.lines[0]) { wp = winPct(res.lines[0].score, 'w'); label = fmtScore(res.lines[0].score); }
    const flipped = board.orientation === 'b';
    bar.classList.toggle('flipped', flipped);
    bar.querySelector('.white').style.height = wp + '%';
    const lab = bar.querySelector('.label');
    lab.textContent = label;
    lab.className = 'label ' + (wp >= 50 ? 'on-white' : 'on-black');
  }

  // joueurs
  const flipped = board.orientation === 'b';
  const mat = material(fen);
  const pl = (c) => {
    const me = P.phase === 'setup' ? c === 'w' : c === P.user;
    const elo = P.phase === 'setup' ? Number($('#play-elo').value) || 1500 : P.elo;
    const name = me ? '<b>Vous</b>' : `<b>Maia</b> <span class="muted">(${elo})</span>${P.thinking && c !== P.user ? ' <span class="muted small">réfléchit…</span>' : ''}`;
    return `<span class="avatar-sm ${c}"><img src="pieces/${c}${me ? 'P' : 'N'}.svg" alt=""></span>
      <span class="pinfo"><span>${name}</span>${capturedHtml(mat, c)}</span>`;
  };
  $('#play-top').innerHTML = pl(flipped ? 'w' : 'b');
  $('#play-bottom').innerHTML = pl(flipped ? 'b' : 'w');
  if (P.phase === 'setup') return;

  // boutons
  $('#play-undo').disabled = !canUndo();
  $('#play-hint').disabled = !myTurn;
  $('#play-resign').disabled = P.phase !== 'play';

  // état : réflexion, aide, résultat
  const st = $('#play-status');
  let html = '';
  if (P.result) {
    html = `<div class="result"><div class="rtitle">${esc(P.result.text)} <span class="rscore">${P.result.score}</span></div>
      <div class="row"><button id="play-again" class="btn primary">Rejouer la partie</button><button id="play-analyse" class="btn">Analyser la partie</button></div></div>`;
  } else if (P.hint) {
    html = P.hint.uci
      ? `<div class="hint">Conseil de Stockfish : <b>${figSan(P.hint.san, P.user)}</b> <span class="muted">(${fmtScore(P.hint.score)})</span></div>`
      : '<div class="hint muted">Stockfish cherche le meilleur coup…</div>';
  } else if (P.thinking) {
    html = `<div class="hint muted" id="play-think">Maia réfléchit…</div>`;
  } else if (P.phase === 'play') {
    html = `<div class="hint muted">${atLatest() ? (P.chess.turn() === P.user ? 'À vous de jouer.' : '') : 'Revenez à la dernière position pour jouer (→ ou ⏭).'}</div>`;
  }
  st.innerHTML = html;
  const again = $('#play-again');
  if (again) again.onclick = newGame;
  const an = $('#play-analyse');
  if (an) an.onclick = analyseGame;

  // ouverture
  let op = null;
  for (let k = 0; k <= P.ply; k++) { const o = BOOK[epd(fenAt(k))]; if (o && o.length) op = o[1]; }
  $('#play-opening').textContent = P.ply === 0 ? 'Position de départ' : op || 'Ouverture inconnue';

  // coups
  const el = $('#play-moves');
  let mh = '';
  for (let i = 0; i < P.moves.length; i += 2) {
    mh += `<div class="mrow"><span class="mno">${i / 2 + 1}.</span>`;
    for (const j of [i, i + 1]) {
      const m = P.moves[j];
      if (!m) { mh += '<span class="mv empty"></span>'; continue; }
      mh += `<span class="mv${P.ply === j + 1 ? ' cur' : ''}" role="button" tabindex="0" data-ply="${j + 1}"><span class="san">${figSan(m.san, m.color)}</span></span>`;
    }
    mh += '</div>';
  }
  el.innerHTML = mh || '<p class="muted pad">Aucun coup joué.</p>';
  el.querySelectorAll('.mv[data-ply]').forEach((s) => { s.onclick = () => setPly(+s.dataset.ply); keyActivate(s); });
  const cur = el.querySelector('.mv.cur');
  if (cur && atLatest()) el.scrollTop = el.scrollHeight;
}

function setPly(k) { P.ply = Math.max(0, Math.min(P.moves.length, k)); render(); }

// ------------------------------------------------------------------ roue dentée
function openGear() {
  const dlg = $('#play-dlg');
  $('#pg-eval').value = opt('playEval') ? '1' : '0';
  $('#pg-arrows').value = opt('playArrows') ? '1' : '0';
  $('#pg-model').innerHTML = MAIA_MODELS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('#pg-model').value = maiaModel();
  dlg.returnValue = '';
  dlg.showModal();
  dlg.querySelector('form').onsubmit = (e) => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    local.set('playEval', $('#pg-eval').value);
    local.set('playArrows', $('#pg-arrows').value);
    local.set('maiaModel', $('#pg-model').value);
    render();
  };
}

// ------------------------------------------------------------------ navigation
export function show() { render(); }

export function init() {
  board = new Board($('#play-board'), { onMove: onBoardMove });
  if (local.get('playEval') == null) local.set('playEval', '1');
  if (local.get('playArrows') == null) local.set('playArrows', '0');
  $('#play-elo').min = ELO_MIN; $('#play-elo').max = ELO_MAX;
  $('#play-elo').oninput = () => { local.set('playElo', $('#play-elo').value); $('#play-elo-val').textContent = $('#play-elo').value; render(); };
  $('#play-side').onclick = (e) => {
    const b = e.target.closest('button[data-side]');
    if (!b) return;
    local.set('playSide', b.dataset.side);
    renderSetup();
  };
  $('#play-start').onclick = startGame;
  $('#play-undo').onclick = undo;
  $('#play-hint').onclick = hint;
  $('#play-resign').onclick = resign;
  $('#play-new').onclick = newGame;
  $('#play-gear').onclick = openGear;
  $('#play-flip').onclick = () => { board.flip(); render(); };
  $('#pl-first').onclick = () => setPly(0);
  $('#pl-prev').onclick = () => setPly(P.ply - 1);
  $('#pl-next').onclick = () => setPly(P.ply + 1);
  $('#pl-last').onclick = () => setPly(P.moves.length);
  setMaiaProgress((d) => {
    const el = $('#play-think') || $('#play-load');
    if (!el) return;
    el.textContent = d.compiling ? 'Préparation de Maia…'
      : `Téléchargement de Maia (une seule fois) : ${(d.got / 1048576).toFixed(0)}${d.total ? ` / ${(d.total / 1048576).toFixed(0)}` : ''} Mo…`;
  });
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'play' || P.phase === 'setup' || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { setPly(P.ply - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setPly(P.ply + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'Home') { setPly(0); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'End') { setPly(P.moves.length); e.preventDefault(); }
    else if (e.key === 'f') { board.flip(); render(); }
  });
  render();
}
