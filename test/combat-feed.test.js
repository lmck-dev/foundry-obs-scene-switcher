/**
 * The combat tracker panel.
 *
 * The privacy rules are the character card's, reused rather than restated, so
 * most of what is checked here is that they really are the same rules — and
 * that the one deliberate difference holds: a gated NPC keeps its place in the
 * turn order under its name, and loses its portrait and its hit points.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SETTINGS, NPC_POLICY, DEFAULT_COMBAT_EVENT } from "../scripts/constants.js";
import {
  isHidden,
  buildRow,
  buildCombatPayload,
  combatEventName,
  pushCombat,
  refreshIfInCombat,
  resetCombatCache
} from "../scripts/combat-feed.js";
import { obs } from "../scripts/obs-client.js";
import {
  installFoundry,
  makeActor,
  makeCombatant,
  stubObs,
  muteConsole
} from "./helpers/foundry-mock.js";

/** A dnd5e-shaped actor, so the hit points come out of the real adapter. */
function hero(overrides = {}) {
  return makeActor({
    id: "hero-1",
    name: "Player Character",
    hasPlayerOwner: true,
    system: { attributes: { hp: { value: 19, max: 19 } } },
    ...overrides
  });
}

function monster(overrides = {}) {
  return makeActor({
    id: "dragon-1",
    name: "Adult Gold Dragon",
    hasPlayerOwner: false,
    system: { attributes: { hp: { value: 200, max: 256 } } },
    ...overrides
  });
}

/** A combat whose `turns` is the ordered list Foundry itself renders. */
function makeFight({ turns = [], round = 2, started = true, activeIndex = 0 } = {}) {
  return {
    turns,
    round,
    started,
    combatant: turns[activeIndex] ?? null
  };
}

function setUp(t, options = {}) {
  const foundry = installFoundry({ systemId: "dnd5e", ...options });
  const unmute = muteConsole();
  resetCombatCache();
  t.after(() => {
    resetCombatCache();
    unmute();
    foundry.restore();
  });
  return { foundry };
}

/* -------------------------------------------- */
/*  Hidden combatants                           */
/* -------------------------------------------- */

test("a combatant hidden from the players is never on the tracker", (t) => {
  setUp(t, {
    settings: { [SETTINGS.overlayNpcs]: NPC_POLICY.all },
    combat: makeFight({
      turns: [
        makeCombatant({ id: "c1", name: "Player Character", actor: hero() }),
        makeCombatant({ id: "c2", name: "Ambusher", actor: monster(), hidden: true })
      ]
    })
  });

  const payload = buildCombatPayload();

  assert.deepEqual(payload.combatants.map((row) => row.name), ["Player Character"]);
});

test("a combatant whose token is hidden is dropped too", (t) => {
  // The flag lives in two places depending on how the combatant was made.
  setUp(t, {
    settings: { [SETTINGS.overlayNpcs]: NPC_POLICY.all },
    combat: makeFight({
      turns: [
        makeCombatant({ id: "c1", name: "Player Character", actor: hero() }),
        makeCombatant({ id: "c2", name: "Lurker", actor: monster(), tokenHidden: true })
      ]
    })
  });

  assert.equal(isHidden(makeCombatant({ tokenHidden: true })), true);
  assert.deepEqual(
    buildCombatPayload().combatants.map((row) => row.name),
    ["Player Character"]
  );
});

/* -------------------------------------------- */
/*  The privacy gate                            */
/* -------------------------------------------- */

test("a player character gets a portrait and a health bar", (t) => {
  setUp(t);

  const row = buildRow(
    makeCombatant({ id: "c1", name: "Player Character", img: "tokens/hero.webp", actor: hero() }),
    { systemId: "dnd5e" }
  );

  assert.equal(typeof row.img, "string");
  assert.deepEqual(row.hp, { value: 19, max: 19, temp: 0, pct: 100 });
});

test("an ungated NPC keeps its name and initiative but loses everything else", (t) => {
  // This is the one place the tracker differs from the card: the card shows
  // nothing at all, but a turn order with a gap in it is not a turn order.
  setUp(t); // overlayNpcs defaults to "none"

  const row = buildRow(
    makeCombatant({
      id: "c2",
      name: "Adult Gold Dragon",
      img: "tokens/dragon.webp",
      initiative: 25,
      actor: monster()
    }),
    { systemId: "dnd5e" }
  );

  assert.equal(row.name, "Adult Gold Dragon");
  assert.equal(row.initiative, 25);
  assert.equal(row.img, null, "a gated NPC must not carry a portrait");
  assert.equal(row.hp, null, "a gated NPC must not carry hit points");
});

