/**
 * Shared constants for the OBS Scene Switcher module.
 */
export const MODULE_ID = "foundry-obs-scene-switcher";

/** Settings keys, kept in one place so typos surface as import errors. */
export const SETTINGS = {
  host: "obsHost",
  port: "obsPort",
  password: "obsPassword",
  sceneMappings: "sceneMappings",
  explorationScene: "explorationScene",
  dmFallbackScene: "dmFallbackScene",
  syncEnabled: "syncEnabled",
  overlayEnabled: "overlayEnabled",
  overlayFields: "overlayFields",
  overlayNpcFields: "overlayNpcFields",
  overlayNpcs: "overlayNpcs",
  overlayEventName: "overlayEventName"
};

/**
 * Which NPCs may appear on the stream overlay. Player characters always may.
 *
 * `mapped` uses the actor's scene mapping as the opt-in: giving an NPC a scene
 * is already a statement that it is featured on stream, so it doubles as
 * per-NPC consent without a second list to keep in step.
 */
export const NPC_POLICY = {
  none: "none",
  mapped: "mapped",
  all: "all"
};

/** Default name of the CustomEvent the overlay page listens for. */
export const DEFAULT_OVERLAY_EVENT = "obsSceneSwitcherCharacter";

/**
 * Rows the stream overlay can show, and whether each is on by default.
 *
 * Order is the order they render in. The defaults are the "readable in a
 * second, mid-combat" set; the rest are opt-in from the overlay settings.
 */
export const OVERLAY_FIELDS = {
  portrait: true,
  subtitle: true,
  hp: true,
  ac: true,
  abilities: false,
  speed: false,
  passivePerception: false,
  conditions: true
};

/**
 * The same rows for NPCs, defaulting to introduction rather than exposition:
 * who they are, not what they are made of. A villain's portrait belongs on
 * stream in a way their armour class does not.
 */
export const OVERLAY_NPC_FIELDS = {
  portrait: true,
  subtitle: false,
  hp: false,
  ac: false,
  abilities: false,
  speed: false,
  passivePerception: false,
  conditions: false
};

/** Fill in any field the stored setting predates or omits. */
export const resolveOverlayFields = (stored, defaults = OVERLAY_FIELDS) => ({
  ...defaults,
  ...(stored && typeof stored === "object" ? stored : {})
});

/** Convenience getter/setter scoped to this module. */
export const getSetting = (key) => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);

/** Namespaced logger so console output is easy to filter. */
export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);
export const warn = (...args) => console.warn(`${MODULE_ID} |`, ...args);
export const error = (...args) => console.error(`${MODULE_ID} |`, ...args);
