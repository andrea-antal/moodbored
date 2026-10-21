import { columnsFor, pack, clampSize, reorderTarget, move } from './layout.js';
import { uid, today, newBoard, boardName, classify, defaultSize, debounce } from './util.js';
import { openStore } from './store.js';

const $ = (s) => document.querySelector(s);
const boardView = $('#board-view');
const libraryView = $('#library-view');
const wrap = $('#board-wrap');
const boardEl = $('#board');
const emptyEl = $('#empty');
const titleInput = $('#board-title');
const dateChip = $('#board-date');
const saveBtn = $('#save-btn');
const saveStatus = $('#save-status');
const addBtn = $('#add-btn');
const addMenu = $('#add-menu');
const urlForm = $('#url-form');
const urlInput = $('#url-input');
const fileInput = $('#file-input');
const selbar = $('#selbar');
const dropOverlay = $('#drop-overlay');
const toastEl = $('#toast');
const offlineEl = $('#offline');

const FONTS = [
  ['sans', 'Sans'],
  ['serif', 'Serif'],
  ['mono', 'Mono'],
  ['hand', 'Hand'],
];
const SIZES = [
  ['h1', 'H1'],
  ['h2', 'H2'],
  ['body', 'Body'],
];
const SWATCHES = ['#e8d5c4', '#c9d6c3', '#b8c4d6', '#d9c3cf', '#efe3b8', '#2b2b2b', '#c46a4a', '#6b7f5e'];

let store;
let board = null;
let everSaved = false; // has this board reached storage at least once?
let version = 0;
let savedVersion = 0;
let saving = null;
let saveError = false;
let lastSavedAt = null;

let cols = 6;
let gap = 12;
let positions = new Map();
let rows = 0;
const tiles = new Map(); // item id → element
let selectedId = null;
let editingId = null;
let editBefore = null;
let undoStack = [];
let redoStack = [];

// ---------- helpers ----------

const itemById = (id) => board.items.find((it) => it.id === id);
const indexOf = (id) => board.items.findIndex((it) => it.id === id);
const isPristine = (b) => !b.items.length && !b.title;
const typing = () => {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
};

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function svg(path) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = path;
  return s;
}
const ICON = {
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
};

let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(h('span', {}, msg));
  if (action) toastEl.append(h('button', { onclick: () => { action.run(); toastEl.hidden = true; } }, action.label));
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 6000 : 2500);
}

// ---------- server check ----------

// The server can stop while this tab stays open. Say so before anything else gets added.
async function checkServer() {
  if (store && !document.hidden) offlineEl.hidden = await store.alive();
}

// ---------- saving ----------

const autosave = debounce(() => save(), 900);

function changed() {
  version++;
  autosave();
  renderStatus();
}

async function save({ force = false } = {}) {
  autosave.cancel();
  if (!board) return;
  if (saving) {
    await saving;
    if (version === savedVersion) return;
  }
  // A new board stays out of storage until it holds something.
  if (!everSaved && isPristine(board)) return;
  if (!force && version === savedVersion) return;

  const v = version;
  board.updatedAt = new Date().toISOString();
  const snapshot = JSON.parse(JSON.stringify(board));
  renderStatus('saving');
  saving = store
    .save(snapshot)
    .then(() => {
      savedVersion = Math.max(savedVersion, v);
      saveError = false;
      lastSavedAt = new Date();
      if (!everSaved) {
        everSaved = true;
        // The address now names this board, so back from the list returns here.
        if (location.hash !== `#b/${board.id}`) history.replaceState(null, '', `#b/${board.id}`);
      }
    })
    .catch((e) => {
      console.error(e);
      saveError = true;
      setTimeout(() => save(), 5000);
    })
    .finally(() => {
      saving = null;
      renderStatus();
    });
  return saving;
}

