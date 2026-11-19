// Mode Puzzles rush : le maximum de puzzles résolus en 120 secondes. Chaque erreur retire 5 secondes
// (comme Puzzle Storm de Lichess) et fait passer au puzzle suivant. Le chrono démarre au premier coup.
import { Board, announce } from '../board.js';
import { $, esc } from '../core/ui.js';
import { loadManifest, loadPack, rushEntryFor, pickByRating } from '../core/puzzle-data.js';
import { getStats, recordRush } from '../core/puzzle-stats.js';
import { PuzzleRun, updateElo } from './puzzles-engine.js';

export const RUSH_SECONDS = 120;
export const PENALTY_SECONDS = 5;
const REPLY_DELAY = 350; // pause avant la réponse de l'adversaire
const NEXT_DELAY = 250; // pause avant le puzzle suivant après une réussite
const MISS_DELAY = 1100; // le bon coup reste affiché après une erreur

const R = { seq: 0, board: null, timer: null, timeouts: new Set() };

const later = (fn, ms) => {
  const id = setTimeout(() => { R.timeouts.delete(id); fn(); }, ms);
  R.timeouts.add(id);
};

export function leave() {
  R.seq++;
  clearInterval(R.timer);
  R.timer = null;
  for (const id of R.timeouts) clearTimeout(id);
  R.timeouts.clear();
  R.phase = 'idle';
}

function build(el) {
  el.innerHTML = `
  <h1 class="sr-only">Puzzles rush</h1>
  <div class="left">
    <div class="board-wrap"><div id="rush-board"></div></div>
  </div>
  <aside class="panel pz-panel" id="rush-panel" aria-label="Puzzles rush">
    <div class="phead">
      <a href="#/puzzles" class="icon-btn" title="Quitter et revenir aux puzzles" aria-label="Quitter"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle">Puzzles rush</span>
    </div>
    <div class="pz-clock" id="rush-clock" role="timer" aria-label="Temps restant">2:00</div>
    <div class="tstats pz-stats" id="rush-stats"></div>
    <div id="rush-msg" class="tmsg" aria-live="polite"></div>
    <div class="tactions"><button id="rush-again" class="btn primary hidden" type="button">Rejouer</button></div>
    <div id="rush-summary" class="pz-summary"></div>
  </aside>`;
  R.board = new Board($('#rush-board', el), { onMove: (from, to, promo) => userMove(from, to, promo) });
  $('#rush-again', el).onclick = () => start(el);
}

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function setMsg(kind, html) {
  const m = $('#rush-msg');
  m.className = 'tmsg' + (kind ? ' ' + kind : '');
  m.innerHTML = html;
}

function renderStats() {
  $('#rush-stats').innerHTML = `
    <span><b>${R.score}</b>réussis</span>
    <span><b>${R.errors}</b>erreur${R.errors > 1 ? 's' : ''}</span>
    <span><b>${R.best}</b>record</span>
    <span><b>${R.elo}</b>niveau</span>`;
}

function renderClock() {
  const left = R.phase === 'playing' ? R.endAt - performance.now() : R.phase === 'ready' ? RUSH_SECONDS * 1000 : 0;
  const c = $('#rush-clock');
  c.textContent = fmtClock(left);
  c.classList.toggle('low', R.phase === 'playing' && left <= 10000);
}

export async function start(el) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  leave();
  const seq = R.seq;
  R.phase = 'loading';
  R.score = 0; R.errors = 0; R.solvedIds = new Set(); R.queue = []; R.run = null; R.busy = false;
  $('#rush-again').classList.add('hidden');
  $('#rush-summary').innerHTML = '';
  R.board.interactive = false;
  setMsg('', 'Chargement des puzzles…');
  renderClock();
  let stats;
  try {
    stats = await getStats();
    const manifest = await loadManifest();
    const entry = rushEntryFor(manifest, stats.elo);
    if (!entry) throw new Error('Aucun pack rush disponible.');
    const pack = await loadPack('rush', entry.name);
    if (seq !== R.seq) return;
    R.pack = pack;
  } catch (err) {
    if (seq !== R.seq) return;
    R.phase = 'idle';
    setMsg('wrong', `${esc(err.message)}<br><button class="btn" id="rush-retry" type="button">Réessayer</button>`);
    $('#rush-retry').onclick = () => start(el);
    return;
  }
  R.elo = stats.elo; R.startElo = stats.elo; R.best = stats.rush.best;
  // Difficulté croissante autour du niveau du joueur.
  R.queue = pickByRating(R.pack, R.elo, { spread: 150, n: 150 }).sort((a, b) => a.rating - b.rating);
  R.phase = 'ready';
  renderStats();
  renderClock();
  nextPuzzle();
  setMsg('', `Le chrono de ${RUSH_SECONDS} s démarre à votre premier coup. Chaque erreur coûte ${PENALTY_SECONDS} s.`);
}

