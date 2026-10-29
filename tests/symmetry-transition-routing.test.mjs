import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const template = await readFile(new URL("../tools/symmetry-demo/gallery-template.html", import.meta.url), "utf8");
const origin = "http://127.0.0.1:49320";

function between(start, end) {
  const first = template.indexOf(start);
  const last = template.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `The live gallery must include ${start}`);
  return template.slice(first, last);
}

// Run the real gallery routing and host-message handlers. The two animation
// instances are observable doubles, so this checks their lifecycle independently
// of the mathematical models and SVG renderer tested elsewhere.
function gallery() {
  const notifications = [], mounts = [], selectedGroups = [], listeners = new Map();
  const state = { stops: 0, draws: 0, saves: 0, reports: 0, focused: null };
  const parent = {};
  function element(dataset = {}) {
    const handlers = new Map(), attributes = new Map();
    return {
      dataset, hidden: false, value: "", tabIndex: 0,
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      addEventListener(type, handler) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
      },
      emit(type, event = {}) { for (const handler of handlers.get(type) ?? []) handler(event); },
      focus() { state.focused = this; },
    };
  }
  const panels = [...template.matchAll(/<div\s+data-transition-panel\s+data-transition-species="([^"]+)"[^>]*>/g)]
    .map((match) => element({ transitionSpecies: match[1] }));
  const tabs = [...template.matchAll(/<button\b[^>]*data-suite-view="([^"]+)"[^>]*>/g)]
    .map((match) => element({ suiteView: match[1] }));
  const select = element(); select.value = "222F1";
  const space = element(), transition = element();
  const root = {
    querySelector(selector) {
      if (selector === "#pg-transition-species") return select;
      if (selector === "#pg-space-view") return space;
      if (selector === "#pg-transition-view") return transition;
      const key = selector.match(/^\[data-suite-view="([^"]+)"\]$/)?.[1];
      if (key) return tabs.find((button) => button.dataset.suiteView === key);
      throw new Error(`Unexpected routing selector: ${selector}`);
    },
    querySelectorAll(selector) {
      if (selector === "[data-transition-panel]") return panels;
      if (selector === "[data-suite-view]") return tabs;
      throw new Error(`Unexpected routing selector: ${selector}`);
    },
  };
  const window = {
    parent, location: { origin },
    addEventListener(type, handler) { listeners.set(type, handler); },
    SymVizFerroTransition: {
      mount(container, { species }) {
        const viewer = {
          species, q: 0, domain: 0, visible: true, playing: false, visibilityCalls: [],
          setVisible(value) {
            this.visible = value; this.visibilityCalls.push(value);
            if (!value) this.playing = false;
          },
          setPhase() { assert.fail("Changing the selected species must not reset a phase"); },
          destroy() { assert.fail("Changing the selected species must not destroy an animation"); },
        };
        mounts.push({ container, species, viewer });
        return viewer;
      },
    },
  };
  const context = {
    root, window,
    diagrams: {},
    stop() { state.stops += 1; }, draw() { state.draws += 1; },
    save() { state.saves += 1; }, reportHeight() { state.reports += 1; },
    notify(type) { notifications.push(type); },
    selectGroup(number) { selectedGroups.push(number); },
  };
  const messageHandler = between("  window.addEventListener('message'", "  document.addEventListener('keydown'");
  const routing = between("  const transitionSelect=", "  buildFamilyOptions();buildGroupOptions();buildOperations();new ResizeObserver");
  vm.runInNewContext(`
    let pageView='spacegroup',parentVisible=true;
    ${messageHandler}
    ${routing}
    setPageView('spacegroup');
    globalThis.routing={selectTransitionSpecies,setPageView,syncTransitionVisibility};
  `, context);
  return {
    mounts, panels, tabs, select, space, transition, state, selectedGroups, notifications,
    viewer(species) { return mounts.find((entry) => entry.species === species).viewer; },
    tab(view) { return tabs.find((button) => button.dataset.suiteView === view); },
    changeSpecies(species) { select.value = species; select.emit("change"); },
    selectSpecies: context.routing.selectTransitionSpecies,
    setPageView: context.routing.setPageView,
    message(data, eventOrigin = origin, source = parent) {
      listeners.get("message")({ data, origin: eventOrigin, source });
    },
  };
}

