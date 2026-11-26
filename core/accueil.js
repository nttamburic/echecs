// Page d'accueil : calculs à partir des données déjà enregistrées (sans DOM, testable).
// jeux : parties chess.com ({ id, end (s), timeClass, white, black }) ; index : analyses résumées par
// identifiant de partie ({ complete, accW, accB }).
import { DRAWS } from '../modules/openings.js';

const JOUR = 86400000;
export const JOURS_RECENTS = 7;

const estBlanc = (jeu, user) => jeu.white.name.toLowerCase() === String(user).toLowerCase();
const recentes = (jeux, jours, maintenant) => jeux.filter((g) => g.end * 1000 >= maintenant - jours * JOUR && g.end * 1000 <= maintenant);
const parDate = (jeux) => [...jeux].sort((a, b) => b.end - a.end);

// 'win' | 'draw' | 'loss' du point de vue du joueur.
export function issue(jeu, user) {
  const r = jeu[estBlanc(jeu, user) ? 'white' : 'black'].result;
  return r === 'win' ? 'win' : DRAWS.includes(r) ? 'draw' : 'loss';
}

export function resultatsRecents(jeux, user, maintenant = Date.now(), jours = JOURS_RECENTS) {
  const s = { win: 0, draw: 0, loss: 0, total: 0 };
  for (const g of recentes(jeux, jours, maintenant)) { s[issue(g, user)]++; s.total++; }
  return s;
}

// Classement après la partie la plus récente, avec sa cadence.
export function dernierElo(jeux, user) {
  const g = parDate(jeux)[0];
  if (!g) return null;
  return { cadence: g.timeClass, elo: g[estBlanc(g, user) ? 'white' : 'black'].rating };
}

export const aAnalyser = (jeux, index, maintenant = Date.now(), jours = JOURS_RECENTS) =>
  recentes(jeux, jours, maintenant).filter((g) => !index[g.id]?.complete).length;

export function dernieresParties(jeux, index, user, n = 5) {
  return parDate(jeux).slice(0, n).map((g) => {
    const blanc = estBlanc(g, user);
    const a = index[g.id];
    return {
      id: g.id, end: g.end, cadence: g.timeClass, camp: blanc ? 'w' : 'b',
      adversaire: (blanc ? g.black : g.white).name, issue: issue(g, user),
      precision: a?.complete ? (blanc ? a.accW : a.accB) : null,
    };
  });
}

// Puzzles recommandés déjà tentés et arrivés à échéance : { n, source } où source est la série à lancer.
export function puzzlesDus(cartes, maintenant = Date.now()) {
  const dus = [...cartes.values()].filter((r) => r.card.due <= maintenant);
  const sources = new Set(dus.map((r) => r.puzzle.source));
  const source = sources.size > 1 ? 'mix' : sources.has('opening') ? 'opening' : 'mistake';
  return { n: dus.length, source };
}

const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);

// « À faire aujourd'hui », dans l'ordre d'importance ; les activités sans rien à faire sont omises.
export function taches({ ouvertures, puzzles, woodpecker, parties, erreurs }) {
  const out = [];
  if (ouvertures && ouvertures.dus + ouvertures.nouveaux > 0) {
    const { dus, nouveaux, repertoires } = ouvertures;
    const detail = [dus && `${dus} à revoir`, nouveaux && `${nouveaux} ${pluriel(nouveaux, 'nouveau', 'nouveaux')}`].filter(Boolean).join(' · ');
    out.push({ cle: 'ouvertures', n: dus + nouveaux, titre: pluriel(dus + nouveaux, 'Coup d’ouverture à travailler', 'Coups d’ouverture à travailler'),
      detail: `${detail} · ${repertoires} ${pluriel(repertoires, 'répertoire', 'répertoires')}`, action: 'Réviser', href: '#/openings/train/due' });
  }
  if (puzzles?.n) {
    out.push({ cle: 'puzzles', n: puzzles.n, titre: pluriel(puzzles.n, 'Puzzle à revoir', 'Puzzles à revoir'),
      detail: 'Répétition espacée des puzzles recommandés', action: 'S’entraîner', href: `#/puzzles/recommend/${puzzles.source}` });
  }
  if (erreurs) {
    out.push({ cle: 'erreurs', n: erreurs, titre: pluriel(erreurs, 'Erreur à rejouer', 'Erreurs à rejouer'),
      detail: 'Trouvez mieux : vos erreurs stratégiques et de finales', action: 'Réviser', href: '#/revision/seance' });
  }
  if (woodpecker) {
    const reste = woodpecker.total - woodpecker.faits;
    if (reste > 0) {
      out.push({ cle: 'woodpecker', n: reste, titre: pluriel(reste, 'Puzzle pour finir le cycle Woodpecker', 'Puzzles pour finir le cycle Woodpecker'),
        detail: `Cycle ${woodpecker.cycle} sur ${woodpecker.cycles} · durée visée : ${woodpecker.delai} ${pluriel(woodpecker.delai, 'jour', 'jours')}`, action: 'Continuer', href: '#/puzzles/woodpecker/jouer' });
    }
  }
  if (parties) {
    // Pas de lien : l'accueil ouvre la fenêtre d'analyse multiple sur la période.
    out.push({ cle: 'parties', n: parties, titre: pluriel(parties, 'Partie récente à analyser', 'Parties récentes à analyser'),
      detail: `Jouées depuis ${JOURS_RECENTS} jours · met à jour vos erreurs à travailler`, action: 'Analyser', href: null });
  }
  return out;
}
