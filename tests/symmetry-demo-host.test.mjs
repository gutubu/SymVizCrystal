import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/symmetry-demo-workspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const catalog = JSON.parse(await readFile(new URL("../public/symmetry-demo/catalog.json", import.meta.url), "utf8"));
const numbers = catalog.groups.map((group) => group.id);
const origin = "http://127.0.0.1:49210";

// Drive the real component and its message handlers without starting a browser.
// The harness supplies React's hook lifecycle and the iframe's window boundary.
function host(currentSpaceGroupNumber = 152, language = "zh-CN") {
  const hooks = [], listeners = new Set(), timers = new Map(), sent = [];
  const frame = { postMessage(message, target) { sent.push({ ...message, target }); } };
  let hookIndex = 0, pending = [], dirty = true, tree, timerId = 0, backs = 0, opens = 0;
  let props = {
    visible: true, currentSpaceGroupNumber, currentSpaceGroupName: "Test group", language,
    onBack() { backs += 1; }, onOpenFile() { opens += 1; },
  };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const index = hookIndex++;
      hooks[index] ??= { state: typeof initial === "function" ? initial() : initial };
      return [hooks[index].state, (value) => {
        const next = typeof value === "function" ? value(hooks[index].state) : value;
        if (!Object.is(next, hooks[index].state)) { hooks[index].state = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = hookIndex++; return hooks[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = hookIndex++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { deps, callback };
      return hooks[index].callback;
    },
    useEffect(effect, deps) {
      const index = hookIndex++;
      if (!same(hooks[index]?.deps, deps)) {
        pending.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const jsx = (type, nodeProps) => ({ type, props: nodeProps });
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      throw new Error(`Unexpected host dependency: ${name}`);
    },
    window: {
      location: { origin },
      addEventListener(type, callback) { if (type === "message") listeners.add(callback); },
      removeEventListener(type, callback) { if (type === "message") listeners.delete(callback); },
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); },
    },
  });
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    return node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
  }
  function text(node) {
    if (Array.isArray(node)) return node.map((child) => text(child)).join("");
    return node && typeof node === "object" ? text(node.props?.children) : node == null || typeof node === "boolean" ? "" : String(node);
  }
  function flush() {
    for (let pass = 0; dirty && pass < 20; pass += 1) {
      dirty = false; hookIndex = 0; pending = [];
      tree = exports.default(props);
      for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = { contentWindow: frame };
      for (const effect of pending) effect();
    }
    assert.equal(dirty, false, "host rendering must settle");
    return tree;
  }
  flush();
  return {
    sent, text() { return text(tree); },
    button(label) { return nodes(tree).find((node) => node.type === "button" && text(node).includes(label)); },
    iframe() { return nodes(tree).find((node) => node.type === "iframe"); },
    message(data, eventOrigin = origin, sourceWindow = frame) {
      for (const callback of listeners) callback({ data, origin: eventOrigin, source: sourceWindow });
      flush();
    },
    props(next) { props = { ...props, ...next }; dirty = true; flush(); },
    load() { this.iframe().props.onLoad(); flush(); },
    timeout() { for (const callback of [...timers.values()]) callback(); flush(); },
    counts() { return { backs, opens }; },
  };
}

test("symmetry host accepts all 230 types and automatically selects the default quartz space group", () => {
  assert.deepEqual(numbers, Array.from({ length: 230 }, (_, i) => i + 1));
  const viewer = host();
  viewer.message({ type: "symviz:symmetry-demo/ready", numbers: numbers.slice(0, -1) });
  assert.equal(viewer.button("当前结构空间群").props.disabled, true, "an incomplete catalogue cannot become ready");
  viewer.message({ type: "symviz:symmetry-demo/ready", numbers: [...numbers.slice(0, -1), numbers[0]] });
  assert.equal(viewer.button("当前结构空间群").props.disabled, true, "duplicate IDs cannot replace a missing type");
  for (const invalid of [0, -1, 231]) {
    viewer.message({ type: "symviz:symmetry-demo/ready", numbers: numbers.map((number) => number === 230 ? invalid : number) });
    assert.equal(viewer.button("当前结构空间群").props.disabled, true, "an invalid ID cannot replace a missing type");
  }
  viewer.message({ type: "symviz:symmetry-demo/ready", numbers });
  assert.equal(viewer.button("当前结构空间群").props.disabled, false);
  assert.ok(viewer.sent.some((message) => message.type === "symviz:symmetry-demo/select-group" && message.number === 152));
  assert.ok(viewer.sent.every((message) => message.target === origin));
  const before = viewer.sent.length;
  viewer.message({ type: "symviz:symmetry-demo/ready", numbers });
  assert.equal(viewer.sent.slice(before).filter((message) => message.type === "symviz:symmetry-demo/select-group").length, 0,
    "a repeat ready event must not reset the user's selection");
  viewer.props({ visible: false });
  assert.equal(viewer.iframe().props.src, "/symmetry-demo/index.html", "tab changes must keep the iframe mounted");
  assert.ok(viewer.sent.some((message) => message.type === "symviz:symmetry-demo/visibility" && message.visible === false));
  viewer.props({ visible: true });
  viewer.message({ type: "symviz:symmetry-demo/open-file" });
  assert.equal(viewer.counts().opens, 1);
  viewer.button("返回三维晶体").props.onClick();
  assert.equal(viewer.counts().backs, 1);
  assert.equal(viewer.sent.at(-1).type, "symviz:symmetry-demo/visibility");
  assert.equal(viewer.sent.at(-1).visible, false, "returning to the crystal pauses the demo before leaving");
});