test("turning the portrait row off removes portraits from the tracker too", (t) => {
  // The row settings govern both panels. Reading them for the card but not the
  // tracker would put a face on stream that the GM had switched off.
  setUp(t, {
    settings: { [SETTINGS.overlayFields]: { portrait: false, hp: true } }
  });

  const row = buildRow(
    makeCombatant({ id: "c1", name: "Player Character", img: "tokens/hero.webp", actor: hero() }),
    { systemId: "dnd5e" }
  );

  assert.equal(row.img, null);
  assert.equal(row.hp.value, 19, "the other rows should be unaffected");
});

test("an NPC ticked for a card gets its portrait on the tracker too", (t) => {
  setUp(t, { settings: { [SETTINGS.overlayActors]: { "dragon-1": true } } });

  const row = buildRow(
    makeCombatant({ id: "c2", name: "Adult Gold Dragon", img: "tokens/dragon.webp", actor: monster() }),
    { systemId: "dnd5e" }
  );

  assert.equal(typeof row.img, "string");
});

test("an opted-in NPC still gets no hit points, because the NPC rows say so", (t) => {
  // OVERLAY_NPC_FIELDS defaults hp to false — being allowed on stream is not
  // the same as having your stat block read out.
  setUp(t, { settings: { [SETTINGS.overlayActors]: { "dragon-1": true } } });

  const row = buildRow(
    makeCombatant({ id: "c2", name: "Adult Gold Dragon", actor: monster() }),
    { systemId: "dnd5e" }
  );

  assert.equal(row.hp, null);
});

test("turning the NPC hit-point row on gives an opted-in NPC a bar", (t) => {
  setUp(t, {
    settings: {
      [SETTINGS.overlayActors]: { "dragon-1": true },
      [SETTINGS.overlayNpcFields]: { portrait: true, hp: true }
    }
  });

  const row = buildRow(
    makeCombatant({ id: "c2", name: "Adult Gold Dragon", actor: monster() }),
    { systemId: "dnd5e" }
  );

  assert.equal(row.hp.value, 200);
});

test("the 'mapped' policy uses the scene mapping as the opt-in here too", (t) => {
  setUp(t, {
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.mapped,
      [SETTINGS.sceneMappings]: { "dragon-1": "Dragon Cam" }
    }
  });

  const row = buildRow(
    makeCombatant({ id: "c2", name: "Adult Gold Dragon", img: "tokens/dragon.webp", actor: monster() }),
    { systemId: "dnd5e" }
  );

  assert.equal(typeof row.img, "string");
});

test("a combatant with no actor is listed without a portrait or bar", (t) => {
  setUp(t);

  const row = buildRow(makeCombatant({ id: "c9", name: "Mystery", initiative: 7 }));

  assert.equal(row.name, "Mystery");
  assert.equal(row.img, null);
  assert.equal(row.hp, null);
});

/* -------------------------------------------- */
/*  Turn order                                  */
/* -------------------------------------------- */

test("the row whose turn it is, is the one marked active", (t) => {
  setUp(t, {
    combat: makeFight({
      turns: [
        makeCombatant({ id: "c1", name: "First", actor: hero() }),
        makeCombatant({ id: "c2", name: "Second", actor: hero({ id: "hero-2" }) })
      ],
      activeIndex: 1
    })
  });

  const payload = buildCombatPayload();

  assert.deepEqual(
    payload.combatants.map((row) => [row.name, row.active]),
    [["First", false], ["Second", true]]
  );
});

test("the order is Foundry's own, not a re-sort", (t) => {
  // `turns` is already sorted by initiative with Foundry's tie-breaks applied;
  // sorting it again here would only find new ways to disagree with the table.
  setUp(t, {
    combat: makeFight({
      turns: [
        makeCombatant({ id: "c1", name: "Third", actor: hero(), initiative: 5 }),
        makeCombatant({ id: "c2", name: "First", actor: hero({ id: "h2" }), initiative: 25 })
      ]
    })
  });

  assert.deepEqual(
    buildCombatPayload().combatants.map((row) => row.name),
    ["Third", "First"]
  );
});

test("a combatant who has not rolled has no initiative rather than a zero", (t) => {
  // Zero is a legitimate initiative, so it cannot double as "unrolled".
  setUp(t);

  const row = buildRow(makeCombatant({ id: "c1", name: "Waiting", actor: hero() }));

  assert.equal(row.initiative, null);
});

