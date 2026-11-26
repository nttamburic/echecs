// Page « Statistiques » : la progression dans le temps, comparée uniquement à vos périodes passées.
// Les calculs sont dans core/stats.js ; rien n'est enregistré, tout se recalcule depuis les parties.
import { $, esc, fr1, local } from '../core/ui.js';
import * as store from '../core/store.js';
import { couleurDe } from '../core/revision.js';
import { PHASES } from '../core/manu/erreurs.js';
import { fmtDuree } from '../core/temps.js';
import {
  PERIODES_STATS, MINIMUM, bornes, jeuxDe, cadencesJouees, resultats, grouperResultats, seriesElo, parSemaine,
  lirePartie, ouvertureDe, familleOuverture, tempsParPhase, mesurePartie, agreger, moyenneTemps, ecart,
} from '../core/stats.js';
import { frOpening } from './opening-names.js';
import { BOOK, getGames, getUser, isLoadingGames, ouvrirAnalyseStrategique } from './analyse.js';

const CADENCES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par jour' };
const NOMS_PHASES = { ouverture: 'Ouverture', milieu: 'Milieu de jeu', finale: 'Finale' };
const OUVERTURES_VISIBLES = 8;
const S = { el: null, seq: 0, timer: null, off: null, vue: '' };

// Lire une partie coûte quelques millisecondes : le résultat est gardé tant que rien ne change.
const memo = new Map();
function mesurer(game, ligne, user) {
  const signature = `${user}|${ligne?.updatedAt ?? ''}|${Object.keys(BOOK).length > 0}`;
  let m = memo.get(game.id);
  if (m?.signature === signature) return { m, neuf: false };
  m = { signature, ouverture: null, temps: null, mesure: null };
  try {
    const partie = lirePartie(game);
    if (partie) {
      m.ouverture = familleOuverture(ouvertureDe(partie.coups, BOOK));
      m.temps = tempsParPhase(partie, game, user);
      if (ligne) m.mesure = mesurePartie({ ...ligne.data, game: { ...ligne.data.game, id: game.id } }, user, BOOK, partie);
    }
  } catch (e) { console.warn('Statistiques : partie ignorée', game.id, e); }
  memo.set(game.id, m);
  return { m, neuf: true };
}

// ------------------------------------------------------------------ formats
const plural = (n, un, plusieurs = un + 's') => `${n} ${n > 1 ? plusieurs : un}`;
const jourCourt = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const pct = (v) => (v == null ? '—' : `${Math.round(v)} %`);
const cadence = (c) => CADENCES[c] || esc(c);

// Écart avec la période précédente : la flèche donne le sens, le mot dit si c'est mieux.
function tendance(diff, { sens = 1, unite = 'point', decimales = 0 } = {}) {
  const v = Number(diff.toFixed(decimales));
  if (!v) return '<span class="st-tend">= comme la période précédente</span>';
  const mieux = v * sens > 0;
  const texte = `${v > 0 ? '+' : '−'}${String(Math.abs(v).toFixed(decimales)).replace('.', ',')}${unite ? ` ${unite}${Math.abs(v) >= 2 ? 's' : ''}` : ''}`;
  return `<span class="st-tend ${mieux ? 'mieux' : 'moins'}">${v > 0 ? '▲' : '▼'} ${texte} · ${mieux ? 'mieux' : 'moins bien'}</span>`;
}
function comparaison(actuel, precedent, nA, nP, options = {}) {
  if (nA < MINIMUM) return `<span class="st-tend">peu de données (moins de ${MINIMUM} ${options.compte ?? 'parties'})</span>`;
  const d = ecart(actuel, precedent, nA, nP);
  return d == null ? '<span class="st-tend">pas assez de données avant pour comparer</span>' : tendance(d, options);
}
const tuile = (nom, valeur, detail, bas) => `<div class="st-tuile"><span class="small muted">${nom}</span><b>${valeur}</b><span class="small muted">${detail}</span>${bas}</div>`;
const bloc = (id, titre, corps, note = '') => `<section class="card st-bloc" aria-labelledby="st-${id}"><h2 id="st-${id}">${titre}</h2>${note ? `<p class="muted small">${note}</p>` : ''}${corps}</section>`;
const calcul = '<p class="muted st-calcul" role="status">Calcul en cours…</p>';