function renderStatus(state) {
  saveStatus.classList.toggle('error', saveError);
  const dirty = version !== savedVersion;
  saveBtn.classList.toggle('dirty', dirty && !(!everSaved && isPristine(board)));
  if (state === 'saving') saveStatus.textContent = 'Saving…';
  else if (saveError) saveStatus.textContent = 'Not saved, retrying';
  else if (!everSaved && isPristine(board)) saveStatus.textContent = '';
  else if (dirty) saveStatus.textContent = 'Unsaved';
  else if (lastSavedAt) saveStatus.textContent = `Saved ${lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  else saveStatus.textContent = 'Saved';
}

// ---------- undo ----------

function snapshot() {
  return JSON.stringify(board.items);
}
function pushUndo(snap = snapshot()) {
  undoStack.push(snap);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
function mutate(fn) {
  pushUndo();
  fn();
  changed();
  relayout();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  board.items = JSON.parse(undoStack.pop());
  rerenderAll();
  changed();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  board.items = JSON.parse(redoStack.pop());
  rerenderAll();
  changed();
}

// ---------- layout + rendering ----------

function pitch() {
  return (boardEl.clientWidth + gap) / cols;
}

function measure() {
  cols = columnsFor(boardEl.clientWidth);
  gap = cols <= 3 ? 8 : 12;
  boardEl.style.setProperty('--cols', cols);
  boardEl.style.setProperty('--gap', `${gap}px`);
}

function relayout() {
  if (!board) return;
  ({ positions, rows } = pack(board.items, cols));
  boardEl.style.setProperty('--rows', Math.max(1, rows + 1));
  for (const [id, el] of tiles) {
    if (!positions.has(id)) {
      el.remove();
      tiles.delete(id);
    } else place(el, positions.get(id));
  }
  emptyEl.hidden = board.items.length > 0;
  if (drag?.ghost) place(drag.ghost, positions.get(drag.id));
  renderVisible();
  renderSelbar();
}

function place(el, p) {
  el.style.setProperty('--x', p.x);
  el.style.setProperty('--y', p.y);
  el.style.setProperty('--w', p.w);
  el.style.setProperty('--h', p.h);
}

// Infinite scroll: tiles are created as they come within a couple of screens
// of the viewport, and stay once made. Images inside also load lazily.
function renderVisible(all = false) {
  if (!board) return;
  const top = boardEl.getBoundingClientRect().top;
  const limit = all ? Infinity : (innerHeight * 2.5 - top) / pitch();
  for (const item of board.items) {
    if (tiles.has(item.id)) continue;
    const p = positions.get(item.id);
    if (p && p.y < limit) {
      const el = createTile(item);
      place(el, p);
      boardEl.append(el);
      tiles.set(item.id, el);
    }
  }
}

function rerenderAll() {
  for (const el of tiles.values()) el.remove();
  tiles.clear();
  if (selectedId && !itemById(selectedId)) selectedId = null;
  relayout();
  if (selectedId) tiles.get(selectedId)?.classList.add('selected');
}

function createTile(item) {
  const el = h('div', { class: 'tile', 'data-id': item.id });
  fillTile(el, item);
  if (item.id === selectedId) el.classList.add('selected');
  return el;
}

function refreshTile(id) {
  const el = tiles.get(id);
  const item = itemById(id);
  if (el && item) fillTile(el, item);
}

async function resolveInto(img, src, prop = 'src') {
  const url = await store.resolve(src);
  if (url) img[prop] = url;
}

function fillTile(el, item) {
  el.replaceChildren();
  el.className = 'tile' + (item.id === selectedId ? ' selected' : '');
  el.classList.add(`${item.type}-tile`);

  if (item.type === 'image') {
    el.classList.toggle('fit-contain', item.fit === 'contain');
    const img = h('img', {
      alt: item.alt || '', loading: 'lazy', decoding: 'async', draggable: 'false',
      onerror: () => img.replaceWith(h('div', { class: 'missing' }, 'Image unavailable')),
    });
    if (!item.src.startsWith('media')) img.referrerPolicy = 'no-referrer';
    resolveInto(img, item.src);
    el.append(img);
  } else if (item.type === 'video') {
    const v = h('video', { muted: true, loop: true, playsInline: true, autoplay: true, preload: 'metadata' });
    v.muted = true;
    resolveInto(v, item.src);
    el.append(v);
  } else if (item.type === 'link') {
    const card = h('div', { class: 'link' + (item.image ? '' : ' no-image') });
    if (item.image) {
      const thumb = h('div', { class: 'thumb' });
      thumb.style.backgroundImage = `url("${item.image.replace(/"/g, '%22')}")`;
      card.append(thumb);
    }
    card.append(
      h('div', { class: 'meta' },
        h('span', { class: 'site' }, item.site || ''),
        h('span', { class: 'ttl' }, item.title || item.url),
        item.description && !item.image ? h('span', { class: 'desc' }, item.description) : null,
      ),
    );
    el.append(card);
  } else if (item.type === 'embed') {
    const e = h('div', { class: 'embed' });
    if (item.playing) {
      const src =
        item.provider === 'youtube'
          ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.videoId)}?autoplay=1&rel=0`
          : `https://player.vimeo.com/video/${encodeURIComponent(item.videoId)}?autoplay=1`;
      e.append(h('iframe', { src, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true }));
    } else {
      if (item.provider === 'youtube') e.style.backgroundImage = `url("https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/hqdefault.jpg")`;
      e.append(h('div', { class: 'play' }, svg(ICON.play)), h('span', { class: 'label' }, item.provider));
    }
    el.append(e);
  } else if (item.type === 'text') {
    el.append(
      h('div', {
        class: 'text',
        'data-font': item.font || 'sans',
        'data-size': item.size || 'body',
        'data-align': item.align || 'left',
        'data-empty': !item.text,
      }, item.text || null),
    );
  } else if (item.type === 'color') {
    const sw = h('div', { class: 'swatch' }, item.hex);
    sw.style.background = item.hex;
    sw.style.color = luminance(item.hex) > 0.55 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.85)';
    el.append(sw);
  }
  el.append(h('div', { class: 'handle', title: 'Drag to resize' }));
}

