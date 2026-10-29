"use client";

import { useEffect, useRef, useState } from "react";
import { CubeSurfaceCanvas } from "../cube-viewer";
import { cubeIsovalueRange, cubePhaseAvailability, defaultCubeIsovalue, parseGaussianCube, type CubeData } from "../gaussian-tools";

export default function MultiwfnVisualizerPage() {
  const [cube, setCube] = useState<CubeData | null>(null);
  const [fileName, setFileName] = useState("");
  const [isovalue, setIsovalue] = useState(0.02);
  const [positive, setPositive] = useState(true);
  const [negative, setNegative] = useState(true);
  const [showBonds, setShowBonds] = useState(true);
  const [smoothSurface, setSmoothSurface] = useState(true);
  const [language, setLanguage] = useState<"zh-CN" | "en-US">("zh-CN");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const text = (zh: string, en: string) => language === "en-US" ? en : zh;

  function loadCube(name: string, content: string) {
    const parsed = parseGaussianCube(content);
    setCube(parsed);
    setFileName(name);
    setIsovalue(defaultCubeIsovalue(parsed));
    const phases = cubePhaseAvailability(parsed);
    setPositive(phases.positive);
    setNegative(phases.negative);
    setError("");
  }

  useEffect(() => {
    const stored = window.localStorage.getItem("symviz-language");
    if (stored === "en-US" || stored === "zh-CN") setLanguage(stored);
    const query = new URLSearchParams(window.location.search);
    const jobId = query.get("job");
    const artifact = query.get("file");
    if (!jobId || !artifact || !window.symvizDesktop) return;
    void window.symvizDesktop.readMultiwfnArtifact(jobId, artifact)
      .then((result) => loadCube(result.name, result.text))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const isovalueRange = cube ? cubeIsovalueRange(cube) : { minimum: 1e-8, maximum: 1, step: 0.001 };
  const phases = cube ? cubePhaseAvailability(cube) : { positive: false, negative: false };
  return <main className="multiwfn-viewer-page">
    <header className="multiwfn-viewer-header">
      <div><b>SYMVIZ</b><span>Multiwfn 3D Visualizer</span></div>
      <div className="gaussian-actions">
        <button type="button" className="primary" onClick={() => inputRef.current?.click()}>{text("打开 Cube…", "Open Cube…")}</button>
        <button type="button" onClick={() => setLanguage((current) => current === "zh-CN" ? "en-US" : "zh-CN")}>{language === "zh-CN" ? "EN-US" : "中文"}</button>
      </div>
    </header>
    <input ref={inputRef} type="file" accept=".cube,.cub,text/plain" hidden onChange={(event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      void file.text().then((content) => loadCube(file.name, content)).catch((reason) => setError(String(reason)));
      event.currentTarget.value = "";
    }} />
    <section className="multiwfn-viewer-toolbar">
      <span><small>{text("文件", "File")}</small><strong>{fileName || text("尚未载入", "No file loaded")}</strong></span>
      <label><span>{text("等值（原子单位）", "Isovalue (atomic units)")} <output>{isovalue.toExponential(3)}</output></span><input
        type="range"
        min={isovalueRange.minimum}
        max={isovalueRange.maximum}
        step={isovalueRange.step}
        value={isovalue}
        disabled={!cube}
        onChange={(event) => setIsovalue(Number(event.target.value))}
      /></label>
      <label title={text("使用完整网格重建等值面，并隐藏明显的三角网格边线", "Rebuild from the full grid and suppress visible triangle edges")}><input type="checkbox" checked={smoothSurface} onChange={(event) => setSmoothSurface(event.target.checked)} />{text("平滑表面", "Smooth surface")}</label>
      <label><input type="checkbox" checked={showBonds} onChange={(event) => setShowBonds(event.target.checked)} />{text("化学键", "Bonds")}</label>
      <label title={!phases.positive ? text("当前 Cube 数据没有正值", "This Cube grid contains no positive values") : undefined}><input type="checkbox" checked={positive} disabled={!phases.positive} onChange={(event) => setPositive(event.target.checked)} />{text("正相位", "Positive")}</label>
      <label title={!phases.negative ? text("当前 Cube 数据没有负值", "This Cube grid contains no negative values") : undefined}><input type="checkbox" checked={negative} disabled={!phases.negative} onChange={(event) => setNegative(event.target.checked)} />{text("负相位", "Negative")}</label>
    </section>
    {error && <div className="utility-warning"><strong>{text("无法载入文件", "Could not load file")}</strong><p>{error}</p></div>}
    <section className="multiwfn-viewer-stage">
      {cube ? <CubeSurfaceCanvas cube={cube} isovalue={isovalue} showPositive={positive} showNegative={negative} showBonds={showBonds} smoothSurface={smoothSurface} language={language} /> : <div className="utility-empty cube-empty">
        <strong>{text("独立三维等值面窗口", "Separate 3D isosurface window")}</strong>
        <p>{text("从 Multiwfn 任务的 Cube 产物打开，或在此选择任意 .cube / .cub 文件。", "Open a Cube artifact from a Multiwfn job, or select any .cube / .cub file here.")}</p>
      </div>}
    </section>
    {cube && <footer className="cube-stats">
      <span>min<strong>{cube.minimum.toExponential(4)}</strong></span>
      <span>max<strong>{cube.maximum.toExponential(4)}</strong></span>
      <span>RMS<strong>{cube.rms.toExponential(4)}</strong></span>
      <span>{text("原子数", "Atoms")}<strong>{cube.atoms.length}</strong></span>
    </footer>}
  </main>;
}
