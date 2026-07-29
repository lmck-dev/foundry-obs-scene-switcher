import {
  MODULE_ID,
  SETTINGS,
  OVERLAY_FIELDS,
  OVERLAY_NPC_FIELDS,
  DEFAULT_OVERLAY_EVENT,
  NPC_POLICY,
  getSetting,
  setSetting,
  resolveOverlayFields
} from "../scripts/constants.js";
import { pushOverlay, resetOverlayCache } from "../scripts/overlay-feed.js";
import { overlayFilePath } from "../scripts/overlay-url-field.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Settings submenu for the stream overlay: which rows appear on the card, who
 * may appear on it, and the Browser Source URL to paste into OBS.
 */
export class OverlayConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "obs-scene-overlay-config",
    tag: "form",
    classes: ["obs-scene-switcher", "overlay-config"],
    window: {
      title: `${MODULE_ID}.overlay.title`,
      icon: "fas fa-id-badge",
      contentClasses: ["standard-form"]
    },
    position: { width: 560, height: "auto" },
    form: {
      handler: OverlayConfig.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/overlay-config.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext(_options) {
    const pc = resolveOverlayFields(getSetting(SETTINGS.overlayFields), OVERLAY_FIELDS);
    const npc = resolveOverlayFields(
      getSetting(SETTINGS.overlayNpcFields),
      OVERLAY_NPC_FIELDS
    );

    return {
      fields: Object.keys(OVERLAY_FIELDS).map((key) => ({
        key,
        pc: pc[key],
        npc: npc[key],
        label: `${MODULE_ID}.overlay.field.${key}`
      })),
      // { value: localisation key } — the shape selectOptions expects. It is
      // not sorted, so the order here is the order the user sees: safest first.
      npcChoices: Object.fromEntries(
        Object.values(NPC_POLICY).map((value) => [
          value,
          `${MODULE_ID}.overlay.npcs.${value}`
        ])
      ),
      npcPolicy: getSetting(SETTINGS.overlayNpcs),
      eventName: getSetting(SETTINGS.overlayEventName) || DEFAULT_OVERLAY_EVENT,
      defaultEventName: DEFAULT_OVERLAY_EVENT,
      overlayFilePath: overlayFilePath(),
      buttons: [
        { type: "submit", icon: "fas fa-save", label: `${MODULE_ID}.overlay.save` }
      ]
    };
  }

  /** Select the whole URL on click, so it can be copied in one gesture. */
  _onRender(_context, _options) {
    const url = this.element.querySelector(".overlay-url");
    if (url) url.addEventListener("focus", () => url.select());
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    // Read every known key rather than trusting the form: an unticked checkbox
    // may be absent entirely, which would otherwise leave the old value.
    const fields = {};
    const npcFields = {};
    for (const key of Object.keys(OVERLAY_FIELDS)) {
      fields[key] = Boolean(data.fields?.[key]);
      npcFields[key] = Boolean(data.npcFields?.[key]);
    }

    await setSetting(SETTINGS.overlayFields, fields);
    await setSetting(SETTINGS.overlayNpcFields, npcFields);
    // An unrecognised value would silently become "show nobody"; fall back to
    // the safe policy explicitly instead.
    const policy = Object.values(NPC_POLICY).includes(data.npcPolicy)
      ? data.npcPolicy
      : NPC_POLICY.none;
    await setSetting(SETTINGS.overlayNpcs, policy);
    await setSetting(
      SETTINGS.overlayEventName,
      (data.eventName ?? "").trim() || DEFAULT_OVERLAY_EVENT
    );

    ui.notifications.info(game.i18n.localize(`${MODULE_ID}.overlay.saved`));

    // Push the new shape out immediately rather than waiting for the next turn.
    resetOverlayCache();
    pushOverlay({ force: true });
  }
}
