# NEOPAPER web

The web version of [NEOPAPER](https://github.com/wylify/NEOPAPER): build device-label wallpapers with your contact QR
code and a reader-app barcode, in any modern browser. It installs as an app (PWA) on Android, iPhone, iPad and desktop,
and works offline.

**Live:** https://wylify.github.io/neopaper_web

The reader app the card barcode points to, [NEOSCAN](https://wylify.github.io/neoscan), stays a separate app.

## Features

Everything the Android app does, except setting the wallpaper directly (see below):

- Cards, templates, duplicate and delete (with undo)
- Builder tabs (one sliding pill in the top bar): **Card**, edited on the card itself or as a row list (switch on the
  Card tab or in Settings), **Style** (ratio, orientation,
  corners, colours with contrast-safe suggestions), **Backdrop** (colour or photo, dim, mono/blur, overlays,
  size/nudge/tilt, crop marks), **Export** (device presets, custom size, 1–3× scale, PNG/JPG)
- **On the card** (default, like the Android app): tap the header, QR, a row or the barcode to select it (a marching
  dashed frame), tap a text again to type straight on the card in its own font, with ↑/↓ or Enter/Tab to move
  between texts. The panel under the card (beside it on wide windows) holds the selected part's settings; remove and
  add-below sit beside the selected row; rows that don't fit are listed under the card as **Not on card** and the
  orange *n/m rows fit* badge selects the first one. **Reorder** shows the real card to scale with drag handles and
  a *card ends here* line. Keyboard: arrows walk the parts, Enter types, Delete removes a row, Escape steps back.
- **Row list**: rows and header fillers in a list with drag to sort and swipe to remove; easier with a screen reader.
- Header & QR code and Barcode editors: NP1 fields, vCard, link or text; live QR size and capacity warnings; the
  barcode warns that it opens NEOSCAN and offers a reset to the defaults
- Row editor with live preview and per-row height
- Scanner for QR codes and Code 128 barcodes: camera, image file, paste or drop
- Backup and restore (one `.json` file with cards and photos). Restore also accepts the Android app's `cards.json`.
- Clock and dock guides, **Off · Home · Lock** (off by default), on the Backdrop and Export previews, an overlap
  warning with **Fit**, and new cards placed clear of the chosen screen. On small, squarish screens new blank cards
  start in landscape.
- Settings: shape and orientation of new cards, saved-image size/scale/format for new cards, Card tab layout, guides
  and haptics
- Screen sizes: short screens (under 640px tall) get a one-line Home header, a slim nav bar, preview heights
  that scale with the window. On any screen the builder's tab bar folds away (back, preview and the toggle then
  float on the preview). Wide windows (700px and up, not clearly portrait) put the builder's controls beside the preview,
  and Home gets a rail from 900px.
- Back (gesture, button or Escape) steps out of typing, then the selection, then to the previous tab; the ← always
  goes straight to the cards. On Templates or Settings, back returns to Your cards.
- Keyboard: Escape goes back; Ctrl or ⌘ with 1–4 switches builder tabs, S saves the image, N makes a new card
  (inside the installed app; browsers keep Ctrl+N for a new window), Z undoes and Shift+Z or Y redoes.
  Right-click a card for Duplicate / Delete.
- Undo / redo: the last 10 steps on the open card (typing into one field counts as one step), from the
  ↶ button on the preview or Ctrl+Z, also while typing on the card. Kept until the editor closes.
- Edits survive a reload or a closed tab: the open card is also copied to localStorage when the page is
  hidden, and picked up at the next start if IndexedDB did not finish saving.

Cards use the same JSON as the Android app, and NP1 encoding is a port of `Np1.kt`.

## Platform differences

| | Android app | Web |
| --- | --- | --- |
| Set as wallpaper | Direct | Saves the image, then shows the steps for this device. On iPhone it goes through the share sheet (“Save Image” → Photos → Use as Wallpaper). |
| Saved images | `Pictures/NEOPAPER` | Downloads (Android, desktop) or Photos via the share sheet (iPhone) |
| Largest export | 48 MP | 16 MP on iPhone/iPad (Safari's canvas limit), 33 MP on other phones, 48 MP on desktop |
| “This device” size | Exact screen | Screen size × pixel ratio, which can be off by a few pixels on some Android phones |
| Storage | App storage | IndexedDB in the browser. Safari may clear it after 7 days without a visit unless the app is on the Home Screen. Keep a backup. |
| Torch | Yes | Where the browser supports it (Chrome on Android) |
| Card tab | Edit by tapping the card itself | Same, plus a row-list layout to switch to |
| Haptics | Yes | `navigator.vibrate` where available (Android browsers, not iPhone) |

## Light ink on a dark card

zxing (in the Android app, NEOSCAN and here) does not read light-on-dark **1D** barcodes, only light-on-dark QR codes.
The Style tab warns about it, and the scanner here retries every third camera frame (and every image) inverted.

## Layout

No build step: plain ES modules.

| Path | What it does |
| --- | --- |
| `index.html`, `css/style.css` | App shell and styles |
| `js/app.js`, `js/nav.js`, `js/sheet.js` | Screens, history-backed navigation (back button and Escape close the top layer), sheets |
| `js/home.js`, `js/builder.js`, `js/editors.js`, `js/colorpicker.js` | Screens |
| `js/cardedit.js` | The on-card editor and the Reorder screen (port of `CardEditor.kt`) |
| `js/state.js`, `js/store.js`, `js/photo.js` | State, autosave and undo; IndexedDB; photo decoding and effects |
| `js/settings.js`, `js/placement.js` | Preferences (localStorage); port of `Placement.kt` (clock/dock guides, Fit, landscape default) |
| `js/model.js`, `js/np1.js`, `js/colors.js` | Port of `Models.kt`, `Np1.kt` (encoding) and `ColorSuggest.kt` |
| `js/render.js`, `js/previews.js` | Canvas port of `CardRenderer.kt` and `WallpaperRenderer.kt`; `cardGeometry()` is shared by drawing, hit-testing and the on-card fields |
| `js/qr.js`, `js/capacity.js`, `js/code128.js`, `js/codes.js` | QR encoder (mixed-mode segments, modelled on Nayuki's), `QrCapacity.kt` port, Code 128 encoder, cache |
| `js/export.js` | Image rendering, size limits, download / share |
| `js/scan.js`, `js/parse.js` | Scanner screen; `parse.js` is shared with NEOSCAN, keep the two in sync |
| `sw.js` | Offline cache. **Bump `VERSION` (and `APP_VERSION` in `js/config.js`) on every release.** |
| `tests/` | Browser tests: open `/tests/` on a local server. They round-trip every QR version and level and every template through the zxing decoder. |
| `vendor/zxing/` | [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) reader (MIT) |
| `fonts/` | Space Grotesk and JetBrains Mono (SIL OFL 1.1) |
| `tools/make_icons.py` | Draws the icons (`python3 tools/make_icons.py`) |

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000 (the app) or http://localhost:8000/tests/ (the tests). The camera works on `localhost` or
over HTTPS. The service worker only registers over HTTPS, so local edits show up on reload.

## Deploy

GitHub Pages serves the `main` branch root. A push to `main` deploys it.
