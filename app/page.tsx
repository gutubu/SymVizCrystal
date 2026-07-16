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
  hillElementOrder,
  latticeVectors,
  molecularDisplayFracts,
  operationKindLabel,
  parseCif,
} from "./crystal-data";

type DisplaySettings = {
  atoms: boolean;
  bonds: boolean;
  cell: boolean;
  labels: boolean;
  symmetry: boolean;
  completeMolecules: boolean;
};

type ProjectedAtom = { index: number; x: number; y: number; radius: number; depth: number };
type AtomFocusMode = "none" | "fade" | "isolate";
type AtomFocus = { mode: AtomFocusMode; sourceLabel: string | null };
type AtomContextMenu = { x: number; y: number; atomIndex: number };

const defaultDisplay: DisplaySettings = {
  atoms: true,
  bonds: true,
  cell: true,
  labels: true,
  symmetry: true,
  completeMolecules: true,
};

function prettyGroup(value: string) {
  const subscript: Record<string, string> = { "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆" };
  return value.replace(/\b([2346])([1-6])\b/g, (_, axis: string, screw: string) => `${axis}${subscript[screw]}`);
}

function coordinateText(value: Vec3) {
  return `(${value.map(formatFractional).join(", ")})`;
}

function decimalCoordinateText(value: Vec3) {
  return `(${value.map((coordinate) => coordinate.toFixed(4)).join(", ")})`;
}

function operationTitle(operation: SymmetryOperation) {
  return `操作 ${operation.id}（${operation.name}）`;
}

function parseCoordinateInput(value: string) {
  const normalized = value.trim().replace(/−/g, "-");
  const fraction = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\/\s*(\d+(?:\.\d*)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : Number.NaN;
  }
  return Number(normalized);
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

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function shadeHex(color: string, strength = 0.2) {
  const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!match) return color;
  const channels = match.slice(1).map((value) => Math.round(Number.parseInt(value, 16) * (1 - strength)));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
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
  const direction = normalize(candidates.sort((a, b) => score(a) - score(b))[0] ?? [0, 0, 1]);
  const firstNonZero = direction.find((value) => Math.abs(value) > 1e-6) ?? 1;
  return firstNonZero < 0 ? vectorScale(direction, -1) : direction;
}

function findSymmetryAxisOrigin(operation: SymmetryOperation, axisFract: Vec3, structure: CrystalStructure): Vec3 {
  const axisCart = normalize(fractToCart(axisFract, structure.cell));
  let best: { point: Vec3; score: number } = { point: [0.5, 0.5, 0.5], score: Number.POSITIVE_INFINITY };
  const divisions = 12;

  for (let ix = 0; ix <= divisions; ix += 1) {
    for (let iy = 0; iy <= divisions; iy += 1) {
      for (let iz = 0; iz <= divisions; iz += 1) {
        const point: Vec3 = [ix / divisions, iy / divisions, iz / divisions];
        const rotated = operation.matrix.map((row, rowIndex) => (
          row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + operation.translation[rowIndex] - point[rowIndex]
        )) as Vec3;
        let residual = Number.POSITIVE_INFINITY;
        for (let nx = -1; nx <= 1; nx += 1) {
          for (let ny = -1; ny <= 1; ny += 1) {
            for (let nz = -1; nz <= 1; nz += 1) {
              const displacement = fractToCart([rotated[0] + nx, rotated[1] + ny, rotated[2] + nz], structure.cell);
              const alongAxis = vectorScale(axisCart, dot(displacement, axisCart));
              residual = Math.min(residual, vectorLength(vectorAdd(displacement, vectorScale(alongAxis, -1))));
            }
          }
        }
        const centerBias = Math.hypot(point[0] - 0.5, point[1] - 0.5, point[2] - 0.5) * 1e-4;
        const score = residual + centerBias;
        if (score < best.score) best = { point, score };
      }
    }
  }
  return best.point;
}

