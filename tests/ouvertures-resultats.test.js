import test from 'node:test';
import assert from 'node:assert/strict';
import { openingResults, DRAWS } from '../modules/openings.js';

const OPP = { win: 'resigned', resigned: 'win', checkmated: 'win', timeout: 'win' };
function entry(color, result, opening, user = 'Moi') {
  const mine = { name: user, result };
  const other = { name: 'Adversaire', result: OPP[result] || result };
  return { opening, game: color === 'w' ? { white: mine, black: other } : { white: other, black: mine } };
}
const times = (n, ...args) => Array.from({ length: n }, () => entry(...args));
const sum = (r) => r.pw + r.pd + r.pl;

test('Résultats par ouverture · aucune partie ou aucun pseudo', () => {
  const empty = { total: 0, unnamed: 0, count: 0, rows: [] };
  assert.deepEqual(openingResults([], 'Moi'), empty);
  assert.deepEqual(openingResults([entry('w', 'win', 'Italian Game')], ''), empty);
  assert.deepEqual(openingResults([entry('w', 'win', 'Italian Game')], undefined), empty);
});

test('Résultats par ouverture · point de vue du joueur avec les deux couleurs, pseudo sans casse', () => {
  const r = openingResults([
    entry('w', 'win', 'Italian Game'),
    entry('b', 'win', 'Sicilian Defense'),
    entry('b', 'checkmated', 'Sicilian Defense'),
    entry('b', 'timeout', 'Sicilian Defense'),
  ], 'mOI');
  assert.equal(r.total, 4);
  assert.deepEqual(r.rows.map((x) => [x.family, x.color, x.n, x.w, x.d, x.l]), [
    ['Sicilian Defense', 'b', 3, 1, 0, 2],
    ['Italian Game', 'w', 1, 1, 0, 0],
  ]);
});

test('Résultats par ouverture · tous les codes de nulle chess.com', () => {
  const r = openingResults(DRAWS.map((code) => entry('w', code, 'Italian Game')), 'Moi');
  assert.equal(r.rows[0].d, DRAWS.length);
  assert.equal(r.rows[0].pd, 100);
});

test('Résultats par ouverture · variantes réunies par famille, couleurs séparées', () => {
  const r = openingResults([
    entry('w', 'win', 'Sicilian Defense: Najdorf Variation'),
    entry('w', 'resigned', 'Sicilian Defense: Dragon Variation, Yugoslav Attack'),
    entry('w', 'agreed', 'Sicilian Defense'),
    entry('b', 'win', 'Sicilian Defense: Najdorf Variation'),
  ], 'Moi');
  assert.equal(r.count, 2);
  assert.deepEqual(r.rows.map((x) => [x.family, x.color, x.n]), [['Sicilian Defense', 'w', 3], ['Sicilian Defense', 'b', 1]]);
});

test('Résultats par ouverture · les 5 plus jouées, classées par nombre de parties', () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const r = openingResults(names.flatMap((f, i) => times(i + 1, 'w', 'win', f)), 'Moi');
  assert.equal(r.count, 7);
  assert.equal(r.total, 28);
  assert.deepEqual(r.rows.map((x) => x.family), ['G', 'F', 'E', 'D', 'C']);
});

test('Résultats par ouverture · égalité départagée par le nom puis Blancs avant Noirs', () => {
  const r = openingResults([entry('w', 'win', 'B'), entry('b', 'win', 'A'), entry('w', 'win', 'A')], 'Moi');
  assert.deepEqual(r.rows.map((x) => `${x.family}${x.color}`), ['Aw', 'Ab', 'Bw']);
});

test('Résultats par ouverture · pourcentages entiers dont la somme fait 100', () => {
  const thirds = openingResults([entry('w', 'win', 'A'), entry('w', 'agreed', 'A'), entry('w', 'resigned', 'A')], 'Moi').rows[0];
  assert.deepEqual([thirds.pw, thirds.pd, thirds.pl], [34, 33, 33]);
  for (let w = 0; w <= 7; w++) {
    for (let d = 0; d <= 7 - w; d++) {
      const rows = openingResults([...times(w, 'w', 'win', 'A'), ...times(d, 'w', 'stalemate', 'A'), ...times(7 - w - d, 'w', 'resigned', 'A')], 'Moi').rows;
      assert.equal(sum(rows[0]), 100);
    }
  }
});

test('Résultats par ouverture · parties d’un autre pseudo, incomplètes ou sans ouverture', () => {
  const r = openingResults([
    entry('w', 'win', 'Italian Game'),
    entry('w', 'win', null),
    entry('b', 'resigned', undefined),
    entry('w', 'win', 'Italian Game', 'Quelquun'),
    entry('w', '', 'Italian Game'),
    { opening: 'Italian Game', game: undefined },
    { opening: 'Italian Game', game: {} },
  ], 'Moi');
  assert.equal(r.total, 3);
  assert.equal(r.unnamed, 2);
  assert.deepEqual(r.rows.map((x) => x.n), [1]);
});
