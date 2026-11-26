// Export PGN des répertoires et des parties analysées (lisible par Lichess, chess.com, ChessBase…).
import { Chess } from '../vendor/chess.js';
import { classifyGame, epd } from '../analysis.js';
import { childrenOf, START_FEN } from '../modules/openings.js';

const tag = (k, v) => `[${k} "${String(v).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
// Un commentaire PGN ne peut pas contenir d'accolade fermante, et reste sur une ligne.
const comment = (text) => `{${String(text).replace(/\}/g, ')').replace(/\s+/g, ' ').trim()}}`;
const numberOf = (fen, force) => {
  const f = fen.split(' ');
  const n = Number(f[5]) || 1;
  if (f[1] === 'w') return `${n}. `;
  return force ? `${n}... ` : '';
};

// ------------------------------------------------------------------ répertoires
// Le répertoire est un ensemble d'arêtes : la suite d'une position atteinte par plusieurs ordres de
// coups n'est écrite qu'une fois (l'import les rejoint). Les coups désactivés sont exportés ; l'état
// « désactivé » et la maîtrise n'existent que dans la sauvegarde JSON.
export function repertoireToPgn(rep) {
  const tokens = [];
  const done = new Set();
  // « fen » complète, pour numéroter les coups ; les arêtes ne gardent que l'EPD.
  const write = (fen, edge, force) => {
    const chess = new Chess(fen);
    chess.move({ from: edge.uci.slice(0, 2), to: edge.uci.slice(2, 4), promotion: edge.uci[4] });
    tokens.push(numberOf(fen, force) + edge.san);
    if (edge.note) tokens.push(comment(edge.note));
    return chess.fen();
  };
  const line = (start, force) => {
    let fen = start;
    for (;;) {
      const key = epd(fen);
      if (done.has(key)) return;
      done.add(key);
      const [main, ...others] = childrenOf(rep, fen);
      if (!main) return;
      const next = write(fen, main, force);
      for (const alt of others) {
        tokens.push('(');
        line(write(fen, alt, true), !!alt.note);
        tokens.push(')');
      }
      force = others.length > 0 || !!main.note;
      fen = next;
    }
  };
  const root = rep.root.split(' ').length >= 6 ? rep.root : `${rep.root} 0 1`;
  line(root, true);
  const head = [tag('Event', rep.name), tag('Site', 'Chess Journey'), tag('Orientation', rep.color === 'b' ? 'black' : 'white'), tag('Result', '*')];
  if (epd(root) !== epd(START_FEN)) head.push(tag('SetUp', '1'), tag('FEN', root));
  return `${head.join('\n')}\n\n${[...tokens, '*'].join(' ').replace(/\( /g, '(').replace(/ \)/g, ')')}\n`;
}

export const repertoiresToPgn = (reps) => reps.map(repertoireToPgn).join('\n');

// ------------------------------------------------------------------ parties analysées
const NAG = { brilliant: '$3', great: '$1', inaccuracy: '$6', mistake: '$2', miss: '$2', blunder: '$4' };
const evalTag = (score) => {
  if (!score) return '';
  if (score.mate !== undefined) return score.mate ? `[%eval #${score.mate}]` : '';
  return `[%eval ${(score.cp / 100).toFixed(2)}]`;
};

// « saved » : enregistrement « analysis » { game, positions }. « book » : base des ouvertures.
export function gameToPgn(saved, book = {}) {
  const { game, positions = [] } = saved;
  const source = new Chess();
  source.loadPgn(game.pgn);
  const moves = source.history({ verbose: true });
  const comments = new Map(source.getComments().map((c) => [c.fen, c.comment])); // pendules d'origine
  const results = classifyGame(moves, moves.map((_, i) => positions[i] || null), { w: game.white?.rating, b: game.black?.rating }, book);
  const headers = game.pgn.split(/\r?\n/).filter((l) => /^\[\w+ ".*"\]\s*$/.test(l));
  const tokens = [];
  let force = true;
  moves.forEach((m, i) => {
    tokens.push(numberOf(m.before, force) + m.san);
    const r = results[i];
    if (r && NAG[r.cls]) tokens.push(NAG[r.cls]);
    // Pas d'évaluation après le coup qui mate : l'appli la note « mat en 1 », ce qui serait faux ici.
    const evaluation = m.san.endsWith('#') ? '' : evalTag(positions[i]?.played?.score);
    const text = [evaluation, comments.get(m.after) || ''].filter(Boolean).join(' ');
    if (text) tokens.push(comment(text));
    force = !!text;
  });
  tokens.push(game.result || '*');
  return `${headers.join('\n')}\n\n${tokens.join(' ')}\n`;
}

// Toutes les parties analysées, des plus récentes aux plus anciennes. Une partie illisible est
// comptée dans « failed » sans bloquer les autres.
export function gamesToPgn(list, book = {}) {
  const out = [];
  let failed = 0;
  for (const saved of [...list].sort((a, b) => (b.game?.end || 0) - (a.game?.end || 0))) {
    try { out.push(gameToPgn(saved, book)); } catch { failed++; }
  }
  return { text: out.join('\n'), count: out.length, failed };
}