// ------------------------------------------------------------------ courbes
// points : mesures affichées en pastilles ; ligne : points reliés (peut être vide). Un seul axe.
function courbe({ points, ligne, debut, fin, min, max, fmtY, titre, lectures }) {
  const x = (t) => (((t - debut) / (fin - debut)) * 1000).toFixed(1);
  const y = (v) => (190 - ((v - min) / (max - min || 1)) * 180).toFixed(1);
  const trait = ligne.length > 1 ? `<path class="st-ligne" d="M${ligne.map((p) => `${x(p.t)} ${y(p.v)}`).join(' L')}"/>` : '';
  const pastilles = points.map((p) => `<path class="st-point" d="M${x(p.t)} ${y(p.v)}h0"/>`).join('');
  const lire = lectures.map((l) => [Number(x(l.t)), l.texte]);
  return `<figure class="st-fig">
    <div class="st-axe" aria-hidden="true"><span>${fmtY(max)}</span><span>${fmtY((min + max) / 2)}</span><span>${fmtY(min)}</span></div>
    <div class="st-plot" data-lectures="${esc(JSON.stringify(lire))}">
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label="${esc(titre)}">
        <path class="st-grille" d="M0 10H1000M0 100H1000M0 190H1000"/>${trait}${pastilles}<path class="st-curseur" d="M0 0V200" visibility="hidden"/></svg></div>
    <div class="st-dates" aria-hidden="true"><span>${jourCourt(debut)}</span><span>${jourCourt(fin)}</span></div>
    <figcaption class="st-lecture small muted">Touchez ou survolez la courbe pour lire une valeur.</figcaption>
  </figure>`;
}

function brancherCourbes(el) {
  el.querySelectorAll('.st-plot').forEach((plot) => {
    const lectures = JSON.parse(plot.dataset.lectures);
    const sortie = plot.parentElement.querySelector('.st-lecture');
    const curseur = plot.querySelector('.st-curseur');
    const montrer = (e) => {
      const r = plot.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * 1000;
      const [px, texte] = lectures.reduce((a, b) => (Math.abs(b[0] - vx) < Math.abs(a[0] - vx) ? b : a));
      curseur.setAttribute('d', `M${px} 0V200`);
      curseur.setAttribute('visibility', 'visible');
      sortie.textContent = texte;
    };
    if (lectures.length) { plot.onpointermove = montrer; plot.onpointerdown = montrer; }
  });
}

