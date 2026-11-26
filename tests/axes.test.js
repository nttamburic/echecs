import test from 'node:test';
import assert from 'node:assert/strict';
import { trouverAxes, pointsPerdus, TITRES, AXES_MAX } from '../core/axes.js';
import { mesurePartie } from '../core/stats.js';

let n = 0;
// Une mesure de partie, telle que la produit core/stats.js.
const m = ({ resultat = 'loss', categorie = null, repere = null, gagnante = false, mauvaise = false, drapeau = false, pendule = true, vitePossible = true } = {}) => {
  n++;
  return {
    id: 'g' + n, end: 1000 + n, gagnee: resultat === 'win', sauvee: resultat !== 'loss', gagnante, mauvaise,
    decisive: categorie ? { ply: 10, perte: 40, categorie, repere } : null,
    pendule: pendule ? { drapeau, vitePossible } : null,
  };
};
const fois = (k, o) => Array.from({ length: k }, () => m(o));
const cles = (r) => r.axes.map((a) => a.cle);

test('Axes · points non marqués', () => {
  assert.deepEqual(['win', 'draw', 'loss'].map((resultat) => pointsPerdus(m({ resultat }))), [0, 0.5, 1]);
});

test('Axes · classement par points perdus, trois au plus, victoires ignorées', () => {
  const mesures = [...fois(5, { categorie: 'tactique' }), ...fois(4, { categorie: 'position' }), ...fois(3, { categorie: 'finale' }),
    ...fois(3, { categorie: 'finale', resultat: 'win' }), ...fois(5, { resultat: 'win' })];
  const r = trouverAxes({ mesures });
  assert.equal(r.assez, true);
  assert.deepEqual(cles(r), ['tactique', 'position', 'finale']);
  assert.deepEqual([r.axes[0].n, r.axes[0].points, r.axes[0].sur10], [5, 5, 2.5]);
  assert.equal(r.axes[2].n, 3); // les finales gagnées ne comptent pas
  assert.equal(r.axes[0].exemples[0].ply, 10);
  assert.equal(r.axes[0].avant, null);
  assert.equal(r.axes.length, AXES_MAX);
  for (const a of r.axes) assert.ok(TITRES[a.cle]);
});

test('Axes · signal trop faible : rien plutôt que du remplissage', () => {
  assert.deepEqual(trouverAxes({ mesures: [...fois(2, { categorie: 'tactique' }), ...fois(10, { resultat: 'win' })] }).axes, []);
  // 3 nulles sur 40 : sous le coût minimal
  assert.deepEqual(trouverAxes({ mesures: [...fois(3, { categorie: 'finale', resultat: 'draw' }), ...fois(37, { resultat: 'win' })] }).axes, []);
});

test('Axes · moins de 10 analyses : aucun axe tiré des analyses', () => {
  const r = trouverAxes({ mesures: fois(9, { categorie: 'tactique' }) });
  assert.equal(r.assez, false);
  assert.deepEqual(r.axes, []);
});

test('Axes · conversion et période précédente', () => {
  const mesures = [...fois(4, { gagnante: true, categorie: 'position' }), ...fois(2, { gagnante: true, resultat: 'win' }), ...fois(6, { resultat: 'win' })];
  const precedentes = [...fois(2, { categorie: 'position' }), ...fois(8, { resultat: 'win' })];
  const r = trouverAxes({ mesures, precedentes });
  const conversion = r.axes.find((a) => a.cle === 'conversion');
  assert.deepEqual([conversion.n, conversion.sur, conversion.avant], [4, 6, 0]);
  assert.equal(r.axes.find((a) => a.cle === 'position').avant, 2);
});

test('Axes · conversion non signalée quand la plupart des avantages aboutissent', () => {
  assert.deepEqual(cles(trouverAxes({ mesures: [...fois(3, { gagnante: true }), ...fois(12, { gagnante: true, resultat: 'win' })] })), []);
});

