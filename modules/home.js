// Module « Accueil » : ce qu'il y a à travailler aujourd'hui, où reprendre, la progression, les
// dernières parties et l'accès aux modules. Les calculs sont dans core/accueil.js.
import { $, esc, local } from '../core/ui.js';
import { fmtAgo, fmtGameDate, fmtPct } from '../core/format.js';
import * as store from '../core/store.js';
import { cfg, onSync, state as syncState } from '../core/sync.js';
import { lichessCfg } from '../core/lichess.js';
import { getStats } from '../core/puzzle-stats.js';
import { allCards } from '../core/puzzle-cards.js';
import { DELAIS, NB_CYCLES, bilanJeu, jeuActif, lireWoodpecker } from '../core/woodpecker.js';
import { erreursReglages } from '../core/manu/erreurs.js';
import { grouperStrategie, periodeStrategie } from '../core/manu/strategie.js';
import { JOURS_RECENTS, aAnalyser, dernierElo, dernieresParties, puzzlesDus, resultatsRecents, taches } from '../core/accueil.js';
import { listRepertoires, listEvents, reachableEdges, computeMastery, masterySummary } from './openings.js';
import { buildDueTargets } from './openings-train.js';
import { listStudies } from './study-model.js';
import { BOOK, getGames, getUser, isLoadingGames, ouvrirAnalyseStrategique } from './analyse.js';
import { miniBoard } from './setup.js';
import { chargerFile } from '../core/revision-store.js';

const CADENCES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par jour' };
const ISSUES = { win: 'Victoire', draw: 'Nulle', loss: 'Défaite' };
const plural = (n, s) => `${n} ${s}${n > 1 ? 's' : ''}`;

// revision : nombre d'erreurs à rejouer. Le calcul peut être long la première fois : la page ne l'attend pas.
const H = { el: null, seq: 0, timer: null, offStore: null, offSync: null, revision: 0 };

async function compterRevision(user) {
  const n = user ? await lire(async () => { const f = await chargerFile(user, BOOK); return f.dues.length + f.nouvelles.length; }, 0) : 0;
  if (n === H.revision) return;
  H.revision = n;
  if (H.el) rafraichir();
}

// Une donnée illisible ne doit pas vider la page : le bloc concerné est simplement omis.
const lire = async (f, defaut) => { try { return await f(); } catch (e) { console.warn('Accueil', e); return defaut; } };

async function ouverturesResume() {
  const [reps, events] = await Promise.all([listRepertoires(), listEvents()]);
  const cibles = buildDueTargets(reps, events);
  let positions = 0, maitrisees = 0;
  for (const r of reps) {
    const s = masterySummary(computeMastery(r, events, reps));
    positions += s.positions - s.shared;
    maitrisees += s.mastered;
  }
  return {
    repertoires: reps.length,
    coups: reps.reduce((n, r) => n + reachableEdges(r).length, 0),
    dus: cibles.filter((c) => c.status === 'due').length,
    nouveaux: cibles.filter((c) => c.status === 'fresh').length,
    maitrise: positions ? Math.round((100 * maitrisees) / positions) : null,
  };
}

async function woodpeckerResume() {
  const { jeux, essais } = await lireWoodpecker();
  const jeu = jeuActif(jeux, essais);
  if (!jeu) return null;
  const c = bilanJeu(jeu, essais).courant;
  return { cycle: c.n, cycles: NB_CYCLES, faits: c.faits, total: c.total, delai: DELAIS[c.n - 1] };
}

async function erreursStrategiques(jeux, user, periode) {
  if (!user) return null;
  const [analyses, travaux] = await Promise.all([store.all('analysis'), store.all('strategyWork')]);
  const { groupes } = grouperStrategie(analyses, jeux, travaux, user, BOOK, erreursReglages(local.get), periode);
  return Object.values(groupes).reduce((n, l) => n + l.length, 0);
}

