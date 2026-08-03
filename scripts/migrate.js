/**
 * One-time fixes to settings already stored in a world.
 *
 * Changing a default only ever helps a world that never saved a value, and the
 * worlds that most need a corrected default are exactly the ones that saved the
 * old one. So a default change that matters has to come with a migration.
 *
 * Migrations run on the GM client only (settings writes are the GM's to make)
 * and are keyed off a stored version number, so they run once and then never
 * again — including across a downgrade and re-upgrade.
 */
import {
  SETTINGS,
  SETTINGS_VERSION,
  CHAT_CATEGORY_DEFAULTS,
  getSetting,
  setSetting,
  log,
  warn
} from "./constants.js";

/** The all-off category map that shipped first, and which nobody chose. */
const LEGACY_CATEGORY_DEFAULTS = {
  roll: false,
  ic: false,
  emote: false,
  ooc: false,
  other: false
};

/**
 * Whether a stored category map is the old default rather than a real choice.
 *
 * Only an exact match counts. A GM who has deliberately turned every category
 * off has made the same choice the old default made for them, and this cannot
 * tell the two apart — but that is the rarer case by far, and its cost is a
 * feed that is briefly noisier than they wanted rather than one that is
 * silently empty. Any partial selection is left completely alone.
 */
export function isLegacyCategoryDefault(stored) {
  if (!stored || typeof stored !== "object") return true; // never saved
  const keys = Object.keys(LEGACY_CATEGORY_DEFAULTS);
  return keys.every((key) => stored[key] === false);
}

/**
 * Bring a world's stored settings up to date. Returns what it changed, so the
 * caller can log it and the tests can assert on it.
 */
export async function migrateSettings() {
  const from = Number(getSetting(SETTINGS.settingsVersion)) || 0;
  if (from >= SETTINGS_VERSION) return { from, to: from, changed: [] };

  const changed = [];

  // v1: chat categories default on. A world sitting on the all-off default has
  // a chat panel that cannot show the GM's own dice rolls, which is the main
  // thing anyone wants on a stream.
  if (from < 1 && isLegacyCategoryDefault(getSetting(SETTINGS.chatCategories))) {
    await setSetting(SETTINGS.chatCategories, { ...CHAT_CATEGORY_DEFAULTS });
    changed.push(SETTINGS.chatCategories);
  }

  await setSetting(SETTINGS.settingsVersion, SETTINGS_VERSION);
  return { from, to: SETTINGS_VERSION, changed };
}

/** Run the migration, never letting a failure stop the module loading. */
export async function runMigrations() {
  if (!globalThis.game?.user?.isGM) return null;
  try {
    const result = await migrateSettings();
    if (result.changed.length) {
      log(`Migrated settings ${result.from} -> ${result.to}:`, result.changed.join(", "));
    }
    return result;
  } catch (err) {
    // A world that cannot be migrated should still run on its old settings.
    warn("Could not migrate settings:", err.message);
    return null;
  }
}