test("an initiative of zero is kept as zero", (t) => {
  setUp(t);

  assert.equal(buildRow(makeCombatant({ id: "c1", initiative: 0, actor: hero() })).initiative, 0);
});

test("a defeated combatant is marked rather than removed", (t) => {
  setUp(t);

  const row = buildRow(makeCombatant({ id: "c1", name: "Down", actor: hero(), isDefeated: true }));

  assert.equal(row.defeated, true);
});

test("the round number travels with the payload", (t) => {
  setUp(t, {
    combat: makeFight({
      turns: [makeCombatant({ id: "c1", name: "Player Character", actor: hero() })],
      round: 3
    })
  });

  assert.equal(buildCombatPayload().round, 3);
});

/* -------------------------------------------- */
/*  When there is nothing to show               */
/* -------------------------------------------- */

test("no combat clears the tracker rather than leaving the last one up", (t) => {
  setUp(t, { combat: null });

  assert.equal(buildCombatPayload().present, false);
});

test("a combat with no visible combatants clears the tracker", (t) => {
  setUp(t, {
    combat: makeFight({
      turns: [makeCombatant({ id: "c1", name: "Ambusher", actor: monster(), hidden: true })]
    })
  });

  assert.equal(buildCombatPayload().present, false);
});

test("the panel being switched off clears it", (t) => {
  setUp(t, {
    settings: { [SETTINGS.combatEnabled]: false },
    combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] })
  });

  assert.equal(buildCombatPayload().present, false);
});

test("the override toggle being off clears it", (t) => {
  setUp(t, {
    settings: { [SETTINGS.syncEnabled]: false },
    combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] })
  });

  assert.equal(buildCombatPayload().present, false);
});

/* -------------------------------------------- */
/*  Pushing to OBS                              */
/* -------------------------------------------- */

test("the tracker is sent under the configured event name", async (t) => {
  setUp(t, {
    settings: { [SETTINGS.combatEventName]: "myCombatEvent" },
    combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] })
  });
  const spy = stubObs(obs);
  t.after(() => spy.restore());

  await pushCombat();

  assert.equal(spy.emitted.at(-1).eventName, "myCombatEvent");
});

test("a blank event name falls back to the default", (t) => {
  setUp(t, { settings: { [SETTINGS.combatEventName]: "   " } });

  assert.equal(combatEventName(), DEFAULT_COMBAT_EVENT);
});

test("an unchanged tracker is not re-sent", async (t) => {
  setUp(t, { combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] }) });
  const spy = stubObs(obs);
  t.after(() => spy.restore());

  await pushCombat();
  await pushCombat();

  assert.equal(spy.emitted.length, 1);
});

test("the heartbeat re-sends an unchanged tracker, which is its whole job", async (t) => {
  setUp(t, { combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] }) });
  const spy = stubObs(obs);
  t.after(() => spy.restore());

  await pushCombat();
  await pushCombat({ force: true });

  assert.equal(spy.emitted.length, 2);
});

test("a player client sends nothing", async (t) => {
  setUp(t, {
    isGM: false,
    combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] })
  });
  const spy = stubObs(obs);
  t.after(() => spy.restore());

  await pushCombat({ force: true });

  assert.equal(spy.emitted.length, 0);
});

test("a failed send is retried rather than cached as delivered", async (t) => {
  setUp(t, { combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] }) });
  let fail = true;
  const spy = stubObs(obs, {
    emit: () => {
      if (fail) throw new Error("socket closed");
      return {};
    }
  });
  t.after(() => spy.restore());

  await pushCombat();
  fail = false;
  await pushCombat();

  assert.equal(spy.emitted.length, 2, "the retry never happened");
});

/* -------------------------------------------- */
/*  Reacting to actor changes                   */
/* -------------------------------------------- */

test("damage to a combatant re-sends the tracker", async (t) => {
  setUp(t, { combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] }) });
  const spy = stubObs(obs);
  t.after(() => spy.restore());

  refreshIfInCombat("hero-1");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(spy.emitted.length, 1);
});

test("an actor who is not in the fight costs no OBS round trip", async (t) => {
  // updateActor fires constantly in a busy world; every push is a round trip.
  setUp(t, { combat: makeFight({ turns: [makeCombatant({ id: "c1", actor: hero() })] }) });
  const spy = stubObs(obs);
  t.after(() => spy.restore());

  refreshIfInCombat("somebody-else");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(spy.emitted.length, 0);
});
