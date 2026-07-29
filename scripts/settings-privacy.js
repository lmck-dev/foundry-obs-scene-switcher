/**
 * Masks the OBS connection details in the Settings window.
 *
 * This module's users are, by definition, streaming. Opening Configure Settings
 * while live is an ordinary thing to do mid-session, and Foundry renders a
 * String setting as a plain text input — so the obs-websocket password would
 * otherwise be sitting on screen in the clear, in front of an audience that can
 * reach the port it belongs to.
 *
 * Each masked field gets a reveal button, so setup is still workable.
 */
import { MODULE_ID, SETTINGS } from "./constants.js";

const REVEAL_CLASS = "obs-reveal-toggle";
const MASKED_CLASS = "obs-masked";

/** Settings hidden on sight, and the input type to restore when revealed. */
const MASKED_FIELDS = [
  { key: SETTINGS.password, revealedType: "text" },
  { key: SETTINGS.port, revealedType: "number" }
];

function label(key) {
  return game.i18n.localize(`${MODULE_ID}.settings.${key}`);
}

/** Reflect the current state on the button: icon, text, and assistive label. */
function styleButton(button, revealed) {
  const key = revealed ? "hide" : "reveal";
  button.innerHTML = `<i class="fas ${revealed ? "fa-eye-slash" : "fa-eye"}"></i>`;
  button.title = label(key);
  button.setAttribute("aria-label", label(key));
  button.setAttribute("aria-pressed", String(revealed));
}

function addRevealButton(input, revealedType) {
  const button = document.createElement("button");
  // Inside the settings form, a submit button would save and close on click.
  button.type = "button";
  button.className = REVEAL_CLASS;
  styleButton(button, false);

  button.addEventListener("click", () => {
    const revealed = input.type === "password";
    input.type = revealed ? revealedType : "password";
    styleButton(button, revealed);
  });

  input.after(button);
}

/**
 * Mask the connection fields, if they are on screen and not already masked.
 *
 * Idempotent: renderSettingsConfig fires on every re-render, and re-masking a
 * field the user has deliberately revealed mid-edit would be its own bug.
 */
export function maskConnectionFields(root = document) {
  for (const { key, revealedType } of MASKED_FIELDS) {
    const input = root.querySelector(`input[name="${MODULE_ID}.${key}"]`);
    if (!input) continue;
    if (input.classList.contains(MASKED_CLASS)) continue;

    input.classList.add(MASKED_CLASS);
    input.type = "password";
    // Password managers offering to save a VTT setting is pure noise.
    input.autocomplete = "off";
    addRevealButton(input, revealedType);
  }
}