const tableau = (resume, tetes, lignes) => `<details class="st-details" data-cle="${esc(resume)}"><summary>${resume}</summary><div class="table-wrap"><table class="st-table">
  <thead><tr>${tetes.map((t) => `<th scope="col">${t}</th>`).join('')}</tr></thead>
  <tbody>${lignes.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;

function blocElo(d) {
  const series = [...seriesElo(d.actuels, d.user)].sort((a, b) => b[1].length - a[1].length);
  if (!series.length) return bloc('elo', 'Elo', '<p class="muted">Aucune partie classée sur la période.</p>');
  const corps = series.map(([c, points]) => {
    const vs = points.map((p) => p.v);
    const marge = Math.max(10, Math.round((Math.max(...vs) - Math.min(...vs)) * 0.1));
    const premier = points[0].v, dernier = points.at(-1).v;
    const semaines = parSemaine(points, d.bornes);
    // l'Elo retenu pour une semaine est celui de sa dernière partie
    const finDe = (s) => points.filter((p) => p.t <= s.fin && p.t > s.debut).at(-1)?.v;
    return `<div class="st-serie"><h3>${cadence(c)} · ${dernier} <span class="muted small">${points.length > 1 ? `de ${premier} à ${dernier} en ${plural(points.length, 'partie classée', 'parties classées')}` : 'une seule partie classée'}</span></h3>
      ${points.length < 2 ? '' : courbe({ points: [points.at(-1)], ligne: points, ...d.bornes, min: Math.min(...vs) - marge, max: Math.max(...vs) + marge, fmtY: (v) => Math.round(v),
        titre: `Elo ${cadence(c)} : de ${premier} à ${dernier}`, lectures: points.map((p) => ({ t: p.t, texte: `${jourCourt(p.t)} · Elo ${p.v}` })) })}
      ${points.length < 2 ? '' : tableau(`Tableau par semaine (${cadence(c)})`, ['Semaine du', 'Elo en fin de semaine', 'Parties'], semaines.map((s) => [jourCourt(s.debut), finDe(s) ?? '—', s.n]))}</div>`;
  }).join('');
  return bloc('elo', 'Elo', corps);
}

function lignesResultats(lignes, nom) {
  return `<ul class="st-res">${lignes.map((r) => `<li><span class="st-nom">${nom(r.cle)}</span>
    <span class="st-barre" role="img" aria-label="${plural(r.win, 'victoire')}, ${plural(r.draw, 'nulle')}, ${plural(r.loss, 'défaite')}">${['win', 'draw', 'loss'].map((k) => (r[k] ? `<span class="st-${k}" style="flex:${r[k]}"></span>` : '')).join('')}</span>
    <span class="small st-chiffres"><b class="${r.total < MINIMUM ? 'muted' : ''}">${pct(r.score)}</b> <span class="muted">· ${r.win} V ${r.draw} N ${r.loss} D</span></span></li>`).join('')}</ul>`;
}

function blocResultats(d, ouvertures) {
  if (!d.actuels.length) return '';
  let corps = '<p class="small st-legende"><span><i class="st-win"></i>Victoires</span><span><i class="st-draw"></i>Nulles</span><span><i class="st-loss"></i>Défaites</span></p>';
  if (!d.cadence) corps += `<h3>Par cadence</h3>${lignesResultats(grouperResultats(d.actuels, d.user, (g) => g.timeClass), cadence)}`;
  corps += `<h3>Par couleur</h3>${lignesResultats(grouperResultats(d.actuels, d.user, (g) => couleurDe(g, d.user)).sort((a, b) => b.cle.localeCompare(a.cle)), (c) => (c === 'w' ? 'Avec les Blancs' : 'Avec les Noirs'))}`;
  corps += '<h3>Par ouverture</h3>';
  if (!ouvertures) corps += calcul;
  else {
    const groupes = grouperResultats(d.actuels, d.user, (g) => (ouvertures.get(g.id) ? `${couleurDe(g, d.user)}|${ouvertures.get(g.id)}` : null));
    const nom = (cle) => { const [c, f] = cle.split('|'); return `<i class="color-dot ${c}" aria-hidden="true"></i> ${esc(frOpening(f))} <span class="muted small">· ${c === 'w' ? 'Blancs' : 'Noirs'}</span>`; };
    corps += groupes.length ? lignesResultats(groupes.slice(0, OUVERTURES_VISIBLES), nom) : '<p class="muted">Aucune ouverture reconnue.</p>';
    if (groupes.length > OUVERTURES_VISIBLES) corps += `<details class="st-details" data-cle="ouvertures"><summary>Voir les ${groupes.length - OUVERTURES_VISIBLES} autres</summary>${lignesResultats(groupes.slice(OUVERTURES_VISIBLES), nom)}</details>`;
  }
  return bloc('resultats', 'Résultats', corps, `Le pourcentage est votre score : une victoire compte 1, une nulle ½. Il est grisé sous ${MINIMUM} parties, car il varie alors beaucoup.`);
}

function blocPrecision(d, mesures) {
  const points = mesures.filter((m) => m.precision != null).map((m) => ({ t: m.end * 1000, v: m.precision })).sort((a, b) => a.t - b.t);
  if (!points.length) return bloc('precision', 'Précision', '<p class="muted">Aucune partie analysée sur la période.</p>');
  const peu = points.length < MINIMUM;
  const semaines = parSemaine(points, d.bornes);
  const ligne = peu ? [] : semaines.map((s) => ({ t: (s.debut + s.fin) / 2, v: s.moyenne }));
  const min = Math.max(0, Math.floor(Math.min(...points.map((p) => p.v)) / 10) * 10);
  const corps = courbe({ points, ligne, ...d.bornes, min, max: 100, fmtY: (v) => `${Math.round(v)} %`, titre: 'Précision de chaque partie analysée',
    lectures: points.map((p) => ({ t: p.t, texte: `${jourCourt(p.t)} · précision ${fr1(p.v)} %` })) })
    + tableau('Tableau par semaine (précision)', ['Semaine du', 'Précision moyenne', 'Parties'], semaines.map((s) => [jourCourt(s.debut), `${fr1(s.moyenne)} %`, s.n]));
  return bloc('precision', 'Précision', corps, peu ? `Peu de données : un point par partie, sans tendance sous ${MINIMUM} parties.`
    : 'Un point par partie ; la ligne relie les moyennes par semaine. La force des adversaires et le type de positions jouent aussi.');
}

function blocPhases(actuel, precedent) {
  if (!actuel.parties) return bloc('phases', 'Fautes par phase', '<p class="muted">Aucune partie analysée sur la période.</p>');
  const max = Math.max(1, ...PHASES.map((p) => actuel.phases[p].pour100 ?? 0));
  const corps = `<ul class="st-phases">${PHASES.map((p) => {
    const a = actuel.phases[p], b = precedent.phases[p];
    return `<li><span class="st-nom">${NOMS_PHASES[p]}</span>
      <span class="st-jauge" aria-hidden="true"><span style="width:${((100 * (a.pour100 ?? 0)) / max).toFixed(1)}%"></span></span>
      <span class="st-chiffres"><b>${a.pour100 == null ? '—' : fr1(a.pour100)}</b> <span class="small muted">pour 100 coups · ${plural(a.fautes, 'faute')} en ${plural(a.coups, 'coup')}</span></span>
      <span class="small">${a.coups ? comparaison(a.pour100, b.pour100, a.parties, b.parties, { sens: -1, unite: '', decimales: 1 }) : ''}</span></li>`;
  }).join('')}</ul>`;
  return bloc('phases', 'Fautes par phase', corps, 'Vos erreurs, occasions manquées et gaffes, rapportées à vos coups joués dans chaque phase.');
}

function blocTemps(d, actuel, precedent, tempsJeux) {
  const t = actuel.temps, a = precedent.temps;
  const repere = (nom, cle, explication) => tuile(nom, pct(t[cle].pct), t[cle].total ? `${t[cle].n} sur ${plural(t[cle].total, 'faute')} · ${explication}` : explication,
    t[cle].total ? comparaison(t[cle].pct, a[cle].pct, t[cle].total, a[cle].total, { sens: -1, compte: 'fautes' }) : '');
  let corps = t.parties
    ? `<div class="st-tuiles">${repere('Fautes en manque de temps', 'manque', '10 % du temps ou moins')}${repere('Fautes jouées trop vite', 'vite', 'rapide et blitz seulement')}</div>`
    : '<p class="muted">Aucune partie analysée avec pendule sur la période.</p>';
  const parCadence = cadencesJouees(d.actuels).map(({ cadence: c }) => {
    const liste = d.actuels.filter((g) => g.timeClass === c).map((g) => tempsJeux.get(g.id)).filter(Boolean);
    return liste.length ? [cadence(c), moyenneTemps(liste), liste.length] : null;
  }).filter(Boolean);
  if (parCadence.length) {
    corps += `<h3>Temps moyen par coup</h3><div class="table-wrap"><table class="st-table"><thead><tr><th scope="col">Cadence</th>${PHASES.map((p) => `<th scope="col">${NOMS_PHASES[p]}</th>`).join('')}<th scope="col">Parties</th></tr></thead>
      <tbody>${parCadence.map(([nom, moy, n]) => `<tr><th scope="row">${nom}</th>${PHASES.map((p) => `<td>${moy[p] == null ? '—' : fmtDuree(moy[p])}</td>`).join('')}<td>${n}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">Calculé sur toutes les parties avec pendule, analysées ou non.</p>`;
  }
  return bloc('temps', 'Gestion du temps', corps, 'Un repère ne prouve pas que le temps est la cause de la faute.');
}

