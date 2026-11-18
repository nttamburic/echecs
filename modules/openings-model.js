// Module « Ouvertures » — parties modèles.
// Une partie de maître (base Masters de Lichess) qui passe par une position du répertoire : on la
// rejoue en devinant les coups de son camp (celui du répertoire). Les coups adverses se jouent
// tout seuls. « Indice » nomme la pièce, puis montre le coup ; « Montrer le coup » passe au suivant.
// La courbe d'évaluation se calcule en tâche de fond (cloud Lichess d'abord, sinon Stockfish).
import { Chess } from '../vendor/chess.js';
import { Board } from '../board.js';
import { epd, winPct, fmtScore } from '../analysis.js';
import { $, esc, local, toast } from '../core/ui.js';
import { explore, masterPgn, lichessCfg } from '../core/lichess.js';
import { analyzePosition } from '../core/engine.js';
import { getRepertoire, childrenOf, reachableEdges, pathTo, fenOf } from './openings.js';
import { figSan, stashFree } from './analyse.js';

const M = { seq: 0, board: null, rep: null, from: null, game: null, ply: 0, tries: 0, hint: 0, ok: 0, total: 0, evals: [], done: false, msg: '', busy: false };
const PIECE = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const HIST_KEY = 'modelHistory';
const EVAL_DEPTH = 14;

// ------------------------------------------------------------------ historique
export function modelHistory() {
  try { const v = JSON.parse(local.get(HIST_KEY, '[]')); return Array.isArray(v) ? v : []; } catch { return []; }
}
function remember(entry) {
  const list = modelHistory().filter((h) => h.id !== entry.id);
  list.unshift(entry);
  local.set(HIST_KEY, JSON.stringify(list.slice(0, 50)));
}

// ------------------------------------------------------------------ choix d'une partie
// Positions de départ : celle demandée, sinon les fins de lignes du répertoire (les plus profondes
// d'abord, un peu de hasard). Si une position n'a aucune partie de maître, on remonte la ligne.
function leaves(rep) {
  const edges = reachableEdges(rep, true);
  const ends = edges.filter((e) => !childrenOf(rep, e.fenAfter).some((x) => !x.disabled));
  const depth = (e) => { const p = pathTo(rep, rep.root, e.fenAfter, true); return p ? p.length : 0; };
  return ends.map((e) => ({ epd: e.fenAfter, d: depth(e) + Math.random() * 3 })).sort((a, b) => b.d - a.d).map((x) => x.epd);
}
export async function findGame(rep, from, seen = new Set()) {
  const starts = from && from !== epd(rep.root) ? [from] : leaves(rep).slice(0, 6);
  if (!starts.length) starts.push(epd(rep.root));
  let tried = 0;
  for (const s of starts) {
    const line = pathTo(rep, rep.root, s) || [];
    // la position, puis en remontant la ligne (au plus 6 crans)
    const chain = [s, ...line.map((e) => e.fenBefore).reverse()].slice(0, 7);
    for (const p of chain) {
      if (++tried > 12) return null;
      const j = await explore('masters', fenOf(p), { moves: 1, topGames: 15 });
      const games = ((j && j.topGames) || []).filter((g) => !seen.has(g.id));
      if (games.length) {
        const g = games[Math.floor(Math.random() * Math.min(games.length, 5))];
        return { id: g.id, epd: p, white: g.white, black: g.black, year: g.year, winner: g.winner };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ vue
function build(el) {
  el.innerHTML = `
  <h1 class="sr-only">Partie modèle</h1>
  <div class="left">
    <div class="board-wrap"><div id="model-board"></div></div>
  </div>
  <aside class="panel" id="model-panel" aria-label="Partie modèle">
    <div class="phead">
      <a href="#/openings" class="icon-btn" id="model-back" title="Revenir au répertoire" aria-label="Revenir"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle" id="model-title">Partie modèle</span>
    </div>
    <div class="popening" id="model-sub"></div>
    <div id="model-msg" class="tmsg" role="status" aria-live="polite"></div>
    <div class="tactions">
      <button id="model-hint" class="btn">💡 Indice</button>
      <button id="model-show" class="btn">Montrer le coup</button>
      <button id="model-other" class="btn primary">Une autre partie →</button>
    </div>
    <div class="model-curve" id="model-curve" aria-hidden="true"></div>
    <div class="pmoves" id="model-moves"></div>
    <div class="tactions">
      <button id="model-analyse" class="btn small">Ouvrir dans l'analyse</button>
    </div>
    <div id="model-hist" class="model-hist"></div>
  </aside>`;
  M.board = new Board($('#model-board', el), { onMove: (from, to, promo) => userMove(from + to + (promo || '')) });
  $('#model-hint', el).onclick = hint;
  $('#model-show', el).onclick = showMove;
  $('#model-other', el).onclick = () => another();
  $('#model-analyse', el).onclick = openAnalysis;
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'model' || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'i' || e.key === 'h') { hint(); e.preventDefault(); }
    else if (e.key === 'Enter' && M.done) { another(); e.preventDefault(); }
  });
}

export function leave() { M.seq++; M.busy = false; }

// sub : 'p:<epd>' (partir de cette position) ou 'g:<id>' (revoir une partie de l'historique)
export async function start(el, repId, sub) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  leave();
  const seq = M.seq;
  M.rep = await getRepertoire(repId);
  if (seq !== M.seq) return;
  $('#model-back').href = M.rep ? '#/openings/' + encodeURIComponent(M.rep.id) : '#/openings';
  if (!M.rep) { setMsg('Répertoire introuvable.'); return; }
  M.from = sub && sub.startsWith('p:') ? sub.slice(2) : null;
  M.board.setOrientation(M.rep.color);
  renderHist();
  if (sub && sub.startsWith('g:')) {
    const h = modelHistory().find((x) => x.id === sub.slice(2));
    await load(h ? { id: h.id, white: h.white, black: h.black, year: h.year } : { id: sub.slice(2) }, seq);
  } else await another(seq);
}

