// Module « Étude » — interface façon Lichess : liste des études, puis atelier à trois colonnes
// (chapitres, échiquier, arbre des coups avec moteur). Sous l'échiquier : commentaire, symboles,
// dessin, en-têtes PGN et partage. Le modèle est dans study-model.js et core/study-pgn.js.
import { Board } from '../board.js';
import { $, $$, esc, local, toast } from '../core/ui.js';
import { winPct, fmtScore } from '../analysis.js';
import { figSan, stashFree } from './analyse.js';
import { frSan } from '../explain.js';
import { miniBoard } from './setup.js';
import { studyPgn } from '../core/lichess.js';
import { analyzePosition, analysisSettings, maxTime, nLines, onStatus } from '../core/engine.js';
import { fmtAgo } from '../core/format.js';
import * as store from '../core/store.js';
import { Chess, validateFen } from '../vendor/chess.js';
import {
  START_FEN, BRUSHES, GLYPHS, MANAGED_TAGS, glyphOf, toggleGlyph, toggleShape, chessAt, parsePgn, chapterToPgn, studyToPgn,
  addChild, removeNode, promote, makeMainline, isMainline, pathOf, keyOf, nodeAt,
} from '../core/study-pgn.js';
import {
  STUDY, CHAPTER, listStudies, getStudy, createStudy, addChapters, saveStudy, saveChapter, removeChapter, removeStudy,
  emptyChapter, openChapter,
} from './study-model.js';

const plural = (n, s) => `${n} ${s}${n > 1 ? 's' : ''}`;
const MAX_FILE = 5 * 1048576;
const SAVE_DELAY = 600;
const LONG_PRESS = 500;
const BRUSH_FR = { G: 'Vert', R: 'Rouge', B: 'Bleu', Y: 'Jaune' };
const GLYPH_GROUPS = [['move', 'Coup'], ['position', 'Évaluation'], ['observation', 'Remarque']];
// Couleur du symbole de coup dans la liste (mêmes familles que Lichess).
const GLYPH_CLASS = { 1: 'g-good', 2: 'g-mistake', 3: 'g-brilliant', 4: 'g-blunder', 5: 'g-interesting', 6: 'g-dubious' };
const TAGS = [['White', 'Blancs'], ['WhiteElo', 'Elo des Blancs'], ['Black', 'Noirs'], ['BlackElo', 'Elo des Noirs'], ['Tournament', 'Tournoi'], ['Site', 'Lieu'], ['Date', 'Date'], ['Result', 'Résultat'], ['ECO', 'ECO'], ['Opening', 'Ouverture'], ['Annotator', 'Annotateur']];

const ICON = {
  gear: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  first: '<svg viewBox="0 0 24 24"><path d="M6 5v14M18 5l-8 7 8 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  last: '<svg viewBox="0 0 24 24"><path d="M18 5v14M6 5l8 7-8 7"/></svg>',
};

// État de l'atelier. node : coup affiché (la racine = position de départ) ; line : fin de la ligne suivie.
const S = { study: null, chapter: null, ch: null, node: null, nodes: [], board: null, dirty: false, timer: null, tool: null, brush: null, eng: null, engPending: null, engTimer: null, seq: 0 };

// ------------------------------------------------------------------ enregistrement
function touch() {
  S.dirty = true;
  clearTimeout(S.timer);
  S.timer = setTimeout(flush, SAVE_DELAY);
}
// Écrit le chapitre ouvert s'il a changé. Tout est capturé avant la première attente : on peut
// changer de chapitre pendant l'écriture.
function flush() {
  clearTimeout(S.timer);
  if (!S.dirty || !S.ch || !S.chapter) return Promise.resolve();
  S.dirty = false;
  const rec = S.chapter;
  rec.name = S.ch.name;
  rec.orientation = S.ch.orientation;
  rec.pgn = chapterToPgn(S.ch, S.study.name);
  return saveChapter(rec).catch((e) => toast('Enregistrement impossible : ' + esc(e.message)));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', () => { flush(); });

export function leave() {
  if (!S.study) return;
  flush();
  closeMenu();
  S.study = S.chapter = S.ch = null;
  S.engPending = null; S.eng = null; S.seq++;
  clearTimeout(S.engTimer);
}

// Données arrivées d'un autre appareil : on recharge, sauf si une modification attend d'être écrite.
let reloadTimer = null;
store.onChange((info) => {
  if (!info.remote || (info.col !== STUDY && info.col !== CHAPTER)) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (document.body.dataset.view === 'studies') renderHome($('#studies-view'));
    else if (document.body.dataset.view === 'study' && S.study && !S.dirty) {
      const key = keyOf(S.node);
      await load($('#study-view'), S.study.id, S.chapter.id, key);
    }
  }, 500);
});

// ------------------------------------------------------------------ fenêtres
function dialog(id, html) {
  let dlg = $('#' + id);
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = id; dlg.className = 'dlg st-dlg'; document.body.appendChild(dlg); }
  dlg.innerHTML = html;
  dlg.onclose = null;
  dlg.returnValue = '';
  // Entrée dans un champ = bouton principal (sinon le formulaire prendrait « Annuler »).
  dlg.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const b = dlg.querySelector('.btn.primary');
    if (b) b.click();
  };
  return dlg;
}

// Champ « source PGN » : fichier, lien d'étude Lichess ou texte. read() renvoie
// { text, name } ; lève une erreur au message affichable.
function pgnSource(prefix) {
  const tab = (k, label, on) => `<button type="button" class="chip" role="tab" data-src="${k}" aria-selected="${on}">${label}</button>`;
  const html = `<div class="segctl st-srctabs" role="tablist" aria-label="Source du PGN">${tab('file', 'Fichier', true)}${tab('study', 'Lien Lichess', false)}${tab('text', 'Texte', false)}</div>
    <div class="form st-form" data-pane="file"><label>Fichier PGN <input id="${prefix}-file" type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain"></label></div>
    <div class="form st-form hidden" data-pane="study"><label>Lien de l’étude Lichess <input id="${prefix}-link" placeholder="https://lichess.org/study/…" autocomplete="off" spellcheck="false"></label></div>
    <div class="form st-form hidden" data-pane="text"><label>Texte du PGN <textarea id="${prefix}-text" rows="6" spellcheck="false" placeholder="1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 *"></textarea></label></div>`;
  let src = 'file';
  const bind = (root, onChange) => {
    const tabs = $$('.st-srctabs [data-src]', root);
    tabs.forEach((b) => { b.onclick = () => {
      src = b.dataset.src;
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $$('[data-pane]', root).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== src));
      onChange();
    }; });
    $(`#${prefix}-file`, root).onchange = onChange;
    $(`#${prefix}-link`, root).onchange = onChange;
    let t = null;
    $(`#${prefix}-text`, root).oninput = () => { clearTimeout(t); t = setTimeout(onChange, 300); };
  };
  let cached = null;
  const read = async (root) => {
    if (src === 'text') return { text: $(`#${prefix}-text`, root).value, name: '' };
    if (src === 'file') {
      const f = $(`#${prefix}-file`, root).files[0];
      if (!f) return { text: '', name: '' };
      if (f.size > MAX_FILE) throw new Error('Fichier trop gros (5 Mo au maximum)');
      return { text: await f.text(), name: f.name.replace(/\.[^.]+$/, '') };
    }
    const link = $(`#${prefix}-link`, root).value.trim();
    if (!link) return { text: '', name: '' };
    if (!cached || cached.link !== link) cached = { link, text: await studyPgn(link) };
    return { text: cached.text, name: '' };
  };
  return { html, bind, read };
}

