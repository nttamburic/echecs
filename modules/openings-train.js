// Module « Ouvertures » — entraînement.
// Trois modes : tout le répertoire, une ouverture précise, ciblé (coups non maîtrisés et jamais revus).
// L'utilisateur joue sa couleur ; l'adversaire joue une réponse enregistrée, tirée au hasard.
// Mauvais coup : compté faux, la position reste, l'utilisateur rejoue jusqu'au bon coup (bouton
// « Indice » pour le voir ; demander l'indice compte aussi comme une erreur).
// Seule la première tentative à chaque position compte pour la maîtrise (un événement par situation).
import { Chess } from '../vendor/chess.js';
import { Board } from '../board.js';
import { $, esc } from '../core/ui.js';
import { epd } from '../analysis.js';
import { figSan } from './analyse.js';
import {
  childrenOf, userPositions, fenOf, listRepertoires, getRepertoire, listEvents, addEvent,
  computeMastery, STATUS, pathTo,
} from './openings.js';

const MODES = { all: 'Tout le répertoire', rep: 'Une ouverture', targeted: 'Entraînement ciblé' };
const OPP_DELAY = 450;
const MAX_PLIES = 80;

const T = {
  mode: null, reps: [], rep: null, targets: [], target: null, tIdx: 0,
  cur: null, line: [], done: true, wrong: false, hinted: false, busy: false,
  stats: { lines: 0, ok: 0, ko: 0 }, answered: new Set(), msg: null, board: null, timer: null, seq: 0,
};

const tKey = (t) => `${t.rep.id}|${t.epd}`;
const remaining = () => T.targets.slice(T.tIdx).filter((t) => !T.answered.has(tKey(t))).length;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const turnOf = (p) => p.split(' ')[1];
const colorFr = (c) => (c === 'w' ? 'Blancs' : 'Noirs');
const plural = (n, s) => `${n} ${s}${n > 1 ? 's' : ''}`;

// Cibles du mode ciblé : positions où l'utilisateur joue, non maîtrisées d'abord, puis jamais revues.
export function buildTargets(reps, events, onlyRep = null) {
  const weak = [], fresh = [];
  for (const r of reps) {
    if (onlyRep && r.id !== onlyRep) continue;
    for (const [p, m] of computeMastery(r, events, reps)) {
      if (m.status === 'weak') weak.push({ rep: r, epd: p, status: 'weak', m });
      else if (m.status === 'new') fresh.push({ rep: r, epd: p, status: 'new', m });
    }
  }
  return [...shuffle(weak), ...shuffle(fresh)];
}

// ------------------------------------------------------------------ vue
function build(el) {
  el.innerHTML = `
  <div class="left">
    <div class="board-wrap"><div id="train-board"></div></div>
  </div>
  <aside class="panel" id="train-panel">
    <div class="phead">
      <a href="#/openings" class="icon-btn" title="Arrêter et revenir aux répertoires" aria-label="Arrêter"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle" id="train-title"></span>
    </div>
    <div class="popening" id="train-sub"></div>
    <div id="train-msg" class="tmsg"></div>
    <div class="tactions">
      <button id="train-hint" class="btn">💡 Indice</button>
      <button id="train-next" class="btn primary">Ligne suivante →</button>
    </div>
    <div class="pmoves" id="train-line"></div>
    <div id="train-stats" class="tstats"></div>
  </aside>`;
  T.board = new Board($('#train-board', el), { onMove: (from, to, promo) => userMove(from + to + (promo || '')) });
  $('#train-hint', el).onclick = hint;
  $('#train-next', el).onclick = () => nextLine();
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'train' || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && T.done) { nextLine(); e.preventDefault(); }
    else if (e.key === 'i' || e.key === 'h') hint();
  });
}

// mode : 'all' | 'rep' | 'targeted' ; id : répertoire (mode 'rep', ou mode ciblé limité à un répertoire)
export async function start(el, mode, id) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  leave();
  const seq = T.seq;
  T.mode = MODES[mode] ? mode : 'all';
  T.stats = { lines: 0, ok: 0, ko: 0 };
  T.answered = new Set();
  T.target = null;
  const all = await listRepertoires();
  if (seq !== T.seq) return;
  T.reps = all.filter((r) => userPositions(r).size);
  if (T.mode === 'rep') {
    const r = await getRepertoire(id);
    T.reps = r && userPositions(r).size ? [r] : [];
  }
  $('#train-title').textContent = MODES[T.mode];
  if (T.mode === 'targeted') {
    T.targets = buildTargets(T.reps, await listEvents(), id || null);
    T.tIdx = 0;
  }
  if (!T.reps.length || (T.mode === 'targeted' && !T.targets.length)) {
    T.done = true;
    T.board.setPosition(fenOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'));
    T.board.interactive = false;
    $('#train-sub').textContent = '';
    $('#train-line').innerHTML = '';
    $('#train-stats').innerHTML = '';
    setMsg('info', !T.reps.length
      ? 'Aucun coup à travailler : ajoutez d\'abord des coups pour votre couleur dans un répertoire.'
      : 'Rien à cibler : tous vos coups sont maîtrisés ou en cours (moins de 3 situations). Essayez « Tout le répertoire ».');
    T.rep = null; T.line = [];
    render();
    $('#train-next').classList.add('hidden');
    return;
  }
  $('#train-next').disabled = false;
  nextLine();
}

