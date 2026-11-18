// Module « Ouvertures » — entraînement.
// Quatre modes : à revoir (répétition espacée), tout le répertoire, une ouverture précise, ciblé
// (coups non maîtrisés et jamais revus).
// L'utilisateur joue sa couleur ; l'adversaire joue une réponse enregistrée, tirée selon sa fréquence
// réelle au niveau de l'utilisateur (explorateur Lichess), ou au hasard sans données.
// Modes à cibles (à revoir, ciblé) : style « coups isolés » (on saute directement à la position) ou
// « lignes complètes » (on rejoue la ligne depuis le début). Seuls les coups actifs sont entraînés.
// Mauvais coup : compté faux, la position reste, l'utilisateur rejoue jusqu'au bon coup (bouton
// « Indice » pour le voir ; demander l'indice compte aussi comme une erreur).
// Seule la première tentative à chaque position compte pour la maîtrise (un événement par situation).
import { Chess } from '../vendor/chess.js';
import { Board } from '../board.js';
import { $, esc, local } from '../core/ui.js';
import { moveFrequencies } from '../core/lichess.js';
import { epd } from '../analysis.js';
import { figSan } from './analyse.js';
import { explainOpeningMove } from '../explain.js';
import {
  childrenOf, userPositions, reachableEdges, fenOf, listRepertoires, getRepertoire, listEvents, addEvent,
  computeMastery, masterySummary, STATUS, pathTo, isActive, computeCards, NEW_PER_DAY,
} from './openings.js';

const MODES = { due: 'À revoir', all: 'Tout le répertoire', rep: 'Une ouverture', targeted: 'Entraînement ciblé' };
const TARGET_MODES = ['due', 'targeted'];
export const trainStyle = () => (local.get('trainStyle', 'isolated') === 'lines' ? 'lines' : 'isolated');
const OPP_DELAY = 450;
const MAX_PLIES = 80;

const T = {
  mode: null, reps: [], rep: null, targets: [], target: null, tIdx: 0,
  cur: null, line: [], done: true, wrong: false, hinted: false, busy: false,
  stats: { lines: 0, ok: 0, ko: 0 }, answered: new Set(), msg: null, board: null, timer: null, seq: 0,
  freq: new Map(), requeued: new Set(), missed: new Map(),
};

const tKey = (t) => `${t.rep.id}|${t.epd}`;
const remaining = () => T.targets.slice(T.tIdx).filter((t) => !T.answered.has(tKey(t))).length;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const activeKids = (rep, p) => childrenOf(rep, p).filter(isActive);

// Coup adverse : tirage pondéré par la fréquence réelle de chaque coup du répertoire (un coup absent
// des statistiques garde un petit poids, pour rester entraîné). Sans données : tirage uniforme.
export function pickWeighted(kids, freq, rnd = Math.random) {
  if (!freq || !freq.moves || !freq.moves.length) return kids[Math.floor(rnd() * kids.length)];
  const p = new Map(freq.moves.map((m) => [m.uci, m.p]));
  const w = kids.map((e) => Math.max(p.get(e.uci) || 0, 0.02));
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kids.length; i++) { x -= w[i]; if (x <= 0) return kids[i]; }
  return kids[kids.length - 1];
}

// Positions où joue l'adversaire (coups actifs).
function oppPositions(rep) {
  const out = new Set();
  for (const e of reachableEdges(rep, true)) if (turnOf(e.fenBefore) !== rep.color) out.add(e.fenBefore);
  return out;
}
// Fréquences des positions où joue l'adversaire, chargées en tâche de fond au début de la séance
// (l'explorateur les garde 30 jours : la séance suivante démarre avec).
function preloadFrequencies(reps) {
  for (const r of reps) {
    for (const p of oppPositions(r)) {
      if (T.freq.has(p)) continue;
      T.freq.set(p, null);
      moveFrequencies(fenOf(p), { background: true }).then((f) => { if (f) T.freq.set(p, f); else T.freq.delete(p); });
    }
  }
}
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