// Lit la source et affiche ce qui sera importé ; renvoie une fonction qui donne le dernier résultat.
function previewPgn(root, source, status, goBtn, onResult) {
  let result = null, seq = 0;
  const refresh = async () => {
    const my = ++seq;
    result = null; goBtn.disabled = true;
    status.className = 'small muted'; status.textContent = 'Lecture…';
    let r;
    try { r = await source.read(root); } catch (e) { if (my === seq) { status.className = 'small err'; status.textContent = e.message + '.'; } return; }
    if (my !== seq) return;
    if (!r.text.trim()) { status.textContent = ''; return; }
    const parsed = parsePgn(r.text);
    if (!parsed.chapters.length) { status.className = 'small err'; status.textContent = 'Aucun chapitre lisible dans ce PGN.'; return; }
    result = { ...parsed, fileName: r.name };
    goBtn.disabled = false;
    status.className = 'small';
    const bad = [];
    if (parsed.skipped) bad.push(`${plural(parsed.skipped, 'partie')} illisible${parsed.skipped > 1 ? 's' : ''}, ignorée${parsed.skipped > 1 ? 's' : ''}`);
    if (parsed.errors.length) bad.push(`ligne interrompue au coup illisible : ${parsed.errors.join(', ')}`);
    status.textContent = `✓ ${parsed.studyName ? `« ${parsed.studyName} » · ` : ''}${plural(parsed.chapters.length, 'chapitre')}${bad.length ? ' · ' + bad.join(' · ') : ''}`;
    if (onResult) onResult(result);
  };
  return { refresh, get: () => result };
}

// ------------------------------------------------------------------ liste des études
export async function renderHome(el) {
  const studies = await listStudies();
  const card = (s) => {
    const first = s.chapters[0];
    const fen = first ? (/\[FEN "([^"]+)"\]/.exec(first.pgn) || [])[1] || START_FEN : START_FEN;
    return `<li class="card st-card" data-search="${esc((s.name + ' ' + s.chapters.map((c) => c.name).join(' ')).toLowerCase())}">
      <a href="#/study/${encodeURIComponent(s.id)}">
        ${miniBoard(fen.split(' ')[0], 112, { orient: first ? first.orientation : 'w' })}
        <span class="st-cardtxt"><b title="${esc(s.name)}">${esc(s.name)}</b>
          <span class="muted small">${plural(s.chapters.length, 'chapitre')} · ${esc(fmtAgo(new Date(s.updatedAt)))}</span>
          <span class="st-cardchaps">${s.chapters.slice(0, 4).map((c) => `<span>${esc(c.name)}</span>`).join('')}</span></span>
      </a></li>`;
  };
  el.innerHTML = `
  <header class="op-head">
    <div><h1 class="page-title">Étude</h1><p class="op-sub muted">${studies.length ? `${plural(studies.length, 'étude')}` : 'Créez une étude de zéro ou importez un PGN.'}</p></div>
    <div class="row"><button type="button" id="st-import" class="btn">Importer un PGN</button><button type="button" id="st-new" class="btn primary">+ Nouvelle étude</button></div>
  </header>
  ${studies.length > 3 ? '<input id="st-search" class="st-search" type="search" placeholder="Rechercher une étude ou un chapitre" aria-label="Rechercher une étude ou un chapitre" autocomplete="off">' : ''}
  ${studies.length ? `<ul class="st-grid">${studies.map(card).join('')}</ul>` : '<p class="card muted">Aucune étude pour le moment.</p>'}`;
  $('#st-new', el).onclick = newStudyDialog;
  $('#st-import', el).onclick = importDialog;
  const search = $('#st-search', el);
  if (search) search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    $$('.st-card', el).forEach((c) => c.classList.toggle('hidden', !!q && !c.dataset.search.includes(q)));
  };
}

const sideSelect = (id, value = 'w') => `<label>Orientation <select id="${id}"><option value="w"${value === 'w' ? ' selected' : ''}>Blancs en bas</option><option value="b"${value === 'b' ? ' selected' : ''}>Noirs en bas</option></select></label>`;

function newStudyDialog() {
  const dlg = dialog('st-new-dlg', `<form method="dialog"><h2>Nouvelle étude</h2>
    <div class="form st-form"><label>Nom de l’étude <input id="sn-name" maxlength="100" placeholder="ex. Mes finales de tours" autocomplete="off"></label>
      <label>Nom du premier chapitre <input id="sn-chap" maxlength="80" placeholder="Chapitre 1" autocomplete="off"></label>
      ${sideSelect('sn-side')}</div>
    <p class="muted small">Pour partir d’une position précise ou d’un PGN, ajoutez ensuite un chapitre.</p>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button value="ok" class="btn primary">Créer</button></div></form>`);
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const study = await createStudy($('#sn-name', dlg).value, [emptyChapter($('#sn-chap', dlg).value.trim() || 'Chapitre 1', { orientation: $('#sn-side', dlg).value })]);
    location.hash = '#/study/' + study.id;
  };
  dlg.showModal();
  $('#sn-name', dlg).focus();
}

function importDialog() {
  const source = pgnSource('si');
  const dlg = dialog('st-import-dlg', `<form method="dialog"><h2>Importer une étude</h2>
    <p class="muted small">Chaque partie du PGN devient un chapitre, avec ses variantes, commentaires, symboles et flèches.</p>
    ${source.html}
    <p id="si-status" class="small muted" role="status"></p>
    <div class="form st-form"><label>Nom de l’étude <input id="si-name" maxlength="100" autocomplete="off" placeholder="Repris du PGN si possible"></label></div>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button type="button" id="si-go" class="btn primary" disabled>Importer</button></div></form>`);
  let typed = false;
  const name = $('#si-name', dlg), go = $('#si-go', dlg);
  name.oninput = () => { typed = !!name.value; };
  const pv = previewPgn(dlg, source, $('#si-status', dlg), go, (r) => { if (!typed) name.value = r.studyName || r.fileName || r.chapters[0].name; });
  source.bind(dlg, pv.refresh);
  go.onclick = async () => {
    const r = pv.get();
    if (!r) return;
    go.disabled = true;
    try {
      const study = await createStudy(name.value || 'Étude importée', r.chapters);
      dlg.close();
      toast(`${plural(r.chapters.length, 'chapitre')} importé${r.chapters.length > 1 ? 's' : ''}.`);
      location.hash = '#/study/' + study.id;
    } catch (e) { go.disabled = false; toast('Import impossible : ' + esc(e.message)); }
  };
  dlg.showModal();
}

