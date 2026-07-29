/**
 * Masking of the OBS connection fields in the Settings window.
 *
 * The failure this guards against is not a crash: it is the password rendering
 * in the clear while the GM is live. That is invisible in a passing test suite
 * unless something asserts on the input type, so this does.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS } from "../scripts/constants.js";
import { maskConnectionFields } from "../scripts/settings-privacy.js";
import { installDom, count, click } from "./helpers/dom.js";
import { installFoundry } from "./helpers/foundry-mock.js";

const field = (key) => `input[name="${MODULE_ID}.${key}"]`;

/** The module's connection block, as Foundry renders registered settings. */
function settingsWindow() {
  const root = document.createElement("form");
  root.innerHTML = `
    <div class="form-group">
      <label>OBS Host</label>
      <div class="form-fields">
        <input type="text" name="${MODULE_ID}.${SETTINGS.host}" value="localhost" />
      </div>
    </div>
    <div class="form-group">
      <label>OBS WebSocket Port</label>
      <div class="form-fields">
        <input type="number" name="${MODULE_ID}.${SETTINGS.port}" value="4455" />
      </div>
    </div>
    <div class="form-group">
      <label>OBS WebSocket Password</label>
      <div class="form-fields">
        <input type="text" name="${MODULE_ID}.${SETTINGS.password}" value="hunter2" />
      </div>
    </div>
  `;
  document.body.append(root);
  return root;
}

function open(t) {
  const dom = installDom();
  const foundry = installFoundry();
  t.after(() => {
    foundry.restore();
    dom.restore();
  });
  return settingsWindow();
}

test("the password is masked on sight", (t) => {
  const root = open(t);

  maskConnectionFields(root);

  assert.equal(root.querySelector(field(SETTINGS.password)).type, "password");
});

test("the port is masked too", (t) => {
  const root = open(t);

  maskConnectionFields(root);

  assert.equal(root.querySelector(field(SETTINGS.port)).type, "password");
});

test("masking hides the value, it does not discard it", (t) => {
  // A mask that ate the password would look identical until you tried to save.
  const root = open(t);

  maskConnectionFields(root);

  assert.equal(root.querySelector(field(SETTINGS.password)).value, "hunter2");
  assert.equal(root.querySelector(field(SETTINGS.port)).value, "4455");
});

test("the host is left alone — it is not a secret and masking it hurts setup", (t) => {
  const root = open(t);

  maskConnectionFields(root);

  assert.equal(root.querySelector(field(SETTINGS.host)).type, "text");
  assert.equal(count(root, `${field(SETTINGS.host)} + .obs-reveal-toggle`), 0);
});

test("each masked field gets a reveal button", (t) => {
  const root = open(t);

  maskConnectionFields(root);

  assert.equal(count(root, "button.obs-reveal-toggle"), 2);
});

test("the reveal button is not a submit button", (t) => {
  const root = open(t);

  maskConnectionFields(root);

  assert.equal(root.querySelector("button.obs-reveal-toggle").type, "button");
});

test("revealing shows the password, and hiding masks it again", (t) => {
  const root = open(t);
  maskConnectionFields(root);

  const input = root.querySelector(field(SETTINGS.password));
  const button = input.nextElementSibling;

  click(button);
  assert.equal(input.type, "text");
  assert.equal(button.getAttribute("aria-pressed"), "true");

  click(button);
  assert.equal(input.type, "password");
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("revealing the port restores a number input, not a text one", (t) => {
  const root = open(t);
  maskConnectionFields(root);

  const input = root.querySelector(field(SETTINGS.port));
  click(input.nextElementSibling);

  assert.equal(input.type, "number");
});

test("revealing one field does not reveal the other", (t) => {
  const root = open(t);
  maskConnectionFields(root);

  const password = root.querySelector(field(SETTINGS.password));
  click(password.nextElementSibling);

  assert.equal(root.querySelector(field(SETTINGS.port)).type, "password");
});

test("a re-render does not stack duplicate buttons", (t) => {
  const root = open(t);

  maskConnectionFields(root);
  maskConnectionFields(root);
  maskConnectionFields(root);

  assert.equal(count(root, "button.obs-reveal-toggle"), 2);
});

test("a re-render does not re-mask a field the user just revealed", (t) => {
  // renderSettingsConfig fires for reasons unrelated to these fields; hiding
  // the password again mid-edit would be maddening.
  const root = open(t);
  maskConnectionFields(root);

  const input = root.querySelector(field(SETTINGS.password));
  click(input.nextElementSibling);
  maskConnectionFields(root);

  assert.equal(input.type, "text");
});

test("the button is labelled for screen readers in both states", (t) => {
  const root = open(t);
  maskConnectionFields(root);

  const button = root.querySelector("button.obs-reveal-toggle");
  assert.equal(button.getAttribute("aria-label"), "Show value");

  click(button);
  assert.equal(button.getAttribute("aria-label"), "Hide value");
});

test("nothing happens when the settings window has no OBS fields", (t) => {
  const dom = installDom();
  const foundry = installFoundry();
  t.after(() => {
    foundry.restore();
    dom.restore();
  });
  const root = document.createElement("form");
  document.body.append(root);

  maskConnectionFields(root);

  assert.equal(count(root, "button.obs-reveal-toggle"), 0);
});
