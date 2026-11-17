# Third-party components

This development APK combines AICT's Java sources and assets with the official
AutoJs6 6.6.4 independent APK-builder runtime. It is not an official AutoJs6 build.

- AutoJs6: https://github.com/SuperMonster003/AutoJs6/tree/v6.6.4
  - MPL-2.0; upstream license: https://github.com/SuperMonster003/AutoJs6/blob/v6.6.4/LICENSE
  - The runtime template and arm64 native libraries are taken from the official
    `autojs6-v6.6.4-arm64-v8a-110e6b64.apk` GitHub release asset.
  - Asset SHA-256: `3392a70bd0389c77fc5cc8eeb864b6b21be369b721c98f3f2cd9af8111a7c160`
  - Verified APK signer certificate SHA-256:
    `31a681fcfffb3e428420cae280ded89292b12a3b0f59e19b7a73e32a8ae4c213`.
  - AICT does not change upstream executable DEX. Manifest/resources are adapted
    by `tools/prepare_apk.py`; new source-built DEX is appended. The full upstream
    runtime has transitive components under their respective licenses, including
    Rhino, AndroidX, OpenCV and OCR libraries. Upstream notices/resources remain
    in the APK. Consult the pinned upstream source for their licenses.
- Rhino: https://github.com/mozilla/rhino — MPL-2.0, embedded by AutoJs6.
- mwiede/JSch 0.2.26: https://github.com/mwiede/jsch/tree/jsch-0.2.26 — BSD-style license.
  This is the SSH implementation appended to the runtime.
- AsyncSSH 2.24.1: https://github.com/ronf/asyncssh — EPL-2.0 / GPL-2.0-or-later
  alternative licensing; server dependency, not included in APK.
- aiohttp 3.14.5: https://github.com/aio-libs/aiohttp — Apache-2.0 / MIT;
  server dependency, not included in APK.

Local build tools: Apktool 2.12.1 (Apache-2.0), Android SDK build-tools, OpenJDK.

- markdown-it 15.0.3: https://github.com/markdown-it/markdown-it — MIT.
  The self-contained browser bundle is served locally from `server/web/assets/markdown-it.min.js`.
  License: `server/web/assets/markdown-it.LICENSE`.
  npm distribution SHA-512 was verified against registry integrity before vendoring.
  Browser bundle SHA-256: `391f2aa638e75e6c7859d0a5c5650ef0956722a45998f17e05b83bc655778e1e`.
Build tools are not included in the client APK.

The companion source archive contains AICT's modifications and build overlay.
The exact upstream source remains available at the pinned tag above.