// ------------------------------------------------------------------ atelier
function build(el) {
  el.innerHTML = `
  <h1 class="sr-only">Étude</h1>
  <aside class="st-side" aria-label="Chapitres">
    <div class="st-sidehead">
      <a href="#/study" class="icon-btn" title="Toutes les études" aria-label="Toutes les études">${ICON.back}</a>
      <h2 id="st-title"></h2>
      <button type="button" id="st-settings" class="icon-btn" title="Réglages de l’étude" aria-label="Réglages de l’étude">${ICON.gear}</button>
    </div>
    <div class="st-count" id="st-count"></div>
    <ol id="st-chapters"></ol>
    <button type="button" id="st-addchap" class="st-addchap">＋ Ajouter un chapitre</button>
  </aside>
  <div class="st-center">
    <div class="st-player" id="st-top"></div>
    <div class="board-wrap"><div id="st-evalbar" class="evalbar hidden"><div class="white"></div><span class="label"></span></div><div id="st-board"></div></div>
    <div class="st-player" id="st-bottom"></div>
    <div class="st-tools" role="toolbar" aria-label="Outils de l’étude">
      ${[['comment', '💬', 'Commentaire'], ['glyphs', '!?', 'Annoter'], ['draw', '✎', 'Dessiner'], ['tags', '🏷', 'Infos PGN'], ['share', '⇪', 'Partager']]
        .map(([k, i, t]) => `<button type="button" data-tool="${k}" aria-pressed="false" aria-controls="st-under"><span aria-hidden="true">${i}</span><span>${t}</span></button>`).join('')}
    </div>
    <div id="st-under" class="st-under"></div>
  </div>
  <aside class="panel" id="st-panel" aria-label="Coups">
    <div class="st-eng">
      <label class="switch" title="Analyse du moteur (L)"><input type="checkbox" id="st-live" aria-label="Analyse du moteur"><span></span></label>
      <b id="st-score"></b><span class="muted small" id="st-engdesc">Analyse du moteur</span>
      <a class="small" href="#/settings/engine">Réglages</a>
    </div>
    <div id="st-lines" class="st-lines hidden"></div>
    <div class="st-chaphead"><span id="st-chapname"></span><button type="button" id="st-flip" class="btn small" title="Retourner l’échiquier (F)">⇅</button></div>
    <div class="pmoves st-tree" id="st-tree" tabindex="0" role="region" aria-label="Arbre des coups"></div>
    <div id="st-forks" class="st-forks"></div>
    <div class="st-actions">
      <button type="button" id="st-promote" class="btn small" title="Remonter cette variante d’un rang">↑ Promouvoir</button>
      <button type="button" id="st-main" class="btn small" title="Faire de cette variante la ligne principale">Ligne principale</button>
      <button type="button" id="st-delete" class="btn small danger" title="Supprimer ce coup et la suite (Suppr)">Supprimer</button>
    </div>
    <div class="navbar">
      <button type="button" id="st-first" class="btn" title="Début (↑)" aria-label="Début">${ICON.first}</button>
      <button type="button" id="st-prev" class="btn" title="Coup précédent (←)" aria-label="Coup précédent">${ICON.prev}</button>
      <button type="button" id="st-next" class="btn" title="Coup suivant (→)" aria-label="Coup suivant">${ICON.next}</button>
      <button type="button" id="st-last" class="btn" title="Fin de la ligne (↓)" aria-label="Fin de la ligne">${ICON.last}</button>
    </div>
  </aside>`;

  S.board = new Board($('#st-board', el), {
    freePlay: true,
    onMove: (from, to, promo) => play(from + to + (promo || '')),
    onShape: (brush, from, to) => { toggleShape(S.node, brush, from, to); touch(); drawBoard(); if (S.tool === 'draw') renderTool(); },
  });
  $('#st-first', el).onclick = () => select(S.ch.root);
  $('#st-prev', el).onclick = () => back();
  $('#st-next', el).onclick = () => forward();
  $('#st-last', el).onclick = () => toEnd();
  $('#st-flip', el).onclick = () => { S.board.flip(); renderPlayers(); drawBoard(); };
  $('#st-promote', el).onclick = () => edit(() => promote(S.node));
  $('#st-main', el).onclick = () => edit(() => makeMainline(S.node));
  $('#st-delete', el).onclick = () => remove(S.node);
  $('#st-addchap', el).onclick = addChapterDialog;
  $('#st-settings', el).onclick = studyDialog;
  $('#st-chapters', el).onclick = (e) => {
    const gear = e.target.closest('[data-edit]');
    if (gear) { chapterDialog(gear.dataset.edit); return; }
    const b = e.target.closest('[data-chapter]');
    if (b) goChapter(b.dataset.chapter);
  };
  $$('[data-tool]', el).forEach((b) => { b.onclick = () => openTool(S.tool === b.dataset.tool ? null : b.dataset.tool); });
  const live = $('#st-live', el);
  live.checked = local.get('studyEng') === '1';
  live.onchange = () => { local.set('studyEng', live.checked ? '1' : '0'); updateEngine(); drawBoard(); renderEngine(); };
  $('#st-lines', el).onclick = (e) => { const b = e.target.closest('[data-uci]'); if (b) play(b.dataset.uci); };
  bindTree($('#st-tree', el));
  onStatus(() => { if (S.study) { S.eng = null; S.engPending = null; updateEngine(); drawBoard(); renderEngine(); } });
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (document.body.dataset.view !== 'study' || !S.ch || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') { closeMenu(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key;
  if (k === 'ArrowLeft') back();
  else if (k === 'ArrowRight') forward();
  else if (k === 'ArrowUp' || k === 'Home') select(S.ch.root);
  else if (k === 'ArrowDown' || k === 'End') toEnd();
  else if (k === 'f') $('#st-flip').click();
  else if (k === 'l') $('#st-live').click();
  else if (k === 'c') { openTool('comment'); const t = $('#st-comment'); if (t) t.focus(); }
  else if (k === 'Delete' && S.node.parent) remove(S.node);
  else return;
  e.preventDefault();
}

async function load(el, studyId, chapterId, key = null) {
  const seq = ++S.seq;
  const study = await getStudy(studyId);
  if (seq !== S.seq) return;
  if (!study) { toast('Étude introuvable.'); location.hash = '#/study'; return; }
  const lastKey = 'studyLast:' + study.id;
  const wanted = chapterId || local.get(lastKey);
  const rec = study.chapters.find((c) => c.id === wanted) || study.chapters[0] || null;
  S.study = study;
  if (!rec) { // étude vide (tous les chapitres supprimés ailleurs) : on en recrée un
    await addChapters(study, [emptyChapter('Chapitre 1')]);
    return load(el, studyId, null);
  }
  const same = S.chapter && S.chapter.id === rec.id && key !== null;
  S.chapter = rec;
  S.ch = openChapter(rec);
  S.node = same ? nodeAt(S.ch.root, key) : S.ch.root;
  S.dirty = false;
  local.set(lastKey, rec.id);
  S.board.setOrientation(S.ch.orientation);
  renderAll();
}

export async function openStudy(el, sub) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  const [studyId, chapterId] = sub.split('/').map(decodeURIComponent);
  await flush();
  closeMenu();
  await load(el, studyId, chapterId || null);
}

