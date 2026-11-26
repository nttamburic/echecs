import { Board } from '../board.js';
import { $, $$, esc, fetchJson } from '../core/ui.js';

const COURS = '#/endgames/cours';
const COULEURS = { G: '#548f26', Y: '#ddb735', R: '#ce4141', B: '#3783c4' };
const ANNOTATIONS = /\[%(csl|cal) ([^\]]*)\]/g;
const RUBRIQUES = { VERDICT: 'Verdict', 'RÈGLE CLÉ': 'Règle clé', PLAN: 'Plan', ATTENTION: 'Attention' };
const texte = (commentaire) => commentaire.replace(ANNOTATIONS, '').trim();

const titre = ({ code, name }) => `${code} — ${name}`;
const lien = ({ id }) => `${COURS}/${id}`;
const boutonCoup = (action, symbole, label) =>
  `<button type="button" class="btn${action === 'next' ? ' primary' : ''}" data-action="${action}" aria-label="${label}">${symbole}</button>`;

function annotations(commentaire) {
  const highlights = [], arrows = [];
  for (const [, type, marques] of commentaire.matchAll(ANNOTATIONS)) {
    for (const marque of marques.split(',')) {
      const m = /^([GYRB])([a-h][1-8])([a-h][1-8])?$/.exec(marque.trim());
      if (!m) continue;
      const [, teinte, from, to] = m;
      const color = COULEURS[teinte];
      if (type === 'csl' && !to) highlights.push({ sq: from, color });
      if (type === 'cal' && to && from !== to) arrows.push({ from, to, color, opacity: .78 });
    }
  }
  return { highlights, arrows };
}

