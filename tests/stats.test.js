import test from 'node:test';
import assert from 'node:assert/strict';
import { bornes, jeuxDe, cadencesJouees, resultats, grouperResultats, seriesElo, parSemaine, lirePartie, ouvertureDe, familleOuverture, tempsParPhase, mesurePartie, agreger, moyenneTemps, ecart } from '../core/stats.js';
import { epd } from '../analysis.js';

const NOW = Date.UTC(2026, 10, 26, 12);
const JOUR = 86400000;
const jeu = (id, joursAvant, { blanc = true, resultat = 'win', elo = 1200, cadence = 'rapid', rated = true } = {}) => {
  const moi = { name: 'Moi', rating: elo, result: resultat };
  const lui = { name: 'lui', rating: 1100, result: resultat === 'win' ? 'resigned' : 'win' };
  return { id, end: (NOW - joursAvant * JOUR) / 1000, timeClass: cadence, rated, white: blanc ? moi : lui, black: blanc ? lui : moi };
};

test('Stats · périodes : en cours, précédente, cadence et joueur', () => {
  const jeux = [jeu('a', 1), jeu('b', 29, { cadence: 'blitz' }), jeu('c', 31), jeu('d', 61), { ...jeu('e', 2), white: { name: 'x' }, black: { name: 'y' } }];
  assert.deepEqual(jeuxDe(jeux, 'moi', bornes(30, NOW)).map((g) => g.id), ['a', 'b']);
  assert.deepEqual(jeuxDe(jeux, 'moi', bornes(30, NOW, 1)).map((g) => g.id), ['c']);
  assert.deepEqual(jeuxDe(jeux, 'moi', bornes(30, NOW), 'blitz').map((g) => g.id), ['b']);
  assert.deepEqual(cadencesJouees(jeux)[0], { cadence: 'rapid', total: 4 });
});

test('Stats · résultats, groupes et Elo', () => {
  const jeux = [jeu('a', 1, { elo: 1210 }), jeu('b', 2, { resultat: 'agreed', blanc: false }), jeu('c', 3, { resultat: 'checkmated', elo: 1190 }), jeu('d', 4, { rated: false, elo: 999 })];
  assert.deepEqual(resultats(jeux, 'moi'), { total: 4, win: 2, draw: 1, loss: 1, score: 62.5 });
  assert.equal(resultats([], 'moi').score, null);
  const camps = grouperResultats(jeux, 'moi', (g) => (g.white.name === 'Moi' ? 'w' : 'b'));
  assert.deepEqual(camps.map((c) => [c.cle, c.total]), [['w', 3], ['b', 1]]);
  assert.deepEqual(seriesElo(jeux, 'moi').get('rapid').map((p) => p.v), [1190, 1200, 1210]);
});

test('Stats · moyennes par semaine', () => {
  const p = (j, v) => ({ t: NOW - j * JOUR, v });
  const s = parSemaine([p(1, 80), p(2, 90), p(15, 50), p(40, 10)], bornes(30, NOW));
  assert.deepEqual(s.map((x) => [x.moyenne, x.n]), [[50, 1], [85, 2]]);
});

// Les Blancs (« Moi ») : gagnants à leurs 2e et 3e coups, puis la partie finit en défaite.
const PGN = '[TimeControl "600"]\n\n1. e4 {[%clk 0:09:50]} 1... e5 {[%clk 0:09:50]} 2. Nf3 {[%clk 0:09:20]} 2... Nc6 {[%clk 0:09:40]} 3. Bb5 {[%clk 0:00:30]} 3... a6 {[%clk 0:09:00]} 4. Ba4 {[%clk 0:00:20]} 4... Nf6 *';
const position = (cpAvant, cpJoue, uciBest = 'a2a3') => ({ lines: [{ score: { cp: cpAvant }, pv: [uciBest] }], played: { score: { cp: cpJoue }, pv: [] } });
const analyse = (scores, resultat = 'checkmated') => ({
  game: { ...jeu('p1', 1, { resultat }), pgn: PGN },
  positions: scores.map(([a, j]) => position(a, j)),
});