function goChapter(id) { location.hash = `#/study/${encodeURIComponent(S.study.id)}/${encodeURIComponent(id)}`; }

// ------------------------------------------------------------------ navigation et édition
function select(node) {
  S.node = node;
  markCurrent();
  updateEngine();
  drawBoard();
  renderEngine();
  renderForks();
  renderActions();
  renderTool();
}
const back = () => { if (S.node.parent) select(S.node.parent); };
const forward = () => { if (S.node.children[0]) select(S.node.children[0]); };
function toEnd() { let n = S.node; while (n.children[0]) n = n.children[0]; select(n); }

function play(uci) {
  const had = S.node.children.length;
  const node = addChild(S.node, uci);
  if (!node) { drawBoard(); return; }
  if (S.node.children.length !== had) { touch(); S.node = node; renderTree(); select(node); } else select(node);
}

function edit(change) {
  if (!change()) return;
  touch();
  renderTree();
  select(S.node);
}

function remove(node) {
  if (!node.parent) return;
  const ch = S.ch, parent = node.parent;
  const shown = pathOf(S.node).includes(node);
  const index = removeNode(node);
  if (shown) S.node = parent;
  touch(); renderTree(); select(S.node);
  toast(`${esc(label(node))} et la suite supprimés.`, {
    type: 'info',
    action: { label: 'Annuler', fn: () => {
      if (S.ch !== ch) { toast('Annulation impossible : ce chapitre n’est plus ouvert.', { type: 'err' }); return; }
      if (parent.children.some((x) => x.uci === node.uci) || (parent.parent && !pathOf(parent).every((n) => n.parent.children.includes(n)))) { toast('Annulation impossible : le chapitre a changé depuis.', { type: 'err' }); return; }
      parent.children.splice(index, 0, node);
      touch(); renderTree(); select(node);
    } },
  });
}

const moveNo = (node) => { const f = node.parent.fen.split(' '); return `${f[5]}${f[1] === 'w' ? '.' : '…'}`; };
const glyphText = (node) => node.nags.map((n) => glyphOf(n)?.sym || '').filter(Boolean);
const label = (node) => `${moveNo(node)}${frSan(node.san)}`;

// ------------------------------------------------------------------ rendu
function renderAll() {
  $('#st-title').textContent = S.study.name;
  $('#st-title').title = S.study.name;
  $('#st-chapname').textContent = S.ch.name;
  renderChapters();
  renderPlayers();
  renderTree();
  if (S.tool === null && !S.toolClosed && matchMedia('(min-width: 761px)').matches) S.tool = 'comment';
  openTool(S.tool);
  select(S.node);
}

function renderChapters() {
  const list = S.study.chapters;
  $('#st-count').textContent = plural(list.length, 'chapitre');
  $('#st-chapters').innerHTML = list.map((c, i) => {
    const on = c.id === S.chapter.id;
    return `<li class="${on ? 'active' : ''}"><button type="button" class="st-chap" data-chapter="${esc(c.id)}"${on ? ' aria-current="true"' : ''}><span class="st-no">${i + 1}</span><span class="st-chname">${esc(on ? S.ch.name : c.name)}</span></button>
      <button type="button" class="icon-btn st-chedit" data-edit="${esc(c.id)}" title="Modifier ce chapitre" aria-label="Modifier le chapitre ${esc(c.name)}">${ICON.gear}</button></li>`;
  }).join('');
  const active = $('#st-chapters li.active'), box = $('#st-chapters');
  if (active) box.scrollTop = Math.max(0, active.offsetTop - box.offsetTop - box.clientHeight / 2);
}

function renderPlayers() {
  const h = S.ch.headers;
  const line = (c) => {
    const name = c === 'w' ? h.White : h.Black;
    if (!name || name === '?') return '';
    const title = c === 'w' ? h.WhiteTitle : h.BlackTitle;
    const elo = c === 'w' ? h.WhiteElo : h.BlackElo;
    return `<span class="color-dot ${c}" aria-hidden="true"></span>${title ? `<b class="st-ptitle">${esc(title)}</b> ` : ''}<b>${esc(name)}</b>${elo && elo !== '?' ? ` <span class="muted">${esc(elo)}</span>` : ''}`;
  };
  const bottom = S.board.orientation;
  $('#st-top').innerHTML = line(bottom === 'w' ? 'b' : 'w');
  $('#st-bottom').innerHTML = line(bottom);
}

function drawBoard() {
  const n = S.node;
  const shapes = n.shapes.map((s) => ({ color: BRUSHES[s[0]], from: s.slice(1, 3), to: s.slice(3, 5) }));
  const arrows = shapes.filter((s) => s.to).map((s) => ({ from: s.from, to: s.to, color: s.color }));
  const circles = shapes.filter((s) => !s.to).map((s) => ({ sq: s.from, color: s.color }));
  const eng = engHere();
  const best = eng?.res?.lines?.[0]?.pv[0];
  if (best) arrows.push({ from: best.slice(0, 2), to: best.slice(2, 4), color: 'var(--arrow-alt)', opacity: 0.55 });
  const g = n.nags.map(glyphOf).find((x) => x && x.group === 'move');
  const mark = g && n.parent ? { sq: n.uci.slice(2, 4), sym: g.sym, label: g.label, color: `var(--st-${GLYPH_CLASS[g.nag] || 'g-dubious'})` } : null;
  S.board.drawBrush = S.tool === 'draw' ? S.brush : null;
  S.board.setPosition(n.fen, { lastMove: n.parent ? [n.uci.slice(0, 2), n.uci.slice(2, 4)] : null, arrows, circles, mark });
  drawBar(eng);
}