function tuiles(d, actuel, precedent, calcule) {
  const r = resultats(d.actuels, d.user), avant = resultats(d.precedents, d.user);
  let html = tuile('Score', pct(r.score), `${plural(r.total, 'partie')} · ${r.win} V ${r.draw} N ${r.loss} D`, comparaison(r.score, avant.score, r.total, avant.total));
  if (!calcule) return `<div class="st-tuiles">${html}</div>`;
  html += tuile('Précision moyenne', actuel.precision == null ? '—' : `${fr1(actuel.precision)} %`, plural(actuel.parties, 'partie analysée', 'parties analysées'),
    comparaison(actuel.precision, precedent.precision, actuel.parties, precedent.parties, { decimales: 1 }));
  const situation = (nom, cle, rien, detail) => tuile(nom, pct(actuel[cle].pct), actuel[cle].total ? `${actuel[cle].n} sur ${detail(actuel[cle].total)}` : rien,
    actuel[cle].total ? comparaison(actuel[cle].pct, precedent[cle].pct, actuel[cle].total, precedent[cle].total) : '');
  html += situation('Conversion', 'conversion', 'aucune position gagnante', (n) => `${plural(n, 'partie')} où vous étiez gagnant`);
  html += situation('Sauvetage', 'sauvetage', 'aucune position très mauvaise', (n) => `${plural(n, 'partie')} très mal engagée${n > 1 ? 's' : ''}`);
  return `<div class="st-tuiles">${html}</div>
    <p class="muted small">Gagnant : au moins 80 % de chances de gain sur deux de vos coups de suite ; la conversion demande la victoire. Très mal engagée : au plus 20 % de la même façon ; la nulle suffit pour la sauver. Pour ces deux chiffres, le minimum de ${MINIMUM} porte sur les parties concernées.</p>`;
}

