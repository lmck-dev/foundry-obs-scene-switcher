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

There is **no build step**. Tests use `node:test`; `happy-dom` is the only
dependency and it is dev-only.

```bash
npm ci
npm test          # node --test --test-timeout=5000 "test/**/*.test.js"
```

88 tests covering `obs-client.js`, `scene-sync.js` and `override-button.js`,
run in CI on every push and PR (`.github/workflows/test.yml`, Node 22; also
verified on 24).

- `test/helpers/mock-websocket.js` — a scriptable WebSocket that lets a test
  drive the obs-websocket handshake frame by frame.
- `test/helpers/foundry-mock.js` — the slice of `game` / `canvas` the module
  reads. The source touches these at call time, not import time, so installing
  globals before invoking is enough. `game.i18n` is backed by the real
  `lang/en.json`, so a missing translation key fails a test instead of
  rendering a raw key to the user.
- `test/helpers/dom.js` — a happy-dom document, plus a Combat Tracker builder.

Things worth knowing before editing the suite:

- **`--test-timeout` is not optional.** Several tests mock `setTimeout` via
  `t.mock.timers`, which disables the client's own 10s and 8s guards. Without
  the flag, a promise that never settles hangs the run forever instead of
  failing. A timed-out test is reported as **cancelled**, not failed — but the
  process still exits non-zero, so CI catches it.
- **Never assert on a DOM node.** `assert.equal(el, null)` puts a happy-dom
  element into the failure's `actual`, and that object is deeply circular
  (`parentNode` ↔ `childNodes` ↔ `ownerDocument`). node:test tries to serialise
  it for the diff and the *failing* test hangs for ~14s and reports no message
  at all. Use `count(root, selector)` from `helpers/dom.js`, or compare with
  `===` inside `assert.ok`. This was found the hard way.
- `scene-sync.js` keeps a module-level debounce cache. Call `resetSceneCache()`
  in `beforeEach` or one test's last scene silently suppresses the next test's
  switch.
- `installDom()` builds a fresh Window per test. That matters because
  `updateAllButtons()` scans the whole document, so a button left over from an
  earlier test would be picked up by a later one.

`settings-highlight.js` and `applications/mapping-config.js` remain untested —
thin wiring over logic that is covered.

The suite is mutation-tested: 29 deliberate breakages (wrong auth ordering,
inverted combat check, dropped debounce reset, removed stale-socket guard,
removed GM gate, append instead of prepend, …) were each confirmed to fail it.
Three early versions of these tests passed against broken code before being
rewritten. **If you add a test, break the code and check it actually fails.**

`package.json` exists so Node treats `scripts/*.js` as ES modules and to hold
the dev dependency. Foundry ignores it, and the release zip's allowlist
excludes it, `test/` and `node_modules/`.

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