function screwTranslationText(operation: SymmetryOperation, axisFract: Vec3) {
  const denominator = Math.max(2, operation.order);
  const axisLengthSquared = dot(axisFract, axisFract) || 1;
  const axial = ((dot(operation.translation, axisFract) / axisLengthSquared) % 1 + 1) % 1;
  const numerator = Math.max(1, Math.round(axial * denominator));
  return `${numerator}/${denominator}`;
}

function CrystalCanvas({
  structure,
  display,
  selectedAtomIndex,
  selectedOperation,
  atomFocus,
  onSelectAtom,
  onRequestContextMenu,
  onClearAtomFocus,
}: {
  structure: CrystalStructure;
  display: DisplaySettings;
  selectedAtomIndex: number;
  selectedOperation: SymmetryOperation;
  atomFocus: AtomFocus;
  onSelectAtom: (index: number) => void;
  onRequestContextMenu: (menu: AtomContextMenu) => void;
  onClearAtomFocus: () => void;
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

    const displayFracts = display.completeMolecules
      ? molecularDisplayFracts(structure.atoms, structure.bonds)
      : structure.atoms.map((atom) => atom.fract);
    const displayCarts = displayFracts.map((fract) => fractToCart(fract, structure.cell));

    const fractionalCorners: Vec3[] = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];
    const corners: Vec3[] = fractionalCorners.map((fract) => fractToCart(fract, structure.cell));
    const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

    if (display.cell) {
      context.save();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(71, 85, 105, .34)";
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
        const axisOrigin = fractToCart(findSymmetryAxisOrigin(selectedOperation, axisFract, structure), structure.cell);
        const span = maxCell * 0.72;
        const a = project(vectorAdd(axisOrigin, vectorScale(axisCart, -span)));
        const b = project(vectorAdd(axisOrigin, vectorScale(axisCart, span)));
        context.strokeStyle = "rgba(168, 105, 18, .62)";
        context.lineWidth = 1.4;
        context.setLineDash([6, 5]);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
        context.setLineDash([]);

        if (selectedOperation.kind === "screw") {
          const helper: Vec3 = Math.abs(axisCart[2]) < 0.82 ? [0, 0, 1] : [0, 1, 0];
          const u = normalize(cross(axisCart, helper));
          const v = normalize(cross(axisCart, u));
          const radius = maxCell * 0.055;
          const turns = Math.max(1.6, selectedOperation.order * 0.82);
          const helixPoints = Array.from({ length: 97 }, (_, index) => {
            const t = index / 96;
            const angle = t * Math.PI * 2 * turns;
            const axial = vectorScale(axisCart, (t - 0.5) * span * 1.75);
            const radial = vectorAdd(vectorScale(u, Math.cos(angle) * radius), vectorScale(v, Math.sin(angle) * radius));
            return project(vectorAdd(axisOrigin, vectorAdd(axial, radial)));
          });

          context.strokeStyle = "rgba(255, 255, 255, .92)";
          context.lineWidth = 5.5;
          context.lineJoin = "round";
          context.beginPath();
          context.moveTo(helixPoints[0].x, helixPoints[0].y);
          helixPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y));
          context.stroke();
          context.strokeStyle = "#b76f12";
          context.lineWidth = 2.8;
          context.stroke();

          const arrowTip = helixPoints[helixPoints.length - 1];
          const arrowFrom = helixPoints[helixPoints.length - 5];
          const arrowAngle = Math.atan2(arrowTip.y - arrowFrom.y, arrowTip.x - arrowFrom.x);
          context.fillStyle = "#b76f12";
          context.beginPath();
          context.moveTo(arrowTip.x, arrowTip.y);
          context.lineTo(arrowTip.x - 10 * Math.cos(arrowAngle - 0.5), arrowTip.y - 10 * Math.sin(arrowAngle - 0.5));
          context.lineTo(arrowTip.x - 10 * Math.cos(arrowAngle + 0.5), arrowTip.y - 10 * Math.sin(arrowAngle + 0.5));
          context.closePath();
          context.fill();

          const label = `${selectedOperation.label}  ·  旋转 ${Math.round(360 / selectedOperation.order)}°  +  轴向平移 ${screwTranslationText(selectedOperation, axisFract)}`;
          context.font = "600 10px ui-monospace, monospace";
          const labelWidth = context.measureText(label).width + 16;
          const labelX = Math.max(10, Math.min(width - labelWidth - 10, b.x + 10));
          const labelY = Math.max(36, Math.min(height - 30, b.y - 10));
          context.fillStyle = "rgba(255, 250, 240, .96)";
          context.strokeStyle = "rgba(183, 111, 18, .42)";
          context.lineWidth = 1;
          context.beginPath();
          context.roundRect(labelX, labelY - 17, labelWidth, 25, 6);
          context.fill();
          context.stroke();
          context.fillStyle = "#8a5310";
          context.fillText(label, labelX + 8, labelY);
        } else {
          context.fillStyle = "#b7791f";
          context.beginPath();
          context.arc(b.x, b.y, 4, 0, Math.PI * 2);
          context.fill();
        }
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
        context.fillStyle = "rgba(183, 121, 31, .08)";
        context.strokeStyle = "rgba(183, 121, 31, .62)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(plane[0].x, plane[0].y);
        plane.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.closePath();
        context.fill();
        context.stroke();
      } else if (selectedOperation.kind === "inversion") {
        const point = project(center);
        context.strokeStyle = "#b7791f";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(point.x, point.y, 9, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "#b7791f";
        context.beginPath();
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    const matchesFocus = (atom: AtomInstance) => atomFocus.mode === "none" || atom.source.label === atomFocus.sourceLabel;

    if (display.bonds) {
      context.save();
      context.lineCap = "round";
      for (const bond of structure.bonds) {
        const atomA = structure.atoms[bond.a];
        const atomB = structure.atoms[bond.b];
        const focusA = matchesFocus(atomA);
        const focusB = matchesFocus(atomB);
        if (atomFocus.mode === "isolate" && (!focusA || !focusB)) continue;
        const cartA = displayCarts[bond.a];
        const cartB = displayCarts[bond.b];
        const directDistance = Math.hypot(
          cartA[0] - cartB[0], cartA[1] - cartB[1], cartA[2] - cartB[2],
        );
        if (directDistance > bond.distance + 0.25) continue;
        const a = project(cartA);
        const b = project(cartB);
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const lineWidth = Math.max(3.4, Math.min(7, (a.factor + b.factor) * worldScale * 0.13));
        context.globalAlpha = atomFocus.mode === "fade" ? (focusA && focusB ? 1 : focusA || focusB ? 0.42 : 0.07) : 1;
        context.strokeStyle = "rgba(51, 65, 85, .26)";
        context.lineWidth = lineWidth + 1.8;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();

        context.lineWidth = lineWidth;
        context.strokeStyle = shadeHex(elementStyle(atomA.element).color, 0.06);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(midpoint.x, midpoint.y);
        context.stroke();
        context.strokeStyle = shadeHex(elementStyle(atomB.element).color, 0.06);
        context.beginPath();
        context.moveTo(midpoint.x, midpoint.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      context.restore();
    }

    const selectedAtom = structure.atoms[selectedAtomIndex];
    if (display.symmetry && selectedAtom) {
      const source = project(fractToCart(selectedAtom.source.fract, structure.cell));
      const target = project(displayCarts[selectedAtomIndex] ?? selectedAtom.cart);
      context.save();
      context.strokeStyle = "rgba(15, 139, 141, .76)";
      context.fillStyle = "#0f8b8d";
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
        context.fillText(`操作 ${selectedOperation.id}`, (source.x + target.x) / 2 + 5, (source.y + target.y) / 2 - 5);
      }
      context.restore();
    }

    const atoms = structure.atoms.map((atom, index) => ({ atom, index, projection: project(displayCarts[index]) }))
      .sort((a, b) => a.projection.depth - b.projection.depth);
    const hitTargets: ProjectedAtom[] = [];
    if (display.atoms) {
      for (const { atom, index, projection } of atoms) {
        const focused = matchesFocus(atom);
        if (atomFocus.mode === "isolate" && !focused) continue;
        const style = elementStyle(atom.element);
        const radius = Math.max(4.5, Math.min(13.5, style.radius * projection.factor * worldScale * 0.9));
        hitTargets.push({ index, x: projection.x, y: projection.y, radius: radius + 5, depth: projection.depth });
        context.save();
        context.globalAlpha = atomFocus.mode === "fade" && !focused ? 0.12 : 1;
        const gradient = context.createLinearGradient(
          projection.x - radius * 0.45,
          projection.y - radius * 0.55,
          projection.x + radius * 0.55,
          projection.y + radius * 0.6,
        );
        gradient.addColorStop(0, style.color);
        gradient.addColorStop(0.72, shadeHex(style.color, 0.08));
        gradient.addColorStop(1, shadeHex(style.color, 0.24));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(projection.x, projection.y, radius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = index === selectedAtomIndex ? "#08777a" : "rgba(30, 41, 59, .34)";
        context.lineWidth = index === selectedAtomIndex ? 2.4 : 0.85;
        context.stroke();
        if (index === selectedAtomIndex) {
          context.strokeStyle = "rgba(15, 139, 141, .34)";
          context.lineWidth = 2;
          context.beginPath();
          context.arc(projection.x, projection.y, radius + 4, 0, Math.PI * 2);
          context.stroke();
        }

        if (display.labels && structure.atoms.length <= 120) {
          context.fillStyle = index === selectedAtomIndex ? "#0f5f62" : "rgba(51, 65, 85, .82)";
          context.font = `${index === selectedAtomIndex ? 650 : 500} 10px ui-monospace, monospace`;
          context.fillText(atom.label, projection.x + radius + 4, projection.y - radius - 1);
        }
        context.restore();
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
  }, [structure, display, selectedAtomIndex, selectedOperation, atomFocus, orthographic, viewVersion]);

  useEffect(() => {
    const resize = new ResizeObserver(() => redraw());
    if (canvasRef.current) resize.observe(canvasRef.current);
    return () => resize.disconnect();
  }, [redraw]);

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
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

  function atomAt(clientX: number, clientY: number, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return [...projectedAtoms.current]
      .sort((a, b) => b.depth - a.depth)
      .find((atom) => Math.hypot(atom.x - x, atom.y - y) <= atom.radius);
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current.active) return;
    if (drag.current.moved < 5) {
      const target = atomAt(event.clientX, event.clientY, event.currentTarget);
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
        onContextMenu={(event) => {
          event.preventDefault();
          const target = atomAt(event.clientX, event.clientY, event.currentTarget);
          if (!target) return;
          onSelectAtom(target.index);
          onRequestContextMenu({ x: event.clientX, y: event.clientY, atomIndex: target.index });
        }}
        onWheel={(event) => {
          event.preventDefault();
          zoom.current = Math.max(0.58, Math.min(2.2, zoom.current * (event.deltaY > 0 ? 0.92 : 1.08)));
          redraw();
        }}
      />
      <div className="canvas-topbar">
        <div className="canvas-chip-group">
          <div className="view-chip"><span className="live-dot" /> 交互晶胞</div>
          {atomFocus.mode !== "none" && <div className="focus-chip">
            <span>{atomFocus.mode === "fade" ? "聚焦" : "单独显示"} · {atomFocus.sourceLabel}</span>
            <button type="button" onClick={onClearAtomFocus}>恢复全部</button>
          </div>}
        </div>
        <div className="canvas-actions">
          <button type="button" className={!orthographic ? "active" : ""} onClick={() => setOrthographic(false)}>透视</button>
          <button type="button" className={orthographic ? "active" : ""} onClick={() => setOrthographic(true)}>正交</button>
          <button type="button" onClick={resetView} aria-label="复位视图">↺</button>
        </div>
      </div>
      <div className="gesture-hint">拖拽旋转 · 滚轮缩放 · 左键选择 · 右键聚焦</div>
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
  const [rightTab, setRightTab] = useState<"operations" | "atoms" | "wyckoff" | "calculator">("operations");
  const [operationFilter, setOperationFilter] = useState("all");
  const [calculatorInput, setCalculatorInput] = useState<[string, string, string]>(() => {
    const firstSite = structure.sites[0];
    return firstSite ? firstSite.fract.map((value) => value.toFixed(6)) as [string, string, string] : ["0", "0", "0"];
  });
  const [calculatorOperationId, setCalculatorOperationId] = useState(1);
  const [notice, setNotice] = useState("示例 CIF 已载入：α-石英");
  const [dragActive, setDragActive] = useState(false);
  const [atomFocus, setAtomFocus] = useState<AtomFocus>({ mode: "none", sourceLabel: null });
  const [contextMenu, setContextMenu] = useState<AtomContextMenu | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const selectedAtom = structure.atoms[Math.min(selectedAtomIndex, structure.atoms.length - 1)];
  const selectedOperation = structure.operations.find((operation) => operation.id === selectedOperationId) ?? structure.operations[0];
  const calculatorOperation = structure.operations.find((operation) => operation.id === calculatorOperationId) ?? structure.operations[0];

  const filteredOperations = useMemo(() => {
    if (operationFilter === "all") return structure.operations;
    if (operationFilter === "rotation") return structure.operations.filter((operation) => ["rotation", "screw"].includes(operation.kind));
    if (operationFilter === "reflection") return structure.operations.filter((operation) => ["mirror", "glide", "inversion", "rotoinversion"].includes(operation.kind));
    return structure.operations;
  }, [structure, operationFilter]);

  const composition = useMemo(() => {
    const counts = new Map<string, number>();
    structure.atoms.forEach((atom) => counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1));
    return [...counts.entries()].sort(([a], [b]) => hillElementOrder(a, b, counts.has("C")));
  }, [structure]);

  const calculator = useMemo(() => {
    const input = calculatorInput.map(parseCoordinateInput) as Vec3;
    const valid = input.every(Number.isFinite);
    if (!valid) return { valid: false, input, raw: [0, 0, 0] as Vec3, wrapped: [0, 0, 0] as Vec3, matchIndex: -1 };
    const raw = calculatorOperation.matrix.map((row, index) => (
      row[0] * input[0] + row[1] * input[1] + row[2] * input[2] + calculatorOperation.translation[index]
    )) as Vec3;
    const wrapped = applyOperation(calculatorOperation, input);
    let matchIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    structure.atoms.forEach((atom, index) => {
      const distance = Math.hypot(...atom.fract.map((value, axis) => {
        const delta = value - wrapped[axis];
        return delta - Math.round(delta);
      }));
      if (distance < bestDistance) {
        bestDistance = distance;
        matchIndex = index;
      }
    });
    return { valid: true, input, raw, wrapped, matchIndex: bestDistance < 2e-3 ? matchIndex : -1 };
  }, [calculatorInput, calculatorOperation, structure]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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
      setCalculatorOperationId(next.operations[0]?.id ?? 1);
      setCalculatorInput(next.sites[0]
        ? next.sites[0].fract.map((value) => value.toFixed(6)) as [string, string, string]
        : ["0", "0", "0"]);
      setAtomFocus({ mode: "none", sourceLabel: null });
      setContextMenu(null);
      setNotice(`已解析 ${next.atoms.length} 个等价原子与 ${next.operations.length} 个对称操作`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "CIF 解析失败，请检查文件格式");
    }
  }

  function selectOperation(operation: SymmetryOperation) {
    setSelectedOperationId(operation.id);
    setCalculatorOperationId(operation.id);
    const matchingAtom = structure.atoms.findIndex((atom) => atom.operationIds.includes(operation.id));
    if (matchingAtom >= 0) setSelectedAtomIndex(matchingAtom);
  }

  function selectAtom(index: number) {
    setSelectedAtomIndex(index);
    const operationId = structure.atoms[index].operationIds[0] ?? 1;
    setSelectedOperationId(operationId);
    setCalculatorOperationId(operationId);
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
            <div><span>化学式 · 常规 / Hill 顺序</span><strong>{structure.formula}</strong></div>
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
          <Toggle label="原子球（哑光 CPK）" hint={`${structure.atoms.length} 个等价原子`} checked={display.atoms} onChange={() => toggleDisplay("atoms")} />
          <Toggle label="化学键（球棍）" hint={`${structure.bonds.length} 组共价近邻`} checked={display.bonds} onChange={() => toggleDisplay("bonds")} />
          <Toggle label="补全分子片段" hint={display.completeMolecules ? "跨晶胞键已重新拼接" : "当前按晶胞边界截断"} checked={display.completeMolecules} onChange={() => toggleDisplay("completeMolecules")} />
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
          <div className="workspace-stats"><span><i />{structure.atoms.length} 原子</span><span>{structure.bonds.length} 键</span><span>{display.completeMolecules ? "完整分子" : "晶胞截断"}</span></div>
        </div>
        <CrystalCanvas
          structure={structure}
          display={display}
          selectedAtomIndex={selectedAtomIndex}
          selectedOperation={selectedOperation}
          atomFocus={atomFocus}
          onSelectAtom={selectAtom}
          onRequestContextMenu={(menu) => setContextMenu({
            ...menu,
            x: Math.max(10, Math.min(window.innerWidth - 286, menu.x)),
            y: Math.max(10, Math.min(window.innerHeight - 236, menu.y)),
          })}
          onClearAtomFocus={() => setAtomFocus({ mode: "none", sourceLabel: null })}
        />

        <div className="symmetry-story">
          <div className="story-title">
            <div><span className="eyebrow">SYMMETRY MAPPING</span><strong>从不对称位点到等价原子</strong></div>
            <span className="story-count">第 {selectedOperation.id} / {structure.operations.length} 项操作</span>
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
          <button type="button" className={rightTab === "calculator" ? "active" : ""} onClick={() => setRightTab("calculator")}>坐标计算器</button>
        </nav>

        {rightTab === "operations" && <div className="right-content panel-scroll">
          <div className="notation-note"><strong>操作编号</strong><span>这里按 CIF 中的顺序写作“操作 1、操作 2”。群论或程序中也常简写为 gᵢ。</span></div>
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
                <span className="operation-copy"><strong>{operationTitle(operation)}</strong><code>{operation.xyz}</code></span>
                <span className="operation-kind">{operationKindLabel(operation.kind)}</span>
              </button>
            ))}
          </div>
          {selectedAtom && <div className="selected-detail">
            <div className="detail-head"><span style={{ "--atom-color": elementStyle(selectedAtom.element).color } as React.CSSProperties}><i />{selectedAtom.label}</span><small>当前映射</small></div>
            <div className="equation">
              <code>{coordinateText(selectedAtom.source.fract)}</code><b>— 操作 {selectedOperation.id} →</b><code>{coordinateText(transformedSelected as Vec3)}</code>
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
              <em>操作 {atom.operationIds[0]}</em>
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

        {rightTab === "calculator" && <div className="right-content panel-scroll calculator-panel">
          <div className="calculator-intro">
            <span>对称位点计算器</span>
            <p>输入分数坐标 r，逐步验证 r′ = Rr + t，并将结果折回 [0, 1) 晶胞范围。</p>
          </div>

          <label className="calculator-field">
            <span>选择对称操作</span>
            <select value={calculatorOperation.id} onChange={(event) => setCalculatorOperationId(Number(event.target.value))}>
              {structure.operations.map((operation) => <option key={operation.id} value={operation.id}>{operationTitle(operation)} · {operation.xyz}</option>)}
            </select>
          </label>

          <div className="calculator-coordinate-head">
            <span>输入分数坐标 r</span>
            <button type="button" onClick={() => {
              if (!selectedAtom) return;
              setCalculatorInput(selectedAtom.source.fract.map((value) => value.toFixed(6)) as [string, string, string]);
              setCalculatorOperationId(selectedOperation.id);
            }}>填入当前原子</button>
          </div>
          <div className="calculator-inputs">
            {(["x", "y", "z"] as const).map((axis, index) => <label key={axis}>
              <span>{axis}</span>
              <input
                type="text"
                inputMode="decimal"
                value={calculatorInput[index]}
                aria-label={`${axis} 分数坐标`}
                onChange={(event) => setCalculatorInput((current) => current.map((value, axisIndex) => axisIndex === index ? event.target.value : value) as [string, string, string])}
              />
            </label>)}
          </div>

          <div className="calculator-operation-card">
            <div className="calculator-step-head"><i>1</i><span>代入操作表达式</span></div>
            <code>{calculatorOperation.xyz}</code>
            <div className="matrix-equation" aria-label="旋转矩阵和平移向量">
              <span className="matrix-bracket">R</span>
              <span className="matrix-values">{calculatorOperation.matrix.flat().map((value, index) => <b key={index}>{value}</b>)}</span>
              <span className="matrix-plus">+</span>
              <span className="translation-values">{calculatorOperation.translation.map((value, index) => <b key={index}>{value.toFixed(4)}</b>)}</span>
            </div>
          </div>

          {!calculator.valid ? <div className="calculator-invalid">请输入十进制或分数，例如 0.25、1/3、−0.5。</div> : <>
            <div className="calculator-result-row">
              <div><span><i>2</i> 未折回结果</span><code>{decimalCoordinateText(calculator.raw)}</code></div>
              <b>→</b>
              <div className="wrapped"><span><i>3</i> 晶胞内结果</span><code>{decimalCoordinateText(calculator.wrapped)}</code></div>
            </div>
            <div className={calculator.matchIndex >= 0 ? "calculator-match found" : "calculator-match"}>
              <span>匹配晶体中的原子</span>
              {calculator.matchIndex >= 0 ? <>
                <strong>{structure.atoms[calculator.matchIndex].label}</strong>
                <small>母位点 {structure.atoms[calculator.matchIndex].source.label} · {coordinateText(structure.atoms[calculator.matchIndex].fract)}</small>
                <button type="button" onClick={() => {
                  setSelectedAtomIndex(calculator.matchIndex);
                  setSelectedOperationId(calculatorOperation.id);
                  setNotice(`已定位 ${structure.atoms[calculator.matchIndex].label}`);
                }}>在三维视图中定位</button>
              </> : <><strong>未找到</strong><small>当前结果与 CIF 原子位点的容差大于 0.002。</small></>}
            </div>
          </>}
        </div>}
      </aside>

      {dragActive && <div className="drop-overlay"><div><span>⇣</span><strong>释放以解析 CIF</strong><small>文件只在本机浏览器中处理</small></div></div>}
      {contextMenu && structure.atoms[contextMenu.atomIndex] && (() => {
        const atom = structure.atoms[contextMenu.atomIndex];
        return <div
          ref={contextMenuRef}
          className="atom-context-menu"
          role="menu"
          aria-label={`${atom.label} 原子显示选项`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="context-menu-head">
            <span className="atom-swatch" style={{ "--atom-color": elementStyle(atom.element).color } as React.CSSProperties}>{atom.element}</span>
            <span><strong>{atom.label}</strong><small>不对称位点 {atom.source.label}</small></span>
          </div>
          <button type="button" role="menuitem" onClick={() => {
            setAtomFocus({ mode: "fade", sourceLabel: atom.source.label });
            setContextMenu(null);
          }}>
            <span>聚焦该不对称位点</span><small>保留其对称轨道，虚化其它原子</small>
          </button>
          <button type="button" role="menuitem" onClick={() => {
            setAtomFocus({ mode: "isolate", sourceLabel: atom.source.label });
            setContextMenu(null);
          }}>
            <span>仅显示该对称轨道</span><small>隐藏不属于 {atom.source.label} 的原子</small>
          </button>
          <div className="context-menu-divider" />
          <button type="button" role="menuitem" onClick={() => {
            setAtomFocus({ mode: "none", sourceLabel: null });
            setContextMenu(null);
          }}>
            <span>恢复全部原子</span><small>取消聚焦或单独显示</small>
          </button>
        </div>;
      })()}
      {notice && <div className="toast"><i>✓</i><span>{notice}</span></div>}
      {structure.warnings.length > 0 && <div className="warning-ribbon">{structure.warnings[0]}</div>}
    </main>
  );
}
