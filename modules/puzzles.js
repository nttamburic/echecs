// Module Puzzles : écran d'accueil. Chaque mode a sa propre vue (puzzles-rush.js, puis thèmes et recommandés).
import { $, esc, local } from '../core/ui.js';
import { getStats } from '../core/puzzle-stats.js';
import { loadManifest } from '../core/puzzle-data.js';
import { groupThemes } from '../core/puzzle-themes.js';

const themeSummary = (s) => {
  const t = Object.values(s.themes || {});
  const n = t.reduce((a, x) => a + x.n, 0);
  return n ? `${n} puzzle${n > 1 ? 's' : ''} joué${n > 1 ? 's' : ''} · ${Math.round((100 * t.reduce((a, x) => a + x.ok, 0)) / n)} % réussis` : 'Pas encore joué';
};

const ICON = {
  rush: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/></svg>',
  theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  recommend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
};

export async function show(el) {
  const tt = document.getElementById('topbar-soon'); if (tt) tt.textContent = 'Puzzles';
  el.innerHTML = '<h1 class="page-title">Puzzles</h1><p class="muted">Chargement…</p>';
  const s = await getStats();
  el.innerHTML = `
  <h1 class="page-title">Puzzles</h1>
  <p class="pz-lead">Entraînez votre vision tactique. Niveau actuel : <b>${s.elo}</b>.</p>
  <div class="pz-cards">
    <a class="pz-card" href="#/puzzles/rush">
      <span class="pz-ico">${ICON.rush}</span>
      <span class="pz-name">Puzzles rush</span>
      <span class="pz-desc">Résolvez-en le plus possible en 120 secondes. Chaque erreur coûte 5 secondes.</span>
      <span class="pz-meta">${s.rush.plays ? `Record : <b>${s.rush.best}</b> · ${s.rush.plays} partie${s.rush.plays > 1 ? 's' : ''}` : 'Pas encore joué'}</span>
    </a>
    <a class="pz-card" href="#/puzzles/theme">
      <span class="pz-ico">${ICON.theme}</span>
      <span class="pz-name">Par thème</span>
      <span class="pz-desc">Fourchettes, clouages, mats… choisissez le motif à travailler.</span>
      <span class="pz-meta">${themeSummary(s)}</span>
    </a>
    <a class="pz-card" href="#/puzzles/recommend">
      <span class="pz-ico">${ICON.recommend}</span>
      <span class="pz-name">Recommandés</span>
      <span class="pz-desc">Des puzzles tirés de vos gaffes et des ouvertures que vous jouez.</span>
      <span class="pz-meta">Vos erreurs deviennent des puzzles</span>
    </a>
  </div>
  <p class="muted small">Puzzles de la base <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener">Lichess</a> (CC0).</p>`;
}

// ------------------------------------------------------------------ choix du thème
export const LEVEL_MIN = 400, LEVEL_MAX = 2800;
export const themeLevel = (fallback) => {
  const v = Number(local.get('pzLevel'));
  return Number.isFinite(v) && v >= LEVEL_MIN && v <= LEVEL_MAX ? v : Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(fallback / 50) * 50));
};
export const themeCount = () => ([10, 20, 50].includes(Number(local.get('pzCount'))) ? Number(local.get('pzCount')) : 20);

export async function showThemes(el) {
  const tt = document.getElementById('topbar-soon'); if (tt) tt.textContent = 'Puzzles par thème';
  el.innerHTML = '<h1 class="page-title">Puzzles par thème</h1><p class="muted">Chargement…</p>';
  let s, manifest;
  try {
    [s, manifest] = await Promise.all([getStats(), loadManifest()]);
  } catch (err) {
    el.innerHTML = `<h1 class="page-title">Puzzles par thème</h1><p class="tmsg wrong">${esc(err.message)}</p><p><a class="btn" href="#/puzzles/theme">Réessayer</a> <a class="btn" href="#/puzzles">Retour</a></p>`;
    return;
  }
  const level = themeLevel(s.elo), count = themeCount();
  const rate = (n) => { const t = s.themes[n]; return t && t.n ? `<span class="pz-rate" title="${t.ok} réussis sur ${t.n}">${Math.round((100 * t.ok) / t.n)} % <small>(${t.n})</small></span>` : ''; };
  el.innerHTML = `
  <div class="pz-head"><a href="#/puzzles" class="icon-btn" aria-label="Retour aux puzzles" title="Retour"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>
    <h1 class="page-title">Puzzles par thème</h1></div>
  <div class="card pz-opts">
    <label class="pz-opt"><span>Niveau des puzzles : <b id="pz-level-v">${level}</b></span>
      <input type="range" id="pz-level" min="${LEVEL_MIN}" max="${LEVEL_MAX}" step="50" value="${level}" aria-valuetext="${level}">
    </label>
    <div class="pz-opt-row">
      <button type="button" class="btn small" id="pz-mine">Mon niveau (${s.elo})</button>
      <label>Nombre de puzzles <select id="pz-count">${[10, 20, 50].map((n) => `<option${n === count ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
  </div>
  ${groupThemes(manifest.theme.map((e) => e.name)).map((g) => `
  <section class="pz-group" aria-labelledby="pzg-${g.id}">
    <h2 id="pzg-${g.id}" class="pz-gtitle">${esc(g.label)}</h2>
    <div class="pz-themes">${g.themes.map((t) => `<a class="pz-theme" href="#/puzzles/theme/${encodeURIComponent(t.name)}"><span>${esc(t.label)}</span>${rate(t.name)}</a>`).join('')}</div>
  </section>`).join('')}`;
  const range = $('#pz-level', el);
  const set = (v) => { range.value = v; $('#pz-level-v', el).textContent = v; range.setAttribute('aria-valuetext', v); local.set('pzLevel', String(v)); };
  range.oninput = () => set(Number(range.value));
  $('#pz-mine', el).onclick = () => set(Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(s.elo / 50) * 50)));
  $('#pz-count', el).onchange = (e) => local.set('pzCount', e.target.value);
}
