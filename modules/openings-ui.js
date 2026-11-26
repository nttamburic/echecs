// Module « Ouvertures » — interface : liste des répertoires, création, éditeur sur l'échiquier
// (coups des deux camps, variantes, désactivation et suppression au clic droit ou à l'appui long) et explorateur
// Lichess (Masters / Lichess, filtres d'Elo et de cadence sous la roue dentée).
import { Board } from '../board.js';
import { $, esc, local, toast, keyActivate } from '../core/ui.js';
import { epd } from '../analysis.js';
import { figSan, BOOK, getGames, getUser, engineFields } from './analyse.js';
import * as store from '../core/store.js';
import { frSan, explainOpeningMove } from '../explain.js';
import { lichessCfg, explore, expRatings, expSpeeds, lichessGames, studyPgn } from '../core/lichess.js';
import { analyzePosition, analysisSettings, maxTime, nLines, SOURCE_LABEL, onStatus } from '../core/engine.js';
import {
  newRepertoire, addMove, childrenOf, reachableEdges, deleteMove, fenOf,
  listRepertoires, getRepertoire, saveRepertoire, deleteRepertoire,
  listEvents, computeMastery, masterySummary, scanGames, STATUS, EVT, REP, WINDOW_DAYS, MIN_SITUATIONS, THRESHOLD,
  computeCards, cardsSummary, NEW_PER_DAY,
  findSuggestions, applySuggestion, pathTo, SUGGEST_MIN, importPgn, computePerformance, openingResults,
} from './openings.js';
import { Chess } from '../vendor/chess.js';
import { coverageOf, cachedCoverage, covN, THRESHOLDS, pct, coverageKey } from './openings-coverage.js';
import { classifyGame, CLASSES, fmtScore, winPct } from '../analysis.js';
import { stashPlay } from './play.js';
import { miniBoard } from './setup.js';
import { frOpening } from './opening-names.js';
import { fillGap, fillStyle, setFillStyle, CRITERIA, STYLE_POINTS, autoEdges, repertoireScores } from './openings-autofill.js';