async function charger() {
  const user = getUser(), jeux = getGames();
  const periode = periodeStrategie(local.get('strategyPeriod'));
  const [index, ouvertures, cartes, woodpecker, stats, etudes, erreurs] = await Promise.all([
    lire(async () => Object.fromEntries((await store.all('analysisIndex')).map((r) => [r.id, r.data])), {}),
    lire(ouverturesResume, null),
    lire(allCards, new Map()),
    lire(woodpeckerResume, null),
    lire(getStats, null),
    lire(listStudies, []),
    lire(() => erreursStrategiques(jeux, user, periode), null),
  ]);
  return { user, jeux, index, ouvertures, cartes, woodpecker, stats, etudes, erreurs, periode, chargement: isLoadingGames() };
}

// Rien d'enregistré et aucun pseudo : on accueille au lieu d'afficher des compteurs vides.
const premiereFois = (d) => !d.user && !d.etudes.length && !d.ouvertures?.repertoires && !d.cartes.size && !d.woodpecker;

function ligneSync() {
  if (!cfg.configured) return 'Données enregistrées sur cet appareil';
  if (syncState.running) return 'Synchronisation en cours';
  if (syncState.error) return 'Synchronisation en échec';
  return syncState.lastSync ? `Synchronisé ${fmtAgo(new Date(syncState.lastSync))}` : 'Synchronisation en attente';
}

// ------------------------------------------------------------------ première utilisation
function bienvenue() {
  const etapes = [
    { titre: 'Indiquer votre pseudo chess.com', detail: 'Pour récupérer vos parties terminées et les analyser.', fait: false, action: 'Ajouter', href: '#/settings/profile' },
    { titre: 'Connecter GitHub', detail: 'Facultatif : retrouver vos données sur le PC et le téléphone.', fait: cfg.configured, action: 'Configurer', href: '#/settings/connection' },
    { titre: 'Ajouter un jeton Lichess', detail: 'Facultatif : nécessaire pour l’explorateur d’ouvertures.', fait: lichessCfg.connected, action: 'Configurer', href: '#/settings/connection' },
  ];
  const libres = [
    ['#/study', 'Étude', 'Créer une étude ou importer un PGN'],
    ['#/endgames', 'Finales', '120 études commentées'],
    ['#/puzzles', 'Puzzles', 'Par thème ou en cycles Woodpecker'],
    ['#/play', 'Jouer', 'Une partie contre Maia'],
  ];
  return `
    <header class="ac-head"><div><h1 class="page-title">Bienvenue sur Chess Journey</h1>
      <p class="muted">Analysez vos parties, travaillez vos ouvertures, vos tactiques et vos finales.</p></div></header>
    <section class="ac-bloc" aria-labelledby="ac-config">
      <div class="ac-titre"><h2 id="ac-config">Préparer l’application</h2></div>
      <ol class="ac-lignes">${etapes.map((e, i) => `
        <li class="ac-ligne"><b class="ac-num" aria-hidden="true">${i + 1}</b>
          <span class="ac-texte"><b>${e.titre}</b><span class="muted small">${e.detail}</span></span>
          ${e.fait ? '<span class="ac-fait">✓ Fait</span>' : `<a class="ac-action${i === 0 ? ' primaire' : ''}" href="${e.href}"><span>${e.action}</span></a>`}</li>`).join('')}
      </ol>
    </section>
    <section aria-labelledby="ac-libres"><h2 id="ac-libres" class="ac-h2">Utilisable tout de suite</h2>
      <div class="ac-modules">${libres.map(([href, nom, desc]) => `<a class="ac-module" href="${href}"><span><b>${nom}</b><span class="muted small">${desc}</span></span></a>`).join('')}</div>
    </section>`;
}

