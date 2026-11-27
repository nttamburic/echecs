// Paramètres : profil chess.com, connexion GitHub (synchronisation).
// Onglets : Profil, Connexions, Moteur, Interface, Application. Sur mobile : liste puis détail.
import { $, esc, local, toast } from '../core/ui.js';
import { cfg, test, syncNow, state, onSync } from '../core/sync.js';
import { getUser, changeUser, getProfilLichess, changeLichess } from './analyse.js';
import { PERIODES_LICHESS } from '../core/lichess.js';
import { lichessCfg, setToken, forgetToken } from '../core/lichess.js';
import { fmtAgo } from '../core/format.js';
import { engineFields } from './analyse.js';
import { applyBoardPrefs } from '../board.js';
import { MAIA_MODELS, maiaModel } from '../core/maia.js';
import { erreursReglages, SEUILS_ERREURS } from '../core/manu/erreurs.js';
import { backupTab } from './settings-backup.js';

const SECTIONS = [
  ['profile', 'Profil', 'Pseudos chess.com et Lichess'],
  ['connection', 'Connexions', 'GitHub (synchro) et Lichess'],
  ['engine', 'Moteur d’analyse', 'Stockfish, profondeur, Maia'],
  ['interface', 'Interface', 'Échiquier et coordonnées'],
  ['backup', 'Sauvegarde', 'Télécharger, restaurer, PGN'],
  ['app', 'Application', 'Installation, hors ligne, crédits'],
];
const BOARDS = [['brume', 'Brume', '#F1F3F6', '#AEB9C8'], ['tournoi', 'Vert tournoi', '#ebecd0', '#779556'], ['ardoise', 'Ardoise', '#dee3e6', '#8ca2ad'], ['sable', 'Sable', '#f0d9b5', '#b58863'],
  ['graphite', 'Graphite', '#d4d6d1', '#7d837b'], ['sauge', 'Sauge', '#e6e9dd', '#9aab8f']];
const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

let unsub = null;
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

