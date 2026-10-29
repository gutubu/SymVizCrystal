"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SymmetryDemoWorkspaceProps = {
  visible: boolean;
  currentSpaceGroupNumber?: number;
  currentSpaceGroupName: string;
  language: "zh-CN" | "en-US";
  onBack: () => void;
  onOpenFile: () => void;
};

const VIEWER_PATH = "/symmetry-demo/index.html";
const READY_TIMEOUT_MS = 15_000;
const DEMO_NUMBERS = new Set(Array.from({ length: 230 }, (_, i) => i + 1));

type ViewerCommand =
  | { type: "symviz:symmetry-demo/select-group"; number: number }
  | { type: "symviz:symmetry-demo/select-view"; view: "spacegroup" | "transition" }
  | { type: "symviz:symmetry-demo/visibility"; visible: boolean };
type LoadState = "idle" | "loading" | "ready" | "error";
type ErrorReason = "network" | "initialization" | "load-timeout" | "ready-timeout" | null;

function supportedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && DEMO_NUMBERS.has(value);
}

function validatedNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== DEMO_NUMBERS.size) return null;
  if (!value.every(supportedNumber)) return null;
  const numbers = [...new Set(value as number[])];
  return numbers.length === DEMO_NUMBERS.size ? numbers : null;
}

