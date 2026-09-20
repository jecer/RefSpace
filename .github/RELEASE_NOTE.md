Windows installer, built and published by GitHub Actions from this tag.

**This build is not code-signed yet**, so Windows SmartScreen shows an
"unknown publisher" warning the first time you run it. Code signing is being
set up through [SignPath.io](https://about.signpath.io/), with a certificate
from the [SignPath Foundation](https://signpath.org/); releases will carry a
signature once that is in place.

The installer bundles `yt-dlp.exe` 2026.03.17, fetched during the build and
checked against the SHA-256 published with that upstream release.
