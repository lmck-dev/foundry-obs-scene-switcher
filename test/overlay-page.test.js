/**
 * The page that runs inside an OBS Browser Source.
 *
 * These run against the real overlay.html markup and the real overlay.js, so
 * the two staying in step is itself under test — a renamed class would fail
 * here rather than on stream.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { loadOverlayPage, emitOverlayEvent, count } from "./helpers/dom.js";

/** A full payload, matching what overlay-feed emits. */
function payload(overrides = {}) {
  return {
    v: 1,
    present: true,
    actorId: "hero",
    name: "Thorin Oakshield",
    img: "https://foundry.example/worlds/test/hero.webp",
    subtitle: "Fighter 5 · Dwarf",
    hp: { value: 38, max: 47, temp: 0, pct: 80 },
    ac: 18,
    speed: "25 ft",
    passivePerception: 13,
    abilities: [
      { key: "str", label: "STR", value: 18, mod: "+4" },
      { key: "dex", label: "DEX", value: 12, mod: "+1" }
    ],
    conditions: [{ name: "Prone", img: "https://foundry.example/icons/prone.webp" }],
    show: {
      portrait: true,
      subtitle: true,
      hp: true,
      ac: true,
      abilities: true,
      speed: true,
      passivePerception: true,
      conditions: true
    },
    ...overrides
  };
}

function open(t) {
  const dom = loadOverlayPage();
  t.after(() => dom.restore());
  return dom;
}

const text = (root, selector) => root.querySelector(selector).textContent;
const isHidden = (root, selector) => root.querySelector(selector).hidden === true;

/* -------------------------------------------- */
/*  Lifecycle                                   */
/* -------------------------------------------- */

test("the page mounts itself and starts with nothing on screen", (t) => {
  const dom = open(t);

  assert.equal(dom.root.dataset.state, "empty");
  assert.equal(dom.instance.eventName, "obsSceneSwitcherCharacter");
});

test("an event from OBS renders the character", (t) => {
  const dom = open(t);

  emitOverlayEvent(dom, "obsSceneSwitcherCharacter", payload());

  assert.equal(dom.root.dataset.state, "shown");
  assert.equal(text(dom.root, ".name"), "Thorin Oakshield");
});

test("a payload with present false hides the card again", (t) => {
  const dom = open(t);

  dom.instance.apply(payload());
  dom.instance.apply({ v: 1, present: false });

  assert.equal(dom.root.dataset.state, "empty");
});

test("a mount configured with a custom event name listens for that name only", (t) => {
  const dom = open(t);
  const custom = dom.overlay.mount(dom.root, {
    event: "myOwnEvent",
    anchor: "bottom"
  });
  t.after(() => custom.destroy());

  emitOverlayEvent(dom, "myOwnEvent", payload());
  assert.equal(dom.root.dataset.state, "shown");
});

test("readOptions parses the Browser Source query string", (t) => {
  const dom = open(t);
  const opts = dom.overlay.readOptions("?event=x&accent=%23ff0000&scale=1.5&anchor=top");

  assert.equal(opts.event, "x");
  assert.equal(opts.accent, "#ff0000");
  assert.equal(opts.scale, 1.5);
  assert.equal(opts.anchor, "top");
});

test("readOptions falls back to sane defaults", (t) => {
  const dom = open(t);
  const opts = dom.overlay.readOptions("");

  assert.equal(opts.event, "obsSceneSwitcherCharacter");
  assert.equal(opts.anchor, "bottom");
  assert.equal(opts.scale, null);
});

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

test("hit points render as a bar width and a readable number", (t) => {
  const dom = open(t);
  dom.instance.apply(payload());

  assert.equal(dom.root.querySelector(".hp-fill").style.width, "80%");
  assert.equal(text(dom.root, ".hp-text"), "38 / 47");
});

test("temporary hit points are shown alongside the total", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ hp: { value: 38, max: 47, temp: 7, pct: 80 } }));

  assert.equal(text(dom.root, ".hp-text"), "38 / 47 (+7)");
});

test("a wounded character's bar changes colour", (t) => {
  const dom = open(t);
  const hp = dom.root.querySelector(".hp");

  dom.instance.apply(payload({ hp: { value: 24, max: 47, pct: 50 } }));
  assert.equal(hp.classList.contains("mid"), true);
  assert.equal(hp.classList.contains("low"), false);

  dom.instance.apply(payload({ hp: { value: 5, max: 47, pct: 10 } }));
  assert.equal(hp.classList.contains("low"), true);
  assert.equal(hp.classList.contains("mid"), false);

  dom.instance.apply(payload());
  assert.equal(hp.classList.contains("low"), false);
  assert.equal(hp.classList.contains("mid"), false);
});

test("with no maximum the number is shown but the bar is not", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ hp: { value: 12, max: null, temp: 0, pct: null } }));

  assert.equal(dom.root.querySelector(".hp").classList.contains("unknown-max"), true);
  assert.equal(text(dom.root, ".hp-text"), "12");
});

test("AC, speed and passive perception render as chips", (t) => {
  const dom = open(t);
  dom.instance.apply(payload());

  assert.equal(count(dom.root, ".chip"), 3);
  assert.equal(text(dom.root, ".chips"), "AC18SPD25 ftPP13");
});

test("chips with no data are left out entirely", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ ac: null, speed: null, passivePerception: null }));

  assert.equal(count(dom.root, ".chip"), 0);
  assert.equal(isHidden(dom.root, ".chips"), true);
});

test("an AC of zero is data, not absence", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ ac: 0, speed: null, passivePerception: null }));

  assert.equal(count(dom.root, ".chip"), 1);
});