test("symmetry host rejects foreign messages and keeps errors visible until an explicit retry", () => {
  const viewer = host(2);
  const error = { type: "symviz:symmetry-demo/error", message: "UNTRUSTED DETAILS" };
  viewer.message(error, "https://example.invalid");
  viewer.message(error, origin, {});
  assert.doesNotMatch(viewer.text(), /初始化失败/);
  viewer.message(error);
  assert.match(viewer.text(), /交互演示初始化失败/);
  assert.doesNotMatch(viewer.text(), /UNTRUSTED DETAILS/);
  viewer.load();
  assert.match(viewer.text(), /交互演示初始化失败/, "a subsequent load must not hide initialization failure");
  viewer.button("重新载入演示").props.onClick();
  viewer.props({});
  assert.match(viewer.iframe().props.src, /\?retry=1$/);
  assert.doesNotMatch(viewer.text(), /初始化失败/);
  viewer.timeout();
  assert.match(viewer.text(), /加载超时/);
  const english = host(2, "en-US");
  english.message(error);
  assert.match(english.text(), /The interactive demonstration could not initialize/);
  assert.doesNotMatch(english.text(), /UNTRUSTED DETAILS/);
});

test("symmetry host locates newly added nonpolar acentric groups without confusing them with centrosymmetric groups", () => {
  for (const id of [16, 81, 152, 187, 196, 220]) {
    const group = catalog.groups.find((entry) => entry.id === id);
    assert.equal(group.nonpolarAcentric, true, `No.${id} belongs to the new category`);
    assert.equal(group.polarGroup, false);
    assert.equal(group.centrosymmetric, false);
    const viewer = host(id);
    viewer.message({ type: "symviz:symmetry-demo/ready", numbers });
    assert.equal(viewer.button("当前结构空间群").props.disabled, false);
    assert.ok(viewer.sent.some((message) => message.type === "symviz:symmetry-demo/select-group" && message.number === id));
    assert.match(viewer.text(), /全部 230 类/);
    assert.match(viewer.text(), /70 非中心对称非极性/);
    assert.doesNotMatch(viewer.text(), /尚未加入|P2\/n 对照/);
  }
});

test("symmetry host explains missing or invalid CIF numbers while keeping the full catalogue available", () => {
  for (const id of [undefined, 0, -1, 231, 1.5, NaN]) {
    const viewer = host(id);
    viewer.props({ currentSpaceGroupNumber: id });
    viewer.message({ type: "symviz:symmetry-demo/ready", numbers });
    assert.equal(viewer.button("当前结构空间群").props.disabled, true);
    assert.match(viewer.text(), /有效空间群编号/);
    assert.match(viewer.text(), /1–230/);
    assert.doesNotMatch(viewer.text(), /尚未加入|70 类.*未/);
    assert.equal(viewer.sent.some((message) => message.type === "symviz:symmetry-demo/select-group"), false);
    assert.equal(viewer.iframe().props.src, "/symmetry-demo/index.html");
  }
});

test("the main workspace opens the ferroelectric example inside the existing trusted frame", () => {
  const viewer = host(152);
  assert.equal(viewer.button("铁电相变").props.disabled, true);
  viewer.message({ type: "symviz:symmetry-demo/ready", numbers });
  assert.equal(viewer.button("铁电相变").props.disabled, false);
  viewer.button("铁电相变").props.onClick();
  assert.equal(viewer.sent.at(-1).type, "symviz:symmetry-demo/select-view");
  assert.equal(viewer.sent.at(-1).view, "transition");
  assert.equal(viewer.sent.at(-1).target, origin);
  assert.equal(viewer.iframe().props.src, "/symmetry-demo/index.html");
});
