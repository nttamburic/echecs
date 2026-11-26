import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from '../vendor/chess.js';
import { creerSonde, Exercice, finDePartie, lireFen, resultat, uciEnCoup } from '../core/finales.js';

// Fausse table : « resultats » donne, pour une position, la catégorie du camp au trait et celle des
// coups cités (vue de l'adversaire, comme l'API). Les autres coups légaux sont des nulles.
function fausseTable(positions) {
  return async (fen) => {
    const p = positions[fen.split(' ')[0] + ' ' + fen.split(' ')[1]] ?? { category: 'draw' };
    const legaux = new Chess(fen).moves({ verbose: true });
    const cites = Object.entries(p.coups ?? {}).map(([uci, category]) => ({ uci, category }));
    const autres = legaux.filter((m) => !cites.some((c) => c.uci === m.lan)).map((m) => ({ uci: m.lan, category: p.defaut ?? 'draw' }));
    return { category: p.category, moves: [...cites, ...autres].map((m) => ({ ...m, san: new Chess(fen).move(uciEnCoup(m.uci)).san })) };
  };
}
const cle = (fen) => fen.split(' ').slice(0, 2).join(' ');

test('Catégories · la règle des 50 coups transforme gain et perte en nulle', () => {
  assert.equal(resultat('win'), 1);
  assert.equal(resultat('cursed-win'), 0);
  assert.equal(resultat('blessed-loss'), 0);
  assert.equal(resultat('loss'), -1);
  assert.equal(resultat('unknown'), null);
  assert.equal(resultat('toString'), null);
});

test('FEN · 7 pièces au plus, aucun roque, camp sans le trait jamais en échec', () => {
  assert.equal(lireFen('4k3/8/3K4/4P3/8/8/8/8').fen, '4k3/8/3K4/4P3/8/8/8/8 w - - 0 1');
  assert.match(lireFen('4k3/pppp4/3K4/4PPP1/8/8/8/8 w - - 0 1').erreur, /7 pièces/);
  assert.match(lireFen('4k3/8/8/8/8/8/8/4K2R w K - 0 1').erreur, /roque/);
  assert.match(lireFen('4k3/8/8/8/8/8/8/4R2K w - - 0 1').erreur, /échec/);
  assert.match(lireFen('nimporte quoi').erreur, /FEN invalide/);
  assert.match(lireFen('  ').erreur, /Collez/);
});