function luminance(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = [...c].map((x) => x + x).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------- selection ----------

function select(id) {
  if (selectedId === id) return;
  const prev = selectedId && itemById(selectedId);
  if (selectedId) tiles.get(selectedId)?.classList.remove('selected');
  // A playing video stops when you move on, so the tile can be dragged again.
  if (prev?.playing) {
    delete prev.playing;
    refreshTile(prev.id);
  }
  selectedId = id;
  if (id) tiles.get(id)?.classList.add('selected');
  renderSelbar();
}

function renderSelbar() {
  const item = selectedId && itemById(selectedId);
  if (!item || drag?.active) {
    selbar.hidden = true;
    return;
  }
  const p = positions.get(item.id);
  const parts = [h('span', { class: 'dims' }, p ? `${p.w}×${p.h}` : '')];
  const set = (patch, { undoable = true } = {}) => {
    if (undoable) pushUndo();
    Object.assign(item, patch);
    refreshTile(item.id);
    changed();
    renderSelbar();
  };
  const seg = (options, current, onPick) =>
    h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === current ? 'on' : '', onclick: () => onPick(v) }, label)));

  if (item.type === 'image') {
    parts.push(seg([['cover', 'Fill'], ['contain', 'Fit']], item.fit || 'cover', (fit) => set({ fit })));
    parts.push(h('button', { title: 'Open original', onclick: async () => window.open(await store.resolve(item.src), '_blank', 'noopener') }, svg(ICON.open)));
  } else if (item.type === 'video') {
    parts.push(h('button', { title: 'Open', onclick: async () => window.open(await store.resolve(item.src), '_blank', 'noopener') }, svg(ICON.open)));
  } else if (item.type === 'link') {
    parts.push(h('button', { onclick: () => window.open(item.url, '_blank', 'noopener') }, svg(ICON.open), 'Open'));
  } else if (item.type === 'embed') {
    if (!item.playing) parts.push(h('button', { onclick: () => set({ playing: true }, { undoable: false }) }, svg(ICON.play), 'Play'));
    parts.push(h('button', { title: 'Open', onclick: () => window.open(item.url, '_blank', 'noopener') }, svg(ICON.open)));
  } else if (item.type === 'text') {
    parts.push(h('button', { title: 'Edit text (Enter)', onclick: () => startEdit(item.id) }, svg(ICON.edit)));
    const fontSel = h('select', { 'aria-label': 'Font', onchange: (e) => set({ font: e.target.value }) },
      FONTS.map(([v, label]) => h('option', { value: v, selected: v === (item.font || 'sans') }, label)));
    parts.push(fontSel);
    parts.push(seg(SIZES, item.size || 'body', (size) => set({ size })));
    parts.push(seg([['left', 'Left'], ['center', 'Centre']], item.align || 'left', (align) => set({ align })));
  } else if (item.type === 'color') {
    const input = h('input', { type: 'color', value: item.hex.length === 4 ? '#' + [...item.hex.slice(1)].map((x) => x + x).join('') : item.hex });
    let before = null;
    input.addEventListener('focus', () => (before = snapshot()));
    input.addEventListener('input', (e) => {
      item.hex = e.target.value;
      refreshTile(item.id);
      changed();
    });
    input.addEventListener('change', () => before && pushUndo(before));
    parts.push(h('label', { title: 'Colour' }, input, item.hex));
  }
  parts.push(h('span', { class: 'sep' }));
  parts.push(h('button', { class: 'danger', title: 'Delete (⌫)', onclick: () => removeItem(item.id) }, svg(ICON.trash)));
  selbar.replaceChildren(...parts);
  selbar.hidden = false;
}

