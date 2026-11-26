import * as store from '../core/store.js';
import { $, badge, esc, local, toast } from '../core/ui.js';
import { CLASSES } from '../analysis.js';
import { fmtGameDate } from '../core/format.js';
import { PERIODES_STRATEGIE, periodeStrategie } from '../core/manu/strategie.js';
import { getGames, ouvrirAnalyseStrategique, stashGamePly } from './analyse.js';
import { stashPlay } from './play.js';
import { miniBoard } from './setup.js';
import { Chess } from '../vendor/chess.js';

// Liste d'erreurs tirées de vos parties : période, onglets, ligne dépliable et ses trois actions.
// Partagée par « Erreurs stratégiques » et « Mes finales ». Les options :
// prefixe (identifiants et préférences), onglets { clé: libellé }, nomOnglets, titre (null : pas de titre),
// retour { href, texte } après « Rejouer la partie », textes { chargement, vide, echec }, charger(analyses, travaux, periode) → { jours, groupes, aAnalyser }.
export function creerListeErreurs({ prefixe, onglets, nomOnglets, titre = null, retour = null, textes, charger }) {
const enTete = titre ? `<h1 class="page-title">${titre}</h1>` : '';
let vue, generation = 0, abonne;
const period = () => periodeStrategie(local.get(prefixe + 'Period'));

function leave() {
  vue = null;
  generation++;
  abonne?.();
  abonne = null;
  window.removeEventListener('cj:games', actualiser);
}

function show(el) {
  vue = el;
  if (titre) $('#topbar-soon').textContent = titre;
  el.innerHTML = `${enTete}<p role="status">${textes.chargement}</p>`;
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

const coup = e => `${e.numero}${e.color === 'w' ? '.' : '…'}${esc(e.san)}`;
const gravite = e => CLASSES[e.gravite]?.label ?? 'Gravité non classée';
const insigne = e => badge(e.gravite) || '<span class="badge strategy-neutral">–</span>';

function ligne(e, id) {
  return `<li><button class="strategy-row" type="button" aria-expanded="false" aria-controls="${id}">
    <span role="img" aria-label="${gravite(e)}">${insigne(e)}</span>
    <strong class="strategy-opponent">${esc(e.adversaire || 'Adversaire inconnu')}</strong>
    <span class="muted">${esc(fmtGameDate(e.jeu.end * 1000))}</span>
    <span class="strategy-move">${coup(e)}</span>
  </button><div id="${id}" hidden></div></li>`;
}

function afficherDetails(el, e) {
  const { after, from, to } = new Chess(e.fen).move(e.joue);
  const board = miniBoard(after.split(' ')[0], 208, { orient: e.color, lastMove: [from, to], mark: insigne(e) });
  el.innerHTML = `<div class="strategy-detail">
    ${board}
    <div class="strategy-actions">
      <div><strong class="strategy-move">${coup(e)}</strong> <span class="muted">· ${gravite(e)}</span></div>
      <div><button type="button" class="btn" data-analyser aria-describedby="${el.id}-analyse">Analyser la position</button>
        <p id="${el.id}-analyse" class="small muted">Retrouvez le coup dans l’analyse de la partie.</p></div>
      <div><button type="button" class="btn primary" data-rejouer aria-describedby="${el.id}-rejouer">Rejouer la partie</button>
        <p id="${el.id}-rejouer" class="small muted">Repartez de la position avant l’erreur contre Maia3.</p></div>
      <div><button type="button" class="btn" data-archiver aria-describedby="${el.id}-archiver">Archiver l’erreur</button>
        <p id="${el.id}-archiver" class="small muted">Retire l’erreur de la liste.</p></div>
    </div>
  </div>`;
  $('[data-analyser]', el).onclick = () => {
    stashGamePly(e.jeu.id, e.ply + 1);
    location.hash = '#/game/' + encodeURIComponent(e.jeu.id);
  };
  $('[data-rejouer]', el).onclick = () => {
    stashPlay({ fen: e.fen, user: e.color, elo: e.elo, etude: {
      id: e.id, retour, joue: e.san, meilleur: meilleurSAN(e), avant: e.avant,
    } });
    location.hash = '#/play';
  };
  $('[data-archiver]', el).onclick = () => archiver(e);
}

// Archiver retire l’erreur de la liste ; le suivi est synchronisé comme les erreurs travaillées.
async function archiver(e) {
  const avant = await store.get('strategyWork', e.id).catch(() => null);
  const ecrire = data => data ? store.put('strategyWork', e.id, data, { file: 'strategyWork.json' })
    : store.remove('strategyWork', e.id);
  try {
    await ecrire({ ...(avant || {}), archivee: true, dateArchive: Date.now() });
    toast('Erreur archivée.', { type: 'ok', action: { label: 'Annuler', fn: () => ecrire(avant).catch(() => toast('Annulation impossible.')) } });
  } catch { toast('Archivage impossible.'); }
}

function afficher(modele) {
  const noms = Object.keys(onglets);
  const pref = local.get(prefixe + 'Tab');
  const active = noms.includes(pref) ? pref : noms[0];
  vue.innerHTML = `<header class="strategy-toolbar">${enTete}
    <div class="row"><label for="${prefixe}-period">Période</label>
    <select id="${prefixe}-period">${PERIODES_STRATEGIE.map(j => `<option value="${j}"${j === modele.jours ? ' selected' : ''}>${j} jours</option>`).join('')}</select>
    ${modele.aAnalyser ? `<button class="btn" id="${prefixe}-analyse" type="button">Analyser les parties de la période (${modele.aAnalyser})</button>` : ''}</div>
    </header>
    <div class="ptabs strategy-tabs" role="tablist" aria-label="${nomOnglets}">
      ${noms.map(p => `<button role="tab" type="button" id="${prefixe}-tab-${p}" aria-controls="${prefixe}-panel-${p}"
        aria-selected="${p === active}" tabindex="${p === active ? 0 : -1}">${onglets[p]} <span class="strategy-count">${modele.groupes[p].length}</span></button>`).join('')}
    </div>
    ${noms.map(p => `<section role="tabpanel" id="${prefixe}-panel-${p}" aria-labelledby="${prefixe}-tab-${p}"${p === active ? '' : ' hidden'}>
      ${modele.groupes[p].length ? `<ul class="strategy-list">${modele.groupes[p].map((e, i) => ligne(e, `${prefixe}-detail-${p}-${i}`)).join('')}</ul>`
        : `<p class="muted">${textes.vide}</p>`}</section>`).join('')}`;

  $(`#${prefixe}-period`, vue).onchange = e => {
    local.set(prefixe + 'Period', periodeStrategie(e.target.value));
    actualiser();
  };
  const batch = $(`#${prefixe}-analyse`, vue);
  if (batch) batch.onclick = () => ouvrirAnalyseStrategique(modele.jours);

  let ouverte;
  function fermerLigne() {
    if (!ouverte) return;
    ouverte.setAttribute('aria-expanded', 'false');
    ouverte.nextElementSibling.hidden = true;
    ouverte = null;
  }

  const tabs = Array.from(vue.querySelectorAll('[role="tab"]'));
  const panels = Array.from(vue.querySelectorAll('[role="tabpanel"]'));
  function choisirOnglet(index) {
    if (tabs[index].getAttribute('aria-selected') !== 'true') fermerLigne();
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    local.set(prefixe + 'Tab', noms[index]);
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => choisirOnglet(index);
    tab.onkeydown = e => {
      let suivant;
      switch (e.key) {
        case 'ArrowLeft': suivant = (index + tabs.length - 1) % tabs.length; break;
        case 'ArrowRight': suivant = (index + 1) % tabs.length; break;
        case 'Home': suivant = 0; break;
        case 'End': suivant = tabs.length - 1; break;
        default: return;
      }
      e.preventDefault();
      choisirOnglet(suivant);
      tabs[suivant].focus();
    };
    const erreurs = modele.groupes[noms[index]];
    if (!erreurs.length) panels[index].tabIndex = 0;
    panels[index].querySelectorAll('.strategy-row').forEach((btn, i) => {
      btn.onclick = () => {
        const fermer = ouverte === btn;
        fermerLigne();
        if (fermer) return;
        const detail = btn.nextElementSibling;
        if (!detail.firstElementChild) afficherDetails(detail, erreurs[i]);
        detail.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        ouverte = btn;
      };
    });
  });
}

async function actualiser() {
  if (!vue) return;
  const gen = ++generation;
  try {
    const [analyses, travaux] = await Promise.all([store.all('analysis'), store.all('strategyWork')]);
    if (gen !== generation || !vue) return;
    afficher(charger(analyses, travaux, period()));
  } catch {
    if (gen === generation && vue) vue.innerHTML = `${enTete}<p role="alert">${textes.echec}</p>`;
  }
}

return { show, leave };
}
