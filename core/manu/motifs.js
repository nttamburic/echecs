// Manu AI, version web : motifs tactiques d'une suite de coups. Module pur, sans DOM.
// Portage d'un sous-ensemble de Manu_AI/motifs (Python), qui reste la référence.
//
// detectMotifs(fen, pvUci) rejoue la suite depuis `fen` et renvoie, pour chaque demi-coup, les motifs
// qu'il crée : { famille, camp, acteur, cibles, coups }. `coups` est le préfixe de la suite à rejouer
// pour voir le motif ; sa longueur est donc le demi-coup où il apparaît.
import { Chess } from '../../vendor/chess.js';
import { attacks, boardMap, exchange } from './geometry.js';

const fromUci = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

function kingSquare(c, color) {
  for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

// Mat : le camp qui vient de jouer mate. Acteur : la pièce qui donne échec (celle qui vient de bouger
// en cas de double échec).
function mat(c, move) {
  if (!c.isCheckmate()) return [];
  const king = kingSquare(c, c.turn());
  const checkers = c.attackers(king, move.color);
  const acteur = checkers.includes(move.to) ? move.to : checkers[0];
  return [{ famille: 'Échec et mat', camp: move.color, acteur, cibles: [king] }];
}

// Fourchette : une pièce du camp qui vient de jouer attaque au moins deux pièces adverses (hors pions),
// dont deux sont gagnables : le roi, ou une pièce dont la prise gagne du matériel à l'échange.
// Une double attaque sur des pièces défendues n'est pas retenue. Cibles dans l'ordre des cases.
function fourchette(c, move, map) {
  const out = [];
  for (const s of Object.keys(map)) {
    const p = map[s];
    if (p.color !== move.color || p.type === 'k') continue;
    const cibles = attacks(map, s).filter((z) => map[z] && map[z].color !== p.color && map[z].type !== 'p').sort();
    if (cibles.length < 2) continue;
    const gagnables = cibles.filter((z) => map[z].type === 'k' || exchange(map, s, z) > 0);
    if (gagnables.length >= 2) out.push({ famille: 'Fourchette', camp: p.color, acteur: s, cibles });
  }
  return out;
}

const DETECTEURS = [mat, fourchette];
const cle = (m) => `${m.famille}|${m.camp}|${m.acteur}|${m.cibles.join(',')}`;

// Un motif n'est rapporté qu'au demi-coup où il apparaît, pas tant qu'il persiste.
export function detectMotifs(fen, pvUci) {
  const c = new Chess(fen);
  const out = [];
  const played = [];
  let before = new Set();
  for (const u of pvUci) {
    let move;
    try { move = c.move(fromUci(u)); } catch { break; }
    played.push(u);
    const map = boardMap(c);
    const now = DETECTEURS.flatMap((detect) => detect(c, move, map));
    for (const m of now) if (!before.has(cle(m))) out.push({ ...m, coups: played.slice() });
    before = new Set(now.map(cle));
  }
  return out;
}
