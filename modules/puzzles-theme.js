// Mode Puzzles par thème : une série de puzzles d'un même motif, au niveau choisi, sans chrono.
// Un mauvais coup montre la bonne réponse et compte le puzzle comme raté ; on passe au suivant à la demande.
import { Chess } from '../vendor/chess.js';
import { Board, announce } from '../board.js';
import { $, esc } from '../core/ui.js';
import { loadPack, pickByRating } from '../core/puzzle-data.js';
import { getStats, recordTheme } from '../core/puzzle-stats.js';
import { themeLabel } from '../core/puzzle-themes.js';
import { PuzzleRun, updateElo } from './puzzles-engine.js';
import { themeLevel, themeCount } from './puzzles.js';
import { figSan } from './analyse.js';

const REPLY_DELAY = 350;
const S = { seq: 0, board: null, timer: null, phase: 'idle' };

export function leave() {
  S.seq++;
  clearTimeout(S.timer);
  S.timer = null;
  S.phase = 'idle';
}

function build(el) {
  el.innerHTML = `
  <h1 class="sr-only">Puzzles par thème</h1>
  <div class="left">
    <div class="board-wrap"><div id="theme-board"></div></div>
  </div>
  <aside class="panel pz-panel" id="theme-panel" aria-label="Puzzles par thème">
    <div class="phead">
      <a href="#/puzzles/theme" class="icon-btn" title="Quitter et choisir un autre thème" aria-label="Quitter"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle" id="theme-title"></span>
    </div>
    <div class="popening" id="theme-sub"></div>
    <div id="theme-msg" class="tmsg" aria-live="polite"></div>
    <div class="tactions">
      <button id="theme-hint" class="btn" type="button">💡 Indice</button>
      <button id="theme-next" class="btn primary" type="button">Suivant →</button>
    </div>
    <div class="tstats pz-stats" id="theme-stats"></div>
    <div id="theme-summary" class="pz-summary"></div>
  </aside>`;
  S.board = new Board($('#theme-board', el), { onMove: (from, to, promo) => userMove(from, to, promo) });
  $('#theme-hint', el).onclick = hint;
  $('#theme-next', el).onclick = () => next();
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'puzzletheme' || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(e.target.tagName)) return;
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && S.phase === 'resolved') { next(); e.preventDefault(); }
    else if (e.key === 'h' || e.key === 'i') hint();
  });
}

function setMsg(kind, html) {
  const m = $('#theme-msg');
  m.className = 'tmsg' + (kind ? ' ' + kind : '');
  m.innerHTML = html;
}

function renderStats() {
  $('#theme-stats').innerHTML = `
    <span><b>${S.ok}</b>réussis</span>
    <span><b>${S.ko}</b>ratés</span>
    <span><b>${S.elo}</b>niveau</span>
    <span><b>${S.run ? S.run.puzzle.rating : '–'}</b>puzzle</span>`;
}

export async function start(el, theme) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  leave();
  const seq = S.seq;
  S.theme = theme;
  S.phase = 'loading';
  S.ok = 0; S.ko = 0; S.idx = 0; S.run = null; S.queue = [];
  $('#theme-title').textContent = themeLabel(theme);
  $('#theme-summary').innerHTML = '';
  $('#theme-hint').classList.remove('hidden');
  $('#theme-next').classList.add('hidden');
  S.board.interactive = false;
  setMsg('', 'Chargement des puzzles…');
  try {
    const stats = await getStats();
    const pack = await loadPack('theme', theme);
    if (seq !== S.seq) return;
    S.elo = S.startElo = stats.elo;
    S.level = themeLevel(stats.elo);
    S.count = themeCount();
    S.queue = pickByRating(pack, S.level, { spread: 100, n: S.count });
  } catch (err) {
    if (seq !== S.seq) return;
    S.phase = 'idle';
    setMsg('wrong', `${esc(err.message)}<br><button class="btn" id="theme-retry" type="button">Réessayer</button>`);
    $('#theme-retry').onclick = () => start(el, theme);
    return;
  }
  if (!S.queue.length) {
    S.phase = 'idle';
    setMsg('info', 'Aucun puzzle de ce thème à ce niveau. Choisissez un autre niveau ou un autre thème.');
    return;
  }
  S.queue.sort((a, b) => a.rating - b.rating);
  nextPuzzle();
}