test('Fin de partie · pat, matériel insuffisant et 50 coups', () => {
  assert.equal(finDePartie(new Chess('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1')), 'pat');
  assert.equal(finDePartie(new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1')), 'materiel');
  assert.equal(finDePartie(new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 100 80')), 'cinquante');
  assert.equal(finDePartie(new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 99 80')), null);
});

const MAT = '6k1/8/6K1/8/8/8/8/R7 w - - 0 1'; // Ta8 mat

test('Objectif · déduit de la table, position perdante refusée', async () => {
  const sonde = fausseTable({ [cle(MAT)]: { category: 'win', coups: { a1a8: 'loss' } } });
  assert.equal((await Exercice.creer({ fen: MAT, camp: 'w', sonde })).objectif, 1);
  await assert.rejects(Exercice.creer({ fen: MAT, camp: 'b', sonde }), /perdante pour les Noirs/);
  await assert.rejects(Exercice.creer({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', camp: 'w', sonde }), /déjà terminée/);
});

test('Gagnez · le mat réussit sans aide ; la correction n’apparaît qu’à la fin', async () => {
  const sonde = fausseTable({ [cle(MAT)]: { category: 'win', coups: { a1a8: 'loss' } } });
  const ex = await Exercice.creer({ fen: MAT, camp: 'w', sonde });
  assert.equal(await ex.correction(0), null);
  await ex.jouer('a1a8');
  assert.equal(ex.verdict, 'reussi');
  const c = await ex.correction(0);
  assert.equal(c.find((m) => m.uci === 'a1a8').resultat, 1);
  assert.equal(c.find((m) => m.uci === 'a1a2').resultat, 0);
  assert.deepEqual(await ex.correction(1), []);
});

test('Faute · signalée, rejouable, et l’essai reste raté même après le mat', async () => {
  const sonde = fausseTable({ [cle(MAT)]: { category: 'win', coups: { a1a8: 'loss' } } });
  const ex = await Exercice.creer({ fen: MAT, camp: 'w', sonde });
  await ex.jouer('a1a2');
  assert.equal(ex.etat, 'faute');
  assert.deepEqual([ex.faute.avant, ex.faute.apres], [1, 0]);
  assert.equal(await ex.repondre(), false, 'l’adversaire ne répond pas à une faute');
  assert.equal(ex.rejouer(), true);
  assert.equal(ex.chess.fen(), MAT);
  await ex.jouer('a1a8');
  assert.equal(ex.fin.atteint, true);
  assert.equal(ex.verdict, 'rate');
});

test('Aides · indice en deux temps, réussite « avec aide », recommencer repart à zéro', async () => {
  const sonde = fausseTable({ [cle(MAT)]: { category: 'win', coups: { a1a8: 'loss' } } });
  const ex = await Exercice.creer({ fen: MAT, camp: 'w', sonde });
  assert.equal((await ex.indice()).niveau, 1);
  const second = await ex.indice();
  assert.deepEqual([second.niveau, second.coup.san], [2, 'Ra8#']);
  await ex.jouer('a1a8');
  assert.equal(ex.verdict, 'aide');
  ex.recommencer();
  assert.deepEqual([ex.etat, ex.aide, ex.rate, ex.coups.length], ['jeu', false, false, 0]);
});

const NULLE = '4k3/8/8/8/8/8/r7/4K2R w - - 0 1';

test('Annulez · réussi après le nombre de coups fixé, l’adversaire garde son résultat', async () => {
  const sonde = fausseTable({});
  const ex = await Exercice.creer({ fen: NULLE, camp: 'w', sonde, limite: 2 });
  assert.equal(ex.objectif, 0);
  await ex.jouer('h1h8');
  assert.equal(ex.aLui, true);
  await ex.repondre();
  const monCoup = ex.chess.moves({ verbose: true })[0].lan;
  await ex.jouer(monCoup);
  assert.deepEqual([ex.etat, ex.fin.raison, ex.verdict], ['fini', 'tenu', 'reussi']);
});

test('Adversaire · prend le premier coup qui conserve son résultat', async () => {
  const noir = '4k3/8/8/8/8/8/r7/4K2R b - - 0 1';
  // le premier coup listé est volontairement une nulle alors que les Noirs sont gagnants
  const sonde = fausseTable({ [cle(noir)]: { category: 'win', coups: { e8d7: 'draw', a2a1: 'loss' } } });
  await assert.rejects(Exercice.creer({ fen: noir, camp: 'w', sonde }), /perdante/);
  const ex = new Exercice({ fen: noir, camp: 'w', sonde, limite: 30, objectif: -1 });
  await ex.repondre();
  assert.equal(ex.coups[0].lan, 'a2a1');
});

test('Règle des 50 coups · le gain devenu trop lent fait échouer l’essai', async () => {
  const noir = '4k3/8/8/8/8/8/r7/4K2R b - - 0 1';
  const sonde = fausseTable({ [cle(noir)]: { category: 'blessed-loss', coups: { e8d7: 'cursed-win' } } });
  const ex = new Exercice({ fen: noir, camp: 'w', sonde, limite: 30, objectif: 1 });
  await ex.repondre();
  assert.deepEqual([ex.etat, ex.fin.raison, ex.verdict], ['fini', 'cinquante', 'rate']);
});

test('Pat · gain gâché signalé comme faute avec sa cause', async () => {
  const fen = 'k7/8/1K6/8/8/8/8/2Q5 w - - 0 1';
  const sonde = fausseTable({ [cle(fen)]: { category: 'win' } });
  const ex = await Exercice.creer({ fen, camp: 'w', sonde });
  await ex.jouer('c1c7');
  assert.deepEqual([ex.etat, ex.faute.fin], ['faute', 'pat']);
  ex.abandonner();
  assert.deepEqual([ex.fin.raison, ex.verdict], ['faute', 'rate']);
});

test('Concurrence · un coup en attente est abandonné si l’essai recommence', async () => {
  const table = fausseTable({ [cle(MAT)]: { category: 'win', coups: { a1a8: 'loss' } } });
  let debloquer;
  let bloquer = false;
  const sonde = async (fen) => { if (bloquer) await new Promise((r) => { debloquer = r; }); return table(fen); };
  const ex = await Exercice.creer({ fen: MAT, camp: 'w', sonde });
  bloquer = true;
  const enAttente = ex.jouer('a1a8');
  assert.equal(await ex.jouer('a1a2'), false, 'un seul coup à la fois');
  ex.recommencer();
  debloquer();
  assert.equal(await enAttente, false);
  assert.equal(ex.coups.length, 0);
});

test('Sonde · messages clairs et mémoire des positions', async () => {
  let appels = 0;
  const ok = creerSonde(async () => { appels++; return { status: 200, body: { category: 'draw', moves: [] } }; });
  await ok(MAT); await ok(MAT);
  assert.equal(appels, 1);
  await assert.rejects(creerSonde(async () => ({ status: 0 }))(MAT), /connexion/);
  await assert.rejects(creerSonde(async () => ({ status: 429 }))(MAT), /trop de demandes/);
  await assert.rejects(creerSonde(async () => ({ status: 200, body: { category: 'unknown', moves: [] } }))(MAT), /résultat exact/);
});
