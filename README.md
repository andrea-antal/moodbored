# moodbored

A clean, minimal Pinterest for moodboards. Square grid, drag to rearrange,
corner to resize, autosave, and boards that print to a tidy PDF.

## Run it

```
npm start          # http://127.0.0.1:4700, this computer only
npm run lan        # also on your phone, same Wi-Fi: it prints the address
npm test
```

Node 20.11 or newer. No dependencies, no build step.

Boards are saved as JSON in `data/boards/`, uploads in `data/media/`. Back up `data/`.
`MOODBORED_DATA=/path` puts it somewhere else, e.g. a synced folder.

If you open `public/` from any other static server, it still works. It just saves to
that browser's IndexedDB instead, so your phone won't see it.

## Using it

- **Opens on a new, empty board** dated today (`YYYY-MM-DD`). Rename it with the
  title field if you like. The date stays.
- **Add**: paste anything (⌘V), drop files or images from another tab, or use **Add**:
  photos and videos, links, image URLs, YouTube/Vimeo, `#hex` colour swatches, text.
- **Move**: drag a tile. On a phone, press and hold for a moment, then drag.
- **Resize**: drag the bottom-right corner. Everything else reflows around it.
- **Text**: H1 / H2 / Body, in Sans, Serif, Mono or Hand. Double-click or Enter to edit.
- **Save**: autosaves a second after each change. **Save** (⌘S) saves now.
- **Undo**: ⌘Z / ⇧⌘Z. Delete with ⌫.
- **Close** (×) shows every board, newest first. **New board** starts another.
- **Print** (⌘P, or Add → Print / PDF): the grid scales to the page width and the
  background grid drops out.

## How the grid works

A board is an ordered list of tiles, each `w × h` square cells. Positions are never
stored. `public/layout.js` packs the list fresh for however many columns the screen
allows (2 on a phone, up to 8 on a wide screen), first-fit, so small tiles fill gaps
a big one leaves. Moving a tile changes its place in the order. Resizing changes its
size. Both just repack.

Cells are sized in CSS with container query units, so the same layout fills a phone,
a monitor, or a sheet of Letter paper without JavaScript measuring anything.
