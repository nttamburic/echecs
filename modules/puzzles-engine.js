// Moteur commun des puzzles : déroulement d'un puzzle et classement Elo. Aucun accès au DOM :
// l'échiquier, le chrono et les modes (rush, thèmes, recommandé) se branchent par-dessus.
//
// Un puzzle (format de core/puzzle-data.js) : { id, fen, moves: [uci…], rating, … }. La position `fen`
// est celle AVANT le premier coup de l'adversaire. moves[0] est donc joué automatiquement, puis le
// joueur doit trouver moves[1], l'adversaire répond moves[2], etc.

import { Chess } from '../vendor/chess.js';

export const ELO_START = 1200;
export const ELO_K = 32;

const uciOf = (m) => m.from + m.to + (m.promotion || '');

// Joue un coup UCI. Renvoie le coup (objet chess.js) ou null s'il est illégal.
function playUci(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

export class PuzzleRun {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.chess = new Chess(puzzle.fen);
    this.idx = 0; // prochain coup attendu dans puzzle.moves
    this.status = 'ready'; // ready -> playing -> solved | failed
    this.mistakes = 0;
  }

  // Joue le coup de l'adversaire. Renvoie l'état à afficher : le joueur joue la couleur qui a le trait ensuite.
  start() {
    const first = playUci(this.chess, this.puzzle.moves[0]);
    if (!first) throw new Error(`Puzzle ${this.puzzle.id} invalide : coup ${this.puzzle.moves[0]}`);
    this.idx = 1;
    this.status = 'playing';
    this.color = this.chess.turn(); // couleur du joueur
    return { fen: this.chess.fen(), lastMove: [first.from, first.to], color: this.color };
  }

  get fen() { return this.chess.fen(); }

  // Le prochain coup attendu du joueur (UCI), pour l'afficher après une erreur ou en indice.
  get expected() { return this.puzzle.moves[this.idx] || null; }

  // Coup du joueur, depuis l'échiquier. Résultat :
  //   { ok: false, expected }                     : mauvais coup (le puzzle est échoué, la position n'a pas changé)
  //   { ok: true, done, fen, lastMove, reply }    : bon coup ; `reply` est la réponse de l'adversaire
  //                                                 ({ uci, fen, lastMove }) ou null si le puzzle est terminé.
  move(from, to, promotion) {
    if (this.status !== 'playing') throw new Error('Puzzle non démarré ou déjà terminé.');
    const want = this.puzzle.moves[this.idx];
    const probe = new Chess(this.chess.fen());
    let m;
    try { m = probe.move({ from, to, promotion }); } catch { m = null; }
    if (!m) return { ok: false, illegal: true, expected: want };

    // Bon coup : celui de la solution, n'importe quel mat (comme Lichess : une autre façon de mater est valable),
    // ou, pour les puzzles tirés de vos parties, un des autres premiers coups que le moteur jugeait équivalents (`alt`).
    const isSolution = uciOf(m) === want;
    const isAlt = this.idx === 1 && Array.isArray(this.puzzle.alt) && this.puzzle.alt.includes(uciOf(m));
    if (!isSolution && !isAlt && !probe.isCheckmate()) {
      this.status = 'failed';
      this.mistakes++;
      return { ok: false, expected: want };
    }
    this.chess = probe;
    this.idx++;
    const out = { ok: true, fen: this.chess.fen(), lastMove: [m.from, m.to], done: false, reply: null };
    if (!isSolution || this.idx >= this.puzzle.moves.length) {
      this.status = 'solved';
      out.done = true;
      return out;
    }
    const replyUci = this.puzzle.moves[this.idx];
    const r = playUci(this.chess, replyUci);
    if (!r) throw new Error(`Puzzle ${this.puzzle.id} invalide : coup ${replyUci}`);
    this.idx++;
    out.reply = { uci: replyUci, fen: this.chess.fen(), lastMove: [r.from, r.to] };
    return out;
  }

  // Abandon (temps écoulé, bouton « passer ») : compte comme un échec.
  giveUp() {
    if (this.status === 'playing') this.status = 'failed';
  }
}

// ------------------------------------------------------------------ Elo (formule logistique de Lichess)

export const expectedScore = (user, puzzle) => 1 / (1 + 10 ** ((puzzle - user) / 400));

// success : true/false (ou un score entre 0 et 1). Renvoie les nouveaux niveaux de l'utilisateur et du puzzle.
// Le puzzle bouge dans l'autre sens, mais d'un pas plus faible pour que le classement des puzzles reste stable.
export function updateElo(user, puzzle, success, { k = ELO_K } = {}) {
  const result = success === true ? 1 : success === false ? 0 : success;
  const exp = expectedScore(user, puzzle);
  return {
    user: Math.round(user + k * (result - exp)),
    puzzle: Math.round(puzzle - (k / 4) * (result - exp)),
    expected: exp,
  };
}
