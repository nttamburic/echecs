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

export function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
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
