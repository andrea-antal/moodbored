// Starts the real server on a spare port against a temp data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverAlive } from '../public/store.js';

const PORT = 4799;
const base = `http://127.0.0.1:${PORT}`;
let proc, dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moodbored-'));
  proc = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT, MOODBORED_DATA: dir }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(async () => {
  proc.kill();
  await rm(dir, { recursive: true, force: true });
});

test('serves the app', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /moodbored/);
});

test('boards round-trip and list newest first', async () => {
  const put = (b) => fetch(`${base}/api/boards/${b.id}`, { method: 'PUT', body: JSON.stringify(b) });
  assert.equal((await put({ id: 'a1', date: '2026-10-20', updatedAt: '2026-10-20T10:00:00Z', items: [] })).status, 200);
  assert.equal((await put({ id: 'b2', date: '2026-10-21', updatedAt: '2026-10-21T10:00:00Z', items: [{ type: 'text' }] })).status, 200);
  const list = await (await fetch(`${base}/api/boards`)).json();
  assert.deepEqual(list.map((b) => b.id), ['b2', 'a1']);
  assert.equal((await (await fetch(`${base}/api/boards/b2`)).json()).items.length, 1);
  await fetch(`${base}/api/boards/a1`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/api/boards/a1`)).status, 404);
});

test('rejects bad ids and mismatched bodies', async () => {
  assert.equal((await fetch(`${base}/api/boards/bad.id`)).status, 400);
  assert.equal((await fetch(`${base}/api/boards/..%2F..%2Fetc`)).status, 404);
  const res = await fetch(`${base}/api/boards/x1`, { method: 'PUT', body: JSON.stringify({ id: 'other', items: [] }) });
  assert.equal(res.status, 400);
});

test('stores media and serves it back', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const { src } = await (await fetch(`${base}/api/media`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png })).json();
  assert.match(src, /^media\/[\w-]+\.png$/);
  const back = await fetch(`${base}/${src}`);
  assert.equal(back.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await back.arrayBuffer()), png);
  const bad = await fetch(`${base}/api/media`, { method: 'POST', headers: { 'content-type': 'text/html' }, body: 'x' });
  assert.equal(bad.status, 415);
});

test('static files cannot escape public/', async () => {
  const res = await fetch(`${base}/..%2Fserver.mjs`);
  assert.notEqual(res.status, 200);
});

test('unfurl refuses internal targets', async () => {
  const res = await fetch(`${base}/api/unfurl?url=${encodeURIComponent('http://127.0.0.1:' + PORT)}`);
  assert.equal(res.status, 422);
});

test('serverAlive: yes while the server runs, no when nothing answers', async () => {
  assert.equal(await serverAlive(`${base}/api/health`), true);
  assert.equal(await serverAlive(`${base}/api/nope`), false);
  assert.equal(await serverAlive('http://127.0.0.1:4798/api/health'), false);
});