// Cibles du mode « à revoir » : cartes échues (les plus en retard d'abord), puis des cartes jamais
// vues dans l'ordre du répertoire (premiers coups d'abord), dans la limite des nouvelles du jour.
export function buildDueTargets(reps, events, onlyRep = null, now = Date.now()) {
  const due = [], fresh = [];
  let newToday = 0;
  for (const r of reps) {
    if (onlyRep && r.id !== onlyRep) continue;
    for (const [p, c] of computeCards(r, events, reps)) {
      if (c.first != null && c.first >= dayStart(now)) newToday++;
      if (c.card && c.card.due <= now) due.push({ rep: r, epd: p, status: 'due', due: c.card.due });
      else if (!c.card) fresh.push({ rep: r, epd: p, status: 'fresh' });
    }
  }
  due.sort((a, b) => a.due - b.due);
  return [...due, ...fresh.slice(0, Math.max(0, NEW_PER_DAY() - newToday))];
}
function dayStart(now) { const d = new Date(now); d.setHours(4, 0, 0, 0); return d.getTime() > now ? d.getTime() - 86400000 : d.getTime(); }
const TARGET_LABEL = { due: 'à revoir', fresh: 'nouvelle', weak: STATUS.weak.label, new: STATUS.new.label };

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
  $('#train-msg', el).addEventListener('click', (e) => { if (e.target.closest('#tend-retry')) retryMissed(); });
  $('#train-next', el).onclick = () => nextLine();
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'train' || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && T.done) { nextLine(); e.preventDefault(); }
    else if (e.key === 'i' || e.key === 'h') hint();
  });
}

