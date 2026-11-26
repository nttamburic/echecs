// Mode Puzzles recommandés : des puzzles tirés de vos propres parties.
//  - « erreurs » : vos gaffes, erreurs et occasions manquées des parties analysées, avec la meilleure ligne du moteur ;
//  - « ouvertures » : des puzzles des ouvertures que vous jouez le plus (famille de tags Lichess).
// Chaque puzzle tenté devient une carte de révision espacée : un puzzle raté revient, un puzzle réussi s'espace.
import { Board, announce } from '../board.js';
import { $, esc } from '../core/ui.js';
import * as store from '../core/store.js';
import { loadManifest, loadPack, pickByRating, openingFamilyFor } from '../core/puzzle-data.js';
import { getStats, saveStats } from '../core/puzzle-stats.js';
import { mineAll, CLASS_LABEL } from '../core/puzzle-mine.js';
import { allCards, gradePuzzle, isDue } from '../core/puzzle-cards.js';
import { buildQueue } from '../core/puzzle-queue.js';
import { reprise } from '../core/puzzle-reprise.js';
import { PuzzleRun, updateElo } from './puzzles-engine.js';
import { analyserPuzzle } from './puzzles-analyse.js';
import { getUser, BOOK } from './analyse.js';
import { frOpening } from './opening-names.js';
import { aUnPseudo } from '../core/joueur.js';

const SIZE = 10;
const REPLY_DELAY = 350;
const SRC_LABEL = { mix: 'Mélange', mistake: 'Mes erreurs', opening: 'Mes ouvertures' };
const S = { seq: 0, board: null, timer: null, phase: 'idle' };

const familyName = (f) => f.replace(/_/g, ' ');

// ------------------------------------------------------------------ données

