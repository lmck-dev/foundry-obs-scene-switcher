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
scripts/chat-feed.js         filters + pushes the chat log to OBS
scripts/combat-feed.js       pushes the turn order to OBS
scripts/settings-highlight.js  auth-failure highlight in Settings
scripts/settings-privacy.js   masks the port/password in Settings
scripts/overlay-url-field.js  each panel's file path under its own toggle
scripts/constants.js
applications/mapping-config.js + templates/mapping-config.hbs
applications/overlay-config.js + templates/overlay-config.hbs
overlay/common.js                   helpers shared by all three pages
overlay/overlay.html + overlay.js   character card
overlay/chat.html    + chat.js      chat feed
overlay/combat.html  + combat.js    combat tracker
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

### migrate.js

**A corrected default only ever reaches worlds that never saved a value — and
the worlds that need it are the ones that saved the old one.** So a default
change that matters ships with a migration, keyed off the world-scoped
`settingsVersion`, GM-only, and wrapped so a failure never stops the module
loading. v1 opened up chat categories for worlds sitting on the all-off default;
`isLegacyCategoryDefault()` only matches an *exact* all-off map, so a partial
selection is treated as a real choice and left alone.

`character-data.js` is the only file that knows system data paths (dnd5e, plus a
generic fallback). Supporting a new system means adding an adapter there and
nothing else.

## The three panels

There are **three separate pages**, each its own Browser Source, not one page
behind a `?panel=` switch. That is forced by the same OBS constraint as
everything else here: **"Local file" hands the page no query string at all**, so
anything behind one would push every user onto a typed `file:///…` address just
to see a panel. Query parameters remain available for look-and-feel
(`?accent=`, `&scale=`, `&anchor=`, `&event=`) because those are optional.

`overlay/common.js` is a classic script the other three load first, via an
ordinary second `<script>` tag. It holds `el`/`clear`/`show`/`image`,
`SAFE_IMAGE`, and the shared `mount`/`readOptions`/`autoMount`. Each page's own
script pulls it off `window.OBSOverlayCommon`. **Keep payload data going through
`C.el(...)` / `textContent`** — a page that grew an `innerHTML` for payload data
would undo the guarantee the module side is built around.

Each feed owns a dedupe cache and is repeated by **one shared heartbeat**:
`startHeartbeat([pushOverlay, pushChat, pushCombat])` in `main.js`. The heartbeat
takes its feeds as an argument rather than importing them, because `chat-feed.js`
and `combat-feed.js` both import from `overlay-feed.js` — reaching back for them
would be a cycle.

### chat-feed.js

Two rules are not settings and must not become settings:

1. **Whispers and blind rolls never leave the module.** `isPrivate()` is checked
   *before* the author check in `mayShow()`, and that ordering is load-bearing —
   "player messages are always on" must not outrank "whispers never are". It is
   mutation-tested in both directions.
2. **Markup never leaves the module.** `stripHtml()` flattens message content
   through `DOMParser` (inert — no image fetches, unlike an `innerHTML` on a
   detached div) and **removes `<script>`/`<style>` first**, because
   `textContent` counts their *contents* as text and would otherwise read a
   message's embedded CSS onto the stream.

Past that: a message authored by a non-GM always goes through; a GM-authored one
needs its category ticked. Categories are `roll | ic | emote | ooc | other`, and
**`roll` wins over the style** — a roll is a roll however it was posted. An
unknown author falls to the GM's rules, so it cannot be a way past the gate.

**All categories default ON, and that is deliberate — do not "tighten" it.**
They shipped off first, reasoning that a quiet feed is the safe one. That was
wrong: privacy is held by the whisper and blind-roll exclusions, which no
setting can switch off, so a closed category costs content and protects nothing.
What it produced was a panel blank on arrival, indistinguishable from a broken
one, with the GM's own dice rolls — the single most useful thing on a stream —
missing by default. It cost a live debugging session. `test/chat-feed.test.js`
pins the literal default rather than `CHAT_CATEGORY_DEFAULTS`, so flipping the
constant fails a test instead of silently regressing.

