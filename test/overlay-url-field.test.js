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
  browserSourceUrl
} from "../scripts/overlay-url-field.js";
import { installDom, count, click } from "./helpers/dom.js";
import { installFoundry } from "./helpers/foundry-mock.js";

const TOGGLE = `input[name="${MODULE_ID}.${SETTINGS.overlayEnabled}"]`;
const GROUP = ".obs-overlay-url-group";

/** A stand-in for the module's block in the Settings window. */
function settingsWindow({ checked = true, includeToggle = true } = {}) {
  const root = document.createElement("form");
  root.innerHTML = `
    <div class="form-group">
      <label>Some other setting</label>
      <input type="text" name="${MODULE_ID}.obsHost" />
    </div>
    ${
      includeToggle
        ? `<div class="form-group toggle-group">
             <label>Stream Character Overlay</label>
             <input type="checkbox" name="${MODULE_ID}.${SETTINGS.overlayEnabled}" ${
             checked ? "checked" : ""
           } />
           </div>`
        : ""
    }
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

test("the URL is absolute and points at the overlay page", (t) => {
  const dom = installDom();
  t.after(() => dom.restore());

  assert.equal(
    browserSourceUrl(),
    `https://localhost/modules/${MODULE_ID}/overlay/overlay.html`
  );
});

test("the URL honours a Foundry route prefix", (t) => {
  const dom = installDom();
  const saved = globalThis.foundry;
  globalThis.foundry = { utils: { getRoute: (path) => `/vtt/${path}` } };
  t.after(() => {
    globalThis.foundry = saved;
    dom.restore();
  });

  assert.equal(
    browserSourceUrl(),
    `https://localhost/vtt/modules/${MODULE_ID}/overlay/overlay.html`
  );
});

/* -------------------------------------------- */
/*  Injection                                   */
/* -------------------------------------------- */

test("the field is inserted directly after the overlay toggle", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);

  assert.equal(count(root, GROUP), 1);
  const toggleGroup = root.querySelector(TOGGLE).closest(".form-group");
  assert.equal(toggleGroup.nextElementSibling === root.querySelector(GROUP), true);
});

test("the field carries the URL and a copy button", (t) => {
  const { root } = open(t);

  refreshOverlayUrlField(root);

  assert.equal(
    root.querySelector(".obs-overlay-url").value,
    `https://localhost/modules/${MODULE_ID}/overlay/overlay.html`
  );
  assert.equal(count(root, "button.obs-overlay-url-copy"), 1);
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

  assert.deepEqual(written, [
    `https://localhost/modules/${MODULE_ID}/overlay/overlay.html`
  ]);
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
