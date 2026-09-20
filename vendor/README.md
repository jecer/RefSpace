# vendor/

Third-party assets that used to be fetched from a CDN at runtime. They are kept
here so the app renders its own interface without a network connection.

## mp4box.all.min.js

- Version 0.5.3, build dated 02-11-2024
- Source: `https://cdn.jsdelivr.net/npm/mp4box@0.5.3/dist/mp4box.all.min.js`
- Upstream: https://github.com/gpac/mp4box.js
- License: BSD-3-Clause — see `LICENSE.mp4box.txt`
- Used by `renderer.js` to read the real FPS of a local MP4 without playing it.

## fonts/inter-*.woff2

- Inter v20, variable weight axis 100-900, upright only
- Source: Google Fonts (`fonts.gstatic.com`), via the CSS2 API request
  `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap`
- License: SIL Open Font License 1.1 — see `fonts/LICENSE.Inter.txt`
- Only the `latin`, `latin-ext`, `cyrillic` and `cyrillic-ext` subsets are kept.
  The `greek` and `vietnamese` subsets were dropped: no UI language needs them.
  Chinese and Japanese are not covered by Inter at all and fall back to
  `sans-serif`, exactly as they did before.

`fonts/inter.css` mirrors the `unicode-range` values Google serves, so the
browser still downloads a subset only when a glyph from it is actually used.

## Updating

Re-download the file, keep the same name, and check the app still starts. For
the fonts, re-request the CSS2 URL above with a current Chrome user agent —
Google returns different files for older agents.