// ------------------------------------------------------------------ blocs
function blocTaches(d) {
  const liste = taches({
    ouvertures: d.ouvertures,
    puzzles: puzzlesDus(d.cartes),
    woodpecker: d.woodpecker,
    erreurs: d.user ? H.revision : 0,
    parties: d.user && !d.chargement ? aAnalyser(d.jeux, d.index) : 0,
  });
  const corps = liste.length ? `<ul class="ac-lignes">${liste.map((t, i) => {
    const cls = `ac-action${i === 0 ? ' primaire' : ''}`;
    const nom = `aria-label="${esc(`${t.action} : ${t.n} ${t.titre}`)}"`;
    const action = t.href ? `<a class="${cls}" href="${t.href}" ${nom}><span>${t.action}</span></a>`
      : `<button type="button" class="${cls}" data-analyser ${nom}><span>${t.action}</span></button>`;
    return `<li class="ac-ligne" data-tache="${t.cle}"><b class="ac-num">${t.n}</b>
      <span class="ac-texte"><b>${t.titre}</b><span class="muted small">${t.detail}</span></span>${action}</li>`;
  }).join('')}</ul>`
    : '<p class="ac-vide"><b>Tout est à jour.</b> <span class="muted">Pour continuer : <a href="#/puzzles/theme">des puzzles par thème</a> ou <a href="#/play">une partie contre Maia</a>.</span></p>';
  return `<section class="ac-bloc ac-faire" aria-labelledby="ac-faire-t">
    <div class="ac-titre"><h2 id="ac-faire-t">À faire aujourd’hui</h2>${liste.length ? `<span class="muted small">${plural(liste.length, 'activité')}</span>` : ''}</div>${corps}</section>`;
}

function blocParties(d) {
  let corps;
  if (!d.user) corps = '<p class="ac-vide muted">Indiquez votre pseudo chess.com dans <a href="#/settings/profile">Paramètres → Profil</a> pour voir vos parties.</p>';
  else if (!d.jeux.length || d.chargement) {
    corps = `<p class="ac-vide muted" role="status">${d.chargement ? 'Récupération de vos parties…' : 'Aucune partie récupérée pour le moment. <a href="#/games">Ouvrir l’historique</a>'}</p>`;
  } else {
    corps = `<ul class="ac-lignes">${dernieresParties(d.jeux, d.index, d.user).map((p) => `
      <li><a class="ac-partie" href="#/game/${encodeURIComponent(p.id)}">
        <b class="ac-${p.issue}">${ISSUES[p.issue]}</b>
        <span class="ac-adv"><i class="color-dot ${p.camp}" role="img" aria-label="${p.camp === 'w' ? 'Avec les Blancs' : 'Avec les Noirs'}"></i><span>${esc(p.adversaire)}</span></span>
        <span class="muted small ac-cad">${CADENCES[p.cadence] || esc(p.cadence)} · ${fmtGameDate(p.end * 1000)}</span>
        <span class="small ac-prec">${p.precision == null ? '<span class="ac-todo">à analyser</span>' : fmtPct(p.precision, 1)}</span></a></li>`).join('')}</ul>`;
  }
  return `<section class="ac-bloc ac-parties" aria-labelledby="ac-parties-t">
    <div class="ac-titre"><h2 id="ac-parties-t">Dernières parties</h2><a class="small" href="#/games">Tout l’historique</a></div>${corps}</section>`;
}