const SVG_GEAR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const RATINGS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
const covPct = (n) => `${(100 / n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const SPEEDS = [['ultraBullet', 'UltraBullet'], ['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapide'], ['classical', 'Classique'], ['correspondence', 'Correspondance']];
const LONG_PRESS = 2000;

// État de l'éditeur : path = ligne suivie (arêtes depuis la racine), k = nombre de coups affichés.
const E = { rep: null, path: [], k: 0, board: null, db: local.get('expDb', 'masters'), nodes: [], expSeq: 0, events: [], reps: [], mastery: new Map(), eng: null, engPending: null, engTimer: null };
const repOn = (k) => local.get(k, '0') === '1'; // réglages « Interface » : flèche du meilleur coup, barre d'évaluation

// Maîtrise : recalculée à partir des événements (parties réelles et entraînement) des 90 derniers jours.
async function loadMastery() {
  [E.events, E.reps] = await Promise.all([listEvents(), listRepertoires()]);
}
function refreshMastery() {
  if (!E.rep) return;
  const reps = E.reps.map((r) => (r.id === E.rep.id ? E.rep : r));
  if (!reps.some((r) => r.id === E.rep.id)) reps.push(E.rep);
  E.mastery = computeMastery(E.rep, E.events, reps);
}
// Parties Lichess (compte lié au jeton) : chargées une fois par séance, puis parcourues comme
// les parties chess.com (maîtrise) et comptées dans la performance.
const LI = { games: [], promise: null, err: null, loaded: false };
function loadLichess() {
  if (!lichessCfg.user) return Promise.resolve([]);
  if (LI.promise) return LI.promise;
  LI.promise = lichessGames(lichessCfg.user, { days: WINDOW_DAYS })
    .then(async (g) => {
      const changed = g.length !== LI.games.length;
      LI.games = g; LI.err = null; LI.loaded = true;
      await scanGames(g, lichessCfg.user);
      if (changed) refreshAfterLichess();
      return g;
    })
    .catch((e) => { LI.err = e.message; LI.loaded = true; return LI.games; })
    .finally(() => setTimeout(() => { LI.promise = null; }, 10 * 60000)); // nouvelle demande possible après 10 min
  return LI.promise;
}
function refreshAfterLichess() {
  if (document.body.dataset.view === 'openings') renderHome($('#openings-view'));
  else if (E.rep && document.body.dataset.view === 'rep') render();
}
const perfSets = () => [{ games: getGames(), user: getUser() }, { games: LI.games, user: lichessCfg.user }];
const perfMemo = new Map(); // id du répertoire → { key, map }
function perfOf(rep) {
  const key = `${rep.edges.length}|${rep.edges.map((e) => e.uci).join()}|${getGames().length}|${LI.games.length}`;
  const m = perfMemo.get(rep.id);
  if (m && m.key === key) return m.map;
  const map = computePerformance(rep, perfSets());
  perfMemo.set(rep.id, { key, map });
  return map;
}
const perfShort = (st) => `${plural(st.n, 'partie')} · ${pct(st.score)}`;
function perfLine(st) {
  if (!getUser() && !lichessCfg.user) return '';
  if (!st) return `Ici dans vos parties : aucune (${WINDOW_DAYS} derniers jours)`;
  return `<span title="Parties des ${WINDOW_DAYS} derniers jours passées par cette position · score ${pct(st.score)}">Ici dans vos parties : <span class="pf-w">+${st.w}</span> <span class="pf-d">=${st.d}</span> <span class="pf-l">−${st.l}</span> · ${plural(st.n, 'partie')}</span>`;
}
function lichessStatus() {
  if (!lichessCfg.connected) return 'Connectez Lichess (Paramètres → Connexion) pour compter aussi vos parties Lichess.';
  if (!lichessCfg.user) return '';
  if (LI.err) return `Parties Lichess (${esc(lichessCfg.user)}) : ${esc(LI.err)}.`;
  if (!LI.loaded) return `Parties Lichess (${esc(lichessCfg.user)}) : chargement…`;
  return `Parties Lichess (${esc(lichessCfg.user)}) : ${plural(LI.games.length, 'partie')} sur ${WINDOW_DAYS} jours, comptées avec celles de chess.com.`;
}

// Après une modification du répertoire, les parties récentes sont reparcourues (une position
// ajoutée peut avoir déjà été jouée), puis la maîtrise est recalculée.
let rescanTimer = null;
function rescanSoon() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(async () => {
    const n = (await scanGames(getGames(), getUser())) + (LI.games.length ? await scanGames(LI.games, lichessCfg.user) : 0);
    if (!E.rep) return;
    await loadMastery();
    if (n) render();
  }, 1500);
}
// Événements ajoutés (parcours des parties) ou données arrivées d'un autre appareil : on rafraîchit.
let reloadTimer = null;
let homeTimer = null;
let topTimer = null;
store.onChange((info) => {
  // Analyse enregistrée ou effacée, ou pseudo reçu d'un autre appareil : seul le bloc des résultats est refait.
  if ((info.col === 'analysisIndex' || (info.col === 'settings' && info.remote)) && document.body.dataset.view === 'openings') {
    clearTimeout(topTimer);
    topTimer = setTimeout(() => { const box = $('#top-openings'); if (box && document.body.dataset.view === 'openings') renderTopOpenings(box); }, 400);
  }
  if ((info.col === EVT || info.col === REP) && document.body.dataset.view === 'openings') {
    clearTimeout(homeTimer);
    homeTimer = setTimeout(() => { if (document.body.dataset.view === 'openings') renderHome($('#openings-view')); }, 400);
  }
  if (!E.rep ||(info.col !== EVT && !(info.col === REP && info.remote))) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (!E.rep) return;
    await loadMastery();
    if (info.col === REP) { const r = await getRepertoire(E.rep.id); if (r) E.rep = r; }
    render();
  }, 400);
});

const colorFr = (c) => (c === 'w' ? 'Blancs' : 'Noirs');
const plural = (n, s) => `${n} ${s}${n > 1 ? 's' : ''}`;

// ------------------------------------------------------------------ liste des répertoires
export async function renderHome(el) {
  const [reps, events] = await Promise.all([listRepertoires(), listEvents()]);
  let nEdges = 0, nDue = 0;
  for (const r of reps) { nEdges += reachableEdges(r).length; nDue += cardsSummary(computeCards(r, events, reps)).due; }
  const TRASH = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/></svg>';
  el.innerHTML = `
  <header class="op-head">
    <div><h1 class="page-title">Ouvertures</h1>
      <p class="op-sub muted">${plural(reps.length, 'répertoire')} · ${plural(nEdges, 'coup')}${nDue ? ` · <strong class="due">${plural(nDue, 'coup')} à revoir aujourd’hui</strong>` : ''}</p></div>
    <div class="row"><button id="rep-import" class="btn">Importer un PGN</button><button id="rep-new" class="btn primary">+ Nouveau répertoire</button></div>
  </header>
  ${reps.length ? trainBox(reps, events) : ''}
  ${reps.length ? '<h2 class="op-h2">Mes répertoires</h2>' : ''}
  <div class="rep-list">${reps.length ? reps.map((r) => `
    <div class="card rep-card">
      <a class="rep-open" href="#/openings/${esc(r.id)}">
        <span class="avatar-sm ${r.color}"><img src="pieces/${r.color}K.svg" alt=""></span>
        <span class="rep-info"><b title="${esc(r.name)}">${esc(r.name)}</b><span class="muted small">${colorFr(r.color)} · ${plural(reachableEdges(r).length, 'coup')}${dueLabel(r, events, reps)}${homePerf(r)}<span class="cov-mini" data-cov="${esc(r.id)}"></span></span>
          ${masteryBar(masterySummary(computeMastery(r, events, reps)))}</span>
      </a>
      <button class="rep-del" data-del="${esc(r.id)}" title="Supprimer ce répertoire" aria-label="Supprimer le répertoire ${esc(r.name)}">${TRASH}</button>
    </div>`).join('') : '<p class="muted">Aucun répertoire pour le moment. Créez-en un, puis jouez vos coups sur l\'échiquier.</p>'}</div>
  ${reps.length && lichessStatus() ? `<p class="muted small li-status">${lichessStatus()}</p>` : ''}
  <section class="card top-op" id="top-openings" aria-labelledby="top-op-title">${topHead}<p class="muted small">Calcul à partir de vos parties analysées…</p></section>
  ${reps.length ? '<section class="card sugg-box" id="sugg-box"><h2>Suggestions</h2><p class="muted small">Recherche des erreurs répétées dans vos parties analysées…</p></section>' : ''}
  <dialog id="rep-dlg" class="dlg"><form method="dialog">
    <h2>Nouveau répertoire</h2>
    <div class="form"><label>Nom <input id="rep-name" placeholder="ex. Italienne avec les Blancs" autocomplete="off"></label></div>
    <p class="muted small">Je joue avec</p>
    <div class="side-pick two">
      <button type="button" data-c="w" class="on"><img src="pieces/wK.svg" alt="">Blancs</button>
      <button type="button" data-c="b"><img src="pieces/bK.svg" alt="">Noirs</button>
    </div>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button value="ok" class="btn primary">Créer</button></div>
  </form></dialog>
  <dialog id="pgn-dlg" class="dlg"><form method="dialog">
    <h2>Importer un PGN</h2>
    <p class="muted small">Toutes les variantes et sous-variantes sont importées. Plusieurs parties dans le même fichier sont réunies.</p>
    <div class="form">
      <div class="segctl pgn-tabs" role="tablist" aria-label="Source du PGN">
        <button type="button" class="chip" role="tab" id="pgn-t-file" data-src="file" aria-selected="true" aria-controls="pgn-p-file">Fichier</button>
        <button type="button" class="chip" role="tab" id="pgn-t-study" data-src="study" aria-selected="false" tabindex="-1" aria-controls="pgn-p-study">Lichess</button>
        <button type="button" class="chip" role="tab" id="pgn-t-text" data-src="text" aria-selected="false" tabindex="-1" aria-controls="pgn-p-text">Texte</button>
      </div>
      <div id="pgn-p-file" role="tabpanel" aria-labelledby="pgn-t-file"><label>Fichier PGN <input id="pgn-file" type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain"></label></div>
      <div id="pgn-p-study" role="tabpanel" aria-labelledby="pgn-t-study" class="hidden"><label for="pgn-study">Lien de l'étude Lichess</label>
        <div class="inline"><input id="pgn-study" placeholder="https://lichess.org/study/…" autocomplete="off" spellcheck="false"><button type="button" id="pgn-paste" class="btn">Coller</button></div></div>
      <div id="pgn-p-text" role="tabpanel" aria-labelledby="pgn-t-text" class="hidden"><label>Texte du PGN <textarea id="pgn-text" rows="6" spellcheck="false" placeholder="1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 3. Bb5 *"></textarea></label></div>
      <p id="pgn-status" class="pgn-status hidden" role="status"></p>
      <fieldset class="pgn-dest" id="pgn-dest"><legend class="lbl-up">Destination</legend>
        ${reps.map((r) => `<label class="dest"><input type="radio" name="pgn-dest" value="${esc(r.id)}"><span><strong>${esc(r.name)}</strong><span class="muted" data-sub="${esc(r.id)}">Fusionner · ${colorFr(r.color)}</span></span></label>`).join('')}
        <label class="dest"><input type="radio" name="pgn-dest" value="" checked><span><strong>Nouveau répertoire</strong><span class="muted" data-sub="">Nom et couleur à choisir</span></span></label>
      </fieldset>
    </div>
    <div id="pgn-new">
      <div class="form"><label>Nom <input id="pgn-name" placeholder="ex. Répertoire importé" autocomplete="off"></label></div>
      <p class="muted small">Je joue avec</p>
      <div class="side-pick two">
        <button type="button" data-c="w" class="on"><img src="pieces/wK.svg" alt="">Blancs</button>
        <button type="button" data-c="b"><img src="pieces/bK.svg" alt="">Noirs</button>
      </div>
    </div>
    <p id="pgn-err" class="err small"></p>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button id="pgn-go" value="ok" class="btn primary">Importer</button></div>
  </form></dialog>`;
  bindImport(el, reps);
  renderTopOpenings($('#top-openings', el));
  if (reps.length && !LI.loaded) loadLichess();
  if (reps.length) renderSuggestions($('#sugg-box', el), reps);
  homeCoverage(el, reps);
  const pickRep = $('#train-pick', el);
  if (pickRep) $('#train-rep', el).onclick = () => { location.hash = '#/openings/train/rep/' + encodeURIComponent(pickRep.value); };
  const styleSel = $('#train-style', el);
  if (styleSel) styleSel.onchange = () => local.set('trainStyle', styleSel.value);
  const dlg = $('#rep-dlg', el);
  let color = 'w';
  dlg.querySelectorAll('.side-pick button').forEach((b) => {
    b.onclick = () => { color = b.dataset.c; dlg.querySelectorAll('.side-pick button').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  el.querySelectorAll('dialog').forEach(enterIsPrimary);
  $('#rep-new', el).onclick = () => { $('#rep-name', el).value = ''; dlg.showModal(); $('#rep-name', el).focus(); };
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const name = $('#rep-name', el).value.trim();
    const rep = newRepertoire({ name: name || `Répertoire ${colorFr(color)}`, color });
    await saveRepertoire(rep);
    location.hash = '#/openings/' + rep.id;
  });
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = reps.find((x) => x.id === b.dataset.del);
      if (!r || !confirm(`Supprimer le répertoire « ${r.name} » et tous ses coups ?`)) return;
      await deleteRepertoire(r.id);
      renderHome(el);
    };
  });
}

// Entrée dans un champ d'une fenêtre = bouton principal (sinon le formulaire prendrait le premier
// bouton, « Annuler »).
function enterIsPrimary(dlg) {
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const b = dlg.querySelector('.btn.primary');
    if (b) b.click();
  });
}

// ------------------------------------------------------------------ import PGN
function bindImport(el, reps) {
  const dlg = $('#pgn-dlg', el);
  let color = 'w';
  const picks = dlg.querySelectorAll('.side-pick button');
  picks.forEach((b) => { b.onclick = () => { color = b.dataset.c; picks.forEach((x) => x.classList.toggle('on', x === b)); }; });
  const radios = [...dlg.querySelectorAll('input[name=pgn-dest]')];
  const targetId = () => (radios.find((r) => r.checked) || { value: '' }).value;
  let touched = false;
  radios.forEach((r) => { r.onchange = () => { $('#pgn-new', el).classList.toggle('hidden', !!targetId()); renderPv(); }; r.onclick = () => { touched = true; }; });
  let src = 'file';
  // Source lue (fichier, étude téléchargée ou texte) + aperçu : chapitres, coups, coups nouveaux par destination.
  let cache = null, pv = null, seq = 0, timer = 0;
  async function getSource() {
    if (src === 'text') return { text: $('#pgn-text', el).value };
    if (src === 'file') {
      const f = $('#pgn-file', el).files[0];
      if (!f) return { text: '', empty: 'Choisissez un fichier PGN.' };
      if (f.size > 5 * 1048576) throw new Error('Fichier trop gros (5 Mo au maximum)');
      if (cache && cache.key === f) return cache;
      return (cache = { key: f, text: await f.text(), fileName: f.name });
    }
    const link = $('#pgn-study', el).value.trim();
    if (!link) return { text: '', empty: 'Collez le lien d’une étude Lichess.' };
    if (cache && cache.key === link) return cache;
    const text = await studyPgn(link);
    const sn = /\[StudyName "([^"]*)"\]/.exec(text);
    return (cache = { key: link, text, studyName: sn ? sn[1] : '' });
  }
  const status = $('#pgn-status', el), goBtn = $('#pgn-go', el);
  const destAdded = () => { if (!pv) return null; const id = targetId(); return id ? (pv.adds[id] ?? 0) : pv.total; };
  function renderPv() {
    const err = $('#pgn-err', el);
    status.classList.toggle('hidden', !pv);
    if (pv) status.innerHTML = `<span class="ok" aria-hidden="true">✓</span><span>${pv.name ? `« ${esc(pv.name)} » · ` : ''}${plural(pv.games, 'chapitre')} · ${plural(pv.total, 'coup')}${pv.errors.length
      ? `<br><span class="err">Attention : ${pv.errors.length > 1 ? 'lignes interrompues aux coups illisibles' : 'ligne interrompue au coup illisible'} ${pv.errors.map(esc).join(', ')}. La suite ${pv.errors.length > 1 ? 'de ces lignes' : 'de cette ligne'} ne sera pas importée.</span>` : ''}</span>`;
    dlg.querySelectorAll('[data-sub]').forEach((sp) => {
      const id = sp.dataset.sub;
      if (!id) { sp.textContent = 'Nom et couleur à choisir'; return; }
      const r = reps.find((x) => x.id === id), n = pv ? pv.adds[id] : null;
      sp.textContent = `Fusionner · ${n == null ? colorFr(r.color) : n ? `+${plural(n, 'coup')} nouveau${n > 1 ? 'x' : ''}` : 'aucun coup nouveau'}`;
    });
    dlg.querySelectorAll('.dest').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    const n = destAdded();
    goBtn.textContent = n == null ? 'Importer' : n ? `Importer ${plural(n, 'coup')}` : 'Aucun coup à importer';
    goBtn.disabled = n === 0;
    if (err.dataset.kind === 'pv' && pv) err.textContent = '';
  }
  async function refreshPv() {
    const my = ++seq, err = $('#pgn-err', el);
    pv = null; err.textContent = ''; err.dataset.kind = ''; renderPv();
    let r;
    try {
      if (src === 'study' && $('#pgn-study', el).value.trim() && !(cache && cache.key === $('#pgn-study', el).value.trim())) { err.textContent = 'Téléchargement de l’étude…'; err.dataset.kind = 'pv'; }
      r = await getSource();
    } catch (x) { if (my === seq) { err.textContent = x.message + '.'; err.dataset.kind = 'pv'; } return; }
    if (my !== seq) return;
    err.textContent = ''; err.dataset.kind = '';
    if (!r.text.trim()) { if (!r.empty && src !== 'text') { err.textContent = src === 'file' ? 'Ce fichier est vide.' : 'Cette étude ne contient aucun coup.'; err.dataset.kind = 'pv'; } return; }
    const fresh = importPgn(newRepertoire({ name: 'x', color: 'w' }), r.text);
    if (!fresh.added) { err.textContent = fresh.errors.length ? `Aucun coup d'échecs reconnu (premier coup refusé : « ${fresh.errors[0]} »).` : 'Aucun coup trouvé dans ce PGN.'; err.dataset.kind = 'pv'; return; }
    const adds = {};
    for (const rep of reps) adds[rep.id] = importPgn(structuredClone(rep), r.text).added;
    pv = { name: r.studyName || (r.fileName || '').replace(/\.[^.]+$/, ''), games: fresh.games, total: fresh.added, adds, errors: fresh.errors };
    if (!touched) { // propose le répertoire qui recoupe le plus l'import
      let best = '', ov = 0;
      for (const rep of reps) { const o = fresh.added - adds[rep.id]; if (o > ov) { ov = o; best = rep.id; } }
      radios.forEach((x) => { x.checked = x.value === best; });
      $('#pgn-new', el).classList.toggle('hidden', !!best);
    }
    renderPv();
  }
  const schedulePv = (ms = 0) => { clearTimeout(timer); timer = setTimeout(refreshPv, ms); };
  $('#pgn-file', el).onchange = () => schedulePv();
  $('#pgn-text', el).oninput = () => schedulePv(400);;
  $('#pgn-study', el).onchange = () => schedulePv();
  const tabs = dlg.querySelectorAll('.pgn-tabs [role=tab]');
  const setSrc = (k) => {
    src = k; $('#pgn-err', el).textContent = '';
    tabs.forEach((b) => { const on = b.dataset.src === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; $('#' + b.getAttribute('aria-controls'), el).classList.toggle('hidden', !on); });
    schedulePv();
  };
  tabs.forEach((b) => { b.onclick = () => setSrc(b.dataset.src); });
  dlg.querySelector('.pgn-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const arr = [...tabs], i = arr.findIndex((b) => b.dataset.src === src);
    const n = arr[(i + (e.key === 'ArrowRight' ? 1 : arr.length - 1)) % arr.length];
    setSrc(n.dataset.src); n.focus(); e.preventDefault();
  });
  $('#pgn-paste', el).onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { $('#pgn-study', el).value = t.trim(); schedulePv(); } }
    catch { $('#pgn-err', el).textContent = 'Le presse-papiers n’est pas accessible : collez le lien dans le champ.'; }
  };
  $('#rep-import', el).onclick = () => {
    setSrc('file');
    $('#pgn-file', el).value = ''; $('#pgn-text', el).value = ''; $('#pgn-study', el).value = ''; $('#pgn-err', el).textContent = '';
    cache = null; pv = null; touched = false; radios.forEach((x) => { x.checked = !x.value; }); $('#pgn-new', el).classList.remove('hidden'); renderPv();
    dlg.showModal();
  };
  $('#pgn-go', el).onclick = async (e) => {
    e.preventDefault();
    const err = $('#pgn-err', el);
    err.dataset.kind = '';
    let text = '', studyName = '', fileName = '', r0empty = false;
    goBtn.disabled = true;
    try {
      const r = await getSource();
      if (r.empty) { err.textContent = r.empty; return; }
      ({ text, studyName = '', fileName = '' } = r); r0empty = !!fileName;
    } catch (x) { err.textContent = x.message + '.'; return; } finally { renderPv(); }
    if (!text.trim()) { err.textContent = src === 'file' ? (r0empty ? 'Ce fichier est vide.' : 'Choisissez un fichier PGN.') : src === 'study' ? 'Collez le lien d’une étude Lichess.' : 'Collez le texte du PGN.'; return; }
    let rep = targetId() ? await getRepertoire(targetId()) : null;
    const isNew = !rep;
    if (isNew) rep = newRepertoire({ name: $('#pgn-name', el).value.trim() || (fileName ? fileName.replace(/\.[^.]+$/, '') : studyName || `Répertoire ${colorFr(color)}`), color });
    const r = importPgn(rep, text);
    if (!r.added && isNew) {
      err.textContent = r.errors.length ? `Aucun coup d'échecs reconnu dans ce texte (premier coup refusé : « ${r.errors[0]} »).` : 'Aucun coup trouvé dans ce PGN.';
      return;
    }
    await saveRepertoire(rep);
    dlg.close();
    const extra = [];
    if (r.skipped) extra.push(`${plural(r.skipped, 'partie')} ignorée${r.skipped > 1 ? 's' : ''} (autre position de départ)`);
    if (r.notes) extra.push(`${plural(r.notes, 'commentaire')} gardé${r.notes > 1 ? 's' : ''} comme note${r.notes > 1 ? 's' : ''}`);
    if (r.errors.length) extra.push(`ligne${r.errors.length > 1 ? 's' : ''} interrompue${r.errors.length > 1 ? 's' : ''} au coup illisible ${r.errors.map(esc).join(', ')}`);
    toast(`${plural(r.added, 'coup')} importé${r.added > 1 ? 's' : ''} depuis ${plural(r.games, 'partie')}.${extra.length ? ' ' + extra.join(' ; ').replace(/^./, (c) => c.toUpperCase()) + '.' : ''}`, 6000);
    rescanSoon();
    location.hash = '#/openings/' + encodeURIComponent(rep.id);
  };
}

// ------------------------------------------------------------------ résultats des ouvertures les plus jouées
const TOP_N = 5;
const topHead = '<h2 class="op-h2" id="top-op-title">Vos ouvertures les plus jouées</h2>';

