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
import { characterTableForPointGroup, characterTables, normalizePointGroup } from "./character-tables";

type DisplaySettings = {
  atoms: boolean;
  hydrogens: boolean;
  bonds: boolean;
  hydrogenBonds: boolean;
  zClipping: boolean;
  cell: boolean;
  labels: boolean;
  symmetry: boolean;
  completeMolecules: boolean;
};

type ProjectedAtom = { index: number; x: number; y: number; radius: number; depth: number };
type Quaternion = [number, number, number, number];
type Language = "zh-CN" | "en-US";
type ViewPreset = "x" | "y" | "z" | "a" | "b" | "c";
type AtomFocusMode = "none" | "fade" | "isolate";
type AtomFocus = { mode: AtomFocusMode; sourceLabel: string | null };
type AtomContextMenu = { x: number; y: number; atomIndex: number };
type ElementAppearance = Record<string, { color: string; scale: number }>;
type AxisFont = "mono" | "sans" | "serif";
type AxisAppearance = { lineWidth: number; length: number; font: AxisFont; fontSize: number };
type AppearanceMenu = { kind: "element"; element: string; x: number; y: number } | { kind: "axis"; x: number; y: number };
type RightTab = "operations" | "characters" | "atoms" | "wyckoff" | "hydrogen" | "calculator";
type HydrogenPreset = "strict" | "steiner" | "broad";
type HydrogenBondAppearance = { color: string; lineWidth: number };
type SupercellSettings = { a: number; b: number; c: number };
type ZClippingSettings = { back: number; front: number; fade: number };
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
  zClipping: false,
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
const defaultSupercell: SupercellSettings = { a: 1, b: 1, c: 1 };
const defaultZClipping: ZClippingSettings = { back: 0, front: 100, fade: 14 };

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

function operationName(operation: SymmetryOperation, language: Language) {
  if (language === "zh-CN") return operation.name;
  if (operation.kind === "identity") return "Identity";
  if (operation.kind === "inversion") return "Inversion center";
  if (operation.kind === "mirror") return "Mirror reflection";
  if (operation.kind === "glide") return "Glide reflection";
  if (operation.kind === "screw") return `${operation.label} screw axis`;
  if (operation.kind === "rotation") return `${operation.order}-fold rotation`;
  return "Rotoinversion";
}

function operationTitle(operation: SymmetryOperation, language: Language) {
  return language === "en-US"
    ? `Operation ${operation.id} (${operationName(operation, language)})`
    : `操作 ${operation.id}（${operation.name}）`;
}

function operationKindText(kind: SymmetryOperation["kind"], language: Language) {
  if (language === "zh-CN") return operationKindLabel(kind);
  return {
    identity: "Identity",
    rotation: "Rotation axis",
    screw: "Screw axis",
    mirror: "Mirror plane",
    glide: "Glide plane",
    inversion: "Inversion",
    rotoinversion: "Rotoinversion",
  }[kind];
}

function crystalSystemText(value: string, language: Language) {
  if (language === "zh-CN") return value.replace("晶系", "");
  const systems: Record<string, string> = {
    "三斜": "Triclinic", "三斜晶系": "Triclinic",
    "单斜": "Monoclinic", "单斜晶系": "Monoclinic",
    "正交": "Orthorhombic", "正交晶系": "Orthorhombic",
    "四方": "Tetragonal", "四方晶系": "Tetragonal",
    "三方": "Trigonal", "三方晶系": "Trigonal",
    "六方": "Hexagonal", "六方晶系": "Hexagonal",
    "立方": "Cubic", "立方晶系": "Cubic",
  };
  return systems[value] ?? value.replace("晶系", "");
}

function hydrogenStrengthText(strength: HydrogenBond["strength"], language: Language) {
  if (language === "en-US") return { strong: "Strong", moderate: "Moderate", weak: "Weak" }[strength];
  return { strong: "强", moderate: "中等", weak: "弱" }[strength];
}