function nextPuzzle() {
  S.run = new PuzzleRun(S.queue[S.idx]);
  const st = S.run.start();
  S.hinted = false;
  S.phase = 'playing';
  S.board.setOrientation(st.color);
  S.board.setPosition(st.fen, { lastMove: st.lastMove });
  S.board.interactive = true;
  $('#theme-hint').classList.remove('hidden');
  $('#theme-next').classList.add('hidden');
  $('#theme-sub').textContent = `Puzzle ${S.idx + 1} / ${S.queue.length} · trait aux ${st.color === 'w' ? 'Blancs' : 'Noirs'}`;
  setMsg('', `Trouvez le meilleur coup pour les ${st.color === 'w' ? 'Blancs' : 'Noirs'}.`);
  renderStats();
}

function hint() {
  if (S.phase !== 'playing' || !S.run) return;
  const want = S.run.expected;
  if (!want) return;
  S.hinted = true;
  S.board.hl.clear();
  S.board.hl.add(want.slice(0, 2));
  S.board.render();
  setMsg('hint', 'Déplacez la pièce mise en évidence.');
}

function sanOf(fen, uci) {
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return figSan(m.san, m.color);
  } catch { return esc(uci); }
}

async function resolve(success) {
  S.phase = 'resolved';
  S.board.interactive = false;
  if (success) S.ok++; else S.ko++;
  S.elo = updateElo(S.elo, S.run.puzzle.rating, success).user;
  renderStats();
  $('#theme-hint').classList.add('hidden');
  const last = S.idx + 1 >= S.queue.length;
  const btn = $('#theme-next');
  btn.textContent = last ? 'Terminer' : 'Suivant →';
  btn.classList.remove('hidden');
  btn.focus();
  try { await recordTheme({ theme: S.theme, success, elo: S.elo }); } catch { /* stockage indisponible */ }
}

function userMove(from, to, promo) {
  if (S.phase !== 'playing' || !S.run) return;
  const seq = S.seq;
  const fenBefore = S.run.fen;
  const res = S.run.move(from, to, promo);
  if (res.illegal) return;
  S.board.hl.clear();
  if (!res.ok) {
    const want = res.expected;
    S.board.setArrows([{ from: want.slice(0, 2), to: want.slice(2, 4), color: '#81b64c' }]);
    setMsg('wrong', `Raté. Le bon coup était <b>${sanOf(fenBefore, want)}</b>`);
    announce('Raté.');
    resolve(false);
    return;
  }
  S.board.setPosition(res.fen, { lastMove: res.lastMove });
  if (res.done) {
    setMsg('ok', S.hinted ? 'Résolu (avec indice).' : 'Bien joué !');
    announce('Puzzle résolu.');
    resolve(true);
    return;
  }
  S.board.interactive = false;
  S.timer = setTimeout(() => {
    if (seq !== S.seq || S.phase !== 'playing') return;
    S.board.setPosition(res.reply.fen, { lastMove: res.reply.lastMove });
    S.board.interactive = true;
    setMsg('ok', 'Bon coup, continuez.');
  }, REPLY_DELAY);
}

function next() {
  if (S.phase !== 'resolved') return;
  S.idx++;
  if (S.idx >= S.queue.length) { finish(); return; }
  nextPuzzle();
}

function finish() {
  S.phase = 'over';
  const n = S.ok + S.ko;
  const gain = S.elo - S.startElo;
  $('#theme-hint').classList.add('hidden');
  $('#theme-next').classList.add('hidden');
  $('#theme-sub').textContent = '';
  setMsg('end', 'Série terminée !');
  $('#theme-summary').innerHTML = `<div class="pz-big" aria-label="${S.ok} sur ${n}">${S.ok}/${n}</div>
    <div class="pz-sub">puzzle${S.ok > 1 ? 's' : ''} réussi${S.ok > 1 ? 's' : ''} · niveau ${S.elo} (${gain >= 0 ? '+' : '−'}${Math.abs(gain)})</div>
    <div class="tactions"><a class="btn" href="#/puzzles/theme">Autres thèmes</a><button id="theme-again" class="btn primary" type="button">Rejouer</button></div>`;
  const again = $('#theme-again');
  again.onclick = () => start($('#puzzletheme-view'), S.theme);
  again.focus();
  announce(`Série terminée : ${S.ok} sur ${n}.`);
}
