"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CIF,
  type AtomInstance,
  type CrystalStructure,
  type SymmetryOperation,
  type Vec3,
  applyOperation,
  elementStyle,
  formatFractional,
  fractToCart,
  latticeVectors,
  operationKindLabel,
  parseCif,
} from "./crystal-data";

type DisplaySettings = {
  atoms: boolean;
  bonds: boolean;
  cell: boolean;
  labels: boolean;
  symmetry: boolean;
};

type ProjectedAtom = { index: number; x: number; y: number; radius: number; depth: number };

const defaultDisplay: DisplaySettings = {
  atoms: true,
  bonds: true,
  cell: true,
  labels: true,
  symmetry: true,
};

function prettyGroup(value: string) {
  const subscript: Record<string, string> = { "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆" };
  return value.replace(/\b([2346])([1-6])\b/g, (_, axis: string, screw: string) => `${axis}${subscript[screw]}`);
}

function coordinateText(value: Vec3) {
  return `(${value.map(formatFractional).join(", ")})`;
}

function vectorAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vectorScale(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function vectorLength(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const length = vectorLength(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function findEigenDirection(operation: SymmetryOperation, eigenvalue: 1 | -1): Vec3 {
  const candidates: Vec3[] = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let y = -2; y <= 2; y += 1) {
      for (let z = -2; z <= 2; z += 1) {
        if (x || y || z) candidates.push([x, y, z]);
      }
    }
  }
  const score = (candidate: Vec3) => {
    const transformed = operation.matrix.map((row) => row[0] * candidate[0] + row[1] * candidate[1] + row[2] * candidate[2]) as Vec3;
    return Math.hypot(
      transformed[0] - eigenvalue * candidate[0],
      transformed[1] - eigenvalue * candidate[1],
      transformed[2] - eigenvalue * candidate[2],
    ) / vectorLength(candidate);
  };
  return normalize(candidates.sort((a, b) => score(a) - score(b))[0] ?? [0, 0, 1]);
}

function CrystalCanvas({
  structure,
  display,
  selectedAtomIndex,
  selectedOperation,
  onSelectAtom,
}: {
  structure: CrystalStructure;
  display: DisplaySettings;
  selectedAtomIndex: number;
  selectedOperation: SymmetryOperation;
  onSelectAtom: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectedAtoms = useRef<ProjectedAtom[]>([]);
  const rotation = useRef({ yaw: -0.62, pitch: 0.48 });
  const zoom = useRef(1);
  const drag = useRef({ active: false, x: 0, y: 0, moved: 0 });
  const [orthographic, setOrthographic] = useState(false);
  const [viewVersion, setViewVersion] = useState(0);

  const redraw = useCallback(() => setViewVersion((version) => version + 1), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    const height = rect.height;
    context.clearRect(0, 0, width, height);

    const center = fractToCart([0.5, 0.5, 0.5], structure.cell);
    const [, , cVector] = latticeVectors(structure.cell);
    const maxCell = Math.max(structure.cell.a, structure.cell.b, structure.cell.c, 1);
    const worldScale = 2.45 / maxCell;
    const yaw = rotation.current.yaw;
    const pitch = rotation.current.pitch;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);

    const rotate = (point: Vec3): Vec3 => {
      const x = (point[0] - center[0]) * worldScale;
      const y = (point[1] - center[1]) * worldScale;
      const z = (point[2] - center[2]) * worldScale;
      const x1 = x * cosYaw + z * sinYaw;
      const z1 = -x * sinYaw + z * cosYaw;
      return [x1, y * cosPitch - z1 * sinPitch, y * sinPitch + z1 * cosPitch];
    };

    const project = (point: Vec3) => {
      const rotated = rotate(point);
      const base = Math.min(width, height);
      const factor = orthographic
        ? base * 0.19 * zoom.current
        : (base * 0.78 * zoom.current) / Math.max(2.3, 5.1 - rotated[2]);
      return {
        x: width / 2 + rotated[0] * factor,
        y: height / 2 - rotated[1] * factor,
        depth: rotated[2],
        factor,
      };
    };

    const fractionalCorners: Vec3[] = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];
    const corners: Vec3[] = fractionalCorners.map((fract) => fractToCart(fract, structure.cell));
    const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

    if (display.cell) {
      context.save();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(145, 175, 205, .42)";
      context.setLineDash([4, 7]);
      for (const [from, to] of edges) {
        const a = project(corners[from]);
        const b = project(corners[to]);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      context.restore();
    }

    if (display.symmetry && selectedOperation.kind !== "identity") {
      context.save();
      if (["rotation", "screw", "rotoinversion"].includes(selectedOperation.kind)) {
        const axisFract = findEigenDirection(selectedOperation, 1);
        const axisCart = normalize(fractToCart(axisFract, structure.cell));
        const span = Math.max(structure.cell.a, structure.cell.b, structure.cell.c) * 0.78;
        const a = project(vectorAdd(center, vectorScale(axisCart, -span)));
        const b = project(vectorAdd(center, vectorScale(axisCart, span)));
        context.strokeStyle = "rgba(255, 186, 73, .92)";
        context.lineWidth = 2;
        context.setLineDash([9, 6]);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "#ffc45a";
        context.beginPath();
        context.arc(b.x, b.y, 4, 0, Math.PI * 2);
        context.fill();
      } else if (["mirror", "glide"].includes(selectedOperation.kind)) {
        const normalFract = findEigenDirection(selectedOperation, -1);
        const normal = normalize(fractToCart(normalFract, structure.cell));
        const helper: Vec3 = Math.abs(normal[2]) < 0.8 ? [0, 0, 1] : [0, 1, 0];
        const u = normalize(cross(normal, helper));
        const v = normalize(cross(normal, u));
        const span = maxCell * 0.52;
        const plane = [
          vectorAdd(center, vectorAdd(vectorScale(u, -span), vectorScale(v, -span))),
          vectorAdd(center, vectorAdd(vectorScale(u, span), vectorScale(v, -span))),
          vectorAdd(center, vectorAdd(vectorScale(u, span), vectorScale(v, span))),
          vectorAdd(center, vectorAdd(vectorScale(u, -span), vectorScale(v, span))),
        ].map(project);
        context.fillStyle = "rgba(255, 184, 73, .10)";
        context.strokeStyle = "rgba(255, 190, 80, .7)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(plane[0].x, plane[0].y);
        plane.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.closePath();
        context.fill();
        context.stroke();
      } else if (selectedOperation.kind === "inversion") {
        const point = project(center);
        context.strokeStyle = "#ffc45a";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(point.x, point.y, 9, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "#ffc45a";
        context.beginPath();
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    if (display.bonds) {
      context.save();
      context.lineCap = "round";
      for (const bond of structure.bonds) {
        const atomA = structure.atoms[bond.a];
        const atomB = structure.atoms[bond.b];
        const directDistance = Math.hypot(
          atomA.cart[0] - atomB.cart[0], atomA.cart[1] - atomB.cart[1], atomA.cart[2] - atomB.cart[2],
        );
        if (directDistance > bond.distance + 0.25) continue;
        const a = project(atomA.cart);
        const b = project(atomB.cart);
        const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, elementStyle(atomA.element).color);
        gradient.addColorStop(0.48, "rgba(147, 163, 180, .62)");
        gradient.addColorStop(0.52, "rgba(147, 163, 180, .62)");
        gradient.addColorStop(1, elementStyle(atomB.element).color);
        context.strokeStyle = gradient;
        context.globalAlpha = 0.64;
        context.lineWidth = Math.max(2, Math.min(5, (a.factor + b.factor) * worldScale * 0.11));
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      context.restore();
    }

    const selectedAtom = structure.atoms[selectedAtomIndex];
    if (display.symmetry && selectedAtom) {
      const source = project(fractToCart(selectedAtom.source.fract, structure.cell));
      const target = project(selectedAtom.cart);
      context.save();
      context.strokeStyle = "rgba(105, 231, 255, .78)";
      context.fillStyle = "#69e7ff";
      context.lineWidth = 1.5;
      context.setLineDash([5, 5]);
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.stroke();
      context.setLineDash([]);
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      context.beginPath();
      context.moveTo(target.x, target.y);
      context.lineTo(target.x - 9 * Math.cos(angle - 0.45), target.y - 9 * Math.sin(angle - 0.45));
      context.lineTo(target.x - 9 * Math.cos(angle + 0.45), target.y - 9 * Math.sin(angle + 0.45));
      context.closePath();
      context.fill();
      if (Math.hypot(target.x - source.x, target.y - source.y) > 30) {
        context.font = "600 11px ui-monospace, monospace";
        context.fillText(`g${selectedOperation.id}`, (source.x + target.x) / 2 + 5, (source.y + target.y) / 2 - 5);
      }
      context.restore();
    }

    const atoms = structure.atoms.map((atom, index) => ({ atom, index, projection: project(atom.cart) }))
      .sort((a, b) => a.projection.depth - b.projection.depth);
    const hitTargets: ProjectedAtom[] = [];
    if (display.atoms) {
      for (const { atom, index, projection } of atoms) {
        const style = elementStyle(atom.element);
        const radius = Math.max(6, Math.min(21, style.radius * projection.factor * worldScale * 1.3));
        hitTargets.push({ index, x: projection.x, y: projection.y, radius: radius + 5, depth: projection.depth });
        const gradient = context.createRadialGradient(
          projection.x - radius * 0.34,
          projection.y - radius * 0.38,
          radius * 0.08,
          projection.x,
          projection.y,
          radius,
        );
        gradient.addColorStop(0, "#ffffff");
        gradient.addColorStop(0.18, style.color);
        gradient.addColorStop(1, "#111827");
        context.fillStyle = gradient;
        context.shadowColor = `${style.color}88`;
        context.shadowBlur = index === selectedAtomIndex ? 19 : 8;
        context.beginPath();
        context.arc(projection.x, projection.y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = index === selectedAtomIndex ? "#ffffff" : "rgba(255,255,255,.28)";
        context.lineWidth = index === selectedAtomIndex ? 2.2 : 0.7;
        context.stroke();

        if (display.labels && structure.atoms.length <= 120) {
          context.fillStyle = index === selectedAtomIndex ? "#ffffff" : "rgba(219, 232, 244, .82)";
          context.font = `${index === selectedAtomIndex ? 650 : 500} 10px ui-monospace, monospace`;
          context.fillText(atom.label, projection.x + radius + 4, projection.y - radius - 1);
        }
      }
    }
    projectedAtoms.current = hitTargets;

    const axesOrigin = { x: width - 54, y: height - 48 };
    const axes: Array<{ vector: Vec3; color: string; label: string }> = [
      { vector: [1, 0, 0], color: "#ff647c", label: "a" },
      { vector: [0, 1, 0], color: "#65df91", label: "b" },
      { vector: normalize(cVector), color: "#5db5ff", label: "c" },
    ];
    for (const axis of axes) {
      const rotated = rotate(vectorAdd(center, vectorScale(axis.vector, maxCell * 0.35)));
      const length = 25;
      const norm = Math.hypot(rotated[0], rotated[1]) || 1;
      const x = axesOrigin.x + (rotated[0] / norm) * length;
      const y = axesOrigin.y - (rotated[1] / norm) * length;
      context.strokeStyle = axis.color;
      context.fillStyle = axis.color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(axesOrigin.x, axesOrigin.y);
      context.lineTo(x, y);
      context.stroke();
      context.font = "600 10px ui-monospace, monospace";
      context.fillText(axis.label, x + 3, y - 2);
    }
  }, [structure, display, selectedAtomIndex, selectedOperation, orthographic, viewVersion]);

  useEffect(() => {
    const resize = new ResizeObserver(() => redraw());
    if (canvasRef.current) resize.observe(canvasRef.current);
    return () => resize.disconnect();
  }, [redraw]);

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { active: true, x: event.clientX, y: event.clientY, moved: 0 };
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current.active) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);
    rotation.current.yaw += dx * 0.008;
    rotation.current.pitch = Math.max(-1.45, Math.min(1.45, rotation.current.pitch + dy * 0.008));
    redraw();
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (drag.current.moved < 5) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const target = [...projectedAtoms.current]
        .sort((a, b) => b.depth - a.depth)
        .find((atom) => Math.hypot(atom.x - x, atom.y - y) <= atom.radius);
      if (target) onSelectAtom(target.index);
    }
    drag.current.active = false;
  }

  function resetView() {
    rotation.current = { yaw: -0.62, pitch: 0.48 };
    zoom.current = 1;
    redraw();
  }

  return (
    <div className="viewer-stage">
      <canvas
        ref={canvasRef}
        className="crystal-canvas"
        aria-label="可旋转的晶体结构三维视图；拖拽旋转，滚轮缩放，点击选择原子"
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { drag.current.active = false; }}
        onWheel={(event) => {
          event.preventDefault();
          zoom.current = Math.max(0.58, Math.min(2.2, zoom.current * (event.deltaY > 0 ? 0.92 : 1.08)));
          redraw();
        }}
      />
      <div className="canvas-topbar">
        <div className="view-chip"><span className="live-dot" /> 交互晶胞</div>
        <div className="canvas-actions">
          <button type="button" className={!orthographic ? "active" : ""} onClick={() => setOrthographic(false)}>透视</button>
          <button type="button" className={orthographic ? "active" : ""} onClick={() => setOrthographic(true)}>正交</button>
          <button type="button" onClick={resetView} aria-label="复位视图">↺</button>
        </div>
      </div>
      <div className="gesture-hint">拖拽旋转 · 滚轮缩放 · 点击原子</div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" className="toggle-row" role="switch" aria-checked={checked} onClick={onChange}>
      <span><strong>{label}</strong><small>{hint}</small></span>
      <i className={checked ? "toggle on" : "toggle"}><b /></i>
    </button>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{unit && <small>{unit}</small>}</div>;
}