// Dernière étude ouverte sur cet appareil (à défaut, la dernière modifiée) et dernière finale consultée.
function blocReprendre(d) {
  const etude = d.etudes.find((s) => s.id === local.get('studyLastOpened')) || d.etudes[0];
  let html = '';
  if (etude?.chapters.length) {
    const i = Math.max(0, etude.chapters.findIndex((c) => c.id === local.get('studyLast:' + etude.id)));
    const c = etude.chapters[i];
    const fen = (/\[FEN "([^"]+)"\]/.exec(c.pgn) || [])[1];
    html += `<a class="ac-etude" href="#/study/${encodeURIComponent(etude.id)}/${encodeURIComponent(c.id)}">
      ${miniBoard((fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR').split(' ')[0], 112, { orient: c.orientation })}
      <span class="ac-texte"><b>${esc(etude.name)}</b><span class="muted small">Étude · chapitre ${i + 1} sur ${etude.chapters.length}</span><span class="small ac-todo">Ouvrir le chapitre</span></span></a>`;
  }
  let finale = null;
  try { finale = JSON.parse(local.get('finaleDerniere', 'null')); } catch { finale = null; }
  if (finale?.id && finale.titre) {
    html += `<a class="ac-lien" href="#/endgames/cours/${encodeURIComponent(finale.id)}"><span class="ac-texte"><b>${esc(finale.titre)}</b><span class="muted small">Dernière finale consultée</span></span><span class="muted" aria-hidden="true">›</span></a>`;
  }
  if (!html) html = '<p class="muted small">Ouvrez une <a href="#/study">étude</a> ou un <a href="#/endgames">cours de finales</a> : vous pourrez le reprendre d’ici.</p>';
  return `<section class="ac-bloc ac-reprendre" aria-labelledby="ac-reprendre-t"><div class="ac-titre"><h2 id="ac-reprendre-t">Reprendre</h2></div><div class="ac-corps">${html}</div></section>`;
}

const jauge = (titre, droite, pct, label, cls = '') => `<div><div class="ac-mesure"><span>${titre}</span><span class="muted">${droite}</span></div>
  <div class="ac-jauge ${cls}" role="img" aria-label="${label}"><span style="width:${pct}%"></span></div></div>`;
const chiffre = (valeur, nom) => `<div class="ac-chiffre"><b>${valeur}</b><span class="small">${nom}</span></div>`;

function blocProgression(d) {
  const elo = d.user && !d.chargement ? dernierElo(d.jeux, d.user) : null;
  let html = '';
  const chiffres = [d.stats && chiffre(d.stats.elo, 'Niveau puzzles'), elo && chiffre(esc(elo.elo), `Elo ${CADENCES[elo.cadence] || esc(elo.cadence)}`)].filter(Boolean);
  if (chiffres.length) html += `<div class="ac-chiffres">${chiffres.join('')}</div>`;
  if (elo) {
    const r = resultatsRecents(d.jeux, d.user);
    const phrase = `${plural(r.win, 'victoire')} · ${plural(r.draw, 'nulle')} · ${plural(r.loss, 'défaite')}`;
    html += `<div><div class="ac-mesure"><span>Résultats sur ${JOURS_RECENTS} jours</span><span class="muted">${plural(r.total, 'partie')}</span></div>
      ${r.total ? `<div class="ac-resultats" aria-hidden="true">${['win', 'draw', 'loss'].map((k) => (r[k] ? `<span class="ac-fond-${k}" style="flex:${r[k]}"></span>` : '')).join('')}</div><div class="small ac-detail">${phrase}</div>` : ''}</div>`;
  }
  const m = d.ouvertures?.maitrise;
  if (m != null) html += jauge('Répertoires maîtrisés', `${m} %`, m, `${m} % des positions maîtrisées`);
  const w = d.woodpecker;
  if (w) html += jauge(`Woodpecker, cycle ${w.cycle} sur ${w.cycles}`, `${w.faits} / ${w.total}`, w.total ? Math.round((100 * w.faits) / w.total) : 0, `${w.faits} puzzles faits sur ${w.total}`, 'bleu');
  return `<section class="ac-bloc ac-progres" aria-labelledby="ac-progres-t"><div class="ac-titre"><h2 id="ac-progres-t">Progression</h2><a class="small" href="#/stats">Statistiques</a></div><div class="ac-corps">${html || '<p class="muted small">Vos résultats apparaîtront ici.</p>'}</div></section>`;
}

