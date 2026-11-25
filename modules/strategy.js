import * as store from '../core/store.js';
import { $, esc, local } from '../core/ui.js';
import { CLASSES, fmtScore } from '../analysis.js';
import { fmtGameDate } from '../core/format.js';
import { erreursReglages } from '../core/manu/erreurs.js';
import { grouperStrategie, PERIODES_STRATEGIE, periodeStrategie } from '../core/manu/strategie.js';
import { BOOK, getGames, getUser, ouvrirAnalyseStrategique } from './analyse.js';
import { stashPlay } from './play.js';
import { Chess } from '../vendor/chess.js';

const phases = { ouverture: 'Ouverture', milieu: 'Milieu de jeu', finale: 'Finale' };
let vue, generation = 0, abonne;
const period = () => periodeStrategie(local.get('strategyPeriod'));

export function leave() {
  vue = null;
  generation++;
  abonne?.();
  abonne = null;
  window.removeEventListener('cj:games', actualiser);
}

export function show(el) {
  vue = el;
  el.innerHTML = '<h1 class="page-title">Étude stratégique</h1><p role="status">Chargement…</p>';
  if (!abonne) {
    abonne = store.onChange(info => {
      if (['analysis', 'strategyWork', 'settings'].includes(info.col)) actualiser();
    });
    window.addEventListener('cj:games', actualiser);
  }
  return actualiser();
}

function meilleurSAN(e) {
  try { return new Chess(e.fen).move(e.meilleur).san; } catch { return e.meilleur; }
}

function cadence(jeu) {
  const [base, inc] = String(jeu.timeControl ?? '').split('+');
  return /^\d+$/.test(base) ? Number(base) / 60 + ' min' + (inc && Number(inc) ? ' + ' + inc + ' s' : '')
    : jeu.timeControl || jeu.timeClass || 'Cadence inconnue';
}

function carte(jeu, erreurs, actions) {
  const camp = erreurs[0].color, adverse = camp === 'w' ? jeu.black : jeu.white;
  const moi = camp === 'w' ? jeu.white : jeu.black;
  return `<article class="card"><h3>${esc(adverse?.name || 'Adversaire inconnu')}</h3>
    <p class="muted">${esc(fmtGameDate(jeu.end * 1000))} · ${esc(cadence(jeu))}</p>
    <ul class="strategy-errors">${erreurs.map(e => {
      actions.set(e.id, { erreur: e, elo: moi?.rating });
      const gravite = CLASSES[e.gravite]?.label;
      const date = e.travail?.date ? new Date(e.travail.date).toLocaleDateString('fr-FR') : '';
      return `<li class="${date ? 'strategy-worked' : ''}">
        <div><strong>${e.numero}${camp === 'w' ? '.' : '…'} ${esc(e.san)}</strong>
        ${gravite ? `<span class="muted"> · ${esc(gravite)}</span>` : ''}
        ${date ? `<span class="small"> · Travaillée le ${esc(date)}</span>` : ''}</div>
        <div class="small muted">Pour vous · Avant ${esc(fmtScore(e.avant))} · Après ${esc(fmtScore(e.apres))} · Écart ${e.perdMat ? '≥ ' : ''}${e.ecartCp} cp</div>
        <div class="row"><button class="btn primary small" type="button" data-etudier="${esc(e.id)}">Rejouer contre Maia3</button>
        <details><summary>Voir le meilleur coup</summary><strong>${esc(meilleurSAN(e))}</strong></details></div>
      </li>`;
    }).join('')}</ul></article>`;
}

async function actualiser() {
  if (!vue) return;
  const gen = ++generation;
  try {
    const [analyses, travaux] = await Promise.all([store.all('analysis'), store.all('strategyWork')]);
    if (gen !== generation || !vue) return;
    const modele = grouperStrategie(analyses, getGames(), travaux, getUser(), BOOK, erreursReglages(local.get), period());
    const actions = new Map();
    vue.innerHTML = `<h1 class="page-title">Étude stratégique</h1>
      <div class="row strategy-toolbar"><label for="strategy-period">Période</label>
      <select id="strategy-period">${PERIODES_STRATEGIE.map(j => `<option value="${j}"${j === modele.jours ? ' selected' : ''}>${j} jours</option>`).join('')}</select>
      ${modele.aAnalyser ? `<button class="btn" id="strategy-analyse" type="button">Analyser les parties de la période (${modele.aAnalyser})</button>` : ''}</div>
      ${Object.entries(modele.groupes).map(([p, jeux]) => `<section class="strategy-phase"><h2>${phases[p]}</h2>
        ${jeux.length ? jeux.map(j => carte(j.jeu, j.erreurs, actions)).join('') : '<p class="muted">Aucune erreur stratégique.</p>'}</section>`).join('')}`;
    $('#strategy-period', vue).onchange = e => {
      local.set('strategyPeriod', periodeStrategie(e.target.value));
      actualiser();
    };
    const batch = $('#strategy-analyse', vue);
    if (batch) batch.onclick = () => ouvrirAnalyseStrategique(modele.jours);
    vue.querySelectorAll('[data-etudier]').forEach(btn => {
      btn.onclick = () => {
        const { erreur, elo } = actions.get(btn.dataset.etudier);
        stashPlay({ fen: erreur.fen, user: erreur.color, elo, etude: {
          id: erreur.id, joue: erreur.san, meilleur: meilleurSAN(erreur), avant: erreur.avant,
        } });
        location.hash = '#/play';
      };
    });
  } catch {
    if (gen === generation && vue) vue.innerHTML = '<h1 class="page-title">Étude stratégique</h1><p role="alert">Impossible de lire les analyses enregistrées.</p>';
  }
}
