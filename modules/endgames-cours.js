import { Board } from '../board.js';
import { $, $$, esc, fetchJson, local } from '../core/ui.js';
import { BRUSHES, chessAt } from '../core/study-pgn.js';
import { GLYPH_CLASS, moveNo, treeHtml, showInList } from '../core/tree-view.js';
import { figSan } from './analyse.js';
import { miniBoard } from './setup.js';

const COURS = '#/endgames/cours';
const ANNOTATIONS = /\[%(csl|cal) ([^\]]*)\]/g;
const RUBRIQUES = { VERDICT: 'Verdict', 'RÈGLE CLÉ': 'Règle clé', PLAN: 'Plan', ATTENTION: 'Attention' };
const SYMBOLES = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const texte = (commentaire) => commentaire.replace(ANNOTATIONS, '').trim();

const titre = ({ code, name }) => `${code} — ${name}`;
const lien = ({ id }) => `${COURS}/${id}`;
const ICONES = {
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  first: '<svg viewBox="0 0 24 24"><path d="M6 5v14M18 5l-8 7 8 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  last: '<svg viewBox="0 0 24 24"><path d="M18 5v14M6 5l8 7-8 7"/></svg>',
};
const boutonCoup = (action, icone, label) =>
  `<button type="button" class="btn" data-action="${action}" title="${label}" aria-label="${label}">${ICONES[icone]}</button>`;

function dessins(commentaire) {
  const circles = [], arrows = [];
  for (const [, type, marques] of commentaire.matchAll(ANNOTATIONS)) {
    for (const marque of marques.split(',')) {
      const m = /^([GYRB])([a-h][1-8])([a-h][1-8])?$/.exec(marque.trim());
      if (!m) continue;
      const [, teinte, from, to] = m;
      const color = BRUSHES[teinte];
      if (type === 'csl' && !to) circles.push({ sq: from, color });
      if (type === 'cal' && to && from !== to) arrows.push({ from, to, color });
    }
  }
  return { circles, arrows };
}

// Les rubriques des explications (VERDICT, PLAN…) deviennent des intertitres.
function explication(commentaire) {
  const [intro, ...rubriques] = commentaire.split(/\b(VERDICT|RÈGLE CLÉ|PLAN|ATTENTION)\s*:\s*/g);
  let out = esc(intro.trim());
  for (let i = 0; i < rubriques.length; i += 2) {
    out += `<span class="eg-rubrique"><strong>${RUBRIQUES[rubriques[i]]}</strong>${esc(rubriques[i + 1].trim())}</span>`;
  }
  return out;
}

// Nœuds enregistrés (tableau, liens par numéro) → arbre au format de core/tree-view.js.
function arbre(etude) {
  const noeuds = etude.nodes.map((n, id) => ({ id, fen: n.fen, comment: texte(n.comment), before: '' }));
  noeuds.forEach((n, id) => {
    n.parent = id ? noeuds[etude.nodes[id].parent] : null;
    n.children = etude.nodes[id].children.map((c) => noeuds[c]);
  });
  return noeuds;
}

