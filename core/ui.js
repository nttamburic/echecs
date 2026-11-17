// Petits utilitaires d'interface partagés par tous les modules.
import { CLASSES } from '../analysis.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fr1 = (x) => (x == null ? '–' : x.toFixed(1).replace('.', ','));
export const uciOf = (m) => m.from + m.to + (m.promotion || '');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Réglages propres à cet appareil (jamais synchronisés).
export const local = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } },
  set(k, v) { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};

// Notification passagère. toast(msg, { type: 'ok' | 'err' | 'info', action: { label, fn }, ms }).
// Un nombre en second argument vaut { ms } (ancien appel). Cinq secondes, deux lignes au plus ;
// les erreurs et les toasts à action restent plus longtemps et se mettent en pause au survol ou au focus.
const GLYPH = { ok: '✓', err: '!', info: 'i' };
export function toast(msg, o = {}) {
  if (typeof o === 'number') o = { ms: o };
  const type = o.type || (/impossible|erreur|introuvable|échou|refusé/i.test(msg) ? 'err' : 'ok');
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="tg" aria-hidden="true">${GLYPH[type]}</span><span class="tm">${msg}</span>`;
  t.title = t.querySelector('.tm').textContent;
  let timer;
  const close = () => { clearTimeout(timer); t.classList.remove('in'); setTimeout(() => t.remove(), 220); };
  if (o.action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ta'; b.textContent = o.action.label;
    b.onclick = () => { close(); o.action.fn(); };
    t.append(b);
  }
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, o.ms || (type === 'err' || o.action ? 8000 : 5000)); };
  t.addEventListener('mouseenter', () => clearTimeout(timer)); t.addEventListener('mouseleave', arm);
  t.addEventListener('focusin', () => clearTimeout(timer)); t.addEventListener('focusout', arm);
  box.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  arm();
  return close;
}

// Rend un élément cliquable (span, div) utilisable au clavier : Entrée ou Espace le « clique ».
// L'élément doit aussi avoir role="button" et tabindex="0" dans son HTML.
export function keyActivate(el) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
  });
}

export function badge(cls, small = false) {
  const c = CLASSES[cls];
  if (!c) return '';
  return `<span class="badge${small ? ' small' : ''}" style="background:${c.color}" title="${c.label}">${c.sym}</span>`;
}

export async function fetchJson(url, { timeout = 15000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const body = r.ok ? await r.json().catch(() => null) : await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, body };
  } catch (e) {
    return { status: 0, ok: false, body: null, error: String(e) };
  } finally { clearTimeout(timer); }
}

export const isMobile = () => matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
