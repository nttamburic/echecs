// Gestion du temps (sans DOM, testé avec node) : pendules lues dans le PGN ([%clk h:mm:ss]), temps passé
// sur chaque coup et repères sur les fautes. Rien n'est enregistré : tout se recalcule depuis la partie.
import { Chess } from '../vendor/chess.js';
import { epd } from '../analysis.js';

export const PART_MANQUE = 0.10; // « en manque de temps » : au plus 10 % du temps de départ avant le coup
export const PART_CONFORT = 0.25; // « jouée trop vite » : seulement s'il restait plus de 25 %
export const SEUILS_VITE = Object.freeze({ rapid: 5, blitz: 2 }); // secondes ; aucune autre cadence
const FAUTES = ['mistake', 'miss', 'blunder'];

export const REPERES = Object.freeze({
  manque: { label: 'En manque de temps', court: 'en manque de temps' },
  vite: { label: 'Jouée trop vite', court: 'jouée trop vite' },
});

// « 600 » ou « 180+2 » (secondes). Les parties par correspondance (« 1/86400 ») n'ont pas de pendule utile.
export function cadencePendule(texte) {
  const m = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(String(texte ?? '').trim());
  return m && +m[1] > 0 ? { base: +m[1], increment: +(m[2] ?? 0) } : null;
}

export function lirePendule(commentaire) {
  const m = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(commentaire ?? '');
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

const dixieme = (s) => Math.round(s * 10) / 10;

// chess : instance chess.js où le PGN de la partie vient d'être chargé.
// → { base, increment, apres[], avant[], passe[] } (secondes, par demi-coup ; null si inconnu), ou null
// si la partie n'a pas de pendule.
export function tempsDePartie(chess, game) {
  const cadence = cadencePendule(game?.timeControl ?? chess.getHeaders().TimeControl);
  if (!cadence) return null;
  const commentaires = new Map(chess.getComments().map((c) => [c.fen, c.comment]));
  const coups = chess.history({ verbose: true });
  const apres = coups.map((c) => lirePendule(commentaires.get(c.after)));
  if (!apres.some((s) => s != null)) return null;
  const restant = { w: cadence.base, b: cadence.base };
  const avant = [], passe = [];
  coups.forEach((c, i) => {
    avant.push(restant[c.color]);
    passe.push(restant[c.color] == null || apres[i] == null ? null
      : Math.max(0, dixieme(restant[c.color] - apres[i] + cadence.increment)));
    restant[c.color] = apres[i];
  });
  return { ...cadence, apres, avant, passe };
}

// Pendule d'un camp après les `ply` premiers demi-coups.
export function pendule(temps, coups, ply, camp) {
  for (let i = ply - 1; i >= 0; i--) if (coups[i].color === camp) return temps.apres[i];
  return temps.base;
}

// 'manque' | 'vite' | null. Un repère ne dit pas que le temps est la cause de la faute.
export function repere(temps, coups, ply, { cadence, classe, book = {} }) {
  const coup = coups[ply];
  if (!temps || !coup || !FAUTES.includes(classe)) return null;
  const avant = temps.avant[ply], passe = temps.passe[ply];
  if (avant == null) return null;
  if (avant <= temps.base * PART_MANQUE) return 'manque';
  const seuil = SEUILS_VITE[cadence];
  if (!seuil || passe == null || passe > seuil || avant <= temps.base * PART_CONFORT) return null;
  if (book[epd(coup.after)] || new Chess(coup.before).moves().length < 2) return null;
  return 'vite';
}

// Repères des fautes d'un camp : [{ ply, repere }].
export function reperesDe(temps, coups, resultats, camp, options) {
  return coups.flatMap((c, ply) => {
    const r = c.color === camp ? repere(temps, coups, ply, { ...options, classe: resultats[ply]?.cls }) : null;
    return r ? [{ ply, repere: r }] : [];
  });
}

const deux = (n) => String(n).padStart(2, '0');
const virgule = (s) => String(s).replace('.', ',');

// Durée passée sur un coup : « 3,2 s », « 12 s », « 1 min 05 ».
export function fmtDuree(s) {
  if (s < 9.95) return `${virgule(s.toFixed(1))} s`;
  const t = Math.round(s);
  return t < 60 ? `${t} s` : `${Math.floor(t / 60)} min ${deux(t % 60)}`;
}

// Affichage de pendule : « 9:42 », « 1:02:03 », et les dixièmes sous 20 secondes.
export function fmtPendule(s) {
  if (s < 20) {
    const d = Math.floor(s * 10 + 1e-6) / 10;
    return `0:${virgule(d.toFixed(1).padStart(4, '0'))}`;
  }
  const t = Math.floor(s + 1e-6);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60;
  return h ? `${h}:${deux(m)}:${deux(t % 60)}` : `${m}:${deux(t % 60)}`;
}