function removeItem(id) {
  const i = indexOf(id);
  if (i < 0) return;
  mutate(() => board.items.splice(i, 1));
  select(null);
  toast('Deleted', { label: 'Undo', run: undo });
}

// ---------- text editing ----------

function startEdit(id) {
  const el = tiles.get(id);
  const item = itemById(id);
  if (!el || item?.type !== 'text' || editingId === id) return;
  select(id);
  editingId = id;
  editBefore = snapshot();
  const t = el.querySelector('.text');
  el.classList.add('editing');
  try {
    t.contentEditable = 'plaintext-only';
  } catch {
    t.contentEditable = 'true'; // browsers without plaintext-only
  }
  t.focus();
  const r = document.createRange();
  r.selectNodeContents(t);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  t.oninput = () => {
    item.text = t.innerText.replace(/\n$/, '');
    t.toggleAttribute('data-empty', !item.text);
    changed();
  };
  t.onblur = () => endEdit();
  t.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      t.blur();
    }
  };
}

function endEdit() {
  if (!editingId) return;
  const el = tiles.get(editingId);
  const t = el?.querySelector('.text');
  if (t) {
    t.contentEditable = 'false';
    t.oninput = t.onblur = t.onkeydown = null;
  }
  el?.classList.remove('editing');
  editingId = null;
  if (editBefore !== snapshot()) pushUndo(editBefore);
  editBefore = null;
}

// ---------- drag to move, corner to resize ----------

let drag = null;
let resize = null;

boardEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const tile = e.target.closest('.tile');
  if (!tile) {
    if (editingId) document.activeElement?.blur();
    select(null);
    return;
  }
  const id = tile.dataset.id;
  if (id === editingId) return;
  if (editingId) document.activeElement?.blur();

  if (e.target.closest('.handle')) {
    e.preventDefault();
    e.stopPropagation();
    select(id);
    const p = positions.get(id);
    resize = { id, el: tile, x: e.clientX, y: e.clientY, w0: p.w, h0: p.h, before: snapshot(), changed: false };
    tile.classList.add('resizing');
    tile.setPointerCapture(e.pointerId);
    return;
  }

  const wasSelected = selectedId === id;
  select(id);
  const r = tile.getBoundingClientRect();
  drag = {
    id,
    el: tile,
    pointerId: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    grabX: e.clientX - r.left,
    grabY: e.clientY - r.top,
    active: false,
    wasSelected,
    before: snapshot(),
    cell: null,
    timer: null,
  };
  // Touch needs a short press first, so a swipe still scrolls the page.
  if (e.pointerType === 'touch') {
    drag.timer = setTimeout(() => beginDrag(), 280);
  }
});