// ----- arbre des coups : ligne principale en deux colonnes, commentaires et variantes intercalés
function moveButton(node, cls = '') {
  const i = S.nodes.push(node) - 1;
  const g = node.nags.find((n) => GLYPH_CLASS[n]);
  return `<button type="button" class="st-mv ${cls} ${g ? GLYPH_CLASS[g] : ''}" data-i="${i}"><span class="san">${figSan(node.san, node.color)}</span>${glyphText(node).map((s) => `<span class="gl">${s}</span>`).join('')}</button>`;
}
const commentHtml = (node, text, cls = '') => {
  const i = S.nodes.push(node) - 1;
  return `<span class="st-com ${cls}" data-i="${i}">${esc(text)}</span>`;
};
// Une variante : suite de coups sur une ligne ; ses propres embranchements sont entre parenthèses.
function inlineLine(first) {
  let out = '';
  let node = first, force = true;
  let siblings = []; // variantes du coup en cours d'écriture, écrites juste après lui
  while (node) {
    if (node.before) { out += commentHtml(node, node.before, 'before'); force = true; }
    const white = node.parent.fen.split(' ')[1] === 'w';
    if (white || force) out += `<span class="st-vno">${moveNo(node)}</span>`;
    out += moveButton(node, 'inline');
    force = false;
    if (node.comment) { out += commentHtml(node, node.comment); force = true; }
    for (const alt of siblings) { out += `<span class="st-par">(${inlineLine(alt)})</span> `; force = true; }
    siblings = node.children.slice(1);
    node = node.children[0];
  }
  return out;
}

function treeHtml(root) {
  let out = '';
  if (root.comment) out += `<div class="st-block">${commentHtml(root, root.comment)}</div>`;
  let row = null; // rangée en cours : { no, cells: [] }
  const close = () => {
    if (!row) return;
    while (row.cells.length < 2) row.cells.push('<span class="st-gap"></span>');
    out += `<div class="st-row"><span class="mno">${row.no}</span>${row.cells.join('')}</div>`;
    row = null;
  };
  let p = root;
  while (p.children.length) {
    const [main, ...alts] = p.children;
    const [turn, no] = [main.parent.fen.split(' ')[1], main.parent.fen.split(' ')[5]];
    if (main.before) { close(); out += `<div class="st-block">${commentHtml(main, main.before, 'before')}</div>`; }
    if (turn === 'w') { close(); row = { no, cells: [] }; }
    else if (!row) row = { no, cells: ['<span class="st-gap">…</span>'] };
    row.cells.push(moveButton(main));
    if (main.comment || alts.length) {
      if (turn === 'w' && main.children.length) row.cells.push('<span class="st-gap">…</span>');
      close();
      if (main.comment) out += `<div class="st-block">${commentHtml(main, main.comment)}</div>`;
      if (alts.length) out += `<div class="st-vars">${alts.map((a) => `<div class="st-var">${inlineLine(a)}</div>`).join('')}</div>`;
    } else if (turn === 'b') close();
    p = main;
  }
  close();
  const result = S.ch.headers.Result;
  if (result && result !== '*') out += `<div class="st-result">${esc(result)}</div>`;
  return out || '<p class="muted pad">Jouez un coup sur l’échiquier pour commencer le chapitre.</p>';
}

function renderTree() {
  S.nodes = [];
  const box = $('#st-tree');
  const top = box.scrollTop;
  box.innerHTML = treeHtml(S.ch.root);
  box.scrollTop = top;
  markCurrent();
}

function markCurrent() {
  const box = $('#st-tree');
  let cur = null;
  $$('.st-mv', box).forEach((b) => {
    const on = S.nodes[+b.dataset.i] === S.node;
    b.classList.toggle('cur', on);
    if (on) { b.setAttribute('aria-current', 'step'); cur = b; } else b.removeAttribute('aria-current');
  });
  // défilement de la seule liste, jamais de la page
  if (!cur) { if (!S.node.parent) box.scrollTop = 0; return; }
  const r = cur.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top < b.top + 8) box.scrollTop -= b.top - r.top + b.height / 3;
  else if (r.bottom > b.bottom - 8) box.scrollTop += r.bottom - b.bottom + b.height / 3;
}

// Embranchement : les coups possibles depuis la position affichée.
function renderForks() {
  const box = $('#st-forks');
  const kids = S.node.children;
  box.innerHTML = kids.length > 1 ? kids.map((n, i) => `<button type="button" data-fork="${i}"><span class="muted">${moveNo(n)}</span>${figSan(n.san, n.color)}${glyphText(n).join('')}</button>`).join('') : '';
  $$('[data-fork]', box).forEach((b) => { b.onclick = () => select(kids[+b.dataset.fork]); });
}

function renderActions() {
  const main = !S.node.parent || isMainline(S.node);
  $('#st-promote').disabled = main;
  $('#st-main').disabled = main;
  $('#st-delete').disabled = !S.node.parent;
}

// ----- menu d'un coup : clic droit, ou appui long au doigt
function closeMenu() { const m = $('#st-menu'); if (m) m.remove(); }
function openMenu(node, x, y) {
  closeMenu();
  select(node);
  const main = isMainline(node);
  const items = [
    !main && ['promote', '↑', 'Promouvoir la variante'],
    !main && ['main', '★', 'En faire la ligne principale'],
    ['comment', '💬', 'Commenter ce coup'],
    ['glyphs', '!?', 'Annoter avec un symbole'],
    ['delete', '✕', 'Supprimer à partir d’ici'],
  ].filter(Boolean);
  const menu = document.createElement('div');
  menu.id = 'st-menu';
  menu.className = 'st-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<div class="st-menuhead">${esc(label(node))}</div>${items.map(([k, i, t]) => `<button type="button" role="menuitem" data-act="${k}"${k === 'delete' ? ' class="danger"' : ''}><span aria-hidden="true">${i}</span>${t}</button>`).join('')}`;
  document.body.append(menu);
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + 'px';
  menu.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeMenu();
    const a = b.dataset.act;
    if (a === 'promote') edit(() => promote(node));
    else if (a === 'main') edit(() => makeMainline(node));
    else if (a === 'delete') remove(node);
    else { openTool(a); if (a === 'comment') $('#st-comment')?.focus(); }
  };
  menu.querySelector('button').focus({ preventScroll: true });
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#st-menu')) closeMenu(); }, true);

