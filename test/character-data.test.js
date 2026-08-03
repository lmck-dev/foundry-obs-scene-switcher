/**
 * The one file in the module that knows about system data paths, so the tests
 * here are mostly about reading real-world actor shapes correctly — including
 * the shapes that changed between versions of dnd5e and of Foundry itself.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildCharacterData, adapterFor, formatMod } from "../scripts/character-data.js";
import { makeActor } from "./helpers/foundry-mock.js";

/** A reasonably complete dnd5e player character. */
function dnd5eActor(overrides = {}) {
  return makeActor({
    name: "Thorin Oakshield",
    system: {
      attributes: {
        hp: { value: 38, max: 47, temp: 0 },
        ac: { value: 18 },
        movement: { walk: 25, units: "ft" }
      },
      skills: { prc: { passive: 13 } },
      abilities: {
        str: { value: 18, mod: 4 },
        dex: { value: 12, mod: 1 },
        con: { value: 16, mod: 3 },
        int: { value: 10, mod: 0 },
        wis: { value: 13, mod: 1 },
        cha: { value: 8, mod: -1 }
      },
      details: { race: { name: "Dwarf" }, background: { name: "Soldier" } }
    },
    items: [{ type: "class", name: "Fighter", system: { levels: 5 } }],
    ...overrides
  });
}

const dnd5e = { systemId: "dnd5e" };

test("formatMod signs modifiers the way a sheet does", () => {
  assert.equal(formatMod(4), "+4");
  assert.equal(formatMod(0), "+0");
  assert.equal(formatMod(-1), "-1");
  assert.equal(formatMod(null), null);
  assert.equal(formatMod("2"), "+2");
});

test("adapterFor routes dnd5e to its own adapter and everything else to generic", () => {
  const generic = adapterFor("pf2e");
  assert.notEqual(adapterFor("dnd5e"), generic);
  assert.equal(adapterFor("swade"), generic);
  assert.equal(adapterFor(""), generic);
  assert.equal(adapterFor(undefined), generic);
});

test("dnd5e: reads the headline stats off a character", () => {
  const data = buildCharacterData(dnd5eActor(), dnd5e);

  assert.equal(data.name, "Thorin Oakshield");
  assert.equal(data.system, "dnd5e");
  assert.equal(data.ac, 18);
  assert.equal(data.speed, "25 ft");
  assert.equal(data.passivePerception, 13);
  assert.deepEqual(data.hp, { value: 38, max: 47, temp: 0, pct: (38 / 47) * 100 });
});

test("dnd5e: builds the subtitle from class items, race and background", () => {
  const data = buildCharacterData(dnd5eActor(), dnd5e);
  assert.equal(data.subtitle, "Fighter 5 · Dwarf · Soldier");
});

test("dnd5e: multiclass characters list every class with its level", () => {
  const actor = dnd5eActor({
    items: [
      { type: "class", name: "Fighter", system: { levels: 5 } },
      { type: "class", name: "Rogue", system: { levels: 2 } },
      { type: "weapon", name: "Longsword", system: {} }
    ]
  });
  const data = buildCharacterData(actor, dnd5e);
  assert.match(data.subtitle, /^Fighter 5 \/ Rogue 2 · /);
});

test("dnd5e: falls back to the flat details.class string when there are no class items", () => {
  const actor = dnd5eActor({ items: [] });
  actor.system.details.class = "Barbarian";
  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.subtitle, "Barbarian · Dwarf · Soldier");
});

test("dnd5e: race and background read as plain strings too (older data)", () => {
  const actor = dnd5eActor();
  actor.system.details = { race: "Halfling", background: "Urchin" };
  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.subtitle, "Fighter 5 · Halfling · Urchin");
});

test("dnd5e: a character with nothing to say has a null subtitle, not an empty string", () => {
  // Null is what makes the overlay hide the row rather than render a gap.
  const actor = makeActor({ system: { attributes: {} }, items: [] });
  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.subtitle, null);
});

test("dnd5e: ability scores keep both the score and the signed modifier", () => {
  const data = buildCharacterData(dnd5eActor(), dnd5e);

  assert.equal(data.abilities.length, 6);
  assert.deepEqual(data.abilities[0], { key: "str", label: "STR", value: 18, mod: "+4" });
  const cha = data.abilities.find((a) => a.key === "cha");
  assert.equal(cha.mod, "-1");
});

test("temporary hit points are carried through", () => {
  const actor = dnd5eActor();
  actor.system.attributes.hp.temp = 7;
  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.hp.temp, 7);
});

test("hit points clamp to 0-100% so a bar can never overflow its track", () => {
  const actor = dnd5eActor();
  // Overhealing past max is legal in several systems.
  actor.system.attributes.hp = { value: 60, max: 47 };
  assert.equal(buildCharacterData(actor, dnd5e).hp.pct, 100);

  actor.system.attributes.hp = { value: -5, max: 47 };
  assert.equal(buildCharacterData(actor, dnd5e).hp.pct, 0);
});

