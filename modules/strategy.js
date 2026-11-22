// Étude stratégique, version 1 : votre profil stratégique tiré de vos parties analysées, et le post-mortem
// de chaque partie (vos moments clés, avec votre plan à formuler avant de voir celui du moteur).
// Routes : #/strategy (profil) et #/strategy/game/<id> (post-mortem).
import { Board, announce } from '../board.js';
import { $, esc } from '../core/ui.js';
import * as store from '../core/store.js';
import { buildProfile, FEATURE_LABEL, MIN_SAMPLE } from '../core/strategic-profile.js';
import { momentsOf } from '../core/postmortem.js';
import { CLASS_LABEL } from '../core/puzzle-mine.js';
import { getUser, BOOK, figSan } from './analyse.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const S = { built: false, board: null, seq: 0, mom: null, k: 0, gameId: null };

const pct = (x) => `${Math.round(x * 100)} %`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export function leave() {
  S.seq++;
}

function build(el) {
  el.innerHTML = `
  <div id="st-home">
    <div class="pz-head"><h1 class="page-title">Étude stratégique</h1></div>
    <p class="muted">Votre profil est calculé à partir de vos parties analysées. Plus vous en analysez, plus il est fiable.</p>
    <div id="st-profile"></div>
    <h2 class="st-h">Parties à revoir</h2>
    <div id="st-games"></div>
    <p class="muted small">À venir : « Trouve le plan », avec la comparaison au moteur.</p>
  </div>
  <div id="st-pm" class="hidden">
    <div class="left"><div class="board-wrap"><div id="pm-board"></div></div></div>
    <aside class="panel pz-panel" aria-label="Post-mortem">
      <div class="phead">
        <a href="#/strategy" class="icon-btn" aria-label="Retour au profil" title="Retour au profil"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
        <span class="ptitle" id="pm-title"></span>
      </div>
      <div class="popening" id="pm-sub"></div>
      <div id="pm-body" aria-live="polite"></div>
      <div class="tactions">
        <button id="pm-prev" class="btn" type="button">← Précédent</button>
        <button id="pm-next" class="btn primary" type="button">Suivant →</button>
      </div>
    </aside>
  </div>`;
  S.board = new Board($('#pm-board', el), { onMove: () => {} });
  S.board.interactive = false;
  $('#pm-prev', el).onclick = () => step(-1);
  $('#pm-next', el).onclick = () => step(1);
}

export async function show(el, sub = '') {
  if (!S.built) { build(el); S.built = true; }
  const tt = document.getElementById('topbar-soon'); if (tt) tt.textContent = 'Étude stratégique';
  const m = /^game\/(.+)$/.exec(sub);
  if (m) { await postmortem(el, decodeURIComponent(m[1])); return; }
  $('#st-pm', el).classList.add('hidden');
  $('#st-home', el).classList.remove('hidden');
  await home(el);
}

// ------------------------------------------------------------------ profil
async function home(el) {
  const seq = ++S.seq;
  const user = getUser();
  const box = $('#st-profile', el), games = $('#st-games', el);
  if (!user) {
    box.innerHTML = '<p class="muted">Renseignez votre pseudo chess.com dans les <a href="#/settings">paramètres</a> pour calculer votre profil.</p>';
    games.innerHTML = '';
    return;
  }
  box.innerHTML = '<p class="muted">Calcul du profil…</p>';
  games.innerHTML = '';
  const rows = await store.all('analysis').catch(() => []);
  if (seq !== S.seq) return;
  if (!rows.length) {
    box.innerHTML = '<p class="muted">Aucune partie analysée sur cet appareil. Analysez vos parties depuis l’historique pour obtenir un profil.</p>';
    return;
  }
  const prof = buildProfile(rows, user, BOOK);
  if (seq !== S.seq) return;
  box.innerHTML = renderProfile(prof);
  games.innerHTML = renderGames(prof.games);
}

function renderProfile(p) {
  if (!p.moves) return '<p class="muted">Aucun coup exploitable pour votre pseudo dans ces parties.</p>';
  const row = (f) => `<li><b>${esc(f.label)}</b> <span class="muted">${f.mistakes} sur ${f.n} coups · ${pct(f.rate)} contre ${pct(p.base)} en moyenne</span></li>`;
  const list = (items, empty) => (items.length ? `<ul class="st-list">${items.map(row).join('')}</ul>` : `<p class="muted">${empty}</p>`);
  const missing = p.insufficient.length
    ? ` Pas encore assez de coups pour : ${p.insufficient.map((f) => esc(f.label.toLowerCase())).join(', ')}.`
    : '';
  return `
    <p class="muted">${plural(p.games.length, 'partie analysée', 'parties analysées')} · ${plural(p.moves, 'coup joué', 'coups joués')} · ${pct(p.base)} de vos coups sont des gaffes, erreurs ou occasions manquées.</p>
    <h2 class="st-h">Forces</h2>
    ${list(p.strengths, 'Aucune force nette pour l’instant.')}
    <h2 class="st-h">Faiblesses</h2>
    ${list(p.weaknesses, 'Aucune faiblesse nette pour l’instant.')}
    <p class="muted small">Indicatif : une caractéristique n’est retenue qu’à partir de ${MIN_SAMPLE} coups où elle est présente.${missing}</p>`;
}

