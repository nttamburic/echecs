// Répétition espacée (variante simple de SM-2), partagée par les modules d'entraînement.
// État d'une carte : { due (ms), interval (jours), ease, reps, lapses }.
const DAY = 86400000;

export function newCard() { return { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 }; }

// grade : 'again' (raté), 'hard' (trouvé avec hésitation), 'good' (trouvé), 'easy' (évident)
export function review(card, grade, now = Date.now()) {
  const c = { ...(card || newCard()) };
  if (grade === 'again') {
    c.lapses++;
    c.reps = 0;
    c.interval = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = now + 10 * 60000; // à revoir dans 10 minutes
    return c;
  }
  c.reps++;
  if (grade === 'hard') c.ease = Math.max(1.3, c.ease - 0.15);
  if (grade === 'easy') c.ease += 0.15;
  if (c.reps === 1) c.interval = grade === 'easy' ? 3 : 1;
  else if (c.reps === 2) c.interval = grade === 'hard' ? 2 : grade === 'easy' ? 6 : 3;
  else c.interval = Math.round(c.interval * (grade === 'hard' ? 1.2 : c.ease) * (grade === 'easy' ? 1.3 : 1));
  c.due = startOfDay(now) + c.interval * DAY;
  return c;
}

export const isDue = (card, now = Date.now()) => !card || card.due <= now;

export function startOfDay(t) { const d = new Date(t); d.setHours(4, 0, 0, 0); return d.getTime(); }