export function leave() { clearTimeout(T.timer); T.seq++; T.busy = false; }

function nextLine() {
  clearTimeout(T.timer);
  if (T.mode === 'targeted') {
    while (T.tIdx < T.targets.length && T.answered.has(tKey(T.targets[T.tIdx]))) T.tIdx++; // déjà réussie en chemin
    if (T.tIdx >= T.targets.length) { finishTargets(); return; }
    T.target = T.targets[T.tIdx++];
    T.rep = T.target.rep;
  } else T.rep = pick(T.reps);
  T.cur = epd(T.rep.root);
  T.line = [];
  T.done = false;
  T.board.interactive = true;
  if (T.board.orientation !== T.rep.color) T.board.setOrientation(T.rep.color);
  T.board.setPosition(fenOf(T.cur));
  $('#train-sub').innerHTML = `<span class="avatar-sm ${T.rep.color}"><img src="pieces/${T.rep.color}K.svg" alt=""></span> ${esc(T.rep.name)}`
    + (T.target ? ` · <span class="muted">cible ${T.tIdx}/${T.targets.length} : position ${STATUS[T.target.status].label}</span>` : '');
  step();
}

function finishTargets() {
  T.done = true;
  T.board.interactive = false;
  setMsg('end', `Toutes les cibles ont été revues (${plural(T.targets.length, 'position')}). La maîtrise est mise à jour : relancez l'entraînement ciblé pour la suite.`);
  $('#train-next').disabled = true;
  render();
}

// Avance jusqu'au prochain coup de l'utilisateur (l'adversaire répond seul), ou termine la ligne.
function step() {
  const seq = T.seq;
  if (T.line.length >= MAX_PLIES) { endLine(); return; }
  if (turnOf(T.cur) === T.rep.color) {
    const exp = userPositions(T.rep).get(T.cur);
    if (!exp || !exp.length) { endLine(); return; }
    T.wrong = false; T.hinted = false; T.busy = false; T.board.interactive = true;
    const isTarget = T.target && T.target.epd === T.cur;
    setMsg('turn', isTarget ? '🎯 Position ciblée : à vous de trouver le coup du répertoire.' : `À vous (${colorFr(T.rep.color)}) : jouez le coup du répertoire.`);
    render();
    return;
  }
  const kids = childrenOf(T.rep, T.cur);
  if (!kids.length) { endLine(); return; }
  let e = null;
  if (T.target) { const p = pathTo(T.rep, T.cur, T.target.epd); if (p && p.length) e = p[0]; }
  if (!e) e = pick(kids);
  T.busy = true; T.board.interactive = false;
  render();
  T.timer = setTimeout(() => {
    if (seq !== T.seq) return;
    play(e);
    step();
  }, OPP_DELAY);
}

function play(e) {
  T.line.push(e);
  T.cur = e.fenAfter;
  T.board.setPosition(fenOf(T.cur), { lastMove: [e.uci.slice(0, 2), e.uci.slice(2, 4)] });
}

function endLine() {
  T.done = true;
  T.busy = false;
  T.stats.lines++;
  T.board.interactive = false;
  const last = T.mode === 'targeted' && !remaining();
  const more = last ? '' : ' « Ligne suivante » (ou Entrée) pour continuer.';
  setMsg('end', `✓ Fin de la ligne.${more}`);
  if (last) $('#train-next').textContent = 'Terminer';
  render();
}

async function record(uci, correct) {
  if (correct) T.stats.ok++; else T.stats.ko++;
  try { await addEvent({ repId: T.rep.id, epd: T.cur, uci, correct, source: 'train' }); } catch { /* stockage indisponible */ }
}

