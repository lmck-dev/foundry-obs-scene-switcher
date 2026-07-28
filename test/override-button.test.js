import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { SETTINGS } from "../scripts/constants.js";
import { obs, OBSStatus } from "../scripts/obs-client.js";
import { injectOverrideButton, updateAllButtons } from "../scripts/override-button.js";
import { installFoundry, muteConsole } from "./helpers/foundry-mock.js";
import { installDom, makeTracker, asJQuery, click, count } from "./helpers/dom.js";

const BUTTON = ".obs-scene-switcher-toggle";

// Assert on counts and primitives, never on a DOM node. Putting a happy-dom
// element into an assertion's actual/expected makes a FAILING test hang while
// node:test tries to serialise a circular tree — see count() in helpers/dom.js.

let dom;
let foundry;
let restoreConsole;
let savedObs;

beforeEach(() => {
  restoreConsole = muteConsole();
  dom = installDom();
  savedObs = { status: obs.status, statusDetail: obs.statusDetail, connected: obs.connected };
});

afterEach(() => {
  Object.assign(obs, savedObs);
  foundry?.restore();
  foundry = null;
  dom.restore();
  restoreConsole();
});

/** Put OBS into a given health state without opening a socket. */
function setObsStatus(status, detail = "") {
  obs.status = status;
  obs.statusDetail = detail;
  obs.connected = status === OBSStatus.Connected;
}

describe("injectOverrideButton — who gets a button", () => {
  test("a player client gets no button", () => {
    foundry = installFoundry({ isGM: false });
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);
    assert.equal(count(root, BUTTON), 0);
  });

  test("the GM gets a button", () => {
    foundry = installFoundry();
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);
    assert.equal(count(root, BUTTON), 1);
  });
});

describe("injectOverrideButton — Foundry version compatibility", () => {
  // v13+ hands the hook a raw HTMLElement; older versions hand it a jQuery
  // object. Both must work, and this is the one place the module reaches into
  // Foundry's own API shape — the most likely thing to break on a version bump.
  test("accepts a raw HTMLElement (v13+)", () => {
    foundry = installFoundry();
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);
    assert.equal(count(root, BUTTON), 1);
  });

  test("accepts a jQuery-style wrapper (older Foundry)", () => {
    foundry = installFoundry();
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, asJQuery(root));
    assert.equal(count(root, BUTTON), 1);
  });

  test("a null html argument is ignored rather than throwing", () => {
    foundry = installFoundry();
    assert.doesNotThrow(() => injectOverrideButton({}, null));
  });

  test("an empty jQuery wrapper is ignored rather than throwing", () => {
    foundry = installFoundry();
    assert.doesNotThrow(() => injectOverrideButton({}, { length: 0 }));
  });
});

describe("injectOverrideButton — where the button lands", () => {
  test("prefers the tracker's control row", () => {
    foundry = installFoundry();
    const root = makeTracker(`
      <header class="combat-tracker-header"></header>
      <nav class="combat-controls"></nav>
    `);
    injectOverrideButton({}, root);
    assert.equal(count(root, ".combat-controls " + BUTTON), 1);
  });

  test("falls back to the tracker header", () => {
    foundry = installFoundry();
    const root = makeTracker(`<header class="combat-tracker-header"></header>`);
    injectOverrideButton({}, root);
    assert.equal(count(root, ".combat-tracker-header " + BUTTON), 1);
  });

  test("falls back to any header element", () => {
    foundry = installFoundry();
    const root = makeTracker(`<header class="something-else"></header>`);
    injectOverrideButton({}, root);
    assert.equal(count(root, "header " + BUTTON), 1);
  });

  test("falls back to the root when the tracker has no header at all", () => {
    foundry = installFoundry();
    const root = makeTracker(`<ol class="combatants"></ol>`);
    injectOverrideButton({}, root);
    assert.equal(count(root, BUTTON), 1);
    const button = root.querySelector(BUTTON);
    assert.ok(button.parentElement === root, "button should be a direct child of the root");
    assert.ok(
      root.firstElementChild === button,
      "the fallback should prepend too, so the toggle stays the first thing in the tracker"
    );
  });

  test("is prepended, so it sits before existing controls", () => {
    foundry = installFoundry();
    const root = makeTracker(
      `<header class="combat-controls"><button class="existing"></button></header>`
    );
    injectOverrideButton({}, root);
    const header = root.querySelector(".combat-controls");
    assert.ok(
      header.firstElementChild.classList.contains("obs-scene-switcher-toggle"),
      "the toggle should be the first control, not appended after existing ones"
    );
  });
});