// Le résultat est lu dans la partie enregistrée avec l'analyse (les parties chess.com n'ont pas besoin
// d'être chargées), l'ouverture dans l'index, que les anciennes analyses reçoivent après coup.
async function renderTopOpenings(box) {
  const show = (html) => { if (box.isConnected) box.innerHTML = topHead + html; };
  const user = getUser();
  if (!user) {
    show('<p class="muted small">Indiquez votre pseudo chess.com (<a href="#/settings/profile">Paramètres → Profil</a>) pour savoir de quel côté vous jouiez et calculer vos résultats.</p>');
    return;
  }
  let entries;
  try {
    const [analyses, index] = await Promise.all([store.all('analysis'), store.all('analysisIndex')]);
    const summaries = new Map(index.map((r) => [r.id, r.data]));
    entries = analyses.filter((r) => r.data).map((r) => {
      const s = summaries.get(r.id) || r.data.summary;
      return { game: r.data.game, opening: s && s.opening };
    });
  } catch {
    show('<p class="err small">Impossible de lire vos parties analysées.</p>');
    return;
  }
  const res = openingResults(entries, user, TOP_N);
  if (!res.total) {
    show(entries.length
      ? `<p class="muted small">Aucune des parties analysées n'a été jouée avec le pseudo <b>${esc(user)}</b>. Vérifiez-le dans <a href="#/settings/profile">Paramètres → Profil</a>.</p>`
      : '<p class="muted small">Aucune partie analysée pour le moment. Analysez des parties depuis l\'<a href="#/games">Historique des parties</a> (une par une ou avec « Analyse multiple »).</p>');
    return;
  }
  const notes = [];
  if (res.rows.length && res.count < TOP_N) notes.push(`Seulement ${plural(res.count, 'ouverture')} pour le moment : analysez d'autres parties pour en voir jusqu'à ${TOP_N}.`);
  if (res.unnamed) notes.push(res.unnamed > 1 ? `${res.unnamed} parties sans ouverture reconnue ne sont pas classées.` : '1 partie sans ouverture reconnue n\'est pas classée.');
  show(`<p class="muted small">Vos résultats sur ${plural(res.total, 'partie')} analysée${res.total > 1 ? 's' : ''}, toutes périodes confondues (analyses complètes ou non). Les variantes sont réunies par famille ; les Blancs et les Noirs sont comptés à part.</p>
    ${res.rows.length ? `<ol class="top-list">${res.rows.map(topRow).join('')}</ol>` : '<p class="muted">Aucune ouverture reconnue dans ces parties.</p>'}
    ${notes.map((n) => `<p class="muted small">${n}</p>`).join('')}`);
}

function topRow(r) {
  const name = frOpening(r.family);
  const parts = [['w', r.pw, r.w, 'Victoires'], ['d', r.pd, r.d, 'Nulles'], ['l', r.pl, r.l, 'Défaites']];
  return `<li class="top-row">
    <div class="top-name"><span class="avatar-sm ${r.color}"><img src="pieces/${r.color}K.svg" alt=""></span>
      <span><b>${esc(name)}</b><span class="muted small">Avec les ${colorFr(r.color)} · ${plural(r.n, 'partie')}</span></span></div>
    <div class="top-res">
      <div class="top-bar" aria-hidden="true">${parts.map(([k, p, n]) => (n ? `<i class="tb-${k}" style="flex-grow:${n}"></i>` : '')).join('')}</div>
      <dl class="top-pct">${parts.map(([k, p, n, label]) => `<div class="tp-${k}" title="${label} : ${n} sur ${r.n}"><dt>${label}</dt><dd>${p} %</dd></div>`).join('')}</dl>
    </div>
  </li>`;
}

// ------------------------------------------------------------------ suggestions d'enrichissement
// Parties analysées → coups, classes (Imprécision, Erreur…) des 40 premiers demi-coups. Mis en cache.
const classified = new Map();
async function analysedGames() {
  const user = (getUser() || '').toLowerCase();
  const out = [];
  for (const r of await store.all('analysis')) {
    const a = r.data;
    if (!a || !a.game || !a.positions || !a.game.pgn) continue;
    const color = (a.game.white && a.game.white.name || '').toLowerCase() === user ? 'w' : (a.game.black && a.game.black.name || '').toLowerCase() === user ? 'b' : null;
    if (!color) continue;
    const key = `${r.id}|${r.updatedAt}`;
    if (!classified.has(key)) {
      let g = null;
      try {
        const c = new Chess();
        c.loadPgn(a.game.pgn);
        const mv = c.history({ verbose: true }).slice(0, 41);
        const res = classifyGame(mv, a.positions.slice(0, mv.length), { w: a.game.white.rating, b: a.game.black.rating }, BOOK);
        g = { id: r.id, end: (a.game.end || 0) * 1000, color, moves: mv.map((m) => ({ before: m.before, uci: m.from + m.to + (m.promotion || ''), san: m.san })), results: res.map((x) => (x ? { cls: x.cls, bestUci: x.bestUci } : null)) };
      } catch { g = null; }
      classified.set(key, g);
    }
    const g = classified.get(key);
    if (g) out.push(g);
  }
  return out;
}

const sanLine = (sans) => sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + frSan(s)).join(' ');
function uciToSan(fen, uci) {
  try { const c = new Chess(fenOf(fen)); return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; }
}

async function renderSuggestions(box, reps) {
  if (!getUser()) {
    box.innerHTML = '<h2>Suggestions</h2><p class="muted small">Indiquez votre pseudo chess.com (Paramètres → Profil) : les suggestions viennent des erreurs répétées dans vos parties analysées.</p>';
    return;
  }
  const games = await analysedGames();
  if (!document.body.contains(box)) return;
  const list = findSuggestions(reps, games);
  const loaded = getGames().length;
  const done = new Set(games.map((g) => g.id));
  const missing = getGames().filter((g) => !done.has(g.id)).length;
  const note = loaded
    ? (missing ? `<p class="muted small">${plural(missing, 'partie')} sur ${loaded} ${missing > 1 ? 'ne sont pas analysées' : 'n\'est pas analysée'} : leurs erreurs n'apparaissent pas ici. Lancez « Analyse multiple » dans l'<a href="#/games">Historique des parties</a>.</p>` : '')
    : '<p class="muted small">Vos parties chess.com ne sont pas encore chargées (Historique des parties).</p>';
  const cnt = (errs) => {
    const by = {};
    for (const e of errs) by[e.cls] = (by[e.cls] || 0) + 1;
    const FR = { inaccuracy: ['imprécision', 'imprécisions'], mistake: ['erreur', 'erreurs'], miss: ['occasion manquée', 'occasions manquées'], blunder: ['gaffe', 'gaffes'] };
    return Object.entries(by).map(([k, n]) => `<span class="badge-txt" style="color:${CLASSES[k].color}">${n} ${FR[k][n > 1 ? 1 : 0]}</span>`).join(' · ');
  };
  box.innerHTML = `<h2>Suggestions</h2>
    <p class="muted small">Positions juste après la sortie de votre répertoire où vous avez fait la même faute au moins ${SUGGEST_MIN} fois (imprécision, erreur, occasion manquée ou gaffe).</p>
    ${list.length ? list.map((s, i) => {
      const played = [...new Set(s.errors.map((e) => frSan(e.san)))].join(', ');
      const best = s.errors.map((e) => e.bestUci).find(Boolean);
      return `<div class="sugg">
        <div class="sugg-main"><b>${esc(s.rep.name)}</b> · après <span class="sugg-line">${esc(sanLine(s.line))}</span>
          <div class="small">${plural(s.errors.length, 'faute')} : ${cnt(s.errors)}. Vous avez joué ${esc(played)}${best ? ` ; meilleur coup selon l'analyse : <b>${esc(frSan(uciToSan(s.epd, best)))}</b>` : ''}.</div></div>
        <button class="btn small primary" data-sugg="${i}">Ajouter au répertoire</button></div>`;
    }).join('') : '<p class="muted">Aucune erreur répétée hors répertoire pour le moment.</p>'}
    ${note}`;
  box.querySelectorAll('[data-sugg]').forEach((b) => {
    b.onclick = async () => {
      const s = list[+b.dataset.sugg];
      const rep = await getRepertoire(s.rep.id);
      if (!rep || !applySuggestion(rep, s)) { toast('Impossible d\'ajouter cette position au répertoire.'); return; }
      await saveRepertoire(rep);
      E.focus = { repId: rep.id, epd: s.epd, best: s.errors.map((e) => e.bestUci).find(Boolean) || null, errors: s.errors };
      location.hash = '#/openings/' + encodeURIComponent(rep.id);
    };
  });
}

// Couverture sur chaque fiche de répertoire : affichée tout de suite si elle est déjà calculée,
// sinon calculée en tâche de fond, un répertoire après l'autre (sans jeton Lichess : rien).
function homePerf(r) {
  const st = perfOf(r).get(epd(r.root));
  return st ? ` · <span title="Vos parties des ${WINDOW_DAYS} derniers jours avec ce répertoire : +${st.w} =${st.d} −${st.l}">${perfShort(st)}</span>` : '';
}
async function homeCoverage(el, reps) {
  if (!lichessCfg.connected) return;
  const show = (r, res) => {
    const span = el.querySelector(`[data-cov="${CSS.escape(r.id)}"]`);
    if (span && res && !res.unavailable) span.innerHTML = ` · <span class="cov-bar"><i style="width:${Math.round(res.coverage * 100)}%"></i></span> ${pct(res.coverage)} couvert${res.gaps.length ? `, ${plural(res.gaps.length, 'trou')}` : ''}`;
  };
  for (const r of reps) show(r, cachedCoverage(r));
  for (const r of reps) loadScores(r).then((sc) => {
    const span = el.querySelector(`[data-cov="${CSS.escape(r.id)}"]`);
    if (sc && span && el.isConnected) span.insertAdjacentHTML('afterend', `<span class="sc-mini" title="Efficacité · Solidité · Facilité"> · E ${sc.eff == null ? '—' : pct(sc.eff)} · S ${sc.sound == null ? '—' : pct(sc.sound)} · F ${sc.learn == null ? '—' : pct(sc.learn)}</span>`);
  });
  for (const r of reps) {
    if (cachedCoverage(r)) continue;
    const span = el.querySelector(`[data-cov="${CSS.escape(r.id)}"]`);
    if (span) span.textContent = ' · couverture : calcul…';
    const res = await coverageOf(r);
    if (!el.isConnected || document.body.dataset.view !== 'openings') return;
    show(r, res);
  }
}

// « · 3 à revoir » sur la fiche d'un répertoire (rien si aucune carte n'est due).
function dueLabel(r, events, reps) {
  const s = cardsSummary(computeCards(r, events, reps));
  return s.due ? ` · <b class="due">${s.due} à revoir</b>` : '';
}