function beginDrag() {
  if (!drag || drag.active) return;
  drag.active = true;
  clearTimeout(drag.timer);
  const { el } = drag;
  try {
    el.setPointerCapture(drag.pointerId);
  } catch {}
  drag.ghost = h('div', { class: 'ghost' });
  place(drag.ghost, positions.get(drag.id));
  boardEl.append(drag.ghost);
  el.classList.add('dragging');
  navigator.vibrate?.(8);
  renderSelbar();
  followPointer();
  autoScroll();
}

function followPointer() {
  const { el, lastX, lastY } = drag;
  const b = boardEl.getBoundingClientRect();
  el.style.left = `${lastX - b.left - drag.grabX}px`;
  el.style.top = `${lastY - b.top - drag.grabY}px`;
  const p = pitch();
  const cx = Math.max(0, Math.min(cols - 1, Math.floor((lastX - b.left) / p)));
  const cy = Math.max(0, Math.floor((lastY - b.top) / p));
  const key = `${cx},${cy}`;
  if (key === drag.cell) return;
  drag.cell = key;
  const from = indexOf(drag.id);
  const to = reorderTarget(board.items, positions, drag.id, cx, cy, rows);
  if (to !== from && to >= 0) {
    board.items = move(board.items, from, to);
    relayout();
  }
}

function autoScroll() {
  if (!drag?.active) return;
  const edge = 70;
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h')) || 56;
  let dy = 0;
  if (drag.lastY < top + edge) dy = -Math.ceil((top + edge - drag.lastY) / 6);
  else if (drag.lastY > innerHeight - edge) dy = Math.ceil((drag.lastY - innerHeight + edge) / 6);
  if (dy) {
    scrollBy(0, dy);
    followPointer();
  }
  requestAnimationFrame(autoScroll);
}

window.addEventListener('pointermove', (e) => {
  if (resize) {
    const p = pitch();
    const { w, h } = clampSize(resize.w0 + Math.round((e.clientX - resize.x) / p), resize.h0 + Math.round((e.clientY - resize.y) / p), cols);
    const item = itemById(resize.id);
    if (item && (item.w !== w || item.h !== h)) {
      item.w = w;
      item.h = h;
      resize.changed = true;
      relayout();
    }
    return;
  }
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
  if (!drag.active) {
    if (e.pointerType === 'touch') {
      if (moved > 8) cancelDrag(); // a scroll, not a press
      return;
    }
    if (moved > 5) beginDrag();
    return;
  }
  followPointer();
});

// Once a touch drag has started, keep the page from scrolling under it.
boardEl.addEventListener('touchmove', (e) => {
  if (drag?.active || resize) e.preventDefault();
}, { passive: false });

function cancelDrag() {
  if (!drag) return;
  clearTimeout(drag.timer);
  drag = null;
}

function endPointer(e) {
  if (resize) {
    resize.el.classList.remove('resizing');
    if (resize.changed) {
      pushUndo(resize.before);
      changed();
    }
    resize = null;
    renderSelbar();
    return;
  }
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const d = drag;
  drag = null;
  clearTimeout(d.timer);
  if (d.active) {
    d.el.classList.remove('dragging');
    d.el.style.left = d.el.style.top = '';
    d.ghost?.remove();
    if (snapshot() !== d.before) {
      pushUndo(d.before);
      changed();
    }
    renderSelbar();
    return;
  }
  // A plain tap.
  if (e?.type === 'pointerup' && d.wasSelected) {
    const item = itemById(d.id);
    if (item?.type === 'text') startEdit(d.id);
  }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

// A long press on a phone is a drag, not a call for the context menu.
boardEl.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.tile') && (drag || matchMedia('(hover: none)').matches)) e.preventDefault();
});

boardEl.addEventListener('dblclick', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const item = itemById(tile.dataset.id);
  if (!item) return;
  if (item.type === 'text') startEdit(item.id);
  else if (item.type === 'link') window.open(item.url, '_blank', 'noopener');
  else if (item.type === 'embed' && !item.playing) {
    item.playing = true;
    refreshTile(item.id);
    renderSelbar();
  }
});

// ---------- adding things ----------