export function render(el, sub) {
  const detail = SECTIONS.some(([k]) => k === sub); // sur mobile : liste si aucune section choisie
  const cur = detail ? sub : 'profile';
  const label = SECTIONS.find(([k]) => k === cur)[1];
  el.innerHTML = `
  <h1 class="page-title">Paramètres</h1>
  <div class="settings ${detail ? 'is-detail' : 'is-list'}">
    <nav class="settings-nav" aria-label="Sections des paramètres">${SECTIONS.map(([k, l, d]) => `<a href="#/settings/${k}" ${k === cur ? 'class="active" aria-current="page"' : ''}><span><b>${l}</b><span class="sdesc muted small">${d}</span></span>${CHEV}</a>`).join('')}</nav>
    <div class="settings-body">
      <a class="settings-back" href="#/settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg> Paramètres</a>
      <h2 class="settings-h">${label}</h2>
      <div id="settings-pane"></div>
    </div>
  </div>`;
  const nav = $('.settings-nav', el);
  nav.onkeydown = (e) => {
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const links = [...nav.querySelectorAll('a')];
    const i = links.indexOf(document.activeElement);
    if (!d || i < 0) return;
    links[(i + d + links.length) % links.length].focus();
    e.preventDefault();
  };
  const body = $('#settings-pane', el);
  if (unsub) { unsub(); unsub = null; }
  ({ profile, connection, engine, interface: interfaceTab, backup: backupTab, app })[cur](body);
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
  </section>
  <section class="card">
    <h2>Parties Lichess</h2>
    <p class="muted">Facultatif. Avec votre pseudo Lichess, vos parties standard terminées contre des humains rejoignent l'historique,
      la révision et les statistiques. Il peut différer de votre pseudo chess.com. Aucun jeton n'est demandé pour ce réglage.</p>
    <div class="row">
      <input id="li-user" aria-label="Pseudo Lichess" value="${esc(getProfilLichess().pseudo)}" placeholder="${esc(lichessCfg.user || 'Votre pseudo Lichess')}" autocomplete="off" spellcheck="false" autocapitalize="off">
      <select id="li-jours" aria-label="Période à importer">${PERIODES_LICHESS.map((j) => `<option value="${j}"${j === getProfilLichess().jours ? ' selected' : ''}>${j} derniers jours</option>`).join('')}</select>
      <button id="li-save" class="btn primary">Enregistrer</button>
      <button id="li-retirer" class="btn${getProfilLichess().pseudo ? '' : ' hidden'}">Retirer</button>
    </div>
    <p id="li-profil-msg" class="muted small" role="status"></p>
  </section>`;
  const direLi = (cls, html) => { $('#li-profil-msg').className = cls + ' small'; $('#li-profil-msg').innerHTML = html; };
  $('#li-save').onclick = async () => {
    const p = $('#li-user').value.trim();
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(p)) { direLi('err', p ? 'Pseudo Lichess invalide.' : 'Indiquez un pseudo.'); return; }
    await changeLichess(p, Number($('#li-jours').value));
    $('#li-retirer').classList.remove('hidden');
    direLi('ok', 'Enregistré. Le résultat de la récupération s’affiche dans <a href="#/games">l’historique</a>.');
  };
  $('#li-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#li-save').click(); });
  $('#li-retirer').onclick = async () => {
    await changeLichess('', Number($('#li-jours').value));
    $('#li-user').value = '';
    $('#li-retirer').classList.add('hidden');
    direLi('muted', 'Parties Lichess retirées de l’historique et des statistiques. Leurs analyses sont gardées.');
  };
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
  </section>
  <section class="card">
    <h2>Connexion à Lichess</h2>
    <p class="muted">Le module « Ouvertures » affiche les statistiques des bases Masters et Lichess. Lichess demande pour cela
      un jeton personnel. Il reste uniquement sur cet appareil et ne donne accès à rien sur votre compte.</p>
    <div class="form">
      <label>Jeton Lichess <input id="li-token" type="password" value="${esc(lichessCfg.token)}" placeholder="lip_…" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="row">
      <button id="li-save" class="btn primary">Enregistrer et tester</button>
      <button id="li-forget" class="btn">Oublier le jeton</button>
    </div>
    <p id="li-msg" class="muted">${lichessCfg.connected ? 'Jeton enregistré' + (lichessCfg.user ? ' (' + esc(lichessCfg.user) + ')' : '') + '.' : ''}</p>
    <details>
      <summary>Comment créer le jeton (une seule fois)</summary>
      <ol>
        <li>Connecté à Lichess, allez sur <a href="https://lichess.org/account/oauth/token/create" target="_blank" rel="noopener">lichess.org/account/oauth/token/create</a>.</li>
        <li>Description : « Chess Journey ». <b>Ne cochez aucune case</b> : l'explorateur n'en a pas besoin.</li>
        <li>« Créer », copiez le jeton (il commence par <b>lip_</b>), collez-le ci-dessus, puis « Enregistrer et tester ».</li>
      </ol>
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
    toast(ok ? 'Synchronisation terminée.' : (state.offline ? 'Hors ligne : la synchronisation reprendra au retour de la connexion.' : 'Synchronisation impossible : ' + esc(state.error)), { type: ok ? 'ok' : state.offline ? 'info' : 'err' });
  };
  $('#gh-forget').onclick = () => {
    if (!confirm('Supprimer le jeton de cet appareil ? Vos données restent sur l\'appareil et sur GitHub.')) return;
    local.set('ghToken', ''); $('#gh-token').value = ''; msg.className = 'muted'; msg.textContent = 'Jeton supprimé de cet appareil.';
  };
  unsub = onSync((st) => {
    if (!document.body.contains(msg)) return;
    if (st.conflicts && st.conflicts.length) { msg.className = 'err'; msg.innerHTML = 'Conflit : ' + st.conflicts.length + ' répertoire(s) modifié(s) sur deux appareils. <button type="button" class="btn" id="gh-conflict">Résoudre</button>'; $('#gh-conflict').onclick = () => window.dispatchEvent(new Event('cj:conflicts')); }
    else if (st.running) { msg.className = 'muted'; msg.textContent = 'Synchronisation en cours…'; }
    else if (st.error && st.offline) { msg.className = 'err'; msg.textContent = 'Hors ligne : la synchronisation reprendra au retour de la connexion.'; }
    else if (st.error) { msg.className = 'err'; msg.textContent = st.error; }
    else if (st.lastSync && cfg.configured) { msg.className = 'muted'; msg.textContent = 'Dernière synchronisation : ' + fmtAgo(new Date(st.lastSync)); msg.title = new Date(st.lastSync).toLocaleString('fr-FR'); }
  });
  const liMsg = $('#li-msg');
  $('#li-save').onclick = async () => {
    liMsg.className = 'muted'; liMsg.textContent = 'Test du jeton…';
    const r = await setToken($('#li-token').value);
    liMsg.className = r.ok ? 'ok' : 'err'; liMsg.textContent = r.msg;
  };
  $('#li-forget').onclick = () => {
    if (!confirm('Supprimer le jeton Lichess de cet appareil ?')) return;
    forgetToken(); $('#li-token').value = ''; liMsg.className = 'muted'; liMsg.textContent = 'Jeton supprimé de cet appareil.';
  };
}

// ------------------------------------------------------------------ moteur
function engine(el) {
  const seuils = erreursReglages(local.get);
  el.innerHTML = `
  <section class="card">
    <h2>Stockfish</h2>
    <p class="muted">Ces réglages valent pour toutes les analyses : parties, ouvertures, aide et flèches de « Jouer ».
      Profondeur et temps maximum s'appliquent à chaque position : le moteur s'arrête au premier des deux atteint.</p>
    <div id="st-eng"></div>
    <div class="row"><button id="st-eng-save" class="btn primary">Enregistrer</button></div>
    <p id="st-eng-msg" class="muted small" role="status"></p>
  </section>
  <section class="card">
    <h2>Maia (partie contre le bot)</h2>
    <div class="frow"><label for="st-maia">Modèle Maia</label><select id="st-maia"></select></div>
    <p class="muted small">Le modèle 23M imite mieux le jeu humain ; le 5M est plus léger pour un téléphone. Chaque modèle n'est téléchargé qu'une fois.</p>
  </section>
  <section class="card">
    <h2>Erreurs stratégiques</h2>
    <form id="st-strategy" class="form">
      <label>Écart minimal (cp) <input name="seuilCp" type="number" min="1" step="1" required value="${seuils.seuilCp}"></label>
      <label>Fourchette de l’évaluation avant le coup (± cp) <input name="fourchetteCp" type="number" min="1" step="1" required value="${seuils.fourchetteCp}"></label>
      <div class="row"><button class="btn primary" type="submit">Enregistrer</button></div>
      <p id="st-strategy-msg" class="small muted" role="status"></p>
    </form>
  </section>`;
  $('#st-strategy', el).onsubmit = e => {
    e.preventDefault();
    const valeurs = new FormData(e.currentTarget);
    if (!Object.keys(SEUILS_ERREURS).every(k => Number.isSafeInteger(Number(valeurs.get(k))) && Number(valeurs.get(k)) > 0)) return;
    for (const k of Object.keys(SEUILS_ERREURS)) local.set(k, valeurs.get(k));
    $('#st-strategy-msg', el).textContent = 'Seuils enregistrés.';
  };
  const f = engineFields($('#st-eng', el), 'st');
  $('#st-eng-save', el).onclick = async () => {
    await f.save();
    const m = $('#st-eng-msg', el); m.className = 'ok small'; m.textContent = 'Enregistré. Pour une partie déjà analysée, utilisez « Relancer l\'analyse ».';
  };
  const sel = $('#st-maia', el);
  sel.innerHTML = MAIA_MODELS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  sel.value = maiaModel();
  sel.onchange = () => { local.set('maiaModel', sel.value); toast('Modèle Maia enregistré.'); };
}

// ------------------------------------------------------------------ interface
function interfaceTab(el) {
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
  const theme = get('cj-board', 'brume');
  el.innerHTML = `
  <section class="card if-card">
    <div><h2>Interface</h2>
    <p class="muted small">Appliqué immédiatement à tous les écrans et enregistré sur cet appareil.</p></div>
    <span class="lbl-up" id="lbl-boards">Modèle d’échiquier</span>
    <div id="st-boards" class="board-picks" role="radiogroup" aria-labelledby="lbl-boards">${BOARDS.map(([k, l, a, b]) => `
      <button type="button" role="radio" data-b="${k}" aria-checked="${k === theme}" tabindex="${k === theme ? 0 : -1}">
        <span class="mini" aria-hidden="true" style="--a:${a};--b:${b}"></span><span>${l}</span></button>`).join('')}</div>
    <div class="if-opts">
      <div class="if-opt"><span><strong>Pièces</strong><span class="muted small">cburnett (Colin M.L. Burnett), licence CC BY-SA 3.0</span></span></div>
      <label class="if-opt"><span><strong>Coordonnées sur l’échiquier</strong><span class="muted small">Lettres et chiffres dans les cases du bord</span></span>
        <input type="checkbox" role="switch" class="sw" id="st-coords" ${get('cj-coords', '1') !== '0' ? 'checked' : ''}></label>
    </div>
  </section>`;
  const box = $('#st-boards', el);
  const choose = (k) => {
    put('cj-board', k); applyBoardPrefs();
    box.querySelectorAll('button').forEach((b) => { const on = b.dataset.b === k; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  };
  box.onclick = (e) => { const b = e.target.closest('button[data-b]'); if (b) choose(b.dataset.b); };
  box.onkeydown = (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const bs = [...box.querySelectorAll('button')];
    const i = bs.indexOf(document.activeElement);
    if (!d || i < 0) return;
    const n = bs[(i + d + bs.length) % bs.length];
    choose(n.dataset.b); n.focus(); e.preventDefault();
  };
  $('#st-coords', el).onchange = (e) => { put('cj-coords', e.target.checked ? '1' : '0'); applyBoardPrefs(); };
}

// ------------------------------------------------------------------ application
function app(el) {
  el.innerHTML = `
  <section class="card">
    <h2>Installer l'application</h2>
    <p>Sur Android, ouvrez cette page dans Chrome, puis menu <b>⋮</b> → <b>« Ajouter à l'écran d'accueil »</b> (ou « Installer l'application »).</p>
    <button id="install" class="btn ${installEvent ? '' : 'hidden'}">Installer l'application</button>
  </section>
  <section class="card">
    <h2>Hors ligne</h2>
    <p class="muted">L'application fonctionne sans réseau pour vos parties déjà chargées et vos répertoires. Les récupérations chess.com, les statistiques Lichess et la synchronisation GitHub demandent une connexion.</p>
  </section>
  <section class="card">
    <h2>Crédits</h2>
    <p class="muted">Moteur : Stockfish. Bot : Maia. Pièces : cburnett (CC BY-SA 3.0). Polices : Instrument Sans, Instrument Serif, Fragment Mono (SIL OFL 1.1). Statistiques d'ouvertures : Lichess.</p>
  </section>`;
  const b = $('#install', el);
  b.onclick = async () => { if (installEvent) { installEvent.prompt(); installEvent = null; b.classList.add('hidden'); } };
}
