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

There is **no build step and no test suite**. Note that despite what earlier
notes may claim, no test file has ever existed in this repository — verify
claims about test coverage before repeating them.

## Current state — read before adding features

**v1.0.0 is publicly released with an installable manifest, and the module has
never been run inside a live Foundry world.** Passing local reasoning is not
evidence it loads.

The next step is to install via the manifest URL and smoke-test in a real world,
specifically:

- tracker button placement,
- ApplicationV2 form submit on the mapping config,
- the red-flash connection indicator.

Only after that: submit the manifest to the Foundry package registry via the
foundryvtt.com admin panel.

Prefer verifying the released build over extending it.

## Notes

- Because the client runs in the browser, OBS must have obs-websocket reachable
  from the Foundry client machine — not from the Foundry server.
- Releases are cut by `.github/workflows/release.yml`; the manifest URL points at
  `releases/latest`, so a bad release is immediately live to installers.
