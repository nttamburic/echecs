// Apprendre de ses erreurs (sans DOM, testé avec node) :
//  - « Trouvez mieux » : un exercice = la position avant une faute ; on cherche un coup meilleur que celui joué ;
//  - révision espacée des erreurs stratégiques (non tactiques) et des fautes en finale. Les erreurs
//    tactiques du milieu de jeu ont déjà leur révision dans Puzzles → Recommandés ;
//  - « Convertir l'avantage » : les positions nettement gagnantes d'une partie qui n'a pas été gagnée.
import { Chess } from '../vendor/chess.js';
import { winPct, thresholds } from '../analysis.js';
import { uciOf } from './ui.js';
import { releverErreurs } from './manu/erreurs.js';
import { releverFinales } from './finales-erreurs.js';
import { dansPeriode } from './manu/strategie.js';
import { isDue, startOfDay } from './srs.js';

const JOUR = 86400000;
export const JOURS_NOUVELLES = 90; // les nouvelles erreurs viennent des parties de cette période
export const NOUVELLES_PAR_JOUR = 10;
export const SEUIL_GAGNANT = 80; // chances de gain (%) à partir desquelles une position est « à convertir »

export const couleurDe = (game, user) => {
  const u = String(user ?? '').trim().toLowerCase();
  if (!u) return null;
  return game?.white?.name?.toLowerCase() === u ? 'w' : game?.black?.name?.toLowerCase() === u ? 'b' : null;
};

export function coupsDe(game) {
  const chess = new Chess();
  try { chess.loadPgn(game.pgn); } catch { return []; }
  return chess.history({ verbose: true });
}

// ------------------------------------------------------------------ exercice
export const cleErreur = (gameId, ply) => `${gameId}:${ply}`;

// Exercice tiré du demi-coup « ply » d'une partie analysée, ou null s'il n'y a rien à trouver.
// data : { game, positions } ; coups : historique chess.js de la partie.
export function exerciceDe(data, coups, ply, { gravite = null } = {}) {
  const coup = coups[ply];
  const pos = data.positions?.[ply];
  const meilleur = pos?.lines?.[0];
  if (!coup || !meilleur?.pv?.length || !meilleur.score) return null;
  const joue = uciOf(coup);
  if (meilleur.pv[0] === joue) return null;
  const game = data.game;
  const precedent = coups[ply - 1];
  const camp = coup.color;
  return {
    key: cleErreur(game.id, ply), gameId: game.id, ply, numero: Number(coup.before.split(' ')[5]),
    fen: coup.before, color: camp, joue, san: coup.san, meilleur: meilleur.pv[0],
    lignes: pos.lines.filter((l) => l.pv?.length && l.score).map((l) => ({ pv: l.pv.slice(0, 8), score: l.score })),
    precedent: precedent ? [precedent.from, precedent.to] : null,
    gravite, adversaire: (camp === 'w' ? game.black : game.white)?.name ?? '', end: game.end ?? null,
  };
}

// Verdict d'un coup d'après les deux évaluations (point de vue des Blancs), pour le camp « color ».
// 'juste' : aussi bon que le meilleur ; 'proche' : bon, mais il y a mieux ; 'faux'.
export function evaluer(color, scoreMeilleur, scoreCoup) {
  const perte = winPct(scoreMeilleur, color) - winPct(scoreCoup, color);
  const seuils = thresholds(null);
  return perte < seuils.excellent ? 'juste' : perte < seuils.good ? 'proche' : 'faux';
}

// Verdict sans moteur quand c'est possible : mat, meilleur coup, coup de la partie ou ligne déjà analysée.
// Renvoie null s'il faut interroger le moteur.
export function verdictConnu(ex, uci) {
  const chess = new Chess(ex.fen);
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  if (chess.isCheckmate() || uci === ex.meilleur) return 'juste';
  if (uci === ex.joue) return 'partie';
  const ligne = ex.lignes.find((l) => l.pv[0] === uci);
  return ligne ? evaluer(ex.color, ex.lignes[0].score, ligne.score) : null;
}

// Note de répétition espacée : seul un coup faux, ou la solution demandée, compte comme un échec.
export const noteDe = ({ fautes = 0, indice = false, solution = false }) =>
  (fautes || solution ? 'again' : indice ? 'hard' : 'good');