**`seedChatFeed()` is why ticking the box does something.** The buffer used to
fill only from messages arriving *after* the feed was enabled, so enabling it
did nothing visible until somebody next spoke. Seeding re-derives the buffer
from `game.messages` through the same gate, on enable, on category save, and on
ready. Deriving from the log rather than filtering the buffer is also what makes
the categories work in both directions.
`resolveChatCategories()` coerces every stored value with `=== true`, which is
what lets `mayShow` trust a plain `=== true` further down; that coercion is
mutation-tested, so do not loosen it to `Boolean()`.

Foundry field names verified against the real 14.365 install
(`common/documents/chat-message.mjs`): `author`, `whisper` (array of user *ids*),
`blind`, `rolls`, `style`, with `CHAT_MESSAGE_STYLES` = OTHER 0 / OOC 1 / IC 2 /
EMOTE 3. The v12 `user`/`type` names are read as fallbacks.

### combat-feed.js

**A row is a name and an initiative, and nothing else.** It briefly also carried
portraits and hit-point bars behind the card's NPC gate; that made the panel's
contents depend on three separate settings and gave it four ways to be
legitimately, invisibly empty. The card already exists for everything else.
Do not add fields back here without a reason that outweighs that.

Consequently there is **one** privacy rule and it is absolute: a combatant
hidden from the players never appears, by its own flag *or* its token's.
Everything that survives is already on every player's own tracker, so no NPC
opt-in is needed — `mayAppear`/`visibleFields` are deliberately *not* imported.

Iterate `combat.turns` — Foundry's own sorted order with its tie-breaks already
applied. Re-sorting it here would only find new ways to disagree with the table.
`initiative: null` means "has not rolled"; zero is a legitimate initiative and
must survive as zero.

## Build / test

There is **no build step**. Tests use `node:test`; `happy-dom` is the only
dependency and it is dev-only.

```bash
npm ci
npm test          # node --test --test-timeout=5000 "test/**/*.test.js"
```

372 tests covering `obs-client.js`, `scene-sync.js`, `override-button.js`,
`character-data.js`, `overlay-feed.js`, `chat-feed.js`, `combat-feed.js`,
`migrate.js`, the
settings-window decorations, all three overlay pages and the Handlebars
templates, run in CI on every push and PR (`.github/workflows/test.yml`,
Node 22; also verified on 24).

- `test/helpers/mock-websocket.js` — a scriptable WebSocket that lets a test
  drive the obs-websocket handshake frame by frame.
- `test/helpers/foundry-mock.js` — the slice of `game` / `canvas` the module
  reads. The source touches these at call time, not import time, so installing
  globals before invoking is enough. `game.i18n` is backed by the real
  `lang/en.json`, so a missing translation key fails a test instead of
  rendering a raw key to the user.
- `test/helpers/dom.js` — a happy-dom document, a Combat Tracker builder, and
  `loadOverlayPage(panel)`, which pulls the skeleton out of the real `.html` and
  evaluates the real `common.js` + that page's script against it, in the order
  the `<script>` tags give. `panel` is `"character"` (default), `"chat"` or
  `"combat"`. A class the script looks for but the page stopped providing fails
  a test instead of appearing on stream. `installDom()` also installs
  `DOMParser`, which `stripHtml()` needs — without it a test would silently
  exercise the regex fallback instead of the real path.

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
stale-socket guard, removed GM gate, append instead of prepend, …), 20 of the
overlay code (hidden tokens broadcast, NPC gate removed, dedupe defeating the
heartbeat, names rendered as markup, …) and **35 of the chat/combat panel code**
(whispers no longer private, the author check hoisted above the privacy check,
script contents read as message text, hidden combatants reaching the tracker,
gated NPCs keeping their portraits, an unrolled initiative becoming zero, a page
appending instead of rebuilding, …) were each confirmed to fail it.

Of those 35, **34 were caught and one is a provable equivalent mutant**
(`categories[…] === true` → `!== false`; `resolveChatCategories` normalises
every value to a boolean first, so the two cannot differ — the structural test
"every category the module can classify has a default" is what keeps that true).

