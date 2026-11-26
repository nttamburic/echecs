// Module « Étude » — stockage (synchronisé comme les analyses, via store.js / sync.js).
//   study        / <id> : { name, order: [id de chapitre], createdAt }
//   studyChapter / <id> : { studyId, name, orientation: 'w'|'b', pgn }
// Le PGN est la forme enregistrée d'un chapitre (voir core/study-pgn.js) : commentaires, symboles,
// flèches et variantes y sont, au format des études Lichess.
// Un enregistrement par chapitre et un fichier GitHub par étude : deux appareils qui modifient deux
// chapitres différents ne s'écrasent pas ; sur le même chapitre, la version la plus récente gagne.
import * as store from '../core/store.js';
import { chapterToPgn, parsePgn, newRoot, countMoves } from '../core/study-pgn.js';

export const STUDY = 'study';
export const CHAPTER = 'studyChapter';
const fileOf = (studyId) => `studies/${studyId}.json`;
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const ID_RE = /^[A-Za-z0-9_-]+$/;
const str = (x) => typeof x === 'string';

// Les enregistrements viennent aussi d'un autre appareil : les mal formés sont ignorés.
function saneStudy(id, d) {
  if (!d || typeof d !== 'object' || !ID_RE.test(id)) return null;
  return { id, name: str(d.name) && d.name.trim() ? d.name : 'Étude', order: Array.isArray(d.order) ? d.order.filter(str) : [], createdAt: Number(d.createdAt) || 0 };
}
const saneChapter = (r) => (r.data && str(r.data.studyId) && str(r.data.pgn)
  ? { id: r.id, studyId: r.data.studyId, name: str(r.data.name) && r.data.name.trim() ? r.data.name : 'Chapitre', orientation: r.data.orientation === 'b' ? 'b' : 'w', pgn: r.data.pgn, updatedAt: r.updatedAt || 0 }
  : null);

// Chapitres dans l'ordre de l'étude ; un chapitre absent de la liste (créé sur un autre appareil
// pendant que l'ordre changeait ici) est ajouté à la fin au lieu d'être perdu.
function ordered(study, chapters) {
  const rank = new Map(study.order.map((id, i) => [id, i]));
  return chapters.filter((c) => c.studyId === study.id).sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.id.localeCompare(b.id));
}
const allChapters = async () => (await store.all(CHAPTER)).map(saneChapter).filter(Boolean);
const withChapters = (study, chapters) => {
  const list = ordered(study, chapters);
  return { ...study, chapters: list, updatedAt: list.reduce((m, c) => Math.max(m, c.updatedAt), study.createdAt) };
};

export async function listStudies() {
  const [rows, chapters] = await Promise.all([store.all(STUDY), allChapters()]);
  return rows.map((r) => saneStudy(r.id, r.data)).filter(Boolean).map((s) => withChapters(s, chapters)).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function getStudy(id) {
  const s = saneStudy(id, await store.get(STUDY, id));
  return s ? withChapters(s, await allChapters()) : null;
}

export const saveStudy = (s) => store.put(STUDY, s.id, { name: s.name, order: s.chapters.map((c) => c.id), createdAt: s.createdAt }, { file: fileOf(s.id) });
export async function saveChapter(c) {
  c.updatedAt = Date.now();
  await store.put(CHAPTER, c.id, { studyId: c.studyId, name: c.name, orientation: c.orientation, pgn: c.pgn }, { file: fileOf(c.studyId) });
}

export const emptyChapter = (name, { fen, orientation = 'w' } = {}) => ({ name, orientation, headers: {}, root: newRoot(fen) });

// Ajoute des chapitres lus ({ name, orientation, headers, root }) à la fin de l'étude.
export async function addChapters(study, parsed) {
  const out = [];
  for (const p of parsed) {
    const c = { id: uid('c'), studyId: study.id, name: p.name, orientation: p.orientation, pgn: chapterToPgn(p, study.name) };
    await saveChapter(c);
    out.push(c);
  }
  study.chapters.push(...out);
  await saveStudy(study);
  return out;
}
export async function createStudy(name, parsed) {
  const study = { id: uid('s'), name: String(name || '').trim() || 'Nouvelle étude', chapters: [], createdAt: Date.now() };
  await addChapters(study, parsed);
  return study;
}
export async function removeChapter(study, id) {
  study.chapters = study.chapters.filter((c) => c.id !== id);
  await saveStudy(study);
  await store.remove(CHAPTER, id);
}
export async function removeStudy(study) {
  for (const c of study.chapters) await store.remove(CHAPTER, c.id);
  await store.remove(STUDY, study.id);
}

// Chapitre enregistré → arbre. Le nom et l'orientation de l'enregistrement font foi.
export function openChapter(c) {
  const p = parsePgn(c.pgn).chapters[0] || emptyChapter(c.name);
  return { ...p, name: c.name, orientation: c.orientation };
}
export const movesIn = (c) => countMoves(openChapter(c).root);