test("a zero maximum yields a null percentage rather than a division by zero", () => {
  const actor = dnd5eActor();
  actor.system.attributes.hp = { value: 0, max: 0 };
  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.hp.pct, null);
  assert.equal(data.hp.value, 0);
});

test("zero hit points still produce a bar — only missing data suppresses it", () => {
  const actor = dnd5eActor();
  actor.system.attributes.hp = { value: 0, max: 47 };
  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.hp.pct, 0);
});

test("hit points are null when the system exposes none", () => {
  const actor = makeActor({ system: {} });
  assert.equal(buildCharacterData(actor, dnd5e).hp, null);
});

test("a hit point block with a maximum but no current value is not a health bar", () => {
  // Some actor types (vehicles, groups) carry a partial hp block. Rendering it
  // would put "null / 10" on stream, so it has to be rejected outright.
  const actor = makeActor({ system: { attributes: { hp: { max: 10 } } } });
  assert.equal(buildCharacterData(actor, dnd5e).hp, null);
});

test("string numbers coerce, and non-numeric values do not", () => {
  const actor = dnd5eActor();
  actor.system.attributes.hp = { value: "38", max: "47" };
  actor.system.attributes.ac = { value: "—" };
  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.hp.value, 38);
  assert.equal(data.hp.max, 47);
  assert.equal(data.ac, null);
});

test("conditions read both the v11+ and the older field names", () => {
  const actor = dnd5eActor({
    effects: [
      { name: "Prone", img: "icons/prone.webp" },
      { label: "Blessed", icon: "icons/bless.webp" }
    ]
  });
  const data = buildCharacterData(actor, dnd5e);
  assert.deepEqual(data.conditions, [
    { name: "Prone", img: "icons/prone.webp" },
    { name: "Blessed", img: "icons/bless.webp" }
  ]);
});

test("disabled and suppressed effects are not conditions", () => {
  const actor = dnd5eActor({
    effects: [
      { name: "Prone" },
      { name: "Disabled Thing", disabled: true },
      { name: "Suppressed Thing", isSuppressed: true },
      { name: "" }
    ]
  });
  const data = buildCharacterData(actor, dnd5e);
  assert.deepEqual(data.conditions.map((c) => c.name), ["Prone"]);
});

test("effects arrive as a Foundry collection as well as an array", () => {
  const actor = dnd5eActor({ effects: { contents: [{ name: "Hasted" }] } });
  const data = buildCharacterData(actor, dnd5e);
  assert.deepEqual(data.conditions.map((c) => c.name), ["Hasted"]);
});

test("generic: an unknown system still yields a portrait, a name and a health bar", () => {
  const actor = makeActor({
    name: "Nameless One",
    system: { attributes: { hp: { value: 12, max: 20 }, ac: 15 } }
  });
  const data = buildCharacterData(actor, { systemId: "some-indie-system" });

  assert.equal(data.system, "generic");
  assert.equal(data.name, "Nameless One");
  assert.equal(data.hp.value, 12);
  assert.equal(data.ac, 15, "a bare numeric ac should be read as well as { value }");
});

test("generic: finds hit points under system.hp when there is no attributes block", () => {
  const actor = makeActor({ system: { hp: { value: 4, max: 9 } } });
  const data = buildCharacterData(actor, { systemId: "other" });
  assert.equal(data.hp.max, 9);
});

test("generic: reports nothing it cannot honestly read", () => {
  const actor = makeActor({ system: {} });
  const data = buildCharacterData(actor, { systemId: "other" });

  assert.equal(data.speed, null);
  assert.equal(data.passivePerception, null);
  assert.equal(data.subtitle, null);
  assert.deepEqual(data.abilities, []);
  assert.deepEqual(data.conditions, []);
});

test("an adapter that throws falls back to the generic reading instead of taking the overlay down", () => {
  // A throwing getter stands in for a system whose data model moved. `skills`
  // is read by the dnd5e adapter only, so the generic fallback still succeeds.
  const actor = makeActor({
    system: {
      attributes: { hp: { value: 5, max: 10 } },
      get skills() {
        throw new Error("system data model changed");
      }
    }
  });

  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.name, "Test Character");
  assert.equal(data.adapterError, "system data model changed");
  assert.equal(data.hp.value, 5, "the generic reading should still find hit points");
});

test("an actor no adapter can read at all still puts a name and portrait on stream", () => {
  const actor = makeActor({ name: "Broken Data" });
  // Defined after construction: a throwing getter passed to makeActor would
  // detonate inside the helper's own destructuring instead.
  Object.defineProperty(actor, "system", {
    get() {
      throw new Error("everything is on fire");
    }
  });

  const data = buildCharacterData(actor, dnd5e);
  assert.equal(data.name, "Broken Data");
  assert.equal(data.img, "worlds/test/hero.webp");
  assert.equal(data.hp, null);
});

test("no actor yields no payload", () => {
  assert.equal(buildCharacterData(null, dnd5e), null);
});
