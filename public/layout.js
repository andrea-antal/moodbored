// Grid layout. Pure functions, no DOM, so test/layout.test.mjs imports this file.
//
// A board is an ordered list of tiles, each w × h square cells. Positions are
// never stored: they are packed fresh from that order for whatever column count
// the viewport allows. Growing a tile pushes its neighbours along; shrinking one
// lets later tiles flow back into the space. Moving a tile is a change of order.

export const MIN_COLS = 2;
export const MAX_COLS = 8;
export const MAX_SPAN = 6;
// The width one column aims for. 390px phone → 2, tablet → 4, desktop → 7 or 8.
export const TARGET_CELL = 190;

export function columnsFor(width) {
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(width / TARGET_CELL)));
}

export function clampSize(w, h, cols) {
  return {
    w: Math.max(1, Math.min(cols, Math.round(w) || 1)),
    h: Math.max(1, Math.min(MAX_SPAN, Math.round(h) || 1)),
  };
}

// Dense first-fit: each tile, in order, takes the first free spot scanning
// top-to-bottom, left-to-right. A small tile later in the list fills a hole an
// earlier large one left, so boards stay tidy without manual placement.
export function pack(items, cols) {
  const rows = [];
  const free = (x, y, w, h) => {
    for (let r = y; r < y + h; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = x; c < x + w; c++) if (row[c]) return false;
    }
    return true;
  };
  const fill = (x, y, w, h) => {
    for (let r = y; r < y + h; r++) {
      if (!rows[r]) rows[r] = new Uint8Array(cols);
      for (let c = x; c < x + w; c++) rows[r][c] = 1;
    }
  };

  const positions = new Map();
  let height = 0;
  for (const item of items) {
    const { w, h } = clampSize(item.w, item.h, cols);
    let placed = false;
    for (let y = 0; !placed; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (free(x, y, w, h)) {
          fill(x, y, w, h);
          positions.set(item.id, { x, y, w, h });
          height = Math.max(height, y + h);
          placed = true;
          break;
        }
      }
    }
  }
  return { positions, rows: height };
}

// The tile covering cell (x, y), or null.
export function itemAt(positions, x, y, skipId) {
  for (const [id, p] of positions) {
    if (id === skipId) continue;
    if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return id;
  }
  return null;
}

// Where a dragged tile should sit in the order when its centre is over cell
// (x, y). Over another tile → take that tile's place. Over empty space below
// everything → go last. Over a hole → stay put.
export function reorderTarget(items, positions, dragId, x, y, rows) {
  const over = itemAt(positions, x, y, dragId);
  if (over) return items.findIndex((it) => it.id === over);
  if (y >= rows) return items.length - 1;
  return items.findIndex((it) => it.id === dragId);
}

export function move(items, from, to) {
  if (from === to || from < 0 || to < 0) return items;
  const next = items.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}