function trainBox(reps, events) {
  let target = 0, due = 0, fresh = 0, newToday = 0;
  for (const r of reps) {
    const s = masterySummary(computeMastery(r, events, reps)); target += s.weak + s.new;
    const c = cardsSummary(computeCards(r, events, reps)); due += c.due; fresh += c.fresh; newToday += c.newToday;
  }
  const newLeft = Math.min(fresh, Math.max(0, NEW_PER_DAY() - newToday));
  const style = local.get('trainStyle', 'isolated') === 'lines' ? 'lines' : 'isolated';
  return `
  <section class="train-box">
    <h2 class="op-h2">S'entraîner</h2>
    <div class="train-modes">
      <div class="train-mode due-mode"><h3>À revoir</h3>
        <p class="muted small">Répétition espacée : chaque coup revient juste avant que vous l'oubliiez. <b>${plural(due, 'coup')} à revoir</b>${newLeft ? ` et ${newLeft} nouveau${newLeft > 1 ? 'x' : ''} aujourd'hui` : ''}.</p>
        <div class="row"><select id="train-style" aria-label="Façon de revoir les coups">
            <option value="isolated"${style === 'isolated' ? ' selected' : ''}>Coups isolés</option>
            <option value="lines"${style === 'lines' ? ' selected' : ''}>Lignes complètes</option></select>
          <a class="btn primary${due + newLeft ? '' : ' disabled'}" href="${due + newLeft ? '#/openings/train/due' : '#/openings'}">Commencer la révision</a></div></div>
      <div class="train-mode"><h3>Tout le répertoire</h3>
        <p class="muted small">Des lignes tirées au hasard dans tous vos répertoires. Vous jouez votre couleur, l'adversaire répond par un coup de votre répertoire.</p>
        <div class="row"><a class="btn primary" href="#/openings/train/all">Commencer</a></div></div>
      <div class="train-mode"><h3>Une ouverture</h3>
        <p class="muted small">Seulement le répertoire choisi.</p>
        <div class="row"><select id="train-pick" aria-label="Répertoire à travailler">${reps.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} (${colorFr(r.color)})</option>`).join('')}</select>
          <button id="train-rep" class="btn primary">Commencer</button></div></div>
      <div class="train-mode"><h3>Ciblé</h3>
        <p class="muted small">Vos coups non maîtrisés, puis ceux jamais revus : ${plural(target, 'position')} à travailler.</p>
        <div class="row"><a class="btn primary${target ? '' : ' disabled'}" href="${target ? '#/openings/train/targeted' : '#/openings'}">Commencer</a></div></div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ éditeur
function buildEditor(el) {
  el.innerHTML = `
  <h1 class="sr-only">Éditeur de répertoire</h1>
  <div class="left">
    <div class="board-wrap"><div id="rep-evalbar" class="evalbar hidden"><div class="white"></div><span class="label"></span></div><div id="rep-board"></div></div>
    <div class="board-opts"><button id="rep-flip" class="btn small" title="Retourner l'échiquier (F)">⇅ Retourner</button>
      <a id="rep-train" class="btn small primary" title="S'entraîner sur ce répertoire">▶ S'entraîner sur cette ligne</a>
      <button id="rep-play" class="btn small" title="Jouer une partie contre Maia à partir de la position affichée, avec la couleur du répertoire">♟ Jouer contre Maia d'ici</button>
      <a id="rep-model" class="btn small" title="Rejouer une partie de maître qui passe par cette ligne, en devinant vos coups">📖 Parties modèles</a>
      <span class="muted small">Clic droit sur un coup (appui long de 2 s sur téléphone) pour le désactiver ou le supprimer. Votre note sur le coup affiché : sous la liste des coups.</span></div>
  </div>
  <div id="rep-resize" class="resizer" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Largeur du panneau" aria-valuemin="420" aria-valuemax="720" title="Glisser pour redimensionner le panneau"></div>
  <aside class="panel" id="rep-panel" aria-label="Répertoire">
    <div class="phead">
      <a href="#/openings" class="icon-btn" title="Retour aux répertoires" aria-label="Retour"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle" id="rep-title"></span>
    </div>
    <div class="oblock">
      <div class="popening" id="rep-opening"></div>
      <div class="rperf small muted" id="rep-perf"></div>
      <button id="exp-gear" class="icon-btn" title="Réglages de l'éditeur : filtres Lichess, interface, moteur" aria-label="Réglages de l'éditeur"><svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4"/></svg></button>
    </div>
    <div id="rep-suggest" class="rsugg hidden" role="status"></div>
    <div id="rep-mastery"></div>
    <div class="tree-head"><h2>Arbre des coups</h2><button type="button" id="tree-fold" class="linkbtn">Tout replier</button></div>
    <div class="pmoves rtree" id="rep-moves"></div>
    <div class="ptabs" role="tablist" aria-label="Détail du répertoire">
      <button type="button" role="tab" id="rt-exp" aria-controls="rp-exp" aria-selected="true" data-rt="exp">Explorateur</button>
      <button type="button" role="tab" id="rt-cov" aria-controls="rp-cov" aria-selected="false" tabindex="-1" data-rt="cov">Couverture</button>
      <button type="button" role="tab" id="rt-note" aria-controls="rp-note" aria-selected="false" tabindex="-1" data-rt="note">Note</button>
    </div>
    <div id="rp-cov" role="tabpanel" aria-labelledby="rt-cov" class="tabpane hidden"><div id="rep-coverage"></div></div>
    <div id="rp-note" role="tabpanel" aria-labelledby="rt-note" class="tabpane hidden"><div id="rep-note"></div></div>
    <div id="rp-exp" role="tabpanel" aria-labelledby="rt-exp" class="tabpane exp">
      <div class="exp-head">
        <div class="exp-tabs" role="radiogroup" aria-label="Source"><button type="button" role="radio" aria-checked="false" data-db="masters">Masters</button><button type="button" role="radio" aria-checked="false" data-db="lichess">Lichess</button><button type="button" role="radio" aria-checked="false" data-db="stockfish">Stockfish</button></div>
        <span class="exp-sum" id="exp-sum"></span>
      </div>
      <div id="exp-body"></div>
    </div>
    <div class="navbar four">
      <button id="rep-first" class="btn" title="Début (↑)" aria-label="Début"><svg viewBox="0 0 24 24"><path d="M6 5v14M18 5l-8 7 8 7"/></svg></button>
      <button id="rep-prev" class="btn" title="Coup précédent (←)" aria-label="Coup précédent"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button id="rep-next" class="btn" title="Coup suivant (→)" aria-label="Coup suivant"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      <button id="rep-last" class="btn" title="Fin de la ligne (↓)" aria-label="Fin de la ligne"><svg viewBox="0 0 24 24"><path d="M18 5v14M6 5l8 7-8 7"/></svg></button>
    </div>
  </aside>
  <dialog id="exp-dlg" class="dlg"><form method="dialog">
    <div class="dlg-head"><button value="cancel" class="hb hb-x" aria-label="Fermer sans enregistrer">✕</button><h2>Réglages de l’éditeur</h2><button value="ok" class="hb hb-ok">OK</button></div>
    <div class="dtabs" role="tablist" aria-label="Réglages">
      <button type="button" role="tab" data-pane="lichess" class="on" aria-selected="true">Lichess</button>
      <button type="button" role="tab" data-pane="ui" aria-selected="false" tabindex="-1">Interface</button>
      <button type="button" role="tab" data-pane="eng" aria-selected="false" tabindex="-1">Moteur</button>
    </div>
    <div data-epane="lichess">
      <fieldset id="exp-ratings"><legend>Niveau des joueurs</legend><div class="pills">${RATINGS.map((r) => `<label class="pill"><input type="checkbox" value="${r}"><span title="${r === 0 ? 'moins de 1000' : r === 2500 ? '2500 et plus' : `${r} à ${RATINGS[RATINGS.indexOf(r) + 1] - 1}`}">${r === 0 ? 400 : r}</span></label>`).join('')}</div></fieldset>
      <fieldset id="exp-speeds"><legend>Cadences</legend><div class="pills">${SPEEDS.map(([k, l]) => `<label class="pill"><input type="checkbox" value="${k}"><span>${l}</span></label>`).join('')}</div></fieldset>
      <label class="setrow"><span class="st"><span class="t">Seuil d’un « trou »</span><span class="d" id="rep-cov-d"></span></span><span class="chev" aria-hidden="true">›</span>
        <select id="rep-cov" aria-label="Seuil d’un trou : positions vues dans au moins">${THRESHOLDS.map((n) => `<option value="${n}">${covPct(n)} des parties (1 sur ${n})</option>`).join('')}</select></label>
      <p class="muted small">Ces filtres ne concernent que l'onglet « Lichess ». La base Masters regroupe les parties de joueurs titrés et de plus de 2200 Elo.</p>
    </div>
    <div data-epane="ui" class="hidden">
      <div class="frow"><label for="rep-arrow">Meilleur coup (flèche verte)</label><select id="rep-arrow"><option value="1">Activé</option><option value="0">Désactivé</option></select></div>
      <div class="frow"><label for="rep-bar">Barre d'évaluation</label><select id="rep-bar"><option value="1">Activée</option><option value="0">Désactivée</option></select></div>
      <p class="muted small">La flèche montre le meilleur coup de la position affichée. La barre, à gauche de l'échiquier, donne l'évaluation de Stockfish (du point de vue des Blancs).</p>
    </div>
    <div data-epane="eng" class="hidden">
      <div id="rep-eng-fields"></div>
      <p class="muted small">Mêmes réglages que l'onglet moteur de l'analyse de partie. Ils valent aussi pour la flèche, la barre et l'onglet Stockfish.</p>
    </div>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button value="ok" class="btn primary">Appliquer</button></div>
  </form></dialog>`;

  E.board = new Board($('#rep-board', el), { onMove: (from, to, promo) => playMove(from + to + (promo || '')) });
  $('#rep-flip', el).onclick = () => { E.board.flip(); render(); };
  $('#rep-suggest', el).onclick = (e) => {
    if (!e.target.closest('.sg-go')) return;
    const t = $('#rt-exp', el); if (t) { t.click(); t.scrollIntoView({ block: 'nearest' }); t.focus(); }
  };
  $('#rep-play', el).onclick = () => {
    if (!E.rep) return;
    stashPlay({ fen: E.rep.root, ucis: E.path.slice(0, E.k).map((e) => e.uci), user: E.rep.color, label: E.rep.name });
    location.hash = '#/play';
  };
  $('#rep-first', el).onclick = () => go(0);
  $('#rep-prev', el).onclick = () => go(E.k - 1);
  $('#rep-next', el).onclick = () => forward();
  $('#rep-last', el).onclick = () => { while (forward(false)); render(); };
  // onglets Explorateur / Couverture / Note
  const rtabs = [...el.querySelectorAll('[data-rt]')];
  const selRt = (k, focus) => rtabs.forEach((t) => {
    const on = t.dataset.rt === k;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    $('#' + t.getAttribute('aria-controls'), el).classList.toggle('hidden', !on);
    if (on && focus) t.focus();
  });
  rtabs.forEach((t, i) => {
    t.onclick = () => { selRt(t.dataset.rt); local.set('repTab', t.dataset.rt); };
    t.onkeydown = (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); const n = rtabs[(i + d + rtabs.length) % rtabs.length]; selRt(n.dataset.rt, true); local.set('repTab', n.dataset.rt); }
      else if (e.key === 'Home') { e.preventDefault(); selRt('exp', true); } else if (e.key === 'End') { e.preventDefault(); selRt('note', true); }
    };
  });
  selRt(['exp', 'cov', 'note'].includes(local.get('repTab')) ? local.get('repTab') : 'exp');
  // largeur du panneau : 420–720 px (grand écran), glisser ou flèches
  const rz = $('#rep-resize', el);
  const setW = (w) => { w = Math.max(420, Math.min(720, Math.round(w))); el.style.setProperty('--panel-w', w + 'px'); rz.setAttribute('aria-valuenow', w); local.set('repPanelW', w); };
  const w0 = Number(local.get('repPanelW'));
  if (w0) setW(w0); else rz.setAttribute('aria-valuenow', 420);
  rz.onpointerdown = (e) => { rz.setPointerCapture(e.pointerId); rz.dataset.drag = '1'; };
  rz.onpointermove = (e) => { if (rz.dataset.drag) setW(el.getBoundingClientRect().right - 16 - e.clientX); };
  rz.onpointerup = () => { delete rz.dataset.drag; };
  rz.onkeydown = (e) => {
    const cur = Number(rz.getAttribute('aria-valuenow')) || 420;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setW(cur + 20); } else if (e.key === 'ArrowRight') { e.preventDefault(); setW(cur - 20); }
  };
  el.querySelectorAll('.exp-tabs button').forEach((b) => { b.onclick = () => { E.db = b.dataset.db; local.set('expDb', E.db); updateEngine(); renderExplorer(); }; });
  $('.exp-tabs', el).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const arr = [...el.querySelectorAll('.exp-tabs button')], i = arr.findIndex((b) => b.dataset.db === E.db);
    const n = arr[(i + (e.key === 'ArrowRight' ? 1 : arr.length - 1)) % arr.length];
    n.click(); n.focus(); e.preventDefault();
  });

  // Paramètres (roue dentée) : trois onglets. « Appliquer » enregistre tout ; le moteur est celui de l'analyse.
  const dlg = $('#exp-dlg', el);
  enterIsPrimary(dlg);
  let pane = 'lichess', engF = null;
  const showPane = (t) => {
    pane = t;
    dlg.querySelectorAll('.dtabs button').forEach((b) => { const on = b.dataset.pane === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    dlg.querySelectorAll('[data-epane]').forEach((p) => p.classList.toggle('hidden', p.dataset.epane !== t));
  };
  dlg.querySelectorAll('.dtabs button').forEach((b) => { b.onclick = () => showPane(b.dataset.pane); });
  dlg.querySelector('.dtabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const arr = [...dlg.querySelectorAll('.dtabs button')], i = arr.findIndex((b) => b.dataset.pane === pane);
    const n = arr[(i + (e.key === 'ArrowRight' ? 1 : arr.length - 1)) % arr.length];
    showPane(n.dataset.pane); n.focus(); e.preventDefault();
  });
  $('#exp-gear', el).onclick = () => {
    const rs = expRatings(), ss = expSpeeds();
    dlg.querySelectorAll('#exp-ratings input').forEach((i) => { i.checked = rs.includes(+i.value); });
    dlg.querySelectorAll('#exp-speeds input').forEach((i) => { i.checked = ss.includes(i.value); });
    $('#rep-arrow', el).value = repOn('repArrow') ? '1' : '0';
    $('#rep-bar', el).value = repOn('repBar') ? '1' : '0';
    $('#rep-cov', el).value = String(covN());
    $('#rep-cov', el).onchange = () => { $('#rep-cov-d', el).textContent = `Coups joués dans au moins ${covPct(+$('#rep-cov', el).value)} des parties`; };
    $('#rep-cov', el).onchange();
    engF = engineFields($('#rep-eng-fields', el), 'oeng');
    showPane('lichess');
    dlg.returnValue = '';
    dlg.showModal();
  };
  dlg.querySelector('form').onsubmit = async (e) => {
    if (!e.submitter || e.submitter.value !== 'ok') return;
    const rs = [...dlg.querySelectorAll('#exp-ratings input:checked')].map((i) => +i.value);
    const ss = [...dlg.querySelectorAll('#exp-speeds input:checked')].map((i) => i.value);
    local.set('expRatings', JSON.stringify(rs.length ? rs : RATINGS));
    local.set('expSpeeds', JSON.stringify(ss.length ? ss : SPEEDS.map(([k]) => k)));
    local.set('repArrow', $('#rep-arrow', el).value);
    local.set('repBar', $('#rep-bar', el).value);
    local.set('covThreshold', $('#rep-cov', el).value);
    if (pane === 'lichess') { E.db = 'lichess'; local.set('expDb', E.db); }
    if (engF) { await engF.save(); E.eng = null; E.engPending = null; }
    render();
  };
  // Moteur changé ailleurs (Boost PC détecté ou arrêté) : on recalcule la position affichée.
  onStatus(() => { if (E.rep) { updateEngine(); refreshEngine(); } });

  bindTree($('#rep-moves', el));
  $('#tree-fold', el).onclick = () => {
    if (E.treeKeys.some((k) => !E.folded.has(k))) E.treeKeys.forEach((k) => E.folded.add(k)); else E.folded.clear();
    renderTree();
  };

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'rep' || !E.rep || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { go(E.k - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { forward(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'Home') { go(0); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'End') { while (forward(false)); render(); e.preventDefault(); }
    else if (e.key === 'f') { E.board.flip(); render(); }
  });
}

export async function openRepertoire(el, id) {
  if (!el.dataset.built) { buildEditor(el); el.dataset.built = '1'; }
  const rep = await getRepertoire(id);
  if (!rep) { toast('Répertoire introuvable.'); location.hash = '#/openings'; return; }
  if (!E.rep || E.rep.id !== rep.id) { E.path = []; E.k = 0; E.board.setOrientation(rep.color); }
  E.rep = rep; E.folded = new Set(); E.addHere = null;
  // ouverture depuis une suggestion : on se place sur la position à enrichir
  if (E.focus && E.focus.repId === rep.id) {
    const p = pathTo(rep, rep.root, E.focus.epd);
    if (p) { E.path = p; E.k = p.length; } else E.focus = null;
  } else E.focus = null;
  await loadMastery();
  render();
  if (!LI.loaded) loadLichess();
}
export function leaveRepertoire() { E.rep = null; E.expSeq++; }

const curEpd = () => (E.k === 0 ? epd(E.rep.root) : E.path[E.k - 1].fenAfter);

function go(k) { E.k = Math.max(0, Math.min(E.path.length, k)); render(); }
// Avance d'un coup : suit la ligne affichée, sinon le premier coup enregistré depuis la position.
function forward(draw = true) {
  if (E.k < E.path.length) E.k++;
  else {
    const kid = childrenOf(E.rep, curEpd())[0];
    if (!kid || E.path.length > 400) return false;
    E.path.push(kid); E.k++;
  }
  if (draw) render();
  return true;
}

async function playMove(uci) {
  const before = E.rep.edges.length;
  const edge = addMove(E.rep, curEpd(), uci);
  if (!edge) { render(); return; }
  if (E.path[E.k] !== edge) E.path = [...E.path.slice(0, E.k), edge];
  E.k++;
  render();
  if (E.rep.edges.length !== before) { await saveRepertoire(E.rep); rescanSoon(); }
}

// Menu d'un coup (clic droit, appui long, touche Suppr) : désactiver / réactiver, ou supprimer.
// Un coup désactivé reste dans le répertoire mais n'est plus entraîné ni compté dans la maîtrise.
function moveMenu(n) {
  const line = E.nodes[n];
  if (!line) return;
  const edge = line[line.length - 1];
  const label = moveLabel(edge, line.length - 1) + frSan(edge.san);
  let dlg = $('#mv-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'mv-dlg';
    dlg.className = 'dlg';
    document.body.appendChild(dlg);
  }
  const subOff = subtreeEdges(edge).filter((e) => e.disabled);
  const act = (v, ic, txt, cls = '') => `<button value="${v}" class="mv-act ${cls}" role="menuitem"><span aria-hidden="true">${ic}</span>${txt}</button>`;
  dlg.innerHTML = `<form method="dialog" class="mv-menu">
    <div class="mv-head">${miniBoard(edge.fenAfter.split(' ')[0], 64)}
      <span class="mv-title"><b id="mv-t">${esc(label)}</b><span class="muted small">${esc(E.rep.name)}${edge.disabled ? ' · coup désactivé' : ''}${edge.auto ? ' · 🪄 ajouté automatiquement' : ''}</span></span></div>
    <div role="menu" aria-labelledby="mv-t" class="mv-list">
      ${edge.auto ? act('keep', '🪄', 'Garder ce coup (ne plus le marquer comme automatique)') : ''}
      ${act('add', '+', 'Ajouter un coup ici')}
      ${act('note', '✎', edge.note ? 'Modifier la note' : 'Ajouter une note')}
      ${act('toggle', edge.disabled ? '↺' : '⊘', edge.disabled ? 'Réactiver la ligne' : 'Désactiver la ligne')}
      ${subOff.length ? act('resub', '↻', `Réactiver les sous-lignes (${subOff.length})`) : ''}
      ${act('train', '▶', 'S’entraîner sur cette ligne')}
      <span class="mv-sep" role="separator"></span>
      ${act('delete', '✕', 'Supprimer à partir d’ici', 'danger')}
    </div>
    <p class="muted small mv-help">${edge.disabled
      ? 'Désactivé : le coup reste dans le répertoire, mais n\'est ni entraîné ni compté dans la maîtrise, pas plus que sa suite.'
      : 'Désactiver garde le coup sans l\'entraîner ni le compter dans la maîtrise (sa suite non plus).'}</p>
    <div class="row end"><button value="cancel" class="btn">Fermer</button></div></form>`;
  dlg.onclose = async () => {
    const v = dlg.returnValue;
    if (v === 'keep') { delete edge.auto; await saveRepertoire(E.rep); render(); toast(`${label} gardé.`); }
    else if (v === 'toggle') await toggleMove(edge, label);
    else if (v === 'resub') await reactivateSub(edge, label);
    else if (v === 'add') {
      // se place après ce coup et invite à jouer le coup à ajouter (échiquier ou explorateur)
      E.path = [...line]; E.k = line.length; E.addHere = curEpd(); render();
      const tab = $('#rt-exp'); if (tab) tab.click();
      window.scrollTo({ top: 0 });
    }
    else if (v === 'delete') await deleteNode(n);
    else if (v === 'train') location.hash = '#/openings/train/rep/' + encodeURIComponent(E.rep.id) + '/' + encodeURIComponent(edge.fenAfter);
    else if (v === 'note') {
      E.path = [...line]; E.k = line.length; render();
      const tab = $('#rt-note'); if (tab) tab.click();
      const ta = document.querySelector('#rep-note textarea'); if (ta) ta.focus();
    }
  };
  dlg.returnValue = '';
  dlg.showModal();
  dlg.querySelector('.mv-act').focus();
}

// Coups situés après `edge` (toutes les suites, transpositions comprises), sans `edge` lui-même.
function subtreeEdges(edge) {
  const seen = new Set([edge]), todo = [edge.fenAfter], out = [], done = new Set();
  while (todo.length) {
    const f = todo.pop();
    if (done.has(f)) continue;
    done.add(f);
    for (const e of childrenOf(E.rep, f)) { if (seen.has(e)) continue; seen.add(e); out.push(e); todo.push(e.fenAfter); }
  }
  return out;
}

// « Réactiver les sous-lignes » : remet en service les coups désactivés après ce coup (lui-même inchangé).
async function reactivateSub(edge, label) {
  const off = subtreeEdges(edge).filter((e) => e.disabled);
  if (!off.length) return;
  const rep = E.rep;
  off.forEach((e) => { delete e.disabled; });
  await saveRepertoire(rep);
  render();
  toast(`${plural(off.length, 'coup')} réactivé${off.length > 1 ? 's' : ''} après ${label}.`, {
    type: 'ok',
    action: { label: 'Annuler', fn: async () => {
      if (E.rep !== rep) { toast('Annulation impossible : ce répertoire n’est plus ouvert.', { type: 'err' }); return; }
      off.forEach((e) => { e.disabled = true; });
      await saveRepertoire(rep); render();
      toast('Sous-lignes de nouveau désactivées.', { type: 'ok' });
    } },
  });
}

async function toggleMove(edge, label) {
  if (edge.disabled) delete edge.disabled; else edge.disabled = true;
  await saveRepertoire(E.rep);
  render();
  toast(edge.disabled ? `${label} désactivé : il n'est plus entraîné.` : `${label} réactivé.`);
}

