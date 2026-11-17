// Module « Ouvertures » — interface : liste des répertoires, création, éditeur sur l'échiquier
// (coups des deux camps, variantes, désactivation et suppression au clic droit ou à l'appui long) et explorateur
// Lichess (Masters / Lichess, filtres d'Elo et de cadence sous la roue dentée).
import { Board } from '../board.js';
import { $, esc, local, toast, keyActivate } from '../core/ui.js';
import { epd } from '../analysis.js';
import { figSan, BOOK, getGames, getUser, engineFields } from './analyse.js';
import * as store from '../core/store.js';
import { frSan, explainOpeningMove } from '../explain.js';
import { lichessCfg, explore, expRatings, expSpeeds } from '../core/lichess.js';
import { analyzePosition, analysisSettings, maxTime, nLines, SOURCE_LABEL, onStatus } from '../core/engine.js';
import {
  newRepertoire, addMove, childrenOf, reachableEdges, deleteMove, fenOf,
  listRepertoires, getRepertoire, saveRepertoire, deleteRepertoire,
  listEvents, computeMastery, masterySummary, scanGames, STATUS, EVT, REP, WINDOW_DAYS, MIN_SITUATIONS, THRESHOLD,
  computeCards, cardsSummary, NEW_PER_DAY,
  findSuggestions, applySuggestion, pathTo, SUGGEST_MIN, importPgn,
} from './openings.js';
import { Chess } from '../vendor/chess.js';
import { coverageOf, cachedCoverage, covN, THRESHOLDS, pct } from './openings-coverage.js';
import { classifyGame, CLASSES, fmtScore, winPct } from '../analysis.js';
import { stashPlay } from './play.js';

