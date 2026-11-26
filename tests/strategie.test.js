import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from '../vendor/chess.js';
import { epd } from '../analysis.js';
import { estTactique, phase, releverErreurs } from '../core/manu/erreurs.js';
import { grouperStrategie, PERIODES_STRATEGIE, periodeStrategie } from '../core/manu/strategie.js';
import { detecterThemes } from '../core/manu/zero/themes.js';
import { compterAvantFiltre, mineGame } from '../core/puzzle-mine.js';

function partie(san, fen) {
  const c = new Chess(fen);
  for (const coup of san.split(' ').filter(Boolean)) c.move(coup);
  return c;
}
const ucis = (fen, san) => partie(san, fen).history({ verbose: true }).map(m => m.lan);
const game = (partie, id = 'essai', end = 1700000000) => ({
  id, end, pgn: partie.pgn(), white: { name: 'Moi', rating: 1500 }, black: { name: 'Autre', rating: 1550 },
});
const sondes = (avant, apres, meilleur = 'd2d4') => ({
  lines: [{ score: avant, pv: [meilleur] }], played: { score: apres, pv: [] },
});
const pions = { cp: 0 };
function relever(avant, apres, book = {}, seuils) {
  const c = partie('e4');
  return releverErreurs({ game: game(c), positions: [sondes(avant, apres)] }, 'mOI', book, seuils);
}

test('Relevé · écart 149 ou 150 cp et fourchette avant le coup', () => {
  assert.equal(relever(pions, { cp: -149 }).length, 0);
  assert.equal(relever(pions, { cp: -150 })[0].ecartCp, 150);
  assert.equal(relever({ cp: 301 }, { cp: -301 }).length, 0);
  assert.equal(relever({ cp: 299 }, { cp: -301 }).length, 1);
  assert.equal(relever({ cp: -300 }, { cp: -500 }).length, 1);
  assert.equal(relever(pions, { cp: -199 }, {}, { seuilCp: 200 }).length, 0);
  assert.equal(relever({ cp: 251 }, { cp: -100 }, {}, { fourchetteCp: 250 }).length, 0);
});

test('Relevé · point de vue noir, mat avant le coup, mat permis et théorie', () => {
  const c = partie('e4 e5');
  const a = { game: game(c), positions: [null, sondes({ cp: -25 }, { cp: 125 }, 'c7c5')] };
  assert.equal(releverErreurs(a, 'autre')[0].ecartCp, 150);
  assert.deepEqual(releverErreurs(a, 'autre')[0].avant, { cp: 25 });
  assert.equal(relever(pions, { mate: -3 })[0].perdMat, true);
  assert.equal(relever(pions, { mate: 3 }).length, 0);
  assert.equal(relever({ mate: 1 }, { cp: -800 }).length, 0);
  assert.equal(relever({ mate: -2 }, { mate: -1 }).length, 0);
  assert.equal(relever(pions, { cp: -250 }, { [epd(partie('e4').fen())]: ['B00'] }).length, 0);
});

test('Les phases ne reviennent jamais en arrière', () => {
  const debut = new Chess().fen();
  const milieu = 'r3k2r/2n2ppp/1b6/8/8/1B6/2N2PPP/R3K2R w KQkq - 0 1';
  const finale = 'r3k2r/5ppp/8/8/8/8/5PPP/R3K2R w KQkq - 0 1';
  assert.equal(phase(debut), 'ouverture');
  assert.equal(phase(milieu), 'milieu');
  assert.equal(phase(finale), 'finale');
  assert.equal(phase(debut, phase(milieu)), 'milieu');
  assert.equal(phase(debut, phase(finale)), 'finale');
});

test('Un mat dans la variante et une perte persistante sont tactiques', () => {
  const mat = partie('f3 e5 g4').fen();
  assert.deepEqual(estTactique(mat, ucis(mat, 'Qh4#'), []).mat, [{ ligne: 'B', demiCoup: 1 }]);
  const fen = '4k3/8/8/8/8/3r4/8/1N2K3 w - - 0 1';
  const r = estTactique(fen, ucis(fen, 'Nd2 Kd7 Kd1'), ucis(fen, 'Nc3 Rxc3 Kd2 Rc4 Kd3'));
  assert.equal(r.tactique, true);
  assert.deepEqual(r.materiel[0], { ligne: 'R', demiCoup: 2, ecart: -3 });
});

