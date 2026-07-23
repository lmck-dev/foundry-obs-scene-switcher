import { MODULE_ID, SETTINGS, getSetting, log, warn } from "./constants.js";
import { obs } from "./obs-client.js";
import { syncScene, resetSceneCache } from "./scene-sync.js";
import { injectOverrideButton, updateAllButtons } from "./override-button.js";
import { refreshSettingsHighlight } from "./settings-highlight.js";
import { MappingConfig } from "../applications/mapping-config.js";

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
  game.settings.register(MODULE_ID, SETTINGS.syncEnabled, {
    scope: "client",
    config: false,
    type: Boolean,
    default: true
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
    await syncScene(); // apply current state immediately
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
});

// Combat active/inactive transitions.
Hooks.on("combatStart", () => syncScene());
Hooks.on("deleteCombat", () => syncScene());

// Turn changes within combat.
Hooks.on("updateCombat", () => syncScene());

// Token focus changes — only react to the GM's own selection.
Hooks.on("controlToken", () => {
  if (!game.user?.isGM) return;
  syncScene();
});

// Inject the manual-override button into the combat tracker.
Hooks.on("renderCombatTracker", (app, html) => injectOverrideButton(app, html));

// Highlight the password field in the settings window when auth has failed.
Hooks.on("renderSettingsConfig", (app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  refreshSettingsHighlight(root ?? document);
});
