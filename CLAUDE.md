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
scripts/scene-sync.js        combat/token → scene mapping, + resolveSubject()
scripts/override-button.js   manual override control
scripts/character-data.js    actor → overlay payload, per game system
scripts/overlay-feed.js      pushes the current character to OBS
scripts/settings-highlight.js  auth-failure highlight in Settings
scripts/settings-privacy.js   masks the port/password in Settings
scripts/overlay-url-field.js  Browser Source URL under the overlay toggle
scripts/constants.js
applications/mapping-config.js + templates/mapping-config.hbs
applications/overlay-config.js + templates/overlay-config.hbs
overlay/overlay.html + overlay.js   loaded by an OBS Browser Source
styles/module.css · lang/en.json
.github/workflows/release.yml
```

**`release.yml` zips an explicit allowlist of paths.** A new top-level folder
that is not added there ships to nobody while working perfectly in dev.

## The stream overlay

A character card rendered in an OBS **Browser Source**, not a window inside
Foundry. The transport is obs-browser's vendor request:

```
CallVendorRequest { vendorName: "obs-browser", requestType: "emit_event",
                    requestData: { event_name, event_data } }
```

which dispatches `event_name` verbatim as a CustomEvent on the page's `window`,
with `event_data` as `event.detail`. Consequences that shape the design:

- **It is one-way and fire-and-forget.** The page cannot ask for state, and an
  event sent while a Browser Source was down is gone. OBS restarts a source
  whenever its scene becomes visible, so `overlay-feed.js` runs a 5s heartbeat
  re-sending the current payload. That, not any handshake, is what makes a
  reloaded overlay refill.
- **The overlay must be loaded as a local file, and that is not optional.**
  Foundry's static handler for the user data folder force-serves anything that
  mime-resolves to `text/html` as `text/plain` (`dist/server/express.mjs`,
  confirmed in 14.365), so modules cannot host pages on its origin. A Browser
  Source pointed at the served page shows the markup as text. No filename or
  extension avoids this — OBS's "Local file" option is the only route.
- **`overlay/overlay.js` is therefore a classic script.** `file://` blocks
  module imports, so `type="module"` would leave the page silently dead.
- Portraits are sent as **absolute** URLs (`absoluteImageUrl`) for the same
  reason — a relative path resolves against the filesystem in the file:// case.

`resolveSubject()` sits beside `resolveScene()` rather than inside it: scene
resolution falls through to the next candidate when a mapping is missing, but an
unmapped selected token is still the character the GM is looking at. They answer
different questions.

**Privacy is a correctness concern here.** Hidden tokens are never shown — that
holds however permissive everything below is. An NPC gets on the overlay by one
of two routes, checked in `mayAppear()`: the per-actor tick (`overlayActors`,
`{ [actorId]: true }`, edited from the Card column of the mapping window) or the
blanket policy. The tick exists because a card is a lighter grant than a scene:
a GM wants recurring NPCs named on stream while scene switches stay reserved for
the big moments. It is stored ticked-only, so a deleted actor does not linger.

`overlayNpcs` (`NPC_POLICY`: `none` | `mapped` | `all`) defaults to `none` —
without a gate, clicking a boss token puts its HP and AC on a live stream. The
`mapped` policy reuses the actor's scene mapping as per-NPC consent rather than
keeping a second list in step with it; `hasSceneMapping()` in `scene-sync.js`
shares `lookupMapping()` with `resolveScene()` so the two cannot disagree about
what "mapped" means. An unrecognised stored policy falls **shut**, not open.
All of this is covered by tests; treat it as load-bearing.

Row visibility is **two** settings, `overlayFields` and `overlayNpcFields`,
picked between by `hasPlayerOwner` in `visibleFields()`. They fall back to
different defaults (`OVERLAY_FIELDS` / `OVERLAY_NPC_FIELDS`) — passing the wrong
default to `resolveOverlayFields` silently gives NPCs the players' rows, which
is the same privacy leak by another route, so both directions are mutation-
tested.

## Settings-window decorations

Three modules reach into markup Foundry owns, all from the one
`renderSettingsConfig` hook, all idempotent because that hook fires on every
re-render:

