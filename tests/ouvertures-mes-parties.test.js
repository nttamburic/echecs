import test from 'node:test';
import assert from 'node:assert/strict';
import { myGamesIndex, myGamesAt, filterOccurrence } from '../modules/openings.js';
import { epd } from '../analysis.js';

const START = epd('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
let id = 0;
function game(white, black, result, moves) {
  return { id: 'g' + ++id, white: { name: white }, black: { name: black }, pgn: `[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n\n${moves} ${result}` };
}

test('Mes parties · coups et résultats du point de vue du joueur, couleur du répertoire seulement', () => {
  const games = [
    game('Moi', 'A', '1-0', '1. e4 e5 2. Nf3'),
    game('Moi', 'B', '0-1', '1. e4 c5'),
    game('Moi', 'C', '1/2-1/2', '1. d4 d5'),
    game('D', 'Moi', '1-0', '1. e4 e5'), // avec les Noirs : ignorée pour un répertoire Blancs
    game('Moi', 'E', '*', '1. e4'), // sans résultat : ignorée
  ];
  const idx = myGamesIndex([{ games, user: 'moi' }], 'w');
  const s = myGamesAt(idx, START);
  assert.deepEqual([s.w, s.d, s.l], [1, 1, 1]);
  assert.deepEqual(s.moves.map((m) => [m.san, m.w, m.d, m.l]), [['e4', 1, 0, 1], ['d4', 0, 1, 0]]);
  // vue des Noirs : seule la partie contre D
  const b = myGamesAt(myGamesIndex([{ games, user: 'moi' }], 'b'), START);
  assert.deepEqual([b.w, b.d, b.l], [0, 0, 1]);
  // position jamais atteinte
  assert.deepEqual(myGamesAt(idx, 'x'), { w: 0, d: 0, l: 0, moves: [] });
});

test('Mes parties · une partie présente dans deux sources n\'est comptée qu\'une fois', () => {
  const g = game('Moi', 'A', '1-0', '1. e4');
  const s = myGamesAt(myGamesIndex([{ games: [g], user: 'Moi' }, { games: [g], user: 'Moi' }], 'w'), START);
  assert.equal(s.w, 1);
});

test('Filtre Occurrence · masque les coups sous le seuil, « Tous » garde tout', () => {
  const mv = (san, n) => ({ san, white: n, draws: 0, black: 0 });
  const moves = [mv('e4', 50), mv('d4', 30), mv('c4', 15), mv('Nf3', 4), mv('b3', 1)];
  const sans = (min) => filterOccurrence(moves, 100, min).map((m) => m.san);
  assert.deepEqual(sans(0), ['e4', 'd4', 'c4', 'Nf3', 'b3']);
  assert.deepEqual(sans(0.3), ['e4', 'd4']); // 30 % pile : gardé
  assert.deepEqual(sans(0.2), ['e4', 'd4']);
  assert.deepEqual(sans(0.1), ['e4', 'd4', 'c4']);
  assert.deepEqual(sans(0.05), ['e4', 'd4', 'c4']);
  assert.deepEqual(sans(0.01), ['e4', 'd4', 'c4', 'Nf3', 'b3']);
});
