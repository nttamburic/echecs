// Puzzles tirés des parties de l'utilisateur : chaque gaffe, erreur ou occasion manquée d'une partie
// analysée devient un puzzle dont la solution est la meilleure ligne trouvée par le moteur.
//
// Un puzzle suit le format de core/puzzle-data.js : `fen` est la position AVANT le coup de l'adversaire
// qui précède l'erreur, moves[0] ce coup de l'adversaire (joué automatiquement), puis la meilleure ligne
// (1, 2 ou 3 coups du joueur). `alt` liste les autres premiers coups que le moteur jugeait équivalents.
import { Chess } from '../vendor/chess.js';
import { classifyGame, winPct } from '../analysis.js';
import { estTactique } from './manu/erreurs.js';
import { couleurDe } from './joueur.js';

export const MISTAKE_CLASSES = ['blunder', 'mistake', 'miss'];
export const CLASS_LABEL = { blunder: 'Gaffe', mistake: 'Erreur', miss: 'Occasion manquée' };
const MAX_PLAYER_MOVES = 3;
const ALT_TOLERANCE = 2; // points de probabilité de gain : sous ce seuil, un autre coup est jugé équivalent

const uciOf = (m) => m.from + m.to + (m.promotion || '');

// Garde le début de la ligne qui est jouable, au plus `max` coups du joueur, en finissant par un coup du joueur.
function playableLine(fen, pv, max = MAX_PLAYER_MOVES) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max * 2 - 1)) {
    try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    out.push(u);
  }
  if (out.length % 2 === 0) out.pop();
  return out;
}

// a : enregistrement d'analyse { game: { id, pgn, white, black, end }, positions }. user : pseudo chess.com.
// book : table des ouvertures (openings.json) pour ne pas compter les coups de théorie. Renvoie une liste de puzzles.
function candidats(a, user, book) {
  if (!a || !a.game || !a.positions || !a.game.pgn) return { out: [] };
  const g = a.game;
  const color = couleurDe(g, user);
  if (!color) return { out: [] };
  let mv;
  try {
    const c = new Chess();
    c.loadPgn(g.pgn);
    mv = c.history({ verbose: true });
  } catch { return { out: [] }; }
  const res = classifyGame(mv, a.positions.slice(0, mv.length), { w: g.white.rating, b: g.black.rating }, book);
  const mine = color === 'w' ? g.white : g.black;
  const opp = color === 'w' ? g.black : g.white;
  const rating = Number.isFinite(Number(mine.rating)) && mine.rating >= 400 && mine.rating <= 3200 ? Number(mine.rating) : 1200;
  const out = [];
  res.forEach((r, i) => {
    if (!r || mv[i].color !== color || !MISTAKE_CLASSES.includes(r.cls) || i < 1) return;
    const pos = a.positions[i];
    const best = pos && pos.lines && pos.lines[0];
    if (!best || !best.pv || !best.pv.length) return;
    const line = playableLine(mv[i].before, best.pv);
    if (!line.length) return;
    const winBest = winPct(best.score, color);
    const alt = (pos.lines || []).slice(1)
      .filter((l) => l.pv && l.pv[0] && l.pv[0] !== line[0] && winPct(l.score, color) >= winBest - ALT_TOLERANCE)
      .map((l) => l.pv[0]);
    const puzzle = {
      id: `g:${g.id}:${i + 1}`,
      fen: mv[i - 1].before,
      moves: [uciOf(mv[i - 1]), ...line],
      alt,
      rating,
      themes: [],
      openingTags: [],
      source: 'mistake',
      reason: { kind: 'mistake', cls: r.cls, gameId: g.id, move: Math.floor(i / 2) + 1, opponent: opp && opp.name || '', end: g.end || null },
    };
    out.push({ puzzle, i, best });
  });
  return { mv, out };
}

// Effectif de l’ancien flux, utilisé par le banc de comparaison.
export function compterAvantFiltre(a, user, book = {}) {
  return candidats(a, user, book).out.length;
}

export function mineGame(a, user, book = {}) {
  const { mv, out } = candidats(a, user, book);
  return out.filter(({ i, best }) => {
    const refutation = [uciOf(mv[i]), ...(a.positions[i + 1]?.lines?.[0]?.pv ?? [])];
    return estTactique(mv[i].before, best.pv, refutation, mv[i - 1]).tactique;
  }).map(({ puzzle }) => puzzle);
}

// Toutes les parties analysées. `rows` : résultat de store.all('analysis').
export function mineAll(rows, user, book = {}) {
  const out = [];
  for (const r of rows) {
    try { out.push(...mineGame(r.data, user, book)); } catch { /* partie illisible : ignorée */ }
  }
  return out;
}
