// Méthode Woodpecker : un jeu fixe de puzzles, résolu en entier puis refait, dans le même ordre, sur des
// cycles de plus en plus rapides. On suit la précision et le temps actif de chaque cycle.
//
// Collections synchronisées (donc comprises dans la sauvegarde) :
//   woodpeckerJeux   { id, creeLe, niveau, abandonneLe?, puzzles: [{ id, fen, moves, rating, themes }] }
//   woodpeckerEssais un enregistrement par puzzle et par cycle :
//                    { jeu, cycle, puzzle, ok: true | false | null, fini, ms, debut, at }
//                    `ok` est null tant que le résultat n'est pas fixé, `ms` est le temps actif cumulé.
// La progression n'est pas stockée : elle est recalculée à partir des essais, ce qui permet de réunir
// ce qui a été fait sur deux appareils.
import * as store from './store.js';
import { pickByRating } from './puzzle-data.js';

export const COL_JEUX = 'woodpeckerJeux';
export const COL_ESSAIS = 'woodpeckerEssais';
export const TAILLES = [50, 100, 200];
export const TAILLE_DEFAUT = 100;
export const DELAIS = [28, 14, 7, 3, 1]; // durée visée de chaque cycle, en jours : indicative, jamais bloquante
export const NB_CYCLES = DELAIS.length;

export const fichierJeux = () => 'puzzles/woodpecker/jeux.json';
export const fichierEssais = (jeu, cycle) => `puzzles/woodpecker/${jeu}-cycle-${cycle}.json`;
export const cleEssai = (jeu, cycle, puzzle) => `${jeu}:${cycle}:${puzzle}`;

// Motifs tactiques mélangés dans un jeu (noms des packs « thème » de la base Lichess).
export const THEMES_JEU = [
  'fork', 'pin', 'skewer', 'discoveredAttack', 'deflection', 'attraction', 'hangingPiece', 'trappedPiece',
  'capturingDefender', 'clearance', 'interference', 'intermezzo', 'xRayAttack', 'sacrifice',
  'mateIn1', 'mateIn2', 'mateIn3', 'backRankMate',
];
const NB_THEMES = 8;

function melanger(a, rnd) {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Puise à tour de rôle dans chaque paquet des puzzles proches du niveau, sans doublon, puis les range
// par difficulté croissante. Cet ordre est celui de tous les cycles.
export function composerJeu(packs, { taille, niveau, rnd = Math.random }) {
  const files = packs.map((p) => pickByRating(p, niveau, { spread: 150, n: taille, rnd }));
  const choisis = new Map();
  let reste = true;
  while (choisis.size < taille && reste) {
    reste = false;
    for (const file of files) {
      if (choisis.size >= taille) break;
      let p = file.shift();
      while (p && choisis.has(p.id)) p = file.shift();
      if (!p) continue;
      choisis.set(p.id, { id: p.id, fen: p.fen, moves: p.moves, rating: p.rating, themes: p.themes || [] });
      reste = true;
    }
  }
  return [...choisis.values()].sort((a, b) => a.rating - b.rating || (String(a.id) < String(b.id) ? -1 : 1));
}

// Charge quelques thèmes tirés au sort ; un paquet indisponible est remplacé par le suivant.
export async function chargerPaquets(manifest, charger, { rnd = Math.random, nb = NB_THEMES } = {}) {
  const dispo = new Set((manifest.theme || []).map((e) => e.name));
  const packs = [];
  let erreur = null;
  for (const theme of melanger(THEMES_JEU.filter((t) => dispo.has(t)), rnd)) {
    if (packs.length >= nb) break;
    try { packs.push(await charger('theme', theme)); } catch (e) { erreur = e; }
  }
  if (!packs.length) throw erreur || new Error('Aucun paquet de puzzles tactiques disponible.');
  return packs;
}

// ------------------------------------------------------------------ progression (fonctions pures)

const jourDe = (t) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };

