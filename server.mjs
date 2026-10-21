#!/usr/bin/env node
// moodbored server. No dependencies.
//
//   node server.mjs          → http://127.0.0.1:4700, this machine only
//   node server.mjs --lan    → also reachable from your phone on the same Wi-Fi
//
// Boards live in data/boards/<id>.json, uploads in data/media/. Back up data/.

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, readdir, unlink, stat, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseMeta, isPublicHost } from './lib/unfurl.mjs';
import { summarize } from './public/store.js';

const ROOT = resolve(import.meta.dirname);
const PUBLIC = join(ROOT, 'public');
const DATA = resolve(process.env.MOODBORED_DATA || join(ROOT, 'data'));
const BOARDS = join(DATA, 'boards');
const MEDIA = join(DATA, 'media');
const PORT = +process.env.PORT || 4700;
const LAN = process.argv.includes('--lan');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
const EXT = Object.fromEntries(
  Object.entries(TYPES)
    .filter(([e, t]) => /^(image|video)\//.test(t) && e !== '.jpeg')
    .map(([e, t]) => [t, e]),
);

const ID = /^[\w-]{1,64}$/;

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveFile(res, base, rel, cache) {
  const file = resolve(base, '.' + sep + rel);
  if (!file.startsWith(base + sep) && file !== base) return send(res, 403, { error: 'forbidden' });
  try {
    const s = await stat(file);
    if (s.isDirectory()) return serveFile(res, base, join(rel, 'index.html'), cache);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': s.size,
      'cache-control': cache,
    });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

async function listBoards() {
  const files = (await readdir(BOARDS)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      out.push(summarize(JSON.parse(await readFile(join(BOARDS, f), 'utf8'))));
    } catch {}
  }
  return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

async function unfurl(target) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !isPublicHost(u.hostname)) return null;
  const res = await fetch(u, {
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
    headers: { 'user-agent': 'Mozilla/5.0 (moodbored link preview)', accept: 'text/html' },
  });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return null;
  // Only the head matters; stop reading after 512 KB.
  const reader = res.body.getReader();
  let html = '';
  const dec = new TextDecoder();
  while (html.length < 512_000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  return parseMeta(html, res.url || u.href);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (path === '/api/health') return send(res, 200, { app: 'moodbored', ok: true });

  if (path === '/api/boards' && req.method === 'GET') return send(res, 200, await listBoards());

  const m = path.match(/^\/api\/boards\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (!ID.test(id)) return send(res, 400, { error: 'bad id' });
    const file = join(BOARDS, `${id}.json`);
    if (req.method === 'GET') {
      try {
        return send(res, 200, JSON.parse(await readFile(file, 'utf8')));
      } catch {
        return send(res, 404, { error: 'not found' });
      }
    }
    if (req.method === 'PUT') {
      const board = JSON.parse(await readBody(req, 5_000_000));
      if (board.id !== id || !Array.isArray(board.items)) return send(res, 400, { error: 'bad board' });
      // Write then rename, so a crash mid-write never replaces a good board.
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(board));
      await rename(tmp, file);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      await unlink(file).catch(() => {});
      return send(res, 200, { ok: true });
    }
  }

  if (path === '/api/media' && req.method === 'POST') {
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    const ext = EXT[type];
    if (!ext) return send(res, 415, { error: `unsupported type ${type}` });
    const body = await readBody(req, 100_000_000);
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(MEDIA, name), body);
    return send(res, 200, { src: `media/${name}` });
  }

  if (path === '/api/unfurl') {
    try {
      const meta = await unfurl(url.searchParams.get('url') || '');
      return meta ? send(res, 200, meta) : send(res, 422, { error: 'no preview' });
    } catch {
      return send(res, 422, { error: 'no preview' });
    }
  }

  if (path.startsWith('/media/')) return serveFile(res, MEDIA, path.slice(7), 'public, max-age=31536000, immutable');
  if (path.startsWith('/api/')) return send(res, 404, { error: 'not found' });
  return serveFile(res, PUBLIC, path.slice(1) || 'index.html', 'no-cache');
}

await mkdir(BOARDS, { recursive: true });
await mkdir(MEDIA, { recursive: true });

createServer((req, res) =>
  handle(req, res).catch((e) => {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }),
).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`moodbored → http://127.0.0.1:${PORT}`);
  if (LAN) {
    for (const nets of Object.values(networkInterfaces())) {
      for (const n of nets ?? []) if (n.family === 'IPv4' && !n.internal) console.log(`  on your phone → http://${n.address}:${PORT}`);
    }
    console.log('  Anyone on this network can open it. There is no password.');
  }
  console.log(`  data in ${DATA}`);
});
