// Réglages : synchronisation GitHub, moteur, installation sur téléphone.
import { $, esc, local, toast } from '../core/ui.js';
import { cfg, test, syncNow, state, onSync } from '../core/sync.js';
import { detectBoost, engineLabel, onStatus, status as engineStatus, wasmDepth } from '../core/engine.js';

let unsub = null;
let unsubEng = null;
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

export function render(el) {
  const depth = wasmDepth();
  el.innerHTML = `
  <section class="card">
    <h1>Synchronisation PC ⇄ téléphone</h1>
    <p class="muted">Vos analyses et votre entraînement sont enregistrés sur cet appareil, et copiés dans un dépôt GitHub <b>privé</b>
      pour les retrouver sur vos autres appareils. Le jeton reste uniquement sur cet appareil.</p>
    <div class="form">
      <label>Compte GitHub <input id="gh-owner" value="${esc(cfg.owner)}" placeholder="votre-pseudo-github" autocapitalize="off" spellcheck="false"></label>
      <label>Dépôt privé <input id="gh-repo" value="${esc(cfg.repo)}" placeholder="echecs-data" autocapitalize="off" spellcheck="false"></label>
      <label>Jeton d'accès <input id="gh-token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="row">
      <button id="gh-save" class="btn primary">Enregistrer et tester</button>
      <button id="gh-sync" class="btn">Synchroniser maintenant</button>
      <button id="gh-forget" class="btn">Oublier le jeton</button>
    </div>
    <p id="gh-msg" class="muted"></p>
    <details>
      <summary>Comment créer le dépôt et le jeton (une seule fois)</summary>
      <ol>
        <li>Sur <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a> : nom du dépôt <b>echecs-data</b>, cochez <b>Private</b>, puis « Create repository ».</li>
        <li>Allez sur <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> (jeton « fine-grained »).</li>
        <li>Nom : « Échecs ». Expiration : 1 an (ou ce que vous voulez).</li>
        <li><b>Repository access</b> : « Only select repositories » → choisissez <b>echecs-data</b> uniquement.</li>
        <li><b>Permissions</b> → Repository permissions → <b>Contents : Read and write</b>. Rien d'autre.</li>
        <li>« Generate token », copiez-le, collez-le ci-dessus. Faites de même sur le téléphone (ou copiez-le-vous dans un endroit sûr).</li>
      </ol>
    </details>
  </section>

  <section class="card">
    <h1>Moteur d'analyse</h1>
    <p id="eng-label"></p>
    <label class="check"><input type="checkbox" id="boost" ${local.get('boost', '1') === '1' ? 'checked' : ''}> Utiliser le « boost PC » quand il est lancé
      <span class="muted">(Stockfish 19 complet, 6 cœurs, profondeur 22 — double-clic sur « Lancer l'analyseur.bat »)</span></label>
    <div class="row">
      <label>Profondeur sans le PC
        <select id="wasm-depth">${[12, 14, 16, 18, 20].map((d) => `<option ${d === depth ? 'selected' : ''}>${d}</option>`).join('')}</select>
      </label>
      <button id="boost-retry" class="btn">Rechercher le PC</button>
    </div>
    <p class="muted small">Sans le PC, Stockfish 19 « lite » tourne directement dans le navigateur (aussi sur téléphone). Plus la profondeur est grande, plus l'analyse est juste… et lente.
      Les positions connues viennent de l'analyse cloud Lichess, les finales à 7 pièces ou moins des tables de finales.</p>
  </section>

  <section class="card">
    <h1>Installer sur le téléphone</h1>
    <p>Sur Android, ouvrez cette page dans Chrome, puis menu <b>⋮</b> → <b>« Ajouter à l'écran d'accueil »</b> (ou « Installer l'application »).
      L'appli s'ouvre alors comme une vraie application et fonctionne même hors connexion pour ce qui est déjà téléchargé.</p>
    <button id="install" class="btn ${installEvent ? '' : 'hidden'}">Installer l'application</button>
  </section>`;

  const msg = $('#gh-msg');
  const read = () => {
    local.set('ghOwner', $('#gh-owner').value.trim());
    local.set('ghRepo', $('#gh-repo').value.trim() || 'echecs-data');
    local.set('ghToken', $('#gh-token').value.trim());
  };
  $('#gh-save').onclick = async () => {
    read();
    msg.textContent = 'Test de la connexion…';
    const r = await test();
    msg.className = r.ok ? 'ok' : 'err';
    msg.textContent = r.msg;
    if (r.ok) { const ok = await syncNow(); if (ok) toast('Synchronisation terminée.'); }
  };
  $('#gh-sync').onclick = async () => {
    if (!cfg.configured) { msg.className = 'err'; msg.textContent = 'Configurez d\'abord le dépôt et le jeton.'; return; }
    const ok = await syncNow();
    toast(ok ? 'Synchronisation terminée.' : 'Synchronisation impossible : ' + esc(state.error));
  };
  $('#gh-forget').onclick = () => {
    if (!confirm('Supprimer le jeton de cet appareil ? Vos données restent sur l\'appareil et sur GitHub.')) return;
    local.set('ghToken', ''); $('#gh-token').value = ''; msg.className = 'muted'; msg.textContent = 'Jeton supprimé de cet appareil.';
  };
  if (unsub) unsub();
  unsub = onSync((st) => {
    if (!document.body.contains(msg) || msg.dataset.busy) return;
    if (st.running) { msg.className = 'muted'; msg.textContent = 'Synchronisation en cours…'; }
    else if (st.error) { msg.className = 'err'; msg.textContent = st.error; }
    else if (st.lastSync && cfg.configured) { msg.className = 'muted'; msg.textContent = 'Dernière synchronisation : ' + new Date(st.lastSync).toLocaleString('fr-FR'); }
  });

  const showEng = () => { const l = $('#eng-label'); if (l) l.textContent = engineLabel(); };
  if (unsubEng) unsubEng();
  unsubEng = onStatus(showEng); // se met à jour quand la recherche du PC se termine
  $('#boost').onchange = async (e) => { local.set('boost', e.target.checked ? '1' : '0'); await detectBoost(); showEng(); };
  $('#wasm-depth').onchange = (e) => { local.set('wasmDepth', e.target.value); showEng(); };
  $('#boost-retry').onclick = async () => {
    $('#eng-label').textContent = 'Recherche du PC…';
    await detectBoost(); showEng();
    if (!engineStatus.boost) toast('PC non trouvé : lancez « Lancer l\'analyseur.bat » sur le PC (cela ne fonctionne que sur le PC lui-même).', 6000);
  };
  $('#install').onclick = async () => { if (installEvent) { installEvent.prompt(); installEvent = null; $('#install').classList.add('hidden'); } };
}
