// Import des parties Lichess et reconnaissance du joueur sur les deux sites. Les parties sont inventées,
// au format décrit par la documentation de l'API Lichess ; aucune requête réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slimLichess } from '../core/lichess.js';
import { couleurDe, definirPseudoLichess, aUnPseudo, nomsJoueur, cleCadence, nomCadence, siteDe } from '../core/joueur.js';
import { issue, dernierElo } from '../core/accueil.js';
import { bornes, jeuxDe, cadencesJouees, seriesElo, lirePartie, tempsParPhase, mesurePartie } from '../core/stats.js';
import { releverErreurs } from '../core/manu/erreurs.js';
import { openingResults, computePerformance } from '../modules/openings.js';

const NOW = Date.UTC(2026, 10, 26, 12);
const PGN = '[Result "0-1"]\n[TimeControl "180+2"]\n\n1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Qh5 { [%clk 0:02:50] } 2... Nc6 { [%clk 0:02:59] } 0-1';
const brut = (o = {}) => ({
  id: 'abcd1234', rated: true, variant: 'standard', speed: 'blitz', status: 'outoftime', winner: 'black', lastMoveAt: NOW - 3600000,
  clock: { initial: 180, increment: 2, totalTime: 260 }, pgn: PGN,
  players: { white: { user: { id: 'moili', name: 'MoiLi' }, rating: 1650 }, black: { user: { id: 'lui', name: 'lui' }, rating: 1600 } }, ...o,
});
const joueurs = (noir) => ({ white: { user: { name: 'MoiLi' }, rating: 1650 }, black: noir });

test('Lichess · partie convertie au format de l’application', () => {
  const g = slimLichess(brut());
  assert.deepEqual([g.id, g.source, g.timeClass, g.timeControl, g.result, g.url],
    ['li-abcd1234', 'lichess', 'blitz', '180+2', '0-1', 'https://lichess.org/abcd1234']);
  assert.deepEqual(g.white, { name: 'MoiLi', rating: 1650, result: 'timeout' });
  assert.equal(g.black.result, 'win');
  assert.equal(g.end, (NOW - 3600000) / 1000);
});

test('Lichess · seuls les humains, les parties standard terminées', () => {
  assert.equal(slimLichess(brut({ players: joueurs({ aiLevel: 3 }) })), null);
  assert.equal(slimLichess(brut({ players: joueurs({ rating: 1500 }) })), null); // anonyme
  assert.equal(slimLichess(brut({ players: joueurs({ user: { name: 'robot', title: 'BOT' }, rating: 2000 }) })), null);
  assert.ok(slimLichess(brut({ players: joueurs({ user: { name: 'gm', title: 'GM' }, rating: 2600 }) })));
  for (const status of ['aborted', 'noStart', 'started', 'created', 'unknownFinish']) assert.equal(slimLichess(brut({ status })), null, status);
  assert.equal(slimLichess(brut({ variant: 'chess960' })), null);
  assert.equal(slimLichess(brut({ pgn: '[Result "*"]\n\n1. e4 *' })), null);
});

test('Lichess · motifs de victoire, de défaite et de nulle', () => {
  const resultats = (status, winner) => { const g = slimLichess(brut({ status, winner })); return [g.white.result, g.black.result]; };
  assert.deepEqual(resultats('mate', 'white'), ['win', 'checkmated']);
  assert.deepEqual(resultats('resign', 'black'), ['resigned', 'win']);
  assert.deepEqual(resultats('timeout', 'white'), ['win', 'abandoned']); // a quitté la partie : pas une chute au temps
  assert.deepEqual(resultats('draw', undefined), ['nulle', 'nulle']);
  assert.deepEqual(resultats('stalemate', undefined), ['stalemate', 'stalemate']);
  assert.deepEqual(resultats('outoftime', undefined), ['timevsinsufficient', 'timevsinsufficient']);
  const nulle = slimLichess(brut({ status: 'draw', winner: undefined }));
  definirPseudoLichess('moili');
  assert.equal(issue(nulle, ''), 'draw');
  definirPseudoLichess('');
});

