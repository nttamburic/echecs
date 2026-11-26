// Mode Puzzles par thème : une série de puzzles d'un même motif, au niveau choisi, sans chrono.
// Un mauvais coup compte le puzzle comme raté, mais on peut réessayer ; « Suivant » apparaît une fois le puzzle résolu.
import { Board, announce } from '../board.js';
import { $, esc } from '../core/ui.js';
import { loadPack, pickByRating } from '../core/puzzle-data.js';
import { getStats, recordTheme } from '../core/puzzle-stats.js';
import { themeLabel } from '../core/puzzle-themes.js';
import { reprise } from '../core/puzzle-reprise.js';
import { PuzzleRun, updateElo } from './puzzles-engine.js';
import { analyserPuzzle } from './puzzles-analyse.js';
import { themeLevel, themeCount } from './puzzles.js';

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
      <button id="theme-analyse" class="btn" type="button">Analyser la position</button>
      <button id="theme-next" class="btn primary" type="button">Suivant →</button>
    </div>
    <div class="tstats pz-stats" id="theme-stats"></div>
    <div id="theme-summary" class="pz-summary"></div>
  </aside>`;
  S.board = new Board($('#theme-board', el), { onMove: (from, to, promo) => userMove(from, to, promo) });
  $('#theme-hint', el).onclick = hint;
  $('#theme-next', el).onclick = () => next();
  $('#theme-analyse', el).onclick = analyse;
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
  const retour = reprise(location.hash);
  if (retour) { retour(); return; }
  const seq = S.seq;
  S.theme = theme;
  S.phase = 'loading';
  S.ok = 0; S.ko = 0; S.idx = 0; S.run = null; S.queue = [];
  $('#theme-title').textContent = themeLabel(theme);
  $('#theme-summary').innerHTML = '';
  $('#theme-hint').classList.remove('hidden');
  $('#theme-next').classList.add('hidden');
  $('#theme-analyse').classList.add('hidden');
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
  S.reply = null;
  S.phase = 'playing';
  S.board.setOrientation(st.color);
  S.board.setPosition(st.fen, { lastMove: st.lastMove });
  S.board.interactive = true;
  $('#theme-hint').classList.remove('hidden');
  $('#theme-analyse').classList.remove('hidden');
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

// Compte le résultat du puzzle, une seule fois (première erreur, analyse ou réussite).
async function record(success) {
  if (!S.run.settle(success)) return;
  if (success) S.ok++; else S.ko++;
  S.elo = updateElo(S.elo, S.run.puzzle.rating, success).user;
  renderStats();
  try { await recordTheme({ theme: S.theme, success, elo: S.elo }); } catch { /* stockage indisponible */ }
}

function solved() {
  S.phase = 'resolved';
  record(true); // sans effet si le puzzle est déjà compté raté
  S.board.interactive = false;
  if (S.run.verdict) setMsg('ok', S.hinted ? 'Résolu (avec indice).' : 'Bien joué !');
  else setMsg('ok', 'Trouvé ! Ce puzzle reste compté comme raté.');
  announce('Puzzle résolu.');
  $('#theme-hint').classList.add('hidden');
  const btn = $('#theme-next');
  btn.textContent = S.idx + 1 >= S.queue.length ? 'Terminer' : 'Suivant →';
  btn.classList.remove('hidden');
  btn.focus();
}

function userMove(from, to, promo) {
  if (S.phase !== 'playing' || !S.run) return;
  const res = S.run.move(from, to, promo);
  if (res.illegal) return;
  S.board.hl.clear();
  if (!res.ok) {
    record(false);
    S.board.render();
    setMsg('wrong', 'Ce n’est pas le bon coup. Réessayez. Le puzzle est compté comme raté.');
    announce('Mauvais coup. Réessayez.');
    return;
  }
  S.board.setPosition(res.fen, { lastMove: res.lastMove });
  if (res.done) { solved(); return; }
  S.board.interactive = false;
  S.reply = res.reply;
  S.timer = setTimeout(playReply, REPLY_DELAY);
}

function playReply() {
  if (S.phase !== 'playing' || !S.reply) return;
  S.board.setPosition(S.reply.fen, { lastMove: S.reply.lastMove });
  S.reply = null;
  S.board.interactive = true;
  setMsg('ok', 'Bon coup, continuez.');
}

// Avant la solution, consulter le moteur revient à voir la réponse : le puzzle est compté raté.
function analyse() {
  if ((S.phase !== 'playing' && S.phase !== 'resolved') || !S.run) return;
  const phase = S.phase;
  if (phase === 'playing') {
    record(false);
    setMsg('info', 'Position analysée avant la solution : ce puzzle est compté comme raté. Trouvez le coup pour continuer.');
  }
  analyserPuzzle(S.run, { onglet: 'puzzles', reprendre: () => { S.phase = phase; playReply(); } });
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