test("the real species picker mounts both transitions once and preserves their independent progress", () => {
  const demo = gallery();
  assert.deepEqual(demo.mounts.map(({ species }) => species), ["222F1", "mF1"]);
  assert.match(template, /<option value="mF1">mF1（2\/2）/);
  assert.equal(demo.viewer("222F1").visible, false);
  assert.equal(demo.viewer("mF1").visible, false);
  demo.tab("transition").emit("click");
  const first = demo.viewer("222F1"), mirror = demo.viewer("mF1");
  first.q = .37; first.domain = 2; first.playing = true;
  demo.changeSpecies("mF1");
  assert.equal(first.visible, false);
  assert.equal(first.playing, false, "the hidden animation must pause");
  assert.equal(mirror.visible, true);
  assert.equal(demo.panels[0].hidden, true);
  assert.equal(demo.panels[1].hidden, false);
  mirror.q = .82; mirror.domain = 1; mirror.playing = true;
  demo.changeSpecies("222F1");
  assert.equal(mirror.visible, false);
  assert.equal(mirror.playing, false);
  assert.equal(demo.viewer("222F1"), first);
  assert.equal(first.visible, true);
  assert.equal(first.playing, false, "returning must not silently restart playback");
  assert.equal(first.q, .37);
  assert.equal(first.domain, 2);
  demo.changeSpecies("mF1");
  assert.equal(demo.viewer("mF1"), mirror);
  assert.equal(mirror.q, .82);
  assert.equal(mirror.domain, 1);
  assert.equal(demo.mounts.length, 2, "switching must reuse both mounted modules");
});

test("space-group navigation and trusted host visibility suspend both models and restore only the selection", () => {
  const demo = gallery();
  demo.setPageView("transition"); demo.changeSpecies("mF1");
  const mirror = demo.viewer("mF1"); mirror.q = .64; mirror.playing = true;
  demo.setPageView("spacegroup");
  assert.ok(demo.mounts.every(({ viewer }) => !viewer.visible));
  assert.equal(mirror.playing, false);
  assert.equal(demo.space.hidden, false);
  assert.equal(demo.transition.hidden, true);
  demo.setPageView("transition");
  assert.equal(mirror.visible, true);
  assert.equal(demo.viewer("222F1").visible, false);
  mirror.playing = true;
  demo.message({ type: "symviz:symmetry-demo/visibility", visible: false });
  assert.ok(demo.mounts.every(({ viewer }) => !viewer.visible));
  assert.equal(mirror.playing, false);
  demo.message({ type: "symviz:symmetry-demo/visibility", visible: true });
  assert.equal(mirror.visible, true);
  assert.equal(mirror.q, .64);
  assert.equal(demo.viewer("222F1").visible, false);
  demo.message({ type: "symviz:symmetry-demo/select-group", number: 6 });
  assert.deepEqual(demo.selectedGroups, [6]);
  assert.equal(demo.space.hidden, false);
  assert.ok(demo.mounts.every(({ viewer }) => !viewer.visible));
});

test("routing rejects unknown species and foreign messages and keeps topic tabs accessible", () => {
  const demo = gallery();
  demo.setPageView("transition"); demo.changeSpecies("mF1");
  const before = demo.notifications.length;
  demo.selectSpecies("not-a-species"); demo.setPageView("unknown");
  assert.equal(demo.select.value, "mF1");
  assert.equal(demo.viewer("mF1").visible, true);
  assert.equal(demo.notifications.length, before);
  for (const [eventOrigin, source] of [["https://example.invalid", undefined], [origin, {}]]) {
    demo.message({ type: "symviz:symmetry-demo/visibility", visible: false }, eventOrigin, source);
    demo.message({ type: "symviz:symmetry-demo/select-view", view: "spacegroup" }, eventOrigin, source);
  }
  assert.equal(demo.viewer("mF1").visible, true);
  assert.equal(demo.tab("transition").getAttribute("aria-selected"), "true");
  assert.equal(demo.tab("transition").tabIndex, 0);
  assert.equal(demo.tab("spacegroup").getAttribute("aria-selected"), "false");
  assert.equal(demo.tab("spacegroup").tabIndex, -1);
  let prevented = false;
  demo.tab("transition").emit("keydown", { key: "Home", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(demo.state.focused, demo.tab("spacegroup"));
  assert.equal(demo.tab("spacegroup").getAttribute("aria-selected"), "true");
  assert.equal(demo.tab("spacegroup").tabIndex, 0);
  demo.tab("spacegroup").emit("keydown", { key: "End", preventDefault() {} });
  assert.equal(demo.state.focused, demo.tab("transition"));
  assert.equal(demo.viewer("mF1").visible, true);
  assert.ok(demo.notifications.filter((type) => type === "symviz:symmetry-demo/scroll-top").length >= 4);
});
