import {
  MODULE_ID,
  SETTINGS,
  OVERLAY_FIELDS,
  OVERLAY_NPC_FIELDS,
  CHAT_CATEGORY_DEFAULTS,
  DEFAULT_CHAT_LINES,
  DEFAULT_OVERLAY_EVENT,
  DEFAULT_CHAT_EVENT,
  DEFAULT_COMBAT_EVENT,
  NPC_POLICY,
  getSetting,
  log,
  warn
} from "./constants.js";
import { obs } from "./obs-client.js";
import { syncScene, resetSceneCache } from "./scene-sync.js";
import { injectOverrideButton, updateAllButtons } from "./override-button.js";
import { refreshSettingsHighlight } from "./settings-highlight.js";
import { refreshOverlayUrlField } from "./overlay-url-field.js";
import { maskConnectionFields } from "./settings-privacy.js";
import {
  pushOverlay,
  refreshIfCurrent,
  resetOverlayCache,
  startHeartbeat
} from "./overlay-feed.js";
import {
  pushChat,
  recordMessage,
  forgetMessage,
  resetChatFeed
} from "./chat-feed.js";
import {
  pushCombat,
  refreshIfInCombat,
  resetCombatCache
} from "./combat-feed.js";
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
    onChange: () => {
      // The override toggle means "leave OBS alone", so every panel stands
      // down with it rather than leaving stale state on the stream.
      pushOverlay();
      pushChat();
      pushCombat();
    }
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

  // Per-actor card opt-in: { [actorId]: true }. Edited from the mapping window,
  // where the searchable actor list already lives.
  game.settings.register(MODULE_ID, SETTINGS.overlayActors, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
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

  // Chat feed. Client-scoped toggle like the card's, for the same reason: a
  // second GM on this world may not be the one streaming.
  game.settings.register(MODULE_ID, SETTINGS.chatEnabled, {
    name: `${MODULE_ID}.settings.chatEnabled.name`,
    hint: `${MODULE_ID}.settings.chatEnabled.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      // Switching the feed off must clear what is already on screen, not just
      // stop adding to it — a stale panel of chat is worse than none.
      resetChatFeed();
      pushChat({ force: true });
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.chatCategories, {
    scope: "world",
    config: false,
    type: Object,
    default: { ...CHAT_CATEGORY_DEFAULTS }
  });

  game.settings.register(MODULE_ID, SETTINGS.chatLines, {
    scope: "world",
    config: false,
    type: Number,
    default: DEFAULT_CHAT_LINES
  });

  game.settings.register(MODULE_ID, SETTINGS.chatEventName, {
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_CHAT_EVENT
  });

  // Combat tracker panel.
  game.settings.register(MODULE_ID, SETTINGS.combatEnabled, {
    name: `${MODULE_ID}.settings.combatEnabled.name`,
    hint: `${MODULE_ID}.settings.combatEnabled.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => pushCombat({ force: true })
  });

  game.settings.register(MODULE_ID, SETTINGS.combatEventName, {
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_COMBAT_EVENT
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
    resetCombatCache();
    await syncScene(); // apply current state immediately
    await pushOverlay({ force: true });
    await pushChat({ force: true });
    await pushCombat({ force: true });
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
  // One timer for all three panels, so they refill together.
  startHeartbeat([pushOverlay, pushChat, pushCombat]);
});

// Combat active/inactive transitions.
Hooks.on("combatStart", () => { syncScene(); pushOverlay(); pushCombat(); });
Hooks.on("deleteCombat", () => { syncScene(); pushOverlay(); pushCombat(); });

// Turn changes within combat.
Hooks.on("updateCombat", () => { syncScene(); pushOverlay(); pushCombat(); });

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
Hooks.on("updateActor", (actor) => {
  refreshIfCurrent(actor?.id);
  // The tracker shows every combatant's bar, not just the one on the card.
  refreshIfInCombat(actor?.id);
});
Hooks.on("updateToken", (tokenDoc) => {
  refreshIfCurrent(tokenDoc?.actor?.id);
  refreshIfInCombat(tokenDoc?.actor?.id);
  // A token being hidden or revealed changes who belongs on the tracker.
  pushCombat();
});

for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  // An effect's parent is the actor, or an item owned by one.
  Hooks.on(hook, (effect) =>
    refreshIfCurrent(effect?.parent?.actor?.id ?? effect?.parent?.id)
  );
}

// Combatants joining, leaving, being defeated or rolling initiative.
for (const hook of ["createCombatant", "updateCombatant", "deleteCombatant"]) {
  Hooks.on(hook, () => pushCombat());
}

/* -------------------------------------------- */
/*  Chat feed                                   */
/* -------------------------------------------- */

// Only push when the message actually made it past the gate — most do not once
// the categories are set, and a rejected message has changed nothing to send.
Hooks.on("createChatMessage", (message) => {
  if (recordMessage(message)) pushChat();
});

// Deleting a message at the table retracts it from the stream too.
Hooks.on("deleteChatMessage", (message) => {
  if (forgetMessage(message?.id)) pushChat();
});

// Inject the manual-override button into the combat tracker.
Hooks.on("renderCombatTracker", (app, html) => injectOverrideButton(app, html));

// Decorate the settings window: highlight the password field when auth has
// failed, and offer the Browser Source URL under the overlay toggle.
Hooks.on("renderSettingsConfig", (app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  maskConnectionFields(root ?? document);
  refreshSettingsHighlight(root ?? document);
  refreshOverlayUrlField(root ?? document);
});
