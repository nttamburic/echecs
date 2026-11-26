import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from '../vendor/chess.js';
import { classifyGame } from '../analysis.js';
import { grouperFinales, releverFinales, typeFinale } from '../core/finales-erreurs.js';
import { releverErreurs } from '../core/manu/erreurs.js';
import { bilanTheme, choisirPuzzle, THEMES_FINALES } from '../core/finales-puzzles.js';

const FINALE = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
function partie(san, fen, id = 'essai', end = 1700000000) {
  const c = new Chess(fen);
  for (const coup of san.split(' ')) c.move(coup);
  return { id, end, pgn: c.pgn(), white: { name: 'Moi', rating: 1500 }, black: { name: 'Autre', rating: 1550 } };
}
const sondes = (avant, apres) => ({ lines: [{ score: avant, pv: ['e2e4'] }], played: { score: apres, pv: [] } });
const analyse = (avant, apres, fen = FINALE, san = 'Kd1') => ({ game: partie(san, fen), positions: [sondes(avant, apres), { lines: [{ score: apres, pv: [] }] }] });

test('Mes finales · type d’après les pièces hors rois et pions', () => {
  assert.equal(typeFinale(FINALE), 'pions');
  assert.equal(typeFinale('4k2r/8/8/8/8/8/4P3/R3K3 w - - 0 1'), 'tours');
  assert.equal(typeFinale('2b1k3/8/8/8/8/8/4P3/1N2K3 w - - 0 1'), 'mineures');
  assert.equal(typeFinale('3qk3/8/8/8/8/8/4P3/3QK3 w - - 0 1'), 'dame');
  assert.equal(typeFinale('3rk3/8/8/8/8/8/4P3/2B1K3 w - - 0 1'), 'mixte');
});

test('Mes finales · un gain gâché au-delà de 3 pions est gardé (écarté des erreurs stratégiques)', () => {
  const a = analyse({ cp: 600 }, { cp: 0 });
  const [e] = releverFinales(a, 'moi');
  assert.ok(e, 'faute attendue');
  assert.ok(['mistake', 'miss', 'blunder'].includes(e.gravite), e.gravite);
  assert.equal(e.id, 'f:essai:1');
  assert.equal(e.type, 'pions');
  assert.equal(e.san, 'Kd1');
  assert.equal(releverErreurs(a, 'moi').length, 0);
});

test('Mes finales · bon coup, inexactitude, coup adverse et hors finale : rien', () => {
  assert.equal(releverFinales(analyse({ cp: 30 }, { cp: 30 }), 'moi').length, 0);
  const petite = analyse({ cp: 30 }, { cp: -40 });
  const c = new Chess(FINALE);
  c.move('Kd1');
  const cls = classifyGame([c.history({ verbose: true })[0]], petite.positions, { w: 1500, b: 1550 }, {})[0].cls;
  assert.ok(!['mistake', 'miss', 'blunder'].includes(cls));
  assert.equal(releverFinales(petite, 'moi').length, 0);
  assert.equal(releverFinales(analyse({ cp: 600 }, { cp: 0 }), 'autre').length, 0);
  const debut = analyse({ cp: 600 }, { cp: 0 }, new Chess().fen(), 'e4');
  assert.equal(releverFinales(debut, 'moi').length, 0);
});

test('Mes finales · liste par type, période et suivi (archivée ou travaillée)', () => {
  const a = analyse({ cp: 600 }, { cp: 0 });
  const rangees = [{ id: 'essai', data: a }];
  const maintenant = a.game.end * 1000 + 3600000;
  const lister = (travaux, quand = maintenant) => grouperFinales(rangees, [], travaux, 'moi', {}, 7, quand);
  assert.equal(lister([]).groupes.pions.length, 1);
  assert.equal(lister([]).groupes.pions[0].adversaire, 'Autre');
  assert.equal(lister([{ id: 'f:essai:1', data: { archivee: true } }]).groupes.pions.length, 0);
  assert.equal(lister([{ id: 'f:essai:1', data: { travaillee: true } }]).groupes.pions.length, 0);
  assert.equal(lister([{ id: 'g:essai:1', data: { archivee: true } }]).groupes.pions.length, 1, 'indépendant des erreurs stratégiques');
  assert.equal(lister([], maintenant + 30 * 86400000).groupes.pions.length, 0);
});

const e = (at, resultat, note = 1200, theme = 'rookEndgame', puzzle = 'p' + at) => ({ at, resultat, note, theme, puzzle, depart: 1200 });

test('Puzzles de finales · le niveau monte avec les réussites et baisse avec les échecs', () => {
  assert.equal(bilanTheme('rookEndgame', [], 1500).niveau, 1500);
  assert.equal(bilanTheme('rookEndgame', [e(1, 'reussi')]).niveau, 1216);
  assert.equal(bilanTheme('rookEndgame', [e(1, 'rate')]).niveau, 1184);
  assert.equal(bilanTheme('rookEndgame', [e(1, 'aide')]).niveau, 1200);
  const b = bilanTheme('rookEndgame', [e(1, 'reussi'), e(2, 'aide'), e(3, 'rate'), e(4, 'reussi', 1200, 'pawnEndgame')]);
  assert.equal(b.joues, 3);
  assert.equal(b.reussis, 1);
  assert.deepEqual([...b.vus].sort(), ['p1', 'p2', 'p3']);
});

test('Puzzles de finales · même niveau quel que soit l’ordre d’arrivée (synchronisation)', () => {
  const essais = [e(3, 'rate', 1400), e(1, 'reussi', 1100), e(2, 'reussi', 1500)];
  assert.equal(bilanTheme('rookEndgame', essais, 900).niveau, bilanTheme('rookEndgame', [...essais].reverse(), 2000).niveau);
});

test('Puzzles de finales · puzzle proche du niveau, jamais déjà vu', () => {
  const pack = [{ id: 'a', rating: 1200 }, { id: 'b', rating: 1230 }, { id: 'c', rating: 2500 }];
  assert.equal(choisirPuzzle(pack, 1200, new Set(['a']), () => 0).id !== 'a', true);
  assert.equal(choisirPuzzle(pack, 2500, new Set()).id !== undefined, true);
  assert.equal(choisirPuzzle(pack, 1200, new Set(['a', 'b', 'c'])), null);
  assert.equal(THEMES_FINALES.length, 7);
});
