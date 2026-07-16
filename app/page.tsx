"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CIF,
  type AtomInstance,
  type CrystalStructure,
  type HydrogenBond,
  type HydrogenBondCriteria,
  type SymmetryOperation,
  type Vec3,
  applyOperation,
  elementStyle,
  findHydrogenBonds,
  formatFractional,
  fractToCart,
  hillElementOrder,
  latticeVectors,
  molecularComponentIds,
  molecularDisplayFracts,
  operationKindLabel,
  parseCif,
} from "./crystal-data";

type DisplaySettings = {
  atoms: boolean;
  hydrogens: boolean;
  bonds: boolean;
  hydrogenBonds: boolean;
  cell: boolean;
  labels: boolean;
  symmetry: boolean;
  completeMolecules: boolean;
};

type ProjectedAtom = { index: number; x: number; y: number; radius: number; depth: number };
type Quaternion = [number, number, number, number];
type ViewPreset = "x" | "y" | "z" | "a" | "b" | "c";
type AtomFocusMode = "none" | "fade" | "isolate";
type AtomFocus = { mode: AtomFocusMode; sourceLabel: string | null };
type AtomContextMenu = { x: number; y: number; atomIndex: number };
type ElementAppearance = Record<string, { color: string; scale: number }>;
type AxisFont = "mono" | "sans" | "serif";
type AxisAppearance = { lineWidth: number; length: number; font: AxisFont; fontSize: number };
type AppearanceMenu = { kind: "element"; element: string; x: number; y: number } | { kind: "axis"; x: number; y: number };
type RightTab = "operations" | "atoms" | "wyckoff" | "hydrogen" | "calculator";
type HydrogenPreset = "strict" | "steiner" | "broad";
type HydrogenBondAppearance = { color: string; lineWidth: number };
type SupercellSettings = { a: number; b: number; c: number };
type DisplayAtomInstance = {
  atom: AtomInstance;
  index: number;
  fract: Vec3;
  cart: Vec3;
  translation: Vec3;
  translationKey: string;
};

const defaultDisplay: DisplaySettings = {
  atoms: true,
  hydrogens: true,
  bonds: true,
  hydrogenBonds: true,
  cell: true,
  labels: true,
  symmetry: true,
  completeMolecules: true,
};

const defaultAxisAppearance: AxisAppearance = { lineWidth: 1.5, length: 25, font: "mono", fontSize: 10 };
const hydrogenBondPresets: Record<HydrogenPreset, HydrogenBondCriteria> = {
  strict: {
    maxHydrogenAcceptorDistance: 2.5,
    maxDonorAcceptorDistance: 3.2,
    minDonorHydrogenAcceptorAngle: 150,
    donorElements: ["O", "N", "S"],
    acceptorElements: ["O", "N", "S", "F"],
  },
  steiner: {
    maxHydrogenAcceptorDistance: 3.0,
    maxDonorAcceptorDistance: 3.8,
    minDonorHydrogenAcceptorAngle: 110,
    donorElements: ["O", "N", "S"],
    acceptorElements: ["O", "N", "S", "F", "Cl", "Br", "I"],
  },
  broad: {
    maxHydrogenAcceptorDistance: 3.2,
    maxDonorAcceptorDistance: 4.0,
    minDonorHydrogenAcceptorAngle: 90,
    donorElements: ["O", "N", "S", "C"],
    acceptorElements: ["O", "N", "S", "F", "Cl", "Br", "I"],
  },
};
const defaultHydrogenBondCriteria = hydrogenBondPresets.steiner;
const defaultHydrogenBondAppearance: HydrogenBondAppearance = { color: "#c2185b", lineWidth: 1.8 };
const hydrogenStrengthLabels: Record<HydrogenBond["strength"], string> = { strong: "强", moderate: "中等", weak: "弱" };
const defaultSupercell: SupercellSettings = { a: 1, b: 1, c: 1 };