function bilanCycle(jeu, n, essais, maintenant) {
  const ids = new Set(jeu.puzzles.map((p) => p.id));
  const liste = essais.filter((e) => e.jeu === jeu.id && e.cycle === n && ids.has(e.puzzle));
  const finis = liste.filter((e) => e.fini);
  const termine = finis.length >= ids.size;
  const reussis = finis.filter((e) => e.ok === true).length;
  const debut = liste.length ? Math.min(...liste.map((e) => e.debut)) : null;
  const fin = termine ? Math.max(...finis.map((e) => e.at)) : null;
  const ms = liste.reduce((a, e) => a + e.ms, 0);
  return {
    n, total: ids.size, faits: finis.length, reussis, rates: liste.filter((e) => e.ok === false).length, termine,
    precision: finis.length ? Math.round((100 * reussis) / finis.length) : null,
    ms, moyenne: finis.length ? finis.reduce((a, e) => a + e.ms, 0) / finis.length : null,
    debut, fin,
    // jours calendaires, premier et dernier compris
    jours: debut === null ? 0 : jourDe(fin ?? maintenant) - jourDe(debut) + 1,
    delai: DELAIS[n - 1],
    gain: null, // part de temps gagnée sur le cycle précédent, en %, quand les deux sont terminés
  };
}

export function bilanJeu(jeu, essais, maintenant = Date.now()) {
  const cycles = DELAIS.map((_, i) => bilanCycle(jeu, i + 1, essais, maintenant));
  cycles.forEach((c, i) => {
    const avant = cycles[i - 1];
    if (c.termine && avant?.termine && avant.ms > 0) c.gain = Math.round((100 * (avant.ms - c.ms)) / avant.ms);
  });
  const courant = cycles.find((c) => !c.termine) || null;
  return { cycles, courant, termine: !courant };
}

// Premier puzzle du jeu, dans l'ordre, pas encore terminé dans ce cycle ; son essai entamé s'il existe.
export function prochainPuzzle(jeu, essais, cycle) {
  const faits = new Map(essais.filter((e) => e.jeu === jeu.id && e.cycle === cycle).map((e) => [e.puzzle, e]));
  const index = jeu.puzzles.findIndex((p) => !faits.get(p.id)?.fini);
  return index < 0 ? null : { index, puzzle: jeu.puzzles[index], essai: faits.get(jeu.puzzles[index].id) || null };
}

// Un seul jeu en cours : le plus récent qui n'est ni abandonné ni terminé. Les autres vont à l'historique.
export function jeuActif(jeux, essais) {
  return [...jeux].sort((a, b) => b.creeLe - a.creeLe).find((j) => !j.abandonneLe && !bilanJeu(j, essais).termine) || null;
}

export function formatDuree(ms) {
  const s = Math.round(ms / 1000);
  const deux = (n) => String(n).padStart(2, '0');
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${deux(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${deux(Math.floor((s % 3600) / 60))} min`;
}

// Chronomètre du temps actif : il ne tourne qu'entre lancer() et arreter().
export function chrono(dejaMs = 0, horloge = () => performance.now()) {
  let cumul = dejaMs;
  let depuis = null;
  const lire = () => Math.round(cumul + (depuis === null ? 0 : Math.max(0, horloge() - depuis)));
  return {
    lire,
    lancer() { if (depuis === null) depuis = horloge(); },
    arreter() { cumul = lire(); depuis = null; },
  };
}

// ------------------------------------------------------------------ stockage

export async function lireWoodpecker() {
  const [jeux, essais] = await Promise.all([store.all(COL_JEUX), store.all(COL_ESSAIS)]);
  return { jeux: jeux.map((r) => r.data), essais: essais.map((r) => r.data) };
}

export const enregistrerJeu = (jeu) => store.put(COL_JEUX, jeu.id, jeu, { file: fichierJeux() });

export const enregistrerEssai = (e) => store.put(COL_ESSAIS, cleEssai(e.jeu, e.cycle, e.puzzle), e, { file: fichierEssais(e.jeu, e.cycle) });

export function nouveauJeu(puzzles, niveau, maintenant = Date.now(), rnd = Math.random) {
  return { id: `w${maintenant.toString(36)}${Math.floor(rnd() * 1296).toString(36).padStart(2, '0')}`, creeLe: maintenant, niveau, puzzles };
}