function bindTree(box) {
  let timer = null, held = false;
  const nodeOf = (e) => { const b = e.target.closest('[data-i]'); return b ? S.nodes[+b.dataset.i] : null; };
  box.addEventListener('click', (e) => {
    if (held) { held = false; return; }
    const n = nodeOf(e);
    if (n) select(n);
  });
  box.addEventListener('contextmenu', (e) => {
    const n = nodeOf(e);
    if (!n || !n.parent) return;
    e.preventDefault();
    clearTimeout(timer);
    openMenu(n, e.clientX, e.clientY);
  });
  box.addEventListener('pointerdown', (e) => {
    held = false;
    const n = nodeOf(e);
    if (e.pointerType === 'mouse' || !n || !n.parent) return;
    const { clientX, clientY } = e;
    timer = setTimeout(() => { held = true; openMenu(n, clientX, clientY); }, LONG_PRESS);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'scroll']) box.addEventListener(ev, () => clearTimeout(timer));
}

// ------------------------------------------------------------------ outils sous l'échiquier
function openTool(k) {
  S.tool = k;
  S.toolClosed = k === null;
  if (k !== 'draw') S.brush = null;
  $$('#study-view [data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === k)));
  renderTool();
  if (S.ch && S.node) drawBoard();
}

// L'arbre est redessiné peu après la frappe, pas à chaque lettre.
let treeTimer = null;
const treeSoon = () => { clearTimeout(treeTimer); treeTimer = setTimeout(() => { if (S.ch) renderTree(); }, 350); };

function renderTool() {
  const box = $('#st-under');
  if (!box || !S.ch) return;
  const node = S.node;
  const here = node.parent ? label(node) : 'la position de départ';
  if (S.tool === 'comment') {
    const field = (id, text, value, ph) => `<label for="${id}">${esc(text)}</label><textarea id="${id}" rows="4" spellcheck="true" placeholder="${esc(ph)}">${esc(value)}</textarea>`;
    box.innerHTML = (node.before ? field('st-before', `Texte avant ${here}`, node.before, '') : '')
      + field('st-comment', node.parent ? `Commentaire après ${here}` : 'Introduction du chapitre', node.comment, node.parent ? 'Idée du coup, plan, piège à retenir…' : 'Présentez le sujet de ce chapitre…');
    const bind = (id, prop) => { const t = $('#' + id, box); if (t) t.oninput = () => { node[prop] = t.value.trim() ? t.value : ''; touch(); treeSoon(); }; };
    bind('st-comment', 'comment'); bind('st-before', 'before');
  } else if (S.tool === 'glyphs') {
    if (!node.parent) { box.innerHTML = '<p class="muted small">Choisissez un coup pour l’annoter.</p>'; return; }
    box.innerHTML = `<div class="st-glyphs">${GLYPH_GROUPS.map(([g, title]) => `<div role="group" aria-label="${title}"><h3>${title}</h3>${GLYPHS[g].map(([nag, sym, name]) => `<button type="button" data-nag="${nag}" aria-pressed="${node.nags.includes(nag)}"><b class="${GLYPH_CLASS[nag] || ''}">${sym}</b><span>${name}</span></button>`).join('')}</div>`).join('')}</div>`;
    $$('[data-nag]', box).forEach((b) => { b.onclick = () => {
      const nag = +b.dataset.nag;
      toggleGlyph(node, nag);
      touch(); renderTree(); drawBoard(); renderForks(); renderTool();
      box.querySelector(`[data-nag="${nag}"]`)?.focus({ preventScroll: true });
    }; });
  } else if (S.tool === 'draw') {
    box.innerHTML = `<p class="muted small">À la souris : glissez avec le bouton droit pour une flèche, cliquez droit sur une case pour un cercle. Maj ou Ctrl : rouge ; Alt : bleu ; Alt + Maj : jaune. Refaire le même tracé l’efface.<br>Au doigt : choisissez une couleur ci-dessous, puis glissez sur l’échiquier (les pièces ne bougent plus tant qu’elle est choisie).</p>
      <div class="st-brushes" role="group" aria-label="Couleur du dessin au doigt">${Object.entries(BRUSHES).map(([k, c]) => `<button type="button" data-brush="${k}" aria-pressed="${S.brush === k}"><i style="background:${c}"></i>${BRUSH_FR[k]}</button>`).join('')}
      <button type="button" id="st-clearshapes" class="btn small"${node.shapes.length ? '' : ' disabled'}>Tout effacer ici</button></div>`;
    $$('[data-brush]', box).forEach((b) => { b.onclick = () => { S.brush = S.brush === b.dataset.brush ? null : b.dataset.brush; renderTool(); drawBoard(); }; });
    $('#st-clearshapes', box).onclick = () => { node.shapes = []; touch(); drawBoard(); renderTool(); };
  } else if (S.tool === 'tags') {
    if (box.dataset.tags === S.chapter.id && box.querySelector('.st-tags')) return; // ne dépend pas du coup affiché
    const h = S.ch.headers;
    const known = new Set([...TAGS.map(([k]) => k), ...MANAGED_TAGS]);
    const rest = Object.entries(h).filter(([k, v]) => !known.has(k) && v && v !== '?');
    box.innerHTML = `<div class="st-tags">${TAGS.map(([k, l]) => `<label>${l}<input data-tag="${k}" value="${esc(h[k] && h[k] !== '?' ? h[k] : '')}" autocomplete="off"></label>`).join('')}</div>
      ${rest.length ? `<dl class="st-rest">${rest.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}`;
    box.dataset.tags = S.chapter.id;
    $$('[data-tag]', box).forEach((i) => { i.oninput = () => {
      const v = i.value.trim();
      if (v) S.ch.headers[i.dataset.tag] = v; else delete S.ch.headers[i.dataset.tag];
      touch(); renderPlayers();
      if (i.dataset.tag === 'Result') treeSoon();
    }; });
    return;
  } else if (S.tool === 'share') {
    box.innerHTML = `<label for="st-pgn">PGN du chapitre (compatible Lichess)</label><textarea id="st-pgn" rows="7" readonly spellcheck="false">${esc(chapterToPgn(S.ch, S.study.name))}</textarea>
      <div class="row"><button type="button" id="st-copy" class="btn small primary">Copier le PGN</button><button type="button" id="st-copyfen" class="btn small">Copier la position (FEN)</button>
      <button type="button" id="st-dl-ch" class="btn small">Télécharger le chapitre</button><button type="button" id="st-dl-all" class="btn small">Télécharger toute l’étude</button>
      <button type="button" id="st-free" class="btn small">Ouvrir la ligne dans l’Analyse libre</button></div>`;
    const copy = async (text, what) => {
      try { await navigator.clipboard.writeText(text); toast(what + ' copié.'); }
      catch { toast('Copie impossible : le presse-papiers n’est pas accessible.'); }
    };
    $('#st-copy', box).onclick = () => copy(chapterToPgn(S.ch, S.study.name), 'PGN');
    $('#st-copyfen', box).onclick = () => copy(S.node.fen, 'FEN');
    $('#st-dl-ch', box).onclick = () => download(`${slug(S.study.name)}-${slug(S.ch.name)}.pgn`, chapterToPgn(S.ch, S.study.name));
    $('#st-dl-all', box).onclick = downloadStudy;
    $('#st-free', box).onclick = openInAnalysis;
    $('#st-free', box).disabled = !validateFen(S.ch.root.fen).ok;
  } else box.innerHTML = '';
  delete box.dataset.tags;
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'etude';
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function downloadStudy() {
  await flush();
  download(slug(S.study.name) + '.pgn', studyToPgn(S.study.name, S.study.chapters.map(openChapter)));
}
// La ligne qui mène au coup affiché, puis sa suite principale.
function openInAnalysis() {
  const line = pathOf(S.node);
  for (let n = S.node.children[0]; n; n = n.children[0]) line.push(n);
  stashFree({ fen: S.ch.root.fen, ucis: line.map((n) => n.uci), orient: S.board.orientation, tab: 'study', back: { label: 'Retour à l’étude' } });
  location.hash = '#/free/new';
}

// ------------------------------------------------------------------ chapitres et étude : fenêtres
function addChapterDialog() {
  const study = S.study;
  const source = pgnSource('sc');
  const nextName = `Chapitre ${study.chapters.length + 1}`;
  const tab = (k, l, on) => `<button type="button" role="tab" data-kind="${k}" class="${on ? 'on' : ''}" aria-selected="${on}">${l}</button>`;
  const dlg = dialog('st-chap-new', `<form method="dialog"><h2>Nouveau chapitre</h2>
    <div class="dtabs" role="tablist" aria-label="Point de départ">${tab('empty', 'Départ', true)}${tab('fen', 'Position FEN', false)}${tab('pgn', 'PGN', false)}</div>
    <div data-kpane="fen" class="hidden"><div class="form st-form"><label>Position (FEN) <input id="sc-fen" spellcheck="false" autocomplete="off" placeholder="8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"></label></div><div id="sc-preview" class="st-preview"></div></div>
    <div data-kpane="pgn" class="hidden">${source.html}</div>
    <p id="sc-status" class="small muted" role="status"></p>
    <div class="form st-form" id="sc-own"><label>Nom du chapitre <input id="sc-name" maxlength="80" autocomplete="off" placeholder="${esc(nextName)}"></label>${sideSelect('sc-side', S.ch.orientation)}</div>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button type="button" id="sc-go" class="btn primary">Ajouter</button></div></form>`);
  let kind = 'empty';
  const go = $('#sc-go', dlg), status = $('#sc-status', dlg);
  const pv = previewPgn(dlg, source, status, go);
  source.bind(dlg, pv.refresh);
  // FEN complétée si les derniers champs manquent ; une position sans roi est acceptée (études Lichess).
  const readFen = () => {
    const parts = $('#sc-fen', dlg).value.trim().split(/\s+/);
    if (!parts[0]) return null;
    while (parts.length < 6) parts.push(['', 'w', '-', '-', '0', '1'][parts.length]);
    const fen = parts.join(' ');
    const rows = parts[0].split('/');
    const width = (r) => [...r].reduce((n, c) => n + (/[1-8]/.test(c) ? +c : /[prnbqk]/i.test(c) ? 1 : 99), 0);
    if (rows.length !== 8 || rows.some((r) => width(r) !== 8) || !/^[wb]$/.test(parts[1])) return false;
    try { chessAt(fen); return fen; } catch { return false; }
  };
  const checkFen = () => {
    const fen = readFen();
    go.disabled = !fen;
    status.className = 'small ' + (fen === false ? 'err' : 'muted');
    status.textContent = fen === false ? 'Position illisible : 8 rangées de 8 cases, puis le trait (w ou b).' : fen && !validateFen(fen).ok ? 'Position inhabituelle : acceptée, mais le moteur ne pourra pas l’analyser.' : '';
    $('#sc-preview', dlg).innerHTML = fen ? miniBoard(fen.split(' ')[0], 160, { orient: $('#sc-side', dlg).value }) : '';
  };
  $('#sc-fen', dlg).oninput = checkFen;
  $('#sc-side', dlg).onchange = () => { if (kind === 'fen') checkFen(); };
  $$('[data-kind]', dlg).forEach((b) => { b.onclick = () => {
    kind = b.dataset.kind;
    $$('[data-kind]', dlg).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    $$('[data-kpane]', dlg).forEach((p) => p.classList.toggle('hidden', p.dataset.kpane !== kind));
    $('#sc-own', dlg).classList.toggle('hidden', kind === 'pgn'); // un PGN apporte noms et orientations
    status.textContent = ''; go.disabled = false;
    if (kind === 'fen') checkFen(); else if (kind === 'pgn') pv.refresh();
  }; });
  go.onclick = async () => {
    let list;
    if (kind === 'pgn') { const r = pv.get(); if (!r) return; list = r.chapters; }
    else {
      const fen = kind === 'fen' ? readFen() : START_FEN;
      if (!fen) return;
      list = [emptyChapter($('#sc-name', dlg).value.trim() || nextName, { fen, orientation: $('#sc-side', dlg).value })];
    }
    go.disabled = true;
    await flush();
    const added = await addChapters(study, list);
    dlg.close();
    if (S.study !== study) return;
    if (added.length > 1) toast(`${added.length} chapitres ajoutés.`);
    goChapter(added[0].id);
  };
  dlg.showModal();
}

function chapterDialog(id) {
  const study = S.study;
  const rec = study.chapters.find((c) => c.id === id);
  if (!rec) return;
  const current = rec === S.chapter;
  const i = study.chapters.indexOf(rec);
  const dlg = dialog('st-chap-edit', `<form method="dialog"><h2>Modifier le chapitre</h2>
    <div class="form st-form"><label>Nom <input id="se-name" maxlength="80" autocomplete="off" value="${esc(current ? S.ch.name : rec.name)}"></label>${sideSelect('se-side', current ? S.ch.orientation : rec.orientation)}</div>
    <div class="row"><button value="up" class="btn small"${i ? '' : ' disabled'}>↑ Monter</button><button value="down" class="btn small"${i < study.chapters.length - 1 ? '' : ' disabled'}>↓ Descendre</button>
      <button value="delete" class="btn small danger"${study.chapters.length > 1 ? '' : ' disabled'}>Supprimer le chapitre</button></div>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button value="ok" class="btn primary">Enregistrer</button></div></form>`);
  dlg.onclose = async () => {
    const v = dlg.returnValue;
    if (!v || v === 'cancel' || S.study !== study) return;
    if (v === 'delete') {
      if (!confirm(`Supprimer le chapitre « ${rec.name} » ?`)) return;
      if (current) { clearTimeout(S.timer); S.dirty = false; }
      await removeChapter(study, id);
      if (current) goChapter(study.chapters[Math.min(i, study.chapters.length - 1)].id);
      else renderChapters();
      return;
    }
    const name = $('#se-name', dlg).value.trim() || rec.name, orientation = $('#se-side', dlg).value;
    if (current) {
      const turned = orientation !== S.ch.orientation;
      Object.assign(S.ch, { name, orientation });
      S.dirty = true;
      await flush();
      if (turned) S.board.setOrientation(orientation);
    } else if (name !== rec.name || orientation !== rec.orientation) {
      const parsed = { ...openChapter(rec), name, orientation };
      Object.assign(rec, { name, orientation, pgn: chapterToPgn(parsed, study.name) });
      await saveChapter(rec);
    }
    if (v === 'up' || v === 'down') {
      const j = i + (v === 'up' ? -1 : 1);
      [study.chapters[i], study.chapters[j]] = [study.chapters[j], study.chapters[i]];
      await saveStudy(study);
    }
    $('#st-chapname').textContent = S.ch.name;
    renderChapters(); renderPlayers(); drawBoard();
  };
  dlg.showModal();
}

function studyDialog() {
  const study = S.study;
  const dlg = dialog('st-study-dlg', `<form method="dialog"><h2>Réglages de l’étude</h2>
    <div class="form st-form"><label>Nom de l’étude <input id="sx-name" maxlength="100" autocomplete="off" value="${esc(study.name)}"></label></div>
    <div class="row"><button value="export" class="btn small">Télécharger toute l’étude (PGN)</button><button value="delete" class="btn small danger">Supprimer l’étude</button></div>
    <div class="row end"><button value="cancel" class="btn">Annuler</button><button value="ok" class="btn primary">Enregistrer</button></div></form>`);
  dlg.onclose = async () => {
    const v = dlg.returnValue;
    if (!v || v === 'cancel' || S.study !== study) return;
    if (v === 'export') { await downloadStudy(); return; }
    if (v === 'delete') {
      if (!confirm(`Supprimer l’étude « ${study.name} » et ses ${plural(study.chapters.length, 'chapitre')} ?`)) return;
      clearTimeout(S.timer); S.dirty = false;
      await removeStudy(study);
      location.hash = '#/study';
      return;
    }
    const name = $('#sx-name', dlg).value.trim();
    if (!name || name === study.name) return;
    study.name = name;
    await saveStudy(study);
    S.dirty = true; // le nom figure dans le PGN du chapitre ouvert ; les autres le reprennent à l'export
    await flush();
    $('#st-title').textContent = name;
  };
  dlg.showModal();
}

// ------------------------------------------------------------------ moteur
const engOn = () => local.get('studyEng') === '1';
const engKey = (fen) => { const st = analysisSettings(); return `${fen}|${st.boost}|${st.depth}|${maxTime()}|${nLines()}`; };
const engHere = () => (engOn() && S.eng && S.eng.key === engKey(S.node.fen) ? S.eng : null);
// Le moteur ne peut analyser qu'une position légale, partie non terminée.
function analysable(fen) {
  if (!validateFen(fen).ok) return false;
  try { const c = new Chess(fen); return !c.isGameOver(); } catch { return false; }
}

function updateEngine() {
  clearTimeout(S.engTimer);
  const fen = S.node.fen;
  if (!engOn() || !analysable(fen)) { S.engPending = null; return; }
  const key = engKey(fen);
  if ((S.eng && S.eng.key === key) || S.engPending === key) return;
  // petit délai : pas de calcul pendant qu'on fait défiler les coups
  S.engTimer = setTimeout(async () => {
    S.engPending = key;
    const st = analysisSettings();
    let eng;
    try { eng = { key, fen, res: await analyzePosition(fen, null, { cloud: true, priority: true, multipv: nLines(), depth: st.fixed ? null : st.depth, movetime: maxTime() }) }; }
    catch (e) { eng = { key, fen, err: e.message }; }
    if (S.engPending !== key) return; // la position a changé entre-temps
    S.engPending = null;
    S.eng = eng;
    if (S.ch && S.node.fen === fen) { drawBoard(); renderEngine(); }
  }, 200);
}

function pvHtml(fen, pv) {
  const c = new Chess(fen);
  let out = '';
  for (const [i, u] of pv.slice(0, 10).entries()) {
    const turn = c.turn(), no = c.fen().split(' ')[5];
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    if (turn === 'w') out += `${no}. `; else if (!i) out += `${no}… `;
    out += figSan(m.san, m.color) + ' ';
  }
  return out;
}

function renderEngine() {
  const on = engOn();
  const box = $('#st-lines'), score = $('#st-score'), desc = $('#st-engdesc');
  box.classList.toggle('hidden', !on);
  score.textContent = '';
  desc.textContent = 'Analyse du moteur';
  if (!on) return;
  const fen = S.node.fen;
  if (!analysable(fen)) { box.innerHTML = `<p class="muted small">${validateFen(fen).ok ? 'Partie terminée dans cette position.' : 'Position inhabituelle : le moteur ne peut pas l’analyser.'}</p>`; return; }
  const eng = engHere();
  if (!eng) { box.innerHTML = '<p class="muted small">Calcul en cours…</p>'; return; }
  if (eng.err) { box.innerHTML = `<p class="err small">Moteur indisponible : ${esc(eng.err)}</p>`; return; }
  const lines = (eng.res.lines || []).slice(0, nLines()).filter((l) => l.pv?.length);
  if (lines[0]) score.textContent = fmtScore(lines[0].score);
  if (eng.res.depth) desc.textContent = `Profondeur ${eng.res.depth}`;
  box.innerHTML = lines.map((l) => `<button type="button" data-uci="${esc(l.pv[0])}" title="Jouer ce coup"><b>${esc(fmtScore(l.score))}</b><span>${pvHtml(fen, l.pv)}</span></button>`).join('') || '<p class="muted small">Aucune ligne.</p>';
}

function drawBar(eng) {
  const bar = $('#st-evalbar');
  bar.classList.toggle('hidden', !engOn());
  if (!engOn()) return;
  const c = chessAt(S.node.fen);
  const s = eng?.res?.lines?.[0]?.score || null;
  let wp = s ? winPct(s, 'w') : 50, text = s ? fmtScore(s) : '';
  if (c.isCheckmate()) { wp = c.turn() === 'w' ? 0 : 100; text = c.turn() === 'w' ? '0-1' : '1-0'; }
  bar.classList.toggle('flipped', S.board.orientation === 'b');
  bar.querySelector('.white').style.height = wp + '%';
  const lb = bar.querySelector('.label');
  lb.textContent = text;
  lb.className = 'label ' + (wp >= 50 ? 'on-white' : 'on-black');
}
