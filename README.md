# OBS Scene Switcher — Foundry VTT module

Automatically switches OBS scenes based on combat state, the focused token, and
the active combat turn, and can put a live character card on your stream. Built
for DMs streaming or running remote games.

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

1. Tick **Stream Character Overlay** in the module settings.
2. Open **Configure Character Overlay** (settings submenu) and copy the
   **Browser Source URL**.
3. In OBS: **Sources → + → Browser**, paste the URL, and set the size to about
   **480 × 220**. Add it to whichever scenes should show the card.

Choose which rows appear from the same settings window. **Player characters and
NPCs have separate sets**, so a villain can appear with a portrait and a name
while their hit points and AC stay at the table — the NPC set defaults to
portrait only. The name is always shown, and rows a character has no data for
are hidden automatically, so a card never shows an empty field.

**Privacy:** player characters always appear. NPCs are gated by *Which NPCs may
appear*:

- **None — player characters only** (default).
- **Only NPCs with a scene mapping** — giving an NPC a scene already says it is
  one you feature on stream, so it doubles as a per-NPC opt-in. Map the recurring
  villain, and their card appears when the scene switches to them; every
  unmapped monster stays private, with no second list to maintain.
- **Any NPC** — puts every monster's hit points and AC on your stream.

Tokens hidden from players are never shown, whichever option you choose.

**Appearance:** the URL accepts `?accent=%23c0392b`, `&scale=1.25` and
`&anchor=top`. Every element has a stable class name, so OBS's own **Custom CSS**
box can restyle any part of the card without editing files.

**Systems:** dnd5e reads class levels, HP, AC, ability scores, speed, passive
perception and conditions. Other systems fall back to a generic reading —
portrait, name, and usually a health bar — rather than failing.

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
  main.js                   settings registration + hook wiring (entry point)
applications/
  mapping-config.js         ApplicationV2 settings submenu
  overlay-config.js         ApplicationV2 overlay settings submenu
overlay/
  overlay.html              the page an OBS Browser Source loads
  overlay.js                renders the character card
templates/*.hbs
styles/module.css
lang/en.json
```

## Status / testing

- 174 unit tests run in CI on every push (`npm test`, Node 22). They cover the
  obs-websocket handshake (cross-checked against the spec's example vector),
  every `resolveScene()` branch, the tracker button's DOM injection, the actor
  adapters, the overlay feed's privacy gating, and the overlay page itself.
- Scene switching has been run in a live game and worked as intended.
- The character overlay has **not yet been run against a real OBS** — the
  Browser Source setup is the part to smoke-test first.

## Out of scope

- Speaker-detection mode (switch to whoever is talking) — needs the world's AV
  client (native WebRTC vs LiveKit) decided first; the API differs.
- Export/import of mappings to JSON (per-world storage should make it unneeded).

## Open items to confirm in a live world

- Load the overlay in an OBS Browser Source and confirm the card appears and
  updates. If it stays blank, check that Foundry serves
  `/modules/foundry-obs-scene-switcher/overlay/overlay.html` without a login —
  if it does not, save the two `overlay/` files locally and point the Browser
  Source at the local file instead, which works identically.
- Confirm portraits load in OBS; they are sent as absolute Foundry URLs, so the
  OBS machine must be able to reach the Foundry server.
