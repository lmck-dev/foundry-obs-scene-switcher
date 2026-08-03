/**
 * The chat and combat pages, as they ship.
 *
 * Both are driven through the real .html and the real .js, so a class the
 * script looks for but the page stopped providing fails here rather than
 * appearing as an empty panel on a live stream.
 *
 * The recurring theme is that payload data must land in text nodes. The module
 * flattens chat HTML before it sends it, but that is a second line of defence,
 * not the only one — if a page ever grew an `innerHTML` for payload data, these
 * are the tests that should stop it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { loadOverlayPage, emitOverlayEvent, count } from "./helpers/dom.js";

/* -------------------------------------------- */
/*  Chat page                                   */
/* -------------------------------------------- */

function chatPage(t) {
  const dom = loadOverlayPage("chat");
  t.after(() => dom.restore());
  return dom;
}

function chatPayload(lines) {
  return { v: 1, present: true, lines };
}

const LINE = {
  id: "m1",
  category: "ooc",
  alias: "Ana",
  img: null,
  text: "hello table",
  rolls: []
};

test("the chat page mounts itself and starts empty", (t) => {
  const dom = chatPage(t);

  assert.equal(dom.instance.eventName, "obsSceneSwitcherChat");
  assert.equal(dom.root.dataset.state, "empty");
});

test("a chat payload renders one node per message", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([LINE, { ...LINE, id: "m2", text: "second" }]));

  assert.equal(count(dom.root, ".chat-line"), 2);
  assert.equal(dom.root.dataset.state, "shown");
});

test("the alias and the text are rendered", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([LINE]));

  assert.equal(dom.root.querySelector(".chat-alias").textContent, "Ana");
  assert.equal(dom.root.querySelector(".chat-text").textContent, "hello table");
});

test("message text is never parsed as markup", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, text: "<img src=x onerror=alert(1)>" }]));

  assert.equal(count(dom.root, "img"), 0, "payload text became an element");
  assert.equal(
    dom.root.querySelector(".chat-text").textContent,
    "<img src=x onerror=alert(1)>"
  );
});

test("an alias is never parsed as markup either", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, alias: "<b>Ana</b>" }]));

  assert.equal(count(dom.root, ".chat-alias b"), 0);
});

test("a roll renders its formula and total", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(
    chatPayload([{ ...LINE, category: "roll", rolls: [{ formula: "1d20 + 2", total: 18 }] }])
  );

  assert.equal(dom.root.querySelector(".chat-roll-formula").textContent, "1d20 + 2");
  assert.equal(dom.root.querySelector(".chat-roll-total").textContent, "18");
});

test("a roll total of zero is rendered, not treated as absent", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(
    chatPayload([{ ...LINE, category: "roll", rolls: [{ formula: "1d20 - 5", total: 0 }] }])
  );

  assert.equal(dom.root.querySelector(".chat-roll-total").textContent, "0");
});

test("a roll with no total still shows its formula", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(
    chatPayload([{ ...LINE, category: "roll", rolls: [{ formula: "2d6", total: null }] }])
  );

  assert.equal(count(dom.root, ".chat-roll-formula"), 1);
  assert.equal(count(dom.root, ".chat-roll-total"), 0);
});

test("the category is exposed so OBS custom CSS can style it", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, category: "emote" }]));

  assert.equal(dom.root.querySelector(".chat-line").dataset.category, "emote");
});

test("a portrait is rendered when the URL is one we will load", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, img: "https://foundry.example/hero.webp" }]));

  assert.equal(count(dom.root, "img.chat-avatar"), 1);
});

test("a javascript: portrait URL is refused", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, img: "javascript:alert(1)" }]));

  assert.equal(count(dom.root, "img.chat-avatar"), 0);
});

test("a cleared payload empties the feed rather than leaving it up", (t) => {
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE]));

  dom.instance.apply({ v: 1, present: false, lines: [] });

  assert.equal(count(dom.root, ".chat-line"), 0);
  assert.equal(dom.root.dataset.state, "empty");
});

test("a shrinking feed leaves no stale lines behind", (t) => {
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE, { ...LINE, id: "m2" }, { ...LINE, id: "m3" }]));

  dom.instance.apply(chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line"), 1);
});