**Five early versions of these tests passed against broken code before being
rewritten** — two in the overlay suite, and one in the chat suite: it claimed to
prove a failed send is retried, and would have passed with the retry deleted,
because the send it exercised was the *first* one and so had nothing cached to
compare against. Rewriting it meant sending successfully first, failing second,
then returning the feed to the state that was last delivered. The mutation run
also found two places with no test at all rather than a wrong one (the tracker
honouring the portrait row setting; loose coercion of a stored category value).
**If you add a test, break the code and check it actually fails.**

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

The **chat feed and combat tracker** are merged to `main`. The transport and all
three pages are **confirmed working in a real OBS** — a payload from
`api.selfTest()` reached the Browser Sources — but neither panel has yet been
confirmed showing real game data on a live stream.

**`game.modules.get(MODULE_ID).api` exists because debugging this from outside
was hopeless.** `diagnose()` reports every gate and the payload each feed would
send; `selfTest()` bypasses the gates entirely, which is what separates "the
transport or page is broken" from "a gate is closed". Read from the *live*
module instances — a dynamic `import()` gets a second copy with its own empty
chat buffer and reports the wrong thing.

**The recurring failure mode in this module was a panel that is correctly empty
being indistinguishable from a broken one.** Three toggles, a category gate and
a per-NPC gate each produced it in turn, across three separate rounds of
debugging. Two rules came out of that, and both are load-bearing:

1. **Defaults show things.** Both panels register `default: true` and every chat
   category defaults on. A panel with no Browser Source pointed at it is
   invisible to everyone, so defaulting off protected nothing. Guarded by a
   static test in `test/templates.test.js`, because settings registration only
   runs inside Foundry.
2. **A live page is never fully blank.** `common.js` sets `data-live="no"` on
   mount and `"yes"` on the first delivered payload — via a single `deliver()`
   that both the event handler and the handle's `apply()` go through, so "live"
   means *a payload arrived* rather than *a listener fired*. The pages render an
   amber "waiting for Foundry…" line in the first state and a green "no messages
   yet" / "no encounter" in the second. `?idle=hide` suppresses it for going
   live. Nothing at all on screen now means the Browser Source is not loading
   the page — which is information, where before it meant any of four things.

When adding a gate, ask how a user will tell it apart from a bug.

**The heartbeat and the pages share the redraw decision, and the split matters.**
The module must keep re-sending the current payload — that is the only thing
that refills a Browser Source which reloaded, since the transport is one-way and
has no handshake. So the *page* is where an identical payload is dropped, in
`common.js`'s `deliver()`, because only the page knows what it last managed to
render. Without that, every heartbeat rebuilt the DOM and restarted every
entrance animation and CSS transition, which on stream read as the panel
flashing on a five-second timer. **`chat.js` additionally matches lines to existing nodes by message id and never
rebuilds the list**, because it is the only page whose rows animate on
insertion. The tracker gets away with rebuilding its rows since nothing on them
animates; chat cannot, and a rebuild there replays the whole feed's entrance.
A node already showing exactly its line is left completely alone — not
recreated, not re-ordered (`insertBefore` is skipped when the node is already
in position, since re-inserting restarts a CSS animation), not even re-filled
(`fillLine` compares a stored signature). Only genuinely new ids get `is-new`.

The two layers are independent and both are tested: `deliver()` saves the work,
the renderer makes the work harmless. The renderer's idempotence is tested by
calling `render()` directly and counting `insertBefore`/`appendChild`/
`removeChild` calls, because happy-dom cannot observe an animation restarting —
and neither can headless Chrome, which never fires `animationstart` under
`--disable-gpu`. Assert on the DOM mutation, not on the animation.

A **Dice So Nice chromakey view** was scoped and deferred (2026-08-03). It
cannot live on these pages: DSN's renderer only exists inside a real Foundry
client, and these are `file://` classic scripts with no three.js and no socket.
The workable route, if it is picked up, is a *second* Foundry client in a
Browser Source logged in as a dedicated user, with module-injected CSS hiding
the board and the UI and painting the body a key colour — DSN builds a
`div#dice-box-canvas` on `document.body` with a **transparent** WebGL context
(`alpha: true`) and broadcasts rolls over the `module.dice-so-nice` socket, so
every connected client draws them. Costs: a spare user seat, a one-time login
through OBS's Interact window, and a second WebGL client (stop the PIXI ticker).

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