async function another(seq = M.seq) {
  if (M.busy) return;
  if (!lichessCfg.connected) { blank(); setMsg('Les parties modèles viennent de la base Masters de Lichess : enregistrez un jeton Lichess (Paramètres → Connexion).'); return; }
  M.busy = true;
  blank();
  setMsg('Recherche d’une partie de maître qui suit votre répertoire…');
  let g = null;
  try { g = await findGame(M.rep, M.from, new Set(modelHistory().map((h) => h.id).concat(M.game ? [M.game.id] : []))); }
  catch (e) { if (seq === M.seq) setMsg('Explorateur Masters indisponible : ' + esc(e.message) + '.'); M.busy = false; return; }
  M.busy = false;
  if (seq !== M.seq) return;
  if (!g) { setMsg('Aucune nouvelle partie de maître trouvée sur les lignes de ce répertoire (les lignes trop rares n’en ont pas). Essayez depuis une autre position.'); return; }
  await load(g, seq);
}

function blank() {
  M.game = null; M.done = false;
  M.board.setPosition(fenOf(M.rep ? M.rep.root : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'));
  M.board.interactive = false;
  $('#model-sub').textContent = '';
  $('#model-moves').innerHTML = '';
  $('#model-curve').innerHTML = '';
  buttons();
}

async function load(g, seq) {
  setMsg('Téléchargement de la partie…');
  let pgn;
  try { pgn = await masterPgn(g.id); } catch (e) { if (seq === M.seq) setMsg('Partie indisponible : ' + esc(e.message) + '.'); return; }
  if (seq !== M.seq) return;
  const c = new Chess();
  try { c.loadPgn(pgn); } catch { setMsg('PGN illisible pour cette partie.'); return; }
  const head = (typeof c.getHeaders === 'function' ? c.getHeaders() : c.header()) || {};
  const moves = c.history({ verbose: true });
  if (!moves.length) { setMsg('Partie vide.'); return; }
  const name = (p, h) => (p && p.name) || h || '?';
  M.game = {
    id: g.id, moves, start: moves[0].before,
    white: name(g.white, head.White), black: name(g.black, head.Black),
    whiteElo: (g.white && g.white.rating) || head.WhiteElo || '', blackElo: (g.black && g.black.rating) || head.BlackElo || '',
    year: g.year || (head.Date || '').slice(0, 4), result: head.Result || '', event: head.Event || '',
  };
  M.ply = 0; M.tries = 0; M.hint = 0; M.ok = 0; M.total = 0; M.done = false;
  M.evals = new Array(moves.length + 1).fill(null);
  const gm = M.game;
  $('#model-title').textContent = `${gm.white} – ${gm.black}`;
  $('#model-sub').textContent = [gm.whiteElo && gm.blackElo ? `${gm.whiteElo} – ${gm.blackElo}` : '', gm.event, gm.year, gm.result].filter(Boolean).join(' · ');
  remember({ id: gm.id, repId: M.rep.id, white: gm.white, black: gm.black, year: gm.year, result: gm.result, at: Date.now() });
  renderHist();
  evalInBackground(seq);
  advance(seq);
}

// Joue les coups adverses jusqu'au prochain coup de l'utilisateur.
function advance(seq) {
  const gm = M.game;
  if (!gm || seq !== M.seq) return;
  if (M.ply >= gm.moves.length) return finish();
  const m = gm.moves[M.ply];
  if (m.color !== M.rep.color) {
    M.board.interactive = false;
    render();
    setTimeout(() => { if (seq !== M.seq || M.game !== gm) return; M.ply++; advance(seq); }, M.ply === 0 ? 300 : 650);
    return;
  }
  M.tries = 0; M.hint = 0;
  M.board.interactive = true;
  if (!M.msg || !M.keepMsg) setMsg(`À vous : quel coup a joué ${M.rep.color === 'w' ? gm.white : gm.black} ?`);
  M.keepMsg = false;
  render();
}

function userMove(uci) {
  const gm = M.game;
  if (!gm || M.done || M.ply >= gm.moves.length) return;
  const m = gm.moves[M.ply];
  if (m.color !== M.rep.color) return;
  const want = m.from + m.to + (m.promotion || '');
  const fen = M.ply ? gm.moves[M.ply - 1].after : gm.start;
  if (uci.slice(0, 4) === want.slice(0, 4) && (uci.length < 5 || uci === want)) {
    M.total++;
    if (!M.tries && !M.hint) M.ok++;
    setMsg(`✓ ${esc(figSan(m.san, m.color))} : c’est le coup de la partie${M.tries || M.hint ? '' : ' (du premier coup)'}.`);
    M.keepMsg = true;
    M.ply++;
    advance(M.seq);
    return;
  }
  M.tries++;
  let san = uci;
  try { san = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }).san; } catch { /* coup illégal : refusé par l'échiquier */ }
  setMsg(`✗ ${esc(figSan(san, M.rep.color))} n’est pas le coup de la partie. Réessayez, ou demandez un indice.`);
  render();
}