async function deleteNode(n) {
  const line = E.nodes[n];
  if (!line) return;
  const edge = line[line.length - 1];
  const gone = deleteMove({ ...E.rep, edges: [...E.rep.edges] }, edge.fenBefore, edge.uci); // essai à blanc, pour compter
  const label = moveLabel(edge, line.length - 1) + frSan(edge.san);
  const more = gone.length - 1;
  if (more && !confirm(`Supprimer ${label} et ${plural(more, 'coup')} qui en ${more > 1 ? 'dépendent' : 'dépend'} ?`)) return;
  const rep = E.rep;
  const before = { edges: [...rep.edges], path: [...E.path], k: E.k };
  deleteMove(E.rep, edge.fenBefore, edge.uci);
  const left = new Set(E.rep.edges);
  const cut = E.path.findIndex((e) => !left.has(e));
  if (cut >= 0) { E.path = E.path.slice(0, cut); E.k = Math.min(E.k, cut); }
  await saveRepertoire(E.rep);
  render();
  rescanSoon();
  const after = [...rep.edges];
  toast(more ? `${label} et ${plural(more, 'coup')} supprimés.` : `${label} supprimé.`, {
    type: 'info',
    action: { label: 'Annuler', fn: async () => {
      if (E.rep !== rep) { toast('Annulation impossible : ce répertoire n’est plus ouvert.', { type: 'err' }); return; }
      const added = rep.edges.filter((e) => !after.includes(e));
      if (added.length) { toast('Annulation impossible : le répertoire a changé depuis.', { type: 'err' }); return; }
      E.rep.edges = before.edges; E.path = before.path; E.k = before.k;
      await saveRepertoire(E.rep); render(); rescanSoon();
      toast('Suppression annulée.', { type: 'ok' });
    } },
  });
}

// ------------------------------------------------------------------ note du coup affiché
// Sous la liste : l'idée du coup (commentaire automatique, explain.js) et la note de l'utilisateur,
// enregistrée dans l'arête (edge.note) au fil de la frappe. La note sert aussi d'indice à l'entraînement.
let noteTimer = null;
function renderNote() {
  const box = $('#rep-note');
  if (!box) return;
  const cur = E.k ? E.path[E.k - 1] : null;
  if (!cur) { box.innerHTML = ''; box.dataset.edge = ''; return; }
  const id = `${cur.fenBefore}|${cur.uci}`;
  const ta = $('#note-txt', box);
  if (box.dataset.edge === id && ta) return; // même coup : on ne touche pas à la saisie en cours
  box.dataset.edge = id;
  const label = moveLabel(cur, E.k - 1) + frSan(cur.san);
  const auto = explainOpeningMove(cur.fenBefore, cur.uci);
  box.innerHTML = `${auto ? `<div class="note-auto small"><span class="muted">Idée de ${esc(label)} (automatique) :</span> ${esc(auto)}</div>` : ''}
    <textarea id="note-txt" rows="2" maxlength="600" spellcheck="true" aria-label="Votre note sur ${esc(label)}" placeholder="Votre note sur ${esc(label)} (idée, plan, piège à retenir…)">${esc(cur.note || '')}</textarea>`;
  $('#note-txt', box).oninput = (ev) => {
    const txt = ev.target.value.trim();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      if (txt) cur.note = txt; else delete cur.note;
      await saveRepertoire(E.rep);
      renderTree();
    }, 600);
  };
}

