# OBS Scene Switcher — Foundry VTT module

Automatically switches OBS scenes based on combat state, the focused token, and
the active combat turn. Built for DMs streaming or running remote games.

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
  scene-sync.js             resolveScene() + syncScene() orchestration
  override-button.js        Combat Tracker toggle button
  main.js                   settings registration + hook wiring (entry point)
applications/
  mapping-config.js         ApplicationV2 settings submenu
templates/mapping-config.hbs
styles/module.css
lang/en.json
```

## Status / testing

- Handshake math and `resolveScene()` branch logic are unit-tested in Node
  (crypto cross-checked against the obs-websocket spec's example vector).
- **Not yet exercised inside a live Foundry v14 client** — the DOM-injection
  point for the tracker button and the ApplicationV2 form submission should be
  smoke-tested in a real world. See "Open items" below.

## Out of scope for v1

- Speaker-detection mode (switch to whoever is talking) — needs the world's AV
  client (native WebRTC vs LiveKit) decided first; the API differs.
- Export/import of mappings to JSON (per-world storage should make it unneeded).

## Open items to confirm in a live world

- Exact placement of the override button within the v14 Combat Tracker markup
  (current code targets `.combat-controls` / header, falling back to prepend).
- Verify the ApplicationV2 `form-footer.hbs` partial path and submit flow render
  as expected on v14.
