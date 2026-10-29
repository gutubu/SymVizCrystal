"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_CIF,
  type AtomInstance,
  type AtomSite,
  type CrystalStructure,
  type HydrogenBond,
  type HydrogenBondCriteria,
  type SymmetryOperation,
  type Vec3,
  applyOperation,
  disorderAssemblyKey,
  elementStyle,
  findHydrogenBonds,
  formatFractional,
  fractToCart,
  conventionalElementOrder,
  latticeVectors,
  molecularComponentIds,
  molecularDisplayFracts,
  operationKindLabel,
  parseCif,
  parseStructureFile,
} from "./crystal-data";
import { characterTableForPointGroup, characterTables, normalizePointGroup } from "./character-tables";
import {
  type DensityMode,
  type PowderPoint,
  calculateDensitySlice,
  calculatePowderPattern,
  calculateReflections,
  ewaldElectrostatics,
  measureGeometry,
  reducedCellCandidate,
} from "./crystal-utilities";
import {
  type CubeData,
  type GaussianCalculation,
  type GaussianInputOptions,
  type GaussianOutputSummary,
  type GaussianScope,
  type GaussianWorkflow,
  buildCubeIsosurface,
  buildGaussianInputFromModel,
  cubeIsovalueRange,
  cubePhaseAvailability,
  defaultCubeIsovalue,
  gaussianAtomIndices,
  inferCubeBonds,
  parseGaussianCube,
  parseGaussianOutput,
  prepareGaussianModel,
} from "./gaussian-tools";
import {
  type QuantumEspressoBasisPreset,
  type QuantumEspressoInputOptions,
  type QuantumEspressoOutputSummary,
  buildQuantumEspressoCutoffSeries,
  buildQuantumEspressoInput,
  convergenceDeltaMevPerAtom,
  parseQuantumEspressoOutput,
  quantumEspressoBasisCatalog,
  quantumEspressoCutoffsForPreset,
  quantumEspressoMethodCatalog,
  recommendQuantumEspressoSettings,
  recommendedConvergenceIndex,
  suggestQuantumEspressoKPointMeshes,
  suggestQuantumEspressoPseudopotentials,
} from "./quantum-espresso-tools";
import { createTextZip, type TextArchiveFile } from "./zip-tools";
import SymmetryDemoWorkspace from "./symmetry-demo-workspace";

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
type RightTab = "operations" | "characters" | "atoms" | "wyckoff" | "disorder" | "hydrogen" | "calculator"
  | "geometry" | "cellTools" | "electrostatics" | "diffraction" | "density" | "gaussian";
type UtilityTarget = Extract<RightTab, "operations" | "characters" | "geometry" | "cellTools" | "electrostatics" | "diffraction" | "density" | "gaussian">;
type LeftTab = "model" | "style" | "inspect";
type HydrogenPreset = "strict" | "steiner" | "broad";
type HydrogenBondAppearance = { color: string; lineWidth: number };
type SupercellSettings = { a: number; b: number; c: number };
type ZClippingSettings = { back: number; fade: number };
type DisorderSelections = Record<string, string>;
type QuantumSubview = "qe" | "input" | "queue" | "results" | "multiwfn" | "cube";
type QeConvergenceMode = "k-point" | "cutoff";
type QeCutoffRange = { startRy: number; endRy: number; stepRy: number; densityMultiplier: number };
type GaussianJobStatus = "ready" | "queued" | "running" | "completed" | "failed" | "cancelled";
type GaussianJob = {
  id: string;
  remoteId?: string;
  name: string;
  input: string;
  status: GaussianJobStatus;
  createdAt: string;
  output?: string;
  summary?: GaussianOutputSummary;
};
type GaussianBridgeHealth = {
  available: boolean;
  gaussianRoot?: string;
  workRoot?: string;
  message?: string;
};
type QuantumEspressoJob = {
  id: string;
  remoteId: string;
  name: string;
  status: SymVizDesktopJobStatus;
  createdAt: string;
  error?: string;
  output?: string;
  summary?: QuantumEspressoOutputSummary;
  study?: SymVizQeConvergenceStudy | null;
};
type MultiwfnInputSelection = { path: string; name: string };
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

const defaultAxisAppearance: AxisAppearance = { lineWidth: 1.5, length: 25, font: "mono", fontSize: 13 };
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
const defaultZClipping: ZClippingSettings = { back: 0, fade: 14 };
const gaussianMethodGroups = [
  {
    zh: "密度泛函方法（DFT）",
    en: "Density functional methods (DFT)",
    options: ["B3LYP", "PBE0", "TPSSh", "M06-2X", "wB97XD", "CAM-B3LYP"],
  },
  {
    zh: "从头算与微扰方法",
    en: "Ab initio and perturbation methods",
    options: ["HF", "MP2"],
  },
] as const;
const gaussianBasisGroups = [
  {
    zh: "Pople 基组",
    en: "Pople basis sets",
    options: ["STO-3G", "3-21G", "6-31G(d)", "6-31G(d,p)", "6-311G(d,p)", "6-311++G(d,p)"],
  },
  {
    zh: "Karlsruhe / def2 基组",
    en: "Karlsruhe / def2 basis sets",
    options: ["Def2SVP", "Def2TZVP", "Def2TZVPP"],
  },
  {
    zh: "Dunning 相关一致基组",
    en: "Dunning correlation-consistent basis sets",
    options: ["cc-pVDZ", "cc-pVTZ", "aug-cc-pVDZ"],
  },
  {
    zh: "有效芯势（ECP）",
    en: "Effective core potentials (ECP)",
    options: ["LANL2DZ", "SDD"],
  },
] as const;
const gaussianMethodValues = new Set<string>(gaussianMethodGroups.flatMap((group) => [...group.options]));
const gaussianBasisValues = new Set<string>(gaussianBasisGroups.flatMap((group) => [...group.options]));
const customGaussianOption = "__custom__";
const multiwfnPresetDescriptions = {
  summary: {
    zh: "读取波函数与结构信息，显示电子数、能量、基函数、分子式和点群后退出。",
    en: "Read the wavefunction and structure, report electrons, energy, basis functions, formula and point group, then exit.",
  },
  aim: {
    zh: "按随附版本的官方批处理序列执行 AIM 拓扑、临界点和键径分析。",
    en: "Run the AIM topology, critical-point and bond-path workflow from the bundled version's official batch sequence.",
  },
  "esp-extrema": {
    zh: "在三维网格上计算静电势极小值和极大值。",
    en: "Evaluate electrostatic-potential minima and maxima on a three-dimensional grid.",
  },
  resp: {
    zh: "使用官方脚本序列计算 RESP 原子电荷并导出 .chg；RESP 本身不生成 Cube。",
    en: "Calculate RESP atomic charges with the official scripted sequence and export .chg; RESP itself does not create a Cube file.",
  },
  "frontier-orbitals": {
    zh: "从 WFN 或格式化检查点文件读取前线轨道编号与能量，并给出 HOMO–LUMO 能隙；不会把缺失的虚轨道当作 LUMO。",
    en: "Read frontier-orbital indices and energies from WFN or formatted-checkpoint data and report the HOMO-LUMO gap without inventing missing virtual orbitals.",
  },
  "homo-cube": {
    zh: "自动识别 HOMO 编号，计算带正负相位的轨道波函数网格并导出 HOMO.cub。",
    en: "Detect the HOMO index and export its signed orbital-wavefunction grid as HOMO.cub.",
  },
  "lumo-cube": {
    zh: "自动识别 LUMO 编号并导出 LUMO.cub；若 WFN 仅含占据轨道，任务会被阻止并提示改用 FCHK。",
    en: "Detect the LUMO and export LUMO.cub; occupied-only WFN files are blocked with guidance to use FCHK.",
  },
  "density-cube": {
    zh: "在中等质量三维网格上计算电子密度并导出 density.cub，可直接在独立窗口观察。",
    en: "Calculate electron density on a medium-quality 3D grid and export density.cub for the separate visualizer.",
  },
  "esp-cube": {
    zh: "在中等质量三维网格上计算总静电势并导出 totesp.cub，可直接在独立窗口观察。",
    en: "Calculate total electrostatic potential on a medium-quality 3D grid and export totesp.cub for the separate visualizer.",
  },
  custom: {
    zh: "逐行发送菜单回答，可覆盖 Multiwfn 的完整交互功能；结束时通常需要输入 q。",
    en: "Send one menu response per line to access the full interactive feature set; usually finish with q.",
  },
} as const;

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
  disorderSelections: DisorderSelections = {},
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
  return results.filter(({ atom }) => {
    const assembly = disorderAssemblyKey(atom.source);
    if (!assembly) return true;
    const selectedGroup = disorderSelections[assembly] ?? "all";
    return selectedGroup === "all" || !atom.source.disorderGroup || atom.source.disorderGroup === selectedGroup;
  });
}

const disorderPalette = ["#7c5ce7", "#d66a2c", "#0b8f86", "#c24172", "#5378c7", "#8a6b24"];

function disorderColor(assembly: string, group: string) {
  const key = `${assembly}:${group}`;
  const hash = [...key].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 17);
  return disorderPalette[hash % disorderPalette.length];
}

