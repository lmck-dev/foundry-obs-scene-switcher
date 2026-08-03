# OBS Scene Switcher — Foundry VTT module

Automatically switches OBS scenes based on combat state, the focused token, and
the active combat turn, and can put a live character card, a chat feed and the
turn order on your stream. Built for DMs streaming or running remote games.

Connects **directly** to OBS's built-in `obs-websocket` server from the Foundry
browser client — no companion OBS-side plugin required.

- **Foundry compatibility:** v13 minimum, verified against v14.
- **OBS:** Studio 28+ (ships with obs-websocket v5).

## Installation

In Foundry: **Add-on Modules → Install Module**, then paste this manifest URL:

```
https://github.com/lmck-dev/foundry-obs-scene-switcher/releases/latest/download/module.json
```

(Once accepted into the Foundry package registry it will also be searchable by
name in the module browser.)

## How it works

The GM's client opens a WebSocket to OBS and, on every relevant Foundry event,
recomputes the desired scene from scratch (`resolveScene()`), then switches OBS
only if the target changed. Player clients never touch OBS.

Resolution order:

1. **Manual override OFF** → do nothing (leave OBS alone).
2. **Combat inactive** → *Exploration* scene.
3. **Combat active + a token focused (GM selection)** → that actor's mapped scene.
4. **Combat active + nothing focused** → current turn combatant's mapped scene.
5. **No mapping matched** → *Dungeon Master* fallback scene.

## Setup

1. In OBS: **Tools → WebSocket Server Settings** → enable the server, note the
   **port** (default `4455`) and **password**.
