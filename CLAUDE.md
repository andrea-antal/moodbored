# moodbored

Personal moodboard app. Plain ES modules in `public/`, a zero-dependency Node server in
`server.mjs`. No build step. Keep it that way. No frameworks, no bundler.

## Layout

- `public/layout.js`: grid packing. Pure. Positions are derived, never stored.
- `public/util.js`: dates, URL classification, ids. Pure.
- `public/store.js`: storage. `server` adapter when `api/health` answers, `local`
  (IndexedDB) otherwise. Both have the same shape. Change one, change both.
- `public/app.js`: everything that touches the DOM.
- `lib/unfurl.mjs`: link previews (Open Graph). Pure apart from `isPublicHost`.
- `server.mjs`: static files, `/api/boards`, `/api/media`, `/api/unfurl`.

## Rules

- Tile sizes, text sizes, and the background grid all derive from `--cell`, which is
  computed in CSS from `100cqw`. That is what makes print fit the page width. Don't
  replace it with pixel values set from JS.
- Tests import the real modules, so keep the pure files free of DOM access at import
  time. Run `npm test` before committing.
- `data/` is user data. It is gitignored. Never commit it.