test("ability scores show the modifier that gets rolled", (t) => {
  const dom = open(t);
  dom.instance.apply(payload());

  assert.equal(count(dom.root, ".ability"), 2);
  assert.equal(text(dom.root, ".ability"), "STR+4");
});

test("an ability with no modifier falls back to the raw score", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ abilities: [{ key: "str", label: "STR", value: 18, mod: null }] }));

  assert.equal(text(dom.root, ".ability-value"), "18");
});

test("conditions render with their icons", (t) => {
  const dom = open(t);
  dom.instance.apply(payload());

  assert.equal(count(dom.root, ".condition"), 1);
  assert.equal(count(dom.root, ".condition-icon"), 1);
  assert.equal(text(dom.root, ".condition-name"), "Prone");
});

test("a condition with no icon still renders its name", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ conditions: [{ name: "Inspired", img: null }] }));

  assert.equal(count(dom.root, ".condition"), 1);
  assert.equal(count(dom.root, ".condition-icon"), 0);
});

test("lists are rebuilt, not appended to, when the character changes", (t) => {
  const dom = open(t);

  dom.instance.apply(payload());
  dom.instance.apply(payload({ actorId: "other", conditions: [{ name: "Hasted" }] }));

  assert.equal(count(dom.root, ".condition"), 1);
  assert.equal(text(dom.root, ".condition-name"), "Hasted");
});

/* -------------------------------------------- */
/*  Field visibility                            */
/* -------------------------------------------- */

test("rows switched off in the settings do not render", (t) => {
  const dom = open(t);
  dom.instance.apply(
    payload({
      show: {
        portrait: false,
        subtitle: false,
        hp: false,
        ac: false,
        abilities: false,
        speed: false,
        passivePerception: false,
        conditions: false
      }
    })
  );

  assert.equal(isHidden(dom.root, ".portrait"), true);
  assert.equal(isHidden(dom.root, ".subtitle"), true);
  assert.equal(isHidden(dom.root, ".hp"), true);
  assert.equal(isHidden(dom.root, ".chips"), true);
  assert.equal(isHidden(dom.root, ".abilities"), true);
  assert.equal(isHidden(dom.root, ".conditions"), true);
  // The name is the one thing that is always worth screen space.
  assert.equal(text(dom.root, ".name"), "Thorin Oakshield");
});

test("speed and passive perception can be hidden while AC stays", (t) => {
  const dom = open(t);
  dom.instance.apply(
    payload({ show: { ...payload().show, speed: false, passivePerception: false } })
  );

  assert.equal(count(dom.root, ".chip"), 1);
  assert.equal(text(dom.root, ".chips"), "AC18");
});

test("a payload with no show block renders everything", (t) => {
  const dom = open(t);
  const data = payload();
  delete data.show;
  dom.instance.apply(data);

  assert.equal(isHidden(dom.root, ".hp"), false);
  assert.equal(count(dom.root, ".chip"), 3);
});

test("a subtitle the system could not supply hides the row", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ subtitle: null }));

  assert.equal(isHidden(dom.root, ".subtitle"), true);
});

/* -------------------------------------------- */
/*  Portraits                                   */
/* -------------------------------------------- */

test("a portrait is shown when there is one", (t) => {
  const dom = open(t);
  dom.instance.apply(payload());

  assert.equal(isHidden(dom.root, ".portrait"), false);
  assert.equal(
    dom.root.querySelector(".portrait").getAttribute("src"),
    "https://foundry.example/worlds/test/hero.webp"
  );
});

test("a missing portrait leaves no broken image on stream", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ img: null }));

  assert.equal(isHidden(dom.root, ".portrait"), true);
  assert.equal(dom.root.querySelector(".portrait").hasAttribute("src"), false);
});

test("an image URL with an unexpected scheme is refused", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ img: "javascript:alert(1)" }));

  assert.equal(isHidden(dom.root, ".portrait"), true);
  assert.equal(dom.root.querySelector(".portrait").hasAttribute("src"), false);
});

/* -------------------------------------------- */
/*  Safety and animation                        */
/* -------------------------------------------- */

test("character names are rendered as text, never as markup", (t) => {
  const dom = open(t);
  dom.instance.apply(payload({ name: "<img src=x onerror=boom>" }));

  assert.equal(count(dom.root, ".name img"), 0);
  assert.equal(text(dom.root, ".name"), "<img src=x onerror=boom>");
});

test("the card re-animates when the character changes", (t) => {
  const dom = open(t);

  dom.instance.apply(payload());
  assert.equal(dom.root.classList.contains("swap"), true);
  assert.equal(dom.root.dataset.actor, "hero");

  dom.root.classList.remove("swap");
  dom.instance.apply(payload({ actorId: "other", name: "Someone Else" }));
  assert.equal(dom.root.classList.contains("swap"), true);
});

test("a stat change does not re-animate the card", (t) => {
  // Taking damage every round should update the bar, not relaunch the card.
  const dom = open(t);

  dom.instance.apply(payload());
  dom.root.classList.remove("swap");
  dom.instance.apply(payload({ hp: { value: 20, max: 47, temp: 0, pct: 42 } }));

  assert.equal(dom.root.classList.contains("swap"), false);
  assert.equal(dom.root.querySelector(".hp-fill").style.width, "42%");
});

test("rendering nothing at all is safe", (t) => {
  const dom = open(t);

  dom.instance.apply(null);
  dom.instance.apply(undefined);
  dom.instance.apply({});

  assert.equal(dom.root.dataset.state, "empty");
});