function addItems(partials, { edit = false } = {}) {
  const items = partials.filter(Boolean).map((p) => ({ id: uid(), ...defaultSize(p), ...p }));
  if (!items.length) return [];
  const at = selectedId ? indexOf(selectedId) + 1 : board.items.length;
  mutate(() => board.items.splice(at, 0, ...items));
  const last = items[items.length - 1];
  select(last.id);
  const p = positions.get(last.id);
  const top = boardEl.getBoundingClientRect().top + p.y * pitch();
  if (top < 80 || top + p.h * pitch() > innerHeight) scrollTo({ top: scrollY + top - innerHeight / 3, behavior: 'smooth' });
  for (const it of items) if (it.type === 'link') unfurl(it);
  if (edit && last.type === 'text') requestAnimationFrame(() => startEdit(last.id));
  return items;
}

async function unfurl(item) {
  const meta = await store.unfurl(item.url);
  if (!meta || !itemById(item.id)) return;
  Object.assign(item, {
    title: meta.title || item.title,
    description: meta.description || '',
    image: meta.image || '',
    site: meta.site || item.site,
  });
  refreshTile(item.id);
  changed();
}

function addFromText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Several links → several tiles. Anything else is one block of text.
  const allLinks = lines.length > 1 && lines.every((l) => /^https?:\/\//i.test(l));
  return addItems(allLinks ? lines.map(classify) : [classify(text)]);
}

const KEEP = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);

// Phone photos are huge. Anything over 2400px on its long side, or not a web
// format, is redrawn to WebP. GIFs and SVGs pass untouched.
async function prepareImage(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && KEEP.has(file.type) && file.size < 1.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.88));
    return blob || file;
  } catch {
    return file;
  }
}

async function addFiles(files) {
  const media = [...files].filter((f) => /^(image|video)\//.test(f.type));
  if (!media.length) return;
  toast(media.length > 1 ? `Adding ${media.length} files…` : 'Adding…');
  const partials = [];
  for (const f of media) {
    try {
      if (f.type.startsWith('image/')) {
        const src = await store.putMedia(await prepareImage(f));
        partials.push({ type: 'image', src, fit: 'cover', alt: f.name });
      } else {
        partials.push({ type: 'video', src: await store.putMedia(f) });
      }
    } catch (e) {
      console.error(e);
      toast(`Couldn't add ${f.name}`);
    }
  }
  addItems(partials);
  if (partials.length) toastEl.hidden = true;
}

function imgFromHtml(html) {
  const m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m && /^https?:/i.test(m[1]) ? m[1] : null;
}

document.addEventListener('paste', (e) => {
  if (boardView.hidden || typing()) return;
  const dt = e.clipboardData;
  if (!dt) return;
  e.preventDefault();
  if (dt.files.length) return addFiles(dt.files);
  const text = dt.getData('text/plain');
  const img = imgFromHtml(dt.getData('text/html'));
  if (text.trim()) addFromText(text);
  else if (img) addItems([classify(img)]);
});

let dragDepth = 0;
const external = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/html');
window.addEventListener('dragenter', (e) => {
  if (boardView.hidden || !external(e)) return;
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropOverlay.hidden = true;
  }
});
window.addEventListener('dragover', (e) => {
  if (!boardView.hidden && external(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (boardView.hidden || !external(e)) return;
  e.preventDefault();
  const dt = e.dataTransfer;
  if (dt.files.length) return addFiles(dt.files);
  const img = imgFromHtml(dt.getData('text/html'));
  const uri = dt.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'));
  if (img) addItems([classify(img)]);
  else if (uri) addItems([classify(uri)]);
  else if (dt.getData('text/plain')) addFromText(dt.getData('text/plain'));
});

// ---------- add menu ----------

function toggleMenu(open = addMenu.hidden) {
  addMenu.hidden = !open;
  addBtn.setAttribute('aria-expanded', String(open));
  if (open && matchMedia('(hover: hover)').matches) urlInput.focus();
}
addBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu();
});
document.addEventListener('pointerdown', (e) => {
  if (!addMenu.hidden && !e.target.closest('.add-wrap')) toggleMenu(false);
});
urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!urlInput.value.trim()) return;
  addFromText(urlInput.value);
  urlInput.value = '';
  toggleMenu(false);
});
addMenu.addEventListener('click', (e) => {
  const what = e.target.closest('[data-add]')?.dataset.add;
  if (!what) return;
  toggleMenu(false);
  if (what === 'file') fileInput.click();
  else if (what === 'text') addItems([{ type: 'text', text: '', font: 'sans', size: 'h1', align: 'left' }], { edit: true });
  else if (what === 'color') addItems([{ type: 'color', hex: SWATCHES[Math.floor(Math.random() * SWATCHES.length)] }]);
  else if (what === 'print') printBoard();
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

// ---------- title, save button, keys ----------

titleInput.addEventListener('input', () => {
  board.title = titleInput.value;
  renderTitle(false);
  changed();
});
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') titleInput.blur();
});

