import { Chess } from '../../../vendor/chess.js';
import { attacks, boardMap, exchange, kingOf, rawAttacks, VAL } from './geometry.js';

export const CAMPS = ['w', 'b'];
export const COLONNES = 'abcdefgh';
export const AILES = [['dame', 'abc'], ['centre', 'de'], ['roi', 'fgh']];

export const comparer = (a, b) => (a > b) - (a < b);
export const adverse = camp => camp === 'w' ? 'b' : 'w';
export const colonne = case_ => COLONNES.indexOf(case_[0]);
export const rang = (case_, camp) => camp === 'w' ? Number(case_[1]) : 9 - Number(case_[1]);
export const caseAuRang = (lettre, relatif, camp) => lettre + (camp === 'w' ? relatif : 9 - relatif);
export const voisines = (a, b) => Math.abs(colonne(a) - colonne(b)) === 1;
export const devant = (case_, camp) => caseAuRang(case_[0], rang(case_, camp) + 1, camp);
export const couleurCase = case_ => (colonne(case_) + Number(case_[1])) % 2 ? 'sombres' : 'claires';
export const distance = (a, b) => Math.max(Math.abs(colonne(a) - colonne(b)), Math.abs(a[1] - b[1]));
export const estLourde = type => type === 'r' || type === 'q';

export function motif(id, camp, cases, attributs) {
  return { id, camp, cases, attributs, certitude: 'fait' };
}

export function phaseDeJeu(map, numeroCoup) {
  const poids = { n: 1, b: 1, r: 2, q: 4 };
  const total = Object.values(map).reduce((somme, piece) => somme + (poids[piece.type] ?? 0), 0);
  if (total <= 8) return 'finale';
  return numeroCoup <= 12 && total >= 20 ? 'ouverture' : 'milieu';
}

function parCamp(calcul) {
  return { w: calcul('w'), b: calcul('b') };
}

export function creerContexte(fen) {
  const chess = new Chess(fen);
  const map = boardMap(chess);
  const cases = Object.keys(map).sort(comparer);
  const pieces = parCamp(camp => cases.filter(s => map[s].color === camp));
  const pions = parCamp(camp => pieces[camp].filter(s => map[s].type === 'p'));
  const pionsParColonne = parCamp(camp => Object.fromEntries(
    [...COLONNES].map(lettre => [lettre, pions[camp].filter(s => s[0] === lettre)]),
  ));
  const rois = parCamp(camp => kingOf(map, camp));
  const controles = Object.fromEntries(cases.map(s => [s, attacks(map, s)]));
  const [, trait, roques, , , numeroCoup] = chess.fen().split(' ');
  const phase = phaseDeJeu(map, Number(numeroCoup));
  return { fen, chess, map, phase, trait, roques, pieces, pions, pionsParColonne, rois, controles };
}

export function controleurs(ctx, cible, camp) {
  return ctx.pieces[camp].filter(s => ctx.controles[s].includes(cible));
}

export function controlePion(ctx, cible, camp) {
  return ctx.pions[camp].some(s => ctx.controles[s].includes(cible));
}

export function controlePionPossible(ctx, cible, camp) {
  return ctx.pions[camp].some(s => voisines(s, cible) && rang(s, camp) < rang(cible, camp));
}

export function colonneSansPion(ctx, lettre, camp) {
  return ctx.pionsParColonne[camp][lettre].length === 0;
}

export function colonnesOuvertes(ctx) {
  return [...COLONNES].filter(lettre => CAMPS.every(camp => colonneSansPion(ctx, lettre, camp)));
}

export function estFixe(ctx, pion, camp) {
  const obstacle = ctx.map[devant(pion, camp)];
  return obstacle?.type === 'p' && obstacle.color === adverse(camp);
}

export function positionApresDeplacement(map, depart, arrivee) {
  const position = { ...map, [arrivee]: map[depart] };
  delete position[depart];
  return position;
}

export function roiEnSecurite(map, camp, roi) {
  return !Object.keys(map).some(s => map[s].color !== camp && rawAttacks(map, s).includes(roi));
}

export function deplacementsLourdes(ctx, camp, accepte) {
  // Sans le trait, on évalue la position figée. Un camp en échec ne peut pas passer.
  if (camp !== ctx.trait && ctx.chess.isCheck()) return [];
  return ctx.pieces[camp].filter(s => estLourde(ctx.map[s].type)).flatMap(from =>
    ctx.controles[from].flatMap(to => {
      const cible = ctx.map[to];
      if (!accepte(to) || cible?.color === camp || cible?.type === 'k') return [];
      const map = positionApresDeplacement(ctx.map, from, to);
      if (!roiEnSecurite(map, camp, ctx.rois[camp])) return [];
      return [{ coup: { from, to, color: camp, captured: cible?.type }, map }];
    }));
}

export function gainDeCapture(ctx, depart, cible) {
  if (ctx.map[depart].type === 'k') {
    const map = positionApresDeplacement(ctx.map, depart, cible);
    if (!roiEnSecurite(map, ctx.map[depart].color, cible)) return -Infinity;
  }
  return exchange(ctx.map, depart, cible);
}

export function materiellementSur(coup, apres) {
  const prise = coup.captured ? VAL[coup.captured] : 0;
  const promotion = coup.promotion ? VAL[coup.promotion] - VAL.p : 0;
  const ennemi = adverse(coup.color);
  return apres.pieces[ennemi]
    .filter(s => (apres.controles?.[s] ?? attacks(apres.map, s)).includes(coup.to))
    .every(s => gainDeCapture(apres, s, coup.to) <= prise + promotion);
}
