# Code Signing Policy

This document describes how RefSpace releases are built, reviewed and signed.

## Signing provider

Releases are not signed yet. Code signing is being set up through
[SignPath.io](https://signpath.io/), with a certificate to be issued by the
[SignPath Foundation](https://signpath.org/). This document describes the
process that signing will run under.

## Team roles

RefSpace is maintained by a single person, who therefore holds every role:

| Role | Holder | Responsibility |
| :--- | :--- | :--- |
| Author | [@jecer](https://github.com/jecer) | Writes and commits code |
| Reviewer | [@jecer](https://github.com/jecer) | Reviews any external contribution before it is merged |
| Approver | [@jecer](https://github.com/jecer) | Decides what is released and submitted for signing |

Contributions from anyone else arrive as pull requests and are reviewed before
merging. Nobody else can push to `main`.

Two-factor authentication is enabled on the GitHub account that owns this
repository and on the SignPath account used for signing.

## Source and build

- All source is public in this repository: https://github.com/jecer/RefSpace
- Only artifacts built from this repository are submitted for signing.
- The build is `npm run build`, which runs `electron-builder --win`. Its whole
  configuration lives in the `build` field of `package.json`, in this
  repository, so it is reviewed like any other code.
- The installer bundles two third-party binaries that RefSpace does not build:
  the Electron runtime, and `yt-dlp.exe` from the
  [yt-dlp project](https://github.com/yt-dlp/yt-dlp) (Unlicense). Both are open
  source and taken from their official releases.
- Vendored assets are listed with their origin and license in `vendor/README.md`.

## Privacy

RefSpace contains no analytics, no telemetry and no crash reporting. Nothing
about the user or their usage is collected or transmitted.

The application contacts the network only when the user asks it to load a
YouTube video, and only these hosts:

- `www.youtube.com` — the IFrame player API, and stream resolution via the
  bundled `yt-dlp.exe`
- `pipedapi.kavin.rocks` and `api.piped.victr.me` — fallback stream resolution
  used only when `yt-dlp` is unavailable or fails

Reference images, videos and project files are read from and written to the
local disk only. A diagnostic log is written to the per-user application data
folder and never leaves the machine.

The installer writes only to its installation directory and the usual Windows
uninstall entries, and it registers the `.mpref` file association. It can be
removed at any time through Windows "Apps & features", or by running the
bundled uninstaller.

## Reporting a problem

Please open an issue at https://github.com/jecer/RefSpace/issues.