function renderTitle(setInput = true) {
  if (setInput) titleInput.value = board.title || '';
  titleInput.placeholder = board.date;
  dateChip.textContent = board.title ? board.date : '';
  document.title = `${boardName(board)} · moodbored`;
  $('#print-title').textContent = boardName(board);
  $('#print-date').textContent = board.title ? board.date : '';
}

saveBtn.addEventListener('click', async () => {
  if (!everSaved && isPristine(board)) return toast('Nothing to save yet');
  await save({ force: true });
  if (!saveError) toast('Saved');
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!boardView.hidden) saveBtn.click();
    return;
  }
  if (boardView.hidden || typing()) return;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
    e.preventDefault();
    removeItem(selectedId);
  } else if (e.key === 'Escape') {
    toggleMenu(false);
    select(null);
  } else if (e.key === 'Enter' && selectedId && itemById(selectedId)?.type === 'text') {
    e.preventDefault();
    startEdit(selectedId);
  }
});

// ---------- print ----------

// Chrome lays the board out at the page's width (see @media print). Every
// tile has to exist, and every lazy image has to have loaded, before it does.
function preparePrint() {
  renderVisible(true);
  boardEl.querySelectorAll('img[loading="lazy"]').forEach((img) => (img.loading = 'eager'));
}
window.addEventListener('beforeprint', preparePrint);

async function printBoard() {
  select(null);
  preparePrint();
  const pending = [...boardEl.querySelectorAll('img')].filter((i) => !i.complete);
  if (pending.length) toast('Preparing to print…');
  const loaded = (img) =>
    new Promise((r) => {
      img.addEventListener('load', r, { once: true });
      img.addEventListener('error', r, { once: true });
    });
  await Promise.race([Promise.all(pending.map(loaded)), new Promise((r) => setTimeout(r, 5000))]);
  toastEl.hidden = true;
  window.print();
}

// ---------- views + routing ----------

function showBoard(b, { saved }) {
  endEdit();
  board = b;
  everSaved = saved;
  version = savedVersion = 0;
  saveError = false;
  lastSavedAt = saved && b.updatedAt ? new Date(b.updatedAt) : null;
  undoStack = [];
  redoStack = [];
  selectedId = null;
  for (const el of tiles.values()) el.remove();
  tiles.clear();
  libraryView.hidden = true;
  boardView.hidden = false;
  renderTitle();
  measure();
  relayout();
  renderStatus();
  scrollTo(0, 0);
}

async function route() {
  const hash = location.hash;
  if (hash === '#boards') return showLibrary();
  const m = hash.match(/^#b\/([\w-]+)$/);
  if (m) {
    if (board?.id === m[1]) {
      if (boardView.hidden) {
        libraryView.hidden = true;
        boardView.hidden = false;
        measure();
        relayout();
      }
      return;
    }
    const b = await store.get(m[1]);
    if (b) return showBoard(b, { saved: true });
    toast('That board no longer exists');
    history.replaceState(null, '', location.pathname);
  }
  if (board && !everSaved && isPristine(board)) {
    libraryView.hidden = true;
    boardView.hidden = false;
    relayout();
    return;
  }
  showBoard(newBoard(), { saved: false });
}

$('#close-board').addEventListener('click', async () => {
  endEdit();
  await save();
  location.hash = '#boards';
});
$('#new-board').addEventListener('click', () => {
  showBoard(newBoard(), { saved: false });
  history.pushState(null, '', location.pathname);
});
$('#back-to-board').addEventListener('click', () => history.back());

// ---------- library ----------

let libItems = [];
let libShown = 0;
const libGrid = $('#lib-grid');
const libObserver = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) renderLibChunk();
}, { rootMargin: '600px' });
libObserver.observe($('#lib-sentinel'));

