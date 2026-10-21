# TODO

- **Hosting.** For phone ↔ desktop away from home Wi-Fi: deploy behind a password
  (e.g. Vercel + Blob/Neon, gated like ox's `middleware.ts`). `store.js` already
  isolates storage behind one interface.
- **Keep copies of hot-linked images.** Image URLs and link previews point at the
  source site. They break if it goes away. The server could download them on add.
- **Page breaks in print.** Long boards split across pages wherever the page ends,
  sometimes through a tile.
- **Orphaned media.** Deleting a tile leaves its upload in `data/media/`.
- **Bookmarklet / share target** to send a page straight to a board from the phone.
- Export / import a board as JSON (for local-only mode).
