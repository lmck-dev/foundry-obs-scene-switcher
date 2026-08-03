/**
 * The Browser Source URL field injected into the Settings window.
 *
 * Like the tracker button, this reaches into markup Foundry owns, so the tests
 * drive a stand-in of that markup rather than trusting the selectors by eye.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS } from "../scripts/constants.js";
import {
  refreshOverlayUrlField,
  overlayFilePath,
  panelFilePath,
  PANELS
} from "../scripts/overlay-url-field.js";
import { installDom, count, click } from "./helpers/dom.js";
import { installFoundry } from "./helpers/foundry-mock.js";

const TOGGLE = `input[name="${MODULE_ID}.${SETTINGS.overlayEnabled}"]`;
const GROUP = '.obs-overlay-url-group[data-panel="overlay"]';
const ANY_GROUP = ".obs-overlay-url-group";

/** One panel's toggle, as Foundry renders a Boolean setting. */
function toggleMarkup(setting, checked) {
  return `<div class="form-group toggle-group">
            <label>${setting}</label>
            <input type="checkbox" name="${MODULE_ID}.${setting}" ${checked ? "checked" : ""} />
          </div>`;
}

/**
 * A stand-in for the module's block in the Settings window.
 *
 * `panels` decides which toggles are on the page: all three by default, since
 * that is what a GM actually sees, and they all share one parent — which is the
 * arrangement the per-panel scoping has to survive.
 */
function settingsWindow({
  checked = true,
  includeToggle = true,
  panels = PANELS.map((panel) => panel.setting)
} = {}) {
  const root = document.createElement("form");
  const shown = includeToggle ? panels : panels.filter((s) => s !== SETTINGS.overlayEnabled);
  root.innerHTML = `
    <div class="form-group">
      <label>Some other setting</label>
      <input type="text" name="${MODULE_ID}.obsHost" />
    </div>
    ${shown.map((setting) => toggleMarkup(setting, checked)).join("")}
  `;
  document.body.append(root);
  return root;
}

function open(t, options) {
  const dom = installDom();
  const foundry = installFoundry();
  t.after(() => {
    foundry.restore();
    dom.restore();
  });
  return { dom, foundry, root: settingsWindow(options) };
}

/* -------------------------------------------- */
/*  The URL itself                              */
/* -------------------------------------------- */

test("the path points at the overlay page inside the user data folder", (t) => {
  const dom = installDom();
  t.after(() => dom.restore());

  assert.equal(overlayFilePath(), `Data/modules/${MODULE_ID}/overlay/overlay.html`);
});

test("it is a file path, not a web address", (t) => {
  // Foundry force-serves module HTML as text/plain, so a Browser Source
  // pointed at the server renders the markup as text. OBS has to load the
  // local file, and telling the user otherwise sends them in a circle.
  const dom = installDom();
  const saved = globalThis.foundry;
  globalThis.foundry = { utils: { getRoute: (path) => `/vtt/${path}` } };
  t.after(() => {
    globalThis.foundry = saved;
    dom.restore();
  });

  const value = overlayFilePath();
  assert.equal(/^https?:/.test(value), false, "must not be an http(s) address");
  assert.equal(value.includes("localhost"), false, "must not carry a host");
  assert.equal(value.includes("/vtt/"), false, "must not carry a route prefix");
});

test("every panel has its own page", (t) => {
  const dom = installDom();
  t.after(() => dom.restore());

  const paths = PANELS.map((panel) => panelFilePath(panel.file));

  assert.equal(new Set(paths).size, PANELS.length, "two panels share a page");
  for (const path of paths) {
    assert.equal(path.startsWith(`Data/modules/${MODULE_ID}/overlay/`), true, path);
    assert.equal(path.endsWith(".html"), true, path);
  }
});

/* -------------------------------------------- */
/*  Injection                                   */
/* -------------------------------------------- */

test("each panel gets its own field under its own toggle", (t) => {
  // All three share a parent, so a lookup that is not scoped per panel finds
  // whichever was built first and never builds the other two.
  const { root } = open(t);

  refreshOverlayUrlField(root);

  assert.equal(count(root, ANY_GROUP), PANELS.length);
  for (const panel of PANELS) {
    const group = root.querySelector(`${ANY_GROUP}[data-panel="${panel.key}"]`);
    const toggleGroup = root
      .querySelector(`input[name="${MODULE_ID}.${panel.setting}"]`)
      .closest(".form-group");
    assert.equal(toggleGroup.nextElementSibling === group, true, `${panel.key} is misplaced`);
  }
});

test("each panel's field carries that panel's own page", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);

  for (const panel of PANELS) {
    assert.equal(
      root.querySelector(`${ANY_GROUP}[data-panel="${panel.key}"] .obs-overlay-url`).value,
      panelFilePath(panel.file)
    );
  }
});

