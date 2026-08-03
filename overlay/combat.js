/**
 * The combat tracker, as run inside an OBS Browser Source.
 *
 * A classic script for the same reason as the other two pages: a Browser Source
 * loads this from a local file, and `file://` blocks module imports.
 *
 * The privacy decisions were all made in the module — hidden combatants never
 * arrive, and a gated NPC arrives with no portrait and no hit points. This page
 * renders what it is given and does not infer: a missing `hp` means "not for
 * broadcast", so the row simply has no bar, never a placeholder implying one.
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

    var portrait = C.image(combatant.img, "combat-portrait");
    if (portrait) row.appendChild(portrait);

    var body = C.el("div", "combat-body");
    body.appendChild(C.el("div", "combat-name", combatant.name || ""));

    var hp = renderHp(combatant.hp);
    if (hp) body.appendChild(hp);
    row.appendChild(body);

    // An initiative of null means "has not rolled yet" — leave the slot blank
    // rather than printing a zero, which is a legitimate initiative.
    if (combatant.initiative !== null && combatant.initiative !== undefined) {
      row.appendChild(C.el("div", "combat-init", combatant.initiative));
    }

    return row;
  }

  function renderHp(hp) {
    if (!hp) return null;

    var wrap = C.el("div", "combat-hp");
    // A null pct means the system gave no maximum — show the number, not a bar.
    var known = typeof hp.pct === "number";
    if (!known) wrap.classList.add("unknown-max");
    if (known && hp.pct <= 25) wrap.classList.add("low");
    else if (known && hp.pct <= 50) wrap.classList.add("mid");

    var bar = C.el("div", "combat-hp-bar");
    var fill = C.el("div", "combat-hp-fill");
    fill.style.width = known ? hp.pct + "%" : "0%";
    bar.appendChild(fill);
    wrap.appendChild(bar);

    var text = hp.max === null || hp.max === undefined ? String(hp.value) : hp.value + " / " + hp.max;
    if (hp.temp) text += " (+" + hp.temp + ")";
    wrap.appendChild(C.el("div", "combat-hp-text", text));

    return wrap;
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