export function monterCours(zone) {
  zone.classList.add('eg-cours');
  zone.innerHTML = `
    <section class="eg-cours-index" aria-labelledby="eg-cours-title">
      <h2 id="eg-cours-title">100 finales à connaître</h2>
      <div class="eg-cours-sommaire"><p class="muted" role="status">Chargement…</p></div>
    </section>
    <section class="eg-cours-reader" aria-labelledby="eg-etude-title" hidden>
      <a class="btn eg-cours-back" href="${COURS}">← Sommaire</a>
      <h2 id="eg-etude-title" tabindex="-1"></h2>
      <div class="eg-cours-layout">
        <div>
          <div id="eg-etude-board"></div>
          <div class="eg-cours-board-controls">
            <span class="muted" id="eg-etude-turn"></span>
            <button type="button" class="btn" data-action="flip">⇅ Retourner</button>
          </div>
        </div>
        <div class="eg-cours-panel">
          <div class="eg-cours-head"><h3>Explications</h3><span class="muted" id="eg-etude-label"></span></div>
          <div class="eg-cours-notes" aria-live="polite"></div>
          <div class="eg-cours-score">
            <h3>Coups et variantes</h3>
            <div class="eg-cours-moves"></div>
            <div class="eg-cours-controls" role="group" aria-label="Navigation dans les coups">
              ${boutonCoup('first', '|‹', 'Position de départ')}
              ${boutonCoup('back', '‹', 'Coup précédent')}
              ${boutonCoup('next', '›', 'Coup suivant')}
              ${boutonCoup('last', '›|', 'Dernier coup de la ligne')}
            </div>
          </div>
        </div>
      </div>
      <div class="eg-cours-neighbors">
        <button type="button" class="btn" data-action="previous-study">← Étude précédente</button>
        <button type="button" class="btn" data-action="next-study">Étude suivante →</button>
      </div>
    </section>`;

  const index = $('.eg-cours-index', zone);
  const sommaire = $('.eg-cours-sommaire', zone);
  const reader = $('.eg-cours-reader', zone);
  const etudeTitre = $('#eg-etude-title', zone);
  const boardEl = $('#eg-etude-board', zone);
  const tour = $('#eg-etude-turn', zone);
  const label = $('#eg-etude-label', zone);
  const notes = $('.eg-cours-notes', zone);
  const moves = $('.eg-cours-moves', zone);
  const controles = Object.fromEntries($$('[data-action]', zone).map((b) => [b.dataset.action, b]));
  let groupes, etudes, chargement, board, etude;
  let ply = 0;
  let ligne = [0];

  function afficherSommaire(retour) {
    const id = retour?.id ?? etudes[0].id;
    index.hidden = false;
    reader.hidden = true;
    sommaire.innerHTML = groupes.map(({ name, studies }) => `
      <details class="eg-cours-group"${studies.some((s) => s.id === id) ? ' open' : ''}>
        <summary>${esc(name)} <span class="muted">${studies.length} études</span></summary>
        ${studies.map((s) => `<a class="eg-cours-study" href="${lien(s)}" data-study="${s.id}">
          <span class="muted">${esc(s.code)}</span><span>${esc(s.name)}</span><span class="muted" aria-hidden="true">›</span>
        </a>`).join('')}
      </details>`).join('');
    if (retour) $(`[data-study="${id}"]`, sommaire).focus();
  }

  function suivant(n) {
    const favori = ligne.indexOf(n);
    return (favori < 0 ? undefined : ligne[favori + 1]) ?? etude.nodes[n].children[0];
  }

  function afficherCoups() {
    const { nodes } = etude;
    const boutons = [];
    const ajouter = (n, variante = false) => {
      const nom = esc(nodes[n].label);
      boutons.push(`<button type="button" class="eg-cours-move" data-ply="${n}"${variante ? ' data-variant' : ''}${n === ply ? ' aria-current="step"' : ''}>${variante ? `(${nom})` : nom}</button>`);
    };
    ajouter(0);
    for (let n = 0; nodes[n].children.length;) {
      const favori = suivant(n);
      ajouter(favori);
      for (const enfant of nodes[n].children) {
        if (enfant !== favori) ajouter(enfant, true);
      }
      n = favori;
    }
    const garderFocus = moves.contains(document.activeElement);
    moves.innerHTML = boutons.join('');
    const courant = $('[aria-current]', moves);
    if (garderFocus) courant.focus({ preventScroll: true });
    const position = courant.getBoundingClientRect();
    const cadre = moves.getBoundingClientRect();
    if (position.bottom > cadre.bottom) moves.scrollTop += position.bottom - cadre.bottom;
    if (position.top < cadre.top) moves.scrollTop -= cadre.top - position.top;
  }

  function dessiner() {
    const { fen, uci, comment, label: nom } = etude.nodes[ply];
    const auTrait = fen.split(' ')[1] === 'w' ? 'Trait aux Blancs' : 'Trait aux Noirs';
    tour.textContent = auTrait;
    boardEl.setAttribute('aria-label', `Échiquier de l’étude ${titre(etude)}. ${auTrait}.`);
    board.setPosition(fen, { lastMove: uci ? [uci.slice(0, 2), uci.slice(2, 4)] : null, ...annotations(comment) });

    const courant = texte(comment);
    const [intro, ...rubriques] = (courant || texte(etude.nodes[0].comment)).split(/\b(VERDICT|RÈGLE CLÉ|PLAN|ATTENTION)\s*:\s*/g);
    let explications = intro.trim() ? `<p>${esc(intro.trim())}</p>` : '';
    for (let i = 0; i < rubriques.length; i += 2) {
      explications += `<p><strong>${RUBRIQUES[rubriques[i]]}</strong>${esc(rubriques[i + 1].trim())}</p>`;
    }
    label.textContent = ply && courant ? nom : 'Position initiale';
    if (notes.innerHTML !== explications) {
      notes.innerHTML = explications;
      notes.scrollTop = 0;
    }
    controles.first.disabled = controles.back.disabled = ply === 0;
    controles.next.disabled = controles.last.disabled = suivant(ply) === undefined;
    afficherCoups();
  }

  function aller(n) {
    if (n === undefined) return;
    const chemin = [n];
    while (n) {
      n = etude.nodes[n].parent;
      chemin.unshift(n);
    }
    if (!chemin.every((id, i) => id === ligne[i])) ligne = chemin;
    ply = chemin.at(-1);
    dessiner();
  }

  function afficherEtude(s, position) {
    etude = s;
    ply = 0;
    ligne = [0];
    index.hidden = true;
    reader.hidden = false;
    if (!board) {
      board = new Board(boardEl);
      board.interactive = false;
    }
    board.setOrientation(s.orientation);
    etudeTitre.textContent = titre(s);
    controles['previous-study'].disabled = position === 0;
    controles['next-study'].disabled = position === etudes.length - 1;
    dessiner();
    etudeTitre.focus({ preventScroll: true });
  }

  const actions = {
    flip: () => board.flip(),
    first: () => aller(0),
    back: () => { if (ply) aller(etude.nodes[ply].parent); },
    next: () => aller(suivant(ply)),
    last: () => {
      let n = ply;
      for (let enfant = suivant(n); enfant !== undefined; enfant = suivant(n)) n = enfant;
      aller(n);
    },
    'previous-study': () => { location.hash = lien(etudes[etudes.indexOf(etude) - 1]); },
    'next-study': () => { location.hash = lien(etudes[etudes.indexOf(etude) + 1]); },
  };
  reader.addEventListener('click', (e) => {
    const bouton = e.target.closest('button');
    if (!bouton) return;
    if (bouton.dataset.ply !== undefined) aller(Number(bouton.dataset.ply));
    else actions[bouton.dataset.action]();
  });
  reader.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const action = { ArrowLeft: 'back', ArrowRight: 'next' }[e.key];
    if (!action) return;
    e.preventDefault();
    actions[action]();
  });

  return async function afficher(id) {
    const route = location.hash;
    if (!groupes) {
      sommaire.innerHTML = '<p class="muted" role="status">Chargement…</p>';
      chargement ??= fetchJson('data/finales-cours.json').then(({ body }) => {
        if (Array.isArray(body) && body.length) {
          groupes = body;
          etudes = groupes.flatMap((g) => g.studies);
        }
        chargement = null;
      });
      await chargement;
      if (location.hash !== route || zone.hidden) return;
      if (!groupes) {
        sommaire.innerHTML = '<p class="msg err" role="alert">Impossible de charger les études.</p><button type="button" class="btn">Réessayer</button>';
        $('button', sommaire).onclick = () => afficher(id);
        return;
      }
    }
    const position = id ? etudes.findIndex((s) => s.id === id) : -1;
    if (position >= 0) {
      afficherEtude(etudes[position], position);
      return;
    }
    if (id) location.replace(COURS);
    else {
      afficherSommaire(reader.hidden ? null : etude);
      etude = null;
    }
  };
}