// ------------------------------------------------------------------ couverture et trous
// Calculée en tâche de fond (explorateur Lichess, cache de 30 jours), recalculée quand le
// répertoire, le seuil ou les filtres changent. Voir openings-coverage.js.
function renderCoverage() {
  const box = $('#rep-coverage');
  if (!box || !E.rep) return;
  if (!lichessCfg.connected) {
    box.innerHTML = '<div class="muted small">Couverture et trous : enregistrez un jeton Lichess (Paramètres → Connexion) pour les calculer.</div>';
    return;
  }
  const res = cachedCoverage(E.rep);
  if (!res) {
    box.innerHTML = `<div class="muted small">Couverture : calcul en cours${E.covProgress ? ` (${E.covProgress} positions)` : ''}…</div>`;
    // coverageOf ne relance pas un calcul déjà en cours pour le même répertoire, et abandonne celui
    // d'une version précédente : on peut l'appeler à chaque rendu.
    const rep = E.rep;
    coverageOf(rep, { onProgress: (done) => { E.covProgress = done; if (E.rep === rep && !cachedCoverage(rep)) { const t = box.querySelector('.muted'); if (t) t.textContent = `Couverture : calcul en cours (${done} positions)…`; } } })
      .then((r) => { E.covProgress = 0; if (r && E.rep === rep && cachedCoverage(rep)) renderCoverage(); });
    return;
  }
  if (res.unavailable) { box.innerHTML = ''; return; }
  const gaps = res.gaps.slice(0, 5);
  const gapLine = (g) => {
    const moves = sanLine(g.path.map((e) => e.san));
    const opp = g.opp ? `${g.path.length % 2 === 0 ? (Math.floor(g.path.length / 2) + 1) + '.' : (Math.floor(g.path.length / 2) + 1) + '…'}${frSan(g.opp.san)}` : '';
    return `${esc([moves, opp].filter(Boolean).join(' ')) || 'Position de départ'} <span class="muted">· ${pct(g.p)}${g.opp ? '' : ', ligne qui s’arrête'}</span>`;
  };
  box.innerHTML = `<div class="cov-row"><span class="cov-bar"><i style="width:${Math.round(res.coverage * 100)}%"></i></span>
      <b>${pct(res.coverage)}</b> <span class="muted small">couvert (positions vues dans 1 partie sur ${res.n})</span>
      ${gaps.length ? '<button type="button" class="btn small" id="cov-go">Aller au plus gros trou</button><button type="button" class="btn small" id="cov-fill" title="Aller au plus gros trou et le remplir selon votre style">🪄 Le remplir</button>' : ''}</div>
    ${gaps.length ? `<details class="cov-gaps"><summary class="small">${plural(res.gaps.length, 'trou')}, les plus fréquents</summary><ol>${gaps.map((g, i) => `<li><button type="button" class="link" data-gap="${i}">${gapLine(g)}</button></li>`).join('')}</ol></details>` : '<div class="muted small">Aucun trou au-dessus du seuil.</div>'}`;
  const goBtn = $('#cov-go', box);
  if (goBtn) goBtn.onclick = () => goToGap(gaps[0]);
  const fillBtn = $('#cov-fill', box);
  if (fillBtn) fillBtn.onclick = async () => { await goToGap(gaps[0]); if (E.gap) runFill(); };
  const autos = autoEdges(E.rep).length;
  box.insertAdjacentHTML('beforeend', `<div class="cov-extra small">${scoresHtml(E.rep)}${autos ? ` · <button type="button" class="link" id="auto-del">Retirer les ${plural(autos, 'coup')} ajouté${autos > 1 ? 's' : ''} automatiquement</button>` : ''}</div>`);
  const ad = $('#auto-del', box); if (ad) ad.onclick = removeAuto;
  const sb = $('#scores-go', box); if (sb) sb.onclick = () => runScores(E.rep);
  box.querySelectorAll('[data-gap]').forEach((b) => { b.onclick = () => goToGap(gaps[+b.dataset.gap]); });
}

// ------------------------------------------------------------------ remplissage automatique (🪄)
const styleText = () => fillStyle().map((v, i) => `${CRITERIA[i][1]} ${v}`).join(' · ');
const fillText = () => E.filling ? `Remplissage en cours : ${plural(E.filling.positions, 'position')} étudiée${E.filling.positions > 1 ? 's' : ''}, ${plural(E.filling.added, 'coup')} ajouté${E.filling.added > 1 ? 's' : ''}… (environ 5 à 20 secondes par position)` : '';

async function runFill() {
  if (!E.rep || !E.gap || E.filling) return;
  const rep = E.rep, gap = E.gap;
  const job = (E.filling = { cancel: false, positions: 0, added: 0 });
  render();
  let res = null, err = null;
  try {
    // sur une copie : le répertoire affiché ne change qu'à la fin (le bandeau reste visible)
    const work = { ...rep, edges: [...rep.edges] };
    res = await fillGap(work, gap.epd, gap.p, {
      onProgress: ({ positions, added }) => { job.positions = positions; job.added = added; const t = $('#fill-prog'); if (t) t.textContent = fillText(); },
      isCancelled: () => job.cancel || E.rep !== rep,
    });
  } catch (e) { err = e; }
  E.filling = null;
  if (res && res.added.length) {
    const have = new Set(rep.edges.map((e) => e.fenBefore + '|' + e.uci));
    for (const e of res.added) if (!have.has(e.fenBefore + '|' + e.uci)) rep.edges.push(e);
    await saveRepertoire(rep);
    rescanSoon();
  }
  if (E.rep !== rep) return;
  if (err) { toast('Remplissage impossible : ' + esc(err.message), 6000); render(); return; }
  E.gap = null;
  render();
  const n = res.added.length;
  toast(n ? `🪄 ${plural(n, 'coup')} ajouté${n > 1 ? 's' : ''} (en italique dans la liste)${res.stopped ? ' ; arrêté avant la fin : relancez sur le trou suivant pour continuer' : ''}.`
    : 'Aucun coup ajouté : pas assez de parties dans cette position.', 6000);
}

