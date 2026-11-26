import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { parseBackup, restoreAction } from '../core/backup.js';
import { repertoireToPgn, repertoiresToPgn, gameToPgn, gamesToPgn } from '../core/pgn-export.js';
import { newRepertoire, addLine, importPgn } from '../modules/openings.js';

const keys = (rep) => rep.edges.map((e) => `${e.fenBefore}|${e.uci}|${e.note || ''}`).sort();
function roundTrip(rep) {
  const copy = newRepertoire({ name: 'copie', color: rep.color, root: rep.root });
  const result = importPgn(copy, repertoireToPgn(rep));
  assert.deepEqual(result.errors, []);
  assert.equal(result.skipped, 0);
  assert.deepEqual(keys(copy), keys(rep));
}

test('PGN répertoire · variantes imbriquées, notes et transpositions survivent à un aller-retour', () => {
  const rep = newRepertoire({ name: 'Mon "répertoire"', color: 'w' });
  addLine(rep, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
  addLine(rep, ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5']);
  addLine(rep, ['e4', 'e5', 'Nf3', 'Nf6', 'd4']);
  addLine(rep, ['e4', 'c5', 'Nf3']);
  addLine(rep, ['d4', 'd5', 'c4']);
  addLine(rep, ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'd5']); // transposition
  addLine(rep, ['d4', 'd5', 'c4', 'e6', 'Nf3', 'Nf6', 'Nc3']);
  rep.edges[0].note = 'Centre {et} développement ; (avec parenthèses)\nsur deux lignes';
  rep.edges.at(-1).note = 'Fin';
  const copy = newRepertoire({ name: 'copie', color: 'w' });
  const result = importPgn(copy, repertoireToPgn(rep));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(copy.edges.map((e) => `${e.fenBefore}|${e.uci}`).sort(), rep.edges.map((e) => `${e.fenBefore}|${e.uci}`).sort());
  assert.equal(copy.edges.find((e) => e.uci === 'e2e4').note, 'Centre {et) développement ; (avec parenthèses) sur deux lignes');
  assert.match(repertoireToPgn(rep), /^\[Event "Mon \\"répertoire\\""\]/);
});

test('PGN répertoire · position de départ personnalisée avec les Noirs au trait', () => {
  const rep = newRepertoire({ name: 'Après e4', color: 'b', root: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' });
  addLine(rep, ['c5', 'Nf3', 'd6']);
  addLine(rep, ['e5', 'Nf3']);
  assert.match(repertoireToPgn(rep), /\[FEN "rnbqkbnr/);
  assert.match(repertoireToPgn(rep), /1\.\.\. c5 \(1\.\.\. e5 2\. Nf3\) 2\. Nf3 d6 \*/);
  roundTrip(rep);
});

test('PGN répertoire · répertoire vide et plusieurs répertoires', () => {
  const a = newRepertoire({ name: 'A', color: 'w' });
  const b = newRepertoire({ name: 'B', color: 'b' });
  addLine(b, ['e4', 'e6']);
  const text = repertoiresToPgn([a, b]);
  assert.equal(text.match(/\[Event /g).length, 2);
  assert.match(text, /\[Orientation "black"\]/);
});

const saved = {
  game: { end: 10, result: '1-0', white: { rating: 1200 }, black: { rating: 1180 },
    pgn: '[Event "Live Chess"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0' },
  positions: [{ lines: [{ pv: ['e2e4'], score: { cp: 30 } }], played: { pv: ['e2e4'], score: { cp: 30 } } }],
};

test('PGN partie · en-têtes, pendule et évaluation, partie relisible', () => {
  const pgn = gameToPgn(saved);
  assert.match(pgn, /\[White "A"\]/);
  assert.match(pgn, /1\. e4( \$\d)? \{\[%eval 0\.30\] \[%clk 0:03:00\]\} 1\.\.\. e5 2\. Qh5/);
  const chess = new Chess();
  chess.loadPgn(pgn);
  assert.equal(chess.history().length, 7);
});

test('PGN partie · aucune évaluation après le coup qui mate', () => {
  const positions = new Array(7).fill(null);
  positions[6] = { lines: [{ pv: ['h5f7'], score: { mate: 1 } }], played: { pv: ['h5f7'], score: { mate: 1 } } };
  assert.doesNotMatch(gameToPgn({ ...saved, positions }), /%eval/);
});

test('PGN parties · une partie illisible ne bloque pas les autres', () => {
  const r = gamesToPgn([saved, { game: { pgn: '1. e4 e4 *' }, positions: [] }]);
  assert.equal(r.count, 1);
  assert.equal(r.failed, 1);
});

const rec = (over = {}) => ({ col: 'analysis', id: 'g1', data: { v: 1 }, updatedAt: 100, file: 'analyses/2026-11.json', ...over });
const file = (records, over = {}) => JSON.stringify({ app: 'chess-journey', format: 1, exportedAt: '2026-11-26T10:00:00Z', records, ...over });

test('Sauvegarde · fichier valide accepté', () => {
  assert.equal(parseBackup(file([rec(), rec({ id: 'p', col: 'settings', file: 'settings.json' }), rec({ file: 'openings/events-2026-11.json' })])).records.length, 3);
});

test('Sauvegarde · fichiers étrangers, incomplets ou dangereux refusés', () => {
  assert.throws(() => parseBackup('{"app":"chess-journey","records":['), /illisible|lisible/);
  assert.throws(() => parseBackup('{"records":[]}'), /pas une sauvegarde/);
  assert.throws(() => parseBackup(file([], { format: 2 })), /autre version/);
  for (const bad of [{ file: '../x.json' }, { file: '/x.json' }, { file: '.github/workflows/x.json' }, { file: 'a.yml' }, { col: 'a/b' }, { id: '' }, { data: null }, { updatedAt: 'hier' }]) {
    assert.throws(() => parseBackup(file([rec(), rec(bad)])), /invalides/, JSON.stringify(bad));
  }
});

test('Restauration · ne remplace jamais une donnée plus récente', () => {
  assert.equal(restoreAction(rec(), undefined), 'add');
  assert.equal(restoreAction(rec(), { deleted: true, updatedAt: 999 }), 'recover');
  assert.equal(restoreAction(rec(), { data: { v: 1 }, updatedAt: 999 }), 'same');
  assert.equal(restoreAction(rec(), { data: { v: 2 }, updatedAt: 99 }), 'update');
  assert.equal(restoreAction(rec(), { data: { v: 2 }, updatedAt: 101 }), 'keep');
});
