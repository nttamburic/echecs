// Progression du module Puzzles : un seul enregistrement `puzzleStats/main` dans le magasin, donc
// synchronisé avec GitHub comme les autres données (fichier puzzles/stats.json).
//
// { version: 1, elo: 1200, themes: { nom: { n, ok } } }
// Les anciens résultats de Puzzle Rush (champ `rush`) ne sont plus affichés, mais restent dans l'enregistrement.
import * as store from './store.js';
import { ELO_START } from '../modules/puzzles-engine.js';

const COL = 'puzzleStats';
const ID = 'main';
const FILE = 'puzzles/stats.json';

export const emptyStats = () => ({ version: 1, elo: ELO_START, themes: {} });

export async function getStats() {
  let s = null;
  try { s = await store.get(COL, ID); } catch { s = null; }
  const base = emptyStats();
  if (!s) return base;
  return { ...base, ...s, themes: { ...(s.themes || {}) } };
}

export async function saveStats(s) {
  await store.put(COL, ID, s, { file: FILE });
}

// Enregistre un puzzle thématique (réussi ou raté) : taux par thème et niveau mis à jour.
// themes[nom] = { n: puzzles joués, ok: réussis }
export async function recordTheme({ theme, success, elo }) {
  const s = await getStats();
  const t = s.themes[theme] || { n: 0, ok: 0 };
  s.themes[theme] = { n: t.n + 1, ok: t.ok + (success ? 1 : 0) };
  s.elo = elo;
  await saveStats(s);
  return s;
}