export default function Home() {
  const [structure, setStructure] = useState<CrystalStructure>(() => parseCif(DEFAULT_CIF));
  const [fileName, setFileName] = useState("alpha-quartz.cif");
  const [display, setDisplay] = useState(defaultDisplay);
  const [selectedAtomIndex, setSelectedAtomIndex] = useState(0);
  const [selectedOperationId, setSelectedOperationId] = useState(1);
  const [rightTab, setRightTab] = useState<"operations" | "atoms" | "wyckoff">("operations");
  const [operationFilter, setOperationFilter] = useState("all");
  const [notice, setNotice] = useState("示例 CIF 已载入：α-石英");
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedAtom = structure.atoms[Math.min(selectedAtomIndex, structure.atoms.length - 1)];
  const selectedOperation = structure.operations.find((operation) => operation.id === selectedOperationId) ?? structure.operations[0];

  const filteredOperations = useMemo(() => {
    if (operationFilter === "all") return structure.operations;
    if (operationFilter === "rotation") return structure.operations.filter((operation) => ["rotation", "screw"].includes(operation.kind));
    if (operationFilter === "reflection") return structure.operations.filter((operation) => ["mirror", "glide", "inversion", "rotoinversion"].includes(operation.kind));
    return structure.operations;
  }, [structure, operationFilter]);

  const composition = useMemo(() => {
    const counts = new Map<string, number>();
    structure.atoms.forEach((atom) => counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1));
    return [...counts.entries()];
  }, [structure]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function loadFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".cif")) {
      setNotice("请选择 .cif 格式的晶体结构文件");
      return;
    }
    try {
      const text = await file.text();
      const next = parseCif(text);
      setStructure(next);
      setFileName(file.name);
      setSelectedAtomIndex(0);
      setSelectedOperationId(next.operations[0]?.id ?? 1);
      setNotice(`已解析 ${next.atoms.length} 个等价原子与 ${next.operations.length} 个对称操作`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "CIF 解析失败，请检查文件格式");
    }
  }

  function selectOperation(operation: SymmetryOperation) {
    setSelectedOperationId(operation.id);
    const matchingAtom = structure.atoms.findIndex((atom) => atom.operationIds.includes(operation.id));
    if (matchingAtom >= 0) setSelectedAtomIndex(matchingAtom);
  }

  function selectAtom(index: number) {
    setSelectedAtomIndex(index);
    setSelectedOperationId(structure.atoms[index].operationIds[0] ?? 1);
  }

  function toggleDisplay(key: keyof DisplaySettings) {
    setDisplay((current) => ({ ...current, [key]: !current[key] }));
  }

  function exportReport() {
    const report = {
      structure: structure.name,
      formula: structure.formula,
      spaceGroup: { symbol: structure.spaceGroup, number: structure.spaceGroupNumber },
      pointGroup: structure.pointGroup,
      crystalSystem: structure.crystalSystem,
      unitCell: structure.cell,
      asymmetricSites: structure.sites,
      symmetryOperations: structure.operations.map(({ id, xyz, kind, name }) => ({ id, xyz, kind, name })),
      generatedAtoms: structure.atoms.map(({ label, element, fract, source, operationIds }) => ({ label, element, fract, source: source.label, operationIds })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName.replace(/\.cif$/i, "")}-symmetry-report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("对称性报告已导出");
  }

  const transformedSelected = selectedAtom ? applyOperation(selectedOperation, selectedAtom.source.fract) : [0, 0, 0] as Vec3;
  const completion = structure.operations.length ? Math.round(((selectedOperation.id) / structure.operations.length) * 100) : 0;

  return (
    <main
      className={dragActive ? "app-shell dragging" : "app-shell"}
      onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files[0];
        if (file) loadFile(file);
      }}
    >
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark"><i /><b /><em /></span>
          <div><strong>SYM<span>VIZ</span></strong><small>CRYSTAL SYMMETRY EXPLORER</small></div>
        </div>
        <div className="header-structure">
          <span className="file-status">CIF</span>
          <div><strong>{structure.name}</strong><small>{fileName}</small></div>
        </div>
        <div className="header-actions">
          <button type="button" className="ghost-button" onClick={exportReport}>⇩ 导出报告</button>
          <button type="button" className="primary-button" onClick={() => inputRef.current?.click()}>＋ 打开 CIF</button>
          <input ref={inputRef} type="file" accept=".cif,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.target.value = ""; }} />
        </div>
      </header>

      <aside className="left-panel panel-scroll">
        <section className="upload-card" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") inputRef.current?.click(); }}>
          <div className="upload-icon">⌁</div>
          <div><strong>载入新的 CIF</strong><small>拖放文件，或点击浏览</small></div>
          <span>⌘O</span>
        </section>

        <section className="side-section">
          <div className="section-heading"><span>结构概览</span><small>ASYMMETRIC UNIT</small></div>
          <div className="formula-card">
            <div><span>化学式</span><strong>{structure.formula}</strong></div>
            <div className="composition-dots">
              {composition.map(([element, count]) => <span key={element} style={{ "--element-color": elementStyle(element).color } as React.CSSProperties}><i />{element}<small>{count}</small></span>)}
            </div>
          </div>
          <div className="cell-grid">
            <Metric label="a" value={structure.cell.a.toFixed(3)} unit="Å" />
            <Metric label="b" value={structure.cell.b.toFixed(3)} unit="Å" />
            <Metric label="c" value={structure.cell.c.toFixed(3)} unit="Å" />
            <Metric label="α" value={structure.cell.alpha.toFixed(1)} unit="°" />
            <Metric label="β" value={structure.cell.beta.toFixed(1)} unit="°" />
            <Metric label="γ" value={structure.cell.gamma.toFixed(1)} unit="°" />
          </div>
        </section>

        <section className="side-section display-section">
          <div className="section-heading"><span>显示控制</span><small>VIEW LAYERS</small></div>
          <Toggle label="原子球" hint={`${structure.atoms.length} 个等价原子`} checked={display.atoms} onChange={() => toggleDisplay("atoms")} />
          <Toggle label="化学键" hint={`${structure.bonds.length} 组近邻`} checked={display.bonds} onChange={() => toggleDisplay("bonds")} />
          <Toggle label="晶胞边界" hint="1 × 1 × 1" checked={display.cell} onChange={() => toggleDisplay("cell")} />
          <Toggle label="原子标签" hint="元素与编号" checked={display.labels} onChange={() => toggleDisplay("labels")} />
          <Toggle label="对称元素" hint="轴 / 面 / 映射轨迹" checked={display.symmetry} onChange={() => toggleDisplay("symmetry")} />
        </section>

        <section className="side-section source-section">
          <div className="section-heading"><span>数据完整性</span><small>PARSE STATUS</small></div>
          <div className="status-line good"><i>✓</i><span>晶胞参数</span><strong>完整</strong></div>
          <div className="status-line good"><i>✓</i><span>分数坐标</span><strong>{structure.sites.length} 位点</strong></div>
          <div className={structure.warnings.length ? "status-line warn" : "status-line good"}><i>{structure.warnings.length ? "!" : "✓"}</i><span>对称操作</span><strong>{structure.operations.length} 项</strong></div>
        </section>
      </aside>

      <section className="workspace">
        <div className="workspace-toolbar">
          <div className="mode-tabs"><button type="button" className="active">结构 + 对称</button><button type="button">操作轨迹</button></div>
          <div className="workspace-stats"><span><i />{structure.atoms.length} 原子</span><span>{structure.bonds.length} 键</span><span>晶胞 1×1×1</span></div>
        </div>
        <CrystalCanvas
          structure={structure}
          display={display}
          selectedAtomIndex={selectedAtomIndex}
          selectedOperation={selectedOperation}
          onSelectAtom={selectAtom}
        />

        <div className="symmetry-story">
          <div className="story-title">
            <div><span className="eyebrow">SYMMETRY MAPPING</span><strong>从不对称位点到等价原子</strong></div>
            <span className="story-count">g{String(selectedOperation.id).padStart(2, "0")} / {String(structure.operations.length).padStart(2, "0")}</span>
          </div>
          <div className="mapping-row">
            <div className="mapping-node source"><span>源位点</span><strong>{selectedAtom?.source.label}</strong><small>{selectedAtom ? coordinateText(selectedAtom.source.fract) : "—"}</small></div>
            <div className="mapping-operation">
              <span>{selectedOperation.label}</span>
              <div><i style={{ width: `${completion}%` }} /></div>
              <small>{selectedOperation.xyz}</small>
            </div>
            <div className="mapping-node target"><span>等价原子</span><strong>{selectedAtom?.label}</strong><small>{coordinateText(transformedSelected as Vec3)}</small></div>
          </div>
        </div>
      </section>

      <aside className="right-panel">
        <section className="group-hero">
          <div className="group-topline"><span>空间群</span><small>INTERNATIONAL TABLES</small></div>
          <div className="group-symbol"><strong>{prettyGroup(structure.spaceGroup)}</strong>{structure.spaceGroupNumber && <sup>#{structure.spaceGroupNumber}</sup>}</div>
          <div className="group-metadata">
            <div><span>点群</span><strong>{structure.pointGroup}</strong></div>
            <div><span>晶系</span><strong>{structure.crystalSystem.replace("晶系", "")}</strong></div>
            <div><span>操作数</span><strong>{structure.operations.length}</strong></div>
          </div>
        </section>

        <nav className="right-tabs" aria-label="对称性信息">
          <button type="button" className={rightTab === "operations" ? "active" : ""} onClick={() => setRightTab("operations")}>对称操作</button>
          <button type="button" className={rightTab === "atoms" ? "active" : ""} onClick={() => setRightTab("atoms")}>原子轨迹</button>
          <button type="button" className={rightTab === "wyckoff" ? "active" : ""} onClick={() => setRightTab("wyckoff")}>Wyckoff</button>
        </nav>

        {rightTab === "operations" && <div className="right-content panel-scroll">
          <div className="filter-row">
            {[['all', '全部'], ['rotation', '旋转'], ['reflection', '反射 / 反演']].map(([value, label]) => (
              <button key={value} type="button" className={operationFilter === value ? "active" : ""} onClick={() => setOperationFilter(value)}>{label}</button>
            ))}
          </div>
          <div className="operation-list">
            {filteredOperations.map((operation) => (
              <button
                type="button"
                key={operation.id}
                className={selectedOperation.id === operation.id ? "operation-row active" : "operation-row"}
                onClick={() => selectOperation(operation)}
              >
                <span className={`operation-symbol ${operation.kind}`}>{operation.label}</span>
                <span className="operation-copy"><strong>g{String(operation.id).padStart(2, "0")} · {operation.name}</strong><code>{operation.xyz}</code></span>
                <span className="operation-kind">{operationKindLabel(operation.kind)}</span>
              </button>
            ))}
          </div>
          {selectedAtom && <div className="selected-detail">
            <div className="detail-head"><span style={{ "--atom-color": elementStyle(selectedAtom.element).color } as React.CSSProperties}><i />{selectedAtom.label}</span><small>当前映射</small></div>
            <div className="equation">
              <code>{coordinateText(selectedAtom.source.fract)}</code><b>— g{selectedOperation.id} →</b><code>{coordinateText(transformedSelected as Vec3)}</code>
            </div>
            <div className="detail-grid">
              <span>母位点<strong>{selectedAtom.source.label}</strong></span>
              <span>Wyckoff<strong>{selectedAtom.source.multiplicity ?? "?"}{selectedAtom.source.wyckoff}</strong></span>
              <span>占有率<strong>{selectedAtom.source.occupancy.toFixed(2)}</strong></span>
            </div>
          </div>}
        </div>}

        {rightTab === "atoms" && <div className="right-content panel-scroll atom-trace-list">
          <div className="trace-intro"><span>点击任一原子</span><p>查看它从不对称单元中的哪个位点、经由哪项操作生成。</p></div>
          {structure.atoms.slice(0, 240).map((atom, index) => (
            <button type="button" key={atom.id} className={selectedAtomIndex === index ? "atom-row active" : "atom-row"} onClick={() => selectAtom(index)}>
              <span className="atom-swatch" style={{ "--atom-color": elementStyle(atom.element).color } as React.CSSProperties}>{atom.element}</span>
              <span><strong>{atom.label}</strong><small>{coordinateText(atom.fract)}</small></span>
              <em>g{atom.operationIds[0]}</em>
            </button>
          ))}
        </div>}

        {rightTab === "wyckoff" && <div className="right-content panel-scroll wyckoff-list">
          <div className="trace-intro"><span>{structure.sites.length} 个不对称位点</span><p>每张卡片显示位点多重性、字母、占有率与坐标。</p></div>
          {structure.sites.map((site) => {
            const generated = structure.atoms.filter((atom) => atom.source.label === site.label).length;
            return <button type="button" className="wyckoff-card" key={site.label} onClick={() => {
              const index = structure.atoms.findIndex((atom) => atom.source.label === site.label);
              if (index >= 0) selectAtom(index);
            }}>
              <span className="wyckoff-letter">{site.wyckoff}</span>
              <span><strong>{site.label} · {site.element}</strong><small>{coordinateText(site.fract)}</small></span>
              <span className="wyckoff-count"><strong>{site.multiplicity ?? generated}</strong><small>等价位</small></span>
            </button>;
          })}
        </div>}
      </aside>

      {dragActive && <div className="drop-overlay"><div><span>⇣</span><strong>释放以解析 CIF</strong><small>文件只在本机浏览器中处理</small></div></div>}
      {notice && <div className="toast"><i>✓</i><span>{notice}</span></div>}
      {structure.warnings.length > 0 && <div className="warning-ribbon">{structure.warnings[0]}</div>}
    </main>
  );
}