function hint() {
  const gm = M.game;
  if (!gm || M.done || M.ply >= gm.moves.length) return;
  const m = gm.moves[M.ply];
  if (m.color !== M.rep.color) return;
  M.hint = Math.min(2, M.hint + 1);
  setMsg(M.hint === 1 ? `💡 Jouez votre ${PIECE[m.piece]} de ${m.from}.` : `💡 Le coup de la partie : la flèche verte.`);
  render();
}

function showMove() {
  const gm = M.game;
  if (!gm || M.done || M.ply >= gm.moves.length) return;
  const m = gm.moves[M.ply];
  if (m.color !== M.rep.color) return;
  M.total++;
  setMsg(`Le coup de la partie : ${esc(figSan(m.san, m.color))}.`);
  M.keepMsg = true;
  M.ply++;
  advance(M.seq);
}

function finish() {
  const gm = M.game;
  M.done = true;
  M.board.interactive = false;
  const h = modelHistory().find((x) => x.id === gm.id);
  if (h) { h.ok = M.ok; h.total = M.total; local.set(HIST_KEY, JSON.stringify(modelHistory().map((x) => (x.id === gm.id ? h : x)))); }
  setMsg(`Fin de la partie (${esc(gm.result || '?')}). Vous avez trouvé <b>${M.ok}</b> coup${M.ok > 1 ? 's' : ''} sur ${M.total} du premier coup. « Une autre partie » (Entrée) pour continuer.`);
  render();
  renderHist();
}

function openAnalysis() {
  const gm = M.game;
  if (!gm) return;
  stashFree({ fen: gm.start, ucis: gm.moves.map((m) => m.from + m.to + (m.promotion || '')), orient: M.rep.color });
  location.hash = '#/free/new';
}

// ------------------------------------------------------------------ évaluation en tâche de fond
async function evalInBackground(seq) {
  const gm = M.game;
  for (let k = 0; k <= gm.moves.length; k++) {
    if (seq !== M.seq || M.game !== gm) return;
    const fen = k ? gm.moves[k - 1].after : gm.start;
    const c = new Chess(fen);
    if (c.isCheckmate()) { M.evals[k] = c.turn() === 'w' ? 0 : 100; continue; }
    if (c.isDraw()) { M.evals[k] = 50; continue; }
    try {
      const r = await analyzePosition(fen, null, { cloud: true, depth: EVAL_DEPTH });
      if (r && !r.miss && r.lines[0]) M.evals[k] = { wp: winPct(r.lines[0].score, 'w'), score: r.lines[0].score };
    } catch { /* moteur indisponible : la courbe reste partielle */ }
    if (k <= M.ply) renderCurve();
  }
}