function IrrepLabel({ value }: { value: string }) {
  const [symbol, suffix] = value.split("_");
  return <>{symbol}{suffix && <sub>{suffix}</sub>}</>;
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

function colorWithAlpha(color: string, opacity: number) {
  const alpha = Math.max(0, Math.min(1, opacity));
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (hex) {
    const [red, green, blue] = hex.slice(1).map((value) => Number.parseInt(value, 16));
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    const sourceAlpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${sourceAlpha * alpha})`;
  }
  return color;
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
  zClipping,
  language,
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
  zClipping: ZClippingSettings;
  language: Language;
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
  const english = language === "en-US";

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

    const projectRotated = (rotated: Vec3) => {
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
    const project = (point: Vec3) => projectRotated(rotate(point));

    const baseDisplayFracts = display.completeMolecules
      ? molecularDisplayFracts(structure.atoms, structure.bonds)
      : structure.atoms.map((atom) => atom.fract);
    const displayAtoms = buildDisplayAtomInstances(structure, baseDisplayFracts, supercell, display.completeMolecules);
    const displayAtomMap = new Map(displayAtoms.map((instance) => [`${instance.translationKey}:${instance.index}`, instance]));
    const displayTranslations = [...new Map(displayAtoms.map((instance) => [instance.translationKey, instance.translation])).values()];
    const instancesByAtom = new Map<number, DisplayAtomInstance[]>();
    displayAtoms.forEach((instance) => instancesByAtom.set(instance.index, [...(instancesByAtom.get(instance.index) ?? []), instance]));

    const atomDepths = displayAtoms.map((instance) => rotate(instance.cart)[2]);
    const minimumAtomDepth = atomDepths.length ? Math.min(...atomDepths) : -1;
    const maximumAtomDepth = atomDepths.length ? Math.max(...atomDepths) : 1;
    const atomDepthSpan = Math.max(1e-6, maximumAtomDepth - minimumAtomDepth);
    const clippingMinimum = minimumAtomDepth + atomDepthSpan * zClipping.back / 100;
    const clippingMaximum = minimumAtomDepth + atomDepthSpan * zClipping.front / 100;
    const fadeDepth = Math.min(
      atomDepthSpan * zClipping.fade / 100,
      Math.max(1e-6, (clippingMaximum - clippingMinimum) / 2),
    );
    const smoothstep = (value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      return clamped * clamped * (3 - 2 * clamped);
    };
    const depthOpacity = (depth: number) => {
      if (!display.zClipping) return 1;
      if (zClipping.back > 0 && depth <= clippingMinimum) return 0;
      if (zClipping.front < 100 && depth >= clippingMaximum) return 0;
      const backFade = zClipping.back <= 0 ? 1 : smoothstep((depth - clippingMinimum) / fadeDepth);
      const frontFade = zClipping.front >= 100 ? 1 : smoothstep((clippingMaximum - depth) / fadeDepth);
      return Math.min(backFade, frontFade);
    };
    const depthVisible = (depth: number) => depthOpacity(depth) > 0.002;
    const depthStrokeStyle = (
      start: ReturnType<typeof projectRotated>,
      end: ReturnType<typeof projectRotated>,
      color: string,
    ) => {
      if (!display.zClipping) return color;
      const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
      gradient.addColorStop(0, colorWithAlpha(color, depthOpacity(start.depth)));
      gradient.addColorStop(1, colorWithAlpha(color, depthOpacity(end.depth)));
      return gradient;
    };
    const clipSegmentToDepth = (start: Vec3, end: Vec3) => {
      const a = rotate(start);
      const b = rotate(end);
      if (!display.zClipping) return [projectRotated(a), projectRotated(b)] as const;
      let startT = 0;
      let endT = 1;
      const deltaDepth = b[2] - a[2];
      for (const [boundary, keepAbove] of [[clippingMinimum, true], [clippingMaximum, false]] as const) {
        const aInside = keepAbove ? a[2] >= boundary : a[2] <= boundary;
        const bInside = keepAbove ? b[2] >= boundary : b[2] <= boundary;
        if (!aInside && !bInside) return null;
        if (aInside === bInside) continue;
        const intersection = (boundary - a[2]) / deltaDepth;
        if (!aInside) startT = Math.max(startT, intersection);
        else endT = Math.min(endT, intersection);
      }
      if (startT > endT) return null;
      const interpolate = (t: number): Vec3 => a.map((value, axis) => value + (b[axis] - value) * t) as Vec3;
      return [projectRotated(interpolate(startT)), projectRotated(interpolate(endT))] as const;
    };
    const clipPolygonToDepth = (points: Vec3[]) => {
      let polygon = points.map(rotate);
      if (!display.zClipping) return polygon.map(projectRotated);
      const clipAtBoundary = (input: Vec3[], boundary: number, keepAbove: boolean) => {
        const output: Vec3[] = [];
        input.forEach((current, index) => {
          const previous = input[(index + input.length - 1) % input.length];
          const currentInside = keepAbove ? current[2] >= boundary : current[2] <= boundary;
          const previousInside = keepAbove ? previous[2] >= boundary : previous[2] <= boundary;
          if (currentInside !== previousInside) {
            const t = (boundary - previous[2]) / (current[2] - previous[2]);
            output.push(previous.map((value, axis) => value + (current[axis] - value) * t) as Vec3);
          }
          if (currentInside) output.push(current);
        });
        return output;
      };
      polygon = clipAtBoundary(polygon, clippingMinimum, true);
      if (!polygon.length) return [];
      polygon = clipAtBoundary(polygon, clippingMaximum, false);
      return polygon.map(projectRotated);
    };

    const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

    if (display.cell) {
      context.save();
      context.lineWidth = 1;
      const cellColor = "rgba(71, 85, 105, .34)";
      context.strokeStyle = cellColor;
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
              const segment = clipSegmentToDepth(corners[from], corners[to]);
              if (!segment) continue;
              const [a, b] = segment;
              context.strokeStyle = depthStrokeStyle(a, b, cellColor);
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
        const axisStart = vectorAdd(axisOrigin, vectorScale(axisCart, -span));
        const axisEnd = vectorAdd(axisOrigin, vectorScale(axisCart, span));
        const axisSegment = clipSegmentToDepth(axisStart, axisEnd);
        const [a, b] = axisSegment ?? [project(axisStart), project(axisEnd)];
        const symmetryAxisColor = "rgba(168, 105, 18, .62)";
        context.strokeStyle = symmetryAxisColor;
        context.lineWidth = 1.4;
        context.setLineDash([6, 5]);
        if (axisSegment) {
          context.strokeStyle = depthStrokeStyle(a, b, symmetryAxisColor);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
        context.setLineDash([]);

        if (selectedOperation.kind === "screw") {
          const helper: Vec3 = Math.abs(axisCart[2]) < 0.82 ? [0, 0, 1] : [0, 1, 0];
          const u = normalize(cross(axisCart, helper));
          const v = normalize(cross(axisCart, u));
          const radius = baseMaxCell * 0.055;
          const turns = Math.max(1.6, selectedOperation.order * 0.82);
          const helixWorldPoints = Array.from({ length: 97 }, (_, index) => {
            const t = index / 96;
            const angle = t * Math.PI * 2 * turns;
            const axial = vectorScale(axisCart, (t - 0.5) * span * 1.75);
            const radial = vectorAdd(vectorScale(u, Math.cos(angle) * radius), vectorScale(v, Math.sin(angle) * radius));
            return vectorAdd(axisOrigin, vectorAdd(axial, radial));
          });
          const helixSegments = helixWorldPoints.slice(1).map((point, index) => clipSegmentToDepth(helixWorldPoints[index], point)).filter((segment) => segment !== null);

          const helixOutlineColor = "rgba(255, 255, 255, .92)";
          context.strokeStyle = helixOutlineColor;
          context.lineWidth = 5.5;
          context.lineJoin = "round";
          helixSegments.forEach(([start, end]) => {
            context.strokeStyle = depthStrokeStyle(start, end, helixOutlineColor);
            context.beginPath();
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
            context.stroke();
          });
          const helixColor = "#b76f12";
          context.strokeStyle = helixColor;
          context.lineWidth = 2.8;
          helixSegments.forEach(([start, end]) => {
            context.strokeStyle = depthStrokeStyle(start, end, helixColor);
            context.beginPath();
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
            context.stroke();
          });

          const lastHelixSegment = helixSegments[helixSegments.length - 1];
          if (lastHelixSegment) {
            const [arrowFrom, arrowTip] = lastHelixSegment;
            context.globalAlpha = depthOpacity(arrowTip.depth);
            const arrowAngle = Math.atan2(arrowTip.y - arrowFrom.y, arrowTip.x - arrowFrom.x);
            context.fillStyle = "#b76f12";
            context.beginPath();
            context.moveTo(arrowTip.x, arrowTip.y);
            context.lineTo(arrowTip.x - 10 * Math.cos(arrowAngle - 0.5), arrowTip.y - 10 * Math.sin(arrowAngle - 0.5));
            context.lineTo(arrowTip.x - 10 * Math.cos(arrowAngle + 0.5), arrowTip.y - 10 * Math.sin(arrowAngle + 0.5));
            context.closePath();
            context.fill();
            const label = english
              ? `${selectedOperation.label}  ·  rotate ${Math.round(360 / selectedOperation.order)}°  +  translate ${screwTranslationText(selectedOperation, axisFract)} along axis`
              : `${selectedOperation.label}  ·  旋转 ${Math.round(360 / selectedOperation.order)}°  +  轴向平移 ${screwTranslationText(selectedOperation, axisFract)}`;
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
            context.globalAlpha = 1;
          }
        } else {
          if (axisSegment) {
            context.fillStyle = "#b7791f";
            context.beginPath();
            context.arc(b.x, b.y, 4, 0, Math.PI * 2);
            context.fill();
          }
        }
      } else if (["mirror", "glide"].includes(selectedOperation.kind)) {
        const normalFract = findEigenDirection(selectedOperation, -1);
        const normal = normalize(fractToCart(normalFract, structure.cell));
        const helper: Vec3 = Math.abs(normal[2]) < 0.8 ? [0, 0, 1] : [0, 1, 0];
        const u = normalize(cross(normal, helper));
        const v = normalize(cross(normal, u));
        const span = maxCell * 0.52;
        const plane = clipPolygonToDepth([
          vectorAdd(center, vectorAdd(vectorScale(u, -span), vectorScale(v, -span))),
          vectorAdd(center, vectorAdd(vectorScale(u, span), vectorScale(v, -span))),
          vectorAdd(center, vectorAdd(vectorScale(u, span), vectorScale(v, span))),
          vectorAdd(center, vectorAdd(vectorScale(u, -span), vectorScale(v, span))),
        ]);
        context.fillStyle = "rgba(183, 121, 31, .08)";
        context.strokeStyle = "rgba(183, 121, 31, .62)";
        context.lineWidth = 1;
        if (plane.length >= 3) {
          context.globalAlpha = plane.reduce((sum, point) => sum + depthOpacity(point.depth), 0) / plane.length;
          context.beginPath();
          context.moveTo(plane[0].x, plane[0].y);
          plane.slice(1).forEach((point) => context.lineTo(point.x, point.y));
          context.closePath();
          context.fill();
          context.stroke();
        }
      } else if (selectedOperation.kind === "inversion") {
        const rotatedCenter = rotate(center);
        if (depthVisible(rotatedCenter[2])) {
          const point = projectRotated(rotatedCenter);
          context.globalAlpha = depthOpacity(point.depth);
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
          const segment = clipSegmentToDepth(instanceA.cart, instanceB.cart);
          if (!segment) continue;
          const [a, b] = segment;
          const midpoint = {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            depth: (a.depth + b.depth) / 2,
            factor: (a.factor + b.factor) / 2,
          };
          const lineWidth = Math.max(2.2, Math.min(7, (a.factor + b.factor) * worldScale * 0.13));
          context.globalAlpha = atomFocus.mode === "fade" ? (focusA && focusB ? 1 : focusA || focusB ? 0.42 : 0.07) : 1;
          const bondOutlineColor = "rgba(51, 65, 85, .26)";
          context.strokeStyle = depthStrokeStyle(a, b, bondOutlineColor);
          context.lineWidth = lineWidth + 1.8;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();

          context.lineWidth = lineWidth;
          const atomAColor = shadeHex(resolvedElementStyle(atomA.element, elementAppearance).color, 0.06);
          context.strokeStyle = depthStrokeStyle(a, midpoint, atomAColor);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(midpoint.x, midpoint.y);
          context.stroke();
          const atomBColor = shadeHex(resolvedElementStyle(atomB.element, elementAppearance).color, 0.06);
          context.strokeStyle = depthStrokeStyle(midpoint, b, atomBColor);
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
          const segment = clipSegmentToDepth(hydrogenInstance.cart, acceptorImageCart);
          if (!segment) continue;
          const [start, end] = segment;
          const focused = focusD || focusH || focusA;
          const focusOpacity = atomFocus.mode === "fade" ? (focused ? 1 : 0.08) : 0.94;
          context.globalAlpha = focusOpacity;
          const hydrogenBondOutlineColor = "rgba(255, 255, 255, .96)";
          context.strokeStyle = depthStrokeStyle(start, end, hydrogenBondOutlineColor);
          context.lineWidth = hydrogenBondAppearance.lineWidth + 2.6;
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.stroke();
          context.strokeStyle = depthStrokeStyle(start, end, hydrogenBondAppearance.color);
          context.lineWidth = hydrogenBondAppearance.lineWidth;
          context.stroke();

          const hasDisplayedAcceptor = (instancesByAtom.get(hydrogenBond.acceptor) ?? []).some((instance) => Math.hypot(
            acceptorImageCart[0] - instance.cart[0],
            acceptorImageCart[1] - instance.cart[1],
            acceptorImageCart[2] - instance.cart[2],
          ) <= 0.24);
          if (!hasDisplayedAcceptor && depthVisible(rotate(acceptorImageCart)[2])) {
            context.globalAlpha = focusOpacity * depthOpacity(end.depth);
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
      const sourceCart = fractToCart(selectedAtom.source.fract.map((value, axis) => value + selectedTranslation[axis]) as Vec3, structure.cell);
      const targetCart = fractToCart(baseDisplayFracts[selectedAtomIndex].map((value, axis) => value + selectedTranslation[axis]) as Vec3, structure.cell);
      const mappingSegment = clipSegmentToDepth(sourceCart, targetCart);
      if (mappingSegment) {
        const [source, target] = mappingSegment;
        context.save();
        const mappingColor = "rgba(15, 139, 141, .76)";
        context.strokeStyle = depthStrokeStyle(source, target, mappingColor);
        context.fillStyle = "#0f8b8d";
        context.lineWidth = 1.5;
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
        context.setLineDash([]);
        context.globalAlpha = depthOpacity(target.depth);
        const angle = Math.atan2(target.y - source.y, target.x - source.x);
        context.beginPath();
        context.moveTo(target.x, target.y);
        context.lineTo(target.x - 9 * Math.cos(angle - 0.45), target.y - 9 * Math.sin(angle - 0.45));
        context.lineTo(target.x - 9 * Math.cos(angle + 0.45), target.y - 9 * Math.sin(angle + 0.45));
        context.closePath();
        context.fill();
        if (Math.hypot(target.x - source.x, target.y - source.y) > 30) {
          context.font = "600 11px ui-monospace, monospace";
          context.fillText(`${english ? "Operation" : "操作"} ${selectedOperation.id}`, (source.x + target.x) / 2 + 5, (source.y + target.y) / 2 - 5);
        }
        context.restore();
      }
    }

    const atoms = displayAtoms.map(({ atom, index, cart }) => ({ atom, index, projection: project(cart) }))
      .filter(({ projection }) => depthVisible(projection.depth))
      .sort((a, b) => a.projection.depth - b.projection.depth);
    const hitTargets: ProjectedAtom[] = [];
    if (display.atoms) {
      for (const { atom, index, projection } of atoms) {
        if (!display.hydrogens && atom.element === "H") continue;
        const focused = matchesFocus(atom);
        if (atomFocus.mode === "isolate" && !focused) continue;
        const style = resolvedElementStyle(atom.element, elementAppearance);
        const radius = Math.max(3.2, Math.min(22, style.radius * style.scale * projection.factor * worldScale * 0.9));
        const clippingOpacity = depthOpacity(projection.depth);
        if (clippingOpacity > 0.08) hitTargets.push({ index, x: projection.x, y: projection.y, radius: radius + 5, depth: projection.depth });
        context.save();
        const focusOpacity = atomFocus.mode === "fade" && !focused ? 0.12 : 1;
        context.globalAlpha = focusOpacity * clippingOpacity;
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
  }, [structure, hydrogenBonds, hydrogenBondAppearance, supercell, zClipping, language, display, selectedAtomIndex, selectedOperation, atomFocus, elementAppearance, axisAppearance, orthographic, viewVersion, english]);

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
        aria-label={english ? "Rotatable 3D crystal structure; drag to rotate, use the mouse wheel to zoom, and click to select an atom" : "可旋转的晶体结构三维视图；拖拽旋转，滚轮缩放，点击选择原子"}
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
          <div className="view-chip"><span className="live-dot" /> {english ? "Interactive cell" : "交互晶胞"}</div>
          <div className={isCrystallographicSupercell(supercell) ? "supercell-chip" : "supercell-chip fractional"}>
            <i />{isCrystallographicSupercell(supercell) ? (english ? "Supercell" : "超胞") : (english ? "Fractional range" : "分数范围")} {supercellText(supercell)}
          </div>
          {display.zClipping && <div className="z-clipping-chip"><i /> Z fade {zClipping.back}–{zClipping.front}% · {zClipping.fade}%</div>}
          {display.hydrogenBonds && <div
            className="hydrogen-bond-chip"
            style={{ "--hbond-view-color": hydrogenBondAppearance.color } as React.CSSProperties}
          ><i /> {english ? "H-bond candidates" : "氢键候选"} {hydrogenBonds.length}</div>}
          {atomFocus.mode !== "none" && <div className="focus-chip">
            <span>{atomFocus.mode === "fade" ? (english ? "Focus" : "聚焦") : (english ? "Isolate" : "单独显示")} · {atomFocus.sourceLabel}</span>
            <button type="button" onClick={onClearAtomFocus}>{english ? "Show all" : "恢复全部"}</button>
          </div>}
        </div>
        <div className="canvas-control-stack">
          <div className="canvas-actions">
            <button type="button" className={!orthographic ? "active" : ""} onClick={() => setOrthographic(false)}>{english ? "Perspective" : "透视"}</button>
            <button type="button" className={orthographic ? "active" : ""} onClick={() => setOrthographic(true)}>{english ? "Orthographic" : "正交"}</button>
            <button type="button" onClick={resetView} aria-label={english ? "Reset view" : "复位视图"}>↺</button>
          </div>
          <div className="view-presets" aria-label={english ? "Preset viewing directions" : "定向观察视图"}>
            <span>{english ? "Cartesian" : "笛卡尔"}</span>
            {(["x", "y", "z"] as ViewPreset[]).map((preset) => <button
              type="button"
              key={preset}
              className={viewPreset === preset ? "active cartesian" : "cartesian"}
              title={english ? `View along Cartesian +${preset}` : `沿笛卡尔 +${preset} 方向观察`}
              aria-label={english ? `View along positive Cartesian ${preset}` : `沿笛卡尔正 ${preset} 方向观察`}
              onClick={() => selectPresetView(preset)}
            >{preset}</button>)}
            <i />
            <span>{english ? "Lattice" : "晶格"}</span>
            {(["a", "b", "c"] as ViewPreset[]).map((preset) => <button
              type="button"
              key={preset}
              className={viewPreset === preset ? `active lattice ${preset}` : `lattice ${preset}`}
              title={english ? `View along lattice +${preset}` : `沿晶格 +${preset} 方向观察`}
              aria-label={english ? `View along positive lattice ${preset}` : `沿晶格正 ${preset} 方向观察`}
              onClick={() => selectPresetView(preset)}
            >{preset}</button>)}
          </div>
        </div>
      </div>
      <div className="element-legend" aria-label={english ? "Element color legend" : "元素颜色图例"}>
        <div className="element-legend-head"><span>{english ? "Element legend" : "元素图例"}</span><small>{english ? "Click or right-click to edit" : "单击或右键编辑"}</small></div>
        <div className="element-legend-items">
          {legendElements.map(([element, count]) => {
            const style = resolvedElementStyle(element, elementAppearance);
            return <button
              type="button"
              key={element}
              title={english ? `Edit ${element} color and atom size` : `编辑 ${element} 的颜色和原子大小`}
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
      <div className="gesture-hint">{english ? "Drag to rotate · Wheel to zoom · Left-click to select · Right-click to focus / edit axes" : "拖拽旋转 · 滚轮缩放 · 左键选择 · 右键聚焦 / 编辑坐标轴"}</div>
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
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [display, setDisplay] = useState(defaultDisplay);
  const [supercell, setSupercell] = useState<SupercellSettings>(defaultSupercell);
  const [zClipping, setZClipping] = useState<ZClippingSettings>(defaultZClipping);
  const [selectedAtomIndex, setSelectedAtomIndex] = useState(0);
  const [selectedOperationId, setSelectedOperationId] = useState(1);
  const [rightTab, setRightTab] = useState<RightTab>("operations");
  const [characterPointGroup, setCharacterPointGroup] = useState(() => structure.pointGroup);
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
  const english = language === "en-US";
  const text = (zh: string, en: string) => english ? en : zh;

  useEffect(() => {
    const stored = window.localStorage.getItem("symviz-language");
    if (stored !== "en-US" && stored !== "zh-CN") return;
    const frame = window.requestAnimationFrame(() => {
      setLanguage(stored);
      setNotice("");
      document.documentElement.lang = stored;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setNotice("");
    window.localStorage.setItem("symviz-language", nextLanguage);
    document.documentElement.lang = nextLanguage;
  }

  const selectedAtom = structure.atoms[Math.min(selectedAtomIndex, structure.atoms.length - 1)];
  const selectedOperation = structure.operations.find((operation) => operation.id === selectedOperationId) ?? structure.operations[0];
  const selectedCharacterTable = useMemo(() => characterTableForPointGroup(characterPointGroup), [characterPointGroup]);
  const wyckoffSites = useMemo(() => {
    const generatedCounts = new Map<string, number>();
    structure.atoms.forEach((atom) => {
      generatedCounts.set(atom.source.label, (generatedCounts.get(atom.source.label) ?? 0) + 1);
    });
    return structure.sites.map((site) => {
      const generatedMultiplicity = generatedCounts.get(site.label) ?? 0;
      const multiplicity = site.multiplicity ?? generatedMultiplicity;
      const letter = site.wyckoff !== "—" && site.wyckoff !== "?" ? site.wyckoff : null;
      const symmetryRatio = generatedMultiplicity ? structure.operations.length / generatedMultiplicity : 0;
      const siteSymmetryOrder = symmetryRatio && Math.abs(symmetryRatio - Math.round(symmetryRatio)) < 1e-6
        ? Math.round(symmetryRatio)
        : null;
      const positionType = siteSymmetryOrder === 1
        ? (english ? "General position" : "一般位置")
        : siteSymmetryOrder && siteSymmetryOrder > 1
          ? (english ? "Special position" : "特殊位置")
          : (english ? "Position type pending" : "位置类型待定");
      return {
        site,
        generatedMultiplicity,
        multiplicity,
        letter,
        siteSymmetryOrder,
        positionType,
        multiplicitySource: site.multiplicity ? (english ? "From CIF" : "CIF 提供") : (english ? "Calculated" : "由对称操作算得"),
      };
    });
  }, [structure, english]);
  const selectedWyckoffInfo = selectedAtom
    ? wyckoffSites.find(({ site }) => site.label === selectedAtom.source.label)
    : undefined;
  const missingWyckoffCount = wyckoffSites.filter(({ letter }) => !letter).length;
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
      setNotice(text("请选择 .cif 格式的晶体结构文件", "Please select a crystal structure file in .cif format"));
      return;
    }
    try {
      const text = await file.text();
      const next = parseCif(text);
      setStructure(next);
      setFileName(file.name);
      setSelectedAtomIndex(0);
      setSelectedOperationId(next.operations[0]?.id ?? 1);
      setCharacterPointGroup(next.pointGroup);
      setCalculatorOperationId(next.operations[0]?.id ?? 1);
      setCalculatorInput(next.sites[0]
        ? next.sites[0].fract.map((value) => value.toFixed(6)) as [string, string, string]
        : ["0", "0", "0"]);
      setAtomFocus({ mode: "none", sourceLabel: null });
      setContextMenu(null);
      setAppearanceMenu(null);
      setNotice(english
        ? `Parsed ${next.atoms.length} equivalent atoms and ${next.operations.length} symmetry operations`
        : `已解析 ${next.atoms.length} 个等价原子与 ${next.operations.length} 个对称操作`);
    } catch (error) {
      setNotice(english ? "Could not parse the CIF. Please check the file format." : (error instanceof Error ? error.message : "CIF 解析失败，请检查文件格式"));
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

  function updateZClipping(side: keyof ZClippingSettings, value: number) {
    setZClipping((current) => {
      if (side === "back") return { ...current, back: Math.min(value, current.front - 2) };
      if (side === "front") return { ...current, front: Math.max(value, current.back + 2) };
      return { ...current, fade: Math.max(1, Math.min(40, value)) };
    });
  }

  function applySupercellPreset(a: number, b: number, c: number) {
    setSupercell({ a, b, c });
    setNotice(english ? `Display range set to ${supercellText({ a, b, c })}` : `显示范围已设为 ${supercellText({ a, b, c })}`);
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
    setNotice(text("对称性报告已导出", "Symmetry report exported"));
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
          <div className="language-switch" role="group" aria-label={text("界面语言", "Interface language")}>
            <button type="button" className={language === "zh-CN" ? "active" : ""} onClick={() => changeLanguage("zh-CN")}>中文</button>
            <button type="button" className={language === "en-US" ? "active" : ""} title="English (US)" onClick={() => changeLanguage("en-US")}>EN-US</button>
          </div>
          <button type="button" className="ghost-button" onClick={exportReport}>⇩ {text("导出报告", "Export report")}</button>
          <button type="button" className="primary-button" onClick={() => inputRef.current?.click()}>＋ {text("打开 CIF", "Open CIF")}</button>
          <input ref={inputRef} type="file" accept=".cif,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.target.value = ""; }} />
        </div>
      </header>

      <aside className="left-panel panel-scroll">
        <div className="drawer-control">
          <button
            type="button"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? text("展开左侧边栏", "Expand left sidebar") : text("收起左侧边栏", "Collapse left sidebar")}
            title={sidebarCollapsed ? text("展开左侧边栏", "Expand left sidebar") : text("收起左侧边栏", "Collapse left sidebar")}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
            {!sidebarCollapsed && <b>{text("收起边栏", "Collapse")}</b>}
          </button>
        </div>
        <section className="upload-card" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") inputRef.current?.click(); }}>
          <div className="upload-icon">⌁</div>
          <div><strong>{text("载入新的 CIF", "Load a new CIF")}</strong><small>{text("拖放文件，或点击浏览", "Drop a file or click to browse")}</small></div>
          <span>⌘O</span>
        </section>

        <section className="side-section">
          <div className="section-heading"><span>{text("结构概览", "Structure overview")}</span><small>ASYMMETRIC UNIT</small></div>
          <div className="formula-card">
            <div><span>{text("化学式 · 常规 / Hill 顺序", "Formula · conventional / Hill order")}</span><strong>{structure.formula}</strong></div>
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
          <div className="section-heading"><span>{text("超胞 / 显示范围", "Supercell / display range")}</span><small>SUPERCELL</small></div>
          <div className="supercell-card">
            <div className="supercell-presets" aria-label={text("常用超胞预设", "Common supercell presets")}>
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
                  aria-label={english ? `${axis}-axis display multiplier` : `${axis} 方向显示倍数`}
                  onChange={(event) => updateSupercellExtent(axis, Number(event.target.value))}
                />
              </label>)}
            </div>
            <div className={isCrystallographicSupercell(supercell) ? "supercell-status" : "supercell-status fractional"}>
              <i>{isCrystallographicSupercell(supercell) ? "✓" : "≈"}</i>
              <span><strong>{isCrystallographicSupercell(supercell) ? text("晶体学超胞", "Crystallographic supercell") : text("分数显示范围", "Fractional display range")}</strong><small>{isCrystallographicSupercell(supercell)
                ? (english ? `${supercell.a * supercell.b * supercell.c} unit cells · ${displayedAtomCount} atoms displayed` : `${supercell.a * supercell.b * supercell.c} 个原胞 · 当前显示 ${displayedAtomCount} 原子`)
                : (english ? `Clip the view at ${supercellText(supercell)} without changing lattice periodicity` : `按 ${supercellText(supercell)} 裁切视图，不改变晶格周期`)}</small></span>
            </div>
            <p className="supercell-note">{text("可输入 0.25–6；整数倍构成周期超胞，非整数倍用于观察指定分数范围。", "Enter 0.25–6. Integers create periodic supercells; fractional values define a viewing range.")}</p>
          </div>
        </section>

        <section className="side-section display-section">
          <div className="section-heading"><span>{text("显示控制", "Display controls")}</span><small>VIEW LAYERS</small></div>
          <Toggle label={text("原子球（哑光 CPK）", "Atoms (matte CPK)")} hint={english ? `${structure.atoms.length} equivalent atoms` : `${structure.atoms.length} 个等价原子`} checked={display.atoms} onChange={() => toggleDisplay("atoms")} />
          <Toggle
            label={text("显示氢原子", "Show hydrogen atoms")}
            hint={display.hydrogens ? (english ? `${hydrogenAtomCount} H atoms` : `${hydrogenAtomCount} 个 H`) : (english ? `${hydrogenAtomCount} H atoms hidden` : `${hydrogenAtomCount} 个 H 已隐藏`)}
            checked={display.hydrogens}
            onChange={() => toggleDisplay("hydrogens")}
          />
          <Toggle label={text("化学键（球棍）", "Chemical bonds (ball-and-stick)")} hint={english ? `${structure.bonds.length} covalent neighbor pairs` : `${structure.bonds.length} 组共价近邻`} checked={display.bonds} onChange={() => toggleDisplay("bonds")} />
          <Toggle
            label={text("氢键候选", "Hydrogen-bond candidates")}
            hint={english ? `${hydrogenBonds.length} · intramolecular ${hydrogenBondSummary.intramolecular} / intermolecular ${hydrogenBondSummary.intermolecular}` : `${hydrogenBonds.length} 条 · 分子内 ${hydrogenBondSummary.intramolecular} / 分子间 ${hydrogenBondSummary.intermolecular}`}
            checked={display.hydrogenBonds}
            onChange={() => {
              toggleDisplay("hydrogenBonds");
              if (!display.hydrogenBonds) setRightTab("hydrogen");
            }}
          />
          <Toggle label={text("补全分子片段", "Complete molecular fragments")} hint={display.completeMolecules ? text("跨晶胞键已重新拼接", "Bonds across cell boundaries reconnected") : text("当前按晶胞边界截断", "Clipped at unit-cell boundaries")} checked={display.completeMolecules} onChange={() => toggleDisplay("completeMolecules")} />
          <Toggle label={text("晶胞边界", "Unit-cell boundaries")} hint={supercellText(supercell)} checked={display.cell} onChange={() => toggleDisplay("cell")} />
          <Toggle label={text("原子标签", "Atom labels")} hint={text("元素与编号", "Element and index")} checked={display.labels} onChange={() => toggleDisplay("labels")} />
          <Toggle label={text("对称元素", "Symmetry elements")} hint={text("轴 / 面 / 映射轨迹", "Axes / planes / mapping path")} checked={display.symmetry} onChange={() => toggleDisplay("symmetry")} />
          <Toggle
            label="Z clipping / fade"
            hint={display.zClipping ? (english ? `Fade across ${zClipping.back}–${zClipping.front}% along the view direction` : `沿观察方向在 ${zClipping.back}–${zClipping.front}% 内渐隐`) : text("沿当前观察方向平滑虚化深度", "Fade depth smoothly along the current view direction")}
            checked={display.zClipping}
            onChange={() => toggleDisplay("zClipping")}
          />
          {display.zClipping && <div className="z-clipping-controls">
            <div className="z-clipping-head"><span>{text("深度渐隐范围", "Depth fade range")}</span><button type="button" onClick={() => setZClipping(defaultZClipping)}>{text("重置", "Reset")}</button></div>
            <label>
              <span>{text("后边界", "Back boundary")}<output>{zClipping.back}%</output></span>
              <input
                type="range"
                min="0"
                max="98"
                step="1"
                value={zClipping.back}
                aria-label={text("后渐隐边界", "Back fade boundary")}
                onChange={(event) => updateZClipping("back", Number(event.target.value))}
              />
            </label>
            <label>
              <span>{text("前边界", "Front boundary")}<output>{zClipping.front}%</output></span>
              <input
                type="range"
                min="2"
                max="100"
                step="1"
                value={zClipping.front}
                aria-label={text("前渐隐边界", "Front fade boundary")}
                onChange={(event) => updateZClipping("front", Number(event.target.value))}
              />
            </label>
            <label>
              <span>{text("渐隐宽度", "Feather width")}<output>{zClipping.fade}%</output></span>
              <input
                type="range"
                min="1"
                max="40"
                step="1"
                value={zClipping.fade}
                aria-label={text("渐隐过渡宽度", "Fade feather width")}
                onChange={(event) => updateZClipping("fade", Number(event.target.value))}
              />
            </label>
            <p>{text("边界内按渐隐宽度平滑虚化，越过边界后才完全隐藏；旋转晶体后会按新视角更新。", "Objects fade smoothly inside each boundary over the feather width and disappear only beyond it. The fade updates after rotation.")}</p>
          </div>}
        </section>

        <section className="side-section source-section">
          <div className="section-heading"><span>{text("数据完整性", "Data integrity")}</span><small>PARSE STATUS</small></div>
          <div className="status-line good"><i>✓</i><span>{text("晶胞参数", "Unit-cell parameters")}</span><strong>{text("完整", "Complete")}</strong></div>
          <div className="status-line good"><i>✓</i><span>{text("分数坐标", "Fractional coordinates")}</span><strong>{english ? `${structure.sites.length} sites` : `${structure.sites.length} 位点`}</strong></div>
          <div className={structure.warnings.length ? "status-line warn" : "status-line good"}><i>{structure.warnings.length ? "!" : "✓"}</i><span>{text("对称操作", "Symmetry operations")}</span><strong>{english ? `${structure.operations.length} entries` : `${structure.operations.length} 项`}</strong></div>
        </section>
      </aside>

      <section className="workspace">
        <div className="workspace-toolbar">
          <div className="mode-tabs"><button type="button" className="active">{text("结构 + 对称", "Structure + symmetry")}</button><button type="button">{text("操作轨迹", "Operation path")}</button></div>
          <div className="workspace-stats"><span><i />{displayedAtomCount} {text("显示原子", "displayed atoms")}</span><span>{structure.bonds.length} {text("键", "bonds")} · {hydrogenBonds.length} {text("氢键类型", "H-bond types")}</span><span>{supercellText(supercell)} · {display.completeMolecules ? text("完整分子", "complete molecules") : text("晶胞截断", "cell-clipped")}</span></div>
        </div>
        <CrystalCanvas
          structure={structure}
          hydrogenBonds={hydrogenBonds}
          hydrogenBondAppearance={hydrogenBondAppearance}
          supercell={supercell}
          zClipping={zClipping}
          language={language}
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
            <div><span className="eyebrow">SYMMETRY MAPPING</span><strong>{text("对称等价位置生成", "Symmetry-equivalent position generation")}</strong></div>
            <div className="story-tools">
              <details className="mapping-help">
                <summary>？ {text("说明", "Help")}</summary>
                {selectedAtom && <div className="mapping-help-box">
                  <p>{english ? <><b>{selectedAtom.source.label}</b>: CIF site label; <b>{selectedAtom.label}</b>: SymViz display index.</> : <><b>{selectedAtom.source.label}</b>：CIF 位点标签；<b>{selectedAtom.label}</b>：SymViz 生成编号。</>}</p>
                  <p>{text("中间公式变换坐标，结果按周期折回 [0, 1)。", "The central formula transforms the coordinates; the result is wrapped periodically into [0, 1).")}</p>
                </div>}
              </details>
              <span className="story-count">{english ? `Operation ${selectedOperation.id} / ${structure.operations.length}` : `操作 ${selectedOperation.id} / 共 ${structure.operations.length} 项`}</span>
            </div>
          </div>
          <div className="mapping-row">
            <div className="mapping-node source">
              <span><b>1</b>{text("CIF 原始位点", "Original CIF site")}</span>
              <strong>{selectedAtom?.source.label}</strong>
              <small>{text("CIF 标签 · 元素", "CIF label · element")} {selectedAtom?.element ?? "—"}</small>
              <em>{selectedAtom ? coordinateText(selectedAtom.source.fract) : "—"}</em>
            </div>
            <div className="mapping-operation">
              <span><b>2</b>{selectedOperation.label}</span>
              <div className="mapping-operation-copy">
                <strong>{operationTitle(selectedOperation, language)} · {operationKindText(selectedOperation.kind, language)}</strong>
                <code>{selectedOperation.xyz}</code>
              </div>
              <div className="mapping-arrow"><i style={{ width: `${completion}%` }} /></div>
            </div>
            <div className="mapping-node target">
              <span><b>3</b>{text("生成的等价原子", "Generated equivalent atom")}</span>
              <strong>{selectedAtom?.label}</strong>
              <small>{text("SymViz 编号", "SymViz index")}</small>
              <em>{coordinateText(transformedSelected as Vec3)}</em>
            </div>
          </div>
        </div>
      </section>

      <aside className="right-panel">
        <section className="group-hero">
          <div className="group-topline"><span>{text("空间群", "Space group")}</span><small>INTERNATIONAL TABLES</small></div>
          <div className="group-symbol"><strong>{prettyGroup(structure.spaceGroup)}</strong>{structure.spaceGroupNumber && <sup>#{structure.spaceGroupNumber}</sup>}</div>
          <div className="group-metadata">
            <div><span>{text("点群", "Point group")}</span><strong>{structure.pointGroup}</strong></div>
            <div><span>{text("晶系", "Crystal system")}</span><strong>{crystalSystemText(structure.crystalSystem, language)}</strong></div>
            <div><span>{text("操作数", "Operations")}</span><strong>{structure.operations.length}</strong></div>
          </div>
        </section>

        <nav className="right-tabs" aria-label={text("对称性信息", "Symmetry information")}>
          <button type="button" className={rightTab === "operations" ? "active" : ""} onClick={() => setRightTab("operations")}>{text("对称操作", "Operations")}</button>
          <button type="button" className={rightTab === "characters" ? "active" : ""} onClick={() => setRightTab("characters")}>{text("特征标表", "Character tables")}</button>
          <button type="button" className={rightTab === "atoms" ? "active" : ""} onClick={() => setRightTab("atoms")}>{text("原子轨迹", "Atom provenance")}</button>
          <button type="button" className={rightTab === "wyckoff" ? "active" : ""} onClick={() => setRightTab("wyckoff")}>Wyckoff</button>
          <button type="button" className={rightTab === "hydrogen" ? "active" : ""} onClick={() => setRightTab("hydrogen")}>{text("氢键", "H bonds")}</button>
          <button type="button" className={rightTab === "calculator" ? "active" : ""} onClick={() => setRightTab("calculator")}>{text("坐标计算器", "Coordinate calculator")}</button>
        </nav>

        {rightTab === "operations" && <div className="right-content panel-scroll">
          <div className="filter-row">
            {([['all', text('全部', 'All')], ['rotation', text('旋转', 'Rotations')], ['reflection', text('反射 / 反演', 'Reflections / inversion')]]).map(([value, label]) => (
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
                <span className="operation-copy"><strong>{operationTitle(operation, language)}</strong><code>{operation.xyz}</code></span>
                <span className="operation-kind">{operationKindText(operation.kind, language)}</span>
              </button>
            ))}
          </div>
          {selectedAtom && <div className="selected-detail">
            <div className="detail-head"><span style={{ "--atom-color": currentElementColor(selectedAtom.element) } as React.CSSProperties}><i />{selectedAtom.label}</span><small>{text("当前映射", "Current mapping")}</small></div>
            <div className="equation">
              <code>{coordinateText(selectedAtom.source.fract)}</code><b>— {text("操作", "Operation")} {selectedOperation.id} →</b><code>{coordinateText(transformedSelected as Vec3)}</code>
            </div>
            <div className="detail-grid">
              <span>{text("母位点", "Parent site")}<strong>{selectedAtom.source.label}</strong></span>
              <span>Wyckoff<strong className="wyckoff-value">{selectedWyckoffInfo?.letter
                ? `${selectedWyckoffInfo.multiplicity}${selectedWyckoffInfo.letter}`
                : `${selectedWyckoffInfo?.multiplicity ?? "—"} · ${text("字母未提供", "letter not provided")}`}</strong></span>
              <span>{text("占有率", "Occupancy")}<strong>{selectedAtom.source.occupancy.toFixed(2)}</strong></span>
            </div>
          </div>}
        </div>}

        {rightTab === "characters" && <div className="right-content panel-scroll character-panel">
          <div className="character-toolbar">
            <div>
              <span>{crystalSystemText(selectedCharacterTable.system, language)}{english ? " crystal system" : "晶系"}</span>
              <strong>{selectedCharacterTable.hm}<small>{selectedCharacterTable.schoenflies}</small></strong>
            </div>
            {normalizePointGroup(structure.pointGroup) !== selectedCharacterTable.hm && <button
              type="button"
              onClick={() => setCharacterPointGroup(structure.pointGroup)}
            >{text("返回当前点群", "Return to current point group")} {structure.pointGroup}</button>}
          </div>

          <label className="character-selector">
            <span>{text("浏览 32 个晶体学点群", "Browse the 32 crystallographic point groups")}</span>
            <select value={selectedCharacterTable.hm} onChange={(event) => setCharacterPointGroup(event.target.value)}>
              {(["三斜", "单斜", "正交", "四方", "三方", "六方", "立方"] as const).map((system) => <optgroup key={system} label={english ? `${crystalSystemText(system, language)} crystal system` : `${system}晶系`}>
                {characterTables.filter((table) => table.system === system).map((table) => <option key={table.hm} value={table.hm}>{table.hm} · {table.schoenflies}</option>)}
              </optgroup>)}
            </select>
          </label>

          <details className="character-help">
            <summary>？ {text("如何阅读特征标表", "How to read a character table")}</summary>
            <div>
              <p>{text("每列是一类共轭对称操作，每行是一种不可约表示；数字是表示矩阵的迹 χ。", "Each column is a conjugacy class of symmetry operations and each row is an irreducible representation; the numbers are traces χ of representation matrices.")}</p>
              <p>{text("χ(E) 等于表示维数。g/u 表示反演偶/奇，′/″ 表示对水平镜面对称/反对称。", "χ(E) is the representation dimension. g/u denote even/odd parity under inversion; ′/″ denote symmetry/antisymmetry under a horizontal mirror plane.")}</p>
              <p>{text("基函数采用主轴为 z 的常规方向；二维实表示合并共轭复表示。", "Basis functions use the conventional principal axis along z; two-dimensional real representations combine conjugate complex representations.")}</p>
            </div>
          </details>

          <div className="character-table-scroll">
            <table className="character-table">
              <thead><tr>
                <th>{text("不可约表示", "Irreducible representation")}</th>
                {selectedCharacterTable.classes.map((operationClass) => <th key={operationClass}>{operationClass}</th>)}
                <th>{text("常用基函数", "Common basis functions")}</th>
              </tr></thead>
              <tbody>{selectedCharacterTable.rows.map((characterRow) => <tr key={characterRow.irrep}>
                <th><IrrepLabel value={characterRow.irrep} /></th>
                {characterRow.characters.map((character, index) => <td key={`${characterRow.irrep}-${selectedCharacterTable.classes[index]}`}>{character < 0 ? `−${Math.abs(character)}` : character}</td>)}
                <td>{characterRow.basis || "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="character-source-note">{text("实基函数约定 · 主轴 z · R 表示轴矢量分量", "Real-basis convention · principal axis z · R denotes axial-vector components")}</p>
        </div>}

        {rightTab === "atoms" && <div className="right-content panel-scroll atom-trace-list">
          <div className="trace-intro"><span>{text("点击任一原子", "Select any atom")}</span><p>{text("查看它从不对称单元中的哪个位点、经由哪项操作生成。", "See which asymmetric-unit site and symmetry operation generated it.")}</p></div>
          {structure.atoms.slice(0, 240).map((atom, index) => (
            <button type="button" key={atom.id} className={selectedAtomIndex === index ? "atom-row active" : "atom-row"} onClick={() => selectAtom(index)}>
              <span className="atom-swatch" style={{ "--atom-color": currentElementColor(atom.element) } as React.CSSProperties}>{atom.element}</span>
              <span><strong>{atom.label}</strong><small>{coordinateText(atom.fract)}</small></span>
              <em>{text("操作", "Operation")} {atom.operationIds[0]}</em>
            </button>
          ))}
        </div>}

        {rightTab === "wyckoff" && <div className="right-content panel-scroll wyckoff-list">
          <details className="wyckoff-help">
            <summary>？ {text("什么是 Wyckoff 位置", "What is a Wyckoff position?")}</summary>
            <div>
              <p>{english ? <><b>Multiplicity</b>: the number of distinct equivalent positions generated from one independent site by the space-group operations.</> : <><b>多重性</b>：一个独立位点经空间群操作生成的不同等价位置数。</>}</p>
              <p>{english ? <><b>Letter</b>: the label assigned to each standard position of a space group in International Tables; it is not an arbitrary coordinate index.</> : <><b>字母</b>：International Tables 为每个空间群的标准位置分配的标签；不是从坐标随意生成的编号。</>}</p>
              <p>{english ? <><b>General / special position</b>: site-symmetry order 1 is general; an order greater than 1 is special.</> : <><b>一般 / 特殊位置</b>：位点对称阶为 1 时是一般位置；大于 1 时是特殊位置。</>}</p>
              {missingWyckoffCount > 0 && <p>{english ? <><b>Current CIF</b>: {missingWyckoffCount} sites do not provide a letter. SymViz calculates multiplicity but does not guess a standard letter.</> : <><b>当前 CIF</b>：{missingWyckoffCount} 个位点没有提供字母。SymViz 会补算多重性，但不会猜测标准字母。</>}</p>}
            </div>
          </details>
          <div className="trace-intro"><span>{english ? `${structure.sites.length} asymmetric sites` : `${structure.sites.length} 个不对称位点`}</span><p>{missingWyckoffCount > 0
            ? (english ? `${missingWyckoffCount} letters not provided · multiplicities calculated from symmetry operations` : `${missingWyckoffCount} 个字母未提供 · 多重性已由对称操作补算`)
            : text("CIF 已提供完整的 Wyckoff 标记", "The CIF provides complete Wyckoff labels")}</p></div>
          {wyckoffSites.map(({ site, letter, multiplicity, multiplicitySource, positionType, siteSymmetryOrder }) => {
            return <button type="button" className="wyckoff-card" key={site.label} onClick={() => {
              const index = structure.atoms.findIndex((atom) => atom.source.label === site.label);
              if (index >= 0) selectAtom(index);
            }}>
              <span className={letter ? "wyckoff-letter" : "wyckoff-letter missing"}>{letter ?? text("未提供", "Missing")}</span>
              <span><strong>{site.label} · {site.element}</strong><small>{coordinateText(site.fract)} · {positionType}{siteSymmetryOrder ? ` · ${text("对称阶", "symmetry order")} ${siteSymmetryOrder}` : ""}</small></span>
              <span className="wyckoff-count"><strong>{multiplicity}</strong><small>{multiplicitySource}</small></span>
            </button>;
          })}
        </div>}

        {rightTab === "hydrogen" && <div className="right-content panel-scroll hydrogen-panel">
          <div className="hydrogen-intro">
            <div className="hydrogen-intro-head">
              <span><i />{text("氢键几何筛选", "Hydrogen-bond geometry filter")}</span>
              <button
                type="button"
                role="switch"
                aria-checked={display.hydrogenBonds}
                className={display.hydrogenBonds ? "hydrogen-layer-toggle on" : "hydrogen-layer-toggle"}
                onClick={() => toggleDisplay("hydrogenBonds")}
              >{display.hydrogenBonds ? text("视图已显示", "Visible") : text("视图已隐藏", "Hidden")}</button>
            </div>
            <p>{text("自动搜索 D–H···A 周期近邻，并按共价连通片段区分分子内与分子间。虚线表示 H···A。", "Automatically searches periodic D–H···A neighbors and classifies intramolecular versus intermolecular contacts by covalent connectivity. Dashed lines represent H···A.")}</p>
            <div className="hydrogen-summary">
              <span><strong>{hydrogenBonds.length}</strong>{text("总候选", "Total")}</span>
              <span><strong>{hydrogenBondSummary.intramolecular}</strong>{text("分子内", "Intramolecular")}</span>
              <span><strong>{hydrogenBondSummary.intermolecular}</strong>{text("分子间", "Intermolecular")}</span>
            </div>
          </div>

          <section className="hydrogen-settings">
            <div className="hydrogen-section-head"><span>{text("筛选预设", "Filter presets")}</span><small>{hydrogenPreset === "custom" ? text("自定义", "Custom") : text("已应用", "Applied")}</small></div>
            <div className="hydrogen-presets">
              {([['strict', text('严格', 'Strict')], ['steiner', text('Steiner 保守', 'Steiner conservative')], ['broad', text('宽松', 'Broad')]] as Array<[HydrogenPreset, string]>).map(([preset, label]) => (
                <button type="button" key={preset} className={hydrogenPreset === preset ? "active" : ""} onClick={() => applyHydrogenBondPreset(preset)}>{label}</button>
              ))}
            </div>

            <div className="hydrogen-ranges">
              <label>
                <span>{text("H···A 最大距离", "Maximum H···A distance")}<output>{hydrogenBondCriteria.maxHydrogenAcceptorDistance.toFixed(1)} Å</output></span>
                <input type="range" min="1.8" max="3.2" step="0.1" value={hydrogenBondCriteria.maxHydrogenAcceptorDistance} onChange={(event) => updateHydrogenBondNumber("maxHydrogenAcceptorDistance", Number(event.target.value))} />
              </label>
              <label>
                <span>{text("D···A 最大距离", "Maximum D···A distance")}<output>{hydrogenBondCriteria.maxDonorAcceptorDistance.toFixed(1)} Å</output></span>
                <input type="range" min="2.4" max="4.2" step="0.1" value={hydrogenBondCriteria.maxDonorAcceptorDistance} onChange={(event) => updateHydrogenBondNumber("maxDonorAcceptorDistance", Number(event.target.value))} />
              </label>
              <label>
                <span>{text("D–H···A 最小角", "Minimum D–H···A angle")}<output>{hydrogenBondCriteria.minDonorHydrogenAcceptorAngle.toFixed(0)}°</output></span>
                <input type="range" min="80" max="175" step="5" value={hydrogenBondCriteria.minDonorHydrogenAcceptorAngle} onChange={(event) => updateHydrogenBondNumber("minDonorHydrogenAcceptorAngle", Number(event.target.value))} />
              </label>
            </div>

            <div className="hydrogen-appearance" style={{
              "--hbond-view-color": hydrogenBondAppearance.color,
              "--hbond-view-width": `${hydrogenBondAppearance.lineWidth}px`,
            } as React.CSSProperties}>
              <div className="hydrogen-appearance-head">
                <span>{text("虚线样式", "Dashed-line style")}</span>
                <i />
              </div>
              <label className="hydrogen-color-control">
                <span>{text("虚线颜色", "Line color")}</span>
                <input
                  type="color"
                  value={hydrogenBondAppearance.color}
                  aria-label={text("氢键虚线颜色", "Hydrogen-bond dashed-line color")}
                  onChange={(event) => setHydrogenBondAppearance((current) => ({ ...current, color: event.target.value }))}
                />
                <code>{hydrogenBondAppearance.color.toUpperCase()}</code>
              </label>
              <label className="hydrogen-width-control">
                <span>{text("虚线粗细", "Line width")}<output>{hydrogenBondAppearance.lineWidth.toFixed(1)} px</output></span>
                <input
                  type="range"
                  min="0.6"
                  max="5"
                  step="0.2"
                  value={hydrogenBondAppearance.lineWidth}
                  onChange={(event) => setHydrogenBondAppearance((current) => ({ ...current, lineWidth: Number(event.target.value) }))}
                />
              </label>
              <button type="button" onClick={() => setHydrogenBondAppearance(defaultHydrogenBondAppearance)}>{text("恢复虚线默认样式", "Restore default line style")}</button>
            </div>

            <div className="hydrogen-element-filter">
              <span>{text("供体 D–H", "Donors D–H")}</span>
              <div>{["O", "N", "S", "C"].map((element) => <button type="button" key={element} className={hydrogenBondCriteria.donorElements.includes(element) ? "active" : ""} onClick={() => toggleHydrogenBondElement("donorElements", element)}>{element}–H</button>)}</div>
              <small>{text("C–H 通常属于较弱、边界更开放的氢键类型。", "C–H contacts usually represent weaker, more permissive hydrogen-bond types.")}</small>
            </div>
            <div className="hydrogen-element-filter acceptors">
              <span>{text("受体 A", "Acceptors A")}</span>
              <div>{["O", "N", "S", "F", "Cl", "Br", "I"].map((element) => <button type="button" key={element} className={hydrogenBondCriteria.acceptorElements.includes(element) ? "active" : ""} onClick={() => toggleHydrogenBondElement("acceptorElements", element)}>{element}</button>)}</div>
            </div>
          </section>

          <section className="hydrogen-results">
            <div className="hydrogen-section-head"><span>{text("符合当前阈值", "Matches current thresholds")}</span><small>{text("周期最小镜像", "Periodic minimum image")}</small></div>
            {!hasExplicitHydrogens ? <div className="hydrogen-empty warning"><strong>{text("没有显式 H 原子", "No explicit H atoms")}</strong><p>{text("当前 CIF 无法计算 D–H···A 角。请使用含氢坐标的 CIF，最好采用中子衍射或已规范化的 X–H 键长。", "The current CIF cannot provide D–H···A angles. Use a CIF with hydrogen coordinates, preferably from neutron diffraction or with normalized X–H bond lengths.")}</p></div>
              : hydrogenBonds.length === 0 ? <div className="hydrogen-empty"><strong>{text("未发现候选", "No candidates found")}</strong><p>{text("可切换“宽松”预设，或调整距离、角度及供体/受体元素。", "Try the Broad preset or adjust distances, angles, and donor/acceptor elements.")}</p></div>
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
                      <b>{bond.kind === "intramolecular" ? text("分子内", "Intramolecular") : text("分子间", "Intermolecular")}</b>
                      <small>{hydrogenStrengthText(bond.strength, language)}{periodic ? text(" · 跨界", " · periodic") : ""}</small>
                    </span>
                  </button>;
                })}</div>}
          </section>

          <details className="hydrogen-reference" open>
            <summary>{text("判据依据与解释", "Criteria and interpretation")}</summary>
            <p>{english ? <><b>Steiner (2002)</b>: hydrogen-bond strength is continuous and has no natural boundary. For automated screening, H···A distances up to 3.0–3.2 Å may be considered; an angular lower limit of 90° is permissive and 110° is more conservative.</> : <><b>Steiner (2002)</b>：氢键强度连续、没有天然分界。若必须自动筛选，可考虑 H···A 至 3.0–3.2 Å；角度下限可取 90°，更保守取 110°。</>}</p>
            <div className="hydrogen-guide-table">
              <span>{text("几何引导值", "Geometry guide")}</span><b>{text("强", "Strong")}</b><b>{text("中等", "Moderate")}</b><b>{text("弱", "Weak")}</b>
              <span>H···A / Å</span><em>1.2–1.5</em><em>1.5–2.2</em><em>&gt; 2.2</em>
              <span>D···A / Å</span><em>2.2–2.5</em><em>2.5–3.2</em><em>&gt; 3.2</em>
              <span>∠D–H···A</span><em>170–180°</em><em>&gt; 130°</em><em>&gt; 90°</em>
            </div>
            <p className="hydrogen-caution">{text("几何命中只表示“候选”。IUPAC 2011 要求至少有实验或理论证据；电子密度、光谱、能量和化学环境可能改变结论。", "A geometry match indicates only a candidate. IUPAC 2011 requires experimental or theoretical evidence; electron density, spectroscopy, energy, and chemical environment may change the conclusion.")}</p>
            <div className="hydrogen-links">
              <a href="https://doi.org/10.1002/1521-3773(20020104)41:1%3C48::AID-ANIE48%3E3.0.CO;2-U" target="_blank" rel="noreferrer">Steiner 2002 ↗</a>
              <a href="https://publications.iupac.org/pac/83/8/1637/index.html" target="_blank" rel="noreferrer">IUPAC 2011 ↗</a>
            </div>
          </details>
        </div>}

        {rightTab === "calculator" && <div className="right-content panel-scroll calculator-panel">
          <div className="calculator-intro">
            <span>{text("对称位点计算器", "Symmetry-site calculator")}</span>
            <p>{text("输入分数坐标 r，逐步验证 r′ = Rr + t，并将结果折回 [0, 1) 晶胞范围。", "Enter fractional coordinates r to verify r′ = Rr + t step by step, then wrap the result into the [0, 1) unit-cell range.")}</p>
          </div>

          <label className="calculator-field">
            <span>{text("选择对称操作", "Select a symmetry operation")}</span>
            <select value={calculatorOperation.id} onChange={(event) => setCalculatorOperationId(Number(event.target.value))}>
              {structure.operations.map((operation) => <option key={operation.id} value={operation.id}>{operationTitle(operation, language)} · {operation.xyz}</option>)}
            </select>
          </label>

          <div className="calculator-coordinate-head">
            <span>{text("输入分数坐标 r", "Enter fractional coordinates r")}</span>
            <button type="button" onClick={() => {
              if (!selectedAtom) return;
              setCalculatorInput(selectedAtom.source.fract.map((value) => value.toFixed(6)) as [string, string, string]);
              setCalculatorOperationId(selectedOperation.id);
            }}>{text("填入当前原子", "Use current atom")}</button>
          </div>
          <div className="calculator-inputs">
            {(["x", "y", "z"] as const).map((axis, index) => <label key={axis}>
              <span>{axis}</span>
              <input
                type="text"
                inputMode="decimal"
                value={calculatorInput[index]}
                aria-label={english ? `${axis} fractional coordinate` : `${axis} 分数坐标`}
                onChange={(event) => setCalculatorInput((current) => current.map((value, axisIndex) => axisIndex === index ? event.target.value : value) as [string, string, string])}
              />
            </label>)}
          </div>

          <div className="calculator-operation-card">
            <div className="calculator-step-head"><i>1</i><span>{text("代入操作表达式", "Substitute into the operation")}</span></div>
            <code>{calculatorOperation.xyz}</code>
            <div className="matrix-equation" aria-label={text("旋转矩阵和平移向量", "Rotation matrix and translation vector")}>
              <span className="matrix-bracket">R</span>
              <span className="matrix-values">{calculatorOperation.matrix.flat().map((value, index) => <b key={index}>{value}</b>)}</span>
              <span className="matrix-plus">+</span>
              <span className="translation-values">{calculatorOperation.translation.map((value, index) => <b key={index}>{value.toFixed(4)}</b>)}</span>
            </div>
          </div>

          {!calculator.valid ? <div className="calculator-invalid">{text("请输入十进制或分数，例如 0.25、1/3、−0.5。", "Enter a decimal or fraction, such as 0.25, 1/3, or −0.5.")}</div> : <>
            <div className="calculator-result-row">
              <div><span><i>2</i> {text("未折回结果", "Unwrapped result")}</span><code>{decimalCoordinateText(calculator.raw)}</code></div>
              <b>→</b>
              <div className="wrapped"><span><i>3</i> {text("晶胞内结果", "Wrapped unit-cell result")}</span><code>{decimalCoordinateText(calculator.wrapped)}</code></div>
            </div>
            <div className={calculator.matchIndex >= 0 ? "calculator-match found" : "calculator-match"}>
              <span>{text("匹配晶体中的原子", "Match an atom in the crystal")}</span>
              {calculator.matchIndex >= 0 ? <>
                <strong>{structure.atoms[calculator.matchIndex].label}</strong>
                <small>{text("母位点", "Parent site")} {structure.atoms[calculator.matchIndex].source.label} · {coordinateText(structure.atoms[calculator.matchIndex].fract)}</small>
                <button type="button" onClick={() => {
                  setSelectedAtomIndex(calculator.matchIndex);
                  setSelectedOperationId(calculatorOperation.id);
                  setNotice(english ? `Located ${structure.atoms[calculator.matchIndex].label}` : `已定位 ${structure.atoms[calculator.matchIndex].label}`);
                }}>{text("在三维视图中定位", "Locate in 3D view")}</button>
              </> : <><strong>{text("未找到", "Not found")}</strong><small>{text("当前结果与 CIF 原子位点的容差大于 0.002。", "The result differs from every CIF atom site by more than the 0.002 tolerance.")}</small></>}
            </div>
          </>}
        </div>}
      </aside>

      {dragActive && <div className="drop-overlay"><div><span>⇣</span><strong>{text("释放以解析 CIF", "Drop to parse the CIF")}</strong><small>{text("文件只在本机浏览器中处理", "The file is processed only in your local browser")}</small></div></div>}
      {appearanceMenu && appearanceMenu.kind === "element" && (() => {
        const element = appearanceMenu.element;
        const style = resolvedElementStyle(element, elementAppearance);
        return <div
          ref={appearanceMenuRef}
          className="appearance-context-menu"
          role="dialog"
          aria-label={english ? `${element} element appearance settings` : `${element} 元素外观设置`}
          style={{ left: appearanceMenu.x, top: appearanceMenu.y }}
        >
          <div className="appearance-menu-head">
            <i style={{ "--preview-color": style.color } as React.CSSProperties} />
            <span><strong>{element} {text("元素外观", "element appearance")}</strong><small>{english ? `All ${element} atoms and connected bonds update immediately` : `所有 ${element} 原子与相连化学键实时更新`}</small></span>
          </div>
          <label className="appearance-color-row">
            <span>{text("元素颜色", "Element color")}</span>
            <input type="color" value={style.color} onChange={(event) => setElementAppearance((current) => ({
              ...current,
              [element]: { color: event.target.value, scale: current[element]?.scale ?? 1 },
            }))} />
            <code>{style.color.toUpperCase()}</code>
          </label>
          <label className="appearance-range-row">
            <span>{text("原子球大小", "Atom size")}</span><output>{Math.round(style.scale * 100)}%</output>
            <input type="range" min="0.55" max="1.8" step="0.05" value={style.scale} onChange={(event) => setElementAppearance((current) => ({
              ...current,
              [element]: { color: current[element]?.color ?? elementStyle(element).color, scale: Number(event.target.value) },
            }))} />
          </label>
          <button type="button" className="appearance-reset" onClick={() => setElementAppearance((current) => {
            const next = { ...current };
            delete next[element];
            return next;
          })}>{english ? `Restore default ${element} appearance` : `恢复 ${element} 默认外观`}</button>
        </div>;
      })()}
      {appearanceMenu && appearanceMenu.kind === "axis" && <div
        ref={appearanceMenuRef}
        className="appearance-context-menu axis-appearance-menu"
        role="dialog"
        aria-label={text("坐标轴外观设置", "Axis appearance settings")}
        style={{ left: appearanceMenu.x, top: appearanceMenu.y }}
      >
        <div className="appearance-menu-head axis-head">
          <div className="axis-miniature"><i /><b /><em /></div>
          <span><strong>{text("坐标轴外观", "Axis appearance")}</strong><small>{text("修改右下角 a、b、c 晶格方向标记", "Edit the a, b, and c lattice-direction marker")}</small></span>
        </div>
        <div className="axis-preview" style={{ fontFamily: axisFontFamilies[axisAppearance.font], fontSize: `${axisAppearance.fontSize}px` }}>
          <span>a</span><span>b</span><span>c</span>
        </div>
        <label className="appearance-range-row">
          <span>{text("轴线粗细", "Axis line width")}</span><output>{axisAppearance.lineWidth.toFixed(1)} px</output>
          <input type="range" min="0.6" max="4" step="0.1" value={axisAppearance.lineWidth} onChange={(event) => setAxisAppearance((current) => ({ ...current, lineWidth: Number(event.target.value) }))} />
        </label>
        <label className="appearance-range-row">
          <span>{text("整体大小", "Overall size")}</span><output>{axisAppearance.length} px</output>
          <input type="range" min="14" max="52" step="1" value={axisAppearance.length} onChange={(event) => setAxisAppearance((current) => ({ ...current, length: Number(event.target.value) }))} />
        </label>
        <label className="appearance-select-row">
          <span>{text("字母字体", "Label font")}</span>
          <select value={axisAppearance.font} onChange={(event) => setAxisAppearance((current) => ({ ...current, font: event.target.value as AxisFont }))}>
            <option value="mono">{text("等宽字体", "Monospace")}</option>
            <option value="sans">{text("无衬线字体", "Sans serif")}</option>
            <option value="serif">{text("衬线字体", "Serif")}</option>
          </select>
        </label>
        <label className="appearance-range-row">
          <span>{text("字母大小", "Label size")}</span><output>{axisAppearance.fontSize} px</output>
          <input type="range" min="7" max="20" step="1" value={axisAppearance.fontSize} onChange={(event) => setAxisAppearance((current) => ({ ...current, fontSize: Number(event.target.value) }))} />
        </label>
        <button type="button" className="appearance-reset" onClick={() => setAxisAppearance({ ...defaultAxisAppearance })}>{text("恢复坐标轴默认外观", "Restore default axis appearance")}</button>
      </div>}
      {contextMenu && structure.atoms[contextMenu.atomIndex] && (() => {
        const atom = structure.atoms[contextMenu.atomIndex];
        return <div
          ref={contextMenuRef}
          className="atom-context-menu"
          role="menu"
          aria-label={english ? `${atom.label} atom display options` : `${atom.label} 原子显示选项`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="context-menu-head">
            <span className="atom-swatch" style={{ "--atom-color": currentElementColor(atom.element) } as React.CSSProperties}>{atom.element}</span>
            <span><strong>{atom.label}</strong><small>{text("不对称位点", "Asymmetric site")} {atom.source.label}</small></span>
          </div>
          <button type="button" role="menuitem" onClick={() => {
            setAtomFocus({ mode: "fade", sourceLabel: atom.source.label });
            setContextMenu(null);
          }}>
            <span>{text("聚焦该不对称位点", "Focus this asymmetric site")}</span><small>{text("保留其对称轨道，虚化其它原子", "Keep its symmetry orbit and fade other atoms")}</small>
          </button>
          <button type="button" role="menuitem" onClick={() => {
            setAtomFocus({ mode: "isolate", sourceLabel: atom.source.label });
            setContextMenu(null);
          }}>
            <span>{text("仅显示该对称轨道", "Isolate this symmetry orbit")}</span><small>{english ? `Hide atoms outside ${atom.source.label}` : `隐藏不属于 ${atom.source.label} 的原子`}</small>
          </button>
          <div className="context-menu-divider" />
          <button type="button" role="menuitem" onClick={() => {
            setAtomFocus({ mode: "none", sourceLabel: null });
            setContextMenu(null);
          }}>
            <span>{text("恢复全部原子", "Show all atoms")}</span><small>{text("取消聚焦或单独显示", "Clear focus or isolation")}</small>
          </button>
        </div>;
      })()}
      {notice && <div className="toast"><i>✓</i><span>{notice}</span></div>}
      {structure.warnings.length > 0 && <div className="warning-ribbon">{english ? "CIF warning: some symmetry metadata may be incomplete." : structure.warnings[0]}</div>}
    </main>
  );
}