function openStyle() {
  let dlg = $('#style-dlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'style-dlg'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
  const v = fillStyle();
  const draw = () => {
    const left = STYLE_POINTS - v.reduce((a, b) => a + b, 0);
    dlg.innerHTML = `<form method="dialog">
      <h2>Style de remplissage</h2>
      <p class="muted small">Répartissez ${STYLE_POINTS} points entre les trois critères. Le remplissage choisit, dans chaque position, le coup qui obtient la meilleure note avec ces poids.</p>
      ${CRITERIA.map(([k, name, help], i) => `<div class="style-row"><span><b>${name}</b><br><span class="muted small">${help}</span></span>
        <span class="style-ctl"><button type="button" class="btn small" data-i="${i}" data-d="-1" aria-label="Moins de ${name}" ${v[i] ? '' : 'disabled'}>−</button>
        <b class="style-v" aria-live="polite">${v[i]}</b>
        <button type="button" class="btn small" data-i="${i}" data-d="1" aria-label="Plus de ${name}" ${left ? '' : 'disabled'}>+</button></span></div>`).join('')}
      <p class="small ${left ? 'err' : 'muted'}">${left ? `Reste ${plural(left, 'point')} à répartir.` : 'Tous les points sont répartis.'}</p>
      <div class="row end"><button value="cancel" class="btn">Annuler</button><button value="ok" class="btn primary" ${left ? 'disabled' : ''}>Enregistrer</button></div></form>`;
    dlg.querySelectorAll('[data-d]').forEach((b) => {
      b.onclick = () => { const i = +b.dataset.i; v[i] = Math.max(0, v[i] + +b.dataset.d); draw(); const nb = dlg.querySelector(`[data-i="${i}"][data-d="${b.dataset.d}"]`); if (nb && !nb.disabled) nb.focus(); };
    });
  };
  draw();
  dlg.onclose = () => { if (dlg.returnValue === 'ok') { setFillStyle(v); render(); } };
  dlg.returnValue = '';
  dlg.showModal();
}

async function removeAuto() {
  const rep = E.rep;
  const list = autoEdges(rep);
  if (!list.length) return;
  const trial = { ...rep, edges: [...rep.edges] };
  let gone = 0;
  for (const e of list) gone += deleteMove(trial, e.fenBefore, e.uci).length;
  const extra = gone - list.length;
  if (!confirm(`Retirer les ${plural(list.length, 'coup')} ajouté${list.length > 1 ? 's' : ''} automatiquement${extra > 0 ? ` et ${plural(extra, 'coup')} que vous avez ajouté${extra > 1 ? 's' : ''} à leur suite` : ''} ?`)) return;
  for (const e of list) if (rep.edges.includes(e)) deleteMove(rep, e.fenBefore, e.uci);
  const left = new Set(rep.edges);
  const cut = E.path.findIndex((e) => !left.has(e));
  if (cut >= 0) { E.path = E.path.slice(0, cut); E.k = Math.min(E.k, cut); }
  await saveRepertoire(rep);
  render();
  rescanSoon();
  toast(`${plural(gone, 'coup')} retiré${gone > 1 ? 's' : ''}.`);
}

// ------------------------------------------------------------------ scores du répertoire
// Calculés à la demande (cloud Lichess et explorateur), gardés sur l'appareil tant que le
// répertoire, le seuil et les filtres ne changent pas.
const scoreMemo = new Map(); // id → { key, res } | { key, running, done, total }
async function loadScores(rep) {
  const m = scoreMemo.get(rep.id);
  if (m) return m.key === coverageKey(rep) && m.res ? m.res : null;
  try { const c = await store.cacheGet('scores|' + rep.id); if (c) scoreMemo.set(rep.id, c); return c && c.key === coverageKey(rep) ? c.res : null; } catch { return null; }
}
function scoresHtml(rep) {
  const m = scoreMemo.get(rep.id);
  const key = coverageKey(rep);
  if (m && m.key === key && m.running) return `Scores : calcul… (${m.done}/${m.total || '?'})`;
  if (m && m.key === key && m.res) {
    const r = m.res, f = (x) => (x == null ? '—' : pct(x));
    return `<span title="Moyennes pondérées par la fréquence des positions, de 0 à 100 %">Efficacité <b>${f(r.eff)}</b> · Solidité <b>${f(r.sound)}</b> · Facilité <b>${f(r.learn)}</b></span> <button type="button" class="link" id="scores-go">recalculer</button>`;
  }
  if (!m) loadScores(rep).then((r) => { if (r && E.rep === rep) renderCoverage(); });
  return '<button type="button" class="link" id="scores-go">Calculer les scores (efficacité, solidité, facilité)</button>';
}
async function runScores(rep) {
  const key = coverageKey(rep);
  const job = { key, running: true, done: 0, total: 0 };
  scoreMemo.set(rep.id, job);
  renderCoverage();
  const res = await repertoireScores(rep, {
    onProgress: (done, total) => { job.done = done; job.total = total; if (E.rep === rep) renderCoverage(); },
    isCancelled: () => scoreMemo.get(rep.id) !== job,
  }).catch(() => null);
  if (scoreMemo.get(rep.id) !== job) return;
  if (!res) { scoreMemo.delete(rep.id); toast('Scores indisponibles (jeton Lichess requis, ou connexion).'); }
  else { const v = { key, res }; scoreMemo.set(rep.id, v); store.cacheSet('scores|' + rep.id, v).catch(() => {}); }
  if (E.rep === rep) renderCoverage();
  if (document.body.dataset.view === 'openings') renderHome($('#openings-view'));
}

// Se place sur un trou : on suit le chemin du répertoire, puis on joue le coup adverse manquant
// (il est ajouté au répertoire, comme un coup joué sur l'échiquier) ; reste à jouer la réponse.
async function goToGap(g) {
  if (!g || !E.rep) return;
  const edges = new Set(E.rep.edges);
  if (!g.path.every((e) => edges.has(e))) {
    // le répertoire a changé depuis le calcul : on retrouve le chemin par les positions
    const p = pathTo(E.rep, E.rep.root, g.epd, true);
    if (!p) { toast('Ce trou n’existe plus : la couverture va être recalculée.'); render(); return; }
    g = { ...g, path: p };
  }
  E.path = [...g.path];
  E.k = E.path.length;
  if (g.opp) {
    await playMove(g.opp.uci);
    E.gap = { epd: curEpd(), p: g.p };
  } else E.gap = { epd: g.epd, p: g.p };
  render();
  $('#rep-board').scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ maîtrise (affichage)
function masteryTip(m) {
  const st = STATUS[m.status].label;
  if (m.status === 'shared') return 'Maîtrise : ' + st;
  if (!m.total) return `Maîtrise : ${st} (aucune situation ces ${WINDOW_DAYS} derniers jours)`;
  return `Maîtrise : ${st} — ${m.correct} bonne${m.correct > 1 ? 's' : ''} réponse${m.correct > 1 ? 's' : ''} sur ${plural(m.total, 'situation')} (${Math.round(100 * m.ratio)} %)`;
}
function summaryHtml(s) {
  if (!s.positions) return '';
  const part = (k, label) => (s[k] ? `<span class="mst"><i style="background:${STATUS[k].color}"></i>${s[k]} ${label}</span>` : '');
  return part('mastered', s.mastered > 1 ? 'maîtrisés' : 'maîtrisé') + part('weak', s.weak > 1 ? 'non maîtrisés' : 'non maîtrisé')
    + part('progress', 'en cours') + part('new', s.new > 1 ? 'jamais revus' : 'jamais revu') + part('shared', s.shared > 1 ? 'partagés' : 'partagé');
}
// Barre segmentée de maîtrise + légende textuelle (jamais la couleur seule).
const MST_SYM = { mastered: '✓', progress: '◐', weak: '✗', new: '○', shared: '–' };
function masteryBar(s) {
  if (!s.positions) return '';
  const seg = (k) => (s[k] ? `<i style="flex:${s[k]};background:${STATUS[k].color}" title="${s[k]} ${STATUS[k].label.split(' (')[0]}"></i>` : '');
  const legend = ['mastered', 'progress', 'weak', 'new', 'shared'].filter((k) => s[k]).map((k) => `<span class="mst"><span aria-hidden="true">${MST_SYM[k]}</span> ${s[k]} ${STATUS[k].label.split(' (')[0]}</span>`).join('');
  return `<span class="mbar" role="img" aria-label="Maîtrise : ${esc(legend.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}">${['mastered', 'progress', 'weak', 'new', 'shared'].map(seg).join('')}</span><span class="mst-row small">${legend}</span>`;
}
function renderMastery() {
  const s = masterySummary(E.mastery);
  const cur = E.k ? E.path[E.k - 1] : null;
  const m = cur && cur.fenBefore.split(' ')[1] === E.rep.color ? E.mastery.get(cur.fenBefore) : null;
  const detail = m ? `<div class="mst-cur small"><b>${moveLabel(cur, E.k - 1)}${figSan(cur.san, E.rep.color)}</b> · ${esc(masteryTip(m).replace('Maîtrise : ', ''))}</div>` : '';
  $('#rep-mastery').innerHTML = s.positions
    ? `<div class="mst-row">${summaryHtml(s)}</div>${detail}<div class="muted small" title="Maîtrisé dès ${MIN_SITUATIONS} situations avec au moins ${Math.round(THRESHOLD * 100)} % de bonnes réponses, sur ${WINDOW_DAYS} jours de parties chess.com et d'entraînement.">Vos coups sont soulignés selon leur maîtrise. Touchez-en un pour le détail.</div>`
    : '';
}

// ------------------------------------------------------------------ liste des coups (arbre)
// Numéro du coup au demi-coup ply (0 = premier coup depuis la racine). Si la racine a les Noirs
// au trait, le premier coup est « 1... » (même décalage que renderMoves dans analyse.js).
function moveLabel(edge, ply) {
  const side = E.rep.root.split(' ')[1];
  const no0 = Number(E.rep.root.split(' ')[5]) || 1;
  const no = no0 + Math.floor((ply + (side === 'b' ? 1 : 0)) / 2);
  return `${no}${edge.fenBefore.split(' ')[1] === 'w' ? '.' : '...'}`;
}

// Arbre en lignes repliables : une ligne = une suite de coups sans embranchement ; les variantes
// (alternatives et suites) sont des lignes imbriquées. Chaque coup reste cliquable (.rm).
const TREE_ST = { mastered: 'Maîtrisé', progress: 'En cours', weak: 'Non maîtrisé', new: 'Jamais revu', shared: 'Partagé' };
function renderTree() {
  const el = $('#rep-moves');
  const rep = E.rep;
  E.nodes = [];
  E.treeKeys = [];
  if (!E.folded) E.folded = new Set();
  // Chaque position n'est développée qu'une fois (ligne principale d'abord) ; ailleurs, « transposition ».
  const owner = new Map([[epd(rep.root), null]]);
  (function own(p) { for (const e of childrenOf(rep, p)) if (!owner.has(e.fenAfter)) { owner.set(e.fenAfter, e); own(e.fenAfter); } })(epd(rep.root));
  const cur = E.k ? E.path[E.k - 1] : null;
  const pathSet = new Set(E.path.slice(0, E.k));
  const perf = perfOf(rep);
  const active = new Set(reachableEdges(rep, true)); // coups entraînés (hors coups désactivés et leur suite)
  const mine = (e) => e.fenBefore.split(' ')[1] === rep.color;
  let count = 0;
  const mv = (e, ply, prefix, forceNum) => {
    const n = E.nodes.push([...prefix, e]) - 1;
    const white = e.fenBefore.split(' ')[1] === 'w';
    const num = white || forceNum ? `<span class="rnum">${moveLabel(e, ply)}</span>` : '';
    const m = mine(e) ? E.mastery.get(e.fenBefore) : null;
    const off = !active.has(e);
    let cls = m && !off ? ` mine st-${m.status}` : off && mine(e) ? ' mine' : '';
    if (off) cls += ' off';
    if (e === cur) cls += ' cur';
    if (e.auto) cls += ' auto';
    const pf = perf.get(e.fenAfter);
    const tipTxt = [off ? `${e.disabled ? 'Coup désactivé' : 'Suite d’un coup désactivé'} : ni entraîné ni compté dans la maîtrise` : m ? masteryTip(m) : '',
      e.auto ? 'Ajouté automatiquement (🪄)' : '',
      pf ? `Vos parties après ce coup : ${perfShort(pf)} (+${pf.w} =${pf.d} −${pf.l})` : ''].filter(Boolean).join('\n');
    const tip = tipTxt ? ` title="${esc(tipTxt)}"` : '';
    const note = e.note ? `<span class="rnote" title="${esc(e.note)}" aria-label="Note">✎</span>` : '';
    return `${num}<span class="rm${cls}" role="button" tabindex="0" data-n="${n}"${tip}>${figSan(e.san, white ? 'w' : 'b')}${note}</span> `;
  };
  function rows(p, ply, prefix, depth, forceNum) {
    let html = '';
    for (const first of childrenOf(rep, p)) {
      if (++count > 4000) break;
      const chain = [first];
      let e = first, trans = false;
      for (;;) {
        if (owner.get(e.fenAfter) !== e) { trans = true; break; }
        const kids = childrenOf(rep, e.fenAfter);
        if (kids.length !== 1 || ++count > 4000) break;
        e = kids[0]; chain.push(e);
      }
      const last = chain[chain.length - 1];
      const hasKids = !trans && childrenOf(rep, last.fenAfter).length > 0;
      const key = last.fenAfter;
      E.treeKeys.push(key);
      const forced = pathSet.has(last) && last !== cur;
      const folded = hasKids && E.folded.has(key) && !forced;
      let moves = '', pre = prefix, pl = ply;
      chain.forEach((c, i) => { moves += mv(c, pl, pre, i === 0); pre = [...pre, c]; pl++; });
      const sel = chain.includes(cur);
      const onpath = !sel && chain.every((c) => pathSet.has(c));
      const allOff = chain.every((c) => !active.has(c));
      const userEdges = chain.filter((c) => mine(c) && active.has(c) && E.mastery.get(c.fenBefore));
      const st = userEdges.length ? E.mastery.get(userEdges[userEdges.length - 1].fenBefore).status : null;
      const mk = st ? `<span class="tmk st-${st}" role="img" aria-label="${TREE_ST[st]}" title="${TREE_ST[st]}"></span>` : '<span class="tmk none" aria-hidden="true"></span>';
      const hole = E.gap && E.gap.epd === last.fenAfter && !hasKids && !trans ? '<span class="thole">● trou</span>' : '';
      const tr = trans ? '<span class="rtrans" title="Cette position est déjà dans le répertoire par un autre ordre de coups">⇄ transposition</span>' : '';
      const chev = hasKids ? `<button type="button" class="tchev" data-fold="${key}" aria-expanded="${!folded}" aria-label="${folded ? 'Déplier' : 'Replier'} la suite">${folded ? '▸' : '▾'}</button>` : '<span class="tchev"></span>';
      html += `<div role="listitem" class="trow${sel ? ' sel' : ''}${onpath ? ' onpath' : ''}${allOff ? ' off' : ''}" style="--d:${depth}">${chev}${mk}<span class="tmoves">${moves}</span>${tr}${hole}</div>`;
      if (hasKids && !folded) html += rows(last.fenAfter, pl, pre, depth + 1, true);
    }
    return html;
  }
  const html = rows(epd(rep.root), 0, [], 0, rep.root.split(' ')[1] === 'b');
  el.innerHTML = html ? `<div class="trows" role="list">${html}</div>`
    : '<p class="muted pad">Jouez un premier coup sur l\'échiquier, ou cliquez sur un coup de l\'explorateur ci-dessous.</p>';
  const fb = $('#tree-fold');
  if (fb) {
    fb.classList.toggle('hidden', !E.treeKeys.length);
    const anyOpen = E.treeKeys.some((k) => !E.folded.has(k));
    fb.textContent = anyOpen ? 'Tout replier' : 'Tout déplier';
  }
  const c = el.querySelector('.trow.sel');
  if (c) {
    const r = c.getBoundingClientRect(), pr = el.getBoundingClientRect();
    if (r.top < pr.top) el.scrollTop -= pr.top - r.top + 8;
    else if (r.bottom > pr.bottom) el.scrollTop += r.bottom - pr.bottom + 8;
  }
}

// Clic : aller au coup. Clic droit (souris) ou appui long de 2 s (tactile) : menu du coup (désactiver, supprimer).
function bindTree(el) {
  let timer = null, pressed = null, fired = false, x0 = 0, y0 = 0, lastType = 'mouse';
  const cancel = () => { clearTimeout(timer); timer = null; if (pressed) pressed.classList.remove('pressing'); pressed = null; };
  el.addEventListener('pointerdown', (e) => {
    lastType = e.pointerType;
    fired = false;
    const t = e.target.closest('.rm');
    if (!t || e.pointerType === 'mouse') return;
    pressed = t; x0 = e.clientX; y0 = e.clientY;
    t.classList.add('pressing');
    timer = setTimeout(() => { const n = +t.dataset.n; cancel(); fired = true; if (navigator.vibrate) navigator.vibrate(30); moveMenu(n); }, LONG_PRESS);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 12) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  // Clavier : Entrée ou Espace sur un coup = clic (aller au coup) ; Suppr ou Menu = menu du coup.
  el.addEventListener('keydown', (e) => {
    const t = e.target.closest && e.target.closest('.rm');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); }
    else if (t && (e.key === 'Delete' || e.key === 'ContextMenu')) { e.preventDefault(); moveMenu(+t.dataset.n); }
  });
  el.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fold]');
    if (f) { const k = f.dataset.fold; if (E.folded.has(k)) E.folded.delete(k); else E.folded.add(k); renderTree(); return; }
    const t = e.target.closest('.rm');
    if (!t) return;
    if (fired) { fired = false; return; }
    const line = E.nodes[+t.dataset.n];
    if (!line) return;
    E.path = [...line]; E.k = line.length; render();
  });
  el.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.rm');
    if (!t) return;
    e.preventDefault(); // sur téléphone, le menu du navigateur ne doit pas s'ouvrir : l'appui long est géré ci-dessus
    if (lastType !== 'touch') moveMenu(+t.dataset.n);
  });
}

// ------------------------------------------------------------------ explorateur
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace('.', ',') + ' M'
  : n >= 1e4 ? Math.round(n / 1000) + ' k' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' k' : String(n));
function barHtml(w, d, b) {
  const t = w + d + b || 1;
  const seg = (v, c) => { const p = (100 * v) / t; return `<span class="${c}" style="width:${p}%">${p >= 13 ? Math.round(p) + ' %' : ''}</span>`; };
  return `<span class="wdb" title="Blancs ${Math.round((100 * w) / t)} % · Nulle ${Math.round((100 * d) / t)} % · Noirs ${Math.round((100 * b) / t)} %">${seg(w, 'w')}${seg(d, 'd')}${seg(b, 'b')}</span>`;
}

// Résumé à droite des puces : filtres actifs de la source choisie.
function expSummary() {
  if (E.db === 'masters') return 'Titrés · 2200+';
  if (E.db === 'stockfish') { const d = analysisSettings().depth; return d ? `profondeur ${d}` : ''; }
  const rs = expRatings().slice().sort((a, b) => a - b), ss = expSpeeds();
  const lab = (r) => (r === 0 ? 400 : r);
  const lv = rs.length >= RATINGS.length ? 'tous niveaux' : rs.length === 1 ? String(lab(rs[0])) : `${lab(rs[0])}–${lab(rs[rs.length - 1])}`;
  const sp = ss.length >= SPEEDS.length ? 'toutes cadences' : ss.length > 3 ? `${ss.length} cadences` : SPEEDS.filter(([k]) => ss.includes(k)).map(([, l]) => l.toLowerCase()).join(', ');
  return [lv, sp].filter(Boolean).join(' · ');
}