function userMove(uci) {
  if (T.done || T.busy || turnOf(T.cur) !== T.rep.color) { T.board.setPosition(fenOf(T.cur)); return; }
  const exp = userPositions(T.rep).get(T.cur) || [];
  const e = exp.find((x) => x.uci === uci);
  if (e) {
    const wasTarget = T.target && T.target.epd === T.cur;
    if (!T.wrong && !T.hinted) { record(uci, true); T.answered.add(`${T.rep.id}|${T.cur}`); }
    play(e);
    setMsg('ok', T.wrong || T.hinted ? '✓ C\'est le bon coup (compté comme erreur pour cette fois).' : '✓ Bon coup !');
    if (wasTarget) { endLine(); return; }
    step();
    return;
  }
  // mauvais coup : affiché un instant en rouge, puis la position revient
  if (!T.wrong && !T.hinted) record(uci, false);
  T.wrong = true;
  T.busy = true; T.board.interactive = false;
  const seq = T.seq;
  const fenBefore = fenOf(T.cur);
  let after = fenBefore;
  try { const c = new Chess(fenBefore); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); after = c.fen(); } catch { /* */ }
  T.board.setPosition(after, { lastMove: [uci.slice(0, 2), uci.slice(2, 4)], mark: { sq: uci.slice(2, 4), color: '#fa412d', sym: '✗', label: 'Hors répertoire' } });
  setMsg('wrong', '✗ Ce n\'est pas le coup du répertoire. Réessayez, ou demandez un indice.');
  render();
  T.timer = setTimeout(() => {
    if (seq !== T.seq) return;
    T.busy = false; T.board.interactive = true;
    T.board.setPosition(fenBefore, { lastMove: T.line.length ? [T.line.at(-1).uci.slice(0, 2), T.line.at(-1).uci.slice(2, 4)] : null });
  }, 700);
}

function hint() {
  if (T.done || T.busy || turnOf(T.cur) !== T.rep.color) return;
  const exp = userPositions(T.rep).get(T.cur) || [];
  if (!exp.length) return;
  if (!T.wrong && !T.hinted) record('', false);
  T.hinted = true;
  T.board.setArrows(exp.map((e) => ({ from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), color: '#4caf50' })));
  const names = exp.map((e) => moveName(e)).join(' ou ');
  setMsg('hint', `💡 Coup${exp.length > 1 ? 's' : ''} du répertoire : <b>${names}</b>. Jouez-le sur l'échiquier.`);
  render();
}

// ------------------------------------------------------------------ rendu
function moveName(e) {
  const white = turnOf(e.fenBefore) === 'w';
  return figSan(e.san, white ? 'w' : 'b');
}

function setMsg(kind, html) { T.msg = { kind, html }; }

function render() {
  const m = T.msg;
  const el = $('#train-msg');
  el.className = 'tmsg ' + (m ? m.kind : '');
  el.innerHTML = m ? m.html : '';
  if (T.busy && !T.done && T.rep && turnOf(T.cur) !== T.rep.color && m && m.kind !== 'ok') el.innerHTML = '<span class="muted">L\'adversaire joue…</span>';
  $('#train-hint').disabled = T.done || turnOf(T.cur || 'x w') !== (T.rep && T.rep.color);
  $('#train-next').classList.toggle('hidden', !T.done);
  $('#train-hint').classList.toggle('hidden', T.done);
  if (!T.done) $('#train-next').textContent = 'Ligne suivante →';
  // ligne jouée
  let html = '';
  const root = T.rep ? T.rep.root : '';
  const no0 = Number(root.split(' ')[5]) || 1;
  const off = root.split(' ')[1] === 'b' ? 1 : 0;
  T.line.forEach((e, i) => {
    const white = turnOf(e.fenBefore) === 'w';
    const no = no0 + Math.floor((i + off) / 2);
    if (white) html += `<span class="rnum">${no}.</span>`;
    else if (i === 0) html += `<span class="rnum">${no}...</span>`;
    html += `<span class="rm${turnOf(e.fenBefore) === T.rep.color ? ' mine' : ''}">${moveName(e)}</span> `;
  });
  $('#train-line').innerHTML = html ? `<div class="rtree"><div class="rline">${html}</div></div>` : '';
  const s = T.stats;
  const tot = s.ok + s.ko;
  $('#train-stats').innerHTML = `<span><b>${s.ok}</b> bonne${s.ok > 1 ? 's' : ''} réponse${s.ok > 1 ? 's' : ''}</span><span><b>${s.ko}</b> erreur${s.ko > 1 ? 's' : ''}</span>`
    + (tot ? `<span>${Math.round((100 * s.ok) / tot)} %</span>` : '') + `<span class="muted">${plural(s.lines, 'ligne')} terminée${s.lines > 1 ? 's' : ''}</span>`;
}