// ------------------------------------------------------------------ rendu
function setMsg(html) { M.msg = html; const el = $('#model-msg'); if (el) el.innerHTML = html; }

function buttons() {
  const myTurn = M.game && !M.done && M.ply < M.game.moves.length && M.game.moves[M.ply].color === M.rep.color;
  $('#model-hint').disabled = !myTurn;
  $('#model-show').disabled = !myTurn;
  $('#model-analyse').disabled = !M.game;
}

function render() {
  const gm = M.game;
  if (!gm) return;
  const fen = M.ply ? gm.moves[M.ply - 1].after : gm.start;
  const last = M.ply ? gm.moves[M.ply - 1] : null;
  const m = gm.moves[M.ply];
  const arrows = M.hint === 2 && m ? [{ from: m.from, to: m.to, color: '#4caf50' }] : [];
  M.board.setPosition(fen, { lastMove: last ? [last.from, last.to] : null, arrows });
  // coups dévoilés
  // une rangée par numéro de coup (comme le module Jouer)
  let h = '';
  const no0 = Number(gm.start.split(' ')[5]) || 1;
  const off = gm.start.split(' ')[1] === 'b' ? 1 : 0; // partie commencée par les Noirs : case blanche vide
  const cell = (i) => {
    if (i < 0 || i >= M.ply) return '<span class="mv empty"></span>';
    const mv = gm.moves[i];
    return `<span class="mv${i === M.ply - 1 ? ' cur' : ''}"><span class="san">${figSan(mv.san, mv.color)}</span></span>`;
  };
  for (let k = 0; k * 2 - off < M.ply; k++) {
    h += `<div class="mrow"><span class="mno">${no0 + k}.</span>${cell(k * 2 - off)}${cell(k * 2 + 1 - off)}</div>`;
  }
  if (M.done && M.ply === gm.moves.length) h += `<div class="mrow"><b class="pad">${esc(gm.result)}</b></div>`;
  const el = $('#model-moves');
  el.innerHTML = h || '<p class="muted pad">Aucun coup joué.</p>';
  el.scrollTop = el.scrollHeight;
  renderCurve();
  buttons();
}

function renderCurve() {
  const gm = M.game;
  const box = $('#model-curve');
  if (!gm || !box) return;
  const n = gm.moves.length;
  const W = 300, H = 60;
  const pts = [];
  for (let k = 0; k <= Math.min(M.ply, n); k++) {
    const e = M.evals[k];
    const wp = e == null ? null : typeof e === 'number' ? e : e.wp;
    if (wp == null) continue;
    pts.push(`${((k / Math.max(1, n)) * W).toFixed(1)},${(H - (wp / 100) * H).toFixed(1)}`);
  }
  const cur = M.evals[Math.min(M.ply, n)];
  const label = cur && typeof cur === 'object' ? fmtScore(cur.score) : '';
  const known = M.evals.filter((x) => x != null).length;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="curve">
      <rect x="0" y="0" width="${W}" height="${H / 2}" class="c-black"/><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}" class="c-white"/>
      <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="c-mid"/>
      ${pts.length > 1 ? `<polyline points="${pts.join(' ')}" class="c-line"/>` : ''}
    </svg><span class="muted small">Évaluation${label ? ` : <b>${esc(label)}</b>` : ''}${known < n + 1 ? ` · calcul ${known}/${n + 1}` : ''}</span>`;
}

function renderHist() {
  const box = $('#model-hist');
  if (!box) return;
  const list = modelHistory().filter((h) => !M.rep || h.repId === M.rep.id).slice(0, 8);
  box.innerHTML = list.length ? `<h2 class="small">Parties déjà vues</h2><ul>${list.map((h) => `<li><a href="#/openings/model/${encodeURIComponent(h.repId)}/g:${encodeURIComponent(h.id)}">${esc(h.white)} – ${esc(h.black)}</a> <span class="muted small">${esc(h.year || '')} · ${esc(h.result || '')}${h.total ? ` · ${h.ok}/${h.total}` : ''}</span></li>`).join('')}</ul>` : '';
}
