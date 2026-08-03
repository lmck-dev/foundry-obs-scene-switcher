/**
 * The combat tracker, as run inside an OBS Browser Source.
 *
 * A classic script for the same reason as the other two pages: a Browser Source
 * loads this from a local file, and `file://` blocks module imports.
 *
 * A row is a name and an initiative, with the combatant whose turn it is marked.
 * The privacy decision was made in the module — combatants hidden from the
 * players never arrive here — and everything that does arrive is already on
 * every player's own tracker.
 */
(function () {
  "use strict";

  var C = window.OBSOverlayCommon;
  var DEFAULT_EVENT = "obsSceneSwitcherCombat";
  var ROOT_ID = "obs-combat-root";

  function render(root, payload) {
    var combatants =
      payload && payload.present === true && Array.isArray(payload.combatants)
        ? payload.combatants
        : [];

    var list = root.querySelector(".combat-list");
    C.clear(list);
    combatants.forEach(function (combatant) {
      list.appendChild(renderRow(combatant));
    });

    renderRound(root, payload, combatants.length > 0);
    root.dataset.state = combatants.length ? "shown" : "empty";
  }

  /** The "Round 3" header. Round 0 is the pre-start line-up, so it is not a round yet. */
  function renderRound(root, payload, hasCombatants) {
    var header = root.querySelector(".combat-round");
    var round = payload && payload.round;
    var showRound = Boolean(hasCombatants && payload && payload.started && round);

    header.textContent = showRound ? "Round " + round : "";
    C.show(header, showRound);
  }

  function renderRow(combatant) {
    var row = C.el("div", "combat-row");
    if (combatant.active) row.classList.add("active");
    if (combatant.defeated) row.classList.add("defeated");

    row.appendChild(C.el("div", "combat-name", combatant.name || ""));

    // An initiative of null means "has not rolled yet" — leave the slot blank
    // rather than printing a zero, which is a legitimate initiative.
    if (combatant.initiative !== null && combatant.initiative !== undefined) {
      row.appendChild(C.el("div", "combat-init", combatant.initiative));
    }

    return row;
  }

  function mount(root, options) {
    return C.mount(root, render, DEFAULT_EVENT, options);
  }

  window.OBSCombatOverlay = {
    DEFAULT_EVENT: DEFAULT_EVENT,
    ROOT_ID: ROOT_ID,
    readOptions: function (search) {
      return C.readOptions(search, DEFAULT_EVENT);
    },
    render: render,
    mount: mount
  };

  C.autoMount(function () {
    var root = document.getElementById(ROOT_ID);
    if (root) window.OBSCombatOverlay.instance = mount(root);
  });
})();