2. In Foundry: enable the module, then open **Game Settings → Configure Settings
   → OBS Scene Switcher** and enter the host / port / password. (These are
   client-scoped — they live on the DM's machine and never sync to players.)
   The port and password are **masked**, with a reveal button on each, so
   opening this window mid-stream does not put your obs-websocket credentials
   in front of an audience.
3. Open **Configure Scene Mappings** (settings submenu) to:
   - set the **Exploration** and **Dungeon Master** scenes, and
   - map individual actors to OBS scenes.
   If OBS is connected, scene-name fields auto-complete from your live scene list.

## Character overlay

Optionally shows a card on your stream for whoever the module is currently on —
portrait, class and level, hit points, AC — updating live as they take damage or
pick up conditions.

It renders in an **OBS Browser Source**, so your viewers see it; it is not a
window inside Foundry.

1. Tick **Stream Character Overlay** in the module settings. The **overlay
   file's** location appears directly underneath, with a copy button.
2. In OBS: **Sources → + → Browser**, tick **Local file**, and browse to that
   file inside your Foundry user data folder. Set the size to about
   **480 × 220**, and add the source to whichever scenes should show the card.

> **It has to be the local file, not a web address.** Foundry deliberately
> serves anything HTML-shaped from its user data folder as `text/plain`, so
> that modules cannot host pages on Foundry's origin. A Browser Source pointed
> at `http://your-foundry/modules/…/overlay.html` will display the markup as
> text instead of rendering the card. This is why the page is written to work
> from `file://`.

If OBS runs on a different machine from Foundry, copy `overlay/overlay.html`
and `overlay/overlay.js` to it — they are self-contained, and the card is
driven over the obs-websocket connection rather than from Foundry. Portraits
are the exception: they load from Foundry over HTTP, so that machine needs to
be able to reach it.

(The same path is also in the **Configure Character Overlay** submenu, alongside
the rest of the overlay settings.)

Choose which rows appear from the same settings window. **Player characters and
NPCs have separate sets**, so a villain can appear with a portrait and a name
while their hit points and AC stay at the table — the NPC set defaults to
portrait only. The name is always shown, and rows a character has no data for
are hidden automatically, so a card never shows an empty field.

**Privacy:** player characters always appear. NPCs need letting in, either
individually or by a blanket rule.

*Per NPC* — the **Card** column in **Configure Scene Mappings** puts that
character on the overlay with no scene switch attached. A card is a lighter
thing to give a character than a whole scene, so you can name every recurring
NPC while keeping scene changes for the boss fights. A ticked NPC appears
whatever the blanket rule says.

*Blanket rule* — **Which NPCs may appear**:

- **None — player characters only** (default).
- **Only NPCs with a scene mapping** — giving an NPC a scene already says it is
  one you feature on stream, so it doubles as an opt-in.
- **Any NPC** — puts every monster's hit points and AC on your stream.

Tokens hidden from players are never shown, by any route.

**Appearance:** the page accepts `?accent=%23c0392b`, `&scale=1.25` and
`&anchor=top`. OBS's **Local file** checkbox gives no way to add a query
string, so to use these, untick it and type the address into the URL box
instead:

```
file:///path/to/Data/modules/foundry-obs-scene-switcher/overlay/overlay.html?accent=%23c0392b&scale=1.25
```

Every element also has a stable class name, so OBS's own **Custom CSS** box can
restyle any part of the card without editing files or touching the URL.

**Systems:** dnd5e reads class levels, HP, AC, ability scores, speed, passive
perception and conditions. Other systems fall back to a generic reading —
portrait, name, and usually a health bar — rather than failing.

## Chat feed

A second Browser Source showing the tail of the chat log — who said it, what
they said, and dice results with their formula and total.

1. **Stream Chat Feed** is on by default in the module settings; the file path
   appears underneath it with a copy button.
2. In OBS: **Sources → + → Browser**, tick **Local file**, browse to
   `overlay/chat.html`. Around **380 × 500** suits a column down one side.

**Whispers and blind rolls are never sent.** There is no setting for that —
a toggle that could put your whispers on a live stream is one that will
eventually be left on by accident. Message text is also flattened to plain text
inside Foundry before it is sent, so the page is never handed markup.

Beyond that the feed shows **everything else in the log**. Your players'
messages always appear. Your own are shown by category, and **all categories
are on by default** — narrow them if the feed is noisy, not to make it work:

| Category | What it covers |
| --- | --- |
| Your dice rolls | Initiative, attacks and saves you roll, including every NPC's |
| Your in-character speech | Messages posted while speaking as an NPC |
| Your emotes | Scene description posted with `/emote` |
| Your out-of-character chat | Table talk posted as yourself |
| Module and system cards | Item cards, module notices, update banners — usually the noisiest |

**Messages on screen** sets how many of the most recent are kept.

Switching the feed on fills it from the log you already have, rather than
waiting for the next message — and changing the categories re-derives it, so
widening them reveals messages already posted and narrowing them retracts what
no longer qualifies. Deleting a message in Foundry retracts it too.

## Combat tracker

A third Browser Source showing the turn order, with whoever is up highlighted.
It hides itself when combat ends.

1. **Stream Combat Tracker** is on by default; the file path appears underneath.
2. In OBS: **Sources → + → Browser**, **Local file**, `overlay/combat.html`.
   Around **320 × 420** suits a side column.

Each row is a **name and an initiative**, nothing more — the character card
already exists for portraits and hit points, and keeping the tracker to two
fields means it has only one way to be empty rather than four.

That leaves exactly one privacy rule, and it is absolute: **combatants hidden
from the players never appear.** Everything that survives it is already on every
player's own tracker, so there is nothing further to gate — no opt-in needed for
NPCs to take their place in the order.

A combatant who has not rolled yet shows no initiative rather than a zero, and
defeated combatants are struck through rather than removed.

## Manual override

A **OBS Sync: On/Off** button is injected into the Combat Tracker. Toggle it off
to take manual control of OBS mid-combat without the module fighting you; toggle
it back on to immediately re-sync to the current state. This toggle is per-DM.

## File layout

```
module.json                 manifest
scripts/
  constants.js              module id, settings keys, logging
  obs-client.js             obs-websocket v5 client (SHA256 auth, requests)
  scene-sync.js             resolveScene() + resolveSubject() + syncScene()
  override-button.js        Combat Tracker toggle button
  character-data.js         actor -> overlay payload, per game system
  overlay-feed.js           pushes the current character to OBS
  chat-feed.js              filters and pushes the chat log to OBS
  combat-feed.js            pushes the turn order to OBS
  settings-highlight.js     auth-failure highlight in Settings
  settings-privacy.js       masks the port/password in Settings
  overlay-url-field.js      each panel's file location under its toggle
  main.js                   settings registration + hook wiring (entry point)
applications/
  mapping-config.js         ApplicationV2 settings submenu
  overlay-config.js         ApplicationV2 overlay settings submenu
overlay/                    the pages OBS Browser Sources load
  common.js                 helpers shared by all three pages
  overlay.html + overlay.js the character card
  chat.html    + chat.js    the chat feed
  combat.html  + combat.js  the combat tracker
templates/*.hbs
styles/module.css
lang/en.json
```

## Status / testing

- 366 unit tests run in CI on every push (`npm test`, Node 22). They cover the
  obs-websocket handshake (cross-checked against the spec's example vector),
  every `resolveScene()` branch, the tracker button's DOM injection, the actor
  adapters, all three feeds' privacy gating, the settings-window decorations,
  the three overlay pages themselves, and the Handlebars templates.
- Scene switching has been run in a live game and worked as intended.
- The character overlay has been rendered in a real OBS Browser Source and
  behaved as intended.
- The transport and all three pages are **confirmed working in a real OBS**;
  the panels were reached by a test payload sent from `selfTest()` below.
- **The chat feed and combat tracker have not yet been confirmed showing real
  game data on a live stream.**

### Proof of life

Both panels always show **something** while they have nothing to display, so a
blank source is never ambiguous:

| What you see | What it means |
| --- | --- |
| Amber dot, "waiting for Foundry…" | The page loaded but has received nothing. Check the module is on and OBS is connected. |
| Green dot, "no messages yet" / "no encounter" | Working and receiving; there is genuinely nothing to show. |
| Nothing at all | The Browser Source is not loading the page. Check the file path. |

Add `?idle=hide` to the source URL to suppress the strip once you go live —
which needs the URL box rather than the "Local file" tick, as with the other
query parameters.

The panels redraw only when something actually changes. The module re-sends the
current state every few seconds so a Browser Source that reloaded refills on its
own, and each page ignores a payload identical to what it is already showing —
otherwise every animation restarts on that timer and the panel appears to flash.
Text is sized to be read on a compressed stream; `&scale=1.25` adjusts it.

### Diagnostics

`game.modules.get("foundry-obs-scene-switcher").api` exposes two entry points
for when a panel is blank:

- `diagnose()` — prints every gate and the exact payload each feed would send.
- `selfTest()` — sends a payload to all three pages bypassing every gate. If
  the panels light up, the transport and pages are fine and a gate is closed.

## Out of scope

- Speaker-detection mode (switch to whoever is talking) — needs the world's AV
  client (native WebRTC vs LiveKit) decided first; the API differs.
- Export/import of mappings to JSON (per-world storage should make it unneeded).

## Open items to confirm in a live world

- Confirm portraits load in OBS. They are sent as absolute Foundry URLs, so the
  machine running OBS must be able to reach the Foundry server.