async function renderExplorer() {
  const body = $('#exp-body');
  document.querySelectorAll('.exp-tabs button').forEach((b) => { const on = b.dataset.db === E.db; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  $('#exp-sum').textContent = expSummary();
  const seq = ++E.expSeq;
  if (E.db === 'stockfish') { renderStockfish(body); return; }
  if (!lichessCfg.connected) {
    body.innerHTML = '<p class="muted pad">Pour voir les statistiques des bases Masters et Lichess, enregistrez votre jeton Lichess dans <a href="#/settings/connection">Paramètres → Connexion</a>.</p>';
    return;
  }
  const p = curEpd();
  const turn = p.split(' ')[1];
  // pendant le chargement, l'ancien tableau reste affiché mais grisé (pas de saut de mise en page)
  if (!body.querySelector('table')) body.innerHTML = '<p class="muted pad">Chargement…</p>';
  else body.classList.add('loading');
  let j;
  try {
    await new Promise((r) => setTimeout(r, 150)); // une seule requête quand on fait défiler la ligne
    if (seq !== E.expSeq) return;
    j = await explore(E.db, fenOf(p), E.db === 'lichess' ? { ratings: expRatings(), speeds: expSpeeds() } : {});
  } catch (e) {
    if (seq !== E.expSeq) return;
    body.classList.remove('loading');
    body.innerHTML = `<p class="err pad">Explorateur indisponible : ${esc(e.message)}.${e.code === 'auth' ? ' Vérifiez le jeton dans <a href="#/settings/connection">Paramètres → Connexion</a>.' : ''}</p>`;
    return;
  }
  if (seq !== E.expSeq) return;
  body.classList.remove('loading');
  if (E.k && j.opening && j.opening.name && !openingName()) $('#rep-opening').textContent = openingHead(j.opening);
  const total = j.white + j.draws + j.black;
  if (!j.moves.length) { body.innerHTML = '<p class="muted pad">Aucune partie de cette base n\'atteint cette position.</p>'; return; }
  const mine = new Set(childrenOf(E.rep, p).map((e) => e.uci));
  const rows = j.moves.map((m) => {
    const n = m.white + m.draws + m.black;
    const inRep = mine.has(m.uci);
    return `<tr data-uci="${esc(m.uci)}" class="${inRep ? 'inrep' : ''}" title="${inRep ? 'Déjà dans le répertoire' : 'Cliquer pour ajouter ce coup au répertoire'}">
      <td class="emv">${figSan(m.san, turn)}${inRep ? '<span class="inrep-dot" aria-label="dans le répertoire">●</span>' : ''}</td>
      <td class="epct">${Math.round((100 * n) / total)} %</td><td class="en">${fmtN(n)}</td><td class="ebar">${barHtml(m.white, m.draws, m.black)}</td></tr>`;
  }).join('');
  body.innerHTML = `<table class="exp-table"><tbody>${rows}
    <tr class="etot"><td class="emv">Σ</td><td class="epct">100 %</td><td class="en">${fmtN(total)}</td><td class="ebar">${barHtml(j.white, j.draws, j.black)}</td></tr></tbody></table>`;
  body.querySelectorAll('tr[data-uci]').forEach((tr) => { tr.onclick = () => playMove(tr.dataset.uci); });
}

// ------------------------------------------------------------------ rendu
function openingName() {
  let name = null;
  for (const e of E.path.slice(0, E.k)) { const o = BOOK[e.fenAfter]; if (o && o.length) name = o[1]; }
  return name;
}
// « Giuoco Pianissimo · 6… a6 (C54) » : ouverture, dernier coup joué, code ECO.
function openingHead(alt) {
  if (E.k === 0) return 'Position de départ';
  let o = null;
  for (const e of E.path.slice(0, E.k)) { const b = BOOK[e.fenAfter]; if (b && b.length) o = b; }
  const cur = E.path[E.k - 1];
  const mv = cur ? `${moveLabel(cur, E.k - 1).replace('...', '…')} ${frSan(cur.san)}` : '';
  const name = o ? o[1] : alt && alt.name, eco = o ? o[0] : alt && alt.eco;
  return [frOpening(name) || 'Ouverture inconnue', mv].filter(Boolean).join(' · ') + (eco ? ` (${eco})` : '');
}

function render() {
  if (!E.rep) return;
  const atFocus = E.focus && curEpd() === E.focus.epd;
  drawBoard();
  const sg = $('#rep-suggest');
  const alertHtml = (title, text, btn, ic = '!') => `<span class="sg-ic" aria-hidden="true">${ic}</span><span class="sg-txt"><b>${title}</b> — ${text}</span><button type="button" class="sg-go">${btn}</button>`;
  if (atFocus && !childrenOf(E.rep, curEpd()).length) {
    const played = [...new Set(E.focus.errors.map((e) => frSan(e.san)))].join(', ');
    sg.innerHTML = alertHtml('À enrichir', `${plural(E.focus.errors.length, 'faute')} ici (joué : ${esc(played)})`
      + `${E.focus.best ? ` · meilleur coup : <b>${esc(frSan(uciToSan(curEpd(), E.focus.best)))}</b>` : ''}`, 'Ajouter');
    sg.title = 'Jouez sur l\'échiquier le coup à ajouter, ou choisissez-le dans l\'explorateur.';
    sg.classList.remove('hidden');
  } else if (E.gap && curEpd() === E.gap.epd && !childrenOf(E.rep, curEpd()).length) {
    const cur = E.k ? E.path[E.k - 1] : null;
    if (E.filling) sg.innerHTML = `<span class="sg-ic" aria-hidden="true">🪄</span><span class="sg-txt" id="fill-prog">${fillText()}</span><button type="button" class="sg-alt" id="fill-stop">Arrêter</button>`;
    else {
      sg.innerHTML = alertHtml('Trou du répertoire', `aucun coup prévu${cur ? ` après ${esc(moveLabel(cur, E.k - 1) + frSan(cur.san))}` : ''} (${pct(E.gap.p)} de vos parties passent ici)`, 'Combler');
      if (lichessCfg.connected) sg.insertAdjacentHTML('beforeend', `<div class="sg-acts"><button type="button" class="sg-alt" id="gap-fill" title="Remplir automatiquement selon votre style (${styleText()})">🪄 Remplir</button><button type="button" class="sg-alt sg-icon" id="gap-style" title="Style de remplissage : ${styleText()}" aria-label="Style de remplissage">⚙</button></div>`);
    }
    sg.title = 'Jouez votre réponse sur l\'échiquier, ou choisissez-la dans l\'explorateur.';
    sg.classList.remove('hidden');
    const gf = $('#gap-fill', sg); if (gf) gf.onclick = () => runFill();
    const gs = $('#gap-style', sg); if (gs) gs.onclick = () => openStyle();
    const fs = $('#fill-stop', sg); if (fs) fs.onclick = () => { if (E.filling) E.filling.cancel = true; };
  } else if (E.addHere && curEpd() === E.addHere) {
    const have = childrenOf(E.rep, curEpd()).length;
    sg.innerHTML = alertHtml('Ajouter un coup', `jouez-le sur l'échiquier, ou choisissez-le dans l'explorateur${have ? ` (${plural(have, 'coup')} déjà prévu${have > 1 ? 's' : ''} ici)` : ''}`, 'Explorateur', '+');
    sg.title = 'Le coup joué sur l\'échiquier est ajouté au répertoire à cette position.';
    sg.classList.remove('hidden');
  } else {
    if (E.focus && !atFocus && E.k > 0 && childrenOf(E.rep, E.focus.epd).length) E.focus = null; // coup ajouté : suggestion traitée
    if (E.gap && childrenOf(E.rep, E.gap.epd).length) E.gap = null; // trou bouché
    sg.classList.add('hidden');
  }
  $('#rep-train').href = '#/openings/train/rep/' + encodeURIComponent(E.rep.id);
  $('#rep-model').href = '#/openings/model/' + encodeURIComponent(E.rep.id) + (E.k ? '/' + encodeURIComponent('p:' + curEpd()) : '');
  $('#rep-title').innerHTML =`<span class="avatar-sm ${E.rep.color}"><img src="pieces/${E.rep.color}K.svg" alt=""></span><span class="ell" title="${esc(E.rep.name)}">${esc(E.rep.name)}</span>`;
  $('#rep-opening').textContent = openingHead();
  $('#rep-perf').innerHTML = perfLine(perfOf(E.rep).get(curEpd()));
  refreshMastery();
  renderCoverage();
  renderMastery();
  renderTree();
  renderNote();
  updateEngine();
  renderExplorer();
}

// ------------------------------------------------------------------ moteur (Stockfish)
// Évaluation de la position affichée : sert à l'onglet « Stockfish », à la flèche du meilleur coup et à la
// barre d'évaluation. Calculée seulement si l'une de ces trois choses est active. Même moteur que l'analyse.
const engOn = () => E.db === 'stockfish' || repOn('repArrow') || repOn('repBar');
function engKey(fen) { const st = analysisSettings(); return `${fen}|${st.boost}|${st.depth}|${maxTime()}|${nLines()}`; }
// Évaluation de la position affichée, si elle est déjà calculée avec les réglages actuels.
function engHere() {
  const fen = fenOf(curEpd());
  return E.eng && E.eng.fen === fen && E.eng.key === engKey(fen) ? E.eng : null;
}

function updateEngine() {
  const fen = fenOf(curEpd());
  if (!engOn() || new Chess(fen).isGameOver()) { E.eng = null; E.engPending = null; return; }
  const key = engKey(fen);
  if (E.eng && E.eng.key === key) return;
  if (E.engPending === key) return; // calcul déjà lancé pour cette position
  E.engPending = key;
  E.eng = null;
  clearTimeout(E.engTimer);
  // petit délai : pas de calcul pendant qu'on fait défiler les coups
  E.engTimer = setTimeout(async () => {
    const st = analysisSettings();
    let eng;
    try {
      const res = await analyzePosition(fen, null, { cloud: true, priority: true, multipv: nLines(), depth: st.fixed ? null : st.depth, movetime: maxTime() });
      eng = { key, fen, res };
    } catch (e) {
      eng = { key, fen, err: e.message };
    }
    if (E.engPending !== key) return; // la position a changé entre-temps
    E.engPending = null;
    E.eng = eng;
    if (E.rep) refreshEngine();
  }, 200);
}

// Redessine ce qui dépend du moteur, sans recalculer le reste de l'éditeur.
function refreshEngine() {
  if (!E.rep) return;
  drawBoard();
  if (E.db === 'stockfish') renderExplorer();
}

// Échiquier : flèche « suggestion » (si la position vient d'une suggestion), flèche du meilleur coup
// (moteur, si activée), barre d'évaluation (si activée).
function drawBoard() {
  const cur = E.k ? E.path[E.k - 1] : null;
  const p = curEpd();
  const fen = fenOf(p);
  const atFocus = E.focus && p === E.focus.epd;
  const arrows = atFocus && E.focus.best ? [{ from: E.focus.best.slice(0, 2), to: E.focus.best.slice(2, 4), color: 'var(--arrow-best)' }] : [];
  const eng = engHere();
  const best = repOn('repArrow') && eng && eng.res && eng.res.lines && eng.res.lines[0] ? eng.res.lines[0].pv[0] : null;
  if (best && !(atFocus && E.focus.best === best)) arrows.push({ from: best.slice(0, 2), to: best.slice(2, 4), color: 'var(--arrow-best)' });
  E.board.setPosition(fen, { lastMove: cur ? [cur.uci.slice(0, 2), cur.uci.slice(2, 4)] : null, arrows });
  drawBar(fen, eng);
}

function drawBar(fen, eng) {
  const bar = $('#rep-evalbar');
  const on = repOn('repBar');
  bar.classList.toggle('hidden', !on);
  if (!on) return;
  const chess = new Chess(fen);
  const s = eng && eng.res && eng.res.lines && eng.res.lines[0] ? eng.res.lines[0].score : null;
  let wp, label;
  if (chess.isCheckmate()) { wp = chess.turn() === 'w' ? 0 : 100; label = chess.turn() === 'w' ? '0-1' : '1-0'; }
  else if (chess.isDraw()) { wp = 50; label = '½-½'; }
  else { wp = s ? winPct(s, 'w') : 50; label = s ? fmtScore(s) : ''; }
  bar.classList.toggle('flipped', E.board.orientation === 'b');
  bar.querySelector('.white').style.height = wp + '%';
  const lb = bar.querySelector('.label');
  lb.textContent = label;
  lb.className = 'label ' + (wp >= 50 ? 'on-white' : 'on-black');
}

// Coups d'une ligne en figurines, avec les numéros (au plus 8 demi-coups).
function lineHtml(fen, pv) {
  const c = new Chess(fen);
  let out = '';
  pv.slice(0, 8).forEach((u, i) => {
    const turn = c.turn();
    const no = c.fen().split(' ')[5];
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { return; }
    if (turn === 'w') out += `${no}. `;
    else if (i === 0) out += `${no}… `;
    out += figSan(m.san, m.color) + ' ';
  });
  return out.trim() || esc(pv[0]);
}

// Onglet « Stockfish » : meilleurs coups de la position, avec leur évaluation. Un clic joue le coup.
function renderStockfish(body) {
  const fen = fenOf(curEpd());
  if (new Chess(fen).isGameOver()) { body.innerHTML = '<p class="muted pad">Partie terminée à cette position.</p>'; return; }
  const eng = engHere();
  if (!eng) { body.innerHTML = '<p class="muted pad">Calcul en cours…</p>'; return; }
  if (eng.err) { body.innerHTML = `<p class="err pad">Analyse impossible : ${esc(eng.err)}</p>`; return; }
  const lines = eng.res.lines || [];
  if (!lines.length) { body.innerHTML = '<p class="muted pad">Pas d\'analyse disponible pour cette position.</p>'; return; }
  const rows = lines.slice(0, nLines()).map((l) => `<tr data-uci="${esc(l.pv[0])}" role="button" tabindex="0" title="Cliquer pour jouer ce coup sur l'échiquier">
      <td class="emv">${fmtScore(l.score)}</td><td class="smv" colspan="3">${lineHtml(fen, l.pv)}</td></tr>`).join('');
  body.innerHTML = `<table class="exp-table"><tbody>${rows}
    <tr class="etot"><td colspan="4" class="small">${esc(SOURCE_LABEL(eng.res))}</td></tr></tbody></table>`;
  body.querySelectorAll('tr[data-uci]').forEach((tr) => { tr.onclick = () => playMove(tr.dataset.uci); keyActivate(tr); });
}
