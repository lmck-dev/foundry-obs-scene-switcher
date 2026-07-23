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
  syncEnabled: "syncEnabled"
};

/** Convenience getter/setter scoped to this module. */
export const getSetting = (key) => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);

/** Namespaced logger so console output is easy to filter. */
export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);
export const warn = (...args) => console.warn(`${MODULE_ID} |`, ...args);
export const error = (...args) => console.error(`${MODULE_ID} |`, ...args);