- `settings-privacy.js` — masks the port and password (Foundry renders a String
  setting as a plain text input, so the obs-websocket password would otherwise
  be on screen in the clear, and this module's users are by definition live).
  It must not re-mask a field the user just revealed, hence the marker class.
- `overlay-url-field.js` — puts the Browser Source URL under the overlay toggle,
  following the checkbox live rather than the saved setting.
- `settings-highlight.js` — red outline on the password after an auth failure.

Any button injected into that form needs `type="button"`: the default would
submit the settings form and close the window.

**Templates are only exercised by `test/templates.test.js`.** Nothing else can
be: they render inside Foundry, and an unregistered Handlebars helper rejects
the whole ApplicationV2 render, so the window just never opens with the error
buried in the console. That is what `{{selected}}` did — **Foundry registers
`checked` and `disabled` but no `selected`**; use `{{selectOptions choices
selected=value localize=true}}`. The test's allowlist came from
`client/applications/handlebars.mjs` in a real 14.365 install.

`character-data.js` is the only file that knows system data paths (dnd5e, plus a
generic fallback). Supporting a new system means adding an adapter there and
nothing else.

## Build / test

There is **no build step**. Tests use `node:test`; `happy-dom` is the only
dependency and it is dev-only.

```bash
npm ci
npm test          # node --test --test-timeout=5000 "test/**/*.test.js"
```

225 tests covering `obs-client.js`, `scene-sync.js`, `override-button.js`,
`character-data.js`, `overlay-feed.js`, the settings-window decorations, the
overlay page and the Handlebars templates, run in CI on every push and PR
(`.github/workflows/test.yml`, Node 22; also verified on 24).

- `test/helpers/mock-websocket.js` — a scriptable WebSocket that lets a test
  drive the obs-websocket handshake frame by frame.
- `test/helpers/foundry-mock.js` — the slice of `game` / `canvas` the module
  reads. The source touches these at call time, not import time, so installing
  globals before invoking is enough. `game.i18n` is backed by the real
  `lang/en.json`, so a missing translation key fails a test instead of
  rendering a raw key to the user.
- `test/helpers/dom.js` — a happy-dom document, a Combat Tracker builder, and
  `loadOverlayPage()`, which pulls the skeleton out of the real `overlay.html`
  and evaluates the real `overlay.js` against it. A class the script looks for
  but the page stopped providing fails a test instead of appearing on stream.

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

The suite is mutation-tested: 29 deliberate breakages of the original code
(wrong auth ordering, inverted combat check, dropped debounce reset, removed
stale-socket guard, removed GM gate, append instead of prepend, …) and 20 of the
overlay code (hidden tokens broadcast, NPC gate removed, dedupe defeating the
heartbeat, names rendered as markup, …) were each confirmed to fail it. Five
early versions of these tests passed against broken code before being rewritten
— two of them in the overlay suite, both passing for a reason unrelated to what
they claimed to check. **If you add a test, break the code and check it actually
fails.**

`package.json` exists so Node treats `scripts/*.js` as ES modules and to hold
the dev dependency. Foundry ignores it, and the release zip's allowlist
excludes it, `test/` and `node_modules/`.

## Current state

**v1.0.0 is publicly released with an installable manifest and has been run in a
real game — it worked flawlessly (confirmed 2026-07-28).** Scene switching,
the settings UI and the connection indicator all behaved correctly in live play.

The stream character overlay is built, unit-tested, and **confirmed rendering in
a real OBS Browser Source** (2026-07-29). It lives on the pushed branch
`stream-character-overlay`, unmerged while the author lives with it.

Outstanding: submit the manifest to the Foundry package registry via the
foundryvtt.com admin panel.

Since the module is live and installable by others, treat regressions as
user-facing. The manifest URL points at `releases/latest`, so any release is
immediately live to installers — there is no staging step.

## Notes

- Because the client runs in the browser, OBS must have obs-websocket reachable
  from the Foundry client machine — not from the Foundry server.
- Releases are cut by `.github/workflows/release.yml`; the manifest URL points at
  `releases/latest`, so a bad release is immediately live to installers.