function renderGames(games) {
  const todo = games.filter((g) => g.mistakes > 0).sort((a, b) => b.mistakes - a.mistakes);
  if (!todo.length) return '<p class="muted">Aucun moment clé dans vos parties analysées.</p>';
  return `<ul class="st-list">${todo.slice(0, 50).map((g) => `<li><a href="#/strategy/game/${encodeURIComponent(g.id)}">${esc(g.white)} – ${esc(g.black)}</a> <span class="muted">${plural(g.mistakes, 'moment clé', 'moments clés')}</span></li>`).join('')}</ul>`;
}

// ------------------------------------------------------------------ post-mortem
async function postmortem(el, id) {
  const seq = ++S.seq;
  $('#st-home', el).classList.add('hidden');
  $('#st-pm', el).classList.remove('hidden');
  $('#pm-title').textContent = 'Post-mortem';
  $('#pm-sub').textContent = '';
  $('#pm-body').innerHTML = '<p class="muted">Chargement…</p>';
  S.board.setArrows([]);
  S.board.setPosition(START_FEN);
  const user = getUser();
  const a = await store.get('analysis', id).catch(() => null);
  if (seq !== S.seq) return;
  const res = a && user ? momentsOf(a, user, BOOK) : null;
  S.mom = null;
  if (!res || !res.moments.length) {
    $('#pm-body').innerHTML = `<p class="muted">${!a ? 'Partie inconnue sur cet appareil.' : !user ? 'Renseignez votre pseudo chess.com pour analyser vos parties.' : 'Aucun moment clé dans cette partie.'}</p>`;
    $('#pm-prev').classList.add('hidden');
    $('#pm-next').classList.add('hidden');
    return;
  }
  $('#pm-prev').classList.remove('hidden');
  $('#pm-next').classList.remove('hidden');
  S.mom = res;
  S.gameId = id;
  S.k = 0;
  render();
}

function step(d) {
  if (!S.mom) return;
  const n = S.mom.moments.length;
  const k = S.k + d;
  if (k < 0 || k >= n) return;
  S.k = k;
  render();
}

// Réponses au plan : une par moment clé, clé = partie + index du coup. Collection synchronisée « strategyNotes ».
const noteKey = (m) => `${S.gameId}:${m.ply}`;
const setSaved = (text) => { const p = $('#pm-saved'); if (p) p.textContent = text; };

async function loadNote(m) {
  const rec = await store.get('strategyNotes', noteKey(m)).catch(() => null);
  const box = $('#pm-plan');
  // Le joueur a pu changer de moment pendant le chargement : on ne remplit que le moment courant.
  if (!box || !S.mom || S.mom.moments[S.k] !== m) return;
  box.value = rec && rec.plan || '';
}

async function saveNote(m, text) {
  const plan = text.trim();
  try {
    if (plan) await store.put('strategyNotes', noteKey(m), { gameId: S.gameId, ply: m.ply, plan, updatedAt: Date.now() });
    else await store.remove('strategyNotes', noteKey(m));
    setSaved(plan ? 'Réponse enregistrée sur cet appareil.' : 'Réponse effacée.');
  } catch {
    setSaved('Enregistrement impossible sur cet appareil.');
  }
}

function render() {
  const { game, color, moments } = S.mom;
  const m = moments[S.k];
  const opp = color === 'w' ? game.black : game.white;
  const oppName = opp && opp.name ? opp.name : '';
  $('#pm-title').textContent = `Coup ${m.moveNo} · ${CLASS_LABEL[m.cls] || 'Erreur'}`;
  $('#pm-sub').textContent = `Moment ${S.k + 1} / ${moments.length}${oppName ? ' · contre ' + oppName : ''}`;
  S.board.setOrientation(color);
  S.board.setArrows([]);
  S.board.setPosition(m.fen);
  $('#pm-prev').disabled = S.k === 0;
  $('#pm-next').disabled = S.k === moments.length - 1;
  const feats = m.features.map((k) => FEATURE_LABEL[k]).filter(Boolean);
  const best = m.best ? `Le moteur préférait <b>${figSan(m.best.line[0].san, m.best.line[0].color)}</b>.` : '';
  $('#pm-body').innerHTML = `
    <p>Vous avez joué <b>${figSan(m.played.san, color)}</b>. ${best}</p>
    <p class="muted small">Perte de probabilité de gain : ${m.loss} points.</p>
    <p>Caractéristiques de la position : ${feats.length ? esc(feats.join(', ').toLowerCase()) : 'aucune de celles suivies'}.</p>
    <label class="st-h" for="pm-plan">Quel était votre plan ici ?</label>
    <textarea id="pm-plan" rows="3"></textarea>
    <p class="muted small" id="pm-saved" aria-live="polite">Enregistrement automatique à la sortie du champ.</p>
    ${m.best ? '<button id="pm-reveal" class="btn" type="button">Voir le plan du moteur</button><div id="pm-engine" class="hidden"></div>' : ''}`;
  const box = $('#pm-plan');
  box.onchange = () => saveNote(m, box.value);
  loadNote(m);
  const reveal = $('#pm-reveal');
  if (reveal) {
    reveal.onclick = () => {
      const line = m.best.line.map((x) => figSan(x.san, x.color)).join(' ');
      $('#pm-engine').innerHTML = `<p>Plan du moteur : ${line}</p>`;
      $('#pm-engine').classList.remove('hidden');
      S.board.setArrows([{ from: m.best.uci.slice(0, 2), to: m.best.uci.slice(2, 4), color: '#81b64c' }]);
      announce('Plan du moteur affiché.');
      reveal.disabled = true;
    };
  }
}
