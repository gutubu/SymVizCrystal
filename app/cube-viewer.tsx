"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Vec3 } from "./crystal-data";
import { buildCubeIsosurface, inferCubeBonds, type CubeData } from "./gaussian-tools";

type Quaternion = [number, number, number, number];

function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function quaternionFromAxis(axis: Vec3, angle: number): Quaternion {
  const half = angle / 2;
  const sine = Math.sin(half);
  return [Math.cos(half), axis[0] * sine, axis[1] * sine, axis[2] * sine];
}

function normalizeQuaternion(value: Quaternion): Quaternion {
  const length = Math.hypot(...value) || 1;
  return value.map((item) => item / length) as Quaternion;
}

function rotateByQuaternion(vector: Vec3, quaternion: Quaternion): Vec3 {
  const [w, x, y, z] = quaternion;
  const [vx, vy, vz] = vector;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

function initialViewQuaternion(): Quaternion {
  return normalizeQuaternion(quaternionMultiply(
    quaternionFromAxis([1, 0, 0], -0.52),
    quaternionFromAxis([0, 1, 0], 0.68),
  ));
}

function atomColor(atomicNumber: number) {
  return {
    1: "#f5f7fa",
    6: "#4f5c6b",
    7: "#4776e6",
    8: "#f14f69",
    9: "#56b86a",
    15: "#f29a38",
    16: "#e3c447",
    17: "#42ad68",
  }[atomicNumber] ?? "#8a95a4";
}

export function CubeSurfaceCanvas({
  cube,
  isovalue,
  showPositive,
  showNegative,
  showBonds = true,
  smoothSurface = true,
  language,
}: {
  cube: CubeData;
  isovalue: number;
  showPositive: boolean;
  showNegative: boolean;
  showBonds?: boolean;
  smoothSurface?: boolean;
  language: "zh-CN" | "en-US";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = useRef<Quaternion>(initialViewQuaternion());
  const drag = useRef({ active: false, x: 0, y: 0 });
  const zoom = useRef(1);
  const mesh = useMemo(
    () => buildCubeIsosurface(
      cube,
      Math.max(1e-8, Math.abs(isovalue)),
      showPositive,
      showNegative,
      smoothSurface ? 1_200_000 : 45_000,
    ),
    [cube, isovalue, showPositive, showNegative, smoothSurface],
  );
  const bonds = useMemo(() => inferCubeBonds(cube), [cube]);
  const bounds = useMemo(() => {
    const points = [
      ...cube.atoms.map((atom) => atom.position),
      ...mesh.triangles.flatMap((triangle) => [triangle.a, triangle.b, triangle.c]),
    ];
    if (!points.length) return { center: [0, 0, 0] as Vec3, radius: 1 };
    const minimum: Vec3 = [Infinity, Infinity, Infinity];
    const maximum: Vec3 = [-Infinity, -Infinity, -Infinity];
    points.forEach((point) => point.forEach((value, axis) => {
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
    }));
    const center = minimum.map((value, axis) => (value + maximum[axis]) / 2) as Vec3;
    let radius = 1e-6;
    for (const point of points) {
      radius = Math.max(radius, Math.hypot(
        point[0] - center[0], point[1] - center[1], point[2] - center[2],
      ));
    }
    return { center, radius };
  }, [cube, mesh]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width, height) * 0.39 / bounds.radius * zoom.current;
    const project = (point: Vec3) => {
      const relative: Vec3 = [point[0] - bounds.center[0], point[1] - bounds.center[1], point[2] - bounds.center[2]];
      const rotated = rotateByQuaternion(relative, rotation.current);
      return { x: width / 2 + rotated[0] * scale, y: height / 2 - rotated[1] * scale, depth: rotated[2] };
    };
    mesh.triangles.map((triangle) => {
      const a = project(triangle.a);
      const b = project(triangle.b);
      const c = project(triangle.c);
      return { ...triangle, a, b, c, depth: (a.depth + b.depth + c.depth) / 3 };
    }).sort((a, b) => a.depth - b.depth).forEach((triangle) => {
      context.beginPath();
      context.moveTo(triangle.a.x, triangle.a.y);
      context.lineTo(triangle.b.x, triangle.b.y);
      context.lineTo(triangle.c.x, triangle.c.y);
      context.closePath();
      const surfaceColor = triangle.sign > 0 ? "rgba(42, 111, 176, .38)" : "rgba(217, 82, 66, .34)";
      context.fillStyle = surfaceColor;
      context.strokeStyle = triangle.sign > 0 ? "rgba(34, 90, 145, .42)" : "rgba(169, 58, 47, .38)";
      context.lineWidth = 0.45;
      context.fill();
      if (!smoothSurface) context.stroke();
    });
    if (showBonds) {
      context.lineCap = "round";
      bonds.map((bond) => {
        const a = project(cube.atoms[bond.a].position);
        const b = project(cube.atoms[bond.b].position);
        return { bond, a, b, depth: (a.depth + b.depth) / 2 };
      }).sort((a, b) => a.depth - b.depth).forEach(({ bond, a, b }) => {
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.strokeStyle = "rgba(255, 255, 255, .9)";
        context.lineWidth = 5.2;
        context.stroke();
        const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, atomColor(cube.atoms[bond.a].atomicNumber));
        gradient.addColorStop(0.48, atomColor(cube.atoms[bond.a].atomicNumber));
        gradient.addColorStop(0.52, atomColor(cube.atoms[bond.b].atomicNumber));
        gradient.addColorStop(1, atomColor(cube.atoms[bond.b].atomicNumber));
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.strokeStyle = gradient;
        context.lineWidth = 3.2;
        context.stroke();
      });
    }
    cube.atoms.map((atom) => ({ atom, projection: project(atom.position) }))
      .sort((a, b) => a.projection.depth - b.projection.depth)
      .forEach(({ atom, projection }) => {
        const radius = Math.max(2.4, Math.min(6.5, 3.4 + atom.atomicNumber ** (1 / 3) * 0.42));
        context.beginPath();
        context.arc(projection.x, projection.y, radius, 0, Math.PI * 2);
        context.fillStyle = atomColor(atom.atomicNumber);
        context.strokeStyle = atom.atomicNumber === 1 ? "#aab4bf" : "rgba(42, 49, 58, .65)";
        context.lineWidth = 0.9;
        context.fill();
        context.stroke();
      });
    context.fillStyle = "#5e6874";
    context.font = "12px Segoe UI, sans-serif";
    context.fillText(
      language === "en-US"
        ? `Drag to rotate · wheel to zoom · ${showBonds ? `${bonds.length} inferred bonds · ` : ""}${mesh.triangles.length.toLocaleString()} triangles`
        : `拖拽旋转 · 滚轮缩放 · ${showBonds ? `${bonds.length} 条推断键 · ` : ""}${mesh.triangles.length.toLocaleString()} 个三角面`,
      12,
      height - 12,
    );
  }, [bonds, bounds, cube, language, mesh, showBonds, smoothSurface]);

  useEffect(() => {
    redraw();
    const resize = new ResizeObserver(redraw);
    if (canvasRef.current) resize.observe(canvasRef.current);
    return () => resize.disconnect();
  }, [redraw]);

  return <div className="cube-canvas-shell">
    <canvas
      ref={canvasRef}
      className="cube-surface-canvas"
      aria-label={language === "en-US" ? "Cube isosurface viewer" : "Cube 等值面查看器"}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { active: true, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (!drag.current.active) return;
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        drag.current = { active: true, x: event.clientX, y: event.clientY };
        const yaw = quaternionFromAxis([0, 1, 0], dx * 0.008);
        const pitch = quaternionFromAxis([1, 0, 0], dy * 0.008);
        rotation.current = normalizeQuaternion(quaternionMultiply(pitch, quaternionMultiply(yaw, rotation.current)));
        redraw();
      }}
      onPointerUp={() => { drag.current.active = false; }}
      onPointerCancel={() => { drag.current.active = false; }}
      onWheel={(event) => {
        event.preventDefault();
        zoom.current = Math.min(3.5, Math.max(0.35, zoom.current * Math.exp(-event.deltaY * 0.001)));
        redraw();
      }}
    />
    <div className="cube-legend">
      {showPositive && <span><i className="positive" />+{Math.abs(isovalue).toExponential(2)}</span>}
      {showNegative && <span><i className="negative" />−{Math.abs(isovalue).toExponential(2)}</span>}
      {showBonds && <small>{language === "en-US" ? `${bonds.length} inferred bonds` : `${bonds.length} 条推断键`}</small>}
      {smoothSurface && <small>{language === "en-US" ? "smooth full-grid surface" : "平滑完整网格"}</small>}
      {mesh.stride > 1 && <small>{language === "en-US" ? `preview stride ${mesh.stride}` : `预览步长 ${mesh.stride}`}</small>}
    </div>
  </div>;
}