function nextPuzzle() {
  if (!R.queue.length) {
    const rest = pickByRating(R.pack.filter((p) => !R.solvedIds.has(p.id)), R.elo, { spread: 300, n: 150 });
    R.queue = rest.length ? rest : pickByRating(R.pack, R.elo, { spread: 300, n: 150 });
  }
  const puzzle = R.queue.shift();
  R.run = new PuzzleRun(puzzle);
  const st = R.run.start();
  R.board.setOrientation(st.color);
  R.board.setPosition(st.fen, { lastMove: st.lastMove });
  R.board.interactive = true;
  R.busy = false;
}

function tick() {
  if (R.phase !== 'playing') return;
  if (R.endAt - performance.now() <= 0) { finish(); return; }
  renderClock();
}

function userMove(from, to, promo) {
  if (R.busy || !R.run || (R.phase !== 'ready' && R.phase !== 'playing')) return;
  if (R.phase === 'ready') {
    R.phase = 'playing';
    R.endAt = performance.now() + RUSH_SECONDS * 1000;
    R.timer = setInterval(tick, 100);
    setMsg('', '');
  }
  const seq = R.seq;
  const res = R.run.move(from, to, promo);
  if (res.illegal) return;
  const puzzleRating = R.run.puzzle.rating;
  if (!res.ok) {
    R.busy = true;
    R.board.interactive = false;
    R.errors++;
    R.endAt -= PENALTY_SECONDS * 1000;
    R.elo = updateElo(R.elo, puzzleRating, false).user;
    const want = res.expected;
    R.board.setArrows([{ from: want.slice(0, 2), to: want.slice(2, 4), color: '#81b64c' }]);
    setMsg('wrong', `Raté : −${PENALTY_SECONDS} s`);
    renderStats(); renderClock();
    if (R.endAt - performance.now() <= 0) { finish(); return; }
    later(() => { if (seq === R.seq && R.phase === 'playing') { setMsg('', ''); nextPuzzle(); } }, MISS_DELAY);
    return;
  }
  R.board.setPosition(res.fen, { lastMove: res.lastMove });
  const solved = () => {
    R.score++;
    R.solvedIds.add(R.run.puzzle.id);
    R.elo = updateElo(R.elo, puzzleRating, true).user;
    renderStats();
    later(() => { if (seq === R.seq && R.phase === 'playing') nextPuzzle(); }, NEXT_DELAY);
  };
  R.busy = true;
  R.board.interactive = false;
  if (res.done) { solved(); return; }
  later(() => {
    if (seq !== R.seq || R.phase !== 'playing') return;
    R.board.setPosition(res.reply.fen, { lastMove: res.reply.lastMove });
    R.busy = false;
    R.board.interactive = true;
  }, REPLY_DELAY);
}

async function finish() {
  if (R.phase !== 'playing') return;
  const seq = R.seq;
  R.phase = 'over';
  clearInterval(R.timer); R.timer = null;
  for (const id of R.timeouts) clearTimeout(id);
  R.timeouts.clear();
  R.board.interactive = false;
  renderClock();
  announce(`Temps écoulé. Score : ${R.score}.`);
  const gain = R.elo - R.startElo;
  let record = false;
  try { ({ record } = await recordRush({ score: R.score, errors: R.errors, elo: R.elo })); } catch { /* stockage indisponible */ }
  if (seq !== R.seq) return;
  if (record) R.best = R.score;
  renderStats();
  setMsg('end', `Temps écoulé !`);
  $('#rush-summary').innerHTML = `<div class="pz-big" aria-label="Score ${R.score}">${R.score}</div>
    <div class="pz-sub">puzzle${R.score > 1 ? 's' : ''} résolu${R.score > 1 ? 's' : ''}${record && R.score ? ' · <b class="pz-record">nouveau record !</b>' : ''}</div>
    <div class="pz-sub muted">${R.errors} erreur${R.errors > 1 ? 's' : ''} · niveau ${R.elo} (${gain >= 0 ? '+' : '−'}${Math.abs(gain)})</div>`;
  const again = $('#rush-again');
  again.classList.remove('hidden');
  again.focus();
}