async function showLibrary() {
  endEdit();
  select(null);
  boardView.hidden = true;
  libraryView.hidden = false;
  document.title = 'Boards · moodbored';
  $('#back-to-board').hidden = !(board && everSaved);
  $('#lib-note').textContent =
    store.kind === 'server'
      ? 'Saved on your moodbored server: open the same address on your phone to see these.'
      : 'Saved in this browser only. Run server.mjs to share boards between devices.';
  libGrid.replaceChildren();
  libShown = 0;
  try {
    libItems = await store.list();
  } catch (e) {
    libItems = [];
    toast("Couldn't load boards");
  }
  if (!libItems.length) libGrid.append(h('p', { class: 'lib-empty' }, 'No boards yet.'));
  renderLibChunk();
  scrollTo(0, 0);
}

function renderLibChunk() {
  if (libraryView.hidden || libShown >= libItems.length) return;
  const next = libItems.slice(libShown, libShown + 24);
  libShown += next.length;
  for (const s of next) libGrid.append(card(s));
}

function card(s) {
  const n = Math.min(4, s.covers.length);
  const cover = h('div', { class: `cover n${n}` });
  for (const src of s.covers.slice(0, n)) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: () => img.remove() });
    if (!src.startsWith('media')) img.referrerPolicy = 'no-referrer';
    resolveInto(img, src);
    cover.append(img);
  }
  const name = s.title || s.date;
  const el = h('div', { class: 'card', role: 'link', tabindex: '0', onclick: () => (location.hash = `#b/${s.id}`),
      onkeydown: (e) => e.key === 'Enter' && (location.hash = `#b/${s.id}`) },
    cover,
    h('div', { class: 'name' }, name),
    h('div', { class: 'sub' }, `${s.title ? s.date + ' · ' : ''}${s.count} item${s.count === 1 ? '' : 's'}`),
    h('button', {
      class: 'del', title: 'Delete board', 'aria-label': `Delete ${name}`,
      onclick: async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete “${name}”? This can't be undone.`)) return;
        await store.remove(s.id);
        if (board?.id === s.id) board = null;
        libItems = libItems.filter((x) => x.id !== s.id);
        el.remove();
        $('#back-to-board').hidden = !(board && everSaved);
        if (!libItems.length) libGrid.append(h('p', { class: 'lib-empty' }, 'No boards yet.'));
      },
    }, svg(ICON.trash)),
  );
  return el;
}

// ---------- lifecycle ----------

let rafPending = false;
window.addEventListener('scroll', () => {
  if (rafPending || boardView.hidden) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderVisible();
  });
}, { passive: true });

new ResizeObserver(() => {
  if (boardView.hidden || !board) return;
  const before = cols;
  measure();
  if (cols !== before) relayout();
  else renderVisible();
}).observe(wrap);

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    endEdit();
    save();
    return;
  }
  checkServer();
  // Back from the other device: pick up what it saved, unless there are local edits.
  if (store?.kind === 'server' && board && everSaved && version === savedVersion && !boardView.hidden && !drag && !resize) {
    const remote = await store.get(board.id).catch(() => null);
    if (remote && (remote.updatedAt || '') > (board.updatedAt || '')) {
      const keep = selectedId;
      showBoard(remote, { saved: true });
      if (remote.items.some((i) => i.id === keep)) select(keep);
    }
  }
});
window.addEventListener('pagehide', () => save());
window.addEventListener('beforeunload', (e) => {
  if (board && version !== savedVersion && !(isPristine(board) && !everSaved)) {
    save();
    e.preventDefault();
  }
});
window.addEventListener('hashchange', route);

store = await openStore();
setInterval(checkServer, 3000);
await document.fonts?.ready;
route();