test('Stats · mesures d’une partie : phases, conversion, temps', () => {
  const data = analyse([[20, 20], [20, 20], [600, 600], [600, 600], [600, -600], [-600, -600], [-600, -600], [-600, -600]]);
  const m = mesurePartie(data, 'moi', {});
  assert.equal(m.coups.ouverture, 4);
  assert.equal(m.fautes.ouverture, 1); // 3. Bb5 jette l'avantage
  assert.equal(m.gagnante, true);
  assert.equal(m.gagnee, false);
  assert.equal(m.mauvaise, true); // −600 au 4e coup, dernier tour des Blancs
  assert.equal(m.sauvee, false);
  assert.equal(m.pendule.fautes, 1);
  assert.equal(m.pendule.fautesVite, 1);
  assert.ok(m.precision > 0 && m.precision < 100);
});

test('Stats · un pic d’un seul coup ne compte pas ; analyse incomplète ignorée', () => {
  const data = analyse([[20, 20], [20, 20], [600, 20], [20, 20], [20, 20], [20, 20], [20, 20], [20, 20]]);
  const m = mesurePartie(data, 'moi', {});
  assert.equal(m.gagnante, false);
  assert.equal(m.mauvaise, false);
  assert.equal(mesurePartie({ ...data, positions: [...data.positions.slice(0, 7), null] }, 'moi', {}), null);
  assert.equal(mesurePartie({ ...data, positions: data.positions.slice(0, 3) }, 'moi', {}), null);
  assert.equal(mesurePartie(data, 'inconnu', {}), null);
});

test('Stats · temps par phase sans analyse, et ouverture', () => {
  const game = { ...jeu('p', 1), pgn: PGN };
  const partie = lirePartie(game);
  const t = tempsParPhase(partie, game, 'moi');
  assert.equal(t.coups.ouverture, 4);
  assert.equal(t.secondes.ouverture, 10 + 30 + 530 + 10);
  assert.equal(moyenneTemps([t, t]).ouverture, 145);
  assert.equal(moyenneTemps([t]).finale, null);
  assert.equal(tempsParPhase(partie, { ...game, timeControl: '1/86400' }, 'moi'), null);
  const book = { [epd(partie.coups[4].after)]: ['C60', 'Ruy Lopez: Morphy Defense'] };
  assert.equal(familleOuverture(ouvertureDe(partie.coups, book)), 'Ruy Lopez');
  assert.equal(familleOuverture(ouvertureDe(partie.coups, {})), null);
});

test('Stats · agrégats et tendances', () => {
  const m = (o) => ({ precision: 80, coups: { ouverture: 10, milieu: 20, finale: 0 }, fautes: { ouverture: 1, milieu: 4, finale: 0 }, gagnante: false, gagnee: false, mauvaise: false, sauvee: false, pendule: null, ...o });
  const a = agreger([m({ gagnante: true, gagnee: true }), m({ precision: 60, gagnante: true, mauvaise: true, sauvee: true, pendule: { fautes: 4, manque: 1, vite: 2, fautesVite: 4 } })]);
  assert.equal(a.precision, 70);
  assert.equal(a.phases.milieu.pour100, 20);
  assert.equal(a.phases.finale.pour100, null);
  assert.deepEqual(a.conversion, { n: 1, total: 2, pct: 50 });
  assert.deepEqual(a.sauvetage, { n: 1, total: 1, pct: 100 });
  assert.equal(a.temps.manque.pct, 25);
  assert.equal(a.temps.vite.pct, 50);
  assert.equal(agreger([]).precision, null);
  assert.equal(ecart(75, 70, 12, 10), 5);
  assert.equal(ecart(75, 70, 12, 9), null);
  assert.equal(ecart(75, null, 12, 12), null);
});