function couverture(d, actuel, precedent, calcule) {
  const reste = jeuxDe(getGames(), d.user, d.bornes).filter((g) => !d.index[g.id]?.complete).length;
  const texte = calcule
    ? `Analyses : <b>${actuel.parties} sur ${plural(d.actuels.length, 'partie')}</b> sur la période · ${precedent.parties} sur ${d.precedents.length} la période précédente.`
    : 'Lecture de vos analyses…';
  const partiel = calcule && actuel.parties < d.actuels.length;
  return `<div class="card st-couv"><p>${texte}${partiel ? ' <span class="muted">Les chiffres issus de l’analyse ne portent que sur les parties analysées.</span>' : ''}</p>
    ${reste ? `<button type="button" class="btn" data-analyser>${reste > 1 ? `Analyser les ${reste} parties restantes` : 'Analyser la partie restante'}${d.cadence ? ' (toutes cadences)' : ''}</button>` : ''}</div>`;
}

function filtres(d) {
  const options = [['', 'Toutes les cadences'], ...d.jouees.map((c) => [c.cadence, `${CADENCES[c.cadence] || c.cadence} (${c.total})`])];
  return `<div class="st-filtres">
    <div class="segctl" role="group" aria-label="Période">${PERIODES_STATS.map((j) => `<button type="button" class="chip" data-jours="${j}" aria-pressed="${j === d.jours}">${j} jours</button>`).join('')}</div>
    <label><span class="sr-only">Cadence</span><select id="st-cadence">${options.map(([v, t]) => `<option value="${esc(v)}"${v === d.cadence ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
  </div>`;
}

function page(d, calculs) {
  const actuel = calculs ? agreger(d.actuels.map((g) => calculs.mesures.get(g.id)).filter(Boolean)) : agreger([]);
  const precedent = calculs ? agreger(d.precedents.map((g) => calculs.mesures.get(g.id)).filter(Boolean)) : agreger([]);
  const mesures = calculs ? d.actuels.map((g) => calculs.mesures.get(g.id)).filter(Boolean) : [];
  let corps;
  if (!d.actuels.length) corps = `<p class="card">Aucune partie ${d.cadence ? 'dans cette cadence ' : ''}sur les ${d.jours} derniers jours.</p>`;
  else {
    corps = couverture(d, actuel, precedent, !!calculs) + tuiles(d, actuel, precedent, !!calculs) + blocElo(d) + blocResultats(d, calculs?.ouvertures)
      + (calculs ? blocPrecision(d, mesures) + blocPhases(actuel, precedent) + blocTemps(d, actuel, precedent, calculs.temps) : calcul);
  }
  return `<header><h1 class="page-title">Statistiques</h1><p class="muted">${esc(d.user)} · ${d.jours} derniers jours, comparés aux ${d.jours} jours précédents</p></header>${filtres(d)}${corps}`;
}

function afficher(d, calculs) {
  const el = S.el;
  const ouverts = new Set([...el.querySelectorAll('details[open]')].map((x) => x.dataset.cle));
  const focus = el.contains(document.activeElement) ? (document.activeElement.id ? `#${document.activeElement.id}` : document.activeElement.dataset.jours ? `[data-jours="${document.activeElement.dataset.jours}"]` : null) : null;
  el.innerHTML = `<div class="st">${page(d, calculs)}</div>`;
  el.querySelectorAll('details').forEach((x) => { if (ouverts.has(x.dataset.cle)) x.open = true; });
  el.querySelectorAll('[data-jours]').forEach((b) => { b.onclick = () => { local.set('statsPeriod', b.dataset.jours); rendre(); }; });
  const choix = $('#st-cadence', el);
  if (choix) choix.onchange = () => { local.set('statsCadence', choix.value || 'toutes'); rendre(); };
  const analyser = $('[data-analyser]', el);
  if (analyser) analyser.onclick = () => ouvrirAnalyseStrategique(d.jours);
  brancherCourbes(el);
  if (focus) el.querySelector(focus)?.focus({ preventScroll: true });
}

const message = (html) => { S.el.innerHTML = `<div class="st"><h1 class="page-title">Statistiques</h1>${html}</div>`; };

async function rendre() {
  const seq = ++S.seq;
  const user = getUser();
  if (!user) { message('<p class="card">Indiquez votre pseudo chess.com dans <a href="#/settings/profile">Paramètres → Profil</a>.</p>'); return; }
  if (isLoadingGames()) { if (!S.el.querySelector('.st-filtres')) message('<p class="muted" role="status">Récupération de vos parties…</p>'); return; }
  const jeux = getGames();
  if (!jeux.length) { message('<p class="card">Aucune partie récupérée. <a href="#/games">Ouvrir l’historique</a></p>'); return; }
  const lignes = await store.all('analysis').catch(() => []);
  const index = Object.fromEntries((await store.all('analysisIndex').catch(() => [])).map((r) => [r.id, r.data]));
  if (seq !== S.seq || !S.el) return;

  const jours = PERIODES_STATS.includes(Number(local.get('statsPeriod'))) ? Number(local.get('statsPeriod')) : PERIODES_STATS[0];
  const courante = bornes(jours);
  const deuxPeriodes = { debut: bornes(jours, courante.fin, 1).debut, fin: courante.fin };
  const jouees = cadencesJouees(jeuxDe(jeux, user, deuxPeriodes));
  // Par défaut, la cadence la plus jouée : mélanger les cadences brouille la précision et les temps.
  const voulue = local.get('statsCadence');
  const choisie = voulue === 'toutes' ? '' : jouees.some((c) => c.cadence === voulue) ? voulue : jouees[0]?.cadence ?? '';
  const d = {
    user, jours, jouees, cadence: choisie, index, bornes: courante,
    actuels: jeuxDe(jeux, user, courante, choisie),
    precedents: jeuxDe(jeux, user, bornes(jours, courante.fin, 1), choisie),
  };

  const parId = new Map(lignes.map((r) => [r.id, r]));
  const todo = [...d.actuels, ...d.precedents];
  const calculs = { mesures: new Map(), ouvertures: new Map(), temps: new Map() };
  // Le premier calcul peut durer : la page rend la main toutes les 4 parties et montre où elle en est.
  // Les résultats et l'Elo, qui ne demandent aucune lecture, s'affichent d'abord.
  const vue = `${user}|${jours}|${choisie}`;
  let neufs = 0;
  for (const [i, game] of todo.entries()) {
    const { m, neuf } = mesurer(game, parId.get(game.id), user);
    if (m.mesure) calculs.mesures.set(game.id, m.mesure);
    if (m.ouverture) calculs.ouvertures.set(game.id, m.ouverture);
    if (m.temps) calculs.temps.set(game.id, m.temps);
    if (neuf && ++neufs % 4 === 0) {
      if (S.vue !== vue || !S.el.querySelector('.st-tuiles')) { afficher(d, null); S.vue = vue; }
      S.el.querySelectorAll('.st-calcul').forEach((p) => { p.textContent = `Calcul en cours : ${i + 1} sur ${todo.length} parties…`; });
      await new Promise((r) => setTimeout(r));
      if (seq !== S.seq || !S.el) return;
    }
  }
  afficher(d, calculs);
  S.vue = vue;
}

const rafraichir = () => { clearTimeout(S.timer); S.timer = setTimeout(rendre, 1500); };

export function show(el) {
  $('#topbar-soon').textContent = 'Statistiques';
  if (!S.el) {
    S.off = store.onChange(rafraichir);
    window.addEventListener('cj:games', rafraichir);
  }
  S.el = el;
  if (!el.firstChild) message('<p class="muted" role="status">Chargement…</p>');
  return rendre();
}

export function leave() {
  if (!S.el) return;
  S.el = null;
  S.seq++;
  clearTimeout(S.timer);
  S.off?.();
  window.removeEventListener('cj:games', rafraichir);
}