function disorderSelectionLabel(site: AtomSite, selections: DisorderSelections) {
  const assembly = disorderAssemblyKey(site);
  if (!assembly || !site.disorderGroup) return null;
  const selectedGroup = selections[assembly] ?? "all";
  return { assembly, group: site.disorderGroup, overlay: selectedGroup === "all" };
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

function gaussianJobStatusText(status: GaussianJobStatus, language: Language) {
  const labels: Record<GaussianJobStatus, [string, string]> = {
    ready: ["待提交", "Ready"],
    queued: ["排队中", "Queued"],
    running: ["计算中", "Running"],
    completed: ["已完成", "Completed"],
    failed: ["失败", "Failed"],
    cancelled: ["已取消", "Cancelled"],
  };
  return labels[status][language === "en-US" ? 1 : 0];
}

function quantumEspressoErrorText(error: string, language: Language) {
  if (language === "en-US") return error;
  if (/previous WSL launcher returned before executing/i.test(error) || /pw\.x did not start/i.test(error)) {
    return "pw.x 未能启动：WSL 启动器在执行 Quantum ESPRESSO 命令前已经退出。";
  }
  if (/Could not start pw\.x:/i.test(error)) return error.replace(/Could not start pw\.x:/i, "无法启动 pw.x：");
  if (/pw\.x stopped before JOB DONE/i.test(error)) return "pw.x 在出现 JOB DONE 前停止；请查看输出末尾的 QE 信息。";
  if (/Could not stop the WSL pw\.x process:/i.test(error)) return error.replace(/Could not stop the WSL pw\.x process:/i, "无法停止 WSL 中的 pw.x 进程：");
  return error;
}

function qeMeshKey(mesh: readonly number[]) {
  return mesh.map((value) => Math.max(1, Math.round(Number(value) || 1))).join("×");
}

function qeStudyParameterLabel(study: SymVizQeConvergenceStudy) {
  if (study.kind === "k-point" && study.kPoints) return qeMeshKey(study.kPoints);
  if (study.kind === "cutoff" && study.ecutwfcRy !== null) {
    return `${Number(study.ecutwfcRy.toFixed(3))} / ${study.ecutrhoRy === null ? "—" : Number(study.ecutrhoRy.toFixed(3))} Ry`;
  }
  return study.label || "—";
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
  disorderSelections,
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
  disorderSelections: DisorderSelections;
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
    return [...counts.entries()].sort(([a], [b]) => conventionalElementOrder(a, b, counts.has("C")));
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
    const displayAtoms = buildDisplayAtomInstances(
      structure,
      baseDisplayFracts,
      supercell,
      display.completeMolecules,
      disorderSelections,
    );
    const displayAtomMap = new Map(displayAtoms.map((instance) => [`${instance.translationKey}:${instance.index}`, instance]));
    const displayTranslations = [...new Map(displayAtoms.map((instance) => [instance.translationKey, instance.translation])).values()];
    const instancesByAtom = new Map<number, DisplayAtomInstance[]>();
    displayAtoms.forEach((instance) => instancesByAtom.set(instance.index, [...(instancesByAtom.get(instance.index) ?? []), instance]));

    const atomDepths = displayAtoms.map((instance) => rotate(instance.cart)[2]);
    const minimumAtomDepth = atomDepths.length ? Math.min(...atomDepths) : -1;
    const maximumAtomDepth = atomDepths.length ? Math.max(...atomDepths) : 1;
    const atomDepthSpan = Math.max(1e-6, maximumAtomDepth - minimumAtomDepth);
    const clippingMinimum = minimumAtomDepth + atomDepthSpan * zClipping.back / 100;
    const fadeDepth = Math.max(1e-6, atomDepthSpan * zClipping.fade / 100);
    const smoothstep = (value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      return clamped * clamped * (3 - 2 * clamped);
    };
    const depthOpacity = (depth: number) => {
      if (!display.zClipping) return 1;
      if (zClipping.back <= 0) return 1;
      if (depth <= clippingMinimum) return 0;
      return smoothstep((depth - clippingMinimum) / fadeDepth);
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
      const aInside = a[2] >= clippingMinimum;
      const bInside = b[2] >= clippingMinimum;
      if (!aInside && !bInside) return null;
      if (aInside !== bInside) {
        const intersection = (clippingMinimum - a[2]) / deltaDepth;
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
            context.font = "600 13px ui-monospace, monospace";
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
          const disorderA = disorderSelectionLabel(atomA.source, disorderSelections);
          const disorderB = disorderSelectionLabel(atomB.source, disorderSelections);
          const disorderOpacity = Math.min(
            disorderA?.overlay ? 0.62 + atomA.source.occupancy * 0.24 : 1,
            disorderB?.overlay ? 0.62 + atomB.source.occupancy * 0.24 : 1,
          );
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
          const bondFocusOpacity = atomFocus.mode === "fade" ? (focusA && focusB ? 1 : focusA || focusB ? 0.42 : 0.07) : 1;
          context.globalAlpha = bondFocusOpacity * disorderOpacity;
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
        if (!instancesByAtom.has(hydrogenBond.donor)
          || !instancesByAtom.has(hydrogenBond.hydrogen)
          || !instancesByAtom.has(hydrogenBond.acceptor)) continue;
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
          context.font = "600 14px ui-monospace, monospace";
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
        const disorder = disorderSelectionLabel(atom.source, disorderSelections);
        const disorderOpacity = disorder?.overlay ? 0.62 + atom.source.occupancy * 0.24 : 1;
        context.globalAlpha = focusOpacity * clippingOpacity * disorderOpacity;
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
        context.strokeStyle = index === selectedAtomIndex
          ? "#08777a"
          : disorder
            ? disorderColor(disorder.assembly, disorder.group)
            : "rgba(30, 41, 59, .34)";
        context.lineWidth = index === selectedAtomIndex ? 2.4 : 0.85;
        context.stroke();
        if (disorder && index !== selectedAtomIndex) {
          context.strokeStyle = disorderColor(disorder.assembly, disorder.group);
          context.lineWidth = 1.2;
          context.beginPath();
          context.arc(projection.x, projection.y, radius + 2.2, 0, Math.PI * 2);
          context.stroke();
        }
        if (index === selectedAtomIndex) {
          context.strokeStyle = "rgba(15, 139, 141, .34)";
          context.lineWidth = 2;
          context.beginPath();
          context.arc(projection.x, projection.y, radius + 4, 0, Math.PI * 2);
          context.stroke();
        }

        if (display.labels && displayAtoms.length <= 120) {
          context.fillStyle = index === selectedAtomIndex ? "#0f5f62" : "rgba(51, 65, 85, .82)";
          context.font = `${index === selectedAtomIndex ? 650 : 500} 13px ui-monospace, monospace`;
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
  }, [structure, hydrogenBonds, hydrogenBondAppearance, supercell, zClipping, disorderSelections, language, display, selectedAtomIndex, selectedOperation, atomFocus, elementAppearance, axisAppearance, orthographic, viewVersion, english]);

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
          {display.zClipping && <div className="z-clipping-chip"><i /> {english ? "Rear fade" : "后景渐隐"} {zClipping.back}% · {zClipping.fade}%</div>}
          {display.hydrogenBonds && <div
            className="hydrogen-bond-chip"
            style={{ "--hbond-view-color": hydrogenBondAppearance.color } as React.CSSProperties}
          ><i /> {english ? "H-bond candidates" : "氢键候选"} {hydrogenBonds.length}</div>}
          {structure.disorder.explicit && <div className="disorder-chip">
            <i /> {structure.disorder.assemblies.map((assembly) => {
              const selected = disorderSelections[assembly.id] ?? "all";
              const assemblyName = assembly.id === "__unassigned__" ? (english ? "Unassigned" : "未指定") : assembly.id;
              return `${assemblyName}:${selected === "all" ? (english ? "overlay" : "叠加") : `${english ? "conf." : "构象"} ${selected}`}`;
            }).join(" · ")}
          </div>}
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

function occupancyIssueText(
  issue: CrystalStructure["disorder"]["occupancyIssues"][number],
  language: Language,
) {
  const english = language === "en-US";
  const observed = issue.observed === undefined ? "" : ` (${issue.observed.toFixed(3)})`;
  const messages = {
    "out-of-range": english ? "Occupancy lies outside 0–1" : "占有率超出 0–1",
    "assembly-sum": english ? "Conformer occupancies do not sum to 1" : "各构象代表占有率之和不为 1",
    "group-variation": english ? "Occupancies vary within one disorder group" : "同一无序组内的占有率不一致",
    "partial-ungrouped": english ? "Partial occupancy without standard disorder fields" : "部分占位，但未提供标准无序字段",
    "incomplete-fields": english ? "Disorder assembly/group fields are incomplete" : "disorder assembly/group 字段不完整",
  };
  return `${messages[issue.kind]}${observed}`;
}

function splitCandidateReasonText(
  reason: CrystalStructure["disorder"]["splitSiteCandidates"][number]["reasons"][number],
  language: Language,
) {
  const english = language === "en-US";
  return {
    "close-position": english ? "close coordinates" : "坐标接近",
    "complementary-occupancy": english ? "occupancies sum near 1" : "占有率之和接近 1",
    "matching-label": english ? "paired labels" : "标签成对",
    "mixed-element": english ? "mixed-element site" : "混合元素位点",
  }[reason];
}

function PowderPatternCanvas({
  points,
  language,
}: {
  points: PowderPoint[];
  language: Language;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const margin = { left: 34, right: 9, top: 10, bottom: 24 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    context.strokeStyle = "#bdc4cb";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(margin.left, margin.top);
    context.lineTo(margin.left, margin.top + plotHeight);
    context.lineTo(margin.left + plotWidth, margin.top + plotHeight);
    context.stroke();
    context.strokeStyle = "#286fae";
    context.lineWidth = 1.25;
    context.beginPath();
    points.forEach((point, index) => {
      const x = margin.left + index / (points.length - 1) * plotWidth;
      const y = margin.top + (1 - point.intensity / 100) * plotHeight;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.fillStyle = "#5f6974";
    context.font = "11px Segoe UI, sans-serif";
    context.textAlign = "center";
    const minimum = points[0].twoTheta;
    const maximum = points[points.length - 1].twoTheta;
    for (let tick = 0; tick <= 4; tick += 1) {
      const x = margin.left + tick / 4 * plotWidth;
      const value = minimum + tick / 4 * (maximum - minimum);
      context.fillText(value.toFixed(0), x, height - 9);
    }
    context.save();
    context.translate(10, margin.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(language === "en-US" ? "Relative intensity" : "相对强度", 0, 0);
    context.restore();
    context.fillText(language === "en-US" ? "2θ (°)" : "2θ（°）", margin.left + plotWidth / 2, height - 1);
  }, [points, language]);
  return <canvas ref={canvasRef} className="utility-chart powder-chart" aria-label={language === "en-US" ? "Calculated powder diffraction pattern" : "计算粉末衍射图"} />;
}

function DensityMapCanvas({
  density,
  mode,
  language,
}: {
  density: ReturnType<typeof calculateDensitySlice>;
  mode: DensityMode;
  language: Language;
}) {
  const mapRef = useRef<HTMLCanvasElement>(null);
  const profileRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = mapRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const image = context.createImageData(density.size, density.size);
    density.values.forEach((value, index) => {
      const shaped = Math.sqrt(value);
      const red = Math.round(247 - shaped * 205);
      const green = Math.round(250 - shaped * 117);
      const blue = Math.round(252 - shaped * 51);
      image.data[index * 4] = red;
      image.data[index * 4 + 1] = green;
      image.data[index * 4 + 2] = blue;
      image.data[index * 4 + 3] = 255;
    });
    const temporary = document.createElement("canvas");
    temporary.width = density.size;
    temporary.height = density.size;
    temporary.getContext("2d")?.putImageData(image, 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(temporary, 0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,.82)";
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
  }, [density]);
  useEffect(() => {
    const canvas = profileRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#bbc3cb";
    context.beginPath();
    context.moveTo(25, 7);
    context.lineTo(25, height - 17);
    context.lineTo(width - 7, height - 17);
    context.stroke();
    context.strokeStyle = "#286fae";
    context.lineWidth = 1.4;
    context.beginPath();
    density.lineProfile.forEach((value, index) => {
      const x = 25 + index / Math.max(density.lineProfile.length - 1, 1) * (width - 32);
      const y = 7 + (1 - value) * (height - 24);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.fillStyle = "#68727d";
    context.font = "11px Segoe UI, sans-serif";
    context.fillText(language === "en-US" ? "line y = 0.5" : "线剖面 y = 0.5", 30, 13);
  }, [density, language]);
  const title = mode === "electron"
    ? (language === "en-US" ? "Model electron-density slice" : "模型电子密度切片")
    : mode === "nuclear"
      ? (language === "en-US" ? "Nuclear-position map" : "核位置密度图")
      : (language === "en-US" ? "Model Patterson map" : "模型 Patterson 图");
  return <div className="density-canvases">
    <canvas ref={mapRef} className="utility-chart density-map" aria-label={title} />
    <canvas ref={profileRef} className="utility-chart density-profile" aria-label={language === "en-US" ? "Density line profile" : "密度线剖面"} />
  </div>;
}

function cubeAtomColor(atomicNumber: number) {
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

function CubeSurfaceCanvas({
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
  language: Language;
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
        point[0] - center[0],
        point[1] - center[1],
        point[2] - center[2],
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
      const relative: Vec3 = [
        point[0] - bounds.center[0],
        point[1] - bounds.center[1],
        point[2] - bounds.center[2],
      ];
      const rotated = rotateByQuaternion(relative, rotation.current);
      return {
        x: width / 2 + rotated[0] * scale,
        y: height / 2 - rotated[1] * scale,
        depth: rotated[2],
      };
    };
    const projectedTriangles = mesh.triangles.map((triangle) => {
      const a = project(triangle.a);
      const b = project(triangle.b);
      const c = project(triangle.c);
      return { ...triangle, a, b, c, depth: (a.depth + b.depth + c.depth) / 3 };
    }).sort((a, b) => a.depth - b.depth);
    projectedTriangles.forEach((triangle) => {
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
        gradient.addColorStop(0, cubeAtomColor(cube.atoms[bond.a].atomicNumber));
        gradient.addColorStop(0.48, cubeAtomColor(cube.atoms[bond.a].atomicNumber));
        gradient.addColorStop(0.52, cubeAtomColor(cube.atoms[bond.b].atomicNumber));
        gradient.addColorStop(1, cubeAtomColor(cube.atoms[bond.b].atomicNumber));
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.strokeStyle = gradient;
        context.lineWidth = 3.2;
        context.stroke();
      });
    }
    cube.atoms
      .map((atom) => ({ atom, projection: project(atom.position) }))
      .sort((a, b) => a.projection.depth - b.projection.depth)
      .forEach(({ atom, projection }) => {
        const atomRadius = Math.max(2.4, Math.min(6.5, 3.4 + atom.atomicNumber ** (1 / 3) * 0.42));
        context.beginPath();
        context.arc(projection.x, projection.y, atomRadius, 0, Math.PI * 2);
        context.fillStyle = cubeAtomColor(atom.atomicNumber);
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
      aria-label={language === "en-US" ? "Gaussian Cube isosurface viewer" : "Gaussian Cube 等值面查看器"}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { active: true, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (!drag.current.active) return;
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        drag.current.x = event.clientX;
        drag.current.y = event.clientY;
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

export default function Home() {
  const [structure, setStructure] = useState<CrystalStructure>(() => parseCif(DEFAULT_CIF));
  const [fileName, setFileName] = useState("alpha-quartz.cif");
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [display, setDisplay] = useState(defaultDisplay);
  const [supercell, setSupercell] = useState<SupercellSettings>(defaultSupercell);
  const [zClipping, setZClipping] = useState<ZClippingSettings>(defaultZClipping);
  const [disorderSelections, setDisorderSelections] = useState<DisorderSelections>({});
  const [selectedAtomIndex, setSelectedAtomIndex] = useState(0);
  const [selectedOperationId, setSelectedOperationId] = useState(1);
  const [rightTab, setRightTab] = useState<RightTab>("operations");
  const [workspaceMode, setWorkspaceMode] = useState<"crystal" | "symmetry-demo">("crystal");
  const [symmetryDemoOpened, setSymmetryDemoOpened] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("model");
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
  const [rightPanelWidth, setRightPanelWidth] = useState(356);
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [utilitiesMenuOpen, setUtilitiesMenuOpen] = useState(false);
  const [geometryIndices, setGeometryIndices] = useState<[number, number, number, number]>([0, 1, 2, 3]);
  const [wavelength, setWavelength] = useState(1.5406);
  const [diffractionRange, setDiffractionRange] = useState<[number, number]>([5, 80]);
  const [peakWidth, setPeakWidth] = useState(0.18);
  const [elementCharges, setElementCharges] = useState<Record<string, number>>({});
  const [densityMode, setDensityMode] = useState<DensityMode>("electron");
  const [densitySlice, setDensitySlice] = useState(0.5);
  const [quantumSubview, setQuantumSubview] = useState<QuantumSubview>("qe");
  const [qeOptions, setQeOptions] = useState<QuantumEspressoInputOptions>(() => {
    const elements = [...new Set(structure.atoms.map((atom) => atom.element))];
    const recommendation = recommendQuantumEspressoSettings(structure);
    return {
      title: `${structure.name} — SymViz periodic DFT`,
      prefix: structure.name.replace(/[^A-Za-z0-9_.-]+/g, "-") || "symviz-qe",
      calculation: recommendation.calculation,
      inputDft: recommendation.inputDft,
      dispersion: recommendation.dispersion,
      occupations: recommendation.occupations,
      smearing: recommendation.smearing,
      degaussRy: recommendation.degaussRy,
      ecutwfcRy: recommendation.ecutwfcRy,
      ecutrhoRy: recommendation.ecutrhoRy,
      kPoints: recommendation.kPoints,
      kPointShift: recommendation.kPointShift,
      convThr: 1e-8,
      forceConvThr: 1e-4,
      pressureConvThr: 0.5,
      mdSteps: 100,
      mdTimeStepAu: 20,
      temperatureK: 300,
      pseudopotentials: suggestQuantumEspressoPseudopotentials(elements, []),
    };
  });
  const [qeBasisPreset, setQeBasisPreset] = useState<QuantumEspressoBasisPreset>(() => recommendQuantumEspressoSettings(structure).basisPreset);
  const [qeStatus, setQeStatus] = useState<SymVizQeStatus | null>(null);
  const [qeJobs, setQeJobs] = useState<QuantumEspressoJob[]>([]);
  const [selectedQeJobId, setSelectedQeJobId] = useState<string | null>(null);
  const [qeConvergenceMode, setQeConvergenceMode] = useState<QeConvergenceMode>("k-point");
  const [qeSelectedKMeshes, setQeSelectedKMeshes] = useState<string[]>(() => suggestQuantumEspressoKPointMeshes(structure.cell, 6).map((candidate) => qeMeshKey(candidate.kPoints)));
  const [qeCutoffRange, setQeCutoffRange] = useState<QeCutoffRange>({ startRy: 30, endRy: 80, stepRy: 10, densityMultiplier: 8 });
  const [qeConvergenceTolerance, setQeConvergenceTolerance] = useState(1);
  const [selectedQeStudyId, setSelectedQeStudyId] = useState<string | null>(null);
  const [liveQeOutput, setLiveQeOutput] = useState<SymVizDesktopOutputSnapshot & { jobId: string | null }>({ text: "", size: 0, truncated: false, updatedAt: null, jobId: null });
  const [followQeOutput, setFollowQeOutput] = useState(true);
  const [gaussianScope, setGaussianScope] = useState<GaussianScope>("selected-molecule");
  const [gaussianOptions, setGaussianOptions] = useState<GaussianInputOptions>(() => ({
    title: `${structure.name} — SymViz`,
    charge: 0,
    multiplicity: 1,
    method: "B3LYP",
    basis: "6-311G(d,p)",
    calculation: "opt-freq",
    memoryGB: 8,
    processors: 4,
    solvent: "",
    routeExtras: "",
    checkpointName: structure.name.replace(/[^\w.-]+/g, "-") || "symviz-job",
    workflow: "preopt-final",
    preoptimizationMethod: "B3LYP",
    preoptimizationBasis: "6-31G(d)",
  }));
  const [gaussianJobs, setGaussianJobs] = useState<GaussianJob[]>([]);
  const [selectedGaussianJobId, setSelectedGaussianJobId] = useState<string | null>(null);
  const [liveGaussianOutput, setLiveGaussianOutput] = useState<SymVizDesktopOutputSnapshot & { jobId: string | null }>({ text: "", size: 0, truncated: false, updatedAt: null, jobId: null });
  const [followGaussianOutput, setFollowGaussianOutput] = useState(true);
  const [gaussianBridgeUrl, setGaussianBridgeUrl] = useState("http://127.0.0.1:8765");
  const [gaussianBridgeToken, setGaussianBridgeToken] = useState("");
  const [gaussianBridgeHealth, setGaussianBridgeHealth] = useState<GaussianBridgeHealth | null>(null);
  const [desktopStatus, setDesktopStatus] = useState<SymVizDesktopStatus | null>(null);
  const [cube, setCube] = useState<CubeData | null>(null);
  const [cubeFileName, setCubeFileName] = useState("");
  const [cubeProperty, setCubeProperty] = useState<"density" | "esp" | "homo" | "lumo">("density");
  const [cubeIsovalue, setCubeIsovalue] = useState(0.02);
  const [cubePositive, setCubePositive] = useState(true);
  const [cubeNegative, setCubeNegative] = useState(true);
  const [cubeBonds, setCubeBonds] = useState(true);
  const [cubeSmoothSurface, setCubeSmoothSurface] = useState(true);
  const [multiwfnStatus, setMultiwfnStatus] = useState<SymVizMultiwfnStatus | null>(null);
  const [multiwfnInput, setMultiwfnInput] = useState<MultiwfnInputSelection | null>(null);
  const [multiwfnTaskId, setMultiwfnTaskId] = useState("summary");
  const [multiwfnJobName, setMultiwfnJobName] = useState("Multiwfn-analysis");
  const [multiwfnScript, setMultiwfnScript] = useState("q\n");
  const [multiwfnJobs, setMultiwfnJobs] = useState<SymVizMultiwfnJob[]>([]);
  const [selectedMultiwfnJobId, setSelectedMultiwfnJobId] = useState<string | null>(null);
  const [selectedMultiwfnOutput, setSelectedMultiwfnOutput] = useState("");
  const [liveMultiwfnOutput, setLiveMultiwfnOutput] = useState<SymVizDesktopOutputSnapshot & { jobId: string | null }>({ text: "", size: 0, truncated: false, updatedAt: null, jobId: null });
  const [followMultiwfnOutput, setFollowMultiwfnOutput] = useState(true);
  const [appearanceMenu, setAppearanceMenu] = useState<AppearanceMenu | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gaussianOutputRef = useRef<HTMLInputElement>(null);
  const cubeInputRef = useRef<HTMLInputElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const utilitiesMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const appearanceMenuRef = useRef<HTMLDivElement>(null);
  const liveGaussianOutputRef = useRef<HTMLPreElement>(null);
  const liveQeOutputRef = useRef<HTMLPreElement>(null);
  const liveMultiwfnOutputRef = useRef<HTMLPreElement>(null);
  const english = language === "en-US";
  const text = (zh: string, en: string) => english ? en : zh;
  const desktopMode = desktopStatus !== null;
  const gaussianMethodIsCustom = !gaussianMethodValues.has(gaussianOptions.method);
  const gaussianBasisIsCustom = !gaussianBasisValues.has(gaussianOptions.basis);
  const gaussianPreoptimizationMethodIsCustom = !gaussianMethodValues.has(gaussianOptions.preoptimizationMethod ?? "B3LYP");
  const gaussianPreoptimizationBasisIsCustom = !gaussianBasisValues.has(gaussianOptions.preoptimizationBasis ?? "6-31G(d)");
  const multiwfnTemplateLabel = (id: string, fallback: string) => {
    const labels: Record<string, string> = {
      summary: text("波函数与结构摘要", fallback),
      aim: text("AIM 拓扑与临界点", fallback),
      "esp-extrema": text("静电势网格极值", fallback),
      resp: text("RESP 原子电荷（仅 .chg）", fallback),
      "frontier-orbitals": text("HOMO–LUMO 能级", fallback),
      "homo-cube": text("HOMO 轨道 Cube", fallback),
      "lumo-cube": text("LUMO 轨道 Cube", fallback),
      "density-cube": text("电子密度 Cube", fallback),
      "esp-cube": text("静电势 Cube", fallback),
      custom: text("自定义命令脚本", fallback),
    };
    return labels[id] ?? fallback;
  };

  useEffect(() => {
    const stored = window.localStorage.getItem("symviz-language");
    const storedRightPanelWidth = Number(window.localStorage.getItem("symviz-right-panel-width"));
    if (Number.isFinite(storedRightPanelWidth) && storedRightPanelWidth >= 320) {
      setRightPanelWidth(Math.min(900, storedRightPanelWidth));
    }
    if (stored !== "en-US" && stored !== "zh-CN") return;
    const frame = window.requestAnimationFrame(() => {
      setLanguage(stored);
      setNotice("");
      document.documentElement.lang = stored;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    let disposed = false;
    const mergeQeJobs = async (desktopJobs: SymVizDesktopJob[]) => {
      const enriched = await Promise.all(desktopJobs.map(async (job) => {
        const output = ["completed", "failed"].includes(job.status)
          ? await desktop.getQeOutput(job.id).catch(() => "")
          : "";
        return { job, output, summary: output ? parseQuantumEspressoOutput(output) : undefined };
      }));
      if (disposed) return;
      setQeJobs((current) => {
        const next = [...current];
        enriched.forEach(({ job, output, summary }) => {
          const existingIndex = next.findIndex((candidate) => candidate.remoteId === job.id);
          const value: QuantumEspressoJob = {
            id: existingIndex >= 0 ? next[existingIndex].id : `qe-${job.id}`,
            remoteId: job.id,
            name: job.name,
            status: job.status,
            createdAt: job.submittedAt,
            error: job.error || undefined,
            output: output || (existingIndex >= 0 ? next[existingIndex].output : undefined),
            summary: summary || (existingIndex >= 0 ? next[existingIndex].summary : undefined),
            study: job.study || (existingIndex >= 0 ? next[existingIndex].study : null),
          };
          if (existingIndex >= 0) next[existingIndex] = value;
          else next.push(value);
        });
        return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    };
    void Promise.all([desktop.getQeStatus(), desktop.listQeJobs()]).then(([status, jobs]) => {
      if (disposed) return;
      setQeStatus(status);
      const elements = [...new Set(structure.atoms.map((atom) => atom.element))];
      const suggestions = suggestQuantumEspressoPseudopotentials(elements, status.pseudopotentials);
      setQeOptions((current) => ({
        ...current,
        pseudopotentials: Object.fromEntries(elements.map((element) => [
          element,
          current.pseudopotentials[element] && current.pseudopotentials[element] !== `${element}.UPF`
            ? current.pseudopotentials[element]
            : suggestions[element],
        ])),
      }));
      void mergeQeJobs(jobs);
    });
    const unsubscribe = desktop.onQeEvent((job) => { void mergeQeJobs([job]); });
    return () => {
      disposed = true;
      unsubscribe();
    };
  // The desktop bridge is initialized once. Structure-specific pseudo suggestions are refreshed when a file is loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    let disposed = false;
    const mergeDesktopJobs = async (desktopJobs: SymVizDesktopJob[]) => {
      const enriched = await Promise.all(desktopJobs.map(async (job) => {
        let output: string | undefined;
        let summary: GaussianOutputSummary | undefined;
        if (["completed", "failed"].includes(job.status)) {
          output = await desktop.getOutput(job.id).catch(() => "");
          summary = output ? parseGaussianOutput(output) : undefined;
        }
        return { job, output, summary };
      }));
      if (disposed) return;
      setGaussianJobs((current) => {
        const next = [...current];
        enriched.forEach(({ job, output, summary }) => {
          const existingIndex = next.findIndex((candidate) => candidate.remoteId === job.id);
          const value: GaussianJob = {
            id: existingIndex >= 0 ? next[existingIndex].id : `desktop-${job.id}`,
            remoteId: job.id,
            name: job.name,
            input: existingIndex >= 0 ? next[existingIndex].input : "",
            status: job.status,
            createdAt: job.submittedAt,
            output: output || (existingIndex >= 0 ? next[existingIndex].output : undefined),
            summary: summary || (existingIndex >= 0 ? next[existingIndex].summary : undefined),
          };
          if (existingIndex >= 0) next[existingIndex] = value;
          else next.push(value);
        });
        return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    };
    void Promise.all([desktop.getStatus(), desktop.listJobs()]).then(([status, jobs]) => {
      if (disposed) return;
      setDesktopStatus(status);
      setGaussianBridgeHealth({
        available: status.available,
        gaussianRoot: status.gaussianRoot,
        workRoot: status.workRoot,
      });
      void mergeDesktopJobs(jobs);
    });
    const unsubscribe = desktop.onGaussianEvent((job) => {
      void mergeDesktopJobs([job]);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    let disposed = false;
    const mergeJobs = (jobs: SymVizMultiwfnJob[]) => {
      if (disposed) return;
      setMultiwfnJobs((current) => {
        const next = [...current];
        jobs.forEach((job) => {
          const index = next.findIndex((candidate) => candidate.id === job.id);
          if (index >= 0) next[index] = job;
          else next.push(job);
        });
        return next.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      });
    };
    void Promise.all([desktop.getMultiwfnStatus(), desktop.listMultiwfnJobs()]).then(([status, jobs]) => {
      if (disposed) return;
      setMultiwfnStatus(status);
      mergeJobs(jobs);
    });
    const unsubscribe = desktop.onMultiwfnEvent((job) => mergeJobs([job]));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setNotice("");
    window.localStorage.setItem("symviz-language", nextLanguage);
    document.documentElement.lang = nextLanguage;
  }

  function rightPanelWidthAt(clientX: number) {
    const leftWidth = sidebarCollapsed ? 44 : window.innerWidth <= 1230 ? 250 : 286;
    const maximumWidth = Math.max(320, Math.min(900, window.innerWidth - leftWidth - 560));
    return Math.max(320, Math.min(maximumWidth, window.innerWidth - clientX));
  }

  function resizeRightPanel(clientX: number) {
    if (window.innerWidth <= 1030) return;
    setRightPanelWidth(rightPanelWidthAt(clientX));
  }

  function beginRightPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= 1030) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRightPanelResizing(true);
    resizeRightPanel(event.clientX);
  }

  function finishRightPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!rightPanelResizing) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const nextWidth = rightPanelWidthAt(event.clientX);
    setRightPanelWidth(nextWidth);
    setRightPanelResizing(false);
    window.localStorage.setItem("symviz-right-panel-width", String(nextWidth));
  }

  function resizeRightPanelByKeyboard(delta: number) {
    const next = Math.max(320, Math.min(900, rightPanelWidth + delta));
    setRightPanelWidth(next);
    window.localStorage.setItem("symviz-right-panel-width", String(next));
  }

  const selectedAtom = structure.atoms[Math.min(selectedAtomIndex, structure.atoms.length - 1)];
  const activeCubeIsovalueRange = useMemo(() => cube ? cubeIsovalueRange(cube) : null, [cube]);
  const activeCubePhases = useMemo(() => cube ? cubePhaseAvailability(cube) : null, [cube]);
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
    return [...counts.entries()].sort(([a], [b]) => conventionalElementOrder(a, b, counts.has("C")));
  }, [structure]);
  const validGeometryIndices = useMemo(
    () => geometryIndices.map((index) => Math.min(index, Math.max(0, structure.atoms.length - 1))) as [number, number, number, number],
    [geometryIndices, structure.atoms.length],
  );
  const geometryResult = useMemo(
    () => measureGeometry(structure, validGeometryIndices),
    [structure, validGeometryIndices],
  );
  const reducedCandidate = useMemo(() => reducedCellCandidate(structure.cell), [structure.cell]);
  const reflections = useMemo(
    () => calculateReflections(structure, wavelength, diffractionRange[0], diffractionRange[1]),
    [structure, wavelength, diffractionRange],
  );
  const powderPattern = useMemo(
    () => calculatePowderPattern(reflections, diffractionRange[0], diffractionRange[1], 0.1, peakWidth),
    [reflections, diffractionRange, peakWidth],
  );
  const strongestReflections = useMemo(
    () => [...reflections].sort((a, b) => b.intensity - a.intensity).slice(0, 80),
    [reflections],
  );
  const electrostatics = useMemo(
    () => ewaldElectrostatics(structure, elementCharges),
    [structure, elementCharges],
  );
  const density = useMemo(
    () => calculateDensitySlice(structure, densityMode, densitySlice),
    [structure, densityMode, densitySlice],
  );
  const gaussianIndices = useMemo(
    () => gaussianAtomIndices(structure, selectedAtomIndex, gaussianScope),
    [structure, selectedAtomIndex, gaussianScope],
  );
  const gaussianModel = useMemo(
    () => prepareGaussianModel(structure, gaussianIndices, gaussianScope),
    [structure, gaussianIndices, gaussianScope],
  );
  const gaussianInput = useMemo(
    () => buildGaussianInputFromModel(structure, gaussianModel, gaussianOptions),
    [structure, gaussianModel, gaussianOptions],
  );
  const qePreparedInput = useMemo(
    () => buildQuantumEspressoInput(structure, qeOptions),
    [structure, qeOptions],
  );
  const qeRecommendation = useMemo(
    () => recommendQuantumEspressoSettings(structure),
    [structure],
  );
  const selectedQeMethodInfo = quantumEspressoMethodCatalog.find((method) => method.id === qeOptions.inputDft) ?? quantumEspressoMethodCatalog[0];
  const selectedQeBasisInfo = quantumEspressoBasisCatalog.find((basis) => basis.id === qeBasisPreset) ?? quantumEspressoBasisCatalog.at(-1)!;
  const availableQePseudoNames = useMemo(
    () => new Set((qeStatus?.pseudopotentials ?? []).map((file) => file.toLocaleLowerCase())),
    [qeStatus?.pseudopotentials],
  );
  const unavailableQePseudopotentials = qeStatus?.pseudoRoot
    ? qePreparedInput.requiredPseudopotentials.filter((file) => !availableQePseudoNames.has(file.toLocaleLowerCase()))
    : qePreparedInput.requiredPseudopotentials;
  const qeKPointCandidates = useMemo(
    () => suggestQuantumEspressoKPointMeshes(structure.cell, 6),
    [structure.cell.a, structure.cell.b, structure.cell.c, structure.cell.alpha, structure.cell.beta, structure.cell.gamma],
  );
  const qeCutoffCandidates = useMemo(
    () => buildQuantumEspressoCutoffSeries(
      qeCutoffRange.startRy,
      qeCutoffRange.endRy,
      qeCutoffRange.stepRy,
      qeCutoffRange.densityMultiplier,
    ),
    [qeCutoffRange],
  );
  const qeConvergenceInputFiles = useMemo<TextArchiveFile[]>(() => {
    const prefix = (qeOptions.prefix || "symviz-qe").replace(/[^A-Za-z0-9_.-]+/g, "-");
    const plans = qeConvergenceMode === "k-point"
      ? qeKPointCandidates
        .filter((candidate) => qeSelectedKMeshes.includes(qeMeshKey(candidate.kPoints)))
        .map((candidate) => ({ suffix: `k-${qeMeshKey(candidate.kPoints)}`, options: { kPoints: candidate.kPoints } }))
      : qeCutoffCandidates.map((candidate) => ({ suffix: `ecut-${candidate.ecutwfcRy}-${candidate.ecutrhoRy}`, options: candidate }));
    const inputs = plans.map((plan) => {
      const jobPrefix = `${prefix}-${plan.suffix}`;
      const prepared = buildQuantumEspressoInput(structure, {
        ...qeOptions,
        ...plan.options,
        calculation: "scf",
        title: `${qeOptions.title} · ${plan.suffix}`,
        prefix: jobPrefix,
      });
      return { name: `${jobPrefix}.in`, contents: prepared.input };
    });
    const readme = [
      english ? "SymViz Quantum ESPRESSO convergence input set" : "SymViz Quantum ESPRESSO 收敛测试输入集",
      "",
      english ? "Run each .in file independently with the same pseudopotential files." : "请使用完全相同的赝势文件分别运行每个 .in 文件。",
      english ? "Compare total energy per atom, forces, and stress; do not select a parameter from energy alone." : "请同时比较每原子总能量、力与应力，不要只依据能量选择参数。",
      english ? "Recommended order: converge cutoffs first, then regenerate and converge k-points." : "推荐顺序：先收敛截断能，再用选定截断能重新生成并收敛 k 点。",
      "",
      ...inputs.map((file, index) => `${index + 1}. ${file.name}`),
    ].join("\n");
    return [{ name: "README.txt", contents: readme }, ...inputs];
  }, [english, qeConvergenceMode, qeCutoffCandidates, qeKPointCandidates, qeOptions, qeSelectedKMeshes, structure]);
  const qeQueueBusy = qeJobs.some((job) => job.status === "queued" || job.status === "running");
  const qeConvergenceStudies = useMemo(() => {
    const groups = new Map<string, { id: string; kind: QeConvergenceMode; label: string; createdAt: string; jobs: QuantumEspressoJob[] }>();
    for (const job of qeJobs) {
      if (!job.study) continue;
      const existing = groups.get(job.study.id) ?? {
        id: job.study.id,
        kind: job.study.kind,
        label: job.study.label,
        createdAt: job.createdAt,
        jobs: [],
      };
      existing.jobs.push(job);
      if (job.createdAt < existing.createdAt) existing.createdAt = job.createdAt;
      groups.set(job.study.id, existing);
    }
    return [...groups.values()]
      .map((study) => ({
        ...study,
        jobs: study.jobs.sort((left, right) => (left.study?.sequenceIndex ?? 0) - (right.study?.sequenceIndex ?? 0)),
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [qeJobs]);
  const selectedQeStudy = qeConvergenceStudies.find((study) => study.id === selectedQeStudyId) ?? qeConvergenceStudies[0] ?? null;
  const selectedQeStudyAnalysis = useMemo(() => {
    if (!selectedQeStudy) return null;
    const referenceJob = selectedQeStudy.jobs.at(-1) ?? null;
    const referenceEnergy = referenceJob?.status === "completed" ? referenceJob.summary?.totalEnergyEv ?? null : null;
    const rows = selectedQeStudy.jobs.map((job) => ({
      job,
      deltaMevPerAtom: convergenceDeltaMevPerAtom(job.summary?.totalEnergyEv, referenceEnergy, job.study?.atomCount ?? 0),
    }));
    const expectedCount = selectedQeStudy.jobs[0]?.study?.sequenceTotal ?? selectedQeStudy.jobs.length;
    const complete = rows.length === expectedCount && rows.every(({ job }) => job.status === "completed" && job.summary?.totalEnergyEv !== null && job.summary?.totalEnergyEv !== undefined);
    const recommendedIndex = complete
      ? recommendedConvergenceIndex(rows.map((row) => row.deltaMevPerAtom), qeConvergenceTolerance)
      : -1;
    return { rows, complete, recommendedIndex, referenceJob };
  }, [selectedQeStudy, qeConvergenceTolerance]);
  useEffect(() => {
    setQeSelectedKMeshes(qeKPointCandidates.map((candidate) => qeMeshKey(candidate.kPoints)));
  }, [qeKPointCandidates]);
  const recommendedQeStudyJob = selectedQeStudyAnalysis && selectedQeStudyAnalysis.recommendedIndex >= 0
    ? selectedQeStudyAnalysis.rows[selectedQeStudyAnalysis.recommendedIndex]?.job ?? null
    : null;
  const selectedQeJob = qeJobs.find((job) => job.id === selectedQeJobId) ?? qeJobs[0] ?? null;
  const runningQeJob = qeJobs.find((job) => job.status === "running") ?? null;
  const liveQeRemoteId = runningQeJob?.remoteId ?? null;
  const visibleLiveQeOutput = liveQeOutput.jobId === liveQeRemoteId
    ? liveQeOutput
    : { text: "", size: 0, truncated: false, updatedAt: null };
  const selectedGaussianJob = gaussianJobs.find((job) => job.id === selectedGaussianJobId) ?? gaussianJobs[0] ?? null;
  const runningGaussianJobs = gaussianJobs.filter((job) => job.status === "running");
  const queuedGaussianJobs = gaussianJobs.filter((job) => job.status === "queued");
  const liveGaussianJob = runningGaussianJobs.find((job) => job.remoteId) ?? null;
  const liveGaussianRemoteId = liveGaussianJob?.remoteId ?? null;
  const visibleLiveGaussianOutput = liveGaussianOutput.jobId === liveGaussianRemoteId
    ? liveGaussianOutput
    : { text: "", size: 0, truncated: false, updatedAt: null };
  const selectedMultiwfnJob = multiwfnJobs.find((job) => job.id === selectedMultiwfnJobId) ?? multiwfnJobs[0] ?? null;
  const runningMultiwfnJob = multiwfnJobs.find((job) => job.status === "running") ?? null;
  const visibleLiveMultiwfnOutput = liveMultiwfnOutput.jobId === runningMultiwfnJob?.id
    ? liveMultiwfnOutput
    : { text: "", size: 0, truncated: false, updatedAt: null };
  const visibleGaussianJobs = useMemo(() => {
    const newerNames = new Set<string>();
    return gaussianJobs.filter((job) => {
      const key = job.name.trim().toLocaleLowerCase();
      const obsoleteRetry = newerNames.has(key) && ["failed", "cancelled"].includes(job.status);
      newerNames.add(key);
      return !obsoleteRetry;
    });
  }, [gaussianJobs]);

  useEffect(() => {
    const desktop = window.symvizDesktop;
    if (!desktop || !liveGaussianRemoteId) return;
    let disposed = false;
    let timer = 0;
    const pollOutput = async () => {
      try {
        const snapshot = await desktop.getOutputTail(liveGaussianRemoteId, 240_000);
        if (!disposed) setLiveGaussianOutput({ ...snapshot, jobId: liveGaussianRemoteId });
      } catch {
        // The output file may not exist during Gaussian startup; retry quietly.
      }
      if (!disposed) timer = window.setTimeout(pollOutput, 1000);
    };
    void pollOutput();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [liveGaussianRemoteId]);

  useEffect(() => {
    if (!followGaussianOutput || !liveGaussianOutputRef.current) return;
    liveGaussianOutputRef.current.scrollTop = liveGaussianOutputRef.current.scrollHeight;
  }, [followGaussianOutput, visibleLiveGaussianOutput.text]);

  useEffect(() => {
    const desktop = window.symvizDesktop;
    if (!desktop || !liveQeRemoteId) return;
    let disposed = false;
    let timer = 0;
    const pollOutput = async () => {
      try {
        const snapshot = await desktop.getQeOutputTail(liveQeRemoteId, 240_000);
        if (!disposed) setLiveQeOutput({ ...snapshot, jobId: liveQeRemoteId });
      } catch {
        // pw.x may not have created its output file yet; retry quietly.
      }
      if (!disposed) timer = window.setTimeout(pollOutput, 1000);
    };
    void pollOutput();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [liveQeRemoteId]);

  useEffect(() => {
    if (!followQeOutput || !liveQeOutputRef.current) return;
    liveQeOutputRef.current.scrollTop = liveQeOutputRef.current.scrollHeight;
  }, [followQeOutput, visibleLiveQeOutput.text]);

  useEffect(() => {
    const desktop = window.symvizDesktop;
    if (!desktop || !runningMultiwfnJob) return;
    let disposed = false;
    let timer = 0;
    const pollOutput = async () => {
      try {
        const snapshot = await desktop.getMultiwfnOutputTail(runningMultiwfnJob.id, 300_000);
        if (!disposed) setLiveMultiwfnOutput({ ...snapshot, jobId: runningMultiwfnJob.id });
      } catch {
        // Multiwfn may not have created its output file yet; retry quietly.
      }
      if (!disposed) timer = window.setTimeout(pollOutput, 800);
    };
    void pollOutput();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [runningMultiwfnJob?.id]);

  useEffect(() => {
    if (!followMultiwfnOutput || !liveMultiwfnOutputRef.current) return;
    liveMultiwfnOutputRef.current.scrollTop = liveMultiwfnOutputRef.current.scrollHeight;
  }, [followMultiwfnOutput, visibleLiveMultiwfnOutput.text]);

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
    const instances = buildDisplayAtomInstances(
      structure,
      baseFracts,
      supercell,
      display.completeMolecules,
      disorderSelections,
    );
    return display.hydrogens ? instances.length : instances.filter((instance) => instance.atom.element !== "H").length;
  }, [structure, supercell, display.completeMolecules, display.hydrogens, disorderSelections]);

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
      if (!fileMenuRef.current?.contains(target)) setFileMenuOpen(false);
      if (!utilitiesMenuRef.current?.contains(target)) setUtilitiesMenuOpen(false);
      if (!contextMenuRef.current?.contains(target) && !appearanceMenuRef.current?.contains(target)) {
        setContextMenu(null);
        setAppearanceMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFileMenuOpen(false);
        setUtilitiesMenuOpen(false);
        setContextMenu(null);
        setAppearanceMenu(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setFileMenuOpen(false);
        inputRef.current?.click();
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
    if (!/\.(?:cif|sdf|mol|xyz|mol2|pdb|ent)$/i.test(file.name)) {
      setNotice(text("请选择 CIF、SDF、MOL、XYZ、MOL2 或 PDB 结构文件", "Please select a CIF, SDF, MOL, XYZ, MOL2, or PDB structure file"));
      return;
    }
    try {
      const text = await file.text();
      const next = parseStructureFile(text, file.name);
      setWorkspaceMode("crystal");
      setStructure(next);
      setFileName(file.name);
      setSelectedAtomIndex(0);
      setSelectedOperationId(next.operations[0]?.id ?? 1);
      setGeometryIndices([
        0,
        Math.min(1, Math.max(0, next.atoms.length - 1)),
        Math.min(2, Math.max(0, next.atoms.length - 1)),
        Math.min(3, Math.max(0, next.atoms.length - 1)),
      ]);
      setElementCharges({});
      setDisorderSelections({});
      setCharacterPointGroup(next.pointGroup);
      setCalculatorOperationId(next.operations[0]?.id ?? 1);
      setCalculatorInput(next.sites[0]
        ? next.sites[0].fract.map((value) => value.toFixed(6)) as [string, string, string]
        : ["0", "0", "0"]);
      setGaussianOptions((current) => ({
        ...current,
        title: `${next.name} — SymViz`,
        checkpointName: next.name.replace(/[^\w.-]+/g, "-") || "symviz-job",
      }));
      const qeElements = [...new Set(next.atoms.map((atom) => atom.element))];
      const qePseudos = suggestQuantumEspressoPseudopotentials(qeElements, qeStatus?.pseudopotentials ?? []);
      const qeNextRecommendation = recommendQuantumEspressoSettings(next);
      setQeBasisPreset(qeNextRecommendation.basisPreset);
      setQeOptions((current) => ({
        ...current,
        title: `${next.name} — SymViz periodic DFT`,
        prefix: next.name.replace(/[^A-Za-z0-9_.-]+/g, "-") || "symviz-qe",
        calculation: qeNextRecommendation.calculation,
        inputDft: qeNextRecommendation.inputDft,
        dispersion: qeNextRecommendation.dispersion,
        occupations: qeNextRecommendation.occupations,
        smearing: qeNextRecommendation.smearing,
        degaussRy: qeNextRecommendation.degaussRy,
        ecutwfcRy: qeNextRecommendation.ecutwfcRy,
        ecutrhoRy: qeNextRecommendation.ecutrhoRy,
        kPoints: qeNextRecommendation.kPoints,
        kPointShift: qeNextRecommendation.kPointShift,
        pseudopotentials: qePseudos,
      }));
      setCube(null);
      setCubeFileName("");
      setAtomFocus({ mode: "none", sourceLabel: null });
      setContextMenu(null);
      setAppearanceMenu(null);
      setNotice(english
        ? `Loaded ${file.name}: ${next.atoms.length} atoms and ${next.bonds.length} bonds`
        : `已载入 ${file.name}：${next.atoms.length} 个原子、${next.bonds.length} 条化学键`);
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

  function openUtility(target: UtilityTarget, mode?: DensityMode) {
    setWorkspaceMode("crystal");
    setUtilitiesMenuOpen(false);
    setRightTab(target);
    if (mode) setDensityMode(mode);
  }

  function openSymmetryDemo() {
    setFileMenuOpen(false);
    setUtilitiesMenuOpen(false);
    setContextMenu(null);
    setAppearanceMenu(null);
    setSymmetryDemoOpened(true);
    setWorkspaceMode("symmetry-demo");
  }

  function downloadTextFile(name: string, contents: string, type = "text/plain;charset=utf-8") {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadTextArchive(name: string, files: TextArchiveFile[]) {
    const bytes = createTextZip(files);
    const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function applyQuantumEspressoBasisPreset(preset: QuantumEspressoBasisPreset) {
    setQeBasisPreset(preset);
    if (preset === "custom") return;
    const cutoffs = quantumEspressoCutoffsForPreset(qePreparedInput.diagnostics.elements, preset);
    setQeOptions((current) => ({ ...current, ...cutoffs }));
  }

  function applyQuantumEspressoRecommendation() {
    setQeBasisPreset(qeRecommendation.basisPreset);
    setQeOptions((current) => ({
      ...current,
      calculation: qeRecommendation.calculation,
      inputDft: qeRecommendation.inputDft,
      dispersion: qeRecommendation.dispersion,
      occupations: qeRecommendation.occupations,
      smearing: qeRecommendation.smearing,
      degaussRy: qeRecommendation.degaussRy,
      ecutwfcRy: qeRecommendation.ecutwfcRy,
      ecutrhoRy: qeRecommendation.ecutrhoRy,
      kPoints: qeRecommendation.kPoints,
      kPointShift: qeRecommendation.kPointShift,
    }));
    setQeCutoffRange({
      startRy: Math.max(20, Math.round(qeRecommendation.ecutwfcRy * 0.7 / 5) * 5),
      endRy: Math.round(qeRecommendation.ecutwfcRy * 1.4 / 5) * 5,
      stepRy: 10,
      densityMultiplier: Math.max(4, Math.round(qeRecommendation.ecutrhoRy / qeRecommendation.ecutwfcRy)),
    });
    setNotice(text("已采用针对当前 CIF 的 QE 输入建议；正式计算前仍需做收敛测试", "Applied CIF-aware QE input recommendations; convergence tests are still required for production work"));
  }

  async function chooseQuantumEspressoRoot() {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      setQeStatus(await desktop.chooseQeRoot());
      setNotice(text("Quantum ESPRESSO 安装目录已连接", "Quantum ESPRESSO installation connected"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法选择 Quantum ESPRESSO 目录", "Could not select the Quantum ESPRESSO folder"));
    }
  }

  async function chooseQuantumEspressoPseudoRoot() {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      const status = await desktop.chooseQePseudoRoot();
      setQeStatus(status);
      const suggestions = suggestQuantumEspressoPseudopotentials(qePreparedInput.diagnostics.elements, status.pseudopotentials);
      setQeOptions((current) => ({ ...current, pseudopotentials: suggestions }));
      setNotice(text("QE 赝势目录已连接，并已按元素自动匹配", "QE pseudopotentials connected and matched by element"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法选择赝势目录", "Could not select the pseudopotential folder"));
    }
  }

  async function refreshQuantumEspresso() {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      const [status, jobs] = await Promise.all([desktop.getQeStatus(), desktop.listQeJobs()]);
      setQeStatus(status);
      const refreshed = await Promise.all(jobs.map(async (job) => {
        const output = ["completed", "failed"].includes(job.status) ? await desktop.getQeOutput(job.id).catch(() => "") : "";
        return {
          id: `qe-${job.id}`,
          remoteId: job.id,
          name: job.name,
          status: job.status,
          createdAt: job.submittedAt,
          error: job.error || undefined,
          output: output || undefined,
          summary: output ? parseQuantumEspressoOutput(output) : undefined,
          study: job.study,
        } satisfies QuantumEspressoJob;
      }));
      setQeJobs(refreshed);
      setNotice(text("Quantum ESPRESSO 状态已刷新", "Quantum ESPRESSO status refreshed"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法刷新 QE 状态", "Could not refresh QE status"));
    }
  }

  async function submitQuantumEspressoJob() {
    const desktop = window.symvizDesktop;
    const issues = [...qePreparedInput.diagnostics.blockingIssues];
    if (unavailableQePseudopotentials.length) issues.push(`UPF: ${unavailableQePseudopotentials.join(", ")}`);
    if (issues.length) {
      setNotice(text(`QE 导出已阻止：${issues.join("；")}`, `QE export blocked: ${issues.join("; ")}`));
      return;
    }
    if (!desktop || !qeStatus?.available) {
      setNotice(text("尚未检测到 pw.exe / pw.x；可先下载输入文件", "pw.exe / pw.x is not connected; the input can still be downloaded"));
      return;
    }
    try {
      const submitted = await desktop.submitQeJob({
        name: qeOptions.prefix,
        input: qePreparedInput.input,
        pseudopotentials: qePreparedInput.requiredPseudopotentials,
      });
      const job: QuantumEspressoJob = {
        id: `qe-${submitted.id}`,
        remoteId: submitted.id,
        name: submitted.name,
        status: submitted.status,
        createdAt: submitted.submittedAt,
        error: submitted.error || undefined,
      };
      setQeJobs((current) => [job, ...current.filter((candidate) => candidate.remoteId !== job.remoteId)]);
      setSelectedQeJobId(job.id);
      setNotice(text("周期 DFT 任务已加入 QE 本地队列", "Periodic DFT job added to the local QE queue"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("QE 任务提交失败", "Could not submit the QE job"));
    }
  }

  async function submitQuantumEspressoConvergenceStudy(kind: QeConvergenceMode) {
    const desktop = window.symvizDesktop;
    const issues = [...qePreparedInput.diagnostics.blockingIssues];
    if (unavailableQePseudopotentials.length) issues.push(`UPF: ${unavailableQePseudopotentials.join(", ")}`);
    if (issues.length) {
      setNotice(text(`收敛测试已阻止：${issues.join("；")}`, `Convergence study blocked: ${issues.join("; ")}`));
      return;
    }
    if (!desktop || !qeStatus?.available) {
      setNotice(text("尚未检测到 pw.exe / pw.x，无法运行收敛测试", "pw.exe / pw.x is not connected; the convergence study cannot run"));
      return;
    }
    if (qeQueueBusy) {
      setNotice(text("请等待当前 QE 队列完成或取消后再创建收敛测试", "Finish or cancel the current QE queue before creating a convergence study"));
      return;
    }

    const kPointPlans = qeKPointCandidates.filter((candidate) => qeSelectedKMeshes.includes(qeMeshKey(candidate.kPoints)));
    const planCount = kind === "k-point" ? kPointPlans.length : qeCutoffCandidates.length;
    if (planCount < 2) {
      setNotice(text("收敛测试至少需要两个参数点", "A convergence study needs at least two parameter points"));
      return;
    }
    if (planCount > 12) {
      setNotice(text("单次收敛测试最多允许 12 个参数点", "A convergence study is limited to 12 parameter points"));
      return;
    }

    const studyId = `qe-${kind}-${window.crypto?.randomUUID?.() ?? Date.now()}`;
    const shortId = studyId.replace(/[^A-Za-z0-9]/g, "").slice(-8);
    const studyLabel = kind === "k-point"
      ? text(`${structure.name} · k 点收敛`, `${structure.name} · k-point convergence`)
      : text(`${structure.name} · 截断能收敛`, `${structure.name} · cutoff convergence`);
    const plans = kind === "k-point"
      ? kPointPlans.map((candidate) => ({
        kPoints: candidate.kPoints,
        ecutwfcRy: qeOptions.ecutwfcRy,
        ecutrhoRy: qeOptions.ecutrhoRy,
        suffix: `k-${candidate.kPoints.join("x")}`,
      }))
      : qeCutoffCandidates.map((candidate) => ({
        kPoints: qeOptions.kPoints,
        ecutwfcRy: candidate.ecutwfcRy,
        ecutrhoRy: candidate.ecutrhoRy,
        suffix: `cut-${Number(candidate.ecutwfcRy.toFixed(3))}`,
      }));

    const submittedJobs: QuantumEspressoJob[] = [];
    try {
      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index];
        const study: SymVizQeConvergenceStudy = {
          id: studyId,
          kind,
          label: studyLabel,
          sequenceIndex: index,
          sequenceTotal: plans.length,
          atomCount: qePreparedInput.diagnostics.atomCount,
          kPoints: plan.kPoints,
          ecutwfcRy: plan.ecutwfcRy,
          ecutrhoRy: plan.ecutrhoRy,
        };
        const candidateOptions: QuantumEspressoInputOptions = {
          ...qeOptions,
          calculation: "scf",
          title: `${studyLabel} · ${kind === "k-point" ? qeMeshKey(plan.kPoints) : `${plan.ecutwfcRy}/${plan.ecutrhoRy} Ry`}`,
          prefix: `${qeOptions.prefix}-${shortId}-${plan.suffix}`,
          kPoints: plan.kPoints,
          ecutwfcRy: plan.ecutwfcRy,
          ecutrhoRy: plan.ecutrhoRy,
        };
        const prepared = buildQuantumEspressoInput(structure, candidateOptions);
        if (prepared.diagnostics.blockingIssues.length) throw new Error(prepared.diagnostics.blockingIssues.join("; "));
        const submitted = await desktop.submitQeJob({
          name: candidateOptions.prefix,
          input: prepared.input,
          pseudopotentials: prepared.requiredPseudopotentials,
          study,
        });
        submittedJobs.push({
          id: `qe-${submitted.id}`,
          remoteId: submitted.id,
          name: submitted.name,
          status: submitted.status,
          createdAt: submitted.submittedAt,
          error: submitted.error || undefined,
          study: submitted.study || study,
        });
      }
      setQeJobs((current) => [
        ...submittedJobs,
        ...current.filter((candidate) => !submittedJobs.some((submitted) => submitted.remoteId === candidate.remoteId)),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
      setSelectedQeStudyId(studyId);
      if (submittedJobs[0]) setSelectedQeJobId(submittedJobs[0].id);
      setNotice(text(`已加入 ${plans.length} 个 SCF 参数点；QE 将串行运行`, `${plans.length} SCF parameter points queued; QE will run them serially`));
    } catch (error) {
      if (submittedJobs.length) {
        setQeJobs((current) => [...submittedJobs, ...current.filter((candidate) => !submittedJobs.some((submitted) => submitted.remoteId === candidate.remoteId))]);
        setSelectedQeStudyId(studyId);
      }
      const message = error instanceof Error ? error.message : text("无法创建收敛测试", "Could not create the convergence study");
      setNotice(submittedJobs.length
        ? text(`已加入 ${submittedJobs.length}/${plans.length} 个任务，随后失败：${message}`, `${submittedJobs.length}/${plans.length} tasks were queued before failure: ${message}`)
        : message);
    }
  }

  function applyQuantumEspressoConvergenceRecommendation(job: QuantumEspressoJob) {
    if (!job.study) return;
    if (job.study.kind === "k-point" && job.study.kPoints) {
      setQeOptions((current) => ({ ...current, kPoints: job.study?.kPoints ?? current.kPoints }));
      setNotice(text(`已采用推荐 k 点网格 ${qeMeshKey(job.study.kPoints)}`, `Recommended k-point mesh ${qeMeshKey(job.study.kPoints)} applied`));
      return;
    }
    if (job.study.kind === "cutoff" && job.study.ecutwfcRy !== null && job.study.ecutrhoRy !== null) {
      setQeOptions((current) => ({ ...current, ecutwfcRy: job.study?.ecutwfcRy ?? current.ecutwfcRy, ecutrhoRy: job.study?.ecutrhoRy ?? current.ecutrhoRy }));
      setNotice(text(`已采用推荐截断能 ${job.study.ecutwfcRy}/${job.study.ecutrhoRy} Ry`, `Recommended cutoffs ${job.study.ecutwfcRy}/${job.study.ecutrhoRy} Ry applied`));
    }
  }

  async function cancelQuantumEspressoJob(job: QuantumEspressoJob) {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      const cancelled = await desktop.cancelQeJob(job.remoteId);
      setQeJobs((current) => current.map((candidate) => candidate.remoteId === job.remoteId
        ? { ...candidate, status: cancelled.status, error: cancelled.error || undefined }
        : candidate));
      setNotice(text("Quantum ESPRESSO 任务已取消", "Quantum ESPRESSO job cancelled"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法取消 QE 任务", "Could not cancel the QE job"));
    }
  }

  async function chooseMultiwfnRoot() {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      setMultiwfnStatus(await desktop.chooseMultiwfnRoot());
      setNotice(text("Multiwfn 安装目录已连接", "Multiwfn installation connected"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法连接 Multiwfn", "Could not connect Multiwfn"));
    }
  }

  async function chooseMultiwfnInput() {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      const selected = await desktop.chooseMultiwfnInput();
      if (!selected) return;
      setMultiwfnInput(selected);
      setMultiwfnJobName(selected.name.replace(/\.[^.]+$/, "") || "Multiwfn-analysis");
      setNotice(text(`已选择 ${selected.name}`, `Selected ${selected.name}`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法选择输入文件", "Could not select the input file"));
    }
  }

  async function refreshMultiwfnJobs() {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      const [status, jobs] = await Promise.all([desktop.getMultiwfnStatus(), desktop.listMultiwfnJobs()]);
      setMultiwfnStatus(status);
      setMultiwfnJobs(jobs);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法刷新 Multiwfn", "Could not refresh Multiwfn"));
    }
  }

  async function submitMultiwfnJob() {
    const desktop = window.symvizDesktop;
    if (!desktop || !multiwfnInput) {
      setNotice(text("请先选择 Multiwfn 输入文件", "Choose a Multiwfn input file first"));
      return;
    }
    try {
      const job = await desktop.submitMultiwfnJob({
        name: multiwfnJobName,
        inputPath: multiwfnInput.path,
        taskId: multiwfnTaskId,
        script: multiwfnScript,
      });
      setMultiwfnJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)]);
      setSelectedMultiwfnJobId(job.id);
      setSelectedMultiwfnOutput("");
      setNotice(text("Multiwfn 任务已加入本地队列", "Multiwfn job added to the local queue"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法启动 Multiwfn 任务", "Could not start the Multiwfn job"));
    }
  }

  async function submitMultiwfnCubeFromJob(job: SymVizMultiwfnJob, taskId: "density-cube" | "esp-cube" | "homo-cube" | "lumo-cube") {
    const desktop = window.symvizDesktop;
    const inputPath = job.files.input;
    if (!desktop || typeof inputPath !== "string" || !inputPath) return;
    try {
      const suffix = {
        "density-cube": "density",
        "esp-cube": "ESP",
        "homo-cube": "HOMO",
        "lumo-cube": "LUMO",
      }[taskId];
      const derived = await desktop.submitMultiwfnJob({
        name: `${job.name}-${suffix}-cube`,
        inputPath,
        taskId,
        script: "",
      });
      setMultiwfnJobs((current) => [derived, ...current.filter((candidate) => candidate.id !== derived.id)]);
      setSelectedMultiwfnJobId(derived.id);
      setSelectedMultiwfnOutput("");
      setNotice(text(`${suffix} Cube 任务已加入队列`, `${suffix} Cube job added to the queue`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法生成 Cube", "Could not generate the Cube file"));
    }
  }

  async function cancelMultiwfnJob(job: SymVizMultiwfnJob) {
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    try {
      const cancelled = await desktop.cancelMultiwfnJob(job.id);
      setMultiwfnJobs((current) => current.map((candidate) => candidate.id === cancelled.id ? cancelled : candidate));
      setNotice(text("Multiwfn 任务已取消", "Multiwfn job cancelled"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法取消 Multiwfn 任务", "Could not cancel the Multiwfn job"));
    }
  }

  async function selectMultiwfnJob(job: SymVizMultiwfnJob) {
    setSelectedMultiwfnJobId(job.id);
    const desktop = window.symvizDesktop;
    if (!desktop) return;
    const output = await desktop.getMultiwfnOutput(job.id).catch(() => "");
    setSelectedMultiwfnOutput(output);
  }

  function createGaussianJob() {
    if (gaussianModel.diagnostics.blockingIssues.length) {
      setNotice(text(
        `Gaussian 导出已阻止：${gaussianModel.diagnostics.blockingIssues.join("；")}`,
        `Gaussian export blocked: ${gaussianModel.diagnostics.blockingIssues.join(" ")}`,
      ));
      return;
    }
    const id = window.crypto?.randomUUID?.() ?? `job-${Date.now()}`;
    const stem = (gaussianOptions.checkpointName || gaussianOptions.title || "symviz-job")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]+/g, "-") || "symviz-job";
    const job: GaussianJob = {
      id,
      name: stem,
      input: gaussianInput,
      status: "ready",
      createdAt: new Date().toISOString(),
    };
    setGaussianJobs((current) => [job, ...current]);
    setSelectedGaussianJobId(id);
    setQuantumSubview("queue");
    setRightTab("gaussian");
    setNotice(text("Gaussian 输入已加入本地队列", "Gaussian input added to the local queue"));
  }

  async function importGaussianOutput(file: File) {
    try {
      const output = await file.text();
      const summary = parseGaussianOutput(output);
      const id = window.crypto?.randomUUID?.() ?? `output-${Date.now()}`;
      const job: GaussianJob = {
        id,
        name: file.name.replace(/\.(?:log|out)$/i, "") || "gaussian-output",
        input: "",
        status: summary.status === "completed" ? "completed" : summary.status === "failed" ? "failed" : "running",
        createdAt: new Date(file.lastModified || Date.now()).toISOString(),
        output,
        summary,
      };
      setGaussianJobs((current) => [job, ...current]);
      setSelectedGaussianJobId(id);
      setQuantumSubview("results");
      setRightTab("gaussian");
      setNotice(summary.normalTermination
        ? text("Gaussian 输出解析完成", "Gaussian output parsed")
        : text("输出已载入，但未检测到正常终止", "Output loaded; normal termination was not detected"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("Gaussian 输出解析失败", "Could not parse the Gaussian output"));
    }
  }

  async function importCubeFile(file: File) {
    try {
      const nextCube = parseGaussianCube(await file.text());
      setCube(nextCube);
      setCubeFileName(file.name);
      setCubeIsovalue(defaultCubeIsovalue(nextCube));
      const phases = cubePhaseAvailability(nextCube);
      setCubePositive(phases.positive);
      setCubeNegative(phases.negative);
      setQuantumSubview("cube");
      setRightTab("gaussian");
      setNotice(text(`已载入 ${file.name} 的三维网格`, `Loaded the 3D grid from ${file.name}`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("Cube 文件解析失败", "Could not parse the Cube file"));
    }
  }

  async function checkGaussianBridge() {
    if (window.symvizDesktop) {
      try {
        const status = await window.symvizDesktop.getStatus();
        setDesktopStatus(status);
        setGaussianBridgeHealth({
          available: status.available,
          gaussianRoot: status.gaussianRoot,
          workRoot: status.workRoot,
        });
        setNotice(status.available
          ? text("桌面版已连接 Gaussian 16", "Gaussian 16 is connected to the desktop app")
          : text("尚未检测到 Gaussian 16", "Gaussian 16 has not been detected"));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : text("无法检查 Gaussian", "Could not check Gaussian"));
      }
      return;
    }
    try {
      const response = await fetch(`${gaussianBridgeUrl.replace(/\/$/, "")}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json() as {
        gaussianRoot?: string;
        workRoot?: string;
        binaries?: Record<string, { available: boolean }>;
      };
      const available = Boolean(health.binaries?.g16?.available);
      setGaussianBridgeHealth({ available, gaussianRoot: health.gaussianRoot, workRoot: health.workRoot });
      setNotice(available
        ? text("本机 Gaussian 16 桥接器已连接", "Connected to the local Gaussian 16 bridge")
        : text("桥接器已连接，但未找到 Gaussian 16", "Bridge connected, but Gaussian 16 was not found"));
    } catch (error) {
      setGaussianBridgeHealth({
        available: false,
        message: error instanceof Error ? error.message : String(error),
      });
      setNotice(text("未连接本机 Gaussian 桥接器", "The local Gaussian bridge is not connected"));
    }
  }

  async function chooseDesktopGaussianRoot() {
    if (!window.symvizDesktop) return;
    try {
      const status = await window.symvizDesktop.chooseGaussianRoot();
      setDesktopStatus(status);
      setGaussianBridgeHealth({
        available: status.available,
        gaussianRoot: status.gaussianRoot,
        workRoot: status.workRoot,
      });
      setNotice(status.available
        ? text("Gaussian 16 安装目录已连接", "Gaussian 16 installation connected")
        : text("未选择 Gaussian 16 安装目录", "No Gaussian 16 installation selected"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法选择 Gaussian 目录", "Could not select the Gaussian folder"));
    }
  }

  async function cancelGaussianJob(job: GaussianJob) {
    if (!window.symvizDesktop || !job.remoteId) return;
    try {
      const cancelled = await window.symvizDesktop.cancelJob(job.remoteId);
      setGaussianJobs((current) => current.map((candidate) => candidate.id === job.id
        ? { ...candidate, status: cancelled.status }
        : candidate));
      setNotice(text("Gaussian 任务已取消", "Gaussian job cancelled"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法取消任务", "Could not cancel the job"));
    }
  }

  async function submitGaussianJob(job: GaussianJob) {
    if (window.symvizDesktop) {
      try {
        setGaussianJobs((current) => current.map((candidate) => candidate.id === job.id ? { ...candidate, status: "queued" } : candidate));
        const submitted = await window.symvizDesktop.submitJob({ name: job.name, input: job.input });
        setGaussianJobs((current) => current.map((candidate) => candidate.id === job.id
          ? { ...candidate, remoteId: submitted.id, status: submitted.status }
          : candidate));
        setNotice(text("Gaussian 已由 SymViz 桌面版直接启动", "Gaussian was started directly by SymViz Desktop"));
      } catch (error) {
        setGaussianJobs((current) => current.map((candidate) => candidate.id === job.id ? { ...candidate, status: "failed" } : candidate));
        setNotice(error instanceof Error ? error.message : text("任务启动失败", "Could not start the job"));
      }
      return;
    }
    if (!gaussianBridgeToken.trim()) {
      setNotice(text("请先填写桥接器终端显示的访问令牌", "Enter the access token shown by the bridge terminal"));
      return;
    }
    try {
      setGaussianJobs((current) => current.map((candidate) => candidate.id === job.id ? { ...candidate, status: "queued" } : candidate));
      const response = await fetch(`${gaussianBridgeUrl.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-symviz-token": gaussianBridgeToken.trim(),
        },
        body: JSON.stringify({ name: job.name, input: job.input }),
      });
      const result = await response.json() as { job?: { id: string; status: GaussianJobStatus }; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error || `HTTP ${response.status}`);
      setGaussianJobs((current) => current.map((candidate) => candidate.id === job.id
        ? { ...candidate, remoteId: result.job!.id, status: result.job!.status }
        : candidate));
      setNotice(text("Gaussian 任务已提交至本机", "Gaussian job submitted locally"));
    } catch (error) {
      setGaussianJobs((current) => current.map((candidate) => candidate.id === job.id ? { ...candidate, status: "failed" } : candidate));
      setNotice(error instanceof Error ? error.message : text("任务提交失败", "Job submission failed"));
    }
  }

  async function refreshGaussianJobs() {
    if (window.symvizDesktop) {
      try {
        const remoteJobs = await window.symvizDesktop.listJobs();
        const refreshed = await Promise.all(gaussianJobs.map(async (job) => {
          if (!job.remoteId) return job;
          const remote = remoteJobs.find((candidate) => candidate.id === job.remoteId);
          if (!remote) return job;
          const output = ["completed", "failed"].includes(remote.status)
            ? await window.symvizDesktop!.getOutput(remote.id).catch(() => job.output || "")
            : job.output;
          return {
            ...job,
            status: remote.status,
            output,
            summary: output ? parseGaussianOutput(output) : job.summary,
          };
        }));
        const knownRemoteIds = new Set(refreshed.map((job) => job.remoteId).filter(Boolean));
        remoteJobs.forEach((remote) => {
          if (knownRemoteIds.has(remote.id)) return;
          refreshed.push({
            id: `desktop-${remote.id}`,
            remoteId: remote.id,
            name: remote.name,
            input: "",
            status: remote.status,
            createdAt: remote.submittedAt,
          });
        });
        setGaussianJobs(refreshed.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setNotice(text("桌面任务状态已刷新", "Desktop job status refreshed"));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : text("无法刷新桌面任务", "Could not refresh desktop jobs"));
      }
      return;
    }
    if (!gaussianBridgeToken.trim()) {
      setNotice(text("请填写桥接器访问令牌", "Enter the bridge access token"));
      return;
    }
    try {
      const base = gaussianBridgeUrl.replace(/\/$/, "");
      const headers = { "x-symviz-token": gaussianBridgeToken.trim() };
      const response = await fetch(`${base}/jobs`, { headers, cache: "no-store" });
      const result = await response.json() as { jobs?: Array<{ id: string; status: GaussianJobStatus }>; error?: string };
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      const remoteJobs = new Map((result.jobs ?? []).map((job) => [job.id, job]));
      const refreshed = await Promise.all(gaussianJobs.map(async (job) => {
        if (!job.remoteId) return job;
        const remote = remoteJobs.get(job.remoteId);
        if (!remote) return job;
        if (!["completed", "failed"].includes(remote.status)) return { ...job, status: remote.status };
        const outputResponse = await fetch(`${base}/jobs/${job.remoteId}/output`, { headers, cache: "no-store" });
        const output = outputResponse.ok ? await outputResponse.text() : job.output;
        return {
          ...job,
          status: remote.status,
          output,
          summary: output ? parseGaussianOutput(output) : job.summary,
        };
      }));
      setGaussianJobs(refreshed);
      setNotice(text("本地任务状态已刷新", "Local job status refreshed"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("无法刷新任务", "Could not refresh jobs"));
    }
  }

  async function generateCubeForJob(job: GaussianJob) {
    if (window.symvizDesktop && job.remoteId) {
      try {
        setNotice(text("正在由 Gaussian 检查点生成 Cube…", "Generating a Cube file from the Gaussian checkpoint…"));
        await window.symvizDesktop.generateCube(job.remoteId, cubeProperty);
        const result = await window.symvizDesktop.readCube(job.remoteId, cubeProperty);
        const nextCube = parseGaussianCube(result.text);
        setCube(nextCube);
        setCubeFileName(result.fileName);
        setCubeIsovalue(defaultCubeIsovalue(nextCube));
        const phases = cubePhaseAvailability(nextCube);
        setCubePositive(phases.positive);
        setCubeNegative(phases.negative);
        setQuantumSubview("cube");
        setNotice(text("Cube 已生成并载入三维查看器", "Cube generated and loaded in the 3D viewer"));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : text("Cube 生成失败", "Cube generation failed"));
      }
      return;
    }
    if (!job.remoteId || !gaussianBridgeToken.trim()) {
      setNotice(text("只有由本机桥接器完成的任务可以直接生成 Cube", "Only jobs completed by the local bridge can generate a Cube directly"));
      return;
    }
    try {
      const base = gaussianBridgeUrl.replace(/\/$/, "");
      const headers = {
        "content-type": "application/json",
        "x-symviz-token": gaussianBridgeToken.trim(),
      };
      setNotice(text("正在由检查点文件生成 Cube…", "Generating a Cube file from the checkpoint…"));
      const response = await fetch(`${base}/jobs/${job.remoteId}/cube`, {
        method: "POST",
        headers,
        body: JSON.stringify({ property: cubeProperty }),
      });
      const result = await response.json() as { fileName?: string; downloadUrl?: string; error?: string };
      if (!response.ok || !result.downloadUrl) throw new Error(result.error || `HTTP ${response.status}`);
      const cubeResponse = await fetch(`${base}${result.downloadUrl}`, {
        headers: { "x-symviz-token": gaussianBridgeToken.trim() },
        cache: "no-store",
      });
      if (!cubeResponse.ok) throw new Error(`HTTP ${cubeResponse.status}`);
      const nextCube = parseGaussianCube(await cubeResponse.text());
      setCube(nextCube);
      setCubeFileName(result.fileName || `${job.name}-${cubeProperty}.cube`);
      setCubeIsovalue(defaultCubeIsovalue(nextCube));
      const phases = cubePhaseAvailability(nextCube);
      setCubePositive(phases.positive);
      setCubeNegative(phases.negative);
      setQuantumSubview("cube");
      setNotice(text("Cube 已生成并载入三维查看器", "Cube generated and loaded in the 3D viewer"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text("Cube 生成失败", "Cube generation failed"));
    }
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

  function selectDisorderConformer(assembly: string, group: string) {
    setDisorderSelections((current) => ({ ...current, [assembly]: group }));
    const currentAtom = structure.atoms[selectedAtomIndex];
    if (group !== "all" && currentAtom) {
      const currentAssembly = disorderAssemblyKey(currentAtom.source);
      if (currentAssembly === assembly && currentAtom.source.disorderGroup && currentAtom.source.disorderGroup !== group) {
        const replacementInGroup = structure.atoms.findIndex((atom) => (
          disorderAssemblyKey(atom.source) === assembly && atom.source.disorderGroup === group
        ));
        const replacement = replacementInGroup >= 0 ? replacementInGroup : structure.atoms.findIndex((atom) => (
          disorderAssemblyKey(atom.source) !== assembly || !atom.source.disorderGroup
        ));
        if (replacement >= 0) setSelectedAtomIndex(replacement);
      }
    }
    const assemblyName = assembly === "__unassigned__" ? text("未指定组装", "unassigned assembly") : `${text("组装", "assembly")} ${assembly}`;
    setNotice(group === "all"
      ? text(`${assemblyName} 已叠加显示全部构象`, `${assemblyName} now overlays all conformers`)
      : text(`${assemblyName} 仅显示构象 ${group}`, `${assemblyName} now shows conformer ${group} only`));
  }

  function updateZClipping(side: keyof ZClippingSettings, value: number) {
    setZClipping((current) => {
      if (side === "back") return { ...current, back: Math.max(0, Math.min(98, value)) };
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
      disorderAnalysis: {
        ...structure.disorder,
        displayedConformers: disorderSelections,
        interpretation: "Explicit CIF disorder fields are reported separately from geometry-based split-site candidates.",
      },
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
      className={["app-shell", dragActive ? "dragging" : "", sidebarCollapsed ? "sidebar-collapsed" : "", rightPanelResizing ? "right-panel-resizing" : "", workspaceMode === "symmetry-demo" ? "symmetry-demo-active" : ""].filter(Boolean).join(" ")}
      style={{ "--right-panel-width": `${rightPanelWidth}px` } as CSSProperties}
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
        <div className="desktop-title-strip">
          <div className="brand">
            <span className="brand-mark"><i /><b /><em /></span>
            <div><strong>SYM<span>VIZ</span></strong><small>CRYSTAL SYMMETRY EXPLORER</small></div>
            <span className="app-version">v0.1.3</span>
            {desktopMode && <span className="desktop-edition-badge">DESKTOP</span>}
          </div>
          <div className="header-structure">
            <span className="file-status">{fileName.split(".").pop()?.toUpperCase() ?? "DATA"}</span>
            <div><strong>{structure.name}</strong><small>{fileName}</small></div>
          </div>
          <div className="header-actions">
            <div className="language-switch" role="group" aria-label={text("界面语言", "Interface language")}>
              <button type="button" className={language === "zh-CN" ? "active" : ""} onClick={() => changeLanguage("zh-CN")}>中文</button>
              <button type="button" className={language === "en-US" ? "active" : ""} title="English (US)" onClick={() => changeLanguage("en-US")}>EN-US</button>
            </div>
          </div>
        </div>

        <nav className="desktop-menubar" aria-label={text("主菜单", "Main menu")}>
          <div className="menubar-menu" ref={fileMenuRef}>
            <button
              type="button"
              className={fileMenuOpen ? "menu-trigger active" : "menu-trigger"}
              aria-haspopup="menu"
              aria-expanded={fileMenuOpen}
              onClick={() => setFileMenuOpen((current) => !current)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setFileMenuOpen(true);
                }
              }}
            >
              {text("文件", "File")}<span aria-hidden="true">▾</span>
            </button>
            <div className="desktop-menu-popup" role="menu" hidden={!fileMenuOpen}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  inputRef.current?.click();
                }}
              >
                <span aria-hidden="true">⌁</span>
                <b>{text("打开结构文件…", "Open structure file…")}</b>
                <kbd>Ctrl+O</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  exportReport();
                }}
              >
                <span aria-hidden="true">⇩</span>
                <b>{text("导出报告", "Export report")}</b>
              </button>
              <div className="desktop-menu-formats">CIF · SDF · MOL · XYZ · MOL2 · PDB</div>
            </div>
          </div>
          <button type="button" className={workspaceMode === "crystal" && leftTab === "model" ? "active" : ""} onClick={() => { setWorkspaceMode("crystal"); setLeftTab("model"); }}>{text("结构", "Structure")}</button>
          <button type="button" className={workspaceMode === "crystal" && leftTab === "style" ? "active" : ""} onClick={() => { setWorkspaceMode("crystal"); setLeftTab("style"); }}>{text("样式", "Style")}</button>
          <button type="button" className={workspaceMode === "crystal" && rightTab === "operations" ? "active" : ""} onClick={() => { setWorkspaceMode("crystal"); setRightTab("operations"); }}>{text("对称性", "Symmetry")}</button>
          <button type="button" className={workspaceMode === "symmetry-demo" ? "active" : ""} aria-pressed={workspaceMode === "symmetry-demo"} onClick={openSymmetryDemo}>{text("空间群演示", "Space-group demos")}</button>
          <button type="button" className={workspaceMode === "crystal" && (rightTab === "hydrogen" || rightTab === "disorder") ? "active" : ""} onClick={() => { setWorkspaceMode("crystal"); setRightTab("hydrogen"); }}>{text("分析", "Analysis")}</button>
          <div className="menubar-menu" ref={utilitiesMenuRef}>
            <button
              type="button"
              className={[
                "menu-trigger",
                utilitiesMenuOpen ? "active" : "",
                ["calculator", "characters", "geometry", "cellTools", "electrostatics", "diffraction", "density", "gaussian"].includes(rightTab) ? "active" : "",
              ].filter(Boolean).join(" ")}
              aria-haspopup="menu"
              aria-expanded={utilitiesMenuOpen}
              onClick={() => setUtilitiesMenuOpen((current) => !current)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setUtilitiesMenuOpen(true);
                }
              }}
            >
              {text("工具", "Utilities")}<span aria-hidden="true">▾</span>
            </button>
            <div className="desktop-menu-popup utilities-menu-popup" role="menu" hidden={!utilitiesMenuOpen}>
              <div className="desktop-menu-section-label">{text("结构与晶体学", "Structure & crystallography")}</div>
              <button type="button" role="menuitem" onClick={openSymmetryDemo}><span>2₁</span><b>{text("空间群对称操作演示…", "Space-group symmetry demonstrations…")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("operations")}><span>≡</span><b>{text("等价位置…", "Equivalent Positions…")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("geometry")}><span>∠</span><b>{text("几何参数…", "Geometrical Parameters…")}</b></button>
              <div className="desktop-menu-divider" />
              <button type="button" role="menuitem" onClick={() => openUtility("cellTools")}><span>□</span><b>{text("晶体数据标准化", "Standardization of Crystal Data")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("cellTools")}><span>N</span><b>{text("Niggli 约化晶胞", "Niggli-Reduced Cell")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("electrostatics")}><span>±</span><b>{text("位点电势与 Madelung 能…", "Site Potentials and Madelung Energy…")}</b></button>
              <div className="desktop-menu-divider" />
              <div className="desktop-menu-section-label">{text("衍射与密度", "Diffraction & density")}</div>
              <button type="button" role="menuitem" onClick={() => openUtility("diffraction")}><span>⌁</span><b>{text("粉末衍射图…", "Powder Diffraction Pattern…")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("diffraction")}><span>F</span><b>{text("结构因子…", "Structure Factors…")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("density", "electron")}><span>Σ</span><b>{text("傅里叶合成…", "Fourier Synthesis…")}</b></button>
              <div className="desktop-menu-divider" />
              <button type="button" role="menuitem" onClick={() => openUtility("density", "electron")}><span>e</span><b>{text("模型电子密度…", "Model Electron Densities…")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("density", "nuclear")}><span>n</span><b>{text("模型核密度…", "Model Nuclear Densities…")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("density", "patterson")}><span>P</span><b>Patterson {text("密度…", "Densities…")}</b></button>
              <div className="desktop-menu-divider" />
              <button type="button" role="menuitem" onClick={() => openUtility("density")}><span>▦</span><b>{text("二维数据显示…", "2D Data Display…")}</b></button>
              <button type="button" role="menuitem" onClick={() => openUtility("density")}><span>⌇</span><b>{text("线剖面…", "Line Profile…")}</b></button>
              <div className="desktop-menu-divider" />
              <div className="desktop-menu-section-label">{text("计算化学", "Computational chemistry")}</div>
              <button type="button" role="menuitem" onClick={() => { openUtility("gaussian"); setQuantumSubview("input"); }}><span>G</span><b>{text("Gaussian 分子计算…", "Gaussian Molecular Calculation…")}</b></button>
              <button type="button" role="menuitem" onClick={() => { openUtility("gaussian"); setQuantumSubview("qe"); }}><span>Q</span><b>{text("Quantum ESPRESSO 周期计算…", "Quantum ESPRESSO Periodic DFT…")}</b></button>
              <button type="button" role="menuitem" onClick={() => { openUtility("gaussian"); setQuantumSubview("multiwfn"); }}><span>M</span><b>{text("Multiwfn 波函数分析…", "Multiwfn Wavefunction Analysis…")}</b></button>
              <button type="button" role="menuitem" onClick={() => { openUtility("gaussian"); setQuantumSubview("cube"); }}><span>◈</span><b>{text("Cube 三维等值面…", "Cube Isosurfaces…")}</b></button>
              <div className="desktop-menu-divider" />
              <div className="desktop-menu-section-label">{text("参考资料", "Reference")}</div>
              <button type="button" role="menuitem" onClick={() => openUtility("characters")}><span>χ</span><b>{text("三十二点群特征标表…", "32 Point-group Character Tables…")}</b></button>
            </div>
          </div>
        </nav>

        <div className="desktop-toolbar" role="toolbar" aria-label={text("常用工具", "Common tools")}>
          <div className="toolbar-group file-tools">
            <button type="button" title={text("导出报告", "Export report")} onClick={exportReport}><span>⇩</span><small>{text("报告", "Report")}</small></button>
          </div>
          <i className="toolbar-separator" />
          <div className="toolbar-group layer-tools">
            <button type="button" className={display.atoms ? "active" : ""} aria-pressed={display.atoms} onClick={() => toggleDisplay("atoms")} title={text("显示原子", "Show atoms")}><span className="tool-atom">●</span><small>{text("原子", "Atoms")}</small></button>
            <button type="button" className={display.bonds ? "active" : ""} aria-pressed={display.bonds} onClick={() => toggleDisplay("bonds")} title={text("显示化学键", "Show bonds")}><span className="tool-bond">━</span><small>{text("化学键", "Bonds")}</small></button>
            <button type="button" className={display.cell ? "active" : ""} aria-pressed={display.cell} onClick={() => toggleDisplay("cell")} title={text("显示晶胞", "Show unit cell")}><span>◇</span><small>{text("晶胞", "Cell")}</small></button>
            <button type="button" className={display.symmetry ? "active" : ""} aria-pressed={display.symmetry} onClick={() => toggleDisplay("symmetry")} title={text("显示对称元素", "Show symmetry elements")}><span>⌘</span><small>{text("对称", "Symmetry")}</small></button>
            <button type="button" className={display.hydrogenBonds ? "active hbond-tool" : "hbond-tool"} aria-pressed={display.hydrogenBonds} onClick={() => toggleDisplay("hydrogenBonds")} title={text("显示氢键候选", "Show hydrogen-bond candidates")}><span>┄</span><small>{text("氢键", "H bonds")}</small></button>
            <button type="button" className={display.zClipping ? "active" : ""} aria-pressed={display.zClipping} onClick={() => toggleDisplay("zClipping")} title={text("深度渐隐", "Depth fade")}><span>◐</span><small>Z fade</small></button>
          </div>
          <div className="toolbar-readout">
            <span>{prettyGroup(structure.spaceGroup)}</span>
            <i />
            <span>{supercellText(supercell)}</span>
            <i />
            <span>{displayedAtomCount} {text("原子", "atoms")}</span>
          </div>
          <input ref={inputRef} type="file" accept=".cif,.sdf,.mol,.xyz,.mol2,.pdb,.ent,text/plain,chemical/x-cif,chemical/x-mdl-sdfile,chemical/x-mol2,chemical/x-xyz" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.target.value = ""; }} />
          <input ref={gaussianOutputRef} type="file" accept=".log,.out,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importGaussianOutput(file); event.target.value = ""; }} />
          <input ref={cubeInputRef} type="file" accept=".cube,.cub,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCubeFile(file); event.target.value = ""; }} />
        </div>
      </header>

      {symmetryDemoOpened && <SymmetryDemoWorkspace
        visible={workspaceMode === "symmetry-demo"}
        currentSpaceGroupNumber={structure.spaceGroupNumber}
        currentSpaceGroupName={structure.spaceGroup}
        language={language}
        onBack={() => setWorkspaceMode("crystal")}
        onOpenFile={() => inputRef.current?.click()}
      />}

      <aside className="left-panel panel-scroll" data-active-tab={leftTab}>
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
        <nav className="left-mode-tabs" aria-label={text("左侧工作区", "Left workspace")}>
          <button type="button" className={leftTab === "model" ? "active" : ""} onClick={() => setLeftTab("model")}>{text("模型", "Model")}</button>
          <button type="button" className={leftTab === "style" ? "active" : ""} onClick={() => setLeftTab("style")}>{text("样式", "Style")}</button>
          <button type="button" className={leftTab === "inspect" ? "active" : ""} onClick={() => setLeftTab("inspect")}>{text("检查", "Inspect")}</button>
        </nav>
        <section className="upload-card" data-left-section="model" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") inputRef.current?.click(); }}>
          <div className="upload-icon">⌁</div>
          <div><strong>{text("载入结构文件", "Load a structure file")}</strong><small>CIF · SDF · XYZ · MOL2 · PDB</small></div>
          <span>⌘O</span>
        </section>

        <section className="side-section" data-left-section="model">
          <div className="section-heading"><span>{text("结构概览", "Structure overview")}</span><small>ASYMMETRIC UNIT</small></div>
          <div className="formula-card">
            <div><span>{text("化学式 · 常用书写顺序", "Formula · conventional order")}</span><strong>{structure.formula}</strong></div>
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

        <section className="side-section supercell-section" data-left-section="model">
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

        <section className="side-section display-section" data-left-section="style">
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
            label={text("Z clipping / 后景渐隐", "Z clipping / rear fade")}
            hint={display.zClipping ? (english ? `Rear cutoff ${zClipping.back}% with a ${zClipping.fade}% feather` : `仅虚化后景：裁切 ${zClipping.back}%，渐隐宽度 ${zClipping.fade}%`) : text("仅沿当前观察方向虚化后景", "Fade only the rear depth along the current view direction")}
            checked={display.zClipping}
            onChange={() => toggleDisplay("zClipping")}
          />
          {display.zClipping && <div className="z-clipping-controls">
            <div className="z-clipping-head"><span>{text("后景深度渐隐", "Rear depth fade")}</span><button type="button" onClick={() => setZClipping(defaultZClipping)}>{text("重置", "Reset")}</button></div>
            <label>
              <span>{text("后方裁切位置", "Rear cutoff")}<output>{zClipping.back}%</output></span>
              <input
                type="range"
                min="0"
                max="98"
                step="1"
                value={zClipping.back}
                aria-label={text("后方裁切位置", "Rear cutoff")}
                onChange={(event) => updateZClipping("back", Number(event.target.value))}
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
            <p>{text("前方原子始终完整显示；只有后景从裁切位置向前平滑渐显。旋转后按新视角更新。", "Front atoms always remain fully opaque. Only the rear depth fades in smoothly from the cutoff, updating with the view.")}</p>
          </div>}
        </section>

        <section className="side-section source-section" data-left-section="inspect">
          <div className="section-heading"><span>{text("数据完整性", "Data integrity")}</span><small>PARSE STATUS</small></div>
          <div className="status-line good"><i>✓</i><span>{text("晶胞参数", "Unit-cell parameters")}</span><strong>{text("完整", "Complete")}</strong></div>
          <div className="status-line good"><i>✓</i><span>{text("分数坐标", "Fractional coordinates")}</span><strong>{english ? `${structure.sites.length} sites` : `${structure.sites.length} 位点`}</strong></div>
          <button
            type="button"
            className={structure.disorder.explicit
              ? "status-line disorder-status explicit"
              : structure.disorder.splitSiteCandidates.length || structure.disorder.partialOccupancySiteLabels.length
                ? "status-line disorder-status warn"
                : "status-line disorder-status good"}
            onClick={() => setRightTab("disorder")}
          >
            <i>{structure.disorder.explicit ? "D" : structure.disorder.splitSiteCandidates.length ? "?" : "✓"}</i>
            <span>{text("无序 / 占有率", "Disorder / occupancy")}</span>
            <strong>{structure.disorder.explicit
              ? (english ? `${structure.disorder.assemblies.length} assemblies` : `${structure.disorder.assemblies.length} 个组装`)
              : structure.disorder.splitSiteCandidates.length
                ? (english ? `${structure.disorder.splitSiteCandidates.length} candidates` : `${structure.disorder.splitSiteCandidates.length} 个候选`)
                : text("未标注", "Not marked")}</strong>
          </button>
          <div className={structure.warnings.length ? "status-line warn" : "status-line good"}><i>{structure.warnings.length ? "!" : "✓"}</i><span>{text("对称操作", "Symmetry operations")}</span><strong>{english ? `${structure.operations.length} entries` : `${structure.operations.length} 项`}</strong></div>
        </section>
      </aside>

      <section className="workspace">
        <div className="workspace-toolbar">
          <div className="mode-tabs"><button type="button" className="active">{text("三维晶体视图", "3D crystal view")}</button><button type="button" onClick={() => setRightTab("operations")}>{text("对称检查器", "Symmetry inspector")}</button><button type="button" onClick={openSymmetryDemo}>{text("空间群演示", "Space-group demos")}</button></div>
          <div className="workspace-stats"><span><i />{displayedAtomCount} {text("显示原子", "displayed atoms")}</span><span>{structure.bonds.length} {text("键", "bonds")} · {hydrogenBonds.length} {text("氢键类型", "H-bond types")}</span>{structure.disorder.explicit && <span>{text("无序组装", "disorder assemblies")} {structure.disorder.assemblies.length}</span>}<span>{supercellText(supercell)} · {display.completeMolecules ? text("完整分子", "complete molecules") : text("晶胞截断", "cell-clipped")}</span></div>
        </div>
        <CrystalCanvas
          structure={structure}
          hydrogenBonds={hydrogenBonds}
          hydrogenBondAppearance={hydrogenBondAppearance}
          supercell={supercell}
          zClipping={zClipping}
          disorderSelections={disorderSelections}
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
          <nav className="output-tabbar" aria-label={text("结果面板", "Results panel")}>
            <span className="active">{text("映射摘要", "Mapping summary")}</span>
            <button type="button" onClick={() => setRightTab("operations")}>{text("操作", "Operations")}</button>
            <button type="button" onClick={() => setRightTab("atoms")}>{text("原子轨迹", "Atom provenance")}</button>
            <button type="button" onClick={() => setRightTab("wyckoff")}>Wyckoff</button>
          </nav>
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
        <div
          className="right-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={text("调整右侧面板宽度", "Resize the right panel")}
          aria-valuemin={320}
          aria-valuemax={900}
          aria-valuenow={Math.round(rightPanelWidth)}
          tabIndex={0}
          title={text("拖动以调整右侧面板宽度；双击恢复默认宽度", "Drag to resize the right panel; double-click to reset")}
          onPointerDown={beginRightPanelResize}
          onPointerMove={(event) => { if (rightPanelResizing) resizeRightPanel(event.clientX); }}
          onPointerUp={finishRightPanelResize}
          onPointerCancel={finishRightPanelResize}
          onDoubleClick={() => { setRightPanelWidth(356); window.localStorage.setItem("symviz-right-panel-width", "356"); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") { event.preventDefault(); resizeRightPanelByKeyboard(24); }
            if (event.key === "ArrowRight") { event.preventDefault(); resizeRightPanelByKeyboard(-24); }
            if (event.key === "Home") { event.preventDefault(); setRightPanelWidth(320); window.localStorage.setItem("symviz-right-panel-width", "320"); }
            if (event.key === "End") { event.preventDefault(); resizeRightPanelByKeyboard(544); }
          }}
        />
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
          <button type="button" className={rightTab === "atoms" ? "active" : ""} onClick={() => setRightTab("atoms")}>{text("原子轨迹", "Atom provenance")}</button>
          <button type="button" className={rightTab === "wyckoff" ? "active" : ""} onClick={() => setRightTab("wyckoff")}>Wyckoff</button>
          <button type="button" className={rightTab === "disorder" ? "active" : ""} onClick={() => setRightTab("disorder")}>{text("无序", "Disorder")}</button>
          <button type="button" className={rightTab === "hydrogen" ? "active" : ""} onClick={() => setRightTab("hydrogen")}>{text("氢键", "H bonds")}</button>
          <button
            type="button"
            className={["calculator", "geometry", "cellTools", "electrostatics", "diffraction", "density"].includes(rightTab) ? "active" : ""}
            onClick={() => setRightTab("calculator")}
          >{rightTab === "geometry" ? text("几何参数", "Geometry")
            : rightTab === "cellTools" ? text("晶胞工具", "Cell tools")
              : rightTab === "electrostatics" ? text("静电势", "Electrostatics")
                : rightTab === "diffraction" ? text("衍射", "Diffraction")
                  : rightTab === "density" ? text("密度图", "Density maps")
                    : text("坐标计算器", "Coordinate calculator")}</button>
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

        {rightTab === "disorder" && <div className="right-content panel-scroll disorder-panel">
          <div className={structure.disorder.explicit ? "disorder-intro explicit" : "disorder-intro"}>
            <div>
              <span>{structure.disorder.explicit
                ? text("CIF 已标注无序", "Explicit disorder in CIF")
                : text("CIF 未标注标准无序", "No standard disorder fields")}</span>
              <small>{structure.disorder.explicit
                ? (english
                  ? `${structure.disorder.assemblies.length} assemblies · ${structure.disorder.partialOccupancySiteLabels.length} partial-occupancy sites`
                  : `${structure.disorder.assemblies.length} 个组装 · ${structure.disorder.partialOccupancySiteLabels.length} 个部分占位`)
                : (english
                  ? `${structure.disorder.splitSiteCandidates.length} geometry-based split-site candidates`
                  : `${structure.disorder.splitSiteCandidates.length} 个几何 split-site 候选`)}</small>
            </div>
            <b>{structure.disorder.explicit ? "CIF" : text("筛查", "Screen")}</b>
          </div>

          <details className="disorder-help">
            <summary>？ {text("如何判读", "How to interpret")}</summary>
            <div>
              <p>{text("assembly 表示彼此关联的一套无序；group 表示互斥构象。标准字段属于 CIF 明示信息。", "An assembly is a correlated disorder model; its groups are mutually exclusive conformers. Standard fields are explicit CIF evidence.")}</p>
              <p>{text("split-site 候选仅由距离、标签和占有率筛查得到，必须结合差值电子密度、ADP 与精修模型确认。", "Split-site candidates are screened from distance, labels, and occupancy only; confirm them against difference density, ADPs, and the refinement model.")}</p>
            </div>
          </details>

          <section className="disorder-section">
            <div className="disorder-section-head">
              <span>{text("三维构象切换", "3D conformer switching")}</span>
              <small>{text("叠加 / 单独显示", "Overlay / isolate")}</small>
            </div>
            {structure.disorder.assemblies.length ? structure.disorder.assemblies.map((assembly) => {
              const selectedGroup = disorderSelections[assembly.id] ?? "all";
              const assemblyName = assembly.id === "__unassigned__" ? text("未指定组装", "Unassigned assembly") : `${text("组装", "Assembly")} ${assembly.id}`;
              return <article className="disorder-assembly" key={assembly.id}>
                <div className="disorder-assembly-head">
                  <span><strong>{assemblyName}</strong><small>{english ? `${assembly.groups.length} conformers` : `${assembly.groups.length} 个构象`}</small></span>
                  <em className={assembly.occupancyConsistent ? "consistent" : "inconsistent"}>
                    {assembly.occupancyConsistent
                      ? text("Σocc 一致", "Σocc consistent")
                      : `Σocc ${assembly.occupancySum.toFixed(2)}`}
                  </em>
                </div>
                <div className="conformer-switch" role="group" aria-label={`${assemblyName} ${text("构象显示", "conformer display")}`}>
                  <button type="button" className={selectedGroup === "all" ? "active" : ""} onClick={() => selectDisorderConformer(assembly.id, "all")}>{text("叠加", "Overlay")}</button>
                  {assembly.groups.map((group) => <button
                    type="button"
                    key={group.id}
                    className={selectedGroup === group.id ? "active" : ""}
                    style={{ "--disorder-color": disorderColor(assembly.id, group.id) } as React.CSSProperties}
                    onClick={() => selectDisorderConformer(assembly.id, group.id)}
                  ><i />{text("构象", "Conf.")} {group.id}</button>)}
                </div>
                <div className="disorder-group-list">
                  {assembly.groups.map((group) => <button type="button" key={group.id} onClick={() => {
                    const index = structure.atoms.findIndex((atom) => atom.source.label === group.siteLabels[0]);
                    if (index >= 0) selectAtom(index);
                  }}>
                    <i style={{ "--disorder-color": disorderColor(assembly.id, group.id) } as React.CSSProperties} />
                    <span><strong>{text("构象", "Conformer")} {group.id}</strong><small>{group.siteLabels.slice(0, 7).join(", ")}{group.siteLabels.length > 7 ? "…" : ""}</small></span>
                    <em>occ ≈ {group.representativeOccupancy.toFixed(3)}</em>
                  </button>)}
                </div>
              </article>;
            }) : <div className="disorder-empty">
              <strong>{text("没有可切换的明示构象", "No explicit conformers to switch")}</strong>
              <p>{text("只有 CIF 提供 disorder assembly/group 后，软件才会把构象切换作为确定功能启用。", "Conformer switching is enabled as a definitive action only when CIF disorder assembly/group fields are present.")}</p>
            </div>}
          </section>

          <section className="disorder-section">
            <div className="disorder-section-head">
              <div className="occupancy-title">
                <span>{text("占有率一致性", "Occupancy consistency")}</span>
                <details className="occupancy-help">
                  <summary aria-label={text("解释占有率一致性", "Explain occupancy consistency")}>?</summary>
                  <div>
                    <strong>{text("检查什么？", "What is checked?")}</strong>
                    <p>{text("同一 disorder assembly 中，各个互斥构象的代表占有率之和应接近 1；同一 group 内的原子通常也应采用一致的占有率。", "Within one disorder assembly, representative occupancies of mutually exclusive conformers should sum to about 1; atoms in the same group should usually have consistent occupancies.")}</p>
                    <p>{text("“通过”表示 Σocc 在 1±0.08 内且未发现组内明显差异；警告表示需要回查 CIF 和精修模型。部分占位本身不等于已经确认无序。", "Pass means Σocc is within 1±0.08 with no marked within-group variation. A warning means the CIF and refinement model should be reviewed. Partial occupancy alone does not prove disorder.")}</p>
                  </div>
                </details>
              </div>
              <small>{structure.disorder.occupancyIssues.length
                ? (english ? `${structure.disorder.occupancyIssues.length} findings` : `${structure.disorder.occupancyIssues.length} 项`)
                : text("通过", "Pass")}</small>
            </div>
            {structure.disorder.occupancyIssues.length ? <div className="occupancy-issue-list">
              {structure.disorder.occupancyIssues.slice(0, 120).map((issue, index) => <button type="button" className={issue.severity} key={`${issue.kind}-${issue.siteLabels.join("-")}-${index}`} onClick={() => {
                const atomIndex = structure.atoms.findIndex((atom) => atom.source.label === issue.siteLabels[0]);
                if (atomIndex >= 0) selectAtom(atomIndex);
              }}>
                <i>{issue.severity === "error" ? "!" : issue.severity === "warning" ? "△" : "i"}</i>
                <span><strong>{occupancyIssueText(issue, language)}</strong><small>{issue.siteLabels.slice(0, 8).join(", ")}{issue.siteLabels.length > 8 ? "…" : ""}</small></span>
              </button>)}
            </div> : <div className="disorder-pass"><i>✓</i><span><strong>{text("未发现占有率冲突", "No occupancy conflict detected")}</strong><small>{text("显式组装按各组代表占有率求和。", "Explicit assemblies are checked using representative group occupancies.")}</small></span></div>}
          </section>

          <section className="disorder-section">
            <div className="disorder-section-head">
              <span>Split-site {text("候选", "candidates")}</span>
              <small>{text("软件推测", "Inferred")}</small>
            </div>
            {structure.disorder.splitSiteCandidates.length ? <div className="split-candidate-list">
              {structure.disorder.splitSiteCandidates.slice(0, 80).map((candidate) => <button type="button" key={candidate.id} onClick={() => {
                const atomIndex = structure.atoms.findIndex((atom) => atom.source.label === candidate.labels[0]);
                if (atomIndex >= 0) selectAtom(atomIndex);
              }}>
                <span className={`candidate-confidence ${candidate.confidence}`}>{candidate.confidence === "strong" ? text("较强", "Strong") : text("中等", "Moderate")}</span>
                <span><strong>{candidate.labels[0]} ↔ {candidate.labels[1]}</strong><small>{candidate.reasons.map((reason) => splitCandidateReasonText(reason, language)).join(" · ")}</small></span>
                <em>{candidate.distance.toFixed(2)} Å<br />Σocc {candidate.occupancySum.toFixed(2)}</em>
              </button>)}
            </div> : <div className="disorder-empty compact">
              <strong>{text("未发现未标注的成对 split-site", "No unmarked paired split sites found")}</strong>
              <p>{text("单个位点的部分占位仍会列入上方占有率检查，但不会被自动配对。", "A lone partially occupied site remains in the occupancy check above but is not paired automatically.")}</p>
            </div>}
          </section>
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
              <span>{text("H···A（Å）", "H···A (Å)")}</span><em>1.2–1.5</em><em>1.5–2.2</em><em>&gt; 2.2</em>
              <span>{text("D···A（Å）", "D···A (Å)")}</span><em>2.2–2.5</em><em>2.5–3.2</em><em>&gt; 3.2</em>
              <span>∠D–H···A</span><em>170–180°</em><em>&gt; 130°</em><em>&gt; 90°</em>
            </div>
            <p className="hydrogen-caution">{text("几何命中只表示“候选”。IUPAC 2011 要求至少有实验或理论证据；电子密度、光谱、能量和化学环境可能改变结论。", "A geometry match indicates only a candidate. IUPAC 2011 requires experimental or theoretical evidence; electron density, spectroscopy, energy, and chemical environment may change the conclusion.")}</p>
            <div className="hydrogen-links">
              <a href="https://doi.org/10.1002/1521-3773(20020104)41:1%3C48::AID-ANIE48%3E3.0.CO;2-U" target="_blank" rel="noreferrer">Steiner 2002 ↗</a>
              <a href="https://publications.iupac.org/pac/83/8/1637/index.html" target="_blank" rel="noreferrer">IUPAC 2011 ↗</a>
            </div>
          </details>
        </div>}

        {rightTab === "geometry" && <div className="right-content panel-scroll utility-panel geometry-panel">
          <div className="utility-intro">
            <span>{text("几何参数", "Geometrical parameters")}</span>
            <p>{text("距离使用周期性最小镜像；角度以第 2 个原子为顶点；二面角按 1–2–3–4 顺序计算。", "Distances use the periodic minimum image; atom 2 is the angle vertex; the dihedral follows atoms 1–2–3–4.")}</p>
          </div>
          <div className="geometry-pickers">
            {validGeometryIndices.map((atomIndex, position) => <label key={position}>
              <span>{text(`原子 ${position + 1}`, `Atom ${position + 1}`)}</span>
              <select value={atomIndex} onChange={(event) => setGeometryIndices((current) => current.map((value, index) => index === position ? Number(event.target.value) : value) as [number, number, number, number])}>
                {structure.atoms.slice(0, 500).map((atom, index) => <option key={atom.id} value={index}>{atom.label} · {atom.source.label} · {coordinateText(atom.fract)}</option>)}
              </select>
            </label>)}
          </div>
          <div className="geometry-results">
            <article><span>{text("键长 / 距离", "Bond length / distance")}</span><strong>{geometryResult.distance?.toFixed(4) ?? "—"} <small>Å</small></strong><code>{structure.atoms[validGeometryIndices[0]]?.label} ··· {structure.atoms[validGeometryIndices[1]]?.label}</code></article>
            <article><span>{text("键角", "Angle")}</span><strong>{geometryResult.angle?.toFixed(3) ?? "—"} <small>°</small></strong><code>{validGeometryIndices.slice(0, 3).map((index) => structure.atoms[index]?.label).join("–")}</code></article>
            <article><span>{text("二面角", "Dihedral")}</span><strong>{geometryResult.dihedral?.toFixed(3) ?? "—"} <small>°</small></strong><code>{validGeometryIndices.map((index) => structure.atoms[index]?.label).join("–")}</code></article>
          </div>
          <section className="utility-section">
            <div className="utility-section-head"><span>{text("从已识别化学键选择", "Choose from detected bonds")}</span><small>{Math.min(structure.bonds.length, 80)} / {structure.bonds.length}</small></div>
            <div className="geometry-bond-list">
              {structure.bonds.slice(0, 80).map((bond, index) => <button type="button" key={`${bond.a}-${bond.b}-${index}`} onClick={() => setGeometryIndices((current) => [bond.a, bond.b, current[2], current[3]])}>
                <span>{structure.atoms[bond.a].label}–{structure.atoms[bond.b].label}</span><b>{bond.distance.toFixed(3)} Å</b>
              </button>)}
            </div>
          </section>
        </div>}

        {rightTab === "cellTools" && <div className="right-content panel-scroll utility-panel cell-tools-panel">
          <div className="utility-intro">
            <span>{text("晶体数据标准化与约化晶胞", "Crystal-data standardization and reduced cell")}</span>
            <p>{text("先检查当前晶胞、空间群设置和候选基矢；不会静默改写原子坐标或空间群。", "Inspect the current cell, space-group setting, and candidate basis first; atomic coordinates and space group are never silently rewritten.")}</p>
          </div>
          <section className="utility-section">
            <div className="utility-section-head"><span>{text("标准设置检查", "Standard-setting check")}</span><small>{structure.spaceGroupNumber ? `#${structure.spaceGroupNumber}` : text("编号缺失", "number missing")}</small></div>
            <div className="standardization-status">
              <i className={structure.spaceGroupNumber ? "pass" : "warning"}>{structure.spaceGroupNumber ? "✓" : "!"}</i>
              <span><strong>{structure.spaceGroup}</strong><small>{structure.spaceGroupNumber
                ? text("具有 International Tables 空间群编号；当前设置保留原 CIF 的轴与原点选择。", "An International Tables number is available; the original CIF axis and origin setting is retained.")
                : text("CIF 未提供空间群编号，无法自动认证 conventional setting。", "The CIF does not provide a space-group number, so a conventional setting cannot be certified automatically.")}</small></span>
            </div>
          </section>
          <section className="utility-section">
            <div className="utility-section-head"><span>Niggli {text("约化候选", "reduction candidate")}</span><small>{reducedCandidate.changed ? text("基矢已重排", "basis reordered") : text("无需重排", "unchanged")}</small></div>
            <div className="cell-comparison">
              <div><span>{text("当前晶胞", "Current cell")}</span>
                {(["a", "b", "c", "alpha", "beta", "gamma"] as const).map((key) => <code key={key}>{key.replace("alpha", "α").replace("beta", "β").replace("gamma", "γ")} <b>{structure.cell[key].toFixed(key.length === 1 ? 4 : 3)}{key.length === 1 ? " Å" : "°"}</b></code>)}
              </div>
              <b>→</b>
              <div><span>{text("候选约化晶胞", "Candidate reduced cell")}</span>
                {(["a", "b", "c", "alpha", "beta", "gamma"] as const).map((key) => <code key={key}>{key.replace("alpha", "α").replace("beta", "β").replace("gamma", "γ")} <b>{reducedCandidate.cell[key].toFixed(key.length === 1 ? 4 : 3)}{key.length === 1 ? " Å" : "°"}</b></code>)}
              </div>
            </div>
            <div className="basis-transform">
              <span>{text("整数基变换（候选）", "Integer basis transform (candidate)")}</span>
              <code>{reducedCandidate.transform.map((row) => `[${row.join("  ")}]`).join("  ")}</code>
            </div>
            <details className="utility-help">
              <summary>？ {text("为何标记为“候选”", "Why is this labelled a candidate?")}</summary>
              <p>{text("此处在有限的幺模整数变换中搜索满足主要度量条件的短基矢，适合交互预检；边界晶胞可能对舍入非常敏感。导出、数据库匹配或发表前应使用 spglib、cctbx、Gemmi 等经验证实现复核。", "This interactive precheck searches a finite set of unimodular transforms for a short basis satisfying the principal metric conditions. Boundary cells can be highly rounding-sensitive. Verify with a validated implementation such as spglib, cctbx, or Gemmi before export, database matching, or publication.")}</p>
            </details>
          </section>
        </div>}

        {rightTab === "electrostatics" && <div className="right-content panel-scroll utility-panel electrostatics-panel">
          <div className="utility-intro">
            <span>{text("位点电势与 Madelung 能", "Site potentials and Madelung energy")}</span>
            <p>{text("使用三维周期 Ewald 求和。必须由用户提供形式电荷，并且展开晶胞保持电中性。", "Uses a three-dimensional periodic Ewald sum. User-supplied formal charges are required and the expanded unit cell must be neutral.")}</p>
          </div>
          <section className="utility-section charge-editor">
            <div className="utility-section-head"><span>{text("元素形式电荷", "Formal charges by element")}</span><small>e</small></div>
            {composition.map(([element, count]) => <label key={element}>
              <span><i style={{ background: currentElementColor(element) }} />{element}<small>× {count}</small></span>
              <input type="number" step="0.25" value={elementCharges[element] ?? 0} onChange={(event) => setElementCharges((current) => ({ ...current, [element]: Number(event.target.value) || 0 }))} />
            </label>)}
            <div className={electrostatics.neutral ? "charge-balance neutral" : "charge-balance charged"}>
              <span>{text("晶胞净电荷", "Net cell charge")}</span><strong>{electrostatics.netCharge >= 0 ? "+" : ""}{electrostatics.netCharge.toFixed(4)} e</strong>
            </div>
          </section>
          {!electrostatics.neutral ? <div className="utility-warning"><strong>{text("无法计算：晶胞不电中性", "Cannot calculate: the cell is not neutral")}</strong><p>{text("请检查价态、部分占有率和无序构象。带电周期体系需要额外的背景电荷约定，本面板不会自动添加。", "Check oxidation states, partial occupancies, and disorder conformers. Charged periodic systems require a background-charge convention, which this panel does not add automatically.")}</p></div>
            : electrostatics.energyEv === null ? <div className="utility-empty"><strong>{text("请输入非零形式电荷", "Enter non-zero formal charges")}</strong><p>{text("SymViz 不会仅根据元素名称猜测氧化态。", "SymViz does not guess oxidation states from element names alone.")}</p></div>
              : <>
                <div className="electrostatic-summary">
                  <span>{text("Madelung 静电能（每晶胞）", "Madelung electrostatic energy (per cell)")}<strong>{electrostatics.energyEv.toFixed(5)} eV</strong></span>
                  <span>Ewald α<strong>{electrostatics.alpha.toFixed(5)} Å⁻¹</strong></span>
                </div>
                <section className="utility-section">
                  <div className="utility-section-head"><span>{text("位点电势", "Site potentials")}</span><small>{text("（eV·e⁻¹）", "(eV·e⁻¹)")}</small></div>
                  <div className="site-potential-list">{structure.atoms.slice(0, 160).map((atom, index) => <button type="button" key={atom.id} onClick={() => selectAtom(index)}>
                    <span>{atom.label}<small>{atom.source.label}</small></span><b>{electrostatics.potentialsEv[index]?.toFixed(5)}</b>
                  </button>)}</div>
                </section>
              </>}
          <details className="utility-help">
            <summary>？ {text("计算约定", "Calculation convention")}</summary>
            <p>{text("能量仅含点电荷库仑项，不含极化、短程排斥、共价成键或介电屏蔽。无序位点按 CIF 占有率加权。结果适合检查模型与比较相同约定下的结构，不等同于总晶格能。", "The energy contains point-charge Coulomb terms only; polarization, short-range repulsion, covalency, and dielectric screening are omitted. Disordered sites are occupancy-weighted. Use it to audit models or compare structures under identical conventions, not as a total lattice energy.")}</p>
          </details>
        </div>}

        {rightTab === "diffraction" && <div className="right-content panel-scroll utility-panel diffraction-panel">
          <div className="utility-intro">
            <span>{text("粉末衍射与结构因子", "Powder diffraction and structure factors")}</span>
            <p>{text("由当前原子模型计算；默认 Cu Kα₁。可用于峰位与系统消光的快速检查。", "Calculated from the current atomic model with Cu Kα₁ by default. Intended for rapid checks of peak positions and systematic absences.")}</p>
          </div>
          <div className="diffraction-controls">
            <label><span>{text("波长（Å）", "Wavelength (Å)")}</span><input type="number" min="0.2" max="4" step="0.0001" value={wavelength} onChange={(event) => setWavelength(Math.max(0.2, Number(event.target.value) || 1.5406))} /></label>
                <label><span>{text("2θ min（°）", "2θ min (°)")}</span><input type="number" min="0" max={diffractionRange[1] - 1} step="1" value={diffractionRange[0]} onChange={(event) => setDiffractionRange(([, maximum]) => [Math.min(Number(event.target.value) || 0, maximum - 1), maximum])} /></label>
            <label><span>{text("2θ max（°）", "2θ max (°)")}</span><input type="number" min={diffractionRange[0] + 1} max="170" step="1" value={diffractionRange[1]} onChange={(event) => setDiffractionRange(([minimum, maximum]) => [minimum, Math.max(Number(event.target.value) || maximum, minimum + 1)])} /></label>
            <label><span>{text("FWHM（°）", "FWHM (°)")}</span><input type="number" min="0.02" max="2" step="0.02" value={peakWidth} onChange={(event) => setPeakWidth(Math.max(0.02, Number(event.target.value) || 0.18))} /></label>
          </div>
          <PowderPatternCanvas points={powderPattern} language={language} />
          <div className="diffraction-meta"><span>{reflections.length} {text("个 hkl 贡献", "hkl contributions")}</span><span>{text("最高峰归一化至 100", "Maximum normalized to 100")}</span></div>
          <details className="utility-help diffraction-assumption">
            <summary>？ {text("强度近似与限制", "Intensity approximation and limits")}</summary>
            <p>{text("当前 F(hkl) 使用原子序数 Z 作为点散射权重，并计入占有率；尚未使用随 sinθ/λ 变化的 X 射线原子散射因子、Debye–Waller 因子、反常散射、精确多重性、择优取向或仪器函数。因此峰位可靠性高于相对强度。", "The current F(hkl) uses atomic number Z as a point-scatterer weight and includes occupancy. It does not yet include angle-dependent X-ray form factors, Debye–Waller factors, anomalous scattering, exact multiplicity, preferred orientation, or an instrument function. Peak positions are therefore more reliable than relative intensities.")}</p>
          </details>
          <section className="utility-section">
            <div className="utility-section-head"><span>{text("最强结构因子", "Strongest structure factors")}</span><small>{text("按计算强度排序", "sorted by calculated intensity")}</small></div>
            <div className="reflection-table-wrap"><table className="reflection-table">
              <thead><tr><th>h</th><th>k</th><th>l</th><th>{text("d（Å）", "d (Å)")}</th><th>{text("2θ（°）", "2θ (°)")}</th><th>Re F</th><th>Im F</th><th>|F|²</th></tr></thead>
              <tbody>{strongestReflections.map((reflection) => <tr key={`${reflection.h},${reflection.k},${reflection.l}`}>
                <td>{reflection.h}</td><td>{reflection.k}</td><td>{reflection.l}</td><td>{reflection.d.toFixed(4)}</td><td>{reflection.twoTheta.toFixed(3)}</td><td>{reflection.real.toFixed(2)}</td><td>{reflection.imaginary.toFixed(2)}</td><td>{(reflection.real ** 2 + reflection.imaginary ** 2).toFixed(1)}</td>
              </tr>)}</tbody>
            </table></div>
          </section>
        </div>}

        {rightTab === "density" && <div className="right-content panel-scroll utility-panel density-panel">
          <div className="utility-intro">
            <span>{text("密度图、Patterson 与剖面", "Density maps, Patterson, and profiles")}</span>
            <p>{text("从当前结构模型生成 (001) 二维周期切片；白色虚线是下方线剖面的取样位置。", "Generates a periodic (001) two-dimensional slice from the current structural model; the white dashed line is sampled in the profile below.")}</p>
          </div>
          <div className="density-mode-switch" role="group" aria-label={text("密度类型", "Density type")}>
            <button type="button" className={densityMode === "electron" ? "active" : ""} onClick={() => setDensityMode("electron")}>{text("电子密度", "Electron")}</button>
            <button type="button" className={densityMode === "nuclear" ? "active" : ""} onClick={() => setDensityMode("nuclear")}>{text("核位置", "Nuclear")}</button>
            <button type="button" className={densityMode === "patterson" ? "active" : ""} onClick={() => setDensityMode("patterson")}>Patterson</button>
          </div>
          <label className="density-slice-control">
            <span>{densityMode === "patterson" ? "w" : "z"} {text("分数坐标切片", "fractional-coordinate slice")}<output>{densitySlice.toFixed(2)}</output></span>
            <input type="range" min="0" max="1" step="0.01" value={densitySlice} onChange={(event) => setDensitySlice(Number(event.target.value))} />
          </label>
          <DensityMapCanvas density={density} mode={densityMode} language={language} />
          <div className="density-meta">
            <span>{text("网格", "Grid")} {density.size} × {density.size}</span>
            <span>{text("归一化显示", "Normalized display")} 0–1</span>
          </div>
          <details className="utility-help" open>
            <summary>？ {text("这些图表示什么", "What do these maps represent?")}</summary>
            <p>{densityMode === "electron"
              ? text("电子密度是以 Z 加权的原子高斯模型，不是由实测 Fobs 和相位进行的实验傅里叶合成。", "Electron density is a Z-weighted Gaussian atom model, not an experimental Fourier synthesis from measured Fobs values and phases.")
              : densityMode === "nuclear"
                ? text("核位置图对每个原子核使用单位权重；未输入同位素相干散射长度，因此不是定量中子散射长度密度。", "The nuclear-position map uses unit weight per nucleus. Isotope-dependent coherent scattering lengths are not supplied, so this is not a quantitative neutron scattering-length density.")
                : text("Patterson 图由所有原子对的差矢量构成，峰权重近似为 ZiZj；原点峰和重原子对通常最强。", "The Patterson map is built from all interatomic difference vectors with approximate ZiZj weights; the origin peak and heavy-atom pairs are usually strongest.")}</p>
          </details>
          <div className="utility-warning experimental-data-note">
            <strong>{text("实验傅里叶合成的输入条件", "Input required for experimental Fourier synthesis")}</strong>
            <p>{text("需要 CIF/FCF 中的 hkl、Fobs 或 Iobs、σ 以及相位或可生成相位的结构模型。当前载入器尚未把反射环保存为数据集，因此本页明确显示模型图；不会把它标成实验电子密度。", "An experimental synthesis needs hkl indices, Fobs or Iobs, uncertainties, and phases or a model capable of generating phases. The current loader does not yet preserve reflection loops as a dataset, so this page explicitly shows model maps and never labels them experimental electron density.")}</p>
          </div>
        </div>}

        {rightTab === "gaussian" && <div className="right-content panel-scroll utility-panel gaussian-panel">
          <div className="utility-intro quantum-intro">
            <span>{quantumSubview === "qe"
              ? text("Quantum ESPRESSO 周期输入生成", "Quantum ESPRESSO periodic input generation")
              : quantumSubview === "multiwfn"
                ? text("Multiwfn 波函数分析工作台", "Multiwfn wavefunction analysis workbench")
                : text("Gaussian 分子计算与 Cube 三维数据", "Gaussian molecular calculations and 3D Cube data")}</span>
            <p>{quantumSubview === "qe"
              ? text("分析完整周期晶胞并生成可移交到工作站或超算的 pw.x 输入；SymViz 不再在本机启动 QE。", "Analyze the complete periodic cell and generate portable pw.x inputs for a workstation or cluster; SymViz no longer launches QE locally.")
              : quantumSubview === "multiwfn"
                ? text("桌面版直接调用当前文件夹中的 Multiwfn；输入、实时输出和生成文件只保存在本机任务目录。", "The desktop app calls Multiwfn from the current project folder; inputs, live output, and generated files remain in the local job folder.")
                : text("结构准备、任务队列、输出解析和等值面显示均在本机完成；网页不会把计算文件上传至云端。", "Structure preparation, job queuing, output parsing, and isosurface display stay on this computer; the web app does not upload calculation files to the cloud.")}</p>
          </div>
          <nav className="quantum-switch" aria-label={text("量化计算工作区", "Quantum workspace")}>
            {([
              ["qe", text("周期 DFT", "Periodic DFT")],
              ["input", text("Gaussian 输入", "Gaussian input")],
              ["queue", text("Gaussian 队列", "Gaussian queue")],
              ["results", text("Gaussian 结果", "Gaussian results")],
              ["multiwfn", "Multiwfn"],
              ["cube", "Cube"],
            ] as Array<[QuantumSubview, string]>).map(([value, label]) => <button
              type="button"
              key={value}
              className={quantumSubview === value ? "active" : ""}
              onClick={() => setQuantumSubview(value)}
            >{label}</button>)}
          </nav>

          {quantumSubview === "qe" && <>
            <section className="utility-section qe-export-only-card">
              <div className="utility-section-head"><span>{text("QE 输入文件生成器", "QE input-file generator")}</span><small>{text("仅导出 · 不在本机运行", "Export only · no local execution")}</small></div>
              <p>{text("SymViz 只分析 CIF 并生成 pw.x 输入，不会启动 WSL 或 QE。输入文件可复制到工作站、服务器或超算运行。", "SymViz analyzes the CIF and generates pw.x inputs only; it does not launch WSL or QE. Move the files to a workstation, server, or cluster to run them.")}</p>
              <div className="gaussian-actions"><button type="button" onClick={() => void chooseQuantumEspressoPseudoRoot()} disabled={!desktopMode}>{text("可选：匹配本地 UPF 文件名…", "Optional: match local UPF filenames…")}</button></div>
            </section>

            <section className="utility-section qe-auto-recommendation">
              <div className="utility-section-head"><span>{text("针对当前 CIF 的自动建议", "Automatic recommendation for this CIF")}</span><small>{qeRecommendation.confidence === "high" ? text("较高置信度", "Higher confidence") : text("需人工复核", "Review required")}</small></div>
              <div className="qe-recommendation-summary">
                <span><small>{text("体系判断", "System class")}</small><strong>{qeRecommendation.systemClass === "molecular-crystal" ? text("分子晶体", "Molecular crystal") : qeRecommendation.systemClass === "metallic-candidate" ? text("金属候选", "Metallic candidate") : qeRecommendation.systemClass === "mixed-solid" ? text("混合 / 配位固体", "Mixed / coordination solid") : text("无机周期固体", "Inorganic periodic solid")}</strong></span>
                <span><small>{text("建议方法", "Method")}</small><strong>{qeRecommendation.inputDft}{qeRecommendation.dispersion === "d3-bj" ? " + D3(BJ)" : ""}</strong></span>
                <span><small>{text("平面波截断能", "Plane-wave cutoffs")}</small><strong>{qeRecommendation.ecutwfcRy} / {qeRecommendation.ecutrhoRy} Ry</strong></span>
                <span><small>k-point mesh</small><strong>{qeMeshKey(qeRecommendation.kPoints)}</strong></span>
                <span><small>{text("占据", "Occupations")}</small><strong>{qeRecommendation.occupations}</strong></span>
              </div>
              <ul className="qe-rationale-list">{(english ? qeRecommendation.reasonsEn : qeRecommendation.reasonsZh).map((reason) => <li key={reason}>{reason}</li>)}</ul>
              <div className="gaussian-actions"><button type="button" className="primary" onClick={applyQuantumEspressoRecommendation}>{text("一键采用建议", "Apply recommendation")}</button></div>
              {(english ? qeRecommendation.warningsEn : qeRecommendation.warningsZh).map((warning) => <div className="utility-warning" key={warning}><p>{warning}</p></div>)}
            </section>

            <section className="utility-section">
              <div className="utility-section-head"><span>{text("周期输入设置", "Periodic input settings")}</span><small>{qePreparedInput.diagnostics.atomCount} {text("原子", "atoms")} · {qePreparedInput.diagnostics.elementCount} {text("元素", "elements")}</small></div>
              <div className="gaussian-form-grid qe-form-grid">
                <label className="span-two"><span>{text("任务标题", "Job title")}</span><input value={qeOptions.title} onChange={(event) => setQeOptions((current) => ({ ...current, title: event.target.value }))} /></label>
                <label><span>{text("计算类型", "Calculation")}</span><select value={qeOptions.calculation} onChange={(event) => setQeOptions((current) => ({ ...current, calculation: event.target.value as QuantumEspressoInputOptions["calculation"] }))}>
                  <option value="scf">SCF — {text("自洽单点", "self-consistent single point")}</option>
                  <option value="relax">relax — {text("固定晶胞优化原子", "relax ions at fixed cell")}</option>
                  <option value="vc-relax">vc-relax — {text("优化晶胞与原子", "relax cell and ions")}</option>
                  <option value="md">MD — {text("固定晶胞动力学", "fixed-cell dynamics")}</option>
                  <option value="vc-md">vc-MD — {text("可变晶胞动力学", "variable-cell dynamics")}</option>
                </select></label>
                <label><span>{text("交换-相关理论方法", "Exchange-correlation method")}</span><select value={qeOptions.inputDft} onChange={(event) => setQeOptions((current) => ({ ...current, inputDft: event.target.value as QuantumEspressoInputOptions["inputDft"] }))}>
                  {(["UPF", "LDA", "GGA", "meta-GGA", "hybrid"] as const).map((family) => <optgroup key={family} label={family}>{quantumEspressoMethodCatalog.filter((method) => method.family === family).map((method) => <option value={method.id} key={method.id}>{method.label} — {english ? method.summaryEn : method.summaryZh}</option>)}</optgroup>)}
                </select></label>
                <label className="span-two qe-explained-select"><span>{text("当前方法说明", "Selected method")}</span><div><strong>{selectedQeMethodInfo.label} · {selectedQeMethodInfo.family}</strong><p>{english ? selectedQeMethodInfo.summaryEn : selectedQeMethodInfo.summaryZh}</p><small>{english ? selectedQeMethodInfo.cautionEn : selectedQeMethodInfo.cautionZh}</small></div></label>
                <label><span>{text("平面波基组 / 截断能方案", "Plane-wave basis / cutoff scheme")}</span><select value={qeBasisPreset} onChange={(event) => applyQuantumEspressoBasisPreset(event.target.value as QuantumEspressoBasisPreset)}>{quantumEspressoBasisCatalog.map((basis) => <option value={basis.id} key={basis.id}>{english ? basis.labelEn : basis.labelZh} — {english ? basis.summaryEn : basis.summaryZh}</option>)}</select></label>
                <label><span>{text("色散修正", "Dispersion correction")}</span><select value={qeOptions.dispersion} onChange={(event) => setQeOptions((current) => ({ ...current, dispersion: event.target.value as QuantumEspressoInputOptions["dispersion"] }))}><option value="d3-bj">Grimme D3(BJ) — {text("分子晶体 / 层状体系", "molecular / layered solids")}</option><option value="none">None — {text("无色散修正", "no dispersion correction")}</option></select></label>
                <label className="span-two qe-explained-select"><span>{text("当前平面波方案说明", "Selected plane-wave scheme")}</span><div><strong>{english ? selectedQeBasisInfo.labelEn : selectedQeBasisInfo.labelZh}</strong><p>{english ? selectedQeBasisInfo.summaryEn : selectedQeBasisInfo.summaryZh}</p><small>{text("QE 不使用 Gaussian 型局域基组；这里的“基组大小”由 UPF 赝势以及 ecutwfc / ecutrho 共同决定。", "QE does not use Gaussian-type localized basis sets; UPF pseudopotentials together with ecutwfc / ecutrho define the effective basis size.")}</small></div></label>
                <label><span>{text("占据方式", "Occupations")}</span><select value={qeOptions.occupations} onChange={(event) => setQeOptions((current) => ({ ...current, occupations: event.target.value as QuantumEspressoInputOptions["occupations"] }))}><option value="fixed">fixed — {text("绝缘体 / 半导体", "insulator / semiconductor")}</option><option value="smearing">smearing — {text("金属或小带隙候选", "metal / small-gap candidate")}</option></select></label>
                {qeOptions.occupations === "smearing" && <label><span>{text("展宽方法", "Smearing")}</span><select value={qeOptions.smearing} onChange={(event) => setQeOptions((current) => ({ ...current, smearing: event.target.value as QuantumEspressoInputOptions["smearing"] }))}><option value="mv">Marzari–Vanderbilt (cold)</option><option value="mp">Methfessel–Paxton</option><option value="gaussian">Gaussian</option><option value="fd">Fermi–Dirac</option></select></label>}
                {qeOptions.occupations === "smearing" && <label><span>degauss（Ry）</span><input type="number" min="0.0001" step="0.005" value={qeOptions.degaussRy} onChange={(event) => setQeOptions((current) => ({ ...current, degaussRy: Math.max(0.0001, Number(event.target.value) || 0.01) }))} /></label>}
                <label><span>ecutwfc（Ry）</span><input type="number" min="1" step="5" value={qeOptions.ecutwfcRy} onChange={(event) => { setQeBasisPreset("custom"); setQeOptions((current) => ({ ...current, ecutwfcRy: Number(event.target.value) || 1 })); }} /></label>
                <label><span>ecutrho（Ry）</span><input type="number" min="1" step="10" value={qeOptions.ecutrhoRy} onChange={(event) => { setQeBasisPreset("custom"); setQeOptions((current) => ({ ...current, ecutrhoRy: Number(event.target.value) || 1 })); }} /></label>
                <label className="span-two"><span>k-point mesh</span><div className="qe-triplet-input">{qeOptions.kPoints.map((value, axis) => <input key={axis} aria-label={`k${axis + 1}`} type="number" min="1" step="1" value={value} onChange={(event) => setQeOptions((current) => ({ ...current, kPoints: current.kPoints.map((item, index) => index === axis ? Math.max(1, Math.round(Number(event.target.value) || 1)) : item) as [number, number, number] }))} />)}</div></label>
                <label><span>SCF conv_thr</span><input type="number" min="1e-14" step="1e-9" value={qeOptions.convThr} onChange={(event) => setQeOptions((current) => ({ ...current, convThr: Number(event.target.value) || 1e-8 }))} /></label>
                <label><span>{text("任务前缀", "Job prefix")}</span><input value={qeOptions.prefix} onChange={(event) => setQeOptions((current) => ({ ...current, prefix: event.target.value }))} /></label>
                {(qeOptions.calculation === "md" || qeOptions.calculation === "vc-md") && <><label><span>{text("动力学步数", "MD steps")}</span><input type="number" min="1" step="10" value={qeOptions.mdSteps ?? 100} onChange={(event) => setQeOptions((current) => ({ ...current, mdSteps: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} /></label><label><span>{text("时间步长（原子单位）", "Time step (a.u.)")}</span><input type="number" min="0.1" step="1" value={qeOptions.mdTimeStepAu ?? 20} onChange={(event) => setQeOptions((current) => ({ ...current, mdTimeStepAu: Math.max(0.1, Number(event.target.value) || 20) }))} /></label><label><span>{text("目标温度（K）", "Target temperature (K)")}</span><input type="number" min="0.1" step="10" value={qeOptions.temperatureK ?? 300} onChange={(event) => setQeOptions((current) => ({ ...current, temperatureK: Math.max(0.1, Number(event.target.value) || 300) }))} /></label></>}
              </div>
            </section>

            <section className="utility-section">
              <div className="utility-section-head"><span>{text("赝势文件清单", "Pseudopotential file manifest")}</span><small>UPF · {qeOptions.inputDft === "auto" ? "Auto" : qeOptions.inputDft}</small></div>
              <datalist id="qe-pseudopotential-export-files">{(qeStatus?.pseudopotentials ?? []).map((file) => <option value={file} key={file} />)}</datalist>
              <div className="qe-pseudo-grid">{qePreparedInput.diagnostics.elements.map((element) => { const file = qeOptions.pseudopotentials[element] ?? ""; const verified = Boolean(qeStatus?.pseudoRoot && availableQePseudoNames.has(file.toLocaleLowerCase())); return <label key={element} className={verified ? "available" : "unverified"}><strong>{element}</strong><input list="qe-pseudopotential-export-files" value={file} onChange={(event) => setQeOptions((current) => ({ ...current, pseudopotentials: { ...current.pseudopotentials, [element]: event.target.value } }))} /><i>{verified ? "✓" : "?"}</i></label>; })}</div>
              <details className="utility-help"><summary>？ {text("如何选择赝势", "How to choose pseudopotentials")}</summary><p>{text("同一任务中的 UPF 应来自兼容的赝势库并采用相同交换-相关泛函。推荐优先使用 SSSP PBE Efficiency 或 Precision 集合；带重元素时核对相对论处理，带过渡金属时核对半芯态。文件名只是清单，运行前须把实际 UPF 放入 input 中 pseudo_dir 指向的目录。", "UPFs in one job should come from a compatible library and use the same exchange-correlation functional. Prefer an SSSP PBE Efficiency or Precision set; verify relativistic treatment for heavy elements and semicore states for transition metals. Filenames are a manifest only: place the actual UPFs in the directory referenced by pseudo_dir before running.")}</p></details>
            </section>

            <section className="utility-section qe-convergence-section">
              <div className="utility-section-head"><span>{text("收敛测试输入集", "Convergence-test input set")}</span><small>{Math.max(0, qeConvergenceInputFiles.length - 1)} × SCF</small></div>
              <div className="qe-convergence-tabs" role="tablist"><button type="button" role="tab" aria-selected={qeConvergenceMode === "k-point"} className={qeConvergenceMode === "k-point" ? "active" : ""} onClick={() => setQeConvergenceMode("k-point")}>{text("k 点网格", "k-point meshes")}</button><button type="button" role="tab" aria-selected={qeConvergenceMode === "cutoff"} className={qeConvergenceMode === "cutoff" ? "active" : ""} onClick={() => setQeConvergenceMode("cutoff")}>{text("截断能", "cutoffs")}</button></div>
              {qeConvergenceMode === "k-point" ? <div className="qe-convergence-builder"><p>{text("按倒易晶格自动生成各向异性的 Monkhorst–Pack 网格。选择要导出的点；所有输入固定当前结构与截断能。", "Anisotropic Monkhorst-Pack meshes are generated from reciprocal-vector lengths. Select export points; every input fixes the current structure and cutoffs.")}</p><div className="qe-kpoint-candidates">{qeKPointCandidates.map((candidate) => { const key = qeMeshKey(candidate.kPoints); const selected = qeSelectedKMeshes.includes(key); return <label key={key} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={(event) => setQeSelectedKMeshes((current) => event.target.checked ? [...new Set([...current, key])] : current.filter((item) => item !== key))} /><strong>{key}</strong><small>{candidate.targetSpacingInverseAngstrom ? `≈${candidate.targetSpacingInverseAngstrom.toFixed(2)} Å⁻¹` : "Γ"}</small></label>; })}</div></div> : <div className="qe-convergence-builder"><p>{text("固定当前 k 点，逐步提高 ecutwfc；ecutrho 按所设倍数同步生成。", "Keep the current k-point mesh fixed while increasing ecutwfc; ecutrho follows the selected multiplier.")}</p><div className="gaussian-form-grid qe-convergence-inputs"><label><span>{text("起始值（Ry）", "Start (Ry)")}</span><input type="number" min="1" step="5" value={qeCutoffRange.startRy} onChange={(event) => setQeCutoffRange((current) => ({ ...current, startRy: Math.max(1, Number(event.target.value) || 1) }))} /></label><label><span>{text("终止值（Ry）", "End (Ry)")}</span><input type="number" min="1" step="5" value={qeCutoffRange.endRy} onChange={(event) => setQeCutoffRange((current) => ({ ...current, endRy: Math.max(1, Number(event.target.value) || 1) }))} /></label><label><span>{text("步长（Ry）", "Step (Ry)")}</span><input type="number" min="1" step="5" value={qeCutoffRange.stepRy} onChange={(event) => setQeCutoffRange((current) => ({ ...current, stepRy: Math.max(1, Number(event.target.value) || 1) }))} /></label><label><span>ecutrho / ecutwfc</span><input type="number" min="4" max="20" step="1" value={qeCutoffRange.densityMultiplier} onChange={(event) => setQeCutoffRange((current) => ({ ...current, densityMultiplier: Math.max(4, Number(event.target.value) || 4) }))} /></label></div><div className="qe-cutoff-candidates">{qeCutoffCandidates.map((candidate) => <span key={`${candidate.ecutwfcRy}-${candidate.ecutrhoRy}`}><strong>{candidate.ecutwfcRy}</strong><small>/ {candidate.ecutrhoRy} Ry</small></span>)}</div></div>}
              <div className="gaussian-actions"><button type="button" className="primary" disabled={qePreparedInput.diagnostics.blockingIssues.length > 0 || qeConvergenceInputFiles.length < 3} onClick={() => downloadTextArchive(`${qeOptions.prefix || "symviz-qe"}-${qeConvergenceMode}-study.zip`, qeConvergenceInputFiles)}>{text("下载输入集 ZIP", "Download input-set ZIP")}</button></div>
              <details className="utility-help"><summary>？ {text("推荐的收敛顺序", "Recommended convergence order")}</summary><p>{text("先用较疏 k 点收敛 ecutwfc/ecutrho，再固定截断能收敛 k 点；比较每原子能量的同时检查最大原子力与应力。ZIP 中含独立 .in 文件和 README，不包含赝势。", "First converge ecutwfc/ecutrho with a coarse k mesh, then converge k-points at fixed cutoffs. Check maximum force and stress as well as energy per atom. The ZIP contains independent .in files and a README, but no pseudopotentials.")}</p></details>
            </section>

            <section className="utility-section gaussian-input-preview">
              <div className="utility-section-head"><span>Quantum ESPRESSO input (.in)</span><small>{qePreparedInput.input.split("\n").length} {text("行", "lines")}</small></div>
              <div className="gaussian-model-diagnostics"><span><small>{text("晶胞原子", "Cell atoms")}</small><strong>{qePreparedInput.diagnostics.atomCount}</strong></span><span className={qePreparedInput.diagnostics.partialOccupancyLabels.length ? "problem" : "ok"}><small>{text("部分占有", "Partial occupancy")}</small><strong>{qePreparedInput.diagnostics.partialOccupancyLabels.length}</strong></span><span className={structure.disorder.explicit ? "problem" : "ok"}><small>{text("无序", "Disorder")}</small><strong>{structure.disorder.explicit ? text("需处理", "Resolve") : text("无", "None")}</strong></span><span><small>{text("赝势文件名", "Pseudo filenames")}</small><strong>{qePreparedInput.requiredPseudopotentials.length}</strong></span></div>
              {qePreparedInput.diagnostics.blockingIssues.map((issue) => <div className="utility-warning gaussian-export-blocker" key={issue}><strong>{text("已阻止导出", "Export blocked")}</strong><p>{issue}</p></div>)}
              {qePreparedInput.diagnostics.warnings.map((warning) => <div className="utility-warning" key={warning}><p>{warning}</p></div>)}
              <textarea readOnly spellCheck={false} value={qePreparedInput.input} aria-label="Quantum ESPRESSO input preview" />
              <div className="gaussian-actions"><button type="button" className="primary" disabled={qePreparedInput.diagnostics.blockingIssues.length > 0} onClick={() => downloadTextFile(`${qeOptions.prefix || "symviz-qe"}.in`, qePreparedInput.input)}>{text("下载 .in", "Download .in")}</button><button type="button" onClick={() => void navigator.clipboard.writeText(qePreparedInput.input)}>{text("复制输入", "Copy input")}</button></div>
            </section>

            <details className="utility-help"><summary>？ {text("自动推荐的边界", "Limits of automatic recommendations")}</summary><p>{text("CIF 通常不包含可靠的金属性、磁序、氧化态、Hubbard U、自旋轨道耦合选择或目标精度。SymViz 只据结构与元素给出保守起点；涉及磁性、强关联、缺陷、带电晶胞、声子、Berry-phase 极化或高压时必须由研究者补充专用设置。", "A CIF normally does not determine metallicity, magnetic order, oxidation states, Hubbard U, spin-orbit choices, or target precision. SymViz provides conservative structural/compositional starting points only; magnetic, correlated, defective, charged, phonon, Berry-phase, and high-pressure work requires specialist settings.")}</p></details>
          </>}

          {false && <>
            <section className="utility-section bridge-card desktop-gaussian-card qe-desktop-card">
              <div className="utility-section-head"><span>{text("SymViz 桌面版 · Quantum ESPRESSO", "SymViz Desktop · Quantum ESPRESSO")}</span><small className={qeStatus?.available ? "bridge-online" : "bridge-offline"}>{qeStatus?.available ? (qeStatus.runtime === "wsl" ? `WSL2 · ${qeStatus.wslDistro}${qeStatus.qeVersion ? ` · QE ${qeStatus.qeVersion}` : ""}` : text("Windows 原生", "Windows native")) : text("未检测到", "Not detected")}</small></div>
              <div className="desktop-gaussian-status">
                <span><small>{text("QE 运行时", "QE runtime")}</small><code>{qeStatus?.qeRoot || text("尚未检测到 pw.x", "pw.x not detected")}</code></span>
                <span><small>{text("赝势目录", "Pseudopotential folder")}</small><code>{qeStatus?.pseudoRoot || text("尚未选择", "Not selected")}</code></span>
                <span><small>{text("任务保存目录", "Job folder")}</small><code>{qeStatus?.workRoot || text("仅桌面版可运行", "Desktop app required")}</code></span>
              </div>
              {qeStatus && <div className="desktop-binary-status">
                {(["pw", "ph", "pp", "bands", "dos", "projwfc"] as const).map((binary) => <span key={binary} className={qeStatus.binaries[binary]?.available ? "available" : "missing"}><i />{binary}.x</span>)}
                <span className={qeStatus.pseudopotentials.length ? "available" : "missing"}><i />UPF {qeStatus.pseudopotentials.length}</span>
              </div>}
              <div className="gaussian-actions">
                <button type="button" onClick={() => void refreshQuantumEspresso()}>{text("检测 WSL / QE", "Detect WSL / QE")}</button>
                <button type="button" onClick={() => void chooseQuantumEspressoRoot()}>{text("选择 Windows QE…", "Choose Windows QE…")}</button>
                <button type="button" onClick={() => void chooseQuantumEspressoPseudoRoot()}>{text("选择赝势文件夹…", "Choose pseudopotential folder…")}</button>
              </div>
              {qeStatus?.runtime === "wsl" && /^6\./.test(qeStatus.qeVersion) && <div className="utility-warning"><strong>{text("当前为联调版本", "Validation runtime")}</strong><p>{text(`已检测到 QE ${qeStatus.qeVersion}。它可以用于 SCF 和结构优化联调；正式 Berry-phase 自发极化计算前将升级到 QE 7.5。`, `QE ${qeStatus.qeVersion} is available for SCF and structural-relaxation validation. Upgrade to QE 7.5 before production Berry-phase polarization calculations.`)}</p></div>}
              <details className="utility-help">
                <summary>？ {text("WSL 与赝势如何连接？", "How are WSL and pseudopotentials connected?")}</summary>
                <p>{text("SymViz 会自动检测 WSL2 Ubuntu 中的 pw.x 和 quantum-espresso-data-sssp。每次提交时，只把当前元素需要的 UPF 文件复制到 Windows 任务目录，然后通过 wsl.exe 运行 Linux 版 pw.x。也可用右侧按钮覆盖为 Windows 原生程序或自定义 UPF 文件夹。", "SymViz automatically detects pw.x and quantum-espresso-data-sssp in WSL2 Ubuntu. For each submission it copies only the required UPF files into the Windows job folder, then runs Linux pw.x through wsl.exe. The buttons can override this with a native Windows executable or a custom UPF folder.")}</p>
              </details>
            </section>

            <section className="utility-section">
              <div className="utility-section-head"><span>{text("周期计算设置", "Periodic calculation setup")}</span><small>{qePreparedInput.diagnostics.atomCount} {text("原子", "atoms")} · {qePreparedInput.diagnostics.elementCount} {text("元素", "elements")}</small></div>
              <div className="gaussian-form-grid qe-form-grid">
                <label className="span-two"><span>{text("任务标题", "Job title")}</span><input value={qeOptions.title} onChange={(event) => setQeOptions((current) => ({ ...current, title: event.target.value }))} /></label>
                <label><span>{text("计算类型", "Calculation")}</span><select value={qeOptions.calculation} onChange={(event) => setQeOptions((current) => ({ ...current, calculation: event.target.value as QuantumEspressoInputOptions["calculation"] }))}>
                  <optgroup label={text("电子结构", "Electronic structure")}><option value="scf">SCF · {text("自洽单点能", "self-consistent single point")}</option></optgroup>
                  <optgroup label={text("结构优化", "Structure optimization")}><option value="relax">relax · {text("固定晶胞优化原子", "relax ions at fixed cell")}</option><option value="vc-relax">vc-relax · {text("同时优化晶胞与原子", "relax cell and ions")}</option></optgroup>
                  <optgroup label={text("分子动力学", "Molecular dynamics")}><option value="md">MD · {text("固定晶胞", "fixed cell")}</option><option value="vc-md">vc-MD · {text("可变晶胞", "variable cell")}</option></optgroup>
                </select></label>
                <label><span>{text("交换-相关泛函", "Exchange-correlation")}</span><select value={qeOptions.inputDft} onChange={(event) => setQeOptions((current) => ({ ...current, inputDft: event.target.value as QuantumEspressoInputOptions["inputDft"] }))}>
                  <option value="auto">{text("从赝势读取（推荐）", "Read from UPF (recommended)")}</option>
                  <optgroup label="LDA"><option value="PZ">PZ · Perdew–Zunger</option></optgroup>
                  <optgroup label="GGA"><option value="PBE">PBE</option><option value="PBEsol">PBEsol</option><option value="PW91">PW91</option><option value="BLYP">BLYP</option></optgroup>
                  <optgroup label="meta-GGA"><option value="SCAN">SCAN</option></optgroup>
                  <optgroup label={text("混合泛函（高成本）", "Hybrid (high cost)")}><option value="PBE0">PBE0</option><option value="HSE">HSE</option><option value="B3LYP">B3LYP</option></optgroup>
                </select></label>
                <label><span>{text("色散修正", "Dispersion correction")}</span><select value={qeOptions.dispersion} onChange={(event) => setQeOptions((current) => ({ ...current, dispersion: event.target.value as QuantumEspressoInputOptions["dispersion"] }))}>
                  <option value="d3-bj">Grimme D3(BJ)</option><option value="none">None</option>
                </select></label>
                <label><span>{text("占据方式", "Occupations")}</span><select value={qeOptions.occupations} onChange={(event) => setQeOptions((current) => ({ ...current, occupations: event.target.value as QuantumEspressoInputOptions["occupations"] }))}>
                  <option value="fixed">fixed ({text("绝缘体", "insulator")})</option><option value="smearing">smearing ({text("金属", "metal")})</option>
                </select></label>
                <label><span>{text("波函数截断能（Ry）", "Wavefunction cutoff (Ry)")}</span><input type="number" min="1" step="5" value={qeOptions.ecutwfcRy} onChange={(event) => setQeOptions((current) => ({ ...current, ecutwfcRy: Number(event.target.value) || 1 }))} /></label>
                <label><span>{text("电荷密度截断能（Ry）", "Charge-density cutoff (Ry)")}</span><input type="number" min="1" step="10" value={qeOptions.ecutrhoRy} onChange={(event) => setQeOptions((current) => ({ ...current, ecutrhoRy: Number(event.target.value) || 1 }))} /></label>
                <label className="span-two"><span>k-point mesh</span><div className="qe-triplet-input">{qeOptions.kPoints.map((value, axis) => <input key={axis} aria-label={`k${axis + 1}`} type="number" min="1" step="1" value={value} onChange={(event) => setQeOptions((current) => ({ ...current, kPoints: current.kPoints.map((item, index) => index === axis ? Math.max(1, Math.round(Number(event.target.value) || 1)) : item) as [number, number, number] }))} />)}</div></label>
                <label><span>SCF conv_thr</span><input type="number" min="1e-14" step="1e-9" value={qeOptions.convThr} onChange={(event) => setQeOptions((current) => ({ ...current, convThr: Number(event.target.value) || 1e-8 }))} /></label>
                <label><span>{text("任务前缀", "Job prefix")}</span><input value={qeOptions.prefix} onChange={(event) => setQeOptions((current) => ({ ...current, prefix: event.target.value }))} /></label>
                {(qeOptions.calculation === "md" || qeOptions.calculation === "vc-md") && <>
                  <label><span>{text("动力学步数", "MD steps")}</span><input type="number" min="1" step="10" value={qeOptions.mdSteps ?? 100} onChange={(event) => setQeOptions((current) => ({ ...current, mdSteps: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} /></label>
                  <label><span>{text("时间步长（原子单位）", "Time step (a.u.)")}</span><input type="number" min="0.1" step="1" value={qeOptions.mdTimeStepAu ?? 20} onChange={(event) => setQeOptions((current) => ({ ...current, mdTimeStepAu: Math.max(0.1, Number(event.target.value) || 20) }))} /></label>
                  <label><span>{text("目标温度（K）", "Target temperature (K)")}</span><input type="number" min="0.1" step="10" value={qeOptions.temperatureK ?? 300} onChange={(event) => setQeOptions((current) => ({ ...current, temperatureK: Math.max(0.1, Number(event.target.value) || 300) }))} /></label>
                </>}
              </div>
            </section>

            <section className="utility-section">
              <div className="utility-section-head"><span>{text("元素与赝势", "Elements and pseudopotentials")}</span><small>{qeOptions.inputDft === "auto" ? text("由 UPF 决定", "Defined by UPF") : qeOptions.inputDft} · UPF</small></div>
              <datalist id="qe-pseudopotential-files">{(qeStatus?.pseudopotentials ?? []).map((file) => <option value={file} key={file} />)}</datalist>
              <div className="qe-pseudo-grid">{qePreparedInput.diagnostics.elements.map((element) => {
                const file = qeOptions.pseudopotentials[element] ?? "";
                const available = availableQePseudoNames.has(file.toLocaleLowerCase());
                return <label key={element} className={available ? "available" : "missing"}><strong>{element}</strong><input list="qe-pseudopotential-files" value={file} onChange={(event) => setQeOptions((current) => ({ ...current, pseudopotentials: { ...current.pseudopotentials, [element]: event.target.value } }))} /><i>{available ? "✓" : "!"}</i></label>;
              })}</div>
              {unavailableQePseudopotentials.length > 0 && <div className="utility-warning"><strong>{text("赝势尚未就绪", "Pseudopotentials not ready")}</strong><p>{text("请连接 UPF 文件夹，并为每种元素选择实际存在且与 PBE 匹配的赝势。", "Connect an UPF folder and select an existing PBE-compatible pseudopotential for every element.")} {unavailableQePseudopotentials.join(", ")}</p></div>}
            </section>

            <section className="utility-section qe-convergence-section">
              <div className="utility-section-head"><span>{text("参数收敛性测试", "Parameter convergence studies")}</span><small>SCF · meV/atom</small></div>
              <div className="qe-convergence-tabs" role="tablist" aria-label={text("收敛测试类型", "Convergence study type")}>
                <button type="button" role="tab" aria-selected={qeConvergenceMode === "k-point"} className={qeConvergenceMode === "k-point" ? "active" : ""} onClick={() => setQeConvergenceMode("k-point")}>{text("k 点选择优化", "k-point optimization")}</button>
                <button type="button" role="tab" aria-selected={qeConvergenceMode === "cutoff"} className={qeConvergenceMode === "cutoff" ? "active" : ""} onClick={() => setQeConvergenceMode("cutoff")}>{text("截断能收敛", "Cutoff convergence")}</button>
              </div>

              {qeConvergenceMode === "k-point" ? <div className="qe-convergence-builder">
                <p>{text("固定当前截断能和晶体结构，按倒易晶格长度生成由疏到密的各向异性 Monkhorst–Pack 网格。", "Keep the current cutoffs and structure fixed while testing anisotropic Monkhorst-Pack meshes derived from reciprocal-vector lengths.")}</p>
                <div className="qe-kpoint-candidates">{qeKPointCandidates.map((candidate) => {
                  const key = qeMeshKey(candidate.kPoints);
                  const selected = qeSelectedKMeshes.includes(key);
                  return <label key={key} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={(event) => setQeSelectedKMeshes((current) => event.target.checked ? [...new Set([...current, key])] : current.filter((item) => item !== key))} /><strong>{key}</strong><small>{candidate.pointCount} {text("网格点", "grid points")}{candidate.targetSpacingInverseAngstrom ? ` · ≈${candidate.targetSpacingInverseAngstrom.toFixed(2)} Å⁻¹` : " · Γ"}</small></label>;
                })}</div>
                <div className="qe-study-fixed"><span>{text("固定截断能", "Fixed cutoffs")}</span><strong>{qeOptions.ecutwfcRy} / {qeOptions.ecutrhoRy} Ry</strong></div>
              </div> : <div className="qe-convergence-builder">
                <p>{text("固定当前 k 点网格和晶体结构，逐步提高波函数截断能；电荷密度截断能按固定倍数同步提高。", "Keep the current k-point mesh and structure fixed while increasing the wavefunction cutoff and maintaining a fixed charge-density multiplier.")}</p>
                <div className="gaussian-form-grid qe-convergence-inputs">
                  <label><span>{text("起始 ecutwfc（Ry）", "Start ecutwfc (Ry)")}</span><input type="number" min="1" step="5" value={qeCutoffRange.startRy} onChange={(event) => setQeCutoffRange((current) => ({ ...current, startRy: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                  <label><span>{text("终止 ecutwfc（Ry）", "End ecutwfc (Ry)")}</span><input type="number" min="1" step="5" value={qeCutoffRange.endRy} onChange={(event) => setQeCutoffRange((current) => ({ ...current, endRy: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                  <label><span>{text("步长（Ry）", "Step (Ry)")}</span><input type="number" min="1" step="5" value={qeCutoffRange.stepRy} onChange={(event) => setQeCutoffRange((current) => ({ ...current, stepRy: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                  <label><span>ecutrho / ecutwfc</span><input type="number" min="4" max="20" step="1" value={qeCutoffRange.densityMultiplier} onChange={(event) => setQeCutoffRange((current) => ({ ...current, densityMultiplier: Math.max(4, Number(event.target.value) || 4) }))} /></label>
                </div>
                <div className="qe-cutoff-candidates">{qeCutoffCandidates.map((candidate) => <span key={`${candidate.ecutwfcRy}-${candidate.ecutrhoRy}`}><strong>{candidate.ecutwfcRy}</strong><small>/ {candidate.ecutrhoRy} Ry</small></span>)}</div>
                <div className="qe-study-fixed"><span>{text("固定 k 点", "Fixed k-points")}</span><strong>{qeMeshKey(qeOptions.kPoints)}</strong></div>
              </div>}

              <div className="qe-convergence-controls">
                <label><span>{text("能量阈值（meV/atom）", "Energy threshold (meV/atom)")}</span><input type="number" min="0.01" step="0.1" value={qeConvergenceTolerance} onChange={(event) => setQeConvergenceTolerance(Math.max(0.01, Number(event.target.value) || 1))} /></label>
                <button type="button" className="primary" disabled={!qeStatus?.available || qeQueueBusy || qePreparedInput.diagnostics.blockingIssues.length > 0 || unavailableQePseudopotentials.length > 0 || (qeConvergenceMode === "k-point" ? qeSelectedKMeshes.length : qeCutoffCandidates.length) < 2} onClick={() => void submitQuantumEspressoConvergenceStudy(qeConvergenceMode)}>{qeQueueBusy ? text("QE 队列运行中", "QE queue is busy") : text(`开始 ${qeConvergenceMode === "k-point" ? qeSelectedKMeshes.length : qeCutoffCandidates.length} 点测试`, `Run ${qeConvergenceMode === "k-point" ? qeSelectedKMeshes.length : qeCutoffCandidates.length}-point study`)}</button>
              </div>
              {qePreparedInput.diagnostics.atomCount > 200 && <div className="utility-warning"><strong>{text("大型体系", "Large model")}</strong><p>{text(`当前有 ${qePreparedInput.diagnostics.atomCount} 个原子。每个参数点都是完整 SCF 任务，建议先只选较疏的 2–3 个网格试运行，避免再次触发内存交换。`, `The model has ${qePreparedInput.diagnostics.atomCount} atoms. Every parameter point is a full SCF job; start with only 2–3 coarse meshes to avoid memory swapping.`)}</p></div>}

              {qeConvergenceStudies.length > 0 && <div className="qe-convergence-results">
                <div className="qe-study-selector"><label><span>{text("结果组", "Study results")}</span><select value={selectedQeStudy?.id ?? ""} onChange={(event) => setSelectedQeStudyId(event.target.value)}>{qeConvergenceStudies.map((study) => <option value={study.id} key={study.id}>{study.kind === "k-point" ? text("k 点", "k-point") : text("截断能", "cutoff")} · {new Date(study.createdAt).toLocaleString(language)}</option>)}</select></label><small>{selectedQeStudy?.jobs.length ?? 0}/{selectedQeStudy?.jobs[0]?.study?.sequenceTotal ?? 0}</small></div>
                {recommendedQeStudyJob ? <div className="qe-recommendation"><span><small>{text("推荐的最低收敛参数", "Lowest converged recommendation")}</small><strong>{recommendedQeStudyJob.study ? qeStudyParameterLabel(recommendedQeStudyJob.study) : "—"}</strong></span><button type="button" onClick={() => applyQuantumEspressoConvergenceRecommendation(recommendedQeStudyJob)}>{text("采用参数", "Apply")}</button></div>
                  : selectedQeStudyAnalysis?.complete && <div className="utility-warning"><strong>{text("当前范围尚未收敛", "Current range is not converged")}</strong><p>{text("最高精度点之间仍超过所设阈值，请扩展网格或截断能范围。", "The high-accuracy points still exceed the selected tolerance; extend the mesh or cutoff range.")}</p></div>}
                <div className="qe-convergence-table-wrap"><table className="qe-convergence-table"><thead><tr><th>{text("参数", "Parameter")}</th><th>{text("状态", "Status")}</th><th>E (Ry)</th><th>ΔE (meV/atom)</th><th>Fmax (Ry/Bohr)</th><th>P (kbar)</th></tr></thead><tbody>{selectedQeStudyAnalysis?.rows.map(({ job, deltaMevPerAtom }, index) => <tr key={job.id} className={recommendedQeStudyJob?.id === job.id ? "recommended" : ""} onClick={() => setSelectedQeJobId(job.id)}><td><strong>{job.study ? qeStudyParameterLabel(job.study) : "—"}</strong>{index === selectedQeStudyAnalysis.rows.length - 1 && <small>{text("参考", "reference")}</small>}</td><td>{gaussianJobStatusText(job.status, language)}</td><td>{job.summary?.totalEnergyRy?.toFixed(8) ?? "—"}</td><td>{deltaMevPerAtom?.toFixed(3) ?? "—"}</td><td>{job.summary?.maximumForceRyBohr?.toExponential(2) ?? "—"}</td><td>{job.summary?.pressureKbar?.toFixed(3) ?? "—"}</td></tr>)}</tbody></table></div>
                <p className="qe-convergence-note">{text("ΔE 以该组最高网格或最高截断能为参考；只有所有任务正常完成且从某一点起后续结果均低于阈值时才给出推荐。", "ΔE is referenced to the densest mesh or highest cutoff. A recommendation appears only after every job completes and all subsequent points remain below the tolerance.")}</p>
              </div>}
              <details className="utility-help"><summary>？ {text("如何使用收敛测试", "How convergence studies work")}</summary><p>{text("先完成截断能测试，再在推荐截断能下测试 k 点。金属、强磁性体系以及压力或声子计算通常需要比 1 meV/atom 更严格的专门判据；能量收敛也不自动保证力和应力已经收敛，因此表中同时给出最大原子力和压力。", "Converge the cutoffs first, then test k-points at the recommended cutoffs. Metals, strongly magnetic systems, and pressure or phonon work often need stricter dedicated criteria than 1 meV/atom. Energy convergence does not guarantee converged forces or stress, so the table also reports maximum atomic force and pressure.")}</p></details>
            </section>

            <section className="utility-section gaussian-input-preview">
              <div className="utility-section-head"><span>Quantum ESPRESSO input (.in)</span><small>{qePreparedInput.input.split("\n").length} {text("行", "lines")}</small></div>
              <div className="gaussian-model-diagnostics">
                <span><small>{text("晶胞原子", "Cell atoms")}</small><strong>{qePreparedInput.diagnostics.atomCount}</strong></span>
                <span className={qePreparedInput.diagnostics.partialOccupancyLabels.length ? "problem" : "ok"}><small>{text("部分占有", "Partial occupancy")}</small><strong>{qePreparedInput.diagnostics.partialOccupancyLabels.length}</strong></span>
                <span className={structure.disorder.explicit ? "problem" : "ok"}><small>{text("无序", "Disorder")}</small><strong>{structure.disorder.explicit ? text("需处理", "Resolve") : text("无", "None")}</strong></span>
                <span className={unavailableQePseudopotentials.length ? "problem" : "ok"}><small>{text("赝势", "Pseudos")}</small><strong>{unavailableQePseudopotentials.length ? text("缺失", "Missing") : text("就绪", "Ready")}</strong></span>
              </div>
              {qePreparedInput.diagnostics.blockingIssues.map((issue) => <div className="utility-warning gaussian-export-blocker" key={issue}><strong>{text("已阻止周期计算", "Periodic calculation blocked")}</strong><p>{issue}</p></div>)}
              {qePreparedInput.diagnostics.warnings.map((warning) => <div className="utility-warning" key={warning}><p>{warning}</p></div>)}
              <textarea readOnly spellCheck={false} value={qePreparedInput.input} aria-label="Quantum ESPRESSO input preview" />
              <div className="gaussian-actions">
                <button type="button" className="primary" disabled={!qeStatus?.available || qePreparedInput.diagnostics.blockingIssues.length > 0 || unavailableQePseudopotentials.length > 0} onClick={() => void submitQuantumEspressoJob()}>{text("加入 QE 本地队列", "Add to local QE queue")}</button>
                <button type="button" onClick={() => downloadTextFile(`${qeOptions.prefix || "symviz-qe"}.in`, qePreparedInput.input)}>{text("下载 .in", "Download .in")}</button>
              </div>
            </section>

            <section className="utility-section">
              <div className="utility-section-head"><span>{text("QE 任务队列", "QE job queue")}</span><small>{qeJobs.length}</small></div>
              {qeJobs.length === 0 ? <div className="utility-empty"><strong>{text("尚无周期计算任务", "No periodic jobs yet")}</strong><p>{text("连接 pw.x 和赝势后，即可运行当前预览。", "Connect pw.x and pseudopotentials, then run the current preview.")}</p></div>
                : <div className="gaussian-job-list">{qeJobs.map((job) => <article key={job.id} className={`gaussian-job-card status-${job.status}`}>
                  <button type="button" className="job-main" onClick={() => setSelectedQeJobId(job.id)}><span><i />{job.name}</span><small>{new Date(job.createdAt).toLocaleString(language)}</small><b>{gaussianJobStatusText(job.status, language)}</b></button>
                  {job.status === "failed" && job.error && <p className="qe-job-error"><strong>{text("启动或运行错误：", "Startup or runtime error: ")}</strong>{quantumEspressoErrorText(job.error, language)}</p>}
                  <div className="job-actions">
                    {job.status === "running" && <button type="button" onClick={() => void cancelQuantumEspressoJob(job)}>{text("取消", "Cancel")}</button>}
                    <button type="button" onClick={() => void window.symvizDesktop?.revealQeJob(job.remoteId)}>{text("打开目录", "Open folder")}</button>
                  </div>
                </article>)}</div>}
            </section>

            {qeStatus && runningQeJob && <section className="utility-section gaussian-live-section qe-live-section">
              <div className="utility-section-head"><span className="gaussian-live-title"><i />{text("pw.x 实时输出", "Live pw.x output")}</span><small>{visibleLiveQeOutput.updatedAt ? new Date(visibleLiveQeOutput.updatedAt).toLocaleTimeString(language) : text("等待输出", "Waiting for output")}</small></div>
              <pre ref={liveQeOutputRef} className="gaussian-live-output" role="log" tabIndex={0}>{visibleLiveQeOutput.text || text("Quantum ESPRESSO 正在初始化……", "Quantum ESPRESSO is starting…")}</pre>
              <div className="gaussian-actions gaussian-live-actions"><button type="button" onClick={() => setFollowQeOutput((current) => !current)}>{followQeOutput ? text("暂停自动滚动", "Pause auto-scroll") : text("继续自动滚动", "Resume auto-scroll")}</button><button type="button" disabled={!visibleLiveQeOutput.text} onClick={() => void navigator.clipboard.writeText(visibleLiveQeOutput.text)}>{text("复制输出", "Copy output")}</button></div>
            </section>}

            {selectedQeJob?.status === "failed" && selectedQeJob.error && <section className="utility-warning gaussian-export-blocker qe-selected-error" role="alert"><strong>{text("Quantum ESPRESSO 未正常完成", "Quantum ESPRESSO did not finish normally")}</strong><p>{quantumEspressoErrorText(selectedQeJob.error, language)}</p></section>}

            {selectedQeJob?.summary && <section className="gaussian-results qe-results">
              <div className={`termination-banner ${selectedQeJob.summary.status}`}><i>{selectedQeJob.summary.jobDone ? "✓" : selectedQeJob.summary.status === "failed" ? "!" : "…"}</i><span><strong>{selectedQeJob.name}</strong><small>{selectedQeJob.summary.jobDone ? "JOB DONE" : selectedQeJob.summary.errorMessage || text("输出尚未完成", "Output incomplete")}</small></span></div>
              <div className="quantum-result-grid">
                <span>{text("总能量（Ry）", "Total energy (Ry)")}<strong>{selectedQeJob.summary.totalEnergyRy?.toFixed(9) ?? "—"}</strong><small>{selectedQeJob.summary.totalEnergyEv?.toFixed(5) ?? "—"} eV</small></span>
                <span>{text("压力（kbar）", "Pressure (kbar)")}<strong>{selectedQeJob.summary.pressureKbar?.toFixed(4) ?? "—"}</strong><small>cell stress</small></span>
                <span>{text("费米能（eV）", "Fermi energy (eV)")}<strong>{selectedQeJob.summary.fermiEnergyEv?.toFixed(5) ?? "—"}</strong><small>{selectedQeJob.summary.convergenceReached ? text("SCF 已收敛", "SCF converged") : text("待确认", "Check output")}</small></span>
              </div>
            </section>}

            <details className="utility-help">
              <summary>？ {text("当前阶段与 Ps 后续流程", "Current scope and the later Ps workflow")}</summary>
              <p>{text("当前版本先提供周期 SCF、原子优化和变晶胞优化。Berry-phase 自发极化还需要极性相、参考相、连续绝热路径以及极化量子分支展开；后续将在此基础上加入，而不会把单个晶胞偶极误标为 Ps。", "This version first provides periodic SCF, ionic relaxation, and variable-cell relaxation. Berry-phase spontaneous polarization additionally requires polar and reference states, a continuous adiabatic path, and polarization-branch unwrapping; those will build on this backend rather than treating a single-cell dipole as Ps.")}</p>
            </details>
          </>}

          {quantumSubview === "input" && <>
            <section className="utility-section">
              <div className="utility-section-head"><span>{text("计算模型", "Calculation model")}</span><small>{gaussianIndices.length} {text("个原子", "atoms")}</small></div>
              <div className="gaussian-form-grid">
                <label className="span-two"><span>{text("坐标范围", "Coordinate scope")}</span><select value={gaussianScope} onChange={(event) => setGaussianScope(event.target.value as GaussianScope)}>
                  <option value="selected-molecule">{text("当前选中原子所在分子", "Molecule containing the selected atom")}</option>
                  <option value="asymmetric-unit">{text("CIF 不对称单元", "CIF asymmetric unit")}</option>
                  <option value="generated-atoms">{text("当前晶胞全部等价原子", "All generated atoms in the current cell")}</option>
                </select></label>
                <label className="span-two"><span>{text("任务标题", "Job title")}</span><input value={gaussianOptions.title} onChange={(event) => setGaussianOptions((current) => ({ ...current, title: event.target.value }))} /></label>
                <label className="span-two"><span>{text("计算流程", "Calculation workflow")}</span><select value={gaussianOptions.workflow ?? "single"} onChange={(event) => setGaussianOptions((current) => ({ ...current, workflow: event.target.value as GaussianWorkflow }))}>
                  <option value="preopt-final">{text("分阶段：小基组初步优化 → 大基组最终计算", "Staged: small-basis preoptimization → large-basis final calculation")}</option>
                  <option value="single">{text("单阶段（高级）", "Single stage (advanced)")}</option>
                </select></label>
                {gaussianOptions.workflow === "preopt-final" && <>
                  <label className={gaussianPreoptimizationMethodIsCustom ? "gaussian-preset-custom gaussian-stage-field" : "gaussian-stage-field"}><span>{text("初步优化方法", "Preoptimization method")}</span><select
                    value={gaussianPreoptimizationMethodIsCustom ? customGaussianOption : gaussianOptions.preoptimizationMethod}
                    onChange={(event) => setGaussianOptions((current) => ({ ...current, preoptimizationMethod: event.target.value === customGaussianOption ? "" : event.target.value }))}
                  >
                    {gaussianMethodGroups.map((group) => <optgroup key={`pre-${group.en}`} label={text(group.zh, group.en)}>
                      {group.options.map((method) => <option key={`pre-${method}`} value={method}>{method}</option>)}
                    </optgroup>)}
                    <option value={customGaussianOption}>{text("自定义…", "Custom…")}</option>
                  </select>{gaussianPreoptimizationMethodIsCustom && <input
                    aria-label={text("自定义初步优化方法", "Custom preoptimization method")}
                    value={gaussianOptions.preoptimizationMethod ?? ""}
                    onChange={(event) => setGaussianOptions((current) => ({ ...current, preoptimizationMethod: event.target.value }))}
                  />}</label>
                  <label className={gaussianPreoptimizationBasisIsCustom ? "gaussian-preset-custom gaussian-stage-field" : "gaussian-stage-field"}><span>{text("初步优化基组", "Preoptimization basis")}</span><select
                    value={gaussianPreoptimizationBasisIsCustom ? customGaussianOption : gaussianOptions.preoptimizationBasis}
                    onChange={(event) => setGaussianOptions((current) => ({ ...current, preoptimizationBasis: event.target.value === customGaussianOption ? "" : event.target.value }))}
                  >
                    {gaussianBasisGroups.map((group) => <optgroup key={`pre-${group.en}`} label={text(group.zh, group.en)}>
                      {group.options.map((basis) => <option key={`pre-${basis}`} value={basis}>{basis}</option>)}
                    </optgroup>)}
                    <option value={customGaussianOption}>{text("自定义…", "Custom…")}</option>
                  </select>{gaussianPreoptimizationBasisIsCustom && <input
                    aria-label={text("自定义初步优化基组", "Custom preoptimization basis")}
                    value={gaussianOptions.preoptimizationBasis ?? ""}
                    onChange={(event) => setGaussianOptions((current) => ({ ...current, preoptimizationBasis: event.target.value }))}
                  />}</label>
                </>}
                <label><span>{text("任务类型", "Calculation")}</span><select value={gaussianOptions.calculation} onChange={(event) => setGaussianOptions((current) => ({ ...current, calculation: event.target.value as GaussianCalculation }))}>
                  <option value="sp">{text("单点能", "Single point")}</option>
                  <option value="opt">{text("几何优化", "Optimization")}</option>
                  <option value="freq">{text("频率", "Frequency")}</option>
                  <option value="opt-freq">{text("优化 + 频率", "Optimization + frequency")}</option>
                  <option value="td">TD-DFT</option>
                </select></label>
                <label className={gaussianMethodIsCustom ? "gaussian-preset-custom" : undefined}><span>{text("理论方法", "Theoretical method")}</span><select
                  value={gaussianMethodIsCustom ? customGaussianOption : gaussianOptions.method}
                  onChange={(event) => setGaussianOptions((current) => ({
                    ...current,
                    method: event.target.value === customGaussianOption ? "" : event.target.value,
                  }))}
                >
                  {gaussianMethodGroups.map((group) => <optgroup key={group.en} label={text(group.zh, group.en)}>
                    {group.options.map((method) => <option key={method} value={method}>{method}</option>)}
                  </optgroup>)}
                  <option value={customGaussianOption}>{text("自定义…", "Custom…")}</option>
                </select>{gaussianMethodIsCustom && <input
                  aria-label={text("自定义理论方法", "Custom theoretical method")}
                  placeholder={text("输入 Gaussian 方法关键字", "Enter a Gaussian method keyword")}
                  value={gaussianOptions.method}
                  onChange={(event) => setGaussianOptions((current) => ({ ...current, method: event.target.value }))}
                />}</label>
                <label className={gaussianBasisIsCustom ? "gaussian-preset-custom" : undefined}><span>{text("基组", "Basis set")}</span><select
                  value={gaussianBasisIsCustom ? customGaussianOption : gaussianOptions.basis}
                  onChange={(event) => setGaussianOptions((current) => ({
                    ...current,
                    basis: event.target.value === customGaussianOption ? "" : event.target.value,
                  }))}
                >
                  {gaussianBasisGroups.map((group) => <optgroup key={group.en} label={text(group.zh, group.en)}>
                    {group.options.map((basis) => <option key={basis} value={basis}>{basis}</option>)}
                  </optgroup>)}
                  <option value={customGaussianOption}>{text("自定义…", "Custom…")}</option>
                </select>{gaussianBasisIsCustom && <input
                  aria-label={text("自定义基组", "Custom basis set")}
                  placeholder={text("输入 Gaussian 基组关键字", "Enter a Gaussian basis-set keyword")}
                  value={gaussianOptions.basis}
                  onChange={(event) => setGaussianOptions((current) => ({ ...current, basis: event.target.value }))}
                />}</label>
                <label><span>{text("溶剂（SMD，可空）", "Solvent (SMD, optional)")}</span><input value={gaussianOptions.solvent} placeholder={text("例如 Water", "e.g. Water")} onChange={(event) => setGaussianOptions((current) => ({ ...current, solvent: event.target.value }))} /></label>
                <label><span>{text("电荷", "Charge")}</span><input type="number" step="1" value={gaussianOptions.charge} onChange={(event) => setGaussianOptions((current) => ({ ...current, charge: Number(event.target.value) || 0 }))} /></label>
                <label><span>{text("自旋多重度", "Multiplicity")}</span><input type="number" min="1" step="1" value={gaussianOptions.multiplicity} onChange={(event) => setGaussianOptions((current) => ({ ...current, multiplicity: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} /></label>
                <label><span>{text("内存（GB）", "Memory (GB)")}</span><input type="number" min="1" step="1" value={gaussianOptions.memoryGB} onChange={(event) => setGaussianOptions((current) => ({ ...current, memoryGB: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                <label><span>{text("处理器核心数", "Processor cores")}</span><input type="number" min="1" step="1" value={gaussianOptions.processors} onChange={(event) => setGaussianOptions((current) => ({ ...current, processors: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} /></label>
                <label><span>{text("检查点文件名", "Checkpoint name")}</span><input value={gaussianOptions.checkpointName} onChange={(event) => setGaussianOptions((current) => ({ ...current, checkpointName: event.target.value }))} /></label>
                <label className="span-two"><span>{text("附加 route 关键词（可空）", "Additional route keywords (optional)")}</span><input value={gaussianOptions.routeExtras} placeholder="Pop=Full EmpiricalDispersion=GD3BJ" onChange={(event) => setGaussianOptions((current) => ({ ...current, routeExtras: event.target.value }))} /></label>
              </div>
            </section>
            <section className="utility-section gaussian-input-preview">
              <div className="utility-section-head"><span>Gaussian input (.gjf)</span><small>{gaussianInput.split("\n").length} {text("行", "lines")}</small></div>
              <div className="gaussian-model-diagnostics" aria-label={text("Gaussian 模型预检", "Gaussian model validation")}>
                <span><small>{text("分子数", "Molecules")}</small><strong>{gaussianModel.diagnostics.moleculeCount}</strong></span>
                <span className={gaussianModel.diagnostics.fragmentCount !== gaussianModel.diagnostics.moleculeCount ? "problem" : ""}><small>{text("片段数", "Fragments")}</small><strong>{gaussianModel.diagnostics.fragmentCount}</strong></span>
                <span className={gaussianModel.diagnostics.isolatedAtomIndices.length ? "problem" : ""}><small>{text("孤立原子数", "Isolated atoms")}</small><strong>{gaussianModel.diagnostics.isolatedAtomIndices.length}</strong></span>
                <span className={gaussianModel.diagnostics.graphConsistent ? "ok" : "problem"}><small>{text("连接图", "Bond graph")}</small><strong>{gaussianModel.diagnostics.graphConsistent ? text("一致", "Matched") : text("不一致", "Mismatch")}</strong></span>
              </div>
              {!gaussianModel.diagnostics.graphConsistent && <div className="utility-warning gaussian-export-blocker"><strong>{text("已阻止加入队列：周期连接图与 Gaussian 笛卡尔连接图不一致", "Queueing blocked: the periodic and Gaussian Cartesian bond graphs do not match")}</strong><p>{text(
                `缺失键 ${gaussianModel.diagnostics.missingBondCount}；额外键 ${gaussianModel.diagnostics.extraBondCount}；异常片段 ${gaussianModel.diagnostics.abnormalFragmentCount}。`,
                `${gaussianModel.diagnostics.missingBondCount} missing bonds; ${gaussianModel.diagnostics.extraBondCount} extra bonds; ${gaussianModel.diagnostics.abnormalFragmentCount} abnormal fragments.`,
              )}</p></div>}
              {gaussianModel.diagnostics.isolatedLabels.length > 0 && <div className="utility-warning gaussian-export-blocker"><strong>{text("检测到孤立原子", "Isolated atoms detected")}</strong><p>{gaussianModel.diagnostics.isolatedLabels.join(", ")}</p></div>}
              {gaussianModel.diagnostics.graphConsistent && gaussianModel.diagnostics.blockingIssues.length === 0 && <div className="gaussian-export-ready"><i>✓</i><span>{text("周期边界已重拼，连接图检查通过。", "Periodic fragments reconnected; bond-graph validation passed.")}</span></div>}
              <textarea readOnly spellCheck={false} value={gaussianInput} aria-label="Gaussian input preview" />
              <div className="gaussian-actions">
                <button type="button" className="primary" disabled={gaussianModel.diagnostics.blockingIssues.length > 0} onClick={createGaussianJob}>{text("加入本地队列", "Add to local queue")}</button>
                <button type="button" onClick={() => downloadTextFile(`${gaussianOptions.checkpointName || "symviz-job"}.gjf`, gaussianInput)}>{text("下载 .gjf", "Download .gjf")}</button>
              </div>
            </section>
            <details className="utility-help">
              <summary>？ {text("模型与计算边界", "Model and calculation boundaries")}</summary>
              <p>{text("Gaussian 是非周期分子程序。选用“当前晶胞全部原子”时，晶胞边界会成为有限簇边界，并不等同于周期固体计算。计算前请核对电荷、多重度、末端原子和无序构象；SymViz 不会替用户猜测这些化学条件。", "Gaussian is a non-periodic molecular program. “All generated atoms” creates a finite cluster at the cell boundary and is not a periodic-solid calculation. Check charge, multiplicity, terminal atoms, and disorder conformers before running; SymViz does not infer these chemical conditions.")}</p>
            </details>
          </>}

          {quantumSubview === "queue" && <>
            {desktopStatus ? <section className="utility-section bridge-card desktop-gaussian-card">
              <div className="utility-section-head"><span>{text("SymViz 桌面版 · Gaussian 16", "SymViz Desktop · Gaussian 16")}</span><small className={desktopStatus.available ? "bridge-online" : "bridge-offline"}>{desktopStatus.available ? text("可直接运行", "Ready") : text("未检测到", "Not detected")}</small></div>
              <div className="desktop-gaussian-status">
                <span><small>{text("Gaussian 安装目录", "Gaussian installation")}</small><code>{desktopStatus.gaussianRoot || text("尚未选择", "Not selected")}</code></span>
                <span><small>{text("任务保存目录", "Job folder")}</small><code>{desktopStatus.workRoot}</code></span>
              </div>
              <div className="desktop-binary-status">
                {(["g16", "formchk", "cubegen"] as const).map((binary) => <span key={binary} className={desktopStatus.binaries[binary]?.available ? "available" : "missing"}><i />{binary}.exe</span>)}
              </div>
              <div className="gaussian-actions">
                <button type="button" onClick={() => void checkGaussianBridge()}>{text("重新检测", "Detect again")}</button>
                <button type="button" onClick={() => void chooseDesktopGaussianRoot()}>{text("选择 Gaussian 文件夹…", "Choose Gaussian folder…")}</button>
                <button type="button" onClick={() => void refreshGaussianJobs()}>{text("刷新任务", "Refresh jobs")}</button>
              </div>
              <details className="utility-help">
                <summary>？ {text("桌面版如何运行 Gaussian", "How desktop Gaussian integration works")}</summary>
                <p>{text("SymViz 桌面版直接调用本机 g16.exe，不需要 PowerShell、地址或访问令牌。输入、输出、检查点和 Cube 文件只保存在上方任务目录。关闭窗口后，已完成任务仍会保留；正在运行的任务会被标记为中断。", "SymViz Desktop calls the local g16.exe directly, without PowerShell, an address, or an access token. Inputs, outputs, checkpoints, and Cube files stay in the job folder above. Completed jobs remain after the app closes; running jobs are marked as interrupted.")}</p>
              </details>
            </section> : <section className="utility-section bridge-card">
              <div className="utility-section-head"><span>{text("本机 Gaussian 16 桥接器", "Local Gaussian 16 bridge")}</span><small className={gaussianBridgeHealth?.available ? "bridge-online" : "bridge-offline"}>{gaussianBridgeHealth?.available ? text("已连接", "Connected") : text("未连接", "Not connected")}</small></div>
              <div className="bridge-fields">
                <label><span>URL</span><input value={gaussianBridgeUrl} onChange={(event) => setGaussianBridgeUrl(event.target.value)} /></label>
                <label><span>{text("访问令牌", "Access token")}</span><input type="password" autoComplete="off" value={gaussianBridgeToken} onChange={(event) => setGaussianBridgeToken(event.target.value)} placeholder={text("粘贴终端显示的令牌", "Paste the token shown in the terminal")} /></label>
              </div>
              <div className="gaussian-actions">
                <button type="button" onClick={() => void checkGaussianBridge()}>{text("检查连接", "Check connection")}</button>
                <button type="button" onClick={() => void refreshGaussianJobs()}>{text("刷新状态", "Refresh status")}</button>
              </div>
              {gaussianBridgeHealth?.workRoot && <code className="bridge-path">{gaussianBridgeHealth.workRoot}</code>}
              <details className="utility-help">
                <summary>？ {text("如何启动", "How to start")}</summary>
                <p>{text("网页模式仍需运行本机桥接器；如果希望完全免配置，请使用 SymViz 桌面版。", "Web mode still requires the local bridge. Use SymViz Desktop for a configuration-free Gaussian connection.")}</p>
              </details>
            </section>}
            <section className="utility-section">
              <div className="utility-section-head"><span>{text("任务队列", "Job queue")}</span><small>{runningGaussianJobs.length > 0
                ? text(`${runningGaussianJobs.length} 个运行中 · ${queuedGaussianJobs.length} 个等待`, `${runningGaussianJobs.length} running · ${queuedGaussianJobs.length} waiting`)
                : visibleGaussianJobs.length}</small></div>
              {visibleGaussianJobs.length === 0 ? <div className="utility-empty"><strong>{text("队列为空", "The queue is empty")}</strong><p>{text("先在“输入”页生成一个任务，或在“结果”页导入现有 .log 文件。", "Create a job on the Input page, or import an existing .log file on the Results page.")}</p></div>
                : <div className="gaussian-job-list">{visibleGaussianJobs.map((job) => <article key={job.id} className={`gaussian-job-card status-${job.status}`}>
                  <button type="button" className="job-main" onClick={() => { setSelectedGaussianJobId(job.id); setQuantumSubview(job.summary ? "results" : "queue"); }}>
                    <span><i />{job.name}</span>
                    <small>{new Date(job.createdAt).toLocaleString(language)}</small>
                    <b>{gaussianJobStatusText(job.status, language)}</b>
                  </button>
                  <div className="job-actions">
                    {job.input && <button type="button" onClick={() => downloadTextFile(`${job.name}.gjf`, job.input)}>{text("保存输入", "Save input")}</button>}
                    {job.status === "ready" && <button type="button" className="primary" disabled={desktopMode && !desktopStatus?.available} onClick={() => void submitGaussianJob(job)}>{text("本机运行", "Run locally")}</button>}
                    {desktopMode && job.status === "running" && job.remoteId && <button type="button" onClick={() => void cancelGaussianJob(job)}>{text("取消", "Cancel")}</button>}
                    {desktopMode && job.remoteId && <button type="button" onClick={() => void window.symvizDesktop?.revealJob(job.remoteId!)}>{text("打开目录", "Open folder")}</button>}
                    {job.summary && <button type="button" onClick={() => { setSelectedGaussianJobId(job.id); setQuantumSubview("results"); }}>{text("查看结果", "View results")}</button>}
                  </div>
                </article>)}</div>}
            </section>
            {desktopStatus && liveGaussianJob && <section className="utility-section gaussian-live-section">
              <div className="utility-section-head">
                <span className="gaussian-live-title"><i />{text("Gaussian 实时输出", "Live Gaussian output")}</span>
                <small>{visibleLiveGaussianOutput.updatedAt
                  ? text(`每秒刷新 · ${new Date(visibleLiveGaussianOutput.updatedAt).toLocaleTimeString(language)}`, `1 s refresh · ${new Date(visibleLiveGaussianOutput.updatedAt).toLocaleTimeString(language)}`)
                  : text("等待输出文件", "Waiting for output")}</small>
              </div>
              <div className="gaussian-live-meta">
                <strong>{liveGaussianJob.name}</strong>
                <span>{text("1 个 Gaussian 任务正在运行", "1 Gaussian job is running")}</span>
                {visibleLiveGaussianOutput.truncated && <span>{text("仅显示最新输出", "Showing the latest output")}</span>}
              </div>
              <pre ref={liveGaussianOutputRef} className="gaussian-live-output" role="log" aria-live="off" tabIndex={0}>{visibleLiveGaussianOutput.text || text("Gaussian 正在初始化，输出出现后会自动显示在这里……", "Gaussian is starting. Output will appear here automatically…")}</pre>
              <div className="gaussian-actions gaussian-live-actions">
                <button type="button" onClick={() => setFollowGaussianOutput((current) => !current)}>{followGaussianOutput ? text("暂停自动滚动", "Pause auto-scroll") : text("继续自动滚动", "Resume auto-scroll")}</button>
                <button type="button" disabled={!visibleLiveGaussianOutput.text} onClick={() => void navigator.clipboard.writeText(visibleLiveGaussianOutput.text)}>{text("复制输出", "Copy output")}</button>
                {liveGaussianJob.remoteId && <button type="button" onClick={() => void window.symvizDesktop?.revealJob(liveGaussianJob.remoteId!)}>{text("打开目录", "Open folder")}</button>}
              </div>
              <details className="utility-help gaussian-process-help">
                <summary>？ {text("为什么任务管理器里有多个 Gaussian 进程？", "Why are several Gaussian processes shown in Task Manager?")}</summary>
                <p>{text("一个 Gaussian 任务通常由 g16.exe 主控程序依次调用 Link 模块（例如进行 SCF 的 l502.exe）。它们属于同一任务，不是重复计算。SymViz 现在一次只运行一个任务，其余任务自动排队。", "A Gaussian job normally uses the g16.exe controller to invoke Link modules in sequence, such as l502.exe for SCF. They belong to one job and are not duplicate calculations. SymViz now runs one job at a time and queues the rest.")}</p>
              </details>
            </section>}
          </>}

          {quantumSubview === "results" && <>
            <div className="gaussian-actions result-import-actions">
              <button type="button" className="primary" onClick={() => gaussianOutputRef.current?.click()}>{text("导入 Gaussian .log / .out", "Import Gaussian .log / .out")}</button>
              {selectedGaussianJob?.output && <button type="button" onClick={() => downloadTextFile(`${selectedGaussianJob.name}.log`, selectedGaussianJob.output!)}>{text("保存输出", "Save output")}</button>}
              {selectedGaussianJob?.remoteId && selectedGaussianJob.status === "completed" && <>
                <select className="cube-property-select" value={cubeProperty} onChange={(event) => setCubeProperty(event.target.value as typeof cubeProperty)} aria-label={text("Cube 数据类型", "Cube property")}>
                  <option value="density">{text("电子密度", "Electron density")}</option>
                  <option value="esp">{text("静电势", "Electrostatic potential")}</option>
                  <option value="homo">HOMO</option>
                  <option value="lumo">LUMO</option>
                </select>
                <button type="button" onClick={() => void generateCubeForJob(selectedGaussianJob)}>{text("生成 Cube", "Generate Cube")}</button>
              </>}
            </div>
            {!selectedGaussianJob?.summary ? <div className="utility-empty"><strong>{text("尚无可解析的结果", "No parsed result yet")}</strong><p>{text("导入 Gaussian 输出，或刷新已完成的本地任务。", "Import a Gaussian output or refresh a completed local job.")}</p></div>
              : <section className="gaussian-results">
                <div className={`termination-banner ${selectedGaussianJob.summary.status}`}>
                  <i>{selectedGaussianJob.summary.normalTermination ? "✓" : selectedGaussianJob.summary.errorTermination ? "!" : "…"}</i>
                  <span><strong>{selectedGaussianJob.name}</strong><small>{selectedGaussianJob.summary.normalTermination
                    ? text("Gaussian 正常终止", "Gaussian normal termination")
                    : selectedGaussianJob.summary.errorTermination
                      ? text("Gaussian 错误终止", "Gaussian error termination")
                      : text("计算未结束或输出不完整", "Calculation unfinished or output incomplete")}</small></span>
                </div>
                <div className="quantum-result-grid">
                  <span>{text("电子能（Hartree）", "Electronic energy (Hartree)")}<strong>{selectedGaussianJob.summary.scfEnergyHartree?.toFixed(9) ?? "—"}</strong><small>{selectedGaussianJob.summary.methodLabel ?? "SCF"}</small></span>
                  <span>HOMO–LUMO gap (eV)<strong>{selectedGaussianJob.summary.gapEv?.toFixed(4) ?? "—"}</strong><small>{selectedGaussianJob.summary.homoHartree !== null && selectedGaussianJob.summary.lumoHartree !== null
                    ? `${selectedGaussianJob.summary.homoHartree.toFixed(4)} → ${selectedGaussianJob.summary.lumoHartree.toFixed(4)} Ha`
                    : "—"}</small></span>
                  <span>{text("偶极矩（Debye）", "Dipole moment (Debye)")}<strong>{selectedGaussianJob.summary.dipoleDebye?.toFixed(4) ?? "—"}</strong><small>{text("总量", "total")}</small></span>
                  <span>{text("热自由能（Hartree）", "Thermal free energy (Hartree)")}<strong>{selectedGaussianJob.summary.thermalFreeEnergyHartree?.toFixed(9) ?? "—"}</strong><small>{text("电子 + 热修正", "electronic + thermal")}</small></span>
                  <span>{text("零点修正（Hartree）", "Zero-point correction (Hartree)")}<strong>{selectedGaussianJob.summary.zeroPointCorrectionHartree?.toFixed(6) ?? "—"}</strong><small>ZPE</small></span>
                  <span>{text("虚频数", "Imaginary frequencies")}<strong>{selectedGaussianJob.summary.imaginaryFrequencyCount}</strong><small>{selectedGaussianJob.summary.frequenciesCm1.length} {text("个频率", "frequencies")}</small></span>
                </div>
                {selectedGaussianJob.summary.frequenciesCm1.length > 0 && <section className="utility-section frequency-list">
                  <div className="utility-section-head"><span>{text("振动频率（cm⁻¹）", "Vibrational frequencies (cm⁻¹)")}</span><small>{text("负值为虚频", "negative values are imaginary")}</small></div>
                  <div>{selectedGaussianJob.summary.frequenciesCm1.map((frequency, index) => <code key={`${frequency}-${index}`} className={frequency < 0 ? "imaginary" : ""}>{frequency.toFixed(2)}</code>)}</div>
                </section>}
                {selectedGaussianJob.summary.errorMessage && <div className="utility-warning"><strong>{text("错误摘要", "Error summary")}</strong><p>{selectedGaussianJob.summary.errorMessage}</p></div>}
              </section>}
            <details className="utility-help">
              <summary>？ {text("结果解析范围", "What is parsed")}</summary>
              <p>{text("当前读取最终 SCF 能、相关能、热化学校正、HOMO/LUMO、偶极矩、频率和终止状态。它是快速审阅器，不替代 GaussView、Multiwfn 或对原始输出的人工检查。", "The current parser reads final SCF and correlated energies, thermochemical corrections, HOMO/LUMO values, dipole moment, frequencies, and termination status. It is a rapid reviewer, not a replacement for GaussView, Multiwfn, or inspection of the raw output.")}</p>
            </details>
          </>}

          {quantumSubview === "multiwfn" && <>
            {!desktopMode ? <div className="utility-warning"><strong>{text("仅桌面版可用", "Desktop only")}</strong><p>{text("Multiwfn 是本机可执行程序。请从 SymViz 桌面版打开此工作台；网页版本不会上传或执行波函数文件。", "Multiwfn is a local executable. Open this workbench in SymViz Desktop; the web version neither uploads nor executes wavefunction files.")}</p></div> : <>
              <section className="utility-section multiwfn-runtime-card">
                <div className="utility-section-head"><span>Multiwfn {multiwfnStatus?.multiwfnVersion || ""}</span><small className={multiwfnStatus?.available ? "bridge-online" : "bridge-offline"}>{multiwfnStatus?.available ? text("已检测，可运行", "Detected and ready") : text("未检测", "Not detected")}</small></div>
                <div className="desktop-gaussian-status">
                  <span><small>{text("程序目录", "Program folder")}</small><code>{multiwfnStatus?.multiwfnRoot || text("尚未选择", "Not selected")}</code></span>
                  <span><small>{text("任务目录", "Job folder")}</small><code>{multiwfnStatus?.workRoot || "—"}</code></span>
                </div>
                <div className="desktop-binary-status">
                  <span className={multiwfnStatus?.binaries.multiwfn?.available ? "available" : "missing"}><i />Multiwfn.exe</span>
                  <span className={multiwfnStatus?.binaries.settings?.available ? "available" : "missing"}><i />settings.ini</span>
                </div>
                <button type="button" className="multiwfn-visualizer-launch" onClick={() => void window.symvizDesktop?.openMultiwfnVisualizer()}>
                  <span aria-hidden="true">◈</span>
                  <span><b>{text("打开独立三维窗口", "Open separate 3D window")}</b><small>{text("查看 Cube、电子密度与 HOMO/LUMO 等值面", "View Cube, density and HOMO/LUMO isosurfaces")}</small></span>
                  <em aria-hidden="true">↗</em>
                </button>
                <div className="gaussian-actions">
                  <button type="button" onClick={() => void refreshMultiwfnJobs()}>{text("重新检测 / 刷新", "Detect / refresh")}</button>
                  <button type="button" onClick={() => void chooseMultiwfnRoot()}>{text("选择 Multiwfn 文件夹…", "Choose Multiwfn folder…")}</button>
                </div>
              </section>

              <section className="utility-section multiwfn-builder">
                <div className="utility-section-head"><span>{text("新建分析", "New analysis")}</span><small>{text("一个任务一次只运行一个流程", "One workflow per job")}</small></div>
                <label className="gaussian-field full"><span>{text("波函数 / 结构输入", "Wavefunction / structure input")}</span><button type="button" className="multiwfn-file-picker" onClick={() => void chooseMultiwfnInput()}><b>{multiwfnInput?.name || text("选择 .fchk / .wfn / .wfx / .mwfn…", "Choose .fchk / .wfn / .wfx / .mwfn…")}</b><small>{multiwfnInput?.path || text("也支持 .molden、Gaussian 输出、PDB、MOL2、XYZ 和 Cube", "Also supports .molden, Gaussian output, PDB, MOL2, XYZ and Cube")}</small></button></label>
                <div className="gaussian-form-grid">
                  <label><span>{text("任务名称", "Job name")}</span><input value={multiwfnJobName} onChange={(event) => setMultiwfnJobName(event.target.value)} /></label>
                  <label><span>{text("分析流程", "Analysis workflow")}</span><select value={multiwfnTaskId} onChange={(event) => setMultiwfnTaskId(event.target.value)}>
                    {(multiwfnStatus?.templates ?? [
                      { id: "summary", label: "Wavefunction and structure summary", description: "" },
                      { id: "aim", label: "AIM topology and critical points", description: "" },
                      { id: "esp-extrema", label: "ESP grid extrema", description: "" },
                      { id: "resp", label: "RESP atomic charges", description: "" },
                      { id: "frontier-orbitals", label: "HOMO-LUMO energy levels", description: "" },
                      { id: "homo-cube", label: "HOMO orbital Cube", description: "" },
                      { id: "lumo-cube", label: "LUMO orbital Cube", description: "" },
                      { id: "density-cube", label: "Electron-density Cube", description: "" },
                      { id: "esp-cube", label: "Electrostatic-potential Cube", description: "" },
                      { id: "custom", label: "Custom command script", description: "" },
                    ]).map((template) => <option key={template.id} value={template.id}>{multiwfnTemplateLabel(template.id, template.label)}</option>)}
                  </select></label>
                </div>
                <p className="multiwfn-template-description">{multiwfnPresetDescriptions[multiwfnTaskId as keyof typeof multiwfnPresetDescriptions]
                  ? text(multiwfnPresetDescriptions[multiwfnTaskId as keyof typeof multiwfnPresetDescriptions].zh, multiwfnPresetDescriptions[multiwfnTaskId as keyof typeof multiwfnPresetDescriptions].en)
                  : ""}</p>
                {multiwfnTaskId === "custom" && <label className="gaussian-field full"><span>{text("Multiwfn 菜单回答（每行一项）", "Multiwfn menu responses (one per line)")}</span><textarea className="multiwfn-script-editor" spellCheck={false} value={multiwfnScript} onChange={(event) => setMultiwfnScript(event.target.value)} placeholder={text("例如：\n5\n1\n...\nq", "Example:\n5\n1\n...\nq")} /></label>}
                <div className="gaussian-actions"><button type="button" className="primary" disabled={!multiwfnStatus?.available || !multiwfnInput || (multiwfnTaskId === "custom" && !multiwfnScript.trim())} onClick={() => void submitMultiwfnJob()}>{text("加入 Multiwfn 本地队列", "Add to local Multiwfn queue")}</button></div>
                <details className="utility-help"><summary>？ {text("为什么采用预设 + 自定义脚本", "Why presets plus custom scripts")}</summary><p>{text("Multiwfn 2026.7.15 包含数百个多层菜单。预设只采用当前随附版本的官方批处理序列；自定义脚本把每一行原样发送给 Multiwfn，可使用手册中的任何功能，而不把旧版菜单编号误当成当前版本。", "Multiwfn 2026.7.15 contains hundreds of nested menu paths. Presets use official batch sequences bundled with this exact version. A custom script sends each line directly to Multiwfn, giving access to any manual workflow without assuming that old menu numbers are still valid.")}</p></details>
              </section>

              <section className="utility-section">
                <div className="utility-section-head"><span>{text("Multiwfn 任务", "Multiwfn jobs")}</span><small>{multiwfnJobs.length}</small></div>
                {multiwfnJobs.length === 0 ? <div className="utility-empty"><strong>{text("尚无任务", "No jobs yet")}</strong><p>{text("选择波函数文件和分析流程后加入队列。", "Choose a wavefunction file and workflow, then add it to the queue.")}</p></div> : <div className="gaussian-job-list">{multiwfnJobs.map((job) => <article key={job.id} className={`gaussian-job-card status-${job.status} ${selectedMultiwfnJob?.id === job.id ? "selected" : ""}`}>
                  <button type="button" className="job-main" onClick={() => void selectMultiwfnJob(job)}><span><i />{job.name}</span><small>{job.inputName} · {new Date(job.submittedAt).toLocaleString(language)}</small><b>{gaussianJobStatusText(job.status, language)}</b></button>
                  <div className="job-actions">
                    {job.status === "running" && <button type="button" onClick={() => void cancelMultiwfnJob(job)}>{text("取消", "Cancel")}</button>}
                    {job.status === "completed" && !job.artifacts.some((artifact) => /^density\.cub(e)?$/i.test(artifact.name)) && <button type="button" onClick={() => void submitMultiwfnCubeFromJob(job, "density-cube")}>{text("密度 Cube", "Density Cube")}</button>}
                    {job.status === "completed" && !job.artifacts.some((artifact) => /^totesp\.cub(e)?$/i.test(artifact.name)) && <button type="button" onClick={() => void submitMultiwfnCubeFromJob(job, "esp-cube")}>{text("ESP Cube", "ESP Cube")}</button>}
                    {job.status === "completed" && /\.(?:fch|fchk|wfn)$/i.test(job.inputName) && !job.artifacts.some((artifact) => /^HOMO\.cub(e)?$/i.test(artifact.name)) && <button type="button" onClick={() => void submitMultiwfnCubeFromJob(job, "homo-cube")}>HOMO Cube</button>}
                    {job.status === "completed" && /\.(?:fch|fchk|wfn)$/i.test(job.inputName) && !job.artifacts.some((artifact) => /^LUMO\.cub(e)?$/i.test(artifact.name)) && <button type="button" onClick={() => void submitMultiwfnCubeFromJob(job, "lumo-cube")}>LUMO Cube</button>}
                    <button type="button" onClick={() => void window.symvizDesktop?.revealMultiwfnJob(job.id)}>{text("打开目录", "Open folder")}</button>
                  </div>
                  {job.frontier && <div className="multiwfn-frontier-summary">
                    <span><small>HOMO · MO {job.frontier.homo.index}</small><strong>{job.frontier.homo.energyEv.toFixed(4)} eV</strong></span>
                    <span><small>LUMO{job.frontier.lumo ? ` · MO ${job.frontier.lumo.index}` : ""}</small><strong>{job.frontier.lumo ? `${job.frontier.lumo.energyEv.toFixed(4)} eV` : text("输入中缺失", "Not in input")}</strong></span>
                    <span><small>{text("能隙", "Gap")}</small><strong>{job.frontier.gapEv === null ? "—" : `${job.frontier.gapEv.toFixed(4)} eV`}</strong></span>
                    {job.frontier.note && <p>{text(job.frontier.note === "Standard WFN files commonly contain occupied orbitals only; no LUMO is present. Export an FCHK/FCH file containing virtual orbitals to generate the LUMO." ? "此 WFN 只含占据轨道，因此不能从中获得 LUMO；请从 Gaussian 导出包含虚轨道的 FCHK/FCH。" : job.frontier.note, job.frontier.note)}</p>}
                  </div>}
                  {job.artifacts.length > 0 && <div className="multiwfn-artifacts">{job.artifacts.map((artifact) => <button type="button" key={artifact.name} className={artifact.kind} onClick={() => artifact.kind === "cube" ? void window.symvizDesktop?.openMultiwfnVisualizer(job.id, artifact.name) : void window.symvizDesktop?.revealMultiwfnJob(job.id)}><i />{artifact.name}{artifact.kind === "cube" && <small>3D</small>}</button>)}</div>}
                  {job.taskId === "resp" && job.status === "completed" && !job.artifacts.some((artifact) => artifact.kind === "cube") && <p className="multiwfn-no-cube-note">{text("RESP 已完成；.chg 是正常结果。若要三维观察，请点击“密度 Cube”或“ESP Cube”。", "RESP completed; .chg is the expected result. Choose Density Cube or ESP Cube for 3D visualization.")}</p>}
                </article>)}</div>}
              </section>

              {(runningMultiwfnJob || selectedMultiwfnJob) && <section className="utility-section gaussian-live-section multiwfn-output-section">
                <div className="utility-section-head"><span className={runningMultiwfnJob ? "gaussian-live-title" : ""}>{runningMultiwfnJob && <i />}{runningMultiwfnJob ? text("Multiwfn 实时输出", "Live Multiwfn output") : text("Multiwfn 输出", "Multiwfn output")}</span><small>{(runningMultiwfnJob ? visibleLiveMultiwfnOutput.updatedAt : selectedMultiwfnJob?.completedAt) ? new Date((runningMultiwfnJob ? visibleLiveMultiwfnOutput.updatedAt : selectedMultiwfnJob?.completedAt)!).toLocaleTimeString(language) : text("等待输出", "Waiting for output")}</small></div>
                <pre ref={liveMultiwfnOutputRef} className="gaussian-live-output" role="log" tabIndex={0}>{runningMultiwfnJob ? visibleLiveMultiwfnOutput.text || text("Multiwfn 正在读取输入……", "Multiwfn is reading the input…") : selectedMultiwfnOutput || text("点击上方任务以载入完整输出。", "Select the job above to load its full output.")}</pre>
                <div className="gaussian-actions gaussian-live-actions"><button type="button" onClick={() => setFollowMultiwfnOutput((current) => !current)}>{followMultiwfnOutput ? text("暂停自动滚动", "Pause auto-scroll") : text("继续自动滚动", "Resume auto-scroll")}</button><button type="button" disabled={!(runningMultiwfnJob ? visibleLiveMultiwfnOutput.text : selectedMultiwfnOutput)} onClick={() => void navigator.clipboard.writeText(runningMultiwfnJob ? visibleLiveMultiwfnOutput.text : selectedMultiwfnOutput)}>{text("复制输出", "Copy output")}</button></div>
              </section>}

              <details className="utility-help multiwfn-citation"><summary>？ {text("Multiwfn 引用与适用范围", "Multiwfn citation and scope")}</summary><p>{text("若研究中使用 Multiwfn，程序许可要求在正文中引用：T. Lu and F. Chen, J. Comput. Chem. 33, 580–592 (2012)，以及 T. Lu, J. Chem. Phys. 161, 082503 (2024)。SymViz 仅负责受控调用和可视化，不改变 Multiwfn 的算法或结果。", "If Multiwfn is used in research, its license requires citation in the main text of T. Lu and F. Chen, J. Comput. Chem. 33, 580–592 (2012), and T. Lu, J. Chem. Phys. 161, 082503 (2024). SymViz provides controlled execution and visualization without changing Multiwfn algorithms or results.")}</p></details>
            </>}
          </>}

          {quantumSubview === "cube" && <>
            <div className="gaussian-actions result-import-actions">
              <button type="button" className="primary" onClick={() => cubeInputRef.current?.click()}>{text("打开 .cube / .cub", "Open .cube / .cub")}</button>
              {cubeFileName && <span className="cube-file-name">{cubeFileName}</span>}
            </div>
            {!cube ? <div className="utility-empty cube-empty"><strong>{text("导入 Gaussian Cube 文件", "Import a Gaussian Cube file")}</strong><p>{text("支持电子密度、静电势与分子轨道网格。分子轨道可同时显示正、负相位。", "Electron-density, electrostatic-potential, and molecular-orbital grids are supported. Molecular orbitals can show positive and negative phases together.")}</p></div>
              : <>
                <section className="utility-section cube-controls">
                  <div className="utility-section-head"><span>{text("等值面", "Isosurface")}</span><small>{cube.dimensions.join(" × ")} grid</small></div>
                  <label className="cube-isovalue-control">
                    <span>{text("等值（原子单位）", "Isovalue (atomic units)")}<output>{cubeIsovalue.toExponential(3)}</output></span>
                    <input
                      type="range"
                      min={activeCubeIsovalueRange?.minimum ?? 1e-8}
                      max={activeCubeIsovalueRange?.maximum ?? 1}
                      step={activeCubeIsovalueRange?.step ?? 0.001}
                      value={cubeIsovalue}
                      onChange={(event) => setCubeIsovalue(Number(event.target.value))}
                    />
                  </label>
                  <div className="cube-phase-switch">
                    <label title={text("使用完整网格重建，并以同色细边消除三角面接缝；不会移动或平滑标量数据本身", "Rebuild from the full grid and suppress triangle seams without moving the underlying scalar surface")}><input type="checkbox" checked={cubeSmoothSurface} onChange={(event) => setCubeSmoothSurface(event.target.checked)} />{text("平滑表面", "Smooth surface")}</label>
                    <label><input type="checkbox" checked={cubeBonds} onChange={(event) => setCubeBonds(event.target.checked)} />{text("化学键", "Bonds")}</label>
                    <label title={activeCubePhases && !activeCubePhases.positive ? text("当前 Cube 数据没有正值", "This Cube grid contains no positive values") : undefined}><input type="checkbox" checked={cubePositive} disabled={activeCubePhases ? !activeCubePhases.positive : true} onChange={(event) => setCubePositive(event.target.checked)} /><i className="positive" />{text("正相位", "Positive phase")}</label>
                    <label title={activeCubePhases && !activeCubePhases.negative ? text("当前 Cube 数据没有负值", "This Cube grid contains no negative values") : undefined}><input type="checkbox" checked={cubeNegative} disabled={activeCubePhases ? !activeCubePhases.negative : true} onChange={(event) => setCubeNegative(event.target.checked)} /><i className="negative" />{text("负相位", "Negative phase")}</label>
                  </div>
                </section>
                <CubeSurfaceCanvas cube={cube} isovalue={cubeIsovalue} showPositive={cubePositive} showNegative={cubeNegative} showBonds={cubeBonds} smoothSurface={cubeSmoothSurface} language={language} />
                <div className="cube-stats">
                  <span>min<strong>{cube.minimum.toExponential(4)}</strong></span>
                  <span>max<strong>{cube.maximum.toExponential(4)}</strong></span>
                  <span>RMS<strong>{cube.rms.toExponential(4)}</strong></span>
                  <span>{text("原子数", "Atoms")}<strong>{cube.atoms.length}</strong></span>
                </div>
              </>}
            <details className="utility-help">
              <summary>？ {text("Cube 数据说明", "About Cube data")}</summary>
              <p>{text("等值面来自网格线性插值。开启“平滑表面”时优先使用完整网格并隐藏三角边线，不移动等值面顶点；关闭后使用较快的抽样网格调试模式。轨道的正负颜色表示波函数相位，不表示正负电荷。", "The isosurface uses linear interpolation on the grid. Smooth surface prioritizes the full grid and suppresses triangle edges without moving isosurface vertices; disabling it uses the faster sampled diagnostic mode. Positive and negative orbital colors indicate wavefunction phase, not charge.")}</p>
            </details>
          </>}
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
          <input type="range" min="10" max="23" step="1" value={axisAppearance.fontSize} onChange={(event) => setAxisAppearance((current) => ({ ...current, fontSize: Number(event.target.value) }))} />
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
      {structure.warnings.length > 0 && <div className="warning-ribbon">{english ? "Structure warning: symmetry or unit-cell metadata may be incomplete." : structure.warnings[0]}</div>}
    </main>
  );
}
