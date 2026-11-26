// Tests des calculs de la page d'accueil (core/accueil.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { aAnalyser, dernierElo, dernieresParties, puzzlesDus, resultatsRecents, taches } from '../core/accueil.js';

const NOW = Date.UTC(2026, 10, 26, 12);
const jeu = (id, joursAvant, blanc, resultat, rating = 1200, timeClass = 'rapid') => {
  const moi = { name: 'Moi', rating, result: resultat };
  const lui = { name: 'Autre_' + id, rating: 1300, result: resultat === 'win' ? 'resigned' : 'win' };
  return { id, end: (NOW - joursAvant * 86400000) / 1000, timeClass, white: blanc ? moi : lui, black: blanc ? lui : moi };
};
const JEUX = [jeu('a', 10, true, 'win', 1190), jeu('c', 1, false, 'resigned', 1210, 'blitz'), jeu('b', 3, true, 'agreed'), jeu('d', 2, false, 'win', 1220)];

test('Accueil · résultats des 7 derniers jours vus du joueur, sans tenir compte de la casse du pseudo', () => {
  assert.deepEqual(resultatsRecents(JEUX, 'moi', NOW), { win: 1, draw: 1, loss: 1, total: 3 });
});

test('Accueil · Elo et cadence de la partie la plus récente, quel que soit l’ordre de la liste', () => {
  assert.deepEqual(dernierElo(JEUX, 'Moi'), { cadence: 'blitz', elo: 1210 });
  assert.equal(dernierElo([], 'Moi'), null);
});

test('Accueil · parties récentes à analyser et précision des dernières parties', () => {
  const index = { c: { complete: true, accW: 50, accB: 81.5 }, d: { complete: false, accW: 10, accB: 20 } };
  assert.equal(aAnalyser(JEUX, index, NOW), 2);
  const [premiere, seconde] = dernieresParties(JEUX, index, 'Moi', 2);
  assert.deepEqual([premiere.id, premiere.camp, premiere.issue, premiere.precision, premiere.adversaire], ['c', 'b', 'loss', 81.5, 'Autre_c']);
  assert.deepEqual([seconde.id, seconde.precision], ['d', null]);
});

test('Accueil · puzzles dus et série à lancer', () => {
  const carte = (source, due) => ({ puzzle: { source }, card: { due } });
  assert.deepEqual(puzzlesDus(new Map([[1, carte('mistake', NOW - 1)], [2, carte('opening', NOW + 1)]]), NOW), { n: 1, source: 'mistake' });
  assert.deepEqual(puzzlesDus(new Map([[1, carte('opening', NOW)]]), NOW), { n: 1, source: 'opening' });
  assert.deepEqual(puzzlesDus(new Map([[1, carte('opening', NOW)], [2, carte('mistake', NOW)]]), NOW), { n: 2, source: 'mix' });
});

test('Accueil · seules les activités avec quelque chose à faire sont listées, dans l’ordre', () => {
  assert.deepEqual(taches({ ouvertures: { dus: 0, nouveaux: 0, repertoires: 1 }, puzzles: { n: 0 }, woodpecker: null, parties: 0 }), []);
  const liste = taches({
    ouvertures: { dus: 3, nouveaux: 1, repertoires: 2 }, puzzles: { n: 1, source: 'mix' },
    woodpecker: { cycle: 2, cycles: 5, faits: 41, total: 100, delai: 14 }, parties: 6,
  });
  assert.deepEqual(liste.map((t) => [t.cle, t.n]), [['ouvertures', 4], ['puzzles', 1], ['woodpecker', 59], ['parties', 6]]);
  assert.equal(liste[0].detail, '3 à revoir · 1 nouveau · 2 répertoires');
  assert.equal(liste[1].titre, 'Puzzle à revoir');
  assert.equal(liste[1].href, '#/puzzles/recommend/mix');
  assert.equal(liste[3].href, null);
});
