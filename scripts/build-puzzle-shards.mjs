#!/usr/bin/env node
// Découpe une base de puzzles CSV (format Lichess) en morceaux JSON compressés (gzip),
// un par thème et par tranche de classement, plus un index léger.
//
// Usage :
//   zstd -d lichess_db_puzzle.csv.zst -o puzzles-src.csv      (une fois, hors dépôt)
//   node scripts/build-puzzle-shards.mjs puzzles-src.csv build/puzzles [--cap 1500] [--min-pop 0]
//
// Sortie :
//   build/puzzles/index.json            liste des morceaux (thème, tranche, nombre, fichier)
//   build/puzzles/<thème>-<tranche>.json.gz   tableau de puzzles au format compact
//
// Format compact d'un puzzle : [id, fen, coups, classement, popularité, thèmes, ouverture]
// Les morceaux sont triés par popularité décroissante et plafonnés (--cap).
// Aucune dépendance externe : Node 18+ suffit.

import { createReadStream, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const args = process.argv.slice(2);
const [src, outDir] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!src || !outDir) {
  console.error('Usage : node scripts/build-puzzle-shards.mjs <puzzles.csv> <dossier-sortie> [--cap N] [--min-pop N]');
  process.exit(1);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const CAP = opt('--cap', 1500);
const MIN_POP = opt('--min-pop', 0);

// Tranches de classement : borne basse incluse, borne haute exclue.
const BANDS = [[0, 1000], [1000, 1400], [1400, 1800], [1800, 2200], [2200, 2600], [2600, 3000], [3000, 9999]];
const bandOf = (r) => BANDS.findIndex(([lo, hi]) => r >= lo && r < hi);
const bandName = (i) => `${BANDS[i][0]}-${BANDS[i][1]}`;

// Accumulateurs : clé « thème|tranche » -> liste de puzzles.
const buckets = new Map();
let read = 0, kept = 0, skipped = 0;

const rl = createInterface({ input: createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity });
let header = null;
for await (const line of rl) {
  if (!line) continue;
  const cols = line.split(',');
  if (!header) { header = cols; continue; } // première ligne : en-têtes
  read++;
  // Les champs ne contiennent jamais de virgule dans ce format, sauf GameUrl/FEN : aucun risque ici.
  const row = Object.fromEntries(header.map((h, i) => [h, cols[i]]));
  const rating = Number(row.Rating);
  const pop = Number(row.Popularity);
  const band = bandOf(rating);
  if (band < 0 || pop < MIN_POP) { skipped++; continue; }
  const themes = (row.Themes || '').split(' ').filter(Boolean);
  const compact = [row.PuzzleId, row.FEN, row.Moves, rating, pop, themes.join(' '), row.OpeningTags || ''];
  for (const theme of themes) {
    const key = `${theme}|${band}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(compact);
  }
  kept++;
}

// Nettoyage du dossier de sortie puis écriture des morceaux.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const shards = [];
for (const [key, list] of buckets) {
  const [theme, bandIdx] = key.split('|');
  list.sort((a, b) => b[4] - a[4]); // popularité décroissante
  const chosen = list.slice(0, CAP);
  const file = `${theme}-${bandName(Number(bandIdx))}.json.gz`.replace(/[^\w.-]/g, '_');
  writeFileSync(join(outDir, file), gzipSync(JSON.stringify(chosen)));
  shards.push({ theme, band: BANDS[Number(bandIdx)], count: chosen.length, total: list.length, file });
}
shards.sort((a, b) => a.theme.localeCompare(b.theme) || a.band[0] - b.band[0]);

const index = {
  version: 1,
  generated: new Date().toISOString(),
  cap: CAP,
  minPopularity: MIN_POP,
  format: ['id', 'fen', 'moves', 'rating', 'popularity', 'themes', 'opening'],
  puzzlesRead: read,
  puzzlesKept: kept,
  shards,
};
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));

const size = readdirSync(outDir).filter((f) => f.endsWith('.gz')).length;
console.log(`Lus : ${read} · retenus : ${kept} · écartés : ${skipped} · morceaux : ${size}`);
console.log(`Index : ${join(outDir, 'index.json')}`);
