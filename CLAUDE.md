# OBS Scene Switcher — Claude Instructions

Foundry VTT module that switches OBS scenes from combat state, focused token and
active combat turn. Talks to OBS's built-in obs-websocket **v5 directly from the
browser** — no companion OBS plugin, no local bridge process.

- **Root**: `.../Foundry-OBS-Scene-Switcher/foundry-obs-scene-switcher/`
- **Module id**: `foundry-obs-scene-switcher` · v1.0.0 · MIT
- **Remote**: github.com/lmck-dev/foundry-obs-scene-switcher (public)
- Foundry compatibility: minimum 13, verified 14. UI is **ApplicationV2**.

## Layout

```
scripts/main.js              entry (esmodule)
scripts/obs-client.js        obs-websocket v5 client
scripts/scene-sync.js        combat/token → scene mapping
scripts/override-button.js   manual override control
scripts/settings-highlight.js
scripts/constants.js
applications/mapping-config.js + templates/mapping-config.hbs
styles/module.css · lang/en.json
.github/workflows/release.yml
```

## Build / test

There is **no build step**. Tests use `node:test` only — no dependencies, no
install step.

```bash
npm test          # node --test --test-timeout=5000 "test/**/*.test.js"
```

59 tests covering `obs-client.js` and `scene-sync.js`, run in CI on every push
and PR (`.github/workflows/test.yml`).

- `test/helpers/mock-websocket.js` — a scriptable WebSocket that lets a test
  drive the obs-websocket handshake frame by frame.
- `test/helpers/foundry-mock.js` — the slice of `game` / `canvas` the module
  reads. The source touches these at call time, not import time, so installing
  globals before invoking is enough.

Things worth knowing before editing the suite:

- **`--test-timeout` is not optional.** Several tests mock `setTimeout` via
  `t.mock.timers`, which disables the client's own 10s and 8s guards. Without
  the flag, a promise that never settles hangs the run forever instead of
  failing. A timed-out test is reported as **cancelled**, not failed — but the
  process still exits non-zero, so CI catches it.
- The DOM-facing modules (`override-button.js`, `settings-highlight.js`,
  `applications/mapping-config.js`) are untested; they need a DOM and are thin
  wiring over the logic that is tested.
- `scene-sync.js` keeps a module-level debounce cache. Call `resetSceneCache()`
  in `beforeEach` or one test's last scene silently suppresses the next test's
  switch.

The suite was mutation-tested: 15 deliberate breakages (wrong auth ordering,
inverted combat check, dropped debounce reset, removed stale-socket guard, …)
were each confirmed to fail it. If you add tests, check they can actually fail.

`package.json` exists only so Node treats `scripts/*.js` as ES modules. Foundry
ignores it, and the release zip excludes it.

## Current state

**v1.0.0 is publicly released with an installable manifest and has been run in a
real game — it worked flawlessly (confirmed 2026-07-28).** Scene switching,
the settings UI and the connection indicator all behaved correctly in live play.

Next step: submit the manifest to the Foundry package registry via the
foundryvtt.com admin panel.

Since the module is live and installable by others, treat regressions as
user-facing. The manifest URL points at `releases/latest`, so any release is
immediately live to installers — there is no staging step.

## Notes

- Because the client runs in the browser, OBS must have obs-websocket reachable
  from the Foundry client machine — not from the Foundry server.
- Releases are cut by `.github/workflows/release.yml`; the manifest URL points at
  `releases/latest`, so a bad release is immediately live to installers.
