// Storage. Two adapters with one shape:
//
//   server — when the page is served by server.mjs. Boards are JSON files and
//            media are plain files under data/, so your phone sees what your
//            desktop saved.
//   local  — anywhere else (a static host, a preview). IndexedDB in this
//            browser only. Media are Blobs, referenced from tiles as "media:<id>".

import { uid } from './util.js';

export function summarize(board) {
  const covers = [];
  for (const it of board.items) {
    if (covers.length >= 4) break;
    if (it.type === 'image' && it.src) covers.push(it.src);
    else if (it.type === 'link' && it.image) covers.push(it.image);
    else if (it.type === 'embed' && it.provider === 'youtube') covers.push(`https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg`);
  }
  return {
    id: board.id,
    date: board.date,
    title: board.title || '',
    updatedAt: board.updatedAt,
    count: board.items.length,
    covers,
  };
}

const byRecent = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '');

// ---------- server ----------

function serverStore() {
  const json = async (res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  };
  return {
    kind: 'server',
    list: () => fetch('api/boards').then(json),
    get: (id) => fetch(`api/boards/${encodeURIComponent(id)}`).then((r) => (r.status === 404 ? null : json(r))),
    save: (board) =>
      fetch(`api/boards/${encodeURIComponent(board.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(board),
      }).then(json),
    remove: (id) => fetch(`api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(json),
    putMedia: async (blob) => {
      const res = await fetch('api/media', {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        body: blob,
      });
      return (await json(res)).src;
    },
    resolve: async (src) => src,
    unfurl: async (url) => {
      try {
        const res = await fetch(`api/unfurl?url=${encodeURIComponent(url)}`);
        return res.ok ? res.json() : null;
      } catch {
        return null;
      }
    },
  };
}

// ---------- local ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('moodbored', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('boards', { keyPath: 'id' });
      db.createObjectStore('media', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function localStore() {
  const dbp = openDb();
  const tx = async (store, mode, fn) => {
    const db = await dbp;
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  };
  const urls = new Map();

  return {
    kind: 'local',
    list: async () => (await tx('boards', 'readonly', (s) => s.getAll())).map(summarize).sort(byRecent),
    get: async (id) => (await tx('boards', 'readonly', (s) => s.get(id))) ?? null,
    save: async (board) => {
      await tx('boards', 'readwrite', (s) => s.put(board));
      return { ok: true };
    },
    remove: async (id) => {
      const board = await tx('boards', 'readonly', (s) => s.get(id));
      const refs = (board?.items ?? []).map((it) => it.src).filter((s) => s?.startsWith('media:'));
      await tx('media', 'readwrite', (s) => refs.forEach((r) => s.delete(r.slice(6))));
      await tx('boards', 'readwrite', (s) => s.delete(id));
      return { ok: true };
    },
    putMedia: async (blob) => {
      const id = uid();
      await tx('media', 'readwrite', (s) => s.put({ id, blob }));
      return `media:${id}`;
    },
    resolve: async (src) => {
      if (!src?.startsWith('media:')) return src;
      if (!urls.has(src)) {
        const rec = await tx('media', 'readonly', (s) => s.get(src.slice(6)));
        urls.set(src, rec ? URL.createObjectURL(rec.blob) : '');
      }
      return urls.get(src);
    },
    // A browser cannot read another site's HTML, so local mode shows the domain only.
    unfurl: async () => null,
  };
}

export async function openStore() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch('api/health', { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok && (await res.json()).app === 'moodbored') return serverStore();
  } catch {}
  return localStore();
}