test("the chat page renders what arrives on its event", (t) => {
  const dom = chatPage(t);

  emitOverlayEvent(dom, "obsSceneSwitcherChat", chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line"), 1);
});

test("the chat page ignores an event it was not mounted for", (t) => {
  const dom = chatPage(t);

  emitOverlayEvent(dom, "someoneElsesEvent", chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line"), 0);
});

/* -------------------------------------------- */
/*  Combat page                                 */
/* -------------------------------------------- */

function combatPage(t) {
  const dom = loadOverlayPage("combat");
  t.after(() => dom.restore());
  return dom;
}

function combatPayload(combatants, extra = {}) {
  return { v: 1, present: true, round: 2, started: true, combatants, ...extra };
}

const ROW = {
  id: "c1",
  name: "Player Character",
  initiative: 18,
  active: false,
  defeated: false
};

test("the combat page mounts itself and starts empty", (t) => {
  const dom = combatPage(t);

  assert.equal(dom.instance.eventName, "obsSceneSwitcherCombat");
  assert.equal(dom.root.dataset.state, "empty");
});

test("a combat payload renders one row per combatant", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW, { ...ROW, id: "c2", name: "Dragon" }]));

  assert.equal(count(dom.root, ".combat-row"), 2);
  assert.equal(dom.root.dataset.state, "shown");
});

test("the active combatant's row is marked", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW, { ...ROW, id: "c2", active: true }]));

  assert.equal(count(dom.root, ".combat-row.active"), 1);
});

test("a defeated combatant's row is marked", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, defeated: true }]));

  assert.equal(count(dom.root, ".combat-row.defeated"), 1);
});

test("names are never parsed as markup", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, name: "<b>Dragon</b>" }]));

  assert.equal(count(dom.root, ".combat-name b"), 0);
  assert.equal(dom.root.querySelector(".combat-name").textContent, "<b>Dragon</b>");
});

test("the round header reads the round number", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW], { round: 4 }));

  assert.equal(dom.root.querySelector(".combat-round").textContent, "Round 4");
});

test("a combat that has not started shows no round header", (t) => {
  // Round 0 during initiative rolling is not a round yet.
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW], { started: false, round: 0 }));

  assert.equal(dom.root.querySelector(".combat-round").hidden, true);
});

test("an initiative of zero is rendered, not treated as absent", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, initiative: 0 }]));

  assert.equal(dom.root.querySelector(".combat-init").textContent, "0");
});

test("a combatant who has not rolled gets no initiative box", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, initiative: null }]));

  assert.equal(count(dom.root, ".combat-init"), 0);
});

test("the tracker renders no images at all, whatever a row carries", (t) => {
  // Rows are a name and a number by design. A payload from an older module
  // still carrying an image must not resurrect a picture on the stream.
  const dom = combatPage(t);

  dom.instance.apply(
    combatPayload([{ ...ROW, img: "javascript:alert(1)", hp: { value: 1, max: 2, pct: 50 } }])
  );

  assert.equal(count(dom.root, "img"), 0);
  assert.equal(count(dom.root, ".combat-hp"), 0);
});

test("combat ending empties the tracker rather than leaving it up", (t) => {
  const dom = combatPage(t);
  dom.instance.apply(combatPayload([ROW]));

  dom.instance.apply({ v: 1, present: false, combatants: [] });

  assert.equal(count(dom.root, ".combat-row"), 0);
  assert.equal(dom.root.dataset.state, "empty");
  assert.equal(dom.root.querySelector(".combat-round").hidden, true);
});

test("a shrinking turn order leaves no stale rows behind", (t) => {
  const dom = combatPage(t);
  dom.instance.apply(combatPayload([ROW, { ...ROW, id: "c2" }, { ...ROW, id: "c3" }]));

  dom.instance.apply(combatPayload([ROW]));

  assert.equal(count(dom.root, ".combat-row"), 1);
});

test("the combat page renders what arrives on its event", (t) => {
  const dom = combatPage(t);

  emitOverlayEvent(dom, "obsSceneSwitcherCombat", combatPayload([ROW]));

  assert.equal(count(dom.root, ".combat-row"), 1);
});

/* -------------------------------------------- */
/*  Shared options                              */
/* -------------------------------------------- */

test("each page defaults to its own event name", (t) => {
  const chat = chatPage(t);
  const combat = combatPage(t);

  assert.equal(chat.overlay.readOptions("").event, "obsSceneSwitcherChat");
  assert.equal(combat.overlay.readOptions("").event, "obsSceneSwitcherCombat");
});

test("the pages accept the same look-and-feel parameters as the card", (t) => {
  const dom = chatPage(t);

  const opts = dom.overlay.readOptions("?event=x&accent=%23ff0000&scale=1.5&anchor=top");

  assert.deepEqual(opts, {
    event: "x",
    accent: "#ff0000",
    scale: 1.5,
    anchor: "top",
    idle: "show"
  });
});

/* -------------------------------------------- */
/*  Not flashing                                */
/* -------------------------------------------- */

test("an identical payload does not rebuild the page", (t) => {
  // The module re-sends the same payload every few seconds so a reloaded
  // Browser Source refills. Rebuilding for it restarted every animation and
  // transition, which on stream read as the panel flashing on a timer.
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE]));
  const before = dom.root.querySelector(".chat-line");

  dom.instance.apply(chatPayload([LINE]));

  assert.equal(
    dom.root.querySelector(".chat-line") === before,
    true,
    "the node was replaced, so its animation restarted"
  );
});