test('Une fourchette reste tactique et un coup défensif seul reste stratégique', () => {
  const fork = '3rr1k1/p1q1bppp/2p5/2PnN3/1P2NP2/P5P1/2Q3BP/5RK1 w - - 1 20';
  const f = estTactique(fork, ucis(fork, 'Qa4'), ucis(fork, 'Nc3 Ne3 Qb3 Bf6'));
  assert.ok(f.themes.some(t => t.theme === 'fork'));
  // Un thème au-delà du 6e demi-coup ne compte pas : ici un dégagement au 8e demi-coup de R (partie réelle).
  const loin = '2r2rk1/4pp1p/p4bp1/8/2pp4/N2P4/PP3PPP/R1B2RK1 b - - 0 19';
  const l = estTactique(loin,
    ['c4d3', 'f1d1', 'e7e5', 'd1d3', 'e5e4', 'd3b3', 'f6e7', 'c1d2', 'f7f5', 'g2g3'],
    ['e7e5', 'a3c4', 'f6g7', 'b2b3', 'c8d8', 'c1d2', 'f7f5', 'a1e1', 'f8e8', 'g1h1'],
    { before: '2r2rk1/4pp1p/p4bp1/8/2pp4/N7/PP1P1PPP/R1B2RK1 w - - 0 19', from: 'd2', to: 'd3' });
  assert.equal(l.tactique, false);
  assert.ok(l.themes.every(t => t.demiCoup <= 6));
  const defense = 'r1bq1rk1/p3ppbp/1pn2np1/2p5/2B5/5NQ1/PPPP1PPP/RNB2RK1 b - - 3 10';
  const c = partie('Bg4', defense);
  assert.ok(detecterThemes(c.fen(), ucis(c.fen(), 'Nc3'), {
    coupAdversePrecedent: 'c8g4', fenAvantCoupAdverse: defense,
  }).some(t => t.theme === 'defensiveMove'));
  assert.equal(estTactique(defense, ucis(defense, 'Nb4'), ucis(defense, 'Bg4 Nc3')).tactique, false);
  assert.equal(estTactique(new Chess().fen(), ['e2e4'], ['d2d4']).tactique, false);
});

test('Le flux de puzzles conserve sa gravité et exclut une erreur stratégique', () => {
  const c = partie('e4 e5 Nf3');
  const a = { game: game(c), positions: [null, null, sondes({ cp: 100 }, { cp: -320 }, 'b1c3')] };
  assert.equal(releverErreurs(a, 'moi')[0].gravite, 'blunder');
  assert.equal(releverErreurs(a, 'moi')[0].tactique, false);
  assert.equal(compterAvantFiltre(a, 'moi'), 1);
  assert.deepEqual(mineGame(a, 'moi'), []);
});

test('Le module liste les erreurs par phase et par date et filtre les erreurs travaillées', () => {
  const c = partie('e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3 Nf6 d3 d6 Bg5 Be6 Qd2 Qd7 h3');
  const fin = 1700000000;
  const construit = (id, age) => ({ data: { game: game(c, id, fin - age * 86400),
    positions: Array.from({ length: 15 }, (_, i) => i === 0 ? sondes(pions, { cp: -250 })
      : i === 2 ? sondes(pions, { cp: -250 }, 'b1c3')
      : i === 14 ? sondes(pions, { cp: -250 }, 'a2a3') : null),
    summary: { complete: true } } });
  const analyses = [construit('d', 31), construit('b', 8), construit('e', 91), construit('a', 2), construit('c', 16)];
  const travaux = [
    { id: 'g:a:1', data: { travaillee: true, date: fin * 1000 } },
    { id: 'g:a:3', data: { travaillee: false } },
  ];
  const jeux = [...analyses.map(r => r.data.game), game(c, 'en-attente', fin)];
  const filtrer = periode => grouperStrategie(analyses, jeux, travaux, 'Moi', {}, undefined, periode, fin * 1000);
  assert.deepEqual(PERIODES_STRATEGIE, [7, 15, 30, 90]);
  assert.equal(periodeStrategie('60'), 7);
  assert.equal(filtrer(undefined).jours, 7);
  for (const [i, jours] of PERIODES_STRATEGIE.entries()) {
    const { groupes, aAnalyser } = filtrer(jours);
    const ids = ['b', 'c', 'd'].slice(0, i);
    assert.deepEqual(groupes.ouverture.map(e => e.id), ['g:a:3', ...ids.flatMap(id => [`g:${id}:1`, `g:${id}:3`])]);
    assert.deepEqual(groupes.milieu.map(e => e.id), ['a', ...ids].map(id => `g:${id}:15`));
    assert.deepEqual(groupes.finale, []);
    assert.equal(aAnalyser, 1);
    const [erreur] = groupes.ouverture;
    assert.equal(erreur.jeu, jeux.find(j => j.id === 'a'));
    assert.equal(erreur.adversaire, 'Autre');
    assert.equal(erreur.elo, 1500);
    assert.equal(erreur.ply, 2);
    assert.equal(erreur.san, 'Nf3');
  }
  assert.equal(travaux[0].data.travaillee, true);
});

test('Le module donne le nom des Blancs et l’Elo des Noirs si le joueur a les Noirs', () => {
  const jeu = game(partie('e4 e5'));
  const data = { game: jeu, positions: [null, sondes(pions, { cp: 250 }, 'c7c5')] };
  const { groupes } = grouperStrategie([{ data }], [jeu], [], 'Autre', {}, undefined, 7, jeu.end * 1000);
  const [erreur] = groupes.ouverture;
  assert.equal(erreur.color, 'b');
  assert.equal(erreur.adversaire, 'Moi');
  assert.equal(erreur.elo, 1550);
});

test('Une erreur archivée disparaît de la liste, une erreur désarchivée revient', () => {
  const jeu = game(partie('e4 e5'));
  const data = { game: jeu, positions: [null, sondes(pions, { cp: 250 }, 'c7c5')] };
  const liste = travaux => grouperStrategie([{ data }], [jeu], travaux, 'Autre', {}, undefined, 7, jeu.end * 1000).groupes.ouverture;
  assert.equal(liste([]).length, 1);
  assert.equal(liste([{ id: 'g:essai:2', data: { archivee: true, dateArchive: 1 } }]).length, 0);
  assert.equal(liste([{ id: 'g:essai:2', data: { archivee: false } }]).length, 1);
});
