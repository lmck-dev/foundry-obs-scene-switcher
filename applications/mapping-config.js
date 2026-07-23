import { MODULE_ID, SETTINGS, getSetting, setSetting, warn } from "../scripts/constants.js";
import { obs } from "../scripts/obs-client.js";
import { resetSceneCache, syncScene } from "../scripts/scene-sync.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Settings submenu (ApplicationV2) for editing per-actor scene mappings and the
 * exploration / DM-fallback scenes. Registered as a settings menu in main.js.
 */
export class MappingConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "obs-scene-mapping-config",
    tag: "form",
    classes: ["obs-scene-switcher", "mapping-config"],
    window: {
      title: `${MODULE_ID}.config.title`,
      icon: "fas fa-video",
      contentClasses: ["standard-form"]
    },
    position: { width: 640, height: "auto" },
    form: {
      handler: MappingConfig.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/mapping-config.hbs`,
      scrollable: [".actor-list"]
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  async _prepareContext(_options) {
    const mappings = getSetting(SETTINGS.sceneMappings) ?? {};

    // Try to fetch live scene names from OBS for the datalist. Non-fatal.
    let sceneOptions = [];
    try {
      if (obs.connected) sceneOptions = await obs.getSceneList();
    } catch (err) {
      warn("Could not fetch scene list from OBS:", err.message);
    }

    const actors = game.actors.contents
      .map((a) => ({
        id: a.id,
        name: a.name,
        searchName: (a.name ?? "").toLowerCase(),
        img: a.img,
        scene: mappings[a.id] ?? ""
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      actors,
      sceneOptions,
      hasSceneOptions: sceneOptions.length > 0,
      explorationScene: getSetting(SETTINGS.explorationScene) ?? "",
      dmFallbackScene: getSetting(SETTINGS.dmFallbackScene) ?? "",
      buttons: [
        { type: "submit", icon: "fas fa-save", label: `${MODULE_ID}.config.save` }
      ]
    };
  }

  /** Wire the client-side actor filter after each render. */
  _onRender(_context, _options) {
    const root = this.element;
    const search = root.querySelector(".actor-search");
    if (!search) return;

    const rows = Array.from(root.querySelectorAll(".actor-row"));
    const emptyMsg = root.querySelector(".actor-search-empty");

    const applyFilter = () => {
      const q = search.value.trim().toLowerCase();
      let visible = 0;
      for (const row of rows) {
        const match = !q || (row.dataset.name ?? "").includes(q);
        row.hidden = !match;
        if (match) visible++;
      }
      if (emptyMsg) emptyMsg.hidden = visible > 0;
    };

    search.addEventListener("input", applyFilter);
    // Preserve the query across re-renders (e.g. after fetching scene names).
    if (this._lastQuery) {
      search.value = this._lastQuery;
      applyFilter();
    }
    search.addEventListener("input", () => { this._lastQuery = search.value; });
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    // data.mapping is { [actorId]: sceneName }
    const mappings = {};
    for (const [id, scene] of Object.entries(data.mapping ?? {})) {
      const trimmed = (scene ?? "").trim();
      if (trimmed) mappings[id] = trimmed;
    }

    await setSetting(SETTINGS.sceneMappings, mappings);
    await setSetting(SETTINGS.explorationScene, (data.explorationScene ?? "").trim());
    await setSetting(SETTINGS.dmFallbackScene, (data.dmFallbackScene ?? "").trim());

    ui.notifications.info(game.i18n.localize(`${MODULE_ID}.config.saved`));

    // Re-evaluate immediately with the new mappings.
    resetSceneCache();
    syncScene();
  }
}