/** Keeps both the crystal workspace and the bundled demonstration alive on tab changes. */
export default function SymmetryDemoWorkspace({
  visible,
  currentSpaceGroupNumber,
  currentSpaceGroupName,
  language,
  onBack,
  onOpenFile,
}: SymmetryDemoWorkspaceProps) {
  const english = language === "en-US";
  const text = (zh: string, en: string) => english ? en : zh;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const readyRef = useRef(false);
  const loadedRef = useRef(false);
  const initialSelectionSentRef = useRef(false);
  const currentRef = useRef({ visible, currentSpaceGroupNumber, onOpenFile });
  const [opened, setOpened] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorReason, setErrorReason] = useState<ErrorReason>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [supportedNumbers, setSupportedNumbers] = useState<number[]>([]);
  const [frameHeight, setFrameHeight] = useState(940);
  const [reloadAttempt, setReloadAttempt] = useState(0);

  useEffect(() => {
    currentRef.current = { visible, currentSpaceGroupNumber, onOpenFile };
  }, [visible, currentSpaceGroupNumber, onOpenFile]);

  const postToViewer = useCallback((message: ViewerCommand) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  useEffect(() => {
    if (!visible || opened) return;
    readyRef.current = false;
    loadedRef.current = false;
    setLoadState("loading");
    setOpened(true);
  }, [visible, opened]);

  useEffect(() => {
    function receiveViewerMessage(event: MessageEvent<unknown>) {
      if (event.origin !== window.location.origin
        || event.source !== iframeRef.current?.contentWindow) return;
      const payload = event.data;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      const message = payload as Record<string, unknown>;
      if (message.type === "symviz:symmetry-demo/ready") {
        const numbers = validatedNumbers(message.numbers);
        if (!numbers) return;
        readyRef.current = true;
        setSupportedNumbers(numbers);
        setErrorReason(null);
        setLoadState("ready");
        postToViewer({ type: "symviz:symmetry-demo/visibility", visible: currentRef.current.visible });
        if (!initialSelectionSentRef.current) {
          initialSelectionSentRef.current = true;
          const number = currentRef.current.currentSpaceGroupNumber;
          if (supportedNumber(number) && numbers.includes(number)) {
            postToViewer({ type: "symviz:symmetry-demo/select-group", number });
          }
        }
      } else if (message.type === "symviz:symmetry-demo/error") {
        readyRef.current = false;
        setSupportedNumbers([]);
        setErrorReason("initialization");
        setLoadState("error");
      } else if (message.type === "symviz:symmetry-demo/height") {
        const height = message.height;
        if (typeof height === "number" && Number.isInteger(height) && height >= 380 && height <= 14_000) {
          setFrameHeight(height);
        }
      } else if (message.type === "symviz:symmetry-demo/scroll-top" && readyRef.current) {
        workspaceRef.current?.scrollTo({ top: 0, left: 0 });
      } else if (message.type === "symviz:symmetry-demo/open-file" && readyRef.current) {
        currentRef.current.onOpenFile();
      }
    }
    window.addEventListener("message", receiveViewerMessage);
    return () => window.removeEventListener("message", receiveViewerMessage);
  }, [postToViewer]);

  useEffect(() => {
    if (!opened) return;
    postToViewer({ type: "symviz:symmetry-demo/visibility", visible });
  }, [opened, visible, postToViewer]);

  useEffect(() => {
    if (!opened || loadState !== "loading") return;
    const timeout = window.setTimeout(() => {
      if (readyRef.current) return;
      setErrorReason(loadedRef.current ? "ready-timeout" : "load-timeout");
      setLoadState("error");
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [opened, reloadAttempt, loadState]);

  function reloadViewer() {
    readyRef.current = false;
    loadedRef.current = false;
    initialSelectionSentRef.current = false;
    setSupportedNumbers([]);
    setErrorReason(null);
    setFrameLoaded(false);
    setLoadState("loading");
    setReloadAttempt((attempt) => attempt + 1);
  }

  function returnToCrystal() {
    postToViewer({ type: "symviz:symmetry-demo/visibility", visible: false });
    onBack();
  }

  const validCurrentNumber = typeof currentSpaceGroupNumber === "number"
    && Number.isInteger(currentSpaceGroupNumber) && currentSpaceGroupNumber > 0;
  const currentSupported = supportedNumber(currentSpaceGroupNumber);
  const canSelectCurrent = loadState === "ready" && currentSupported
    && supportedNumbers.includes(currentSpaceGroupNumber);
  const currentLabel = `${currentSpaceGroupName || text("未提供名称", "Unnamed")}${validCurrentNumber ? ` · No.${currentSpaceGroupNumber}` : ""}`;
  const unsupportedMessage = !validCurrentNumber
    ? text("当前结构未提供有效空间群编号（1–230）。", "The current structure has no valid space-group number (1–230).")
    : !currentSupported
      ? text(`No.${currentSpaceGroupNumber} 不是 1–230 范围内的有效空间群编号。`, `No.${currentSpaceGroupNumber} is not a valid space-group number in the range 1–230.`)
      : null;
  const errorMessage = errorReason === "initialization"
    ? text("交互演示初始化失败。请重新载入。", "The interactive demonstration could not initialize. Please reload it.")
    : errorReason === "ready-timeout"
    ? text("演示页面已载入，但交互模块未就绪。请重新载入。", "The page loaded, but the interactive module did not become ready. Reload the demonstration.")
    : errorReason === "network"
      ? text("演示页面加载失败。请重新载入。", "The demonstration page could not be loaded. Please reload it.")
      : text("演示页面加载超时。请重新载入。", "The demonstration page timed out. Please reload it.");

  return <section ref={workspaceRef} className="symmetry-demo-workspace" hidden={!visible} aria-label={text("空间群对称操作演示", "Space-group symmetry demonstrations")}>
    <header className="symmetry-demo-workspace-header">
      <div className="symmetry-demo-workspace-heading">
        <strong>{text("空间群与铁电相变演示", "Space-group and ferroelectric transition demonstrations")}</strong>
        <span>{text("全部 230 类 · 68 极性 · 92 中心对称 · 70 非中心对称非极性", "230 types · 68 polar · 92 centrosymmetric · 70 nonpolar acentric")}</span>
      </div>
      <div className="symmetry-demo-workspace-actions">
        <button type="button" onClick={returnToCrystal}>← {text("返回三维晶体", "Back to crystal")}</button>
        <button type="button" disabled={loadState !== "ready"} onClick={() => postToViewer({ type: "symviz:symmetry-demo/select-view", view: "transition" })}>{text("铁电相变", "Ferroelectric transitions")}</button>
        <button
          type="button"
          className="primary"
          disabled={!canSelectCurrent}
          title={unsupportedMessage || text("在演示中查看当前结构的空间群，不改写 CIF。", "View this structure's space group without modifying the CIF.")}
          onClick={() => {
            if (canSelectCurrent && currentSpaceGroupNumber !== undefined) {
              postToViewer({ type: "symviz:symmetry-demo/select-group", number: currentSpaceGroupNumber });
            }
          }}
        >{text("当前结构空间群", "Current structure group")}{validCurrentNumber ? ` #${currentSpaceGroupNumber}` : ""}</button>
      </div>
    </header>
    <div className="symmetry-demo-structure-context">
      <div><span>{text("当前结构", "Current structure")}</span><strong>{currentLabel}</strong></div>
      {unsupportedMessage && <p className="symmetry-demo-unsupported">{unsupportedMessage}</p>}
      <p>{text("演示采用固定表列设定，不改写当前 CIF 的轴、原点或原子坐标。同一编号可能使用不同设定，例如 Pc 与 Pn。", "The demonstrations use fixed tabulated settings; they do not rewrite the CIF's axes, origin or atomic coordinates. A number may have different settings, such as Pc and Pn.")}</p>
    </div>
    {opened && loadState === "loading" && <div className="symmetry-demo-load-status" role="status" aria-live="polite">
      <span aria-hidden="true">…</span>
      {frameLoaded ? text("页面已载入，正在初始化交互演示…", "Page loaded; initializing the interactive demonstration…") : text("正在加载空间群演示…", "Loading the space-group demonstrations…")}
    </div>}
    {opened && loadState === "error" && <div className="symmetry-demo-load-status error" role="alert">
      <span>{errorMessage}</span><button type="button" onClick={reloadViewer}>{text("重新载入演示", "Reload demonstration")}</button>
    </div>}
    <div className={`symmetry-demo-viewer${loadState === "error" ? " is-error" : ""}`}>
      {opened && <iframe
        ref={iframeRef}
        src={`${VIEWER_PATH}${reloadAttempt ? `?retry=${reloadAttempt}` : ""}`}
        title={text("SymViz 空间群对称操作交互演示", "SymViz interactive space-group symmetry demonstrations")}
        style={{ height: frameHeight }}
        scrolling="no"
        aria-busy={loadState === "loading"}
        onLoad={() => {
          loadedRef.current = true;
          setFrameLoaded(true);
          if (!readyRef.current) setLoadState((state) => state === "error" ? state : "loading");
          postToViewer({ type: "symviz:symmetry-demo/visibility", visible: currentRef.current.visible });
        }}
        onError={() => {
          readyRef.current = false;
          setErrorReason("network");
          setLoadState("error");
        }}
      />}
    </div>
  </section>;
}
