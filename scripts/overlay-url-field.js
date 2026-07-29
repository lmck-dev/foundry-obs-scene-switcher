/**
 * The Browser Source URL, shown in the Settings window directly under the
 * overlay toggle.
 *
 * The URL is also in the overlay's own settings submenu, but that is one window
 * further away than it needs to be: the moment you tick the overlay on, the
 * next thing you need is the address to paste into OBS.
 */
import { MODULE_ID, SETTINGS } from "./constants.js";

const TOGGLE_INPUT = `input[name="${MODULE_ID}.${SETTINGS.overlayEnabled}"]`;
const GROUP_CLASS = "obs-overlay-url-group";

/**
 * The address an OBS Browser Source should load.
 *
 * Absolute, because OBS is a different application and often a different
 * machine, so a relative path is no use to whoever is pasting it. getRoute
 * applies Foundry's route prefix when the server runs under one.
 */
export function browserSourceUrl() {
  const path = `modules/${MODULE_ID}/overlay/overlay.html`;
  const routed = globalThis.foundry?.utils?.getRoute?.(path) ?? `/${path}`;
  return `${window.location.origin}${routed}`;
}

async function copyToClipboard(input) {
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    // Clipboard access can be refused (insecure origin, denied permission).
    // Selecting the text still leaves the user one keystroke from copying.
    input.select();
    return false;
  }
  return true;
}

/** Build the field once; afterwards it is only shown and hidden. */
function buildGroup() {
  const group = document.createElement("div");
  group.className = `form-group ${GROUP_CLASS}`;

  const label = document.createElement("label");
  label.textContent = game.i18n.localize(`${MODULE_ID}.settings.overlayEnabled.url`);

  const fields = document.createElement("div");
  fields.className = "form-fields";

  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.className = "obs-overlay-url";
  input.value = browserSourceUrl();
  input.addEventListener("focus", () => input.select());

  const button = document.createElement("button");
  // Not a submit button: inside the settings form, the default type would
  // save and close the window on click.
  button.type = "button";
  button.className = "obs-overlay-url-copy";
  button.innerHTML = `<i class="fas fa-copy"></i> ${game.i18n.localize(
    `${MODULE_ID}.settings.overlayEnabled.copy`
  )}`;
  button.addEventListener("click", async () => {
    const copied = await copyToClipboard(input);
    if (copied) {
      ui.notifications?.info(
        game.i18n.localize(`${MODULE_ID}.settings.overlayEnabled.copied`)
      );
    }
  });

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = game.i18n.localize(`${MODULE_ID}.settings.overlayEnabled.urlHint`);

  fields.append(input, button);
  group.append(label, fields, hint);
  return group;
}

/**
 * Insert (or refresh) the URL field beneath the overlay toggle.
 *
 * Visibility follows the checkbox live rather than the saved setting, so the
 * field appears the moment the box is ticked — not after the window is saved
 * and reopened.
 */
export function refreshOverlayUrlField(root = document) {
  const toggle = root.querySelector(TOGGLE_INPUT);
  if (!toggle) return; // settings window not open, or not a GM

  const anchor = toggle.closest(".form-group") ?? toggle.parentElement;
  if (!anchor) return;

  let group = anchor.parentElement?.querySelector(`.${GROUP_CLASS}`);
  if (!group) {
    group = buildGroup();
    anchor.after(group);
    // Re-render on toggle rather than tracking state elsewhere.
    toggle.addEventListener("change", () => refreshOverlayUrlField(root));
  }

  group.hidden = !toggle.checked;
}
