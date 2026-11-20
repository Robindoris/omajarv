# Reactor WebGL context recovery

## Report and diagnosis

Reported context lost/restored messages followed by repeated WebGL INVALID_OPERATION
errors deleting objects belonging to a different context generation. The previous
reactor kept its scene, composer, bloom targets and GPU disposal listeners alive
through a renderer cache reset. The browser may lose a context under GPU pressure;
the application must not reuse the old generation's resources after restoration.
See the [Khronos context-loss guidance](https://wikis.khronos.org/webgl/HandlingContextLost).
No credentials or private access URLs are included in this record.

## Changes — 2026-11-20

The public reactor controller now owns a single rendering instance. On context
loss it stops animation, disconnects resize/interaction handlers and disposes the
old scene, textures, passes and renderer while the context is lost. Restoration
constructs a fresh rendering instance and reapplies activity and reduced-motion
settings. Late model-load callbacks release their unused scene instead of touching
an obsolete renderer. Renderer cleanup is idempotent and stale resize callbacks
are ignored. Both the model and procedural fallback follow the same lifecycle.

Cached-page navigation releases the instance on persisted pagehide and rebuilds
on pageshow, so back navigation does not resume a disposed renderer. Normal teardown
removes recovery listeners. The visual pose/orbit resets when a new instance loads;
chat and activity state remain intact. Context loss itself is browser controlled
and can still occur; this change fixes application recovery.

Removed the duplicate iframe allowFullScreen attribute; the existing fullscreen
permission in `allow` remains in place.

## Actual verification

- Isolated Chromium SwiftShader fixture reproduced **324 stale GPU deletions** with
  the pre-fix reactor (`git show HEAD:frontend/src/reactor.js`).
- `node tests/reactor-browser.mjs`: passed three actual forced context loss/restore
  cycles with the real core asset, resize, resumed drawing, activity preservation,
  cached-page suspend/resume and teardown. **Zero stale GPU deletions**, no invalid
  GL operation messages.
- `JARVIS_REACTOR_FALLBACK=1 node tests/reactor-browser.mjs`: passed the same recovery
  checks with the model unavailable and the procedural fallback active.
- `JARVIS_REACTOR_WIDTH=1280 node tests/reactor-browser.mjs`: passed desktop checks;
  the default fixture uses 390px phone emulation.
- `node tests/core-motion.mjs` and `node tests/core-orbit.mjs`: passed.
- `node tests/youtube-browser.mjs`: passed 1280/390/320px player checks.
- `JARVIS_TEST_WEBGL=1 node tests/theme-browser.mjs`: passed the full desktop/phone
  dashboard, Kanban, camera, onboarding, theme and sudo dialog regressions.
- Recovered model and fallback screenshots inspected; rendering remains visible.
- `npm run build:frontend`: passed; generated assets and content hashes updated.
- Recovery screenshots under `/tmp/jarvis-reactor-recovered-{loaded,fallback}.png`.

Tests use isolated browser profiles/public model assets, no live chat or credentials.
Software rendering verifies application behavior; physical GPU/driver pressure and
actual phone hardware were not reproduced. No backend restart or task lifecycle
change is required for this frontend repair; clients must refresh the new assets.
