// Pure helpers shared by the app and the tests.

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

// Local date, not UTC: a board made at 11pm belongs to today.
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newBoard(d = new Date()) {
  const now = d.toISOString();
  return { id: uid(), date: today(d), title: '', createdAt: now, updatedAt: now, items: [] };
}

export const boardName = (b) => b.title?.trim() || b.date;

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)(\?.*)?$/i;

export function parseUrl(s) {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function youtubeId(u) {
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
    return m ? m[1] : null;
  }
  return null;
}

export function vimeoId(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const m = u.pathname.match(/\/(\d+)/);
  return m ? m[1] : null;
}

// Turn whatever was pasted or typed into a tile, minus size and id.
export function classify(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return { type: 'color', hex: s.toLowerCase() };
  const u = parseUrl(s);
  if (!u) return { type: 'text', text: s, font: 'sans', size: 'body' };
  const yt = youtubeId(u);
  if (yt) return { type: 'embed', provider: 'youtube', videoId: yt, url: u.href };
  const vm = vimeoId(u);
  if (vm) return { type: 'embed', provider: 'vimeo', videoId: vm, url: u.href };
  if (IMAGE_EXT.test(u.pathname)) return { type: 'image', src: u.href, fit: 'cover' };
  if (VIDEO_EXT.test(u.pathname)) return { type: 'video', src: u.href };
  return { type: 'link', url: u.href, site: u.hostname.replace(/^www\./, '') };
}

// The size a fresh tile starts at.
export function defaultSize(item) {
  if (item.type === 'text') return item.size === 'body' ? { w: 1, h: 1 } : { w: 2, h: 1 };
  if (item.type === 'embed' || item.type === 'video') return { w: 2, h: 1 };
  return { w: 1, h: 1 };
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    return fn(...a);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}
