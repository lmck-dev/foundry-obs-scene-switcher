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
  overlayActors: "overlayActors",
  overlayEventName: "overlayEventName",
  settingsVersion: "settingsVersion",
  chatEnabled: "chatEnabled",
  chatCategories: "chatCategories",
  chatLines: "chatLines",
  chatEventName: "chatEventName",
  combatEnabled: "combatEnabled",
  combatEventName: "combatEventName"
};

/**
 * Which NPCs may appear on the stream overlay, as a blanket rule. Player
 * characters always may, and an NPC ticked individually always may — a card is
 * a lighter thing to give a character than a whole scene, so the two are worth
 * deciding separately.
 *
 * `mapped` uses the actor's scene mapping as the opt-in: giving an NPC a scene
 * is already a statement that it is featured on stream.
 */
export const NPC_POLICY = {
  none: "none",
  mapped: "mapped",
  all: "all"
};

/** Default name of the CustomEvent each overlay page listens for. */
export const DEFAULT_OVERLAY_EVENT = "obsSceneSwitcherCharacter";
export const DEFAULT_CHAT_EVENT = "obsSceneSwitcherChat";
export const DEFAULT_COMBAT_EVENT = "obsSceneSwitcherCombat";

/**
 * What kind of thing a chat message is. Every message lands in exactly one of
 * these, so a GM can let dice results through without also broadcasting the
 * table's out-of-character chatter.
 *
 * `roll` wins over the message's style: a roll is a roll whether it was posted
 * in character or not, and it is the category people actually reason about.
 */
export const CHAT_CATEGORIES = {
  roll: "roll",
  ic: "ic",
  emote: "emote",
  ooc: "ooc",
  other: "other"
};

/**
 * Which categories reach the stream, for **GM-authored messages only**.
 *
 * Messages a player wrote are always shown — they are the players' own words in
 * a log the whole table can already read. The GM's are the ones worth choosing
 * between, because the GM is also the author of every monster's attack roll and
 * every module's status card.
 *
 * **All default on.** They defaulted off originally, on the reasoning that a
 * quiet feed is the safe one — but that was the wrong trade. Privacy is already
 * guaranteed by the whisper and blind-roll exclusions, which no setting can
 * switch off, so a closed category costs content rather than protecting
 * anything. What it actually produced was a panel that was blank on arrival and
 * indistinguishable from a broken one, and a GM's own dice rolls — the single
 * most useful thing on a stream — missing by default. Narrowing the feed is now
 * something you do because it is noisy, not something you must do before it
 * works at all.
 */
export const CHAT_CATEGORY_DEFAULTS = {
  roll: true,
  ic: true,
  emote: true,
  ooc: true,
  other: true
};

/**
 * Current shape of this module's stored settings.
 *
 * 0 = never migrated. 1 = chat categories default on rather than off.
 *
 * A changed default only helps a world that never saved a value, and the very
 * worlds that need this one are the worlds that saved the old defaults — so the
 * migration has to rewrite them, not just define a better fallback.
 */
export const SETTINGS_VERSION = 1;

/** How many messages the chat panel keeps on screen. */
export const DEFAULT_CHAT_LINES = 8;

/** Bound the line count: zero would blank the panel, and a huge value overflows it. */
export const CHAT_LINES_MIN = 1;
export const CHAT_LINES_MAX = 30;

/** Fill in any category the stored setting predates, and drop ones it invented. */
export const resolveChatCategories = (stored) => {
  const merged = { ...CHAT_CATEGORY_DEFAULTS };
  if (stored && typeof stored === "object") {
    for (const key of Object.keys(CHAT_CATEGORY_DEFAULTS)) {
      merged[key] = stored[key] === true;
    }
  }
  return merged;
};

/** Clamp a stored line count into range, falling back on anything unreadable. */
export const resolveChatLines = (stored) => {
  const n = Math.trunc(Number(stored));
  if (!Number.isFinite(n)) return DEFAULT_CHAT_LINES;
  return Math.max(CHAT_LINES_MIN, Math.min(CHAT_LINES_MAX, n));
};

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