test('Axes · temps : drapeau, manque et coups trop vite', () => {
  const mesures = [...fois(3, { drapeau: true }), ...fois(3, { categorie: 'tactique', repere: 'vite' }), ...fois(4, { categorie: 'tactique' }), ...fois(5, { resultat: 'win' })];
  const r = trouverAxes({ mesures });
  assert.deepEqual(cles(r), ['tactique', 'manque', 'vite']);
  assert.deepEqual([r.axes[1].drapeaux, r.axes[1].sur], [3, 10]);
  assert.equal(r.axes[2].sur, 10);
  // 3 parties sur 20 non gagnées : sous la part de 20 %
  assert.deepEqual(cles(trouverAxes({ mesures: [...fois(3, { drapeau: true }), ...fois(17, {})] })), []);
});

test('Axes · défense seulement en cas de baisse face à la période précédente', () => {
  const mauvaises = (sauvees, total) => [...fois(sauvees, { mauvaise: true, resultat: 'draw' }), ...fois(total - sauvees, { mauvaise: true })];
  assert.deepEqual(cles(trouverAxes({ mesures: mauvaises(1, 12) })), []);
  const r = trouverAxes({ mesures: mauvaises(1, 12), precedentes: mauvaises(6, 12) });
  assert.deepEqual(cles(r), ['defense']);
  assert.equal(Math.round(r.axes[0].pctAvant - r.axes[0].pct), 42);
  assert.deepEqual(cles(trouverAxes({ mesures: mauvaises(6, 12), precedentes: mauvaises(6, 12) })), []);
});

test('Axes · ouverture nettement sous les autres parties, même sans analyse', () => {
  const ouvertures = new Map();
  const jeux = [];
  const ajouter = (k, famille, resultat) => {
    for (let i = 0; i < k; i++) {
      const id = 'j' + jeux.length;
      jeux.push({ id, end: 100 + jeux.length, white: { name: 'moi', result: resultat }, black: { name: 'lui', result: resultat === 'win' ? 'resigned' : 'win' } });
      ouvertures.set(id, famille);
    }
  };
  ajouter(2, 'Sicilian Defense', 'win');
  ajouter(10, 'Sicilian Defense', 'resigned');
  ajouter(14, 'Italian Game', 'win');
  ajouter(6, 'Italian Game', 'resigned');
  const r = trouverAxes({ mesures: [], jeux, user: 'moi', ouvertures });
  assert.equal(r.assez, false);
  assert.deepEqual(cles(r), ['ouverture']);
  const a = r.axes[0];
  assert.deepEqual([a.famille, a.camp, a.n, Math.round(a.score), Math.round(a.scoreAutres)], ['Sicilian Defense', 'w', 12, 17, 70]);
  assert.equal(a.exemples.length, 3);
  assert.deepEqual(cles(trouverAxes({ mesures: [], jeux: jeux.slice(3), user: 'moi', ouvertures })), []); // 9 parties seulement
});

test('Axes · la faute la plus coûteuse vient bien de l’analyse', () => {
  const pgn = '[TimeControl "600"]\n\n1. e4 {[%clk 0:09:50]} 1... e5 {[%clk 0:09:50]} 2. Nf3 {[%clk 0:09:20]} 2... Nc6 {[%clk 0:09:40]} 3. Bb5 {[%clk 0:00:30]} 3... a6 {[%clk 0:09:00]} *';
  const game = { id: 'p', end: 1, timeClass: 'rapid', pgn, white: { name: 'Moi', rating: 1200, result: 'timeout' }, black: { name: 'lui', rating: 1200, result: 'win' } };
  const pos = (a, j) => ({ lines: [{ score: { cp: a }, pv: ['d2d3'] }], played: { score: { cp: j }, pv: [] } });
  const mesure = mesurePartie({ game, positions: [pos(20, 20), pos(20, 20), pos(20, -300), pos(20, 20), pos(20, -900), pos(20, 20)] }, 'moi', {});
  assert.equal(mesure.decisive.ply, 4);
  assert.ok(['tactique', 'position'].includes(mesure.decisive.categorie));
  assert.equal(mesure.pendule.drapeau, true);
  assert.equal(mesure.pendule.vitePossible, true);
});