test('Lichess · pendule : cadence, correspondance et berserk', () => {
  assert.equal(slimLichess(brut({ clock: { initial: 600, increment: 0 } })).timeControl, '600');
  const jours = slimLichess(brut({ speed: 'correspondence', clock: undefined, daysPerTurn: 3 }));
  assert.deepEqual([jours.timeClass, jours.timeControl], ['daily', '1/259200']);
  const berserk = slimLichess(brut({ players: { ...brut().players, black: { ...brut().players.black, berserk: true } } }));
  definirPseudoLichess('MoiLi');
  assert.equal(tempsParPhase(lirePartie(berserk), berserk, ''), null);
  const normale = slimLichess(brut());
  assert.equal(tempsParPhase(lirePartie(normale), normale, '').secondes.ouverture, 2 + 12); // incrément compris
  definirPseudoLichess('');
});

test('Joueur · chaque site a son pseudo', () => {
  const li = slimLichess(brut());
  const cc = { id: 'cc1', end: NOW / 1000 - 7200, timeClass: 'blitz', white: { name: 'Autre', rating: 1000, result: 'resigned' }, black: { name: 'MoiCC', rating: 1200, result: 'win' } };
  definirPseudoLichess('');
  assert.equal(couleurDe(li, 'MoiLi'), null); // sans réglage Lichess, même un pseudo identique ne suffit pas
  assert.equal(couleurDe(cc, 'moicc'), 'b');
  definirPseudoLichess(' moili ');
  assert.equal(couleurDe(li, 'moicc'), 'w');
  assert.equal(couleurDe(li, ''), 'w'); // Lichess seul
  assert.equal(couleurDe(cc, ''), null);
  assert.equal(aUnPseudo(''), true);
  assert.equal(nomsJoueur('MoiCC'), 'MoiCC / moili');
  assert.deepEqual([siteDe(li), cleCadence(li), cleCadence(cc)], ['lichess', 'lichess|blitz', 'blitz']);
  assert.deepEqual([nomCadence('lichess|classical'), nomCadence('lichess|blitz', false), nomCadence('daily'), nomCadence('daily', false)], ['Classique · Lichess', 'Blitz', 'Par jour · chess.com', 'Par jour']);

  // statistiques : Elo et cadences séparés par site
  const jeux = [li, cc];
  const periode = bornes(30, NOW);
  assert.equal(jeuxDe(jeux, 'moicc', periode).length, 2);
  assert.deepEqual(jeuxDe(jeux, 'moicc', periode, 'blitz').map((g) => g.id), ['cc1']);
  assert.deepEqual(jeuxDe(jeux, 'moicc', periode, 'lichess|blitz').map((g) => g.id), [li.id]);
  assert.deepEqual(jeuxDe(jeux, 'moicc', periode, '', 'lichess').map((g) => g.id), [li.id]);
  assert.deepEqual(cadencesJouees(jeux).map((c) => c.cadence).sort(), ['blitz', 'lichess|blitz']);
  assert.deepEqual([...seriesElo(jeux, 'moicc')].map(([k, p]) => [k, p.map((x) => x.v)]).sort(), [['blitz', [1200]], ['lichess|blitz', [1650]]]);
  assert.deepEqual(dernierElo(jeux, 'moicc'), { cadence: 'lichess|blitz', elo: 1650 });
  definirPseudoLichess('');
  assert.equal(jeuxDe(jeux, 'moicc', periode).length, 1); // pseudo retiré : les parties Lichess sortent
});

test('Joueur · analyses et ouvertures d’une partie Lichess', () => {
  const li = slimLichess(brut());
  const pos = (a, j) => ({ lines: [{ score: { cp: a }, pv: ['d2d4'] }], played: { score: { cp: j }, pv: [] } });
  const analyse = { game: li, positions: [pos(20, 20), pos(20, 20), pos(20, -400), pos(-400, -400)] };
  definirPseudoLichess('moili');
  assert.equal(releverErreurs(analyse, 'pseudo-chesscom').length, 1);
  const m = mesurePartie(analyse, 'pseudo-chesscom');
  assert.equal(m.pendule.drapeau, true);
  assert.equal(m.decisive.ply, 2);
  assert.equal(openingResults([{ game: li, opening: 'Wayward Queen Attack' }], 'pseudo-chesscom').total, 1);
  definirPseudoLichess('');
  assert.deepEqual(releverErreurs(analyse, 'pseudo-chesscom'), []);
  assert.equal(openingResults([{ game: li, opening: 'x' }], 'pseudo-chesscom').total, 0);
  // sans réglage dans le profil, les ouvertures gardent le compte lié au jeton, fourni avec les parties
  const rep = { color: 'w', root: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', edges: [] };
  const perf = computePerformance(rep, [{ games: [li], user: 'MoiLi' }], NOW);
  assert.equal([...perf.values()][0]?.n, 1);
});