describe("injectOverrideButton — duplicate injection", () => {
  // renderCombatTracker fires on every re-render, so this runs constantly.
  test("re-rendering does not stack up buttons", () => {
    foundry = installFoundry();
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);
    injectOverrideButton({}, root);
    injectOverrideButton({}, root);
    assert.equal(root.querySelectorAll(BUTTON).length, 1);
  });

  test("re-rendering refreshes the existing button's state", () => {
    foundry = installFoundry({ settings: { [SETTINGS.syncEnabled]: true } });
    setObsStatus(OBSStatus.Connected);
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);
    assert.ok(root.querySelector(BUTTON).classList.contains("active"));

    // OBS drops while the tracker re-renders.
    setObsStatus(OBSStatus.Error, "could not reach OBS");
    injectOverrideButton({}, root);

    const button = root.querySelector(BUTTON);
    assert.ok(button.classList.contains("error"));
    assert.equal(button.classList.contains("active"), false);
  });

  test("a popped-out tracker is a second tree and gets its own button", () => {
    // The guard uses a class rather than an id precisely so this works —
    // duplicate ids across two trees would be invalid.
    foundry = installFoundry();
    const docked = makeTracker(`<header class="combat-controls"></header>`);
    const popped = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, docked);
    injectOverrideButton({}, popped);

    assert.equal(docked.querySelectorAll(BUTTON).length, 1);
    assert.equal(popped.querySelectorAll(BUTTON).length, 1);
    assert.equal(document.querySelectorAll(BUTTON).length, 2);
  });
});

describe("button state reflects setting and connection health", () => {
  function renderWith({ enabled = true, status = OBSStatus.Connected, detail = "" } = {}) {
    foundry = installFoundry({ settings: { [SETTINGS.syncEnabled]: enabled } });
    setObsStatus(status, detail);
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);
    return root.querySelector(BUTTON);
  }

  test("override off reads as a deliberate choice, not an error", () => {
    const button = renderWith({ enabled: false, status: OBSStatus.Disconnected });
    assert.ok(button.classList.contains("inactive"));
    assert.equal(button.classList.contains("error"), false);
    assert.match(button.textContent, /OBS Sync: Off/);
  });

  test("on and connected reads as active", () => {
    const button = renderWith({ status: OBSStatus.Connected });
    assert.ok(button.classList.contains("active"));
    assert.match(button.textContent, /OBS Sync: On/);
  });

  test("on and connecting reads as connecting", () => {
    const button = renderWith({ status: OBSStatus.Connecting });
    assert.ok(button.classList.contains("connecting"));
    assert.match(button.textContent, /Connecting/);
  });

  test("a bad password names the password as the problem", () => {
    const button = renderWith({
      status: OBSStatus.AuthFailed,
      detail: "the password does not match"
    });
    assert.ok(button.classList.contains("error"));
    assert.match(button.textContent, /Bad Password/);
  });

  test("any other failure reads as offline", () => {
    const button = renderWith({ status: OBSStatus.Error, detail: "could not reach OBS" });
    assert.ok(button.classList.contains("error"));
    assert.match(button.textContent, /Offline/);
  });

  test("sync on but disconnected is treated as a problem", () => {
    const button = renderWith({ status: OBSStatus.Disconnected });
    assert.ok(button.classList.contains("error"));
  });

  test("the failure reason is surfaced in the tooltip", () => {
    const button = renderWith({
      status: OBSStatus.Error,
      detail: "could not reach OBS — is the WebSocket server enabled?"
    });
    assert.match(button.title, /could not reach OBS — is the WebSocket server enabled\?/);
  });

  test("the healthy tooltip explains what the button does", () => {
    const button = renderWith({ status: OBSStatus.Connected });
    assert.match(button.title, /Toggle automatic OBS scene switching/);
  });

  test("state classes are mutually exclusive", () => {
    const button = renderWith({ status: OBSStatus.Connecting });
    const classes = ["active", "inactive", "connecting", "error"]
      .filter((c) => button.classList.contains(c));
    assert.deepEqual(classes, ["connecting"]);
  });

  test("labels come from the shipped translation file, not raw keys", () => {
    const button = renderWith({ status: OBSStatus.Connected });
    assert.equal(
      button.textContent.includes("foundry-obs-scene-switcher"),
      false,
      "a missing translation key would render the raw key to the user"
    );
  });
});

describe("clicking the button", () => {
  test("toggles the sync setting off", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.syncEnabled]: true } });
    setObsStatus(OBSStatus.Connected);
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);

    click(root.querySelector(BUTTON));
    await Promise.resolve();

    assert.equal(foundry.store.get(SETTINGS.syncEnabled), false);
  });

  test("toggles the sync setting back on", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.syncEnabled]: false } });
    setObsStatus(OBSStatus.Connected);
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);

    click(root.querySelector(BUTTON));
    await Promise.resolve();

    assert.equal(foundry.store.get(SETTINGS.syncEnabled), true);
  });

  test("restyles the button to match the new setting", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.syncEnabled]: true } });
    setObsStatus(OBSStatus.Connected);
    const root = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, root);

    click(root.querySelector(BUTTON));
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(root.querySelector(BUTTON).classList.contains("inactive"));
  });
});

describe("updateAllButtons", () => {
  test("restyles every rendered button, across trackers", () => {
    foundry = installFoundry({ settings: { [SETTINGS.syncEnabled]: true } });
    setObsStatus(OBSStatus.Connected);
    const docked = makeTracker(`<header class="combat-controls"></header>`);
    const popped = makeTracker(`<header class="combat-controls"></header>`);
    injectOverrideButton({}, docked);
    injectOverrideButton({}, popped);

    setObsStatus(OBSStatus.AuthFailed, "the password does not match");
    updateAllButtons();

    for (const button of document.querySelectorAll(BUTTON)) {
      assert.ok(button.classList.contains("error"));
      assert.match(button.textContent, /Bad Password/);
    }
  });

  test("is a no-op when nothing is rendered", () => {
    foundry = installFoundry();
    assert.doesNotThrow(() => updateAllButtons());
  });
});