// Coup en notation figurine, avec son symbole (« !, ?… ») repris du libellé.
function coupHtml(etude, noeud) {
  const { uci, label } = etude.nodes[noeud.id];
  const color = noeud.parent.fen.split(' ')[1];
  const sym = (/[!?]+$/.exec(label) || [''])[0];
  const { san } = chessAt(noeud.parent.fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { classe: GLYPH_CLASS[SYMBOLES[sym]] || '', html: `<span class="san">${figSan(san, color)}</span>${sym ? `<span class="gl">${sym}</span>` : ''}` };
}

export function monterCours(zone) {
  zone.classList.add('eg-cours');
  zone.innerHTML = `
    <section class="eg-cours-index" aria-labelledby="eg-cours-title">
      <h2 id="eg-cours-title">100 finales à connaître</h2>
      <div class="eg-cours-sommaire"><p class="muted" role="status">Chargement…</p></div>
    </section>
    <section class="eg-lecteur" aria-labelledby="eg-etude-title" hidden>
      <aside class="st-side" aria-label="Études de la partie">
        <div class="st-sidehead">
          <a href="${COURS}" class="icon-btn" title="Sommaire" aria-label="Sommaire">${ICONES.prev}</a>
          <h2 id="eg-groupe-title"></h2>
        </div>
        <div class="st-count" id="eg-groupe-count"></div>
        <ol class="st-chapters"></ol>
        <div class="st-actions">
          <button type="button" class="btn small" data-action="previous-study" aria-label="Étude précédente">← Précédente</button>
          <button type="button" class="btn small" data-action="next-study" aria-label="Étude suivante">Suivante →</button>
        </div>
      </aside>
      <div class="st-center">
        <div class="st-player"></div>
        <div class="board-wrap"><div id="eg-etude-board"></div></div>
        <div class="st-player"><span class="color-dot" id="eg-etude-dot" aria-hidden="true"></span><span class="muted" id="eg-etude-turn"></span></div>
      </div>
      <div class="panel eg-coups">
        <div class="st-chaphead">
          <h2 id="eg-etude-title" tabindex="-1"></h2>
          <button type="button" class="btn small" data-action="flip" title="Retourner l’échiquier (F)" aria-label="Retourner l’échiquier">⇅</button>
        </div>
        <div class="pmoves st-tree" tabindex="0" role="region" aria-label="Coups, variantes et explications"></div>
        <div class="st-forks"></div>
        <div class="navbar four" role="group" aria-label="Navigation dans les coups">
          ${boutonCoup('first', 'first', 'Position de départ')}
          ${boutonCoup('back', 'prev', 'Coup précédent')}
          ${boutonCoup('next', 'next', 'Coup suivant')}
          ${boutonCoup('last', 'last', 'Dernier coup de la ligne')}
        </div>
      </div>
    </section>`;

  const index = $('.eg-cours-index', zone);
  const sommaire = $('.eg-cours-sommaire', zone);
  const reader = $('.eg-lecteur', zone);
  const etudeTitre = $('#eg-etude-title', zone);
  const boardEl = $('#eg-etude-board', zone);
  const tour = $('#eg-etude-turn', zone);
  const pastille = $('#eg-etude-dot', zone);
  const liste = $('.st-chapters', zone);
  const moves = $('.st-tree', zone);
  const forks = $('.st-forks', zone);
  const controles = Object.fromEntries($$('[data-action]', zone).map((b) => [b.dataset.action, b]));
  let groupes, etudes, chargement, board, etude, noeuds;
  let ply = 0;
  let ligne = [0];

  const groupeDe = (s) => groupes.find((g) => g.studies.includes(s));

  function afficherSommaire(retour) {
    index.hidden = false;
    reader.hidden = true;
    sommaire.innerHTML = `<ul class="st-grid">${groupes.map(({ name, studies }, i) => {
      const [premiere] = studies;
      return `<li class="card st-card"><a href="${lien(premiere)}" data-groupe="${i}">
        ${miniBoard(premiere.nodes[0].fen.split(' ')[0], 112, { orient: premiere.orientation })}
        <span class="st-cardtxt"><b title="${esc(name)}">${esc(name)}</b>
          <span class="muted small">${studies.length} études · ${esc(premiere.code)} à ${esc(studies.at(-1).code)}</span>
          <span class="st-cardchaps">${studies.slice(0, 4).map((s) => `<span>${esc(s.name)}</span>`).join('')}</span></span>
      </a></li>`;
    }).join('')}</ul>`;
    if (retour) $(`[data-groupe="${groupes.indexOf(groupeDe(retour))}"]`, sommaire).focus();
  }

  function afficherListe() {
    const groupe = groupeDe(etude);
    $('#eg-groupe-title', zone).textContent = groupe.name;
    $('#eg-groupe-count', zone).textContent = `${groupe.studies.length} études`;
    liste.innerHTML = groupe.studies.map((s) => {
      const actif = s === etude;
      return `<li class="${actif ? 'active' : ''}"><button type="button" class="st-chap" data-study="${esc(s.id)}" title="${esc(titre(s))}"${actif ? ' aria-current="true"' : ''}><span class="st-no">${esc(s.code)}</span><span class="st-chname">${esc(s.name)}</span></button></li>`;
    }).join('');
    const actif = $('li.active', liste);
    liste.scrollTop = Math.max(0, actif.offsetTop - liste.offsetTop - liste.clientHeight / 2);
  }

  function suivant(n) {
    const favori = ligne.indexOf(n);
    return (favori < 0 ? undefined : ligne[favori + 1]) ?? etude.nodes[n].children[0];
  }

  function afficherCoups() {
    moves.innerHTML = treeHtml(noeuds[0], {
      move: (noeud, cls) => {
        const { classe, html } = coupHtml(etude, noeud);
        return `<button type="button" class="st-mv ${cls} ${classe}" data-ply="${noeud.id}">${html}</button>`;
      },
      comment: (noeud, commentaire) => `<span class="st-com" data-ply="${noeud.id}">${explication(commentaire)}</span>`,
    });
  }

  function marquerCoup() {
    let courant = null;
    for (const b of $$('.st-mv', moves)) {
      const actif = Number(b.dataset.ply) === ply;
      b.classList.toggle('cur', actif);
      if (actif) { b.setAttribute('aria-current', 'step'); courant = b; } else b.removeAttribute('aria-current');
    }
    if (courant) showInList(moves, courant);
    else moves.scrollTop = 0;
  }

  function afficherEmbranchement() {
    const enfants = noeuds[ply].children;
    forks.innerHTML = enfants.length > 1 ? enfants.map((n) => `<button type="button" data-ply="${n.id}"><span class="muted">${moveNo(n)}</span>${coupHtml(etude, n).html}</button>`).join('') : '';
  }

  function dessiner() {
    const { fen, uci, comment } = etude.nodes[ply];
    const blancs = fen.split(' ')[1] === 'w';
    const auTrait = blancs ? 'Trait aux Blancs' : 'Trait aux Noirs';
    tour.textContent = auTrait;
    pastille.className = `color-dot ${blancs ? 'w' : 'b'}`;
    boardEl.setAttribute('aria-label', `Échiquier de l’étude ${titre(etude)}. ${auTrait}.`);
    board.setPosition(fen, { lastMove: uci ? [uci.slice(0, 2), uci.slice(2, 4)] : null, ...dessins(comment) });
    controles.first.disabled = controles.back.disabled = ply === 0;
    controles.next.disabled = controles.last.disabled = suivant(ply) === undefined;
    afficherEmbranchement();
    marquerCoup();
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
    local.set('finaleDerniere', JSON.stringify({ id: s.id, titre: titre(s) })); // « Reprendre » sur l'accueil
    noeuds = arbre(s);
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
    afficherListe();
    afficherCoups();
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
    const cible = e.target.closest('[data-action], [data-ply], [data-study]');
    if (!cible) return;
    const { action, ply: coup, study } = cible.dataset;
    if (coup !== undefined) aller(Number(coup));
    else if (study) location.hash = lien({ id: study });
    else actions[action]();
  });
  // Raccourcis valables sur tout l'écran de lecture, comme dans le module Étude.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'endgames' || !reader.offsetParent || document.querySelector('dialog[open]')) return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const action = { ArrowLeft: 'back', ArrowRight: 'next', ArrowUp: 'first', Home: 'first', ArrowDown: 'last', End: 'last', f: 'flip' }[e.key];
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