test("re-rendering does not stack duplicates of any panel", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);
  refreshOverlayUrlField(root);
  refreshOverlayUrlField(root);

  assert.equal(count(root, ANY_GROUP), PANELS.length);
});

test("each panel's field follows its own toggle, not the others", (t) => {
  const { root } = open(t, { checked: false });
  refreshOverlayUrlField(root);

  const chat = root.querySelector(`input[name="${MODULE_ID}.${SETTINGS.chatEnabled}"]`);
  chat.checked = true;
  chat.dispatchEvent(new window.Event("change", { bubbles: true }));

  assert.equal(root.querySelector(`${ANY_GROUP}[data-panel="chat"]`).hidden, false);
  assert.equal(root.querySelector(`${ANY_GROUP}[data-panel="overlay"]`).hidden, true);
  assert.equal(root.querySelector(`${ANY_GROUP}[data-panel="combat"]`).hidden, true);
});

test("the field is inserted directly after the overlay toggle", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);

  assert.equal(count(root, GROUP), 1);
  const toggleGroup = root.querySelector(TOGGLE).closest(".form-group");
  assert.equal(toggleGroup.nextElementSibling === root.querySelector(GROUP), true);
});

test("the field carries the path and a copy button", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);

  assert.equal(
    root.querySelector(`${GROUP} .obs-overlay-url`).value,
    `Data/modules/${MODULE_ID}/overlay/overlay.html`
  );
  // One per panel — each field copies its own page, not a shared one.
  assert.equal(count(root, `${GROUP} button.obs-overlay-url-copy`), 1);
  assert.equal(count(root, `${ANY_GROUP} button.obs-overlay-url-copy`), PANELS.length);
});

test("the copy button is not a submit button", (t) => {
  // Inside the settings form the default type would save and close the window.
  const { root } = open(t);

  refreshOverlayUrlField(root);

  assert.equal(root.querySelector("button.obs-overlay-url-copy").type, "button");
});

test("the URL field is read-only", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);

  assert.equal(root.querySelector(".obs-overlay-url").readOnly, true);
});

test("re-rendering the settings window does not stack duplicate fields", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);
  refreshOverlayUrlField(root);
  refreshOverlayUrlField(root);

  assert.equal(count(root, GROUP), 1);
});

test("nothing is injected when the overlay toggle is not on the page", (t) => {
  // A non-GM, or a settings window scrolled to another module's section.
  const { root } = open(t, { includeToggle: false });

  refreshOverlayUrlField(root);

  assert.equal(count(root, GROUP), 0);
});

/* -------------------------------------------- */
/*  Following the toggle                        */
/* -------------------------------------------- */

test("the field is hidden while the overlay is switched off", (t) => {
  const { root } = open(t, { checked: false });

  refreshOverlayUrlField(root);

  assert.equal(count(root, GROUP), 1);
  assert.equal(root.querySelector(GROUP).hidden, true);
});

test("ticking the toggle reveals the URL without saving and reopening", (t) => {
  const { root } = open(t, { checked: false });
  refreshOverlayUrlField(root);

  const toggle = root.querySelector(TOGGLE);
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event("change", { bubbles: true }));

  assert.equal(root.querySelector(GROUP).hidden, false);
});

test("unticking it hides the URL again", (t) => {
  const { root } = open(t, { checked: true });
  refreshOverlayUrlField(root);
  const toggle = root.querySelector(TOGGLE);

  toggle.checked = false;
  toggle.dispatchEvent(new window.Event("change", { bubbles: true }));

  assert.equal(root.querySelector(GROUP).hidden, true);
});

test("the change listener is attached once, not once per render", (t) => {
  const { root } = open(t, { checked: false });

  refreshOverlayUrlField(root);
  refreshOverlayUrlField(root);

  const toggle = root.querySelector(TOGGLE);
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event("change", { bubbles: true }));

  assert.equal(count(root, GROUP), 1);
  assert.equal(root.querySelector(GROUP).hidden, false);
});

/* -------------------------------------------- */
/*  Copying                                     */
/* -------------------------------------------- */

test("clicking copy writes the URL to the clipboard and says so", async (t) => {
  const { root, foundry } = open(t);
  const written = [];
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text) => written.push(text) } }
  });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else delete globalThis.navigator;
  });

  refreshOverlayUrlField(root);
  click(root.querySelector("button.obs-overlay-url-copy"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(written, [`Data/modules/${MODULE_ID}/overlay/overlay.html`]);
  assert.equal(foundry.notifications.info.length, 1);
});

test("a refused clipboard does not claim the URL was copied", async (t) => {
  // Clipboard access is denied on insecure origins, which a LAN Foundry is.
  const { root, foundry } = open(t);
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        }
      }
    }
  });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else delete globalThis.navigator;
  });

  refreshOverlayUrlField(root);
  click(root.querySelector("button.obs-overlay-url-copy"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(foundry.notifications.info.length, 0, "no false confirmation");
});
