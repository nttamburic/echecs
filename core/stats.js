// Statistiques (sans DOM, testé avec node) : résultats, Elo, précision, fautes par phase, conversion,
// sauvetage et temps. On ne compare le joueur qu'à ses propres périodes passées. Rien n'est enregistré.
import { Chess } from '../vendor/chess.js';
import { classifyGame, summarize, winPct, epd } from '../analysis.js';
import { issue } from './accueil.js';
import { phase, PHASES } from './manu/erreurs.js';
import { couleurDe, SEUIL_GAGNANT } from './revision.js';
import { tempsDePartie, reperesDe, SEUILS_VITE } from './temps.js';

export const PERIODES_STATS = Object.freeze([30, 90]);
export const MINIMUM = 10; // en dessous : « peu de données », aucune tendance
export const SEUIL_MAUVAIS = 100 - SEUIL_GAGNANT; // « position très mauvaise » : au plus 20 %
const FAUTES = ['mistake', 'miss', 'blunder'];
const JOUR = 86400000;

// Période en cours (rang 0) ou période précédente de même durée (rang 1).
export function bornes(jours, maintenant = Date.now(), rang = 0) {
  return { debut: maintenant - (rang + 1) * jours * JOUR, fin: maintenant - rang * jours * JOUR };
}
export function jeuxDe(jeux, user, { debut, fin }, cadence = '') {
  return jeux.filter((g) => g.end * 1000 > debut && g.end * 1000 <= fin && couleurDe(g, user) && (!cadence || g.timeClass === cadence));
}

