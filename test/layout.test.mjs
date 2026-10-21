import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, columnsFor, clampSize, reorderTarget, move, MAX_SPAN } from '../public/layout.js';

const items = (...sizes) => sizes.map(([w, h], i) => ({ id: `t${i}`, w, h }));
const at = (r, id) => r.positions.get(id);

test('columns follow the viewport: phone 2, desktop 7–8', () => {
  assert.equal(columnsFor(358), 2);
  assert.equal(columnsFor(736), 4);
  assert.equal(columnsFor(1400), 7);
  assert.equal(columnsFor(4000), 8);
  assert.equal(columnsFor(0), 2);
});

test('equal squares fill rows left to right', () => {
  const r = pack(items([1, 1], [1, 1], [1, 1], [1, 1], [1, 1]), 4);
  assert.deepEqual(at(r, 't3'), { x: 3, y: 0, w: 1, h: 1 });
  assert.deepEqual(at(r, 't4'), { x: 0, y: 1, w: 1, h: 1 });
  assert.equal(r.rows, 2);
});

test('growing a tile pushes its neighbours along', () => {
  const before = pack(items([1, 1], [1, 1], [1, 1]), 3);
  assert.deepEqual(at(before, 't1'), { x: 1, y: 0, w: 1, h: 1 });
  const after = pack(items([2, 2], [1, 1], [1, 1]), 3);
  assert.deepEqual(at(after, 't1'), { x: 2, y: 0, w: 1, h: 1 });
  assert.deepEqual(at(after, 't2'), { x: 2, y: 1, w: 1, h: 1 });
});

test('small tiles fill the hole a big one leaves', () => {
  const r = pack(items([1, 1], [3, 1], [1, 1]), 3);
  // t1 cannot fit beside t0, so it drops a row; t2 back-fills beside t0.
  assert.deepEqual(at(r, 't1'), { x: 0, y: 1, w: 3, h: 1 });
  assert.deepEqual(at(r, 't2'), { x: 1, y: 0, w: 1, h: 1 });
});

test('no two tiles overlap, at any column count', () => {
  const list = items([2, 2], [1, 3], [3, 1], [1, 1], [4, 2], [2, 1], [1, 1], [1, 2]);
  for (const cols of [2, 3, 4, 5, 8]) {
    const r = pack(list, cols);
    const seen = new Set();
    for (const p of r.positions.values()) {
      assert.ok(p.x + p.w <= cols);
      for (let y = p.y; y < p.y + p.h; y++)
        for (let x = p.x; x < p.x + p.w; x++) {
          assert.ok(!seen.has(`${x},${y}`), `overlap at ${x},${y} with ${cols} cols`);
          seen.add(`${x},${y}`);
        }
    }
  }
});

test('a tile wider than the screen is narrowed, not dropped', () => {
  const r = pack(items([6, 2]), 2);
  assert.deepEqual(at(r, 't0'), { x: 0, y: 0, w: 2, h: 2 });
});

test('clampSize keeps spans within the grid', () => {
  assert.deepEqual(clampSize(0, 0, 4), { w: 1, h: 1 });
  assert.deepEqual(clampSize(9, 99, 4), { w: 4, h: MAX_SPAN });
  assert.deepEqual(clampSize(2.4, 1.6, 4), { w: 2, h: 2 });
});

test('dragging over a tile takes its place in the order', () => {
  const list = items([1, 1], [1, 1], [1, 1], [1, 1]);
  const r = pack(list, 4);
  assert.equal(reorderTarget(list, r.positions, 't0', 2, 0, r.rows), 2);
  assert.deepEqual(move(list, 0, 2).map((i) => i.id), ['t1', 't2', 't0', 't3']);
});

test('dragging below everything sends a tile to the end; over a hole it stays', () => {
  const list = items([1, 1], [3, 1], [1, 1]);
  const r = pack(list, 4);
  assert.equal(reorderTarget(list, r.positions, 't0', 0, 9, r.rows), 2);
  assert.equal(reorderTarget(list, r.positions, 't0', 3, 1, r.rows), 0);
});