// ------------------------------------------------------------------ erreurs à réviser
// Erreurs stratégiques et fautes en finale des parties récentes, des plus récentes aux plus anciennes.
// « travaux » : enregistrements strategyWork ; une erreur archivée dans l'une des listes est écartée.
export function candidats(analyses, user, book = {}, seuils, travaux = [], maintenant = Date.now(), jours = JOURS_NOUVELLES) {
  const archivees = clesArchivees(travaux);
  const out = new Map();
  for (const { data } of analyses) {
    if (!data?.game || !dansPeriode(data.game, jours, maintenant)) continue;
    let coups = null;
    const ajouter = (erreur, origine) => {
      const key = cleErreur(data.game.id, erreur.ply);
      if (out.has(key) || archivees.has(key)) return;
      coups ??= coupsDe(data.game);
      const ex = exerciceDe(data, coups, erreur.ply, { gravite: erreur.gravite });
      if (ex) out.set(key, { ...ex, origine });
    };
    try {
      for (const e of releverErreurs(data, user, book, seuils)) if (!e.tactique) ajouter(e, 'strategie');
      for (const e of releverFinales(data, user, book)) ajouter(e, 'finale');
    } catch { /* analyse illisible : partie ignorée */ }
  }
  return [...out.values()].sort((a, b) => (b.end ?? 0) - (a.end ?? 0) || a.ply - b.ply);
}

// Les listes notent « g:partie:n » ou « f:partie:n » avec n = ply + 1.
export function clesArchivees(travaux) {
  const out = new Set();
  for (const r of travaux) {
    const m = /^[gf]:(.+):(\d+)$/.exec(r.id);
    if (m && r.data?.archivee) out.add(cleErreur(m[1], Number(m[2]) - 1));
  }
  return out;
}

// La journée commence à 4 h, comme pour les échéances.
export function debutDeJournee(maintenant) {
  const d = startOfDay(maintenant);
  return d > maintenant ? d - JOUR : d;
}

// cartes : Map clé → { exercice, card, first, … }. Les cartes dues gardent leur copie de l'exercice : elles
// restent à réviser même quand la partie sort de la période. Au plus « parJour » nouvelles par jour.
export function fileRevision(liste, cartes, archivees = new Set(), maintenant = Date.now(), parJour = NOUVELLES_PAR_JOUR) {
  const dues = [...cartes.entries()]
    .filter(([key, r]) => r.exercice && !archivees.has(key) && isDue(r.card, maintenant))
    .sort((a, b) => a[1].card.due - b[1].card.due)
    .map(([, r]) => r.exercice);
  const debut = debutDeJournee(maintenant);
  const commencees = [...cartes.values()].filter((r) => r.first >= debut).length;
  const inedites = liste.filter((ex) => !cartes.has(ex.key));
  return { dues, nouvelles: inedites.slice(0, Math.max(0, parJour - commencees)), enAttente: inedites.length };
}

// ------------------------------------------------------------------ convertir l'avantage
// Première position au trait du joueur où il est nettement gagnant et le reste à son coup suivant
// (un pic d'un seul coup ne compte pas), dans une partie qu'il n'a pas gagnée. Sinon null.
export function occasionConversion(data, user, seuil = SEUIL_GAGNANT) {
  const game = data?.game;
  const color = couleurDe(game, user);
  if (!color || !game.pgn || !Array.isArray(data.positions)) return null;
  const camp = color === 'w' ? game.white : game.black;
  if (camp.result === 'win') return null;
  const coups = coupsDe(game);
  const chances = (i) => {
    const s = data.positions[i]?.lines?.[0]?.score;
    return s ? winPct(s, color) : null;
  };
  for (let i = 0; i < coups.length; i++) {
    if (coups[i].color !== color || !(chances(i) >= seuil)) continue;
    if (i + 2 < coups.length && !(chances(i + 2) >= seuil)) continue;
    const adversaire = color === 'w' ? game.black : game.white;
    return {
      id: game.id, ply: i, numero: Number(coups[i].before.split(' ')[5]), fen: coups[i].before, color,
      score: data.positions[i].lines[0].score, adversaire: adversaire?.name ?? '', elo: adversaire?.rating ?? null,
      end: game.end ?? null, nulle: game.result === '1/2-1/2',
    };
  }
  return null;
}

export function occasionsConversion(analyses, user, suivis = new Map(), maintenant = Date.now(), jours = JOURS_NOUVELLES) {
  const out = [];
  for (const { data } of analyses) {
    if (!data?.game || !dansPeriode(data.game, jours, maintenant)) continue;
    if (suivis.get(data.game.id)?.archivee) continue;
    const o = occasionConversion(data, user);
    if (o) out.push({ ...o, suivi: suivis.get(o.id) ?? null });
  }
  // les positions pas encore réussies d'abord, puis les plus récentes
  return out.sort((a, b) => Number(!!a.suivi?.reussie) - Number(!!b.suivi?.reussie) || (b.end ?? 0) - (a.end ?? 0));
}