test("the heartbeat still refills a page that has not seen the payload", (t) => {
  // The skip must be per-page and per-content, never a reason for a freshly
  // loaded source to stay empty — that is the whole point of the heartbeat.
  const dom = chatPage(t);

  emitOverlayEvent(dom, "obsSceneSwitcherChat", chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line"), 1);
});

test("a changed payload does rebuild", (t) => {
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE]));

  dom.instance.apply(chatPayload([LINE, { ...LINE, id: "m2", text: "new" }]));

  assert.equal(count(dom.root, ".chat-line"), 2);
});

test("only newly arrived lines animate in", (t) => {
  // A single new message must not re-animate every line above it.
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE]));
  assert.equal(count(dom.root, ".chat-line.is-new"), 1, "the first line should animate");

  dom.instance.apply(chatPayload([LINE, { ...LINE, id: "m2", text: "new" }]));

  assert.equal(count(dom.root, ".chat-line"), 2);
  assert.equal(count(dom.root, ".chat-line.is-new"), 1, "only the new line should animate");
  assert.equal(dom.root.querySelector(".chat-line.is-new").textContent.includes("new"), true);
});

test("a line that leaves and returns animates again", (t) => {
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE]));
  dom.instance.apply({ v: 1, present: false, lines: [] });

  dom.instance.apply(chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line.is-new"), 1);
});

test("an identical combat payload does not rebuild the tracker", (t) => {
  const dom = combatPage(t);
  dom.instance.apply(combatPayload([ROW]));
  const before = dom.root.querySelector(".combat-row");

  dom.instance.apply(combatPayload([ROW]));

  assert.equal(dom.root.querySelector(".combat-row") === before, true);
});

test("a turn passing does rebuild the tracker", (t) => {
  const dom = combatPage(t);
  dom.instance.apply(combatPayload([ROW, { ...ROW, id: "c2", active: true }]));

  dom.instance.apply(combatPayload([{ ...ROW, active: true }, { ...ROW, id: "c2" }]));

  assert.equal(count(dom.root, ".combat-row.active"), 1);
  assert.equal(
    dom.root.querySelector(".combat-row").classList.contains("active"),
    true,
    "the highlight did not move"
  );
});

/* -------------------------------------------- */
/*  Proof of life                               */
/* -------------------------------------------- */

test("a page that has heard nothing from Foundry says so", (t) => {
  // The distinction this whole state exists for: an empty panel and a panel
  // that never loaded, or is pointed at the wrong file, or is not being sent
  // to, used to look identical — fully transparent.
  for (const panel of ["chat", "combat"]) {
    const dom = loadOverlayPage(panel);
    t.after(() => dom.restore());

    assert.equal(dom.root.dataset.live, "no", `${panel} claimed to be live`);
    assert.equal(dom.root.dataset.state, "empty");
    assert.equal(count(dom.root, ".idle-waiting"), 1, `${panel} has no waiting line`);
  }
});

test("one payload is enough to mark a page live, even an empty one", (t) => {
  const dom = chatPage(t);

  emitOverlayEvent(dom, "obsSceneSwitcherChat", { v: 1, present: false, lines: [] });

  assert.equal(dom.root.dataset.live, "yes");
  assert.equal(dom.root.dataset.state, "empty");
});

test("a page stays marked live once content goes away again", (t) => {
  // Combat ending must read as "no encounter", not as "not receiving".
  const dom = combatPage(t);
  dom.instance.apply(combatPayload([ROW]));

  dom.instance.apply({ v: 1, present: false, combatants: [] });

  assert.equal(dom.root.dataset.live, "yes");
  assert.equal(dom.root.dataset.state, "empty");
});

test("the idle strip shows by default and hides on request", (t) => {
  // Visible while you are setting up; suppressed with ?idle=hide once live.
  const dom = chatPage(t);
  assert.equal(dom.root.dataset.idle, "show");

  const hidden = dom.overlay.mount(dom.root, {
    ...dom.overlay.readOptions(""),
    idle: "hide"
  });
  t.after(() => hidden.destroy());

  assert.equal(dom.root.dataset.idle, "hide");
});

test("both pages carry both idle lines, so either state can be shown", (t) => {
  for (const panel of ["chat", "combat"]) {
    const dom = loadOverlayPage(panel);
    t.after(() => dom.restore());

    assert.equal(count(dom.root, ".idle-waiting"), 1, `${panel} missing the waiting line`);
    assert.equal(count(dom.root, ".idle-live"), 1, `${panel} missing the live line`);
    assert.equal(count(dom.root, ".idle-dot"), 1, `${panel} missing the status dot`);
  }
});