// Cadences jouées, la plus jouée d'abord.
export function cadencesJouees(jeux) {
  const n = new Map();
  for (const g of jeux) n.set(g.timeClass, (n.get(g.timeClass) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([cadence, total]) => ({ cadence, total }));
}

// ------------------------------------------------------------------ résultats et Elo (sans analyse)
export function resultats(jeux, user) {
  const r = { total: 0, win: 0, draw: 0, loss: 0, score: null };
  for (const g of jeux) { r[issue(g, user)]++; r.total++; }
  if (r.total) r.score = (100 * (r.win + r.draw / 2)) / r.total;
  return r;
}

export function grouperResultats(jeux, user, cle) {
  const groupes = new Map();
  for (const g of jeux) {
    const k = cle(g);
    if (k == null) continue;
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(g);
  }
  return [...groupes].map(([k, l]) => ({ cle: k, ...resultats(l, user) })).sort((a, b) => b.total - a.total || String(a.cle).localeCompare(String(b.cle)));
}

// Elo après chaque partie classée, par cadence et dans l'ordre du temps.
export function seriesElo(jeux, user) {
  const out = new Map();
  for (const g of [...jeux].sort((a, b) => a.end - b.end)) {
    const camp = couleurDe(g, user);
    const elo = camp && (camp === 'w' ? g.white : g.black).rating;
    if (g.rated === false || !Number.isFinite(elo)) continue;
    if (!out.has(g.timeClass)) out.set(g.timeClass, []);
    out.get(g.timeClass).push({ t: g.end * 1000, v: elo });
  }
  return out;
}

// Moyennes par tranches de 7 jours comptées depuis la fin ; les tranches vides sont omises.
export function parSemaine(points, { debut, fin }) {
  const s = new Map();
  for (const p of points) {
    if (p.t <= debut || p.t > fin) continue;
    const i = Math.floor((fin - p.t) / (7 * JOUR));
    if (!s.has(i)) s.set(i, []);
    s.get(i).push(p.v);
  }
  return [...s].sort((a, b) => b[0] - a[0]).map(([i, l]) => ({
    debut: Math.max(debut, fin - (i + 1) * 7 * JOUR), fin: fin - i * 7 * JOUR,
    moyenne: l.reduce((a, b) => a + b, 0) / l.length, n: l.length,
  }));
}

// ------------------------------------------------------------------ une partie
export function lirePartie(game) {
  const chess = new Chess();
  try { chess.loadPgn(game.pgn); } catch { return null; }
  const coups = chess.history({ verbose: true });
  let courante = 'ouverture';
  return { chess, coups, phases: coups.map((c) => (courante = phase(c.before, courante))) };
}

// Famille d'ouverture : dernière position connue de la théorie, sans la variante.
export function familleOuverture(nom) {
  return nom ? nom.split(':')[0].trim() : null;
}
export function ouvertureDe(coups, book) {
  let nom = null;
  for (const c of coups) { const o = book[epd(c.after)]; if (o?.length) nom = o[1]; }
  return nom;
}

const vide = () => Object.fromEntries(PHASES.map((p) => [p, 0]));

// Temps passé par le joueur dans chaque phase, d'après les pendules (sans analyse). null sans pendule.
export function tempsParPhase(partie, game, user) {
  const camp = couleurDe(game, user);
  const temps = camp && tempsDePartie(partie.chess, game);
  if (!temps) return null;
  const out = { secondes: vide(), coups: vide() };
  partie.coups.forEach((c, i) => {
    if (c.color !== camp || temps.passe[i] == null) return;
    out.secondes[partie.phases[i]] += temps.passe[i];
    out.coups[partie.phases[i]]++;
  });
  return out;
}

// Une situation compte si elle est vraie à un tour du joueur et encore à son tour suivant (ou si la
// partie s'arrête avant) : la même règle que « Convertir l'avantage ».
function situation(coups, positions, camp, test) {
  const vrai = (i) => {
    const s = positions[i]?.lines?.[0]?.score;
    return !!s && test(winPct(s, camp));
  };
  return coups.some((c, i) => c.color === camp && vrai(i) && (i + 2 >= coups.length || vrai(i + 2)));
}

// Mesures d'une partie entièrement analysée, du point de vue du joueur. null sinon.
export function mesurePartie(data, user, book = {}, partie = lirePartie(data.game)) {
  const game = data.game;
  const camp = couleurDe(game, user);
  const positions = data.positions;
  if (!camp || !partie?.coups.length || positions?.length !== partie.coups.length || !positions.every(Boolean)) return null;
  const { coups, phases } = partie;
  const classes = classifyGame(coups, positions, { w: game.white?.rating, b: game.black?.rating }, book);
  const precision = summarize(coups, classes)[camp].accuracy;
  const joues = vide(), fautes = vide();
  coups.forEach((c, i) => {
    if (c.color !== camp) return;
    joues[phases[i]]++;
    if (FAUTES.includes(classes[i]?.cls)) fautes[phases[i]]++;
  });
  const resultat = issue(game, user);
  const temps = tempsDePartie(partie.chess, game);
  let pendule = null;
  if (temps) {
    const reperes = reperesDe(temps, coups, classes, camp, { cadence: game.timeClass, book });
    // seules les fautes dont on connaît le temps comptent au dénominateur
    const connues = coups.filter((c, i) => c.color === camp && FAUTES.includes(classes[i]?.cls) && temps.avant[i] != null).length;
    pendule = {
      fautes: connues,
      manque: reperes.filter((r) => r.repere === 'manque').length,
      vite: reperes.filter((r) => r.repere === 'vite').length,
      fautesVite: SEUILS_VITE[game.timeClass] ? connues : 0, // « trop vite » n'existe qu'en rapide et blitz
    };
  }
  return {
    id: game.id, end: game.end, precision: Number.isFinite(precision) ? precision : null, coups: joues, fautes,
    gagnante: situation(coups, positions, camp, (w) => w >= SEUIL_GAGNANT), gagnee: resultat === 'win',
    mauvaise: situation(coups, positions, camp, (w) => w <= SEUIL_MAUVAIS), sauvee: resultat !== 'loss',
    pendule,
  };
}

// ------------------------------------------------------------------ une période
const part = (n, total) => ({ n, total, pct: total ? (100 * n) / total : null });
const somme = (liste, f) => liste.reduce((a, x) => a + f(x), 0);

export function agreger(mesures) {
  const precisions = mesures.filter((m) => m.precision != null);
  const gagnantes = mesures.filter((m) => m.gagnante);
  const mauvaises = mesures.filter((m) => m.mauvaise);
  const horloge = mesures.filter((m) => m.pendule);
  const manque = somme(horloge, (m) => m.pendule.manque), vite = somme(horloge, (m) => m.pendule.vite);
  return {
    parties: mesures.length,
    precision: precisions.length ? somme(precisions, (m) => m.precision) / precisions.length : null,
    phases: Object.fromEntries(PHASES.map((p) => {
      const coups = somme(mesures, (m) => m.coups[p]), fautes = somme(mesures, (m) => m.fautes[p]);
      return [p, { coups, fautes, parties: mesures.filter((m) => m.coups[p]).length, pour100: coups ? (100 * fautes) / coups : null }];
    })),
    conversion: part(gagnantes.filter((m) => m.gagnee).length, gagnantes.length),
    sauvetage: part(mauvaises.filter((m) => m.sauvee).length, mauvaises.length),
    temps: {
      parties: horloge.length,
      manque: part(manque, somme(horloge, (m) => m.pendule.fautes)),
      vite: part(vite, somme(horloge, (m) => m.pendule.fautesVite)),
    },
  };
}

export function moyenneTemps(liste) {
  return Object.fromEntries(PHASES.map((p) => {
    const coups = somme(liste, (t) => t.coups[p]);
    return [p, coups ? somme(liste, (t) => t.secondes[p]) / coups : null];
  }));
}

// Écart avec la période précédente, seulement si les deux échantillons sont assez grands.
export function ecart(actuel, precedent, nActuel, nPrecedent, minimum = MINIMUM) {
  return actuel != null && precedent != null && nActuel >= minimum && nPrecedent >= minimum ? actuel - precedent : null;
}
