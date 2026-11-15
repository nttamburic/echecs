// Paramètres : profil chess.com, connexion GitHub (synchronisation), moteur d'analyse.
import { $, esc, local, toast } from '../core/ui.js';
import { cfg, test, syncNow, state, onSync } from '../core/sync.js';
import { detectBoost, engineLabel, onStatus, status as engineStatus, wasmDepth } from '../core/engine.js';
import { getUser, changeUser } from './analyse.js';

const SECTIONS = [
  ['profile', 'Profil chess.com'],
  ['connection', 'Connexion'],
  ['engine', 'Paramètres moteur'],
];

let unsub = null;
let unsubEng = null;
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

export function render(el, sub) {
  const cur = SECTIONS.some(([k]) => k === sub) ? sub : 'profile';
  el.innerHTML = `
  <h1 class="page-title">Paramètres</h1>
  <div class="settings">
    <nav class="settings-nav">${SECTIONS.map(([k, label]) => `<a href="#/settings/${k}" class="${k === cur ? 'active' : ''}">${label}</a>`).join('')}</nav>
    <div class="settings-body"></div>
  </div>`;
  const body = $('.settings-body', el);
  if (unsub) { unsub(); unsub = null; }
  if (unsubEng) { unsubEng(); unsubEng = null; }
  ({ profile, connection, engine })[cur](body);
}

// ------------------------------------------------------------------ profil
function profile(el) {
  el.innerHTML = `
  <section class="card">
    <h2>Profil chess.com</h2>
    <p class="muted">Votre pseudo chess.com sert à récupérer vos parties dans « Historique des parties ». Il est synchronisé entre vos appareils.</p>
    <div class="row">
      <input id="user" value="${esc(getUser())}" placeholder="Votre pseudo chess.com" autocomplete="off" spellcheck="false" autocapitalize="off">
      <button id="user-save" class="btn primary">Enregistrer</button>
    </div>
    <p id="user-msg" class="muted small"></p>
  </section>`;
  const save = async () => {
    const u = $('#user').value.trim();
    if (!u) { $('#user-msg').className = 'err small'; $('#user-msg').textContent = 'Indiquez un pseudo.'; return; }
    if (u === getUser()) { $('#user-msg').className = 'muted small'; $('#user-msg').textContent = 'Ce pseudo est déjà enregistré.'; return; }
    await changeUser(u);
    $('#user-msg').className = 'ok small';
    $('#user-msg').innerHTML = 'Enregistré. Vos parties sont en cours de récupération : <a href="#/games">voir l\'historique</a>.';
  };
  $('#user-save').onclick = save;
  $('#user').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

// ------------------------------------------------------------------ connexion
function connection(el) {
  el.innerHTML = `
  <section class="card">
    <h2>Connexion au cloud GitHub</h2>
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
        <li>Nom : « Chess Journey ». Expiration : 1 an (ou ce que vous voulez).</li>
        <li><b>Repository access</b> : « Only select repositories » → choisissez <b>echecs-data</b> uniquement.</li>
        <li><b>Permissions</b> → Repository permissions → <b>Contents : Read and write</b>. Rien d'autre.</li>
        <li>« Generate token », copiez-le, collez-le ci-dessus. Faites de même sur le téléphone (ou copiez-le-vous dans un endroit sûr).</li>
      </ol>
    </details>
    <details>
      <summary>Installer l'appli sur le téléphone</summary>
      <p>Sur Android, ouvrez cette page dans Chrome, puis menu <b>⋮</b> → <b>« Ajouter à l'écran d'accueil »</b> (ou « Installer l'application »).</p>
      <button id="install" class="btn ${installEvent ? '' : 'hidden'}">Installer l'application</button>
    </details>
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
  unsub = onSync((st) => {
    if (!document.body.contains(msg)) return;
    if (st.running) { msg.className = 'muted'; msg.textContent = 'Synchronisation en cours…'; }
    else if (st.error) { msg.className = 'err'; msg.textContent = st.error; }
    else if (st.lastSync && cfg.configured) { msg.className = 'muted'; msg.textContent = 'Dernière synchronisation : ' + new Date(st.lastSync).toLocaleString('fr-FR'); }
  });
  $('#install').onclick = async () => { if (installEvent) { installEvent.prompt(); installEvent = null; $('#install').classList.add('hidden'); } };
}

// ------------------------------------------------------------------ moteur
function engine(el) {
  const depth = wasmDepth();
  el.innerHTML = `
  <section class="card">
    <h2>Paramètres moteur</h2>
    <p>Moteur utilisé : <b id="eng-label"></b></p>
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
  </section>`;
  const showEng = () => { const l = $('#eng-label'); if (l) l.textContent = engineLabel(); };
  unsubEng = onStatus(showEng); // se met à jour quand la recherche du PC se termine
  $('#boost').onchange = async (e) => { local.set('boost', e.target.checked ? '1' : '0'); await detectBoost(); showEng(); };
  $('#wasm-depth').onchange = (e) => { local.set('wasmDepth', e.target.value); showEng(); };
  $('#boost-retry').onclick = async () => {
    $('#eng-label').textContent = 'Recherche du PC…';
    await detectBoost(); showEng();
    if (!engineStatus.boost) toast('PC non trouvé : lancez « Lancer l\'analyseur.bat » sur le PC (cela ne fonctionne que sur le PC lui-même).', 6000);
  };
}
