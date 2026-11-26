// Qui est « moi » dans une partie (sans DOM, testé avec node). Les parties chess.com se reconnaissent au
// pseudo chess.com, passé en paramètre partout ; les parties Lichess (source « lichess ») au pseudo Lichess,
// qui peut être différent et que le module d'analyse déclare ici. Rien n'est enregistré dans ce fichier.
let pseudoLichess = '';

export function definirPseudoLichess(pseudo) { pseudoLichess = String(pseudo ?? '').trim(); }
export const getPseudoLichess = () => pseudoLichess;

export const siteDe = (game) => (game?.source === 'lichess' ? 'lichess' : 'chesscom');
export const SITES = Object.freeze({ chesscom: 'chess.com', lichess: 'Lichess' });

// Pseudo (en minuscules) à comparer aux joueurs de cette partie ; '' s'il n'est pas réglé.
export const pseudoDe = (game, user) => String((siteDe(game) === 'lichess' ? pseudoLichess : user) ?? '').trim().toLowerCase();

// 'w' | 'b' | null.
export function couleurDe(game, user) {
  const u = pseudoDe(game, user);
  if (!u) return null;
  return String(game?.white?.name ?? '').toLowerCase() === u ? 'w' : String(game?.black?.name ?? '').toLowerCase() === u ? 'b' : null;
}

// Au moins un des deux pseudos est réglé.
export const aUnPseudo = (user) => !!(String(user ?? '').trim() || pseudoLichess);

// Les deux pseudos, pour l'affichage.
export const nomsJoueur = (user) => [...new Set([String(user ?? '').trim(), pseudoLichess].filter(Boolean))].join(' / ');

// ------------------------------------------------------------------ cadences
export const CADENCES = Object.freeze({
  ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', classical: 'Classique', daily: 'Par jour',
});
// Clé d'une cadence sur un site : les classements et les durées des deux sites ne sont pas comparables.
// Les parties chess.com gardent la cadence seule.
export const cleCadence = (game) => (siteDe(game) === 'lichess' ? `lichess|${game.timeClass}` : game.timeClass);
// Par défaut, le site est précisé pour Lichess, et aussi pour chess.com dès qu'un pseudo Lichess est réglé.
export function nomCadence(cle, avecSite) {
  const [a, b] = String(cle).split('|');
  const nom = CADENCES[b ?? a] || b || a;
  if (!(avecSite ?? !!(b || pseudoLichess))) return nom;
  return `${nom} · ${SITES[b ? a : 'chesscom']}`;
}