// Les icônes sont celles du menu : une seule source.
function blocModules(d) {
  const o = d.ouvertures;
  const modules = [
    ['play', 'Jouer', 'Contre Maia, de 600 à 2 800 Elo'],
    ['free', 'Analyse libre', 'Une position ou une idée à tester'],
    ['study', 'Étude', d.etudes.length ? `${plural(d.etudes.length, 'étude')} · import PGN` : 'Créer ou importer un PGN'],
    ['openings', 'Ouvertures', o?.repertoires ? `${plural(o.repertoires, 'répertoire')} · ${plural(o.coups, 'coup')}` : 'Construire votre répertoire'],
    ['puzzles', 'Puzzles', 'Woodpecker, thèmes, recommandés'],
    ['strategy', 'Erreurs stratégiques', d.erreurs ? `${plural(d.erreurs, 'erreur')} sur les ${d.periode} derniers jours` : 'Les plans manqués dans vos parties'],
    ['endgames', 'Finales', '120 études, puzzles, vos finales'],
    ['stats', 'Statistiques', 'Votre progression sur 30 ou 90 jours'],
    ['games', 'Historique des parties', 'Vos parties chess.com'],
  ];
  return `<section aria-labelledby="ac-modules-t"><h2 id="ac-modules-t" class="ac-h2">Tous les modules</h2>
    <div class="ac-modules">${modules.map(([k, nom, desc]) => {
      const icone = document.querySelector(`#sidebar a[data-tab="${k}"] svg`);
      return `<a class="ac-module" href="#/${k}">${icone ? icone.outerHTML : ''}<span><b>${nom}</b><span class="muted small">${desc}</span></span></a>`;
    }).join('')}</div></section>`;
}

function page(d) {
  if (premiereFois(d)) return bienvenue();
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `
    <header class="ac-head">
      <div><h1 class="page-title">Accueil</h1>
        <p class="muted"><span class="ac-date">${date}</span>${d.user ? ` · ${esc(d.user)}` : ''} · <span id="ac-sync">${ligneSync()}</span></p></div>
      <div class="ac-boutons"><a class="btn" href="#/free">Analyse libre</a><a class="btn" href="#/play">Jouer contre Maia</a></div>
    </header>
    <div class="ac-colonnes">
      <div class="ac-gauche">${blocTaches(d)}${blocParties(d)}</div>
      <div class="ac-droite">${blocReprendre(d)}${blocProgression(d)}</div>
    </div>
    ${blocModules(d)}`;
}

// ------------------------------------------------------------------ affichage
async function rendre() {
  const seq = ++H.seq;
  const d = await charger();
  if (seq !== H.seq || !H.el) return;
  const focus = H.el.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
  H.el.innerHTML = `<div class="ac">${page(d)}</div>`;
  if (!d.chargement) compterRevision(d.user);
  const analyser = $('[data-analyser]', H.el);
  if (analyser) analyser.onclick = () => ouvrirAnalyseStrategique(JOURS_RECENTS);
  if (focus) H.el.querySelector(`[href="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}

// Les enregistrements arrivent souvent en rafale (synchronisation, analyse multiple).
const rafraichir = () => { clearTimeout(H.timer); H.timer = setTimeout(rendre, 500); };

export function show(el) {
  $('#topbar-soon').textContent = 'Accueil';
  if (!H.el) {
    H.el = el;
    H.offStore = store.onChange(rafraichir);
    H.offSync = onSync(() => { const s = $('#ac-sync'); if (s) s.textContent = ligneSync(); });
    window.addEventListener('cj:games', rafraichir);
  }
  if (!el.firstChild) el.innerHTML = '<h1 class="page-title">Accueil</h1><p class="muted" role="status">Chargement…</p>';
  return rendre();
}

export function leave() {
  if (!H.el) return;
  H.el = null;
  H.seq++;
  clearTimeout(H.timer);
  H.offStore?.();
  H.offSync?.();
  window.removeEventListener('cj:games', rafraichir);
}
