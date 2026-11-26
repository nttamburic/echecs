// Sauvegarde et restauration des données de l'utilisateur, dans un fichier JSON indépendant de GitHub.
// La sauvegarde contient les enregistrements synchronisés. Les jetons, les réglages propres à
// l'appareil et le cache des parties chess.com n'en font pas partie.
//
// La restauration ne supprime jamais rien et ne remplace pas une donnée plus récente :
//   - absente de l'appareil : ajoutée avec sa date d'origine (une version plus récente sur GitHub
//     garde ainsi la priorité) ;
//   - supprimée ici : récupérée avec la date du jour, pour l'emporter sur la suppression ;
//   - plus ancienne ici que dans la sauvegarde : remplacée ;
//   - plus récente ici : conservée.
import * as store from './store.js';

const APP = 'chess-journey';
const FORMAT = 1;
// « file » devient un chemin dans le dépôt GitHub : on n'accepte que des chemins relatifs simples.
const FILE_RE = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.json$/;

export async function makeBackup(now = new Date()) {
  const records = (await store.allRecords()).filter((r) => !r.deleted);
  // Un morceau par enregistrement : une grosse base ne passe pas par une seule chaîne géante.
  const parts = [`{"app":"${APP}","format":${FORMAT},"exportedAt":${JSON.stringify(now.toISOString())},"records":[`];
  records.forEach(({ col, id, data, updatedAt, file }, i) => parts.push((i ? ',' : '') + JSON.stringify({ col, id, data, updatedAt, file })));
  parts.push(']}');
  return { parts, records };
}

// Lit et vérifie le texte d'une sauvegarde. Un seul enregistrement invalide fait refuser le fichier.
export function parseBackup(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('Ce fichier n’est pas une sauvegarde lisible (il est peut-être incomplet).'); }
  if (!j || j.app !== APP || !Array.isArray(j.records)) throw new Error('Ce fichier n’est pas une sauvegarde Chess Journey.');
  if (j.format !== FORMAT) throw new Error('Cette sauvegarde vient d’une autre version de l’application : rechargez l’application puis réessayez.');
  const ok = (r) => r && typeof r.col === 'string' && r.col && !r.col.includes('/') && typeof r.id === 'string' && r.id
    && r.data !== null && r.data !== undefined && Number.isFinite(r.updatedAt) && typeof r.file === 'string' && FILE_RE.test(r.file);
  if (!j.records.every(ok)) throw new Error('Cette sauvegarde contient des données invalides : rien n’a été restauré.');
  return { exportedAt: j.exportedAt, records: j.records };
}

// Ce que la restauration fera d'un enregistrement, selon la version présente sur l'appareil.
export function restoreAction(saved, current) {
  if (!current) return 'add';
  if (current.deleted) return 'recover';
  if (JSON.stringify(current.data) === JSON.stringify(saved.data)) return 'same';
  return saved.updatedAt > (current.updatedAt || 0) ? 'update' : 'keep';
}

const emptyCounts = () => ({ add: 0, recover: 0, update: 0, keep: 0, same: 0 });

export async function planRestore(records) {
  const current = new Map((await store.allRecords()).map((r) => [r.key, r]));
  const counts = emptyCounts();
  for (const r of records) counts[restoreAction(r, current.get(`${r.col}/${r.id}`))]++;
  return counts;
}

export async function applyRestore(records, now = Date.now()) {
  const counts = emptyCounts();
  await store.restoreRecords(records, (saved, current) => {
    const action = restoreAction(saved, current);
    counts[action]++;
    if (action === 'same' || action === 'keep') return null;
    return {
      key: `${saved.col}/${saved.id}`, col: saved.col, id: saved.id, data: saved.data,
      updatedAt: action === 'recover' ? now : saved.updatedAt,
      file: current ? current.file : saved.file,
    };
  });
  return counts;
}