const SVG_GEAR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const RATINGS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
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
// Après une modification du répertoire, les parties récentes sont reparcourues (une position
// ajoutée peut avoir déjà été jouée), puis la maîtrise est recalculée.
let rescanTimer = null;
function rescanSoon() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(async () => {
    const n = await scanGames(getGames(), getUser());
    if (!E.rep) return;
    await loadMastery();
    if (n) render();
  }, 1500);
}
// Événements ajoutés (parcours des parties) ou données arrivées d'un autre appareil : on rafraîchit.
let reloadTimer = null;
let homeTimer = null;
store.onChange((info) => {
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
  el.innerHTML = `
  <h1 class="page-title">Ouvertures</h1>
  <div class="row"><button id="rep-new" class="btn primary">+ Nouveau répertoire</button><button id="rep-import" class="btn">Importer un PGN</button></div>
  <div class="rep-list">${reps.length ? reps.map((r) => `
    <a class="card rep-card" href="#/openings/${esc(r.id)}">
      <span class="avatar-sm ${r.color}"><img src="pieces/${r.color}K.svg" alt=""></span>
      <span class="rep-info"><b>${esc(r.name)}</b><span class="muted small">${colorFr(r.color)} · ${plural(reachableEdges(r).length, 'coup')}${dueLabel(r, events, reps)}<span class="cov-mini" data-cov="${esc(r.id)}"></span></span>
        <span class="mst-row small">${summaryHtml(masterySummary(computeMastery(r, events, reps)))}</span></span>
      <button class="btn small danger" data-del="${esc(r.id)}" title="Supprimer ce répertoire">Supprimer</button>
    </a>`).join('') : '<p class="muted">Aucun répertoire pour le moment. Créez-en un, puis jouez vos coups sur l\'échiquier.</p>'}</div>
  ${reps.length ? '<section class="card sugg-box" id="sugg-box"><h2>Suggestions</h2><p class="muted small">Recherche des erreurs répétées dans vos parties analysées…</p></section>' : ''}
  ${reps.length ? trainBox(reps, events) : ''}
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
      <label>Fichier PGN <input id="pgn-file" type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain"></label>
      <label>ou collez le texte <textarea id="pgn-text" rows="6" spellcheck="false" placeholder="1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 3. Bb5 *"></textarea></label>
      <label>Ajouter dans <select id="pgn-target"><option value="">Un nouveau répertoire</option>${reps.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} (${colorFr(r.color)})</option>`).join('')}</select></label>
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
  bindImport(el);
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
function bindImport(el) {
  const dlg = $('#pgn-dlg', el);
  let color = 'w';
  const picks = dlg.querySelectorAll('.side-pick button');
  picks.forEach((b) => { b.onclick = () => { color = b.dataset.c; picks.forEach((x) => x.classList.toggle('on', x === b)); }; });
  const target = $('#pgn-target', el);
  target.onchange = () => $('#pgn-new', el).classList.toggle('hidden', !!target.value);
  $('#rep-import', el).onclick = () => {
    $('#pgn-file', el).value = ''; $('#pgn-text', el).value = ''; $('#pgn-err', el).textContent = '';
    dlg.showModal();
  };
  $('#pgn-go', el).onclick = async (e) => {
    e.preventDefault();
    const err = $('#pgn-err', el);
    let text = $('#pgn-text', el).value;
    const file = $('#pgn-file', el).files[0];
    if (file) {
      if (file.size > 5 * 1048576) { err.textContent = 'Fichier trop gros (5 Mo au maximum).'; return; }
      text = await file.text();
    }
    if (!text.trim()) { err.textContent = 'Choisissez un fichier PGN ou collez le texte.'; return; }
    let rep = target.value ? await getRepertoire(target.value) : null;
    const isNew = !rep;
    if (isNew) rep = newRepertoire({ name: $('#pgn-name', el).value.trim() || (file ? file.name.replace(/\.[^.]+$/, '') : `Répertoire ${colorFr(color)}`), color });
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
async function homeCoverage(el, reps) {
  if (!lichessCfg.connected) return;
  const show = (r, res) => {
    const span = el.querySelector(`[data-cov="${CSS.escape(r.id)}"]`);
    if (span && res && !res.unavailable) span.innerHTML = ` · <span class="cov-bar"><i style="width:${Math.round(res.coverage * 100)}%"></i></span> ${pct(res.coverage)} couvert${res.gaps.length ? `, ${plural(res.gaps.length, 'trou')}` : ''}`;
  };
  for (const r of reps) show(r, cachedCoverage(r));
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
  <section class="card train-box">
    <h2>S'entraîner</h2>
    <div class="train-modes">
      <div class="train-mode due-mode"><h3>À revoir</h3>
        <p class="muted small">Répétition espacée : chaque coup revient juste avant que vous l'oubliiez. <b>${plural(due, 'coup')} à revoir</b>${newLeft ? ` et ${newLeft} nouveau${newLeft > 1 ? 'x' : ''} aujourd'hui` : ''}.</p>
        <div class="row"><select id="train-style" aria-label="Façon de revoir les coups">
            <option value="isolated"${style === 'isolated' ? ' selected' : ''}>Coups isolés</option>
            <option value="lines"${style === 'lines' ? ' selected' : ''}>Lignes complètes</option></select>
          <a class="btn primary${due + newLeft ? '' : ' disabled'}" href="${due + newLeft ? '#/openings/train/due' : '#/openings'}">Commencer</a></div></div>
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
  <div class="left">
    <div class="board-wrap"><div id="rep-evalbar" class="evalbar hidden"><div class="white"></div><span class="label"></span></div><div id="rep-board"></div></div>
    <div class="board-opts"><button id="rep-flip" class="btn small" title="Retourner l'échiquier (F)">⇅ Retourner</button>
      <a id="rep-train" class="btn small primary" title="S'entraîner sur ce répertoire">▶ S'entraîner</a>
      <button id="rep-play" class="btn small" title="Jouer une partie contre Maia à partir de la position affichée, avec la couleur du répertoire">♟ Jouer contre Maia d'ici</button>
      <span class="muted small">Clic droit sur un coup (appui long de 2 s sur téléphone) pour le désactiver ou le supprimer. Votre note sur le coup affiché : sous la liste des coups.</span></div>
  </div>
  <aside class="panel" id="rep-panel">
    <div class="phead">
      <a href="#/openings" class="icon-btn" title="Retour aux répertoires" aria-label="Retour"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle" id="rep-title"></span>
    </div>
    <div class="popening" id="rep-opening"></div>
    <div id="rep-suggest" class="rsugg hidden"></div>
    <div id="rep-coverage"></div>
    <div id="rep-mastery"></div>
    <div class="pmoves rtree" id="rep-moves"></div>
    <div id="rep-note"></div>
    <div class="exp">
      <div class="exp-head">
        <div class="exp-tabs" role="tablist"><button type="button" role="tab" data-db="masters">Masters</button><button type="button" role="tab" data-db="lichess">Lichess</button><button type="button" role="tab" data-db="stockfish">Stockfish</button></div>
        <button id="exp-gear" class="icon-btn" title="Paramètres : filtres Lichess, interface, moteur" aria-label="Paramètres">${SVG_GEAR}</button>
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
    <h2>Paramètres</h2>
    <div class="dtabs" role="tablist">
      <button type="button" role="tab" data-pane="lichess" class="on">Filtres Lichess</button>
      <button type="button" role="tab" data-pane="ui">Interface</button>
      <button type="button" role="tab" data-pane="eng">Moteur</button>
    </div>
    <div data-epane="lichess">
      <fieldset id="exp-ratings"><legend>Elo moyen des joueurs</legend><div class="chk-grid">${RATINGS.map((r, i) => `<label><input type="checkbox" value="${r}"> ${r === 0 ? 'moins de 1000' : r === 2500 ? '2500 et plus' : `${r} – ${RATINGS[i + 1] - 1}`}</label>`).join('')}</div></fieldset>
      <fieldset id="exp-speeds"><legend>Cadences</legend><div class="chk-grid">${SPEEDS.map(([k, l]) => `<label><input type="checkbox" value="${k}"> ${l}</label>`).join('')}</div></fieldset>
      <p class="muted small">Ces filtres ne concernent que l'onglet « Lichess ». La base Masters regroupe les parties de joueurs titrés et de plus de 2200 Elo.</p>
    </div>
    <div data-epane="ui" class="hidden">
      <div class="frow"><label for="rep-arrow">Meilleur coup (flèche verte)</label><select id="rep-arrow"><option value="1">Activé</option><option value="0">Désactivé</option></select></div>
      <div class="frow"><label for="rep-bar">Barre d'évaluation</label><select id="rep-bar"><option value="1">Activée</option><option value="0">Désactivée</option></select></div>
      <div class="frow"><label for="rep-cov">Couverture : préparer les positions vues dans</label><select id="rep-cov">${THRESHOLDS.map((n) => `<option value="${n}">1 partie sur ${n}</option>`).join('')}</select></div>
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
  $('#rep-play', el).onclick = () => {
    if (!E.rep) return;
    stashPlay({ fen: E.rep.root, ucis: E.path.slice(0, E.k).map((e) => e.uci), user: E.rep.color, label: E.rep.name });
    location.hash = '#/play';
  };
  $('#rep-first', el).onclick = () => go(0);
  $('#rep-prev', el).onclick = () => go(E.k - 1);
  $('#rep-next', el).onclick = () => forward();
  $('#rep-last', el).onclick = () => { while (forward(false)); render(); };
  el.querySelectorAll('.exp-tabs button').forEach((b) => { b.onclick = () => { E.db = b.dataset.db; local.set('expDb', E.db); updateEngine(); renderExplorer(); }; });

  // Paramètres (roue dentée) : trois onglets. « Appliquer » enregistre tout ; le moteur est celui de l'analyse.
  const dlg = $('#exp-dlg', el);
  enterIsPrimary(dlg);
  let pane = 'lichess', engF = null;
  const showPane = (t) => {
    pane = t;
    dlg.querySelectorAll('.dtabs button').forEach((b) => b.classList.toggle('on', b.dataset.pane === t));
    dlg.querySelectorAll('[data-epane]').forEach((p) => p.classList.toggle('hidden', p.dataset.epane !== t));
  };
  dlg.querySelectorAll('.dtabs button').forEach((b) => { b.onclick = () => showPane(b.dataset.pane); });
  $('#exp-gear', el).onclick = () => {
    const rs = expRatings(), ss = expSpeeds();
    dlg.querySelectorAll('#exp-ratings input').forEach((i) => { i.checked = rs.includes(+i.value); });
    dlg.querySelectorAll('#exp-speeds input').forEach((i) => { i.checked = ss.includes(i.value); });
    $('#rep-arrow', el).value = repOn('repArrow') ? '1' : '0';
    $('#rep-bar', el).value = repOn('repBar') ? '1' : '0';
    $('#rep-cov', el).value = String(covN());
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
  E.rep = rep;
  // ouverture depuis une suggestion : on se place sur la position à enrichir
  if (E.focus && E.focus.repId === rep.id) {
    const p = pathTo(rep, rep.root, E.focus.epd);
    if (p) { E.path = p; E.k = p.length; } else E.focus = null;
  } else E.focus = null;
  await loadMastery();
  render();
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
  dlg.innerHTML = `<form method="dialog">
    <h2>${esc(label)}</h2>
    <p class="muted small">${edge.disabled
      ? 'Ce coup est désactivé : il reste dans le répertoire, mais n\'est ni entraîné ni compté dans la maîtrise, pas plus que la suite qui en dépend.'
      : 'Désactiver garde le coup dans le répertoire sans l\'entraîner ni le compter dans la maîtrise (la suite qui en dépend aussi).'}</p>
    <div class="row end"><button value="cancel" class="btn">Annuler</button>
      <button value="toggle" class="btn">${edge.disabled ? 'Réactiver' : 'Désactiver'}</button>
      <button value="delete" class="btn danger">Supprimer…</button></div></form>`;
  dlg.onclose = async () => {
    if (dlg.returnValue === 'toggle') await toggleMove(edge, label);
    else if (dlg.returnValue === 'delete') await deleteNode(n);
  };
  dlg.returnValue = '';
  dlg.showModal();
  dlg.querySelector('button[value="toggle"]').focus();
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
  if (!confirm(more ? `Supprimer ${label} et ${plural(more, 'coup')} qui en ${more > 1 ? 'dépendent' : 'dépend'} ?` : `Supprimer ${label} ?`)) return;
  deleteMove(E.rep, edge.fenBefore, edge.uci);
  const left = new Set(E.rep.edges);
  const cut = E.path.findIndex((e) => !left.has(e));
  if (cut >= 0) { E.path = E.path.slice(0, cut); E.k = Math.min(E.k, cut); }
  await saveRepertoire(E.rep);
  render();
  rescanSoon();
  toast(more ? `${label} et ${plural(more, 'coup')} supprimés.` : `${label} supprimé.`);
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
      ${gaps.length ? '<button type="button" class="btn small" id="cov-go">Aller au plus gros trou</button>' : ''}</div>
    ${gaps.length ? `<details class="cov-gaps"><summary class="small">${plural(res.gaps.length, 'trou')}, les plus fréquents</summary><ol>${gaps.map((g, i) => `<li><button type="button" class="link" data-gap="${i}">${gapLine(g)}</button></li>`).join('')}</ol></details>` : '<div class="muted small">Aucun trou au-dessus du seuil.</div>'}`;
  const goBtn = $('#cov-go', box);
  if (goBtn) goBtn.onclick = () => goToGap(gaps[0]);
  box.querySelectorAll('[data-gap]').forEach((b) => { b.onclick = () => goToGap(gaps[+b.dataset.gap]); });
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
function renderMastery() {
  const s = masterySummary(E.mastery);
  const cur = E.k ? E.path[E.k - 1] : null;
  const m = cur && cur.fenBefore.split(' ')[1] === E.rep.color ? E.mastery.get(cur.fenBefore) : null;
  const detail = m ? `<div class="mst-cur small"><b>${moveLabel(cur, E.k - 1)}${figSan(cur.san, E.rep.color)}</b> · ${esc(masteryTip(m).replace('Maîtrise : ', ''))}</div>` : '';
  $('#rep-mastery').innerHTML = s.positions
    ? `<div class="mst-row">${summaryHtml(s)}</div>${detail}<div class="muted small">Vos coups (soulignés), sur ${WINDOW_DAYS} jours de parties chess.com et d'entraînement : maîtrisé dès ${MIN_SITUATIONS} situations avec au moins ${Math.round(THRESHOLD * 100)} % de bonnes réponses. Cliquez sur un de vos coups pour le détail.</div>`
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

function renderTree() {
  const el = $('#rep-moves');
  const rep = E.rep;
  E.nodes = [];
  // Chaque position n'est développée qu'une fois (ligne principale d'abord) ; ailleurs, « transposition ».
  const owner = new Map([[epd(rep.root), null]]);
  (function own(p) { for (const e of childrenOf(rep, p)) if (!owner.has(e.fenAfter)) { owner.set(e.fenAfter, e); own(e.fenAfter); } })(epd(rep.root));
  const cur = E.k ? E.path[E.k - 1] : null;
  const active = new Set(reachableEdges(rep, true)); // coups entraînés (hors coups désactivés et leur suite)
  // vrai si prefix est le début de la ligne suivie (pour ne surligner que celle-ci)
  const onLine = (prefix) => prefix.length < E.k && prefix.every((e, i) => E.path[i] === e);
  let count = 0;
  const mv = (e, ply, prefix, forceNum) => {
    const n = E.nodes.push([...prefix, e]) - 1;
    const white = e.fenBefore.split(' ')[1] === 'w';
    const num = white || forceNum ? `<span class="rnum">${moveLabel(e, ply)}</span>` : '';
    const m = e.fenBefore.split(' ')[1] === rep.color ? E.mastery.get(e.fenBefore) : null;
    const off = !active.has(e);
    let cls = m && !off ? ` mine st-${m.status}` : off && e.fenBefore.split(' ')[1] === rep.color ? ' mine' : '';
    if (off) cls += ' off';
    if (onLine(prefix) && E.path[prefix.length] === e) cls += e === cur && prefix.length === E.k - 1 ? ' cur' : ' onpath';
    const tip = off ? ` title="${e.disabled ? 'Coup désactivé' : 'Suite d\'un coup désactivé'} : ni entraîné ni compté dans la maîtrise"`
      : m ? ` title="${esc(masteryTip(m))}"` : '';
    const note = e.note ? `<span class="rnote" title="${esc(e.note)}" aria-label="Note">✎</span>` : '';
    return `${num}<span class="rm${cls}" role="button" tabindex="0" data-n="${n}"${tip}>${figSan(e.san, white ? 'w' : 'b')}${note}</span> `;
  };
  const cont = (e, ply, prefix, forceNum) => {
    if (owner.get(e.fenAfter) !== e) return '<span class="rtrans" title="Cette position est déjà dans le répertoire par un autre ordre de coups">↪ transposition</span> ';
    return line(e.fenAfter, ply + 1, [...prefix, e], forceNum);
  };
  function line(p, ply, prefix, forceNum) {
    const kids = childrenOf(rep, p);
    if (!kids.length || ++count > 5000) return '';
    const [main, ...alts] = kids;
    let html = mv(main, ply, prefix, forceNum);
    for (const a of alts) html += `<div class="rvar">${mv(a, ply, prefix, true)}${cont(a, ply, prefix, false)}</div>`;
    return html + cont(main, ply, prefix, alts.length > 0);
  }
  const html = line(epd(rep.root), 0, [], rep.root.split(' ')[1] === 'b');
  el.innerHTML = html ? `<div class="rline">${html}</div>`
    : '<p class="muted pad">Jouez un premier coup sur l\'échiquier, ou cliquez sur un coup de l\'explorateur ci-dessous.</p>';
  const c = el.querySelector('.rm.cur');
  if (c) {
    const top = c.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 30) el.scrollTop = top - el.clientHeight / 2;
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

async function renderExplorer() {
  const body = $('#exp-body');
  document.querySelectorAll('.exp-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.db === E.db));
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
  if (E.k && j.opening && j.opening.name && !openingName()) $('#rep-opening').textContent = j.opening.name;
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

function render() {
  if (!E.rep) return;
  const atFocus = E.focus && curEpd() === E.focus.epd;
  drawBoard();
  const sg = $('#rep-suggest');
  if (atFocus && !childrenOf(E.rep, curEpd()).length) {
    const played = [...new Set(E.focus.errors.map((e) => frSan(e.san)))].join(', ');
    sg.innerHTML = `💡 <b>Position à enrichir.</b> Vous y avez fait ${plural(E.focus.errors.length, 'faute')} (vous avez joué ${esc(played)}).`
      + `${E.focus.best ? ` La flèche verte montre le meilleur coup selon l'analyse : <b>${esc(frSan(uciToSan(curEpd(), E.focus.best)))}</b>.` : ''} Jouez sur l'échiquier le coup à ajouter, ou choisissez-le dans l'explorateur.`;
    sg.classList.remove('hidden');
  } else if (E.gap && curEpd() === E.gap.epd && !childrenOf(E.rep, curEpd()).length) {
    sg.innerHTML = `🕳️ <b>Trou dans le répertoire</b> : cette position arrive dans ${pct(E.gap.p)} de vos parties (à votre niveau) et vous n'y avez pas de coup. Jouez votre réponse sur l'échiquier, ou choisissez-la dans l'explorateur.`;
    sg.classList.remove('hidden');
  } else {
    if (E.focus && !atFocus && E.k > 0 && childrenOf(E.rep, E.focus.epd).length) E.focus = null; // coup ajouté : suggestion traitée
    if (E.gap && childrenOf(E.rep, E.gap.epd).length) E.gap = null; // trou bouché
    sg.classList.add('hidden');
  }
  $('#rep-train').href = '#/openings/train/rep/' + encodeURIComponent(E.rep.id);
  $('#rep-title').innerHTML =`<span class="avatar-sm ${E.rep.color}"><img src="pieces/${E.rep.color}K.svg" alt=""></span>${esc(E.rep.name)}`;
  $('#rep-opening').textContent = E.k === 0 ? 'Position de départ' : openingName() || 'Ouverture inconnue';
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
  const arrows = atFocus && E.focus.best ? [{ from: E.focus.best.slice(0, 2), to: E.focus.best.slice(2, 4), color: '#4caf50' }] : [];
  const eng = engHere();
  const best = repOn('repArrow') && eng && eng.res && eng.res.lines && eng.res.lines[0] ? eng.res.lines[0].pv[0] : null;
  if (best && !(atFocus && E.focus.best === best)) arrows.push({ from: best.slice(0, 2), to: best.slice(2, 4), color: '#4caf50' });
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
