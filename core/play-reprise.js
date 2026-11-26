// Partie contre Maia en cours : ce qu'il faut garder sur l'appareil pour la retrouver après un
// rechargement (ou quand Android ferme l'appli). Elle n'entre ni dans l'historique, ni dans la
// synchronisation. Sans accès au DOM.
import { Chess } from '../vendor/chess.js';

export const CLE_PARTIE = 'playSave';
const uci = (m) => m.from + m.to + (m.promotion || '');

// Texte à enregistrer, ou null s'il n'y a pas de partie à reprendre.
export function partieAGarder(P) {
  if (P.phase !== 'play') return null;
  let etude = null;
  if (P.etude) {
    const { enregistrement, ...reste } = P.etude;
    etude = reste;
  }
  return JSON.stringify({
    v: 1, startFen: P.startFen, ucis: P.moves.map(uci), base: P.base, user: P.user, elo: P.elo,
    tc: P.tc, clock: P.clock && { w: Math.round(P.clock.w), b: Math.round(P.clock.b) }, label: P.label, etude,
  });
}

// Relit une partie gardée. Renvoie null si elle est absente, abîmée ou déjà terminée.
export function relirePartie(texte) {
  if (!texte) return null;
  try {
    const s = JSON.parse(texte);
    if (s.v !== 1 || !['w', 'b'].includes(s.user) || !(s.elo > 0) || !Array.isArray(s.ucis)) return null;
    const chess = new Chess(s.startFen);
    const startFen = chess.fen();
    // les coups sont rejoués : l'historique sert à détecter les répétitions
    const moves = s.ucis.map((u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
    if (chess.isGameOver()) return null;
    const clock = s.clock && s.clock.w > 0 && s.clock.b > 0 ? { w: s.clock.w, b: s.clock.b } : null;
    return {
      chess, startFen, moves, ply: moves.length, base: Math.max(0, Math.min(moves.length, s.base || 0)),
      user: s.user, elo: s.elo, tc: clock ? s.tc : 0, clock, label: s.label || null, etude: s.etude || null,
    };
  } catch { return null; }
}
