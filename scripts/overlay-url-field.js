/**
 * Where to point an OBS Browser Source, shown in the Settings window directly
 * under the overlay toggle — the moment you tick the overlay on, that is the
 * next thing you need.
 *
 * It is a **file path, not a URL**. Foundry force-serves anything under the
 * user data directory that looks like HTML with `Content-Type: text/plain`
 * (`dist/server/express.mjs`), so that modules cannot host pages on Foundry's
 * own origin. A Browser Source pointed at the served page therefore displays
 * the markup as text instead of rendering it. OBS's own "Local file" option is
 * the supported route, and it is why overlay.js is a classic script — file://
 * blocks module imports.
 */
import { MODULE_ID, SETTINGS } from "./constants.js";

const TOGGLE_INPUT = `input[name="${MODULE_ID}.${SETTINGS.overlayEnabled}"]`;
const GROUP_CLASS = "obs-overlay-url-group";

/**
 * The overlay page's location within the Foundry user data folder.
 *
 * Relative, because the client has no way to know the server's filesystem
 * root — Foundry does not expose it. The user data folder's location is shown
 * in Foundry's own Setup → Configuration screen, which the hint points at.
 */
export function overlayFilePath() {
  return `Data/modules/${MODULE_ID}/overlay/overlay.html`;
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
  input.value = overlayFilePath();
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
