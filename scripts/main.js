import {
  MODULE_ID,
  SETTINGS,
  OVERLAY_FIELDS,
  OVERLAY_NPC_FIELDS,
  DEFAULT_OVERLAY_EVENT,
  NPC_POLICY,
  getSetting,
  log,
  warn
} from "./constants.js";
import { obs } from "./obs-client.js";
import { syncScene, resetSceneCache } from "./scene-sync.js";
import { injectOverrideButton, updateAllButtons } from "./override-button.js";
import { refreshSettingsHighlight } from "./settings-highlight.js";
import {
  pushOverlay,
  refreshIfCurrent,
  resetOverlayCache,
  startHeartbeat
} from "./overlay-feed.js";
import { MappingConfig } from "../applications/mapping-config.js";
import { OverlayConfig } from "../applications/overlay-config.js";

/* -------------------------------------------- */
/*  Settings registration                       */
/* -------------------------------------------- */

function registerSettings() {
  // Connection details. Host/port are client-scoped (OBS runs on the DM's own
  // machine); the password is client-scoped too so it never syncs to players.
  game.settings.register(MODULE_ID, SETTINGS.host, {
    name: `${MODULE_ID}.settings.host.name`,
    hint: `${MODULE_ID}.settings.host.hint`,
    scope: "client",
    config: true,
    type: String,
    default: "localhost",
    onChange: () => reconnect()
  });

  game.settings.register(MODULE_ID, SETTINGS.port, {
    name: `${MODULE_ID}.settings.port.name`,
    hint: `${MODULE_ID}.settings.port.hint`,
    scope: "client",
    config: true,
    type: Number,
    default: 4455,
    onChange: () => reconnect()
  });

  game.settings.register(MODULE_ID, SETTINGS.password, {
    name: `${MODULE_ID}.settings.password.name`,
    hint: `${MODULE_ID}.settings.password.hint`,
    scope: "client",
    config: true,
    type: String,
    default: "",
    onChange: () => reconnect()
  });

  // Structured mapping data — hidden from the default page, edited via submenu.
  game.settings.register(MODULE_ID, SETTINGS.sceneMappings, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS.explorationScene, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS.dmFallbackScene, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // Manual override toggle — per-DM (client), driven by the tracker button.
  // Turning sync off means "leave OBS alone", so the overlay stands down too
  // rather than leaving a stale character card on the stream.
  game.settings.register(MODULE_ID, SETTINGS.syncEnabled, {
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => pushOverlay()
  });

  // Stream overlay. Client-scoped like the connection details: it drives this
  // DM's OBS, and a second GM on the same world may not be streaming at all.
  game.settings.register(MODULE_ID, SETTINGS.overlayEnabled, {
    name: `${MODULE_ID}.settings.overlayEnabled.name`,
    hint: `${MODULE_ID}.settings.overlayEnabled.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => pushOverlay({ force: true })
  });

  // Presentation choices are world-scoped, like the scene mappings — they
  // describe the campaign's look rather than one machine's setup.
  game.settings.register(MODULE_ID, SETTINGS.overlayFields, {
    scope: "world",
    config: false,
    type: Object,
    default: { ...OVERLAY_FIELDS }
  });

  game.settings.register(MODULE_ID, SETTINGS.overlayNpcFields, {
    scope: "world",
    config: false,
    type: Object,
    default: { ...OVERLAY_NPC_FIELDS }
  });

  game.settings.register(MODULE_ID, SETTINGS.overlayNpcs, {
    scope: "world",
    config: false,
    type: String,
    default: NPC_POLICY.none
  });

  game.settings.register(MODULE_ID, SETTINGS.overlayEventName, {
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_OVERLAY_EVENT
  });

  // Submenu for the structured mapping UI.
  game.settings.registerMenu(MODULE_ID, "mappingConfig", {
    name: `${MODULE_ID}.config.menuName`,
    label: `${MODULE_ID}.config.menuLabel`,
    hint: `${MODULE_ID}.config.menuHint`,
    icon: "fas fa-video",
    type: MappingConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "overlayConfig", {
    name: `${MODULE_ID}.overlay.menuName`,
    label: `${MODULE_ID}.overlay.menuLabel`,
    hint: `${MODULE_ID}.overlay.menuHint`,
    icon: "fas fa-id-badge",
    type: OverlayConfig,
    restricted: true
  });
}

/* -------------------------------------------- */
/*  OBS connection lifecycle                    */
/* -------------------------------------------- */

let reconnectTimer = null;

async function connect() {
  if (!game.user?.isGM) return; // only the GM client talks to OBS
  try {
    await obs.connect({
      host: getSetting(SETTINGS.host),
      port: getSetting(SETTINGS.port),
      password: getSetting(SETTINGS.password)
    });
    resetSceneCache();
    resetOverlayCache();
    await syncScene(); // apply current state immediately
    await pushOverlay({ force: true });
  } catch (err) {
    warn("Could not connect to OBS:", err.message);
    if (game.user?.isGM) {
      ui.notifications?.warn(
        game.i18n.format(`${MODULE_ID}.notify.connectFailed`, { error: err.message })
      );
    }
  }
}

/** Debounced reconnect used by connection-setting onChange handlers. */
function reconnect() {
  if (!game.user?.isGM) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 500);
}

/* -------------------------------------------- */
/*  Hook wiring                                 */
/* -------------------------------------------- */

Hooks.once("init", () => {
  log("Initialising");
  registerSettings();
});

Hooks.once("ready", () => {
  if (!game.user?.isGM) {
    log("Non-GM client — OBS sync disabled");
    return;
  }
  // Reflect connection health in the tracker button and settings window.
  obs.onStatusChange = () => {
    updateAllButtons();
    refreshSettingsHighlight();
  };
  connect();
  // Browser Sources reload whenever their scene becomes visible, and an event
  // sent while one was down is gone for good — so repeat the current state.
  startHeartbeat();
});

// Combat active/inactive transitions.
Hooks.on("combatStart", () => { syncScene(); pushOverlay(); });
Hooks.on("deleteCombat", () => { syncScene(); pushOverlay(); });

// Turn changes within combat.
Hooks.on("updateCombat", () => { syncScene(); pushOverlay(); });

// Token focus changes — only react to the GM's own selection.
Hooks.on("controlToken", () => {
  if (!game.user?.isGM) return;
  syncScene();
  pushOverlay();
});

/* -------------------------------------------- */
/*  Live overlay data                           */
/* -------------------------------------------- */

// Keep the card's numbers current — damage, healing, conditions, a token being
// hidden. Each of these fires constantly in a busy world, so refreshIfCurrent
// filters to the character actually on screen before touching OBS.
Hooks.on("updateActor", (actor) => refreshIfCurrent(actor?.id));
Hooks.on("updateToken", (tokenDoc) => refreshIfCurrent(tokenDoc?.actor?.id));

for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  // An effect's parent is the actor, or an item owned by one.
  Hooks.on(hook, (effect) =>
    refreshIfCurrent(effect?.parent?.actor?.id ?? effect?.parent?.id)
  );
}

// Inject the manual-override button into the combat tracker.
Hooks.on("renderCombatTracker", (app, html) => injectOverrideButton(app, html));

// Highlight the password field in the settings window when auth has failed.
Hooks.on("renderSettingsConfig", (app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  refreshSettingsHighlight(root ?? document);
});