// Puzzles tirés des parties + familles d'ouvertures jouées. Recalculé à chaque ouverture de l'écran.
async function loadSources() {
  const user = getUser();
  const joueur = aUnPseudo(user);
  const rows = joueur ? await store.all('analysis').catch(() => []) : [];
  const mined = joueur ? mineAll(rows, user, BOOK) : [];
  const idx = joueur ? await store.all('analysisIndex').catch(() => []) : [];
  const counts = new Map();
  for (const r of idx) {
    const name = r.data && r.data.opening;
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return { joueur, games: rows.length, mined, openingNames: counts };
}

// Familles du manifeste correspondant aux ouvertures jouées, de la plus fréquente à la moins fréquente.
function playedFamilies(manifest, openingNames) {
  const byFam = new Map();
  for (const [name, n] of openingNames) {
    const fam = openingFamilyFor(manifest, name);
    if (fam) byFam.set(fam, (byFam.get(fam) || 0) + n);
  }
  return [...byFam.entries()].sort((a, b) => b[1] - a[1]).map(([family, count]) => ({ family, count }));
}

async function openingPool(manifest, families, elo) {
  const out = [];
  for (const { family } of families.slice(0, 4)) {
    try {
      const pack = await loadPack('opening', family);
      for (const p of pickByRating(pack, elo, { spread: 300, n: 12 })) {
        out.push({ id: p.id, fen: p.fen, moves: p.moves, rating: p.rating, themes: p.themes, openingTags: p.openingTags, source: 'opening', reason: { kind: 'opening', family } });
      }
    } catch { /* pack indisponible : on passe à la famille suivante */ }
  }
  return out;
}

// ------------------------------------------------------------------ écran d'accueil du mode
export async function show(el) {
  const tt = document.getElementById('topbar-soon'); if (tt) tt.textContent = 'Puzzles recommandés';
  const head = `<div class="pz-head"><a href="#/puzzles" class="icon-btn" aria-label="Retour aux puzzles" title="Retour"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a><h1 class="page-title">Puzzles recommandés</h1></div>`;
  el.innerHTML = head + '<p class="muted">Analyse de vos parties…</p>';
  let src, cards, manifest = null;
  try {
    [src, cards] = await Promise.all([loadSources(), allCards()]);
  } catch (err) {
    el.innerHTML = head + `<p class="tmsg wrong">${esc(err.message)}</p>`;
    return;
  }
  try { manifest = await loadManifest(); } catch { /* hors ligne : seules les erreurs sont proposées */ }
  const stats = await getStats();
  const now = Date.now();
  const dueM = [...cards.values()].filter((r) => r.puzzle.source === 'mistake' && isDue(r.card, now)).length;
  const newM = src.mined.filter((p) => !cards.has(p.id)).length;
  const fams = manifest ? playedFamilies(manifest, src.openingNames) : [];
  const dueO = [...cards.values()].filter((r) => r.puzzle.source === 'opening' && isDue(r.card, now)).length;
  const canM = dueM + newM > 0, canO = fams.length > 0 || dueO > 0;

  let info;
  if (!src.joueur) info = '<p class="tmsg">Connectez votre compte chess.com dans <a href="#/settings">Paramètres</a> pour obtenir des puzzles tirés de vos parties.</p>';
  else if (!src.games) info = '<p class="tmsg">Aucune partie analysée pour l’instant. <a href="#/games">Analysez quelques parties</a> : vos gaffes et occasions manquées deviendront des puzzles.</p>';
  else info = '';

  const btn = (key, ok, text) => `<a class="pz-card${ok ? '' : ' is-soon'}" ${ok ? `href="#/puzzles/recommend/${key}"` : 'aria-disabled="true"'}>
      <span class="pz-name">${SRC_LABEL[key]}</span><span class="pz-desc">${text}</span></a>`;
  el.innerHTML = head + `
  <p class="pz-lead">Niveau actuel : <b>${stats.elo}</b>. Chaque série compte ${SIZE} puzzles ; ceux que vous ratez reviennent plus tard.</p>
  ${info}
  <div class="pz-cards">
    ${btn('mix', canM || canO, 'Une erreur, une ouverture, en alternance.')}
    ${btn('mistake', canM, canM ? `${newM} nouvelle${newM > 1 ? 's' : ''} · ${dueM} à revoir <br><span class="muted small">${src.mined.length} repérée${src.mined.length > 1 ? 's' : ''} dans ${src.games} partie${src.games > 1 ? 's' : ''}</span>` : 'Aucune erreur repérée pour le moment.')}
    ${btn('opening', canO, fams.length ? `${fams.slice(0, 3).map((f) => esc(familyName(f.family))).join(', ')}${fams.length > 3 ? '…' : ''}${dueO ? `<br><span class="muted small">${dueO} à revoir</span>` : ''}` : dueO ? `${dueO} à revoir` : 'Aucune de vos ouvertures n’a de puzzles associés.')}
  </div>
  <p class="muted small">Un puzzle tiré d’une de vos parties accepte aussi les coups que le moteur jugeait équivalents au sien.</p>`;
}

// ------------------------------------------------------------------ session
export function leave() {
  S.seq++;
  clearTimeout(S.timer);
  S.timer = null;
  S.phase = 'idle';
}

function build(el) {
  el.innerHTML = `
  <h1 class="sr-only">Puzzles recommandés</h1>
  <div class="left">
    <div class="board-wrap"><div id="rec-board"></div></div>
  </div>
  <aside class="panel pz-panel" id="rec-panel" aria-label="Puzzles recommandés">
    <div class="phead">
      <a href="#/puzzles/recommend" class="icon-btn" title="Quitter la série" aria-label="Quitter"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle" id="rec-title">Puzzles recommandés</span>
    </div>
    <div class="popening" id="rec-sub"></div>
    <div id="rec-msg" class="tmsg" aria-live="polite"></div>
    <div class="tactions">
      <button id="rec-hint" class="btn" type="button">💡 Indice</button>
      <button id="rec-analyse" class="btn" type="button">Analyser la position</button>
      <button id="rec-next" class="btn primary" type="button">Suivant →</button>
    </div>
    <div class="tstats pz-stats" id="rec-stats"></div>
    <div id="rec-summary" class="pz-summary"></div>
  </aside>`;
  S.board = new Board($('#rec-board', el), { onMove: (from, to, promo) => userMove(from, to, promo) });
  $('#rec-hint', el).onclick = hint;
  $('#rec-next', el).onclick = () => next();
  $('#rec-analyse', el).onclick = analyse;
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'puzzlerec' || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(e.target.tagName)) return;
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && S.phase === 'resolved') { next(); e.preventDefault(); }
    else if (e.key === 'h' || e.key === 'i') hint();
  });
}

function setMsg(kind, html) {
  const m = $('#rec-msg');
  m.className = 'tmsg' + (kind ? ' ' + kind : '');
  m.innerHTML = html;
}

function renderStats() {
  $('#rec-stats').innerHTML = `
    <span><b>${S.ok}</b>réussis</span>
    <span><b>${S.ko}</b>ratés</span>
    <span><b>${S.elo}</b>niveau</span>
    <span><b>${Math.max(0, S.queue.length - S.idx - (S.run && S.run.verdict !== null ? 1 : 0))}</b>restants</span>`;
}

function reasonHtml(p) {
  const r = p.reason || {};
  if (r.kind === 'mistake') {
    const when = r.end ? ` du ${new Date(r.end * 1000).toLocaleDateString('fr-FR')}` : '';
    return `${esc(CLASS_LABEL[r.cls] || 'Erreur')} au coup ${r.move} de votre partie${when}${r.opponent ? ` contre ${esc(r.opponent)}` : ''} · <a href="#/game/${encodeURIComponent(r.gameId)}">voir la partie</a>`;
  }
  if (r.kind === 'opening') return `Ouverture : ${esc(frOpening(familyName(r.family)) || familyName(r.family))}`;
  return '';
}

