// Paramètres → Sauvegarde : fichier de sauvegarde, restauration et export PGN.
import { $, esc, local, toast } from '../core/ui.js';
import { cfg, syncNow } from '../core/sync.js';
import * as store from '../core/store.js';
import { makeBackup, parseBackup, planRestore, applyRestore } from '../core/backup.js';
import { repertoiresToPgn, gamesToPgn } from '../core/pgn-export.js';
import { listRepertoires, REP } from './openings.js';
import { BOOK } from './analyse.js';
import { fmtAgo } from '../core/format.js';

const day = () => {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'repertoire';
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;

function download(name, parts, type) {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function summaryOf(records) {
  const n = (col) => records.filter((r) => r.col === col).length;
  return `${plural(n('analysis'), 'partie analysée', 'parties analysées')}, ${plural(n(REP), 'répertoire')}, ${plural(n('study'), 'étude')}, ${plural(records.length, 'enregistrement')} au total`;
}

function lastBackupText() {
  const at = Number(local.get('lastBackup', 0));
  return at ? `Dernière sauvegarde téléchargée sur cet appareil : ${fmtAgo(new Date(at))}.` : 'Aucune sauvegarde téléchargée depuis cet appareil.';
}

export function backupTab(el) {
  el.innerHTML = `
  <section class="card">
    <h2>Sauvegarde complète</h2>
    <p class="muted">Un fichier contenant vos analyses, vos répertoires, vos notes et vos résultats d'entraînement. Il ne dépend pas de GitHub.
      Il ne contient ni vos jetons ni les réglages propres à cet appareil. Gardez-le pour vous : il contient vos parties.</p>
    <div class="row"><button type="button" id="bk-save" class="btn primary">Télécharger la sauvegarde</button></div>
    <p id="bk-save-msg" class="muted small" role="status">${esc(lastBackupText())}</p>
    <p id="bk-persist" class="muted small" role="status"></p>
  </section>
  <section class="card">
    <h2>Restaurer une sauvegarde</h2>
    <p class="muted">La restauration ajoute ce qui manque et récupère ce qui a été supprimé, y compris ce que vous avez supprimé volontairement.
      Elle ne supprime rien et conserve vos données plus récentes. Rien n'est modifié avant votre confirmation.</p>
    <div class="form"><label>Fichier de sauvegarde (.json) <input type="file" id="bk-file" accept=".json,application/json"></label></div>
    <p id="bk-load-msg" class="muted small" role="status"></p>
    <div class="row"><button type="button" id="bk-restore" class="btn primary hidden">Restaurer</button></div>
  </section>
  <section class="card">
    <h2>Exporter en PGN</h2>
    <p class="muted">Pour ouvrir vos données dans Lichess, chess.com ou un autre logiciel. Le PGN ne remplace pas la sauvegarde :
      la maîtrise, les coups désactivés et les analyses détaillées n'y sont pas.</p>
    <div class="frow"><label for="bk-rep">Répertoire</label><select id="bk-rep"></select></div>
    <div class="row">
      <button type="button" id="bk-pgn-rep" class="btn" disabled>Exporter le répertoire</button>
      <button type="button" id="bk-pgn-games" class="btn">Exporter les parties analysées</button>
    </div>
    <p id="bk-pgn-msg" class="muted small" role="status"></p>
  </section>`;

  const say = (id, text, cls = 'muted') => { const p = $(id, el); if (p) { p.className = cls + ' small'; p.textContent = text; } };
  navigator.storage?.persisted?.().then((ok) => say('#bk-persist', ok
    ? 'Stockage protégé : le navigateur n’effacera pas ces données de lui-même pour libérer de la place.'
    : 'Stockage non protégé : le navigateur pourrait effacer ces données s’il manque de place. Installer l’application aide à obtenir la protection ; gardez une sauvegarde.')).catch(() => {});
  const guard = (msgId, fn) => async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try { await fn(); } catch (err) { say(msgId, err.message || String(err), 'err'); } finally { button.disabled = false; }
  };

  $('#bk-save', el).onclick = guard('#bk-save-msg', async () => {
    const { parts, records } = await makeBackup();
    if (!records.length) { say('#bk-save-msg', 'Aucune donnée à sauvegarder sur cet appareil.'); return; }
    download(`chess-journey-sauvegarde-${day()}.json`, parts, 'application/json');
    local.set('lastBackup', String(Date.now()));
    say('#bk-save-msg', `Sauvegarde créée : ${summaryOf(records)}. Vérifiez qu'elle est dans vos téléchargements.`, 'ok');
  });

  // ----- restauration : on lit et on annonce le résultat avant d'écrire quoi que ce soit
  let loaded = null;
  const restoreButton = $('#bk-restore', el);
  $('#bk-file', el).onchange = async (e) => {
    loaded = null;
    restoreButton.classList.add('hidden');
    const file = e.target.files[0];
    if (!file) { say('#bk-load-msg', ''); return; }
    say('#bk-load-msg', 'Lecture du fichier…');
    try {
      const backup = parseBackup(await file.text());
      const c = await planRestore(backup.records);
      const date = new Date(backup.exportedAt);
      const changes = c.add + c.recover + c.update;
      say('#bk-load-msg', `Sauvegarde${Number.isNaN(date.getTime()) ? '' : ' du ' + date.toLocaleString('fr-FR')} : ${summaryOf(backup.records)}. `
        + `À ajouter : ${c.add}. Supprimés ici, à récupérer : ${c.recover}. Plus anciens ici, à remplacer : ${c.update}. `
        + `Plus récents ici, conservés : ${c.keep}. Identiques : ${c.same}.${changes ? '' : ' Rien à restaurer.'}`);
      if (changes) { loaded = backup; restoreButton.classList.remove('hidden'); }
    } catch (err) { say('#bk-load-msg', err.message || String(err), 'err'); }
  };

  restoreButton.onclick = guard('#bk-load-msg', async () => {
    if (!loaded) return;
    // Avec GitHub, on synchronise d'abord : la restauration part ainsi des données les plus récentes.
    let synced = true;
    if (cfg.configured) { say('#bk-load-msg', 'Synchronisation avant restauration…'); synced = await syncNow(); }
    const c = await planRestore(loaded.records);
    const ok = confirm(`Restaurer cette sauvegarde ?\n\n• ${c.add} à ajouter\n• ${c.recover} supprimé(s) à récupérer\n• ${c.update} à remplacer par une version plus récente\n\n`
      + (synced ? '' : 'Attention : la synchronisation a échoué. Les données de GitHub n’ont pas pu être vérifiées.\n\n')
      + 'L’application sera ensuite rechargée.');
    if (!ok) { say('#bk-load-msg', 'Restauration annulée : rien n’a été modifié.'); return; }
    const done = await applyRestore(loaded.records);
    loaded = null;
    restoreButton.classList.add('hidden');
    say('#bk-load-msg', `Restauration terminée : ${done.add + done.recover + done.update} enregistrement(s). Rechargement…`, 'ok');
    toast('Restauration terminée.');
    setTimeout(() => location.reload(), 2000); // les écrans relisent les données restaurées
  });

  // ----- PGN
  let reps = [];
  listRepertoires().then((list) => {
    reps = list;
    const select = $('#bk-rep', el);
    if (!select) return;
    select.innerHTML = list.length
      ? list.map((r, i) => `<option value="${i}">${esc(r.name)} (${r.color === 'b' ? 'Noirs' : 'Blancs'})</option>`).join('')
        + (list.length > 1 ? '<option value="all">Tous les répertoires (un seul fichier)</option>' : '')
      : '<option value="">Aucun répertoire</option>';
    $('#bk-pgn-rep', el).disabled = !list.length;
  }).catch((err) => say('#bk-pgn-msg', err.message || String(err), 'err'));

  $('#bk-pgn-rep', el).onclick = guard('#bk-pgn-msg', async () => {
    const v = $('#bk-rep', el).value;
    const chosen = v === 'all' ? reps : [reps[Number(v)]];
    const name = v === 'all' ? 'repertoires' : slug(chosen[0].name);
    download(`chess-journey-${name}-${day()}.pgn`, [repertoiresToPgn(chosen)], 'application/x-chess-pgn');
    say('#bk-pgn-msg', `PGN créé : ${plural(chosen.length, 'répertoire')}.`, 'ok');
  });

  $('#bk-pgn-games', el).onclick = guard('#bk-pgn-msg', async () => {
    say('#bk-pgn-msg', 'Préparation du PGN…');
    const rows = await store.all('analysis');
    const { text, count, failed } = gamesToPgn(rows.map((r) => r.data), BOOK);
    if (!count) { say('#bk-pgn-msg', failed ? 'Aucune partie analysée n’a pu être lue.' : 'Aucune partie analysée sur cet appareil.', failed ? 'err' : 'muted'); return; }
    download(`chess-journey-parties-${day()}.pgn`, [text], 'application/x-chess-pgn');
    say('#bk-pgn-msg', `PGN créé : ${plural(count, 'partie')}${failed ? `, ${plural(failed, 'illisible ignorée', 'illisibles ignorées')}` : ''}.`, 'ok');
  });
}