// mode : 'all' | 'rep' | 'targeted' ; id : répertoire (mode 'rep', ou mode ciblé limité à un répertoire)
export async function start(el, mode, id, from) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  leave();
  const seq = T.seq;
  T.mode = MODES[mode] ? mode : 'all';
  T.stats = { lines: 0, ok: 0, ko: 0 };
  T.t0 = Date.now();
  T.answered = new Set();
  T.requeued = new Set();
  T.missed = new Map();
  T.target = null;
  T.from = mode === 'rep' && from ? from : null; // « S'entraîner sur cette ligne » : on part de cette position
  T.before = null;
  const all = await listRepertoires();
  if (seq !== T.seq) return;
  T.reps = all.filter((r) => userPositions(r).size);
  if (T.mode === 'rep') {
    const r = await getRepertoire(id);
    T.reps = r && userPositions(r).size ? [r] : [];
  }
  $('#train-title').textContent = MODES[T.mode] + (T.from ? ' · cette ligne' : '') + (TARGET_MODES.includes(T.mode) ? ` · ${trainStyle() === 'lines' ? 'lignes complètes' : 'coups isolés'}` : '');
  if (TARGET_MODES.includes(T.mode)) {
    const events = await listEvents();
    if (seq !== T.seq) return;
    T.targets = T.mode === 'due' ? buildDueTargets(T.reps, events, id || null) : buildTargets(T.reps, events, id || null);
    T.tIdx = 0;
  }
  preloadFrequencies(T.reps);
  T.before = await masteryOf(T.reps);
  if (seq !== T.seq) return;
  if (!T.reps.length || (TARGET_MODES.includes(T.mode) && !T.targets.length)) {
    T.done = true;
    T.board.setPosition(fenOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'));
    T.board.interactive = false;
    $('#train-sub').textContent = '';
    $('#train-line').innerHTML = '';
    $('#train-stats').innerHTML = '';
    setMsg('info', !T.reps.length
      ? 'Aucun coup à travailler : ajoutez d\'abord des coups pour votre couleur dans un répertoire.'
      : T.mode === 'due' ? 'Rien à revoir pour le moment : vos révisions sont à jour et la limite de nouveaux coups du jour est atteinte. Revenez plus tard, ou essayez « Tout le répertoire ».'
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

// « Retravailler » : nouvelle série limitée aux positions ratées pendant la séance.
async function retryMissed() {
  const list = [...T.missed.values()];
  if (!list.length || !T.done) return;
  const seq = T.seq;
  T.targets = list.map((m) => ({ rep: m.rep, epd: m.epd, status: 'weak' }));
  T.tIdx = 0; T.answered = new Set(); T.requeued = new Set(); T.missed = new Map();
  T.stats = { lines: 0, ok: 0, ko: 0 }; T.t0 = Date.now();
  T.before = await masteryOf(T.reps);
  if (seq !== T.seq) return;
  $('#train-next').disabled = false;
  nextLine();
}

function nextLine() {
  clearTimeout(T.timer);
  if (TARGET_MODES.includes(T.mode)) {
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
  // coups isolés : on joue d'un coup tout le chemin jusqu'à la position cible
  const path = T.target && trainStyle() === 'isolated' ? pathTo(T.rep, T.cur, T.target.epd, true) : T.from ? pathTo(T.rep, T.cur, T.from, true) : null;
  if (path) { T.line = [...path]; T.cur = T.target ? T.target.epd : T.from; }
  const last = T.line.at(-1);
  T.board.setPosition(fenOf(T.cur), { lastMove: last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : null });
  $('#train-sub').innerHTML = `<span class="avatar-sm ${T.rep.color}"><img src="pieces/${T.rep.color}K.svg" alt=""></span> ${esc(T.rep.name)}`
    + (T.target ? ` · <span class="muted">cible ${T.tIdx}/${T.targets.length} : position ${TARGET_LABEL[T.target.status] || ''}</span>` : '');
  step();
}

// Maîtrise cumulée des répertoires de la séance (avant / après).
async function masteryOf(reps) {
  const events = await listEvents().catch(() => []);
  const tot = { mastered: 0, weak: 0, progress: 0, new: 0 };
  for (const r of reps) { const m = masterySummary(computeMastery(r, events, T.reps)); for (const k in tot) tot[k] += m[k]; }
  return tot;
}
async function sessionSummary() {
  if (!T.before) return '';
  await new Promise((r) => setTimeout(r, 400)); // laisse le temps d'enregistrer la dernière réponse
  const a = await masteryOf(T.reps), b = T.before;
  const KEYS = [['mastered', 'maîtrisés'], ['progress', 'en cours'], ['weak', 'non maîtrisés'], ['new', 'jamais revus']];
  const tot = (m) => KEYS.reduce((n, [k]) => n + m[k], 0);
  const ta = tot(a), tb = tot(b);
  if (!ta) return '';
  const bar = (m, cls) => `<span class="tbar ${cls}" aria-hidden="true">${KEYS.map(([k]) => (m[k] ? `<span style="flex:${m[k]};background:${STATUS[k].color}"></span>` : '')).join('')}</span>`;
  const label = (m, t) => KEYS.map(([k, l]) => `${Math.round((100 * m[k]) / t)} % ${l}`).join(', ');
  const delta = Math.round((100 * a.mastered) / ta) - (tb ? Math.round((100 * b.mastered) / tb) : 0);
  // prochaine révision : cartes échues ou à échéance demain (la journée change à 4 h)
  const events = await listEvents().catch(() => []), now = Date.now(), limit = dayStart(now) + 2 * 86400000;
  let dueNow = 0, dueTomorrow = 0;
  for (const r of T.reps) for (const c of computeCards(r, events, T.reps).values()) { if (!c.card) continue; if (c.card.due <= now) dueNow++; else if (c.card.due < limit) dueTomorrow++; }
  const next = dueNow ? `${plural(dueNow, 'position')} à revoir maintenant` : dueTomorrow ? `prochaine révision demain (${plural(dueTomorrow, 'position')})` : 'aucune révision prévue demain';
  const dtxt = delta > 0 ? `+${delta} point${delta > 1 ? 's' : ''}` : delta < 0 ? `−${-delta} point${delta < -1 ? 's' : ''}` : 'maîtrise inchangée';
  return `<div class="tsum tprog" role="group" aria-label="Maîtrise avant et après la séance">
    <span class="lbl-up">Maîtrise · avant → après</span>
    <span role="img" aria-label="Avant : ${tb ? label(b, tb) : 'aucune donnée'}. Après : ${label(a, ta)}." class="tbars">${tb ? bar(b, 'before') : ''}${bar(a, 'after')}</span>
    <span class="tprog-t ${delta < 0 ? 'neg' : delta === 0 ? 'flat' : ''}">${dtxt} · ${next}</span></div>`;
}

function finishTargets() {
  T.done = true;
  T.board.interactive = false;
  const n = T.targets.length, s = T.stats, tot = s.ok + s.ko;
  const secs = Math.max(1, Math.round((Date.now() - (T.t0 || Date.now())) / 1000));
  const dur = secs >= 60 ? `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')} s` : `${secs} s`;
  const pct = tot ? Math.round((100 * s.ok) / tot) + ' %' : '–';
  const miss = [...T.missed.values()].map((m) => ({ m, label: retryLabel(m) })).filter((x) => x.label);
  const list = miss.length ? `<div class="tend-list"><span class="lbl-up">À retravailler</span>${miss.map((x) => `<a class="tend-row" href="#/openings/${encodeURIComponent(x.m.rep.id)}" title="${esc(x.m.rep.name)}"><span>${x.label}</span><span class="chev" aria-hidden="true">›</span></a>`).join('')}</div>` : '';
  setMsg('end', `<div class="tend"><span class="tend-ic" aria-hidden="true">✓</span>
    <b class="tend-t">${T.mode === 'due' ? 'Révision terminée' : 'Cibles revues'}</b>
    <span class="muted">${plural(n, 'position')} · ${dur}</span>
    <div class="tend-stats"><span><b class="g">${s.ok}</b>bonnes</span><span><b class="r">${s.ko}</b>erreurs</span><span><b>${pct}</b>réussite</span></div>
    <span class="muted small">${T.mode === 'due' ? 'Les prochaines révisions sont planifiées.' : 'La maîtrise est mise à jour : relancez l\'entraînement ciblé pour la suite.'}</span>
    <span id="tsum-slot"></span>${list}
    <div class="tend-foot${miss.length ? '' : ' one'}">${miss.length ? `<button type="button" class="btn big" id="tend-retry">Retravailler (${miss.length})</button>` : ''}<a class="btn primary big" href="#/openings">Terminer</a></div></div>`);
  $('#train-next').disabled = true;
  render();
  const seq = T.seq;
  sessionSummary().then((h) => { if (h && seq === T.seq && T.done) { T.msg.html = T.msg.html.replace('<span id="tsum-slot"></span>', h); render(); } });
}

// Avance jusqu'au prochain coup de l'utilisateur (l'adversaire répond seul), ou termine la ligne.
function step() {
  const seq = T.seq;
  if (T.line.length >= MAX_PLIES) { endLine(); return; }
  if (turnOf(T.cur) === T.rep.color) {
    const exp = userPositions(T.rep).get(T.cur);
    if (!exp || !exp.length) { endLine(); return; }
    T.wrong = false; T.hinted = false; T.hintStep = 0; T.busy = false; T.board.interactive = true;
    const isTarget = T.target && T.target.epd === T.cur;
    if (isTarget && T.target.status === 'fresh') {
      // nouveau coup (mode « à revoir ») : on le montre d'abord ; le jouer planifie la première révision
      T.board.setArrows(exp.map((e) => ({ from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), color: 'var(--arrow-best)' })));
      const idea = ideaOf(exp);
      setMsg('turn', `🆕 Nouveau coup à apprendre : <b>${exp.map((e) => moveName(e)).join(' ou ')}</b>.${idea ? ` ${esc(idea.txt)}` : ''} Jouez-le sur l'échiquier ; il reviendra demain.`);
      render();
      return;
    }
    setMsg('turn', isTarget ? '🎯 Position ciblée : à vous de trouver le coup du répertoire.' : `À vous (${colorFr(T.rep.color)}) : jouez le coup du répertoire.`);
    render();
    return;
  }
  const kids = activeKids(T.rep, T.cur);
  if (!kids.length) { endLine(); return; }
  let e = null;
  if (T.target) { const p = pathTo(T.rep, T.cur, T.target.epd, true); if (p && p.length) e = p[0]; }
  if (!e) e = pickWeighted(kids, T.freq.get(T.cur));
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
  const last = TARGET_MODES.includes(T.mode) && !remaining();
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
  if (!T.wrong && !T.hinted) { record(uci, false); requeue(); miss(); }
  T.wrong = true;
  T.busy = true; T.board.interactive = false;
  const seq = T.seq;
  const fenBefore = fenOf(T.cur);
  let after = fenBefore;
  try { const c = new Chess(fenBefore); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); after = c.fen(); } catch { /* */ }
  T.board.setPosition(after, { lastMove: [uci.slice(0, 2), uci.slice(2, 4)], mark: { sq: uci.slice(2, 4), color: 'var(--cls-manquee)', sym: '✗', label: 'Hors répertoire' } });
  setMsg('wrong', '✗ Ce n\'est pas le coup du répertoire. Réessayez, ou demandez un indice.');
  render();
  T.timer = setTimeout(() => {
    if (seq !== T.seq) return;
    T.busy = false; T.board.interactive = true;
    T.board.setPosition(fenBefore, { lastMove: T.line.length ? [T.line.at(-1).uci.slice(0, 2), T.line.at(-1).uci.slice(2, 4)] : null });
  }, 700);
}

// Positions ratées pendant la séance (liste « À retravailler » de l'écran de fin).
function miss() {
  const k = `${T.rep.id}|${T.cur}`;
  if (!T.missed.has(k)) T.missed.set(k, { rep: T.rep, epd: T.cur });
}
// « 6… a6 7. a4 » : le dernier coup de l'adversaire puis le coup attendu à cette position.
function retryLabel({ rep, epd }) {
  const exp = (userPositions(rep).get(epd) || [])[0];
  if (!exp) return '';
  const path = pathTo(rep, epd0(rep), epd, true) || [];
  const no0 = Number(rep.root.split(' ')[5]) || 1, off = rep.root.split(' ')[1] === 'b' ? 1 : 0;
  const part = (e, i, bare) => { const white = turnOf(e.fenBefore) === 'w', no = no0 + Math.floor((i + off) / 2); return `${bare ? '' : white ? `${no}. ` : `${no}… `}${moveName(e)}`; };
  const prev = path.length ? path.at(-1) : null;
  const expWhite = turnOf(exp.fenBefore) === 'w';
  return [prev ? part(prev, path.length - 1, false) : '', part(exp, path.length, !!prev && !expWhite)].filter(Boolean).join(' ');
}
const epd0 = (rep) => epd(rep.root);

// Mode « à revoir » : une cible ratée revient en fin de séance (une seule fois).
function requeue() {
  if (T.mode !== 'due' || !T.target || T.target.epd !== T.cur) return;
  const k = tKey(T.target);
  if (T.requeued.has(k)) return;
  T.requeued.add(k);
  T.targets.push({ ...T.target, status: 'due' });
}

// Idée du coup à trouver : la note de l'utilisateur si elle existe, sinon le commentaire automatique.
function ideaOf(exp) {
  const noted = exp.find((e) => e.note);
  if (noted) return { txt: noted.note, auto: false };
  for (const e of exp) { const a = explainOpeningMove(e.fenBefore, e.uci); if (a) return { txt: a, auto: true }; }
  return null;
}

// Indice en deux temps : d'abord l'idée du coup (note ou commentaire automatique), puis le coup.
// Les deux comptent comme une erreur (une seule fois par position).
function hint() {
  if (T.done || T.busy || turnOf(T.cur) !== T.rep.color) return;
  const exp = userPositions(T.rep).get(T.cur) || [];
  if (!exp.length) return;
  if (!T.wrong && !T.hinted) { record('', false); requeue(); miss(); }
  T.hinted = true;
  const idea = T.hintStep ? null : ideaOf(exp);
  if (idea) {
    T.hintStep = 1;
    setMsg('hint', `💡 Indice${idea.auto ? ' (automatique)' : ''} : ${esc(idea.txt)} <span class="muted">— « Indice » à nouveau pour voir le coup.</span>`);
    render();
    return;
  }
  T.hintStep = 2;
  T.board.setArrows(exp.map((e) => ({ from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), color: 'var(--arrow-best)' })));
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
    + (tot ? `<span><b>${Math.round((100 * s.ok) / tot)} %</b> réussite</span>` : '<span><b>–</b> réussite</span>') + `<span><b>${s.lines}</b> ligne${s.lines > 1 ? 's' : ''} finie${s.lines > 1 ? 's' : ''}</span>`;
}