export async function start(el, srcKey) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  leave();
  const retour = reprise(location.hash);
  if (retour) { retour(); return; }
  const seq = S.seq;
  S.src = SRC_LABEL[srcKey] ? srcKey : 'mix';
  S.phase = 'loading';
  S.ok = 0; S.ko = 0; S.idx = 0; S.run = null; S.queue = [];
  $('#rec-summary').innerHTML = '';
  $('#rec-hint').classList.remove('hidden');
  $('#rec-next').classList.add('hidden');
  $('#rec-analyse').classList.add('hidden');
  $('#rec-title').textContent = SRC_LABEL[S.src];
  $('#rec-sub').textContent = '';
  S.board.interactive = false;
  setMsg('', 'Préparation de la série…');
  try {
    const [src, cards, stats] = await Promise.all([loadSources(), allCards(), getStats()]);
    let openings = [];
    if (S.src !== 'mistake') {
      try {
        const manifest = await loadManifest();
        openings = await openingPool(manifest, playedFamilies(manifest, src.openingNames), stats.elo);
      } catch { /* hors ligne : on garde les erreurs seules */ }
    }
    if (seq !== S.seq) return;
    S.elo = S.startElo = stats.elo;
    S.queue = buildQueue({ src: S.src, size: SIZE, mined: src.mined, openings, cards });
  } catch (err) {
    if (seq !== S.seq) return;
    S.phase = 'idle';
    setMsg('wrong', `${esc(err.message)}<br><button class="btn" id="rec-retry" type="button">Réessayer</button>`);
    $('#rec-retry').onclick = () => start(el, srcKey);
    return;
  }
  if (!S.queue.length) {
    S.phase = 'idle';
    $('#rec-hint').classList.add('hidden');
    setMsg('info', 'Rien à proposer pour le moment : tout est à jour, ou aucune partie analysée. <a href="#/puzzles/recommend">Retour</a>');
    return;
  }
  nextPuzzle();
}

function nextPuzzle() {
  const p = S.queue[S.idx];
  S.run = new PuzzleRun(p);
  const st = S.run.start();
  S.hinted = false;
  S.reply = null;
  S.phase = 'playing';
  S.board.setOrientation(st.color);
  S.board.setPosition(st.fen, { lastMove: st.lastMove });
  S.board.interactive = true;
  $('#rec-hint').classList.remove('hidden');
  $('#rec-analyse').classList.remove('hidden');
  $('#rec-next').classList.add('hidden');
  $('#rec-sub').innerHTML = `Puzzle ${S.idx + 1} / ${S.queue.length} · ${reasonHtml(p)}`;
  setMsg('', `Trouvez le meilleur coup pour les ${st.color === 'w' ? 'Blancs' : 'Noirs'}.`);
  renderStats();
}

function hint() {
  if (S.phase !== 'playing' || !S.run || !S.run.expected) return;
  S.hinted = true;
  S.board.hl.clear();
  S.board.hl.add(S.run.expected.slice(0, 2));
  S.board.render();
  setMsg('hint', 'Déplacez la pièce mise en évidence.');
}

// Compte le résultat du puzzle, une seule fois (première erreur, analyse ou réussite).
async function record(success) {
  if (!S.run.settle(success)) return;
  if (success) S.ok++; else S.ko++;
  const p = S.run.puzzle;
  const hinted = S.hinted;
  S.elo = updateElo(S.elo, p.rating, success).user;
  const elo = S.elo;
  renderStats();
  try {
    await gradePuzzle(p, { success, hinted });
    const s = await getStats();
    s.elo = elo;
    await saveStats(s);
  } catch { /* stockage indisponible */ }
}

function solved() {
  S.phase = 'resolved';
  record(true); // sans effet si le puzzle est déjà compté raté
  S.board.interactive = false;
  if (S.run.verdict) setMsg('ok', S.hinted ? 'Résolu (avec indice).' : 'Bien joué !');
  else setMsg('ok', 'Trouvé ! Ce puzzle reste compté comme raté et reviendra en révision.');
  announce('Puzzle résolu.');
  $('#rec-hint').classList.add('hidden');
  const btn = $('#rec-next');
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
  $('#rec-hint').classList.add('hidden');
  $('#rec-next').classList.add('hidden');
  $('#rec-sub').textContent = '';
  setMsg('end', 'Série terminée !');
  $('#rec-summary').innerHTML = `<div class="pz-big" aria-label="${S.ok} sur ${n}">${S.ok}/${n}</div>
    <div class="pz-sub">puzzle${S.ok > 1 ? 's' : ''} réussi${S.ok > 1 ? 's' : ''} · niveau ${S.elo} (${gain >= 0 ? '+' : '−'}${Math.abs(gain)})</div>
    <div class="pz-sub muted">${S.ko ? 'Les puzzles ratés reviendront dans la prochaine série.' : ''}</div>
    <div class="tactions"><a class="btn" href="#/puzzles/recommend">Terminer</a><button id="rec-again" class="btn primary" type="button">Série suivante</button></div>`;
  const again = $('#rec-again');
  again.onclick = () => start($('#puzzlerec-view'), S.src);
  again.focus();
  announce(`Série terminée : ${S.ok} sur ${n}.`);
}
