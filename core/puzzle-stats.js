// Progression du module Puzzles : un seul enregistrement `puzzleStats/main` dans le magasin, donc
// synchronisé avec GitHub comme les autres données (fichier puzzles/stats.json).
//
// { version: 1, elo: 1200, rush: { best, plays, runs: [{ at, score, errors }] }, updatedAt }
import * as store from './store.js';
import { ELO_START } from '../modules/puzzles-engine.js';

const COL = 'puzzleStats';
const ID = 'main';
const FILE = 'puzzles/stats.json';
const MAX_RUNS = 30;

export const emptyStats = () => ({ version: 1, elo: ELO_START, rush: { best: 0, plays: 0, runs: [] }, themes: {} });

export async function getStats() {
  let s = null;
  try { s = await store.get(COL, ID); } catch { s = null; }
  const base = emptyStats();
  if (!s) return base;
  return { ...base, ...s, rush: { ...base.rush, ...(s.rush || {}) }, themes: { ...(s.themes || {}) } };
}

export async function saveStats(s) {
  await store.put(COL, ID, s, { file: FILE });
}

// Enregistre une série de rush terminée. Renvoie { stats, record } (record : meilleur score battu).
export async function recordRush({ score, errors, elo }) {
  const s = await getStats();
  const record = score > s.rush.best;
  s.rush.best = Math.max(s.rush.best, score);
  s.rush.plays++;
  s.rush.runs = [...s.rush.runs, { at: Date.now(), score, errors }].slice(-MAX_RUNS);
  s.elo = elo;
  await saveStats(s);
  return { stats: s, record };
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
