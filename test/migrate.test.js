/**
 * Settings migrations.
 *
 * These matter more than their size suggests: a corrected default reaches a
 * brand-new world for free, and never reaches the worlds that already saved the
 * wrong one — which are precisely the worlds with the problem.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS,
  SETTINGS_VERSION,
  CHAT_CATEGORY_DEFAULTS
} from "../scripts/constants.js";
import { isLegacyCategoryDefault, migrateSettings, runMigrations } from "../scripts/migrate.js";
import { installFoundry, muteConsole } from "./helpers/foundry-mock.js";

/** A world that has never been migrated, whatever else it has stored. */
function setUp(t, settings = {}) {
  const foundry = installFoundry({
    settings: { [SETTINGS.settingsVersion]: 0, ...settings }
  });
  const unmute = muteConsole();
  t.after(() => {
    unmute();
    foundry.restore();
  });
  return foundry;
}

const ALL_OFF = { roll: false, ic: false, emote: false, ooc: false, other: false };

/* -------------------------------------------- */
/*  Recognising the old default                 */
/* -------------------------------------------- */

test("the all-off category map is recognised as the old default", (t) => {
  setUp(t);

  assert.equal(isLegacyCategoryDefault(ALL_OFF), true);
});

test("a world that never saved categories counts as never having chosen", (t) => {
  setUp(t);

  assert.equal(isLegacyCategoryDefault(undefined), true);
  assert.equal(isLegacyCategoryDefault(null), true);
});

test("a partial selection is a real choice and is left alone", (t) => {
  // Somebody who turned rolls on and the rest off meant it.
  setUp(t);

  assert.equal(isLegacyCategoryDefault({ ...ALL_OFF, roll: true }), false);
});

/* -------------------------------------------- */
/*  Migrating                                   */
/* -------------------------------------------- */

test("a world on the old all-off default is opened up", async (t) => {
  const foundry = setUp(t, { [SETTINGS.chatCategories]: ALL_OFF });

  const result = await migrateSettings();

  assert.deepEqual(foundry.store.get(SETTINGS.chatCategories), { ...CHAT_CATEGORY_DEFAULTS });
  assert.deepEqual(result.changed, [SETTINGS.chatCategories]);
});

test("a deliberate partial selection survives the migration untouched", async (t) => {
  const chosen = { ...ALL_OFF, roll: true, ic: true };
  const foundry = setUp(t, { [SETTINGS.chatCategories]: chosen });

  const result = await migrateSettings();

  assert.deepEqual(foundry.store.get(SETTINGS.chatCategories), chosen);
  assert.deepEqual(result.changed, []);
});

test("the version is stamped so it never runs twice", async (t) => {
  const foundry = setUp(t, { [SETTINGS.chatCategories]: ALL_OFF });

  await migrateSettings();
  assert.equal(foundry.store.get(SETTINGS.settingsVersion), SETTINGS_VERSION);

  // A GM narrows the feed again afterwards; the migration must not undo it.
  foundry.store.set(SETTINGS.chatCategories, ALL_OFF);
  const second = await migrateSettings();

  assert.deepEqual(second.changed, []);
  assert.deepEqual(foundry.store.get(SETTINGS.chatCategories), ALL_OFF);
});

test("an already-current world is left completely alone", async (t) => {
  const foundry = setUp(t, {
    [SETTINGS.settingsVersion]: SETTINGS_VERSION,
    [SETTINGS.chatCategories]: ALL_OFF
  });

  const result = await migrateSettings();

  assert.deepEqual(result.changed, []);
  assert.deepEqual(foundry.store.get(SETTINGS.chatCategories), ALL_OFF);
});

/* -------------------------------------------- */
/*  Running them                                */
/* -------------------------------------------- */

test("only the Gamemaster migrates a world", async (t) => {
  // Settings writes are the GM's to make; a player client attempting one would
  // be rejected by the server and log an error for something not its business.
  const foundry = installFoundry({
    isGM: false,
    settings: { [SETTINGS.settingsVersion]: 0, [SETTINGS.chatCategories]: ALL_OFF }
  });
  const unmute = muteConsole();
  t.after(() => {
    unmute();
    foundry.restore();
  });

  assert.equal(await runMigrations(), null);
  assert.deepEqual(foundry.store.get(SETTINGS.chatCategories), ALL_OFF);
});

test("a failed migration does not stop the module loading", async (t) => {
  const foundry = setUp(t, { [SETTINGS.chatCategories]: ALL_OFF });
  globalThis.game.settings.set = () => Promise.reject(new Error("world is locked"));

  assert.equal(await runMigrations(), null);
});