function supercellText(value: SupercellSettings) {
  const format = (extent: number) => Number.isInteger(extent) ? String(extent) : extent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${format(value.a)} × ${format(value.b)} × ${format(value.c)}`;
}

function isCrystallographicSupercell(value: SupercellSettings) {
  return [value.a, value.b, value.c].every((extent) => Number.isInteger(extent));
}

function buildDisplayAtomInstances(
  structure: CrystalStructure,
  baseDisplayFracts: Vec3[],
  supercell: SupercellSettings,
  completeMolecules: boolean,
) {
  const extents: Vec3 = [supercell.a, supercell.b, supercell.c];
  const results: DisplayAtomInstance[] = [];
  const componentIds = molecularComponentIds(structure.atoms, structure.bonds);
  const components = new Map<number, number[]>();
  componentIds.forEach((componentId, index) => components.set(componentId, [...(components.get(componentId) ?? []), index]));
  const crystallographic = isCrystallographicSupercell(supercell);
  const minimumTranslation = completeMolecules && !crystallographic ? -1 : 0;
  const maximumTranslations = extents.map((extent) => (
    crystallographic ? extent - 1 : completeMolecules ? Math.ceil(extent) : Math.ceil(extent) - 1
  )) as Vec3;

  for (let tx = minimumTranslation; tx <= maximumTranslations[0]; tx += 1) {
    for (let ty = minimumTranslation; ty <= maximumTranslations[1]; ty += 1) {
      for (let tz = minimumTranslation; tz <= maximumTranslations[2]; tz += 1) {
        const translation: Vec3 = [tx, ty, tz];
        const translationKey = translation.join(",");
        if (completeMolecules) {
          components.forEach((indices) => {
            const fracts = indices.map((index) => baseDisplayFracts[index].map((value, axis) => value + translation[axis]) as Vec3);
            const intersects = crystallographic || [0, 1, 2].every((axis) => {
              const values = fracts.map((fract) => fract[axis]);
              return Math.max(...values) >= -1e-7 && Math.min(...values) < extents[axis] - 1e-7;
            });
            if (!intersects) return;
            indices.forEach((index, localIndex) => results.push({
              atom: structure.atoms[index],
              index,
              fract: fracts[localIndex],
              cart: fractToCart(fracts[localIndex], structure.cell),
              translation,
              translationKey,
            }));
          });
        } else {
          structure.atoms.forEach((atom, index) => {
            const fract = baseDisplayFracts[index].map((value, axis) => value + translation[axis]) as Vec3;
            const inside = fract.every((value, axis) => value >= -1e-7 && value < extents[axis] - 1e-7);
            if (!inside) return;
            results.push({ atom, index, fract, cart: fractToCart(fract, structure.cell), translation, translationKey });
          });
        }
      }
    }
  }
  return results;
}
const axisFontFamilies: Record<AxisFont, string> = {
  mono: "ui-monospace, SFMono-Regular, Consolas, monospace",
  sans: '"Segoe UI", "PingFang SC", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

function resolvedElementStyle(element: string, appearance: ElementAppearance) {
  const base = elementStyle(element);
  const custom = appearance[element];
  return { ...base, color: custom?.color ?? base.color, scale: custom?.scale ?? 1 };
}

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

function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function quaternionFromAxis(axis: Vec3, angle: number): Quaternion {
  const unit = normalize(axis);
  const half = angle / 2;
  const sine = Math.sin(half);
  return [Math.cos(half), unit[0] * sine, unit[1] * sine, unit[2] * sine];
}

function normalizeQuaternion(value: Quaternion): Quaternion {
  const length = Math.hypot(...value) || 1;
  return value.map((component) => component / length) as Quaternion;
}

function rotateByQuaternion(vector: Vec3, quaternion: Quaternion): Vec3 {
  const imaginary: Vec3 = [quaternion[1], quaternion[2], quaternion[3]];
  const doubledCross = vectorScale(cross(imaginary, vector), 2);
  return vectorAdd(vector, vectorAdd(vectorScale(doubledCross, quaternion[0]), cross(imaginary, doubledCross)));
}

function initialViewQuaternion() {
  const yaw = quaternionFromAxis([0, 1, 0], -0.62);
  const pitch = quaternionFromAxis([1, 0, 0], 0.48);
  return normalizeQuaternion(quaternionMultiply(yaw, pitch));
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function quaternionFromRotationMatrix(matrix: [Vec3, Vec3, Vec3]): Quaternion {
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  let quaternion: Quaternion;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    quaternion = [
      0.25 * scale,
      (matrix[2][1] - matrix[1][2]) / scale,
      (matrix[0][2] - matrix[2][0]) / scale,
      (matrix[1][0] - matrix[0][1]) / scale,
    ];
  } else if (matrix[0][0] > matrix[1][1] && matrix[0][0] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[0][0] - matrix[1][1] - matrix[2][2]) * 2;
    quaternion = [
      (matrix[2][1] - matrix[1][2]) / scale,
      0.25 * scale,
      (matrix[0][1] + matrix[1][0]) / scale,
      (matrix[0][2] + matrix[2][0]) / scale,
    ];
  } else if (matrix[1][1] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[1][1] - matrix[0][0] - matrix[2][2]) * 2;
    quaternion = [
      (matrix[0][2] - matrix[2][0]) / scale,
      (matrix[0][1] + matrix[1][0]) / scale,
      0.25 * scale,
      (matrix[1][2] + matrix[2][1]) / scale,
    ];
  } else {
    const scale = Math.sqrt(1 + matrix[2][2] - matrix[0][0] - matrix[1][1]) * 2;
    quaternion = [
      (matrix[1][0] - matrix[0][1]) / scale,
      (matrix[0][2] + matrix[2][0]) / scale,
      (matrix[1][2] + matrix[2][1]) / scale,
      0.25 * scale,
    ];
  }
  return normalizeQuaternion(quaternion);
}

function quaternionForView(direction: Vec3, preferredUp: Vec3) {
  const forward = normalize(direction);
  let upReference = normalize(preferredUp);
  if (Math.abs(dot(forward, upReference)) > 0.94) {
    upReference = ([[0, 1, 0], [0, 0, 1], [1, 0, 0]] as Vec3[])
      .sort((a, b) => Math.abs(dot(forward, a)) - Math.abs(dot(forward, b)))[0];
  }
  const right = normalize(cross(upReference, forward));
  const up = normalize(cross(forward, right));
  return quaternionFromRotationMatrix([right, up, forward]);
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
  hydrogenBonds,
  hydrogenBondAppearance,
  supercell,
  display,
  selectedAtomIndex,
  selectedOperation,
  atomFocus,
  elementAppearance,
  axisAppearance,
  onSelectAtom,
  onRequestContextMenu,
  onRequestAppearanceMenu,
  onClearAtomFocus,
}: {
  structure: CrystalStructure;
  hydrogenBonds: HydrogenBond[];
  hydrogenBondAppearance: HydrogenBondAppearance;
  supercell: SupercellSettings;
  display: DisplaySettings;
  selectedAtomIndex: number;
  selectedOperation: SymmetryOperation;
  atomFocus: AtomFocus;
  elementAppearance: ElementAppearance;
  axisAppearance: AxisAppearance;
  onSelectAtom: (index: number) => void;
  onRequestContextMenu: (menu: AtomContextMenu) => void;
  onRequestAppearanceMenu: (menu: AppearanceMenu) => void;
  onClearAtomFocus: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectedAtoms = useRef<ProjectedAtom[]>([]);
  const axesHitRegion = useRef({ x: 0, y: 0, radius: 42 });
  const rotation = useRef<Quaternion>(initialViewQuaternion());
  const zoom = useRef(1);
  const drag = useRef({ active: false, x: 0, y: 0, moved: 0 });
  const [orthographic, setOrthographic] = useState(false);
  const [viewPreset, setViewPreset] = useState<ViewPreset | null>(null);
  const [viewVersion, setViewVersion] = useState(0);

  const legendElements = useMemo(() => {
    const counts = new Map<string, number>();
    structure.atoms.forEach((atom) => counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1));
    return [...counts.entries()].sort(([a], [b]) => hillElementOrder(a, b, counts.has("C")));
  }, [structure]);

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

    const supercellExtents: Vec3 = [supercell.a, supercell.b, supercell.c];
    const center = fractToCart(supercellExtents.map((extent) => extent / 2) as Vec3, structure.cell);
    const [aVector, bVector, cVector] = latticeVectors(structure.cell);
    const baseMaxCell = Math.max(structure.cell.a, structure.cell.b, structure.cell.c, 1);
    const maxCell = Math.max(
      structure.cell.a * supercell.a,
      structure.cell.b * supercell.b,
      structure.cell.c * supercell.c,
      1,
    );
    const worldScale = 2.45 / maxCell;

    const rotate = (point: Vec3): Vec3 => {
      const relative: Vec3 = [
        (point[0] - center[0]) * worldScale,
        (point[1] - center[1]) * worldScale,
        (point[2] - center[2]) * worldScale,
      ];
      return rotateByQuaternion(relative, rotation.current);
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

    const baseDisplayFracts = display.completeMolecules
      ? molecularDisplayFracts(structure.atoms, structure.bonds)
      : structure.atoms.map((atom) => atom.fract);
    const displayAtoms = buildDisplayAtomInstances(structure, baseDisplayFracts, supercell, display.completeMolecules);
    const displayAtomMap = new Map(displayAtoms.map((instance) => [`${instance.translationKey}:${instance.index}`, instance]));
    const displayTranslations = [...new Map(displayAtoms.map((instance) => [instance.translationKey, instance.translation])).values()];
    const instancesByAtom = new Map<number, DisplayAtomInstance[]>();
    displayAtoms.forEach((instance) => instancesByAtom.set(instance.index, [...(instancesByAtom.get(instance.index) ?? []), instance]));

    const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

    if (display.cell) {
      context.save();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(71, 85, 105, .34)";
      context.setLineDash([4, 7]);
      for (let ix = 0; ix < Math.ceil(supercell.a); ix += 1) {
        for (let iy = 0; iy < Math.ceil(supercell.b); iy += 1) {
          for (let iz = 0; iz < Math.ceil(supercell.c); iz += 1) {
            const x1 = Math.min(ix + 1, supercell.a);
            const y1 = Math.min(iy + 1, supercell.b);
            const z1 = Math.min(iz + 1, supercell.c);
            if (x1 <= ix || y1 <= iy || z1 <= iz) continue;
            const fractionalCorners: Vec3[] = [
              [ix, iy, iz], [x1, iy, iz], [ix, y1, iz], [x1, y1, iz],
              [ix, iy, z1], [x1, iy, z1], [ix, y1, z1], [x1, y1, z1],
            ];
            const corners = fractionalCorners.map((fract) => fractToCart(fract, structure.cell));
            for (const [from, to] of edges) {
              const a = project(corners[from]);
              const b = project(corners[to]);
              context.beginPath();
              context.moveTo(a.x, a.y);
              context.lineTo(b.x, b.y);
              context.stroke();
            }
          }
        }
      }
      context.restore();
    }

    if (display.symmetry && selectedOperation.kind !== "identity") {
      context.save();
      if (["rotation", "screw", "rotoinversion"].includes(selectedOperation.kind)) {
        const axisFract = findEigenDirection(selectedOperation, 1);
        const axisCart = normalize(fractToCart(axisFract, structure.cell));
        const baseAxisOrigin = findSymmetryAxisOrigin(selectedOperation, axisFract, structure);
        const axisOrigin = fractToCart(baseAxisOrigin.map((value, axis) => value + Math.floor(supercellExtents[axis] / 2)) as Vec3, structure.cell);
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
          const radius = baseMaxCell * 0.055;
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
      for (const translation of displayTranslations) {
        const translationKey = translation.join(",");
        for (const bond of structure.bonds) {
          const instanceA = displayAtomMap.get(`${translationKey}:${bond.a}`);
          const instanceB = displayAtomMap.get(`${translationKey}:${bond.b}`);
          if (!instanceA || !instanceB) continue;
          const atomA = instanceA.atom;
          const atomB = instanceB.atom;
          if (!display.hydrogens && (atomA.element === "H" || atomB.element === "H")) continue;
          const focusA = matchesFocus(atomA);
          const focusB = matchesFocus(atomB);
          if (atomFocus.mode === "isolate" && (!focusA || !focusB)) continue;
          const directDistance = Math.hypot(
            instanceA.cart[0] - instanceB.cart[0], instanceA.cart[1] - instanceB.cart[1], instanceA.cart[2] - instanceB.cart[2],
          );
          if (directDistance > bond.distance + 0.25) continue;
          const a = project(instanceA.cart);
          const b = project(instanceB.cart);
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const lineWidth = Math.max(2.2, Math.min(7, (a.factor + b.factor) * worldScale * 0.13));
          context.globalAlpha = atomFocus.mode === "fade" ? (focusA && focusB ? 1 : focusA || focusB ? 0.42 : 0.07) : 1;
          context.strokeStyle = "rgba(51, 65, 85, .26)";
          context.lineWidth = lineWidth + 1.8;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();

          context.lineWidth = lineWidth;
          context.strokeStyle = shadeHex(resolvedElementStyle(atomA.element, elementAppearance).color, 0.06);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(midpoint.x, midpoint.y);
          context.stroke();
          context.strokeStyle = shadeHex(resolvedElementStyle(atomB.element, elementAppearance).color, 0.06);
          context.beginPath();
          context.moveTo(midpoint.x, midpoint.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
      context.restore();
    }

    if (display.hydrogenBonds && hydrogenBonds.length) {
      context.save();
      context.lineCap = "round";
      context.setLineDash([5, 4]);
      for (const hydrogenBond of hydrogenBonds) {
        const donorAtom = structure.atoms[hydrogenBond.donor];
        const hydrogenAtom = structure.atoms[hydrogenBond.hydrogen];
        const acceptorAtom = structure.atoms[hydrogenBond.acceptor];
        const focusD = matchesFocus(donorAtom);
        const focusH = matchesFocus(hydrogenAtom);
        const focusA = matchesFocus(acceptorAtom);
        if (atomFocus.mode === "isolate" && !focusD && !focusH && !focusA) continue;
        for (const hydrogenInstance of instancesByAtom.get(hydrogenBond.hydrogen) ?? []) {
          const acceptorImageFract = hydrogenInstance.fract.map((value, axis) => (
            value + acceptorAtom.fract[axis] + hydrogenBond.acceptorImageShift[axis] - hydrogenAtom.fract[axis]
          )) as Vec3;
          const acceptorImageCart = fractToCart(acceptorImageFract, structure.cell);
          const start = project(hydrogenInstance.cart);
          const end = project(acceptorImageCart);
          const focused = focusD || focusH || focusA;
          context.globalAlpha = atomFocus.mode === "fade" ? (focused ? 1 : 0.08) : 0.94;
          context.strokeStyle = "rgba(255, 255, 255, .96)";
          context.lineWidth = hydrogenBondAppearance.lineWidth + 2.6;
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.stroke();
          context.strokeStyle = hydrogenBondAppearance.color;
          context.lineWidth = hydrogenBondAppearance.lineWidth;
          context.stroke();

          const hasDisplayedAcceptor = (instancesByAtom.get(hydrogenBond.acceptor) ?? []).some((instance) => Math.hypot(
            acceptorImageCart[0] - instance.cart[0],
            acceptorImageCart[1] - instance.cart[1],
            acceptorImageCart[2] - instance.cart[2],
          ) <= 0.24);
          if (!hasDisplayedAcceptor) {
            context.setLineDash([]);
            context.fillStyle = "rgba(255, 255, 255, .92)";
            context.beginPath();
            context.arc(end.x, end.y, 3.8, 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = hydrogenBondAppearance.color;
            context.lineWidth = Math.max(1, hydrogenBondAppearance.lineWidth * 0.78);
            context.stroke();
            context.setLineDash([5, 4]);
          }
        }
      }
      context.restore();
    }

    const selectedAtom = structure.atoms[selectedAtomIndex];
    if (display.symmetry && selectedAtom && (display.hydrogens || selectedAtom.element !== "H")) {
      const selectedTranslation = supercellExtents.map((extent) => Math.floor(extent / 2)) as Vec3;
      const source = project(fractToCart(selectedAtom.source.fract.map((value, axis) => value + selectedTranslation[axis]) as Vec3, structure.cell));
      const target = project(fractToCart(baseDisplayFracts[selectedAtomIndex].map((value, axis) => value + selectedTranslation[axis]) as Vec3, structure.cell));
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

    const atoms = displayAtoms.map(({ atom, index, cart }) => ({ atom, index, projection: project(cart) }))
      .sort((a, b) => a.projection.depth - b.projection.depth);
    const hitTargets: ProjectedAtom[] = [];
    if (display.atoms) {
      for (const { atom, index, projection } of atoms) {
        if (!display.hydrogens && atom.element === "H") continue;
        const focused = matchesFocus(atom);
        if (atomFocus.mode === "isolate" && !focused) continue;
        const style = resolvedElementStyle(atom.element, elementAppearance);
        const radius = Math.max(3.2, Math.min(22, style.radius * style.scale * projection.factor * worldScale * 0.9));
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

        if (display.labels && displayAtoms.length <= 120) {
          context.fillStyle = index === selectedAtomIndex ? "#0f5f62" : "rgba(51, 65, 85, .82)";
          context.font = `${index === selectedAtomIndex ? 650 : 500} 10px ui-monospace, monospace`;
          context.fillText(atom.label, projection.x + radius + 4, projection.y - radius - 1);
        }
        context.restore();
      }
    }
    projectedAtoms.current = hitTargets;

    const axesOrigin = { x: width - 54, y: height - 48 };
    axesHitRegion.current = { x: axesOrigin.x, y: axesOrigin.y, radius: axisAppearance.length + 18 };
    const axes: Array<{ vector: Vec3; color: string; label: string }> = [
      { vector: normalize(aVector), color: "#ff647c", label: "a" },
      { vector: normalize(bVector), color: "#65df91", label: "b" },
      { vector: normalize(cVector), color: "#5db5ff", label: "c" },
    ];
    context.fillStyle = "#64748b";
    context.beginPath();
    context.arc(axesOrigin.x, axesOrigin.y, 2, 0, Math.PI * 2);
    context.fill();
    for (const axis of axes) {
      const rotated = rotate(vectorAdd(center, vectorScale(axis.vector, maxCell * 0.35)));
      const maximumLength = axisAppearance.length;
      const spatialLength = Math.hypot(...rotated) || 1;
      const screenNorm = Math.hypot(rotated[0], rotated[1]);
      const screenFraction = Math.min(1, screenNorm / spatialLength);
      const projectedLength = maximumLength * screenFraction;
      let labelX = axesOrigin.x + 7;
      let labelY = axesOrigin.y - 5;
      context.strokeStyle = axis.color;
      context.fillStyle = axis.color;
      context.lineWidth = axisAppearance.lineWidth;
      context.font = `600 ${axisAppearance.fontSize}px ${axisFontFamilies[axisAppearance.font]}`;

      if (screenNorm > 1e-6 && projectedLength > 0.3) {
        const x = axesOrigin.x + (rotated[0] / screenNorm) * projectedLength;
        const y = axesOrigin.y - (rotated[1] / screenNorm) * projectedLength;
        labelX = x + 3;
        labelY = y - 2;
        context.beginPath();
        context.moveTo(axesOrigin.x, axesOrigin.y);
        context.lineTo(x, y);
        context.stroke();
        if (projectedLength > 4) {
          const angle = Math.atan2(y - axesOrigin.y, x - axesOrigin.x);
          const arrowSize = Math.min(5, projectedLength * 0.24);
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - arrowSize * Math.cos(angle - 0.45), y - arrowSize * Math.sin(angle - 0.45));
          context.lineTo(x - arrowSize * Math.cos(angle + 0.45), y - arrowSize * Math.sin(angle + 0.45));
          context.closePath();
          context.fill();
        }
      }

      const faceOnStrength = Math.max(0, 1 - screenFraction);
      if (faceOnStrength > 0.04) {
        context.save();
        context.globalAlpha = Math.min(1, faceOnStrength * 1.45);
        const markerRadius = (1.7 + faceOnStrength * 2.5) * Math.max(0.72, axisAppearance.length / 25);
        context.beginPath();
        context.arc(axesOrigin.x, axesOrigin.y, markerRadius, 0, Math.PI * 2);
        context.stroke();
        if (rotated[2] > 0) {
          context.beginPath();
          context.arc(axesOrigin.x, axesOrigin.y, Math.max(0.8, markerRadius * 0.38), 0, Math.PI * 2);
          context.fill();
        } else {
          const crossSize = Math.max(1.2, markerRadius * 0.55);
          context.beginPath();
          context.moveTo(axesOrigin.x - crossSize, axesOrigin.y - crossSize);
          context.lineTo(axesOrigin.x + crossSize, axesOrigin.y + crossSize);
          context.moveTo(axesOrigin.x + crossSize, axesOrigin.y - crossSize);
          context.lineTo(axesOrigin.x - crossSize, axesOrigin.y + crossSize);
          context.stroke();
        }
        context.restore();
      }
      context.fillStyle = axis.color;
      context.fillText(axis.label, labelX, labelY);
    }
  }, [structure, hydrogenBonds, hydrogenBondAppearance, supercell, display, selectedAtomIndex, selectedOperation, atomFocus, elementAppearance, axisAppearance, orthographic, viewVersion]);

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
    const yawDelta = quaternionFromAxis([0, 1, 0], dx * 0.008);
    const pitchDelta = quaternionFromAxis([1, 0, 0], dy * 0.008);
    rotation.current = normalizeQuaternion(quaternionMultiply(pitchDelta, quaternionMultiply(yawDelta, rotation.current)));
    if (dx || dy) setViewPreset(null);
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
    rotation.current = initialViewQuaternion();
    zoom.current = 1;
    setViewPreset(null);
    redraw();
  }

  function selectPresetView(preset: ViewPreset) {
    const [a, b, c] = latticeVectors(structure.cell);
    const presets: Record<ViewPreset, { direction: Vec3; up: Vec3 }> = {
      x: { direction: [1, 0, 0], up: [0, 1, 0] },
      y: { direction: [0, 1, 0], up: [0, 0, 1] },
      z: { direction: [0, 0, 1], up: [0, 1, 0] },
      a: { direction: a, up: b },
      b: { direction: b, up: c },
      c: { direction: c, up: b },
    };
    const selected = presets[preset];
    rotation.current = quaternionForView(selected.direction, selected.up);
    setViewPreset(preset);
    redraw();
  }

  function requestElementAppearance(element: string, event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onRequestAppearanceMenu({
      kind: "element",
      element,
      x: event.type === "contextmenu" ? event.clientX : rect.right + 6,
      y: event.type === "contextmenu" ? event.clientY : rect.top,
    });
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
          const rect = event.currentTarget.getBoundingClientRect();
          const canvasX = event.clientX - rect.left;
          const canvasY = event.clientY - rect.top;
          const axes = axesHitRegion.current;
          if (Math.hypot(canvasX - axes.x, canvasY - axes.y) <= axes.radius) {
            onRequestAppearanceMenu({ kind: "axis", x: event.clientX, y: event.clientY });
            return;
          }
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
          <div className={isCrystallographicSupercell(supercell) ? "supercell-chip" : "supercell-chip fractional"}>
            <i />{isCrystallographicSupercell(supercell) ? "超胞" : "分数范围"} {supercellText(supercell)}
          </div>
          {display.hydrogenBonds && <div
            className="hydrogen-bond-chip"
            style={{ "--hbond-view-color": hydrogenBondAppearance.color } as React.CSSProperties}
          ><i /> 氢键候选 {hydrogenBonds.length}</div>}
          {atomFocus.mode !== "none" && <div className="focus-chip">
            <span>{atomFocus.mode === "fade" ? "聚焦" : "单独显示"} · {atomFocus.sourceLabel}</span>
            <button type="button" onClick={onClearAtomFocus}>恢复全部</button>
          </div>}
        </div>
        <div className="canvas-control-stack">
          <div className="canvas-actions">
            <button type="button" className={!orthographic ? "active" : ""} onClick={() => setOrthographic(false)}>透视</button>
            <button type="button" className={orthographic ? "active" : ""} onClick={() => setOrthographic(true)}>正交</button>
            <button type="button" onClick={resetView} aria-label="复位视图">↺</button>
          </div>
          <div className="view-presets" aria-label="定向观察视图">
            <span>笛卡尔</span>
            {(["x", "y", "z"] as ViewPreset[]).map((preset) => <button
              type="button"
              key={preset}
              className={viewPreset === preset ? "active cartesian" : "cartesian"}
              title={`沿笛卡尔 +${preset} 方向观察`}
              aria-label={`沿笛卡尔正 ${preset} 方向观察`}
              onClick={() => selectPresetView(preset)}
            >{preset}</button>)}
            <i />
            <span>晶格</span>
            {(["a", "b", "c"] as ViewPreset[]).map((preset) => <button
              type="button"
              key={preset}
              className={viewPreset === preset ? `active lattice ${preset}` : `lattice ${preset}`}
              title={`沿晶格 +${preset} 方向观察`}
              aria-label={`沿晶格正 ${preset} 方向观察`}
              onClick={() => selectPresetView(preset)}
            >{preset}</button>)}
          </div>
        </div>
      </div>
      <div className="element-legend" aria-label="元素颜色图例">
        <div className="element-legend-head"><span>元素图例</span><small>单击或右键编辑</small></div>
        <div className="element-legend-items">
          {legendElements.map(([element, count]) => {
            const style = resolvedElementStyle(element, elementAppearance);
            return <button
              type="button"
              key={element}
              title={`编辑 ${element} 的颜色和原子大小`}
              onClick={(event) => requestElementAppearance(element, event)}
              onContextMenu={(event) => requestElementAppearance(element, event)}
            >
              <i style={{ "--legend-color": style.color } as React.CSSProperties} />
              <strong>{element}</strong>
              <small>{count}</small>
            </button>;
          })}
        </div>
      </div>
      <div className="gesture-hint">拖拽旋转 · 滚轮缩放 · 左键选择 · 右键聚焦 / 编辑坐标轴</div>
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
  const [supercell, setSupercell] = useState<SupercellSettings>(defaultSupercell);
  const [selectedAtomIndex, setSelectedAtomIndex] = useState(0);
  const [selectedOperationId, setSelectedOperationId] = useState(1);
  const [rightTab, setRightTab] = useState<RightTab>("operations");
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
  const [elementAppearance, setElementAppearance] = useState<ElementAppearance>({});
  const [axisAppearance, setAxisAppearance] = useState<AxisAppearance>(defaultAxisAppearance);
  const [hydrogenBondAppearance, setHydrogenBondAppearance] = useState<HydrogenBondAppearance>(defaultHydrogenBondAppearance);
  const [hydrogenBondCriteria, setHydrogenBondCriteria] = useState<HydrogenBondCriteria>(() => ({
    ...defaultHydrogenBondCriteria,
    donorElements: [...defaultHydrogenBondCriteria.donorElements],
    acceptorElements: [...defaultHydrogenBondCriteria.acceptorElements],
  }));
  const [hydrogenPreset, setHydrogenPreset] = useState<HydrogenPreset | "custom">("steiner");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appearanceMenu, setAppearanceMenu] = useState<AppearanceMenu | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const appearanceMenuRef = useRef<HTMLDivElement>(null);

  const selectedAtom = structure.atoms[Math.min(selectedAtomIndex, structure.atoms.length - 1)];
  const selectedOperation = structure.operations.find((operation) => operation.id === selectedOperationId) ?? structure.operations[0];
  const calculatorOperation = structure.operations.find((operation) => operation.id === calculatorOperationId) ?? structure.operations[0];
  const currentElementColor = (element: string) => resolvedElementStyle(element, elementAppearance).color;

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

  const hydrogenBonds = useMemo(
    () => findHydrogenBonds(structure, hydrogenBondCriteria),
    [structure, hydrogenBondCriteria],
  );
  const hydrogenBondSummary = useMemo(() => ({
    intramolecular: hydrogenBonds.filter((bond) => bond.kind === "intramolecular").length,
    intermolecular: hydrogenBonds.filter((bond) => bond.kind === "intermolecular").length,
  }), [hydrogenBonds]);
  const hasExplicitHydrogens = structure.atoms.some((atom) => atom.element === "H");
  const hydrogenAtomCount = structure.atoms.filter((atom) => atom.element === "H").length;
  const displayedAtomCount = useMemo(() => {
    const baseFracts = display.completeMolecules
      ? molecularDisplayFracts(structure.atoms, structure.bonds)
      : structure.atoms.map((atom) => atom.fract);
    const instances = buildDisplayAtomInstances(structure, baseFracts, supercell, display.completeMolecules);
    return display.hydrogens ? instances.length : instances.filter((instance) => instance.atom.element !== "H").length;
  }, [structure, supercell, display.completeMolecules, display.hydrogens]);

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
      const target = event.target as Node;
      if (!contextMenuRef.current?.contains(target) && !appearanceMenuRef.current?.contains(target)) {
        setContextMenu(null);
        setAppearanceMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        setAppearanceMenu(null);
      }
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
      setAppearanceMenu(null);
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

  function applySupercellPreset(a: number, b: number, c: number) {
    setSupercell({ a, b, c });
    setNotice(`显示范围已设为 ${supercellText({ a, b, c })}`);
  }

  function updateSupercellExtent(axis: keyof SupercellSettings, value: number) {
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0.25, Math.min(6, Math.round(value * 100) / 100));
    setSupercell((current) => ({ ...current, [axis]: clamped }));
  }

  function applyHydrogenBondPreset(preset: HydrogenPreset) {
    const values = hydrogenBondPresets[preset];
    setHydrogenBondCriteria({
      ...values,
      donorElements: [...values.donorElements],
      acceptorElements: [...values.acceptorElements],
    });
    setHydrogenPreset(preset);
  }

  function updateHydrogenBondNumber(
    key: "maxHydrogenAcceptorDistance" | "maxDonorAcceptorDistance" | "minDonorHydrogenAcceptorAngle",
    value: number,
  ) {
    setHydrogenBondCriteria((current) => ({ ...current, [key]: value }));
    setHydrogenPreset("custom");
  }

  function toggleHydrogenBondElement(key: "donorElements" | "acceptorElements", element: string) {
    setHydrogenBondCriteria((current) => {
      const values = current[key];
      return {
        ...current,
        [key]: values.includes(element) ? values.filter((value) => value !== element) : [...values, element],
      };
    });
    setHydrogenPreset("custom");
  }

  function exportReport() {
    const report = {
      structure: structure.name,
      formula: structure.formula,
      spaceGroup: { symbol: structure.spaceGroup, number: structure.spaceGroupNumber },
      pointGroup: structure.pointGroup,
      crystalSystem: structure.crystalSystem,
      unitCell: structure.cell,
      displayedSupercell: {
        extents: supercell,
        crystallographicSupercell: isCrystallographicSupercell(supercell),
        displayedAtomCount,
      },
      asymmetricSites: structure.sites,
      symmetryOperations: structure.operations.map(({ id, xyz, kind, name }) => ({ id, xyz, kind, name })),
      generatedAtoms: structure.atoms.map(({ label, element, fract, source, operationIds }) => ({ label, element, fract, source: source.label, operationIds })),
      hydrogenBondAnalysis: {
        criteria: hydrogenBondCriteria,
        appearance: hydrogenBondAppearance,
        candidates: hydrogenBonds.map((bond) => ({
          donor: structure.atoms[bond.donor].label,
          hydrogen: structure.atoms[bond.hydrogen].label,
          acceptor: structure.atoms[bond.acceptor].label,
          kind: bond.kind,
          strength: bond.strength,
          hydrogenAcceptorDistance: bond.hydrogenAcceptorDistance,
          donorAcceptorDistance: bond.donorAcceptorDistance,
          angle: bond.angle,
          acceptorImageShift: bond.acceptorImageShift,
        })),
      },
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
      className={["app-shell", dragActive ? "dragging" : "", sidebarCollapsed ? "sidebar-collapsed" : ""].filter(Boolean).join(" ")}
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
        <div className="drawer-control">
          <button
            type="button"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "展开左侧边栏" : "收起左侧边栏"}
            title={sidebarCollapsed ? "展开左侧边栏" : "收起左侧边栏"}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
            {!sidebarCollapsed && <b>收起边栏</b>}
          </button>
        </div>
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
              {composition.map(([element, count]) => <span key={element} style={{ "--element-color": currentElementColor(element) } as React.CSSProperties}><i />{element}<small>{count}</small></span>)}
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

        <section className="side-section supercell-section">
          <div className="section-heading"><span>超胞 / 显示范围</span><small>SUPERCELL</small></div>
          <div className="supercell-card">
            <div className="supercell-presets" aria-label="常用超胞预设">
              {([
                [1, 1, 1, "1×1×1"],
                [2, 1, 1, "2×1"],
                [2, 2, 1, "2×2"],
                [3, 3, 1, "3×3"],
                [2, 2, 2, "2×2×2"],
                [3, 3, 3, "3×3×3"],
              ] as Array<[number, number, number, string]>).map(([a, b, c, label]) => {
                const active = supercell.a === a && supercell.b === b && supercell.c === c;
                return <button type="button" key={label} className={active ? "active" : ""} onClick={() => applySupercellPreset(a, b, c)}>{label}</button>;
              })}
            </div>
            <div className="supercell-inputs">
              {(["a", "b", "c"] as Array<keyof SupercellSettings>).map((axis) => <label key={axis} className={axis}>
                <span>{axis}</span>
                <input
                  type="number"
                  min="0.25"
                  max="6"
                  step="0.25"
                  value={supercell[axis]}
                  aria-label={`${axis} 方向显示倍数`}
                  onChange={(event) => updateSupercellExtent(axis, Number(event.target.value))}
                />
              </label>)}
            </div>
            <div className={isCrystallographicSupercell(supercell) ? "supercell-status" : "supercell-status fractional"}>
              <i>{isCrystallographicSupercell(supercell) ? "✓" : "≈"}</i>
              <span><strong>{isCrystallographicSupercell(supercell) ? "晶体学超胞" : "分数显示范围"}</strong><small>{isCrystallographicSupercell(supercell)
                ? `${supercell.a * supercell.b * supercell.c} 个原胞 · 当前显示 ${displayedAtomCount} 原子`
                : `按 ${supercellText(supercell)} 裁切视图，不改变晶格周期`}</small></span>
            </div>
            <p className="supercell-note">可输入 0.25–6；整数倍构成周期超胞，非整数倍用于观察指定分数范围。</p>
          </div>
        </section>

        <section className="side-section display-section">
          <div className="section-heading"><span>显示控制</span><small>VIEW LAYERS</small></div>
          <Toggle label="原子球（哑光 CPK）" hint={`${structure.atoms.length} 个等价原子`} checked={display.atoms} onChange={() => toggleDisplay("atoms")} />
          <Toggle
            label="显示氢原子"
            hint={display.hydrogens ? `${hydrogenAtomCount} 个 H` : `${hydrogenAtomCount} 个 H 已隐藏`}
            checked={display.hydrogens}
            onChange={() => toggleDisplay("hydrogens")}
          />
          <Toggle label="化学键（球棍）" hint={`${structure.bonds.length} 组共价近邻`} checked={display.bonds} onChange={() => toggleDisplay("bonds")} />
          <Toggle
            label="氢键候选"
            hint={`${hydrogenBonds.length} 条 · 分子内 ${hydrogenBondSummary.intramolecular} / 分子间 ${hydrogenBondSummary.intermolecular}`}
            checked={display.hydrogenBonds}
            onChange={() => {
              toggleDisplay("hydrogenBonds");
              if (!display.hydrogenBonds) setRightTab("hydrogen");
            }}
          />
          <Toggle label="补全分子片段" hint={display.completeMolecules ? "跨晶胞键已重新拼接" : "当前按晶胞边界截断"} checked={display.completeMolecules} onChange={() => toggleDisplay("completeMolecules")} />
          <Toggle label="晶胞边界" hint={supercellText(supercell)} checked={display.cell} onChange={() => toggleDisplay("cell")} />
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
          <div className="workspace-stats"><span><i />{displayedAtomCount} 显示原子</span><span>{structure.bonds.length} 键 · {hydrogenBonds.length} 氢键类型</span><span>{supercellText(supercell)} · {display.completeMolecules ? "完整分子" : "晶胞截断"}</span></div>
        </div>
        <CrystalCanvas
          structure={structure}
          hydrogenBonds={hydrogenBonds}
          hydrogenBondAppearance={hydrogenBondAppearance}
          supercell={supercell}
          display={display}
          selectedAtomIndex={selectedAtomIndex}
          selectedOperation={selectedOperation}
          atomFocus={atomFocus}
          elementAppearance={elementAppearance}
          axisAppearance={axisAppearance}
          onSelectAtom={selectAtom}
          onRequestContextMenu={(menu) => {
            setAppearanceMenu(null);
            setContextMenu({
              ...menu,
              x: Math.max(10, Math.min(window.innerWidth - 286, menu.x)),
              y: Math.max(10, Math.min(window.innerHeight - 236, menu.y)),
            });
          }}
          onRequestAppearanceMenu={(menu) => {
            setContextMenu(null);
            setAppearanceMenu({
              ...menu,
              x: Math.max(10, Math.min(window.innerWidth - 306, menu.x)),
              y: Math.max(10, Math.min(window.innerHeight - (menu.kind === "axis" ? 380 : 285), menu.y)),
            });
          }}
          onClearAtomFocus={() => setAtomFocus({ mode: "none", sourceLabel: null })}
        />

        <div className="symmetry-story">
          <div className="story-title">
            <div><span className="eyebrow">SYMMETRY MAPPING</span><strong>对称等价位置生成</strong></div>
            <div className="story-tools">
              <details className="mapping-help">
                <summary>？ 说明</summary>
                {selectedAtom && <div className="mapping-help-box">
                  <p><b>{selectedAtom.source.label}</b>：CIF 位点标签；<b>{selectedAtom.label}</b>：SymViz 生成编号。</p>
                  <p>中间公式变换坐标，结果按周期折回 [0, 1)。</p>
                </div>}
              </details>
              <span className="story-count">操作 {selectedOperation.id} / 共 {structure.operations.length} 项</span>
            </div>
          </div>
          <div className="mapping-row">
            <div className="mapping-node source">
              <span><b>1</b>CIF 原始位点</span>
              <strong>{selectedAtom?.source.label}</strong>
              <small>CIF 标签 · 元素 {selectedAtom?.element ?? "—"}</small>
              <em>{selectedAtom ? coordinateText(selectedAtom.source.fract) : "—"}</em>
            </div>
            <div className="mapping-operation">
              <span><b>2</b>{selectedOperation.label}</span>
              <div className="mapping-operation-copy">
                <strong>{operationTitle(selectedOperation)} · {operationKindLabel(selectedOperation.kind)}</strong>
                <code>{selectedOperation.xyz}</code>
              </div>
              <div className="mapping-arrow"><i style={{ width: `${completion}%` }} /></div>
            </div>
            <div className="mapping-node target">
              <span><b>3</b>生成的等价原子</span>
              <strong>{selectedAtom?.label}</strong>
              <small>SymViz 编号</small>
              <em>{coordinateText(transformedSelected as Vec3)}</em>
            </div>
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
          <button type="button" className={rightTab === "hydrogen" ? "active" : ""} onClick={() => setRightTab("hydrogen")}>氢键</button>
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
            <div className="detail-head"><span style={{ "--atom-color": currentElementColor(selectedAtom.element) } as React.CSSProperties}><i />{selectedAtom.label}</span><small>当前映射</small></div>
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
              <span className="atom-swatch" style={{ "--atom-color": currentElementColor(atom.element) } as React.CSSProperties}>{atom.element}</span>
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

        {rightTab === "hydrogen" && <div className="right-content panel-scroll hydrogen-panel">
          <div className="hydrogen-intro">
            <div className="hydrogen-intro-head">
              <span><i />氢键几何筛选</span>
              <button
                type="button"
                role="switch"
                aria-checked={display.hydrogenBonds}
                className={display.hydrogenBonds ? "hydrogen-layer-toggle on" : "hydrogen-layer-toggle"}
                onClick={() => toggleDisplay("hydrogenBonds")}
              >{display.hydrogenBonds ? "视图已显示" : "视图已隐藏"}</button>
            </div>
            <p>自动搜索 D–H···A 周期近邻，并按共价连通片段区分分子内与分子间。虚线表示 H···A。</p>
            <div className="hydrogen-summary">
              <span><strong>{hydrogenBonds.length}</strong>总候选</span>
              <span><strong>{hydrogenBondSummary.intramolecular}</strong>分子内</span>
              <span><strong>{hydrogenBondSummary.intermolecular}</strong>分子间</span>
            </div>
          </div>

          <section className="hydrogen-settings">
            <div className="hydrogen-section-head"><span>筛选预设</span><small>{hydrogenPreset === "custom" ? "自定义" : "已应用"}</small></div>
            <div className="hydrogen-presets">
              {([['strict', '严格'], ['steiner', 'Steiner 保守'], ['broad', '宽松']] as Array<[HydrogenPreset, string]>).map(([preset, label]) => (
                <button type="button" key={preset} className={hydrogenPreset === preset ? "active" : ""} onClick={() => applyHydrogenBondPreset(preset)}>{label}</button>
              ))}
            </div>

            <div className="hydrogen-ranges">
              <label>
                <span>H···A 最大距离<output>{hydrogenBondCriteria.maxHydrogenAcceptorDistance.toFixed(1)} Å</output></span>
                <input type="range" min="1.8" max="3.2" step="0.1" value={hydrogenBondCriteria.maxHydrogenAcceptorDistance} onChange={(event) => updateHydrogenBondNumber("maxHydrogenAcceptorDistance", Number(event.target.value))} />
              </label>
              <label>
                <span>D···A 最大距离<output>{hydrogenBondCriteria.maxDonorAcceptorDistance.toFixed(1)} Å</output></span>
                <input type="range" min="2.4" max="4.2" step="0.1" value={hydrogenBondCriteria.maxDonorAcceptorDistance} onChange={(event) => updateHydrogenBondNumber("maxDonorAcceptorDistance", Number(event.target.value))} />
              </label>
              <label>
                <span>D–H···A 最小角<output>{hydrogenBondCriteria.minDonorHydrogenAcceptorAngle.toFixed(0)}°</output></span>
                <input type="range" min="80" max="175" step="5" value={hydrogenBondCriteria.minDonorHydrogenAcceptorAngle} onChange={(event) => updateHydrogenBondNumber("minDonorHydrogenAcceptorAngle", Number(event.target.value))} />
              </label>
            </div>

            <div className="hydrogen-appearance" style={{
              "--hbond-view-color": hydrogenBondAppearance.color,
              "--hbond-view-width": `${hydrogenBondAppearance.lineWidth}px`,
            } as React.CSSProperties}>
              <div className="hydrogen-appearance-head">
                <span>虚线样式</span>
                <i />
              </div>
              <label className="hydrogen-color-control">
                <span>虚线颜色</span>
                <input
                  type="color"
                  value={hydrogenBondAppearance.color}
                  aria-label="氢键虚线颜色"
                  onChange={(event) => setHydrogenBondAppearance((current) => ({ ...current, color: event.target.value }))}
                />
                <code>{hydrogenBondAppearance.color.toUpperCase()}</code>
              </label>
              <label className="hydrogen-width-control">
                <span>虚线粗细<output>{hydrogenBondAppearance.lineWidth.toFixed(1)} px</output></span>
                <input
                  type="range"
                  min="0.6"
                  max="5"
                  step="0.2"
                  value={hydrogenBondAppearance.lineWidth}
                  onChange={(event) => setHydrogenBondAppearance((current) => ({ ...current, lineWidth: Number(event.target.value) }))}
                />
              </label>
              <button type="button" onClick={() => setHydrogenBondAppearance(defaultHydrogenBondAppearance)}>恢复虚线默认样式</button>
            </div>

            <div className="hydrogen-element-filter">
              <span>供体 D–H</span>
              <div>{["O", "N", "S", "C"].map((element) => <button type="button" key={element} className={hydrogenBondCriteria.donorElements.includes(element) ? "active" : ""} onClick={() => toggleHydrogenBondElement("donorElements", element)}>{element}–H</button>)}</div>
              <small>C–H 通常属于较弱、边界更开放的氢键类型。</small>
            </div>
            <div className="hydrogen-element-filter acceptors">
              <span>受体 A</span>
              <div>{["O", "N", "S", "F", "Cl", "Br", "I"].map((element) => <button type="button" key={element} className={hydrogenBondCriteria.acceptorElements.includes(element) ? "active" : ""} onClick={() => toggleHydrogenBondElement("acceptorElements", element)}>{element}</button>)}</div>
            </div>
          </section>

          <section className="hydrogen-results">
            <div className="hydrogen-section-head"><span>符合当前阈值</span><small>周期最小镜像</small></div>
            {!hasExplicitHydrogens ? <div className="hydrogen-empty warning"><strong>没有显式 H 原子</strong><p>当前 CIF 无法计算 D–H···A 角。请使用含氢坐标的 CIF，最好采用中子衍射或已规范化的 X–H 键长。</p></div>
              : hydrogenBonds.length === 0 ? <div className="hydrogen-empty"><strong>未发现候选</strong><p>可切换“宽松”预设，或调整距离、角度及供体/受体元素。</p></div>
                : <div className="hydrogen-bond-list">{hydrogenBonds.slice(0, 160).map((bond, index) => {
                  const donor = structure.atoms[bond.donor];
                  const hydrogen = structure.atoms[bond.hydrogen];
                  const acceptor = structure.atoms[bond.acceptor];
                  const periodic = bond.acceptorImageShift.some((value) => value !== 0);
                  return <button type="button" className="hydrogen-bond-row" key={`${bond.hydrogen}-${bond.acceptor}-${index}`} onClick={() => selectAtom(bond.hydrogen)}>
                    <span className="hydrogen-bond-mark"><i /><b /></span>
                    <span className="hydrogen-bond-copy">
                      <strong>{donor.label}–{hydrogen.label}···{acceptor.label}</strong>
                      <small>H···A {bond.hydrogenAcceptorDistance.toFixed(2)} Å · D···A {bond.donorAcceptorDistance.toFixed(2)} Å · ∠ {bond.angle.toFixed(1)}°</small>
                    </span>
                    <span className={`hydrogen-bond-badge ${bond.kind}`}>
                      <b>{bond.kind === "intramolecular" ? "分子内" : "分子间"}</b>
                      <small>{hydrogenStrengthLabels[bond.strength]}{periodic ? " · 跨界" : ""}</small>
                    </span>
                  </button>;
                })}</div>}
          </section>

          <details className="hydrogen-reference" open>
            <summary>判据依据与解释</summary>
            <p><b>Steiner (2002)</b>：氢键强度连续、没有天然分界。若必须自动筛选，可考虑 H···A 至 3.0–3.2 Å；角度下限可取 90°，更保守取 110°。</p>
            <div className="hydrogen-guide-table">
              <span>几何引导值</span><b>强</b><b>中等</b><b>弱</b>
              <span>H···A / Å</span><em>1.2–1.5</em><em>1.5–2.2</em><em>&gt; 2.2</em>
              <span>D···A / Å</span><em>2.2–2.5</em><em>2.5–3.2</em><em>&gt; 3.2</em>
              <span>∠D–H···A</span><em>170–180°</em><em>&gt; 130°</em><em>&gt; 90°</em>
            </div>
            <p className="hydrogen-caution">几何命中只表示“候选”。IUPAC 2011 要求至少有实验或理论证据；电子密度、光谱、能量和化学环境可能改变结论。</p>
            <div className="hydrogen-links">
              <a href="https://doi.org/10.1002/1521-3773(20020104)41:1%3C48::AID-ANIE48%3E3.0.CO;2-U" target="_blank" rel="noreferrer">Steiner 2002 ↗</a>
              <a href="https://publications.iupac.org/pac/83/8/1637/index.html" target="_blank" rel="noreferrer">IUPAC 2011 ↗</a>
            </div>
          </details>
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
      {appearanceMenu && appearanceMenu.kind === "element" && (() => {
        const element = appearanceMenu.element;
        const style = resolvedElementStyle(element, elementAppearance);
        return <div
          ref={appearanceMenuRef}
          className="appearance-context-menu"
          role="dialog"
          aria-label={`${element} 元素外观设置`}
          style={{ left: appearanceMenu.x, top: appearanceMenu.y }}
        >
          <div className="appearance-menu-head">
            <i style={{ "--preview-color": style.color } as React.CSSProperties} />
            <span><strong>{element} 元素外观</strong><small>所有 {element} 原子与相连化学键实时更新</small></span>
          </div>
          <label className="appearance-color-row">
            <span>元素颜色</span>
            <input type="color" value={style.color} onChange={(event) => setElementAppearance((current) => ({
              ...current,
              [element]: { color: event.target.value, scale: current[element]?.scale ?? 1 },
            }))} />
            <code>{style.color.toUpperCase()}</code>
          </label>
          <label className="appearance-range-row">
            <span>原子球大小</span><output>{Math.round(style.scale * 100)}%</output>
            <input type="range" min="0.55" max="1.8" step="0.05" value={style.scale} onChange={(event) => setElementAppearance((current) => ({
              ...current,
              [element]: { color: current[element]?.color ?? elementStyle(element).color, scale: Number(event.target.value) },
            }))} />
          </label>
          <button type="button" className="appearance-reset" onClick={() => setElementAppearance((current) => {
            const next = { ...current };
            delete next[element];
            return next;
          })}>恢复 {element} 默认外观</button>
        </div>;
      })()}
      {appearanceMenu && appearanceMenu.kind === "axis" && <div
        ref={appearanceMenuRef}
        className="appearance-context-menu axis-appearance-menu"
        role="dialog"
        aria-label="坐标轴外观设置"
        style={{ left: appearanceMenu.x, top: appearanceMenu.y }}
      >
        <div className="appearance-menu-head axis-head">
          <div className="axis-miniature"><i /><b /><em /></div>
          <span><strong>坐标轴外观</strong><small>修改右下角 a、b、c 晶格方向标记</small></span>
        </div>
        <div className="axis-preview" style={{ fontFamily: axisFontFamilies[axisAppearance.font], fontSize: `${axisAppearance.fontSize}px` }}>
          <span>a</span><span>b</span><span>c</span>
        </div>
        <label className="appearance-range-row">
          <span>轴线粗细</span><output>{axisAppearance.lineWidth.toFixed(1)} px</output>
          <input type="range" min="0.6" max="4" step="0.1" value={axisAppearance.lineWidth} onChange={(event) => setAxisAppearance((current) => ({ ...current, lineWidth: Number(event.target.value) }))} />
        </label>
        <label className="appearance-range-row">
          <span>整体大小</span><output>{axisAppearance.length} px</output>
          <input type="range" min="14" max="52" step="1" value={axisAppearance.length} onChange={(event) => setAxisAppearance((current) => ({ ...current, length: Number(event.target.value) }))} />
        </label>
        <label className="appearance-select-row">
          <span>字母字体</span>
          <select value={axisAppearance.font} onChange={(event) => setAxisAppearance((current) => ({ ...current, font: event.target.value as AxisFont }))}>
            <option value="mono">等宽字体</option>
            <option value="sans">无衬线字体</option>
            <option value="serif">衬线字体</option>
          </select>
        </label>
        <label className="appearance-range-row">
          <span>字母大小</span><output>{axisAppearance.fontSize} px</output>
          <input type="range" min="7" max="20" step="1" value={axisAppearance.fontSize} onChange={(event) => setAxisAppearance((current) => ({ ...current, fontSize: Number(event.target.value) }))} />
        </label>
        <button type="button" className="appearance-reset" onClick={() => setAxisAppearance({ ...defaultAxisAppearance })}>恢复坐标轴默认外观</button>
      </div>}
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
            <span className="atom-swatch" style={{ "--atom-color": currentElementColor(atom.element) } as React.CSSProperties}>{atom.element}</span>
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
