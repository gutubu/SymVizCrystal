import { type CrystalStructure, type Vec3 } from "./crystal-data.ts";

export type QuantumEspressoCalculation = "scf" | "relax" | "vc-relax" | "md" | "vc-md";
export type QuantumEspressoOccupations = "fixed" | "smearing";
export type QuantumEspressoDispersion = "none" | "d3-bj";
export type QuantumEspressoFunctional = "auto" | "PZ" | "PBE" | "PBEsol" | "PW91" | "BLYP" | "SCAN" | "PBE0" | "HSE" | "B3LYP";
export type QuantumEspressoBasisPreset = "screening" | "sssp-efficiency" | "conservative" | "custom";
export type QuantumEspressoSystemClass = "molecular-crystal" | "inorganic-solid" | "metallic-candidate" | "mixed-solid";

export type QuantumEspressoMethodInfo = {
  id: QuantumEspressoFunctional;
  family: "UPF" | "LDA" | "GGA" | "meta-GGA" | "hybrid";
  label: string;
  summaryZh: string;
  summaryEn: string;
  cautionZh: string;
  cautionEn: string;
};

export type QuantumEspressoBasisInfo = {
  id: QuantumEspressoBasisPreset;
  labelZh: string;
  labelEn: string;
  summaryZh: string;
  summaryEn: string;
};

export type QuantumEspressoRecommendation = {
  systemClass: QuantumEspressoSystemClass;
  confidence: "high" | "medium" | "low";
  calculation: QuantumEspressoCalculation;
  inputDft: QuantumEspressoFunctional;
  dispersion: QuantumEspressoDispersion;
  occupations: QuantumEspressoOccupations;
  smearing: QuantumEspressoInputOptions["smearing"];
  degaussRy: number;
  basisPreset: Exclude<QuantumEspressoBasisPreset, "custom">;
  ecutwfcRy: number;
  ecutrhoRy: number;
  kPoints: [number, number, number];
  kPointShift: [0 | 1, 0 | 1, 0 | 1];
  reasonsZh: string[];
  reasonsEn: string[];
  warningsZh: string[];
  warningsEn: string[];
};

export type QuantumEspressoInputOptions = {
  title: string;
  prefix: string;
  calculation: QuantumEspressoCalculation;
  inputDft: QuantumEspressoFunctional;
  dispersion: QuantumEspressoDispersion;
  occupations: QuantumEspressoOccupations;
  smearing: "gaussian" | "mp" | "mv" | "fd";
  degaussRy: number;
  ecutwfcRy: number;
  ecutrhoRy: number;
  kPoints: [number, number, number];
  kPointShift: [0 | 1, 0 | 1, 0 | 1];
  convThr: number;
  forceConvThr: number;
  pressureConvThr: number;
  mdSteps?: number;
  mdTimeStepAu?: number;
  temperatureK?: number;
  pseudopotentials: Record<string, string>;
};

export type QuantumEspressoDiagnostics = {
  atomCount: number;
  elementCount: number;
  elements: string[];
  partialOccupancyLabels: string[];
  missingPseudopotentials: string[];
  blockingIssues: string[];
  warnings: string[];
};

export type QuantumEspressoInput = {
  input: string;
  diagnostics: QuantumEspressoDiagnostics;
  requiredPseudopotentials: string[];
};

export type QuantumEspressoOutputSummary = {
  status: "completed" | "failed" | "incomplete";
  jobDone: boolean;
  convergenceReached: boolean;
  totalEnergyRy: number | null;
  totalEnergyEv: number | null;
  pressureKbar: number | null;
  totalForceRyBohr: number | null;
  maximumForceRyBohr: number | null;
  fermiEnergyEv: number | null;
  highestOccupiedEnergyEv: number | null;
  scfIterations: number | null;
  errorMessage: string | null;
};

export type QuantumEspressoKPointCandidate = {
  kPoints: [number, number, number];
  pointCount: number;
  targetSpacingInverseAngstrom: number;
};

export type QuantumEspressoCutoffCandidate = {
  ecutwfcRy: number;
  ecutrhoRy: number;
};

export const quantumEspressoMethodCatalog: QuantumEspressoMethodInfo[] = [
  { id: "auto", family: "UPF", label: "Auto / UPF", summaryZh: "不强制覆盖交换-相关泛函，直接采用赝势文件头记录的方法；最不容易造成泛函与赝势不一致。", summaryEn: "Do not override exchange-correlation; use the functional recorded in each UPF header. This minimizes functional/pseudopotential mismatch.", cautionZh: "仍需确认所有 UPF 来自同一泛函和兼容的赝势库。", cautionEn: "All UPFs must still use one compatible functional and pseudopotential library." },
  { id: "PZ", family: "LDA", label: "PZ-LDA", summaryZh: "Perdew–Zunger LDA；计算较稳健，但常高估结合、低估晶格常数。", summaryEn: "Perdew-Zunger LDA; robust, but often overbinds and underestimates lattice constants.", cautionZh: "只应配合 LDA/PZ 赝势。", cautionEn: "Use only with LDA/PZ pseudopotentials." },
  { id: "PBE", family: "GGA", label: "PBE", summaryZh: "通用 GGA，适合多数固体、表面和分子晶体的起点，也是 SSSP PBE 的标准选择。", summaryEn: "General-purpose GGA for many solids, surfaces, and molecular crystals; the standard choice for SSSP PBE.", cautionZh: "分子晶体和层状材料通常还需要色散修正。", cautionEn: "Molecular crystals and layered materials usually also need a dispersion correction." },
  { id: "PBEsol", family: "GGA", label: "PBEsol", summaryZh: "针对致密固体和平衡晶格常数修订的 GGA。", summaryEn: "A GGA revised for dense solids and equilibrium lattice constants.", cautionZh: "必须使用 PBEsol 赝势；不建议与普通 PBE UPF 混用。", cautionEn: "Requires PBEsol pseudopotentials; do not mix with ordinary PBE UPFs." },
  { id: "PW91", family: "GGA", label: "PW91", summaryZh: "较早的 GGA，主要用于复现实验室已有工作或历史文献。", summaryEn: "An older GGA, mainly useful for reproducing established or legacy work.", cautionZh: "新项目通常优先 PBE，并确保有匹配的 PW91 赝势。", cautionEn: "Prefer PBE for new work and ensure matching PW91 pseudopotentials." },
  { id: "BLYP", family: "GGA", label: "BLYP", summaryZh: "偏向分子化学的 GGA；在周期固体中通常不是首选。", summaryEn: "A molecule-oriented GGA that is less commonly the first choice for periodic solids.", cautionZh: "需要匹配 BLYP 赝势，并单独验证晶格和能量。", cautionEn: "Needs matching BLYP pseudopotentials and dedicated lattice/energy validation." },
  { id: "SCAN", family: "meta-GGA", label: "SCAN", summaryZh: "meta-GGA，可改善部分成键和结构性质，但数值设置更敏感。", summaryEn: "A meta-GGA that can improve some bonding and structural properties, with greater numerical sensitivity.", cautionZh: "需要兼容赝势、更密实空间网格，并先用半局域低成本设置预优化。", cautionEn: "Use compatible pseudopotentials, tighter real-space grids, and semilocal preoptimization." },
  { id: "PBE0", family: "hybrid", label: "PBE0", summaryZh: "全程混合泛函，常改善带隙与局域化，但周期平面波成本很高。", summaryEn: "A global hybrid that can improve gaps and localization, at high periodic plane-wave cost.", cautionZh: "只建议在已收敛的小体系上做最终计算。", cautionEn: "Reserve for final calculations on small, already-converged systems." },
  { id: "HSE", family: "hybrid", label: "HSE", summaryZh: "屏蔽混合泛函，常用于固体带隙；比 PBE 昂贵得多。", summaryEn: "A screened hybrid often used for solid-state band gaps; much more expensive than PBE.", cautionZh: "需要额外收敛精确交换 q 网格，且不适合当前电脑直接跑大体系。", cautionEn: "Requires exact-exchange q-mesh convergence and is unsuitable for large local jobs." },
  { id: "B3LYP", family: "hybrid", label: "B3LYP", summaryZh: "分子化学常用混合泛函；周期固体中使用较少且成本高。", summaryEn: "A common molecular hybrid, less frequently used and expensive for periodic solids.", cautionZh: "仅用于有明确文献依据且赝势匹配的工作。", cautionEn: "Use only with clear literature justification and matching pseudopotentials." },
];

export const quantumEspressoBasisCatalog: QuantumEspressoBasisInfo[] = [
  { id: "screening", labelZh: "快速预筛选", labelEn: "Fast screening", summaryZh: "以当前元素的 SSSP 建议值约 80% 为起点；只用于检查输入、占据和粗略结构，不能直接作为发表参数。", summaryEn: "Starts near 80% of the element-wise SSSP recommendation; for input, occupation, and rough-structure checks only, not production." },
  { id: "sssp-efficiency", labelZh: "SSSP Efficiency 起点", labelEn: "SSSP Efficiency starting point", summaryZh: "按晶胞中最严格元素选择 SSSP PBE Efficiency 建议的 ecutwfc/ecutrho；仍需对当前体系做收敛测试。", summaryEn: "Uses the strictest element-wise SSSP PBE Efficiency ecutwfc/ecutrho recommendation; convergence testing for the actual system remains required." },
  { id: "conservative", labelZh: "保守高精度起点", labelEn: "Conservative high-accuracy start", summaryZh: "在 SSSP Efficiency 起点上提高约 25%，适合生成最终收敛测试上界，但计算量明显更大。", summaryEn: "Raises the SSSP Efficiency starting point by about 25%; useful as an upper bound for final convergence tests, at substantially higher cost." },
  { id: "custom", labelZh: "自定义截断能", labelEn: "Custom cutoffs", summaryZh: "直接编辑波函数与电荷密度截断能；适合采用 UPF 文件或论文给出的专用推荐值。", summaryEn: "Edit wavefunction and charge-density cutoffs directly, for UPF-specific or literature-specific recommendations." },
];

const RY_TO_EV = 13.605693122994;

const atomicMasses: Record<string, number> = {
  H: 1.008, He: 4.002602, Li: 6.94, Be: 9.0121831, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998403163, Ne: 20.1797, Na: 22.98976928, Mg: 24.305, Al: 26.9815385, Si: 28.085,
  P: 30.973761998, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.0983, Ca: 40.078, Sc: 44.955908,
  Ti: 47.867, V: 50.9415, Cr: 51.9961, Mn: 54.938044, Fe: 55.845, Co: 58.933194, Ni: 58.6934,
  Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.630, As: 74.921595, Se: 78.971, Br: 79.904,
  Kr: 83.798, Rb: 85.4678, Sr: 87.62, Y: 88.90584, Zr: 91.224, Nb: 92.90637, Mo: 95.95,
  Ru: 101.07, Rh: 102.90550, Pd: 106.42, Ag: 107.8682, Cd: 112.414, In: 114.818, Sn: 118.710,
  Sb: 121.760, Te: 127.60, I: 126.90447, Xe: 131.293, Cs: 132.90545196, Ba: 137.327,
  La: 138.90547, Ce: 140.116, W: 183.84, Pt: 195.084, Au: 196.966569, Hg: 200.592, Pb: 207.2,
  Bi: 208.98040,
};

function safeFortranString(value: string) {
  return value.replace(/'/g, "''");
}

function safePrefix(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "symviz-qe";
}

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerPositive(value: number, fallback: number) {
  return Math.max(1, Math.round(finitePositive(value, fallback)));
}

function wrapFractional(value: number) {
  const wrapped = value - Math.floor(value);
  return Math.abs(wrapped - 1) < 1e-10 ? 0 : wrapped;
}

function formatNumber(value: number, digits = 10) {
  return Number(value.toFixed(digits)).toString();
}

function latticeVectors(cell: CrystalStructure["cell"]): [Vec3, Vec3, Vec3] {
  const alpha = cell.alpha * Math.PI / 180;
  const beta = cell.beta * Math.PI / 180;
  const gamma = cell.gamma * Math.PI / 180;
  const sinGamma = Math.sin(gamma);
  const ax: Vec3 = [cell.a, 0, 0];
  const bx: Vec3 = [cell.b * Math.cos(gamma), cell.b * sinGamma, 0];
  const cx = cell.c * Math.cos(beta);
  const cy = cell.c * (Math.cos(alpha) - Math.cos(beta) * Math.cos(gamma)) / Math.max(1e-12, sinGamma);
  const cz = Math.sqrt(Math.max(0, cell.c ** 2 - cx ** 2 - cy ** 2));
  return [ax, bx, [cx, cy, cz]];
}

function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function norm(vector: Vec3) {
  return Math.sqrt(dot(vector, vector));
}

function reciprocalVectorLengths(cell: CrystalStructure["cell"]): Vec3 {
  const [a, b, c] = latticeVectors(cell);
  const volume = Math.abs(dot(a, cross(b, c)));
  if (!Number.isFinite(volume) || volume < 1e-10) return [1, 1, 1];
  const scale = 2 * Math.PI / volume;
  return [norm(cross(b, c)) * scale, norm(cross(c, a)) * scale, norm(cross(a, b)) * scale];
}

/**
 * Builds an anisotropic sequence of Monkhorst-Pack meshes from reciprocal-vector lengths.
 * The sequence deliberately starts at Gamma and becomes monotonically denser; users still
 * need to confirm the final mesh against their requested energy/force/stress tolerance.
 */
export function suggestQuantumEspressoKPointMeshes(
  cell: CrystalStructure["cell"],
  maximumCandidates = 6,
): QuantumEspressoKPointCandidate[] {
  const reciprocalLengths = reciprocalVectorLengths(cell);
  const targetSpacings = [Number.POSITIVE_INFINITY, 0.60, 0.45, 0.35, 0.28, 0.22, 0.18, 0.15, 0.12];
  const candidates: QuantumEspressoKPointCandidate[] = [];
  const seen = new Set<string>();
  for (const spacing of targetSpacings) {
    const kPoints = (Number.isFinite(spacing)
      ? reciprocalLengths.map((length) => Math.max(1, Math.round(length / spacing)))
      : [1, 1, 1]) as [number, number, number];
    const key = kPoints.join("x");
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      kPoints,
      pointCount: kPoints[0] * kPoints[1] * kPoints[2],
      targetSpacingInverseAngstrom: Number.isFinite(spacing) ? spacing : 0,
    });
    if (candidates.length >= Math.max(2, Math.min(10, Math.round(maximumCandidates)))) break;
  }
  return candidates.sort((left, right) => left.pointCount - right.pointCount
    || left.kPoints[0] - right.kPoints[0]
    || left.kPoints[1] - right.kPoints[1]
    || left.kPoints[2] - right.kPoints[2]);
}

export function buildQuantumEspressoCutoffSeries(
  startRy: number,
  endRy: number,
  stepRy: number,
  densityMultiplier: number,
  maximumCandidates = 12,
): QuantumEspressoCutoffCandidate[] {
  const start = Math.max(1, Math.round(finitePositive(startRy, 30)));
  const end = Math.max(start, Math.round(finitePositive(endRy, start)));
  const step = Math.max(1, Math.round(finitePositive(stepRy, 10)));
  const dual = Math.max(4, finitePositive(densityMultiplier, 8));
  const limit = Math.max(2, Math.min(20, Math.round(maximumCandidates)));
  const candidates: QuantumEspressoCutoffCandidate[] = [];
  for (let ecutwfcRy = start; ecutwfcRy <= end + 1e-8 && candidates.length < limit; ecutwfcRy += step) {
    candidates.push({ ecutwfcRy, ecutrhoRy: Math.round(ecutwfcRy * dual * 1000) / 1000 });
  }
  if (candidates.at(-1)?.ecutwfcRy !== end && candidates.length < limit) {
    candidates.push({ ecutwfcRy: end, ecutrhoRy: Math.round(end * dual * 1000) / 1000 });
  }
  return candidates;
}

// SSSP PBE Efficiency v2.0 starting cutoffs (Ry). Values are deliberately
// kept element-specific: the strictest species controls the mixed-cell input.
// Elements not listed fall back to a conservative 60/480 Ry starting point.
const ssspEfficiencyCutoffs: Record<string, [number, number]> = {
  H: [30, 120], He: [50, 150], Li: [35, 140], Be: [30, 105], B: [30, 60], C: [30, 105], N: [35, 140], O: [45, 540], F: [45, 158], Ne: [70, 280],
  Na: [50, 150], Mg: [40, 160], Al: [30, 60], Si: [30, 150], P: [30, 90], S: [30, 90], Cl: [35, 210], Ar: [75, 300], K: [35, 105], Ca: [30, 105],
  Sc: [30, 135], Ti: [30, 180], V: [35, 140], Cr: [35, 175], Mn: [40, 160], Fe: [80, 400], Co: [55, 165], Ni: [65, 195], Cu: [55, 165], Zn: [45, 225],
  Ga: [30, 150], Ge: [40, 160], As: [30, 180], Se: [30, 120], Br: [30, 75], Kr: [65, 260], Rb: [30, 90], Sr: [30, 120], Y: [30, 150], Zr: [30, 90],
  Nb: [30, 90], Mo: [30, 60], Ru: [35, 70], Rh: [35, 122], Pd: [45, 135], Ag: [40, 160], Cd: [40, 80], In: [50, 150], Sn: [40, 140], Sb: [30, 120],
  Te: [30, 60], I: [30, 120], Xe: [30, 240], Cs: [30, 105], Ba: [30, 45], La: [55, 440], Ce: [35, 70], Hf: [30, 90], Ta: [30, 75], W: [30, 90],
  Pt: [35, 200], Au: [30, 105], Hg: [30, 120], Pb: [30, 75], Bi: [45, 180], U: [45, 180],
};

function roundUp(value: number, step = 5) {
  return Math.ceil(value / step) * step;
}

export function quantumEspressoCutoffsForPreset(
  elements: string[],
  preset: QuantumEspressoBasisPreset,
): QuantumEspressoCutoffCandidate {
  const pairs = elements.length ? elements.map((element) => ssspEfficiencyCutoffs[element] ?? [60, 480]) : [[60, 480]];
  const baseWfc = Math.max(...pairs.map(([wfc]) => wfc));
  const baseRho = Math.max(...pairs.map(([, rho]) => rho));
  if (preset === "screening") {
    const ecutwfcRy = Math.max(30, roundUp(baseWfc * 0.8));
    return { ecutwfcRy, ecutrhoRy: Math.max(roundUp(baseRho * 0.8, 10), ecutwfcRy * 4) };
  }
  if (preset === "conservative") {
    const ecutwfcRy = roundUp(baseWfc * 1.25);
    return { ecutwfcRy, ecutrhoRy: Math.max(roundUp(baseRho * 1.25, 10), ecutwfcRy * 4) };
  }
  return { ecutwfcRy: baseWfc, ecutrhoRy: Math.max(baseRho, baseWfc * 4) };
}

const metallicElements = new Set([
  "Li", "Be", "Na", "Mg", "Al", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Cs", "Ba", "La", "Ce", "Hf", "Ta", "W", "Pt", "Au", "Hg", "Pb", "Bi", "U",
]);
const openShellRiskElements = new Set(["V", "Cr", "Mn", "Fe", "Co", "Ni", "Mo", "Ru", "Rh", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "U", "Np", "Pu"]);
const heavyElements = new Set(["I", "Xe", "Cs", "Ba", "La", "Ce", "Hf", "Ta", "W", "Pt", "Au", "Hg", "Pb", "Bi", "U"]);

function classifyPeriodicSystem(structure: CrystalStructure) {
  const elements = [...new Set(structure.atoms.map((atom) => atom.element))];
  const atomCount = Math.max(1, structure.atoms.length);
  const metalCount = structure.atoms.filter((atom) => metallicElements.has(atom.element)).length;
  const carbonCount = structure.atoms.filter((atom) => atom.element === "C").length;
  const organicLike = elements.includes("C") && (
    elements.includes("H")
    || (carbonCount / atomCount >= 0.15 && metalCount / atomCount < 0.15 && elements.some((element) => ["N", "O", "S", "F", "Cl", "Br", "I"].includes(element)))
  );
  const metallicCandidate = metalCount / atomCount >= 0.65 && !elements.some((element) => ["O", "F", "Cl", "Br", "I", "N", "S"].includes(element));
  const systemClass: QuantumEspressoSystemClass = organicLike
    ? "molecular-crystal"
    : metallicCandidate
      ? "metallic-candidate"
      : metalCount > 0 && elements.some((element) => ["C", "N", "O", "S", "F", "Cl", "Br", "I"].includes(element))
        ? "mixed-solid"
        : "inorganic-solid";
  return { elements, atomCount, systemClass, organicLike, metallicCandidate };
}

export function recommendQuantumEspressoSettings(structure: CrystalStructure): QuantumEspressoRecommendation {
  const { elements, atomCount, systemClass, organicLike, metallicCandidate } = classifyPeriodicSystem(structure);
  const basisPreset: QuantumEspressoRecommendation["basisPreset"] = atomCount > 180 ? "screening" : "sssp-efficiency";
  const cutoffs = quantumEspressoCutoffsForPreset(elements, basisPreset);
  const targetSpacing = atomCount > 180 ? 0.60 : atomCount > 80 ? 0.45 : atomCount > 24 ? 0.35 : 0.28;
  const candidates = suggestQuantumEspressoKPointMeshes(structure.cell, 9);
  const kPointCandidate = candidates
    .filter((candidate) => candidate.targetSpacingInverseAngstrom > 0)
    .sort((left, right) => Math.abs(left.targetSpacingInverseAngstrom - targetSpacing) - Math.abs(right.targetSpacingInverseAngstrom - targetSpacing))[0]
    ?? candidates[0];
  const reasonsZh = [
    organicLike
      ? "CIF 含 C/H 骨架，按分子晶体处理，默认加入 D3(BJ) 色散修正。"
      : metallicCandidate
        ? "元素组成以金属为主且缺少明显阴离子元素，暂按金属候选体系处理。"
        : "按周期固体处理，以 PBE 作为兼容 SSSP PBE 赝势的通用起点。",
    `当前晶胞含 ${atomCount} 个原子；k 点按倒易晶格长度和约 ${targetSpacing.toFixed(2)} Å⁻¹ 的目标间距生成。`,
    `截断能取晶胞中最严格元素的 ${basisPreset === "screening" ? "预筛选" : "SSSP Efficiency"} 起点。`,
  ];
  const reasonsEn = [
    organicLike
      ? "The CIF contains a C/H framework, so it is treated as a molecular crystal with D3(BJ) dispersion by default."
      : metallicCandidate
        ? "The composition is metal-rich without obvious anionic elements, so it is provisionally treated as a metallic candidate."
        : "The model is treated as a periodic solid with PBE as a general starting point compatible with SSSP PBE pseudopotentials.",
    `The cell contains ${atomCount} atoms; the k-point mesh follows reciprocal-vector lengths at about ${targetSpacing.toFixed(2)} Å⁻¹ target spacing.`,
    `Cutoffs use the strictest element-wise ${basisPreset === "screening" ? "screening" : "SSSP Efficiency"} starting point.`,
  ];
  const warningsZh: string[] = ["自动推荐是计算起点，不替代截断能、k 点、磁性和结构收敛测试。"];
  const warningsEn: string[] = ["Automatic recommendations are starting points, not substitutes for cutoff, k-point, magnetic, and structural convergence tests."];
  const openShell = elements.filter((element) => openShellRiskElements.has(element));
  const heavy = elements.filter((element) => heavyElements.has(element));
  if (openShell.length) {
    warningsZh.push(`检测到可能需要自旋极化或 DFT+U 的元素：${openShell.join("、")}；CIF 无法唯一决定磁序、初始磁矩或 U 值。`);
    warningsEn.push(`Possible spin-polarized or DFT+U elements detected: ${openShell.join(", ")}. A CIF cannot uniquely determine magnetic order, starting moments, or U values.`);
  }
  if (heavy.length) {
    warningsZh.push(`检测到重元素：${heavy.join("、")}；应选择相对论赝势，并判断是否需要自旋-轨道耦合。`);
    warningsEn.push(`Heavy elements detected: ${heavy.join(", ")}. Select relativistic pseudopotentials and assess spin-orbit coupling.`);
  }
  if (structure.disorder.explicit || structure.disorder.partialOccupancySiteLabels.length) {
    warningsZh.push("存在无序或部分占有率；必须先选择化学一致的有序构型，当前输入会被阻止导出。 ");
    warningsEn.push("Disorder or partial occupancy is present; choose a chemically consistent ordered configuration before export.");
  }
  if (atomCount > 180) {
    warningsZh.push("体系较大，当前先推荐快速预筛选截断能；正式结果应在更强算力上采用 SSSP 起点并做收敛测试。 ");
    warningsEn.push("This is a large model, so screening cutoffs are suggested first. Production work should use the SSSP starting point and convergence tests on stronger hardware.");
  }
  return {
    systemClass,
    confidence: openShell.length || heavy.length || structure.disorder.explicit ? "medium" : organicLike || metallicCandidate ? "high" : "medium",
    calculation: "relax",
    inputDft: "PBE",
    dispersion: organicLike ? "d3-bj" : "none",
    occupations: metallicCandidate ? "smearing" : "fixed",
    smearing: "mv",
    degaussRy: metallicCandidate ? 0.02 : 0.01,
    basisPreset,
    ...cutoffs,
    kPoints: kPointCandidate.kPoints,
    kPointShift: [0, 0, 0],
    reasonsZh,
    reasonsEn,
    warningsZh,
    warningsEn,
  };
}

export function convergenceDeltaMevPerAtom(
  energyEv: number | null | undefined,
  referenceEnergyEv: number | null | undefined,
  atomCount: number,
) {
  if (!Number.isFinite(energyEv) || !Number.isFinite(referenceEnergyEv) || atomCount <= 0) return null;
  return Math.abs((Number(energyEv) - Number(referenceEnergyEv)) * 1000 / atomCount);
}

/** Returns the first row whose value and every denser row stay within tolerance. */
export function recommendedConvergenceIndex(deltasMevPerAtom: Array<number | null>, toleranceMevPerAtom: number) {
  const tolerance = finitePositive(toleranceMevPerAtom, 1);
  if (deltasMevPerAtom.length < 2 || deltasMevPerAtom.some((value) => value === null)) return -1;
  // The reference row cannot validate itself; at least one denser point must confirm a recommendation.
  for (let index = 0; index < deltasMevPerAtom.length - 1; index += 1) {
    if (deltasMevPerAtom.slice(index).every((value) => Number(value) <= tolerance)) return index;
  }
  return -1;
}

function pseudoFileForElement(element: string, configured: Record<string, string>) {
  return String(configured[element] || "").trim();
}

export function suggestQuantumEspressoPseudopotentials(elements: string[], availableFiles: string[]) {
  const suggestions: Record<string, string> = {};
  for (const element of elements) {
    const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidates = availableFiles.filter((file) => new RegExp(`^${escaped}(?:[._-]|$)`, "i").test(file));
    candidates.sort((a, b) => {
      const score = (value: string) => (/(?:^|[._-])pbe(?:[._-]|$)/i.test(value) ? 0 : 10)
        + (/paw/i.test(value) ? 0 : /rrkjus|uspp/i.test(value) ? 1 : 2)
        + value.length / 1000;
      return score(a) - score(b) || a.localeCompare(b);
    });
    suggestions[element] = candidates[0] ?? `${element}.UPF`;
  }
  return suggestions;
}

export function buildQuantumEspressoInput(
  structure: CrystalStructure,
  options: QuantumEspressoInputOptions,
): QuantumEspressoInput {
  const atoms = structure.atoms.filter((atom) => atom.source.occupancy > 0);
  const elements = [...new Set(atoms.map((atom) => atom.element))].sort((a, b) => a.localeCompare(b));
  const partialOccupancyLabels = structure.sites
    .filter((site) => site.occupancy > 1e-8 && site.occupancy < 0.999999)
    .map((site) => site.label);
  const missingPseudopotentials = elements.filter((element) => !pseudoFileForElement(element, options.pseudopotentials));
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  if (!atoms.length) blockingIssues.push("The periodic model contains no atoms.");
  if (partialOccupancyLabels.length) {
    blockingIssues.push(`Partial occupancies must be resolved before periodic DFT: ${partialOccupancyLabels.join(", ")}.`);
  }
  if (structure.disorder.explicit) {
    blockingIssues.push("Explicit disorder is present. Select one chemically consistent configuration before periodic DFT.");
  }
  if (missingPseudopotentials.length) {
    blockingIssues.push(`Missing pseudopotential filenames for: ${missingPseudopotentials.join(", ")}.`);
  }
  if (options.ecutrhoRy < options.ecutwfcRy * 4) {
    warnings.push("The charge-density cutoff is less than four times the wavefunction cutoff.");
  }
  if (options.calculation !== "scf" && options.occupations === "smearing") {
    warnings.push("Smearing is enabled during structural optimization; verify that the crystal is not an insulator.");
  }
  if (options.inputDft !== "auto") {
    warnings.push(`input_dft='${options.inputDft}' overrides the functional stored in the UPF files. Use pseudopotentials generated with the same exchange-correlation functional.`);
  }
  if (["PBE0", "HSE", "B3LYP"].includes(options.inputDft)) {
    warnings.push("Hybrid functionals are substantially more expensive in periodic plane-wave calculations; converge the structure with a semilocal functional first.");
  }

  const calculation = options.calculation;
  const molecularDynamics = calculation === "md" || calculation === "vc-md";
  const ionicCalculation = calculation === "relax" || calculation === "vc-relax" || molecularDynamics;
  const variableCell = calculation === "vc-relax" || calculation === "vc-md";
  const prefix = safePrefix(options.prefix || options.title);
  const ecutwfc = finitePositive(options.ecutwfcRy, 60);
  const ecutrho = finitePositive(options.ecutrhoRy, Math.max(480, ecutwfc * 8));
  const convThr = finitePositive(options.convThr, 1e-8);
  const lines = [
    "&CONTROL",
    `  calculation = '${calculation}',`,
    `  title = '${safeFortranString(options.title)}',`,
    `  prefix = '${safeFortranString(prefix)}',`,
    "  pseudo_dir = './pseudo',",
    "  outdir = './tmp',",
    "  tprnfor = .true.,",
    "  tstress = .true.,",
    ...(molecularDynamics ? [
      `  nstep = ${integerPositive(options.mdSteps ?? 100, 100)},`,
      `  dt = ${finitePositive(options.mdTimeStepAu ?? 20, 20).toFixed(4)},`,
    ] : []),
    ...(["relax", "vc-relax"].includes(calculation) ? [`  forc_conv_thr = ${finitePositive(options.forceConvThr, 1e-4).toExponential(8)},`] : []),
    ...(calculation === "vc-relax" ? [`  press_conv_thr = ${finitePositive(options.pressureConvThr, 0.5).toFixed(6)},`] : []),
    "/",
    "&SYSTEM",
    "  ibrav = 0,",
    `  nat = ${atoms.length},`,
    `  ntyp = ${elements.length},`,
    ...(options.inputDft === "auto" ? [] : [`  input_dft = '${options.inputDft}',`]),
    `  ecutwfc = ${ecutwfc.toFixed(4)},`,
    `  ecutrho = ${ecutrho.toFixed(4)},`,
    `  occupations = '${options.occupations}',`,
    ...(options.occupations === "smearing" ? [
      `  smearing = '${options.smearing}',`,
      `  degauss = ${finitePositive(options.degaussRy, 0.01).toFixed(6)},`,
    ] : []),
    ...(options.dispersion === "d3-bj" ? [
      "  vdw_corr = 'grimme-d3',",
      "  dftd3_version = 4,",
    ] : []),
    "/",
    "&ELECTRONS",
    `  conv_thr = ${convThr.toExponential(8)},`,
    "  mixing_beta = 0.3,",
    "/",
    ...(ionicCalculation ? [
      "&IONS",
      `  ion_dynamics = '${calculation === "relax" || calculation === "vc-relax" ? "bfgs" : calculation === "md" ? "verlet" : "beeman"}',`,
      ...(molecularDynamics ? [
        "  ion_temperature = 'rescaling',",
        `  tempw = ${finitePositive(options.temperatureK ?? 300, 300).toFixed(2)},`,
        "  tolp = 100.0,",
        "  nraise = 10,",
      ] : []),
      "/",
    ] : []),
    ...(variableCell ? [
      "&CELL",
      `  cell_dynamics = '${calculation === "vc-relax" ? "bfgs" : "pr"}',`,
      "  cell_dofree = 'all',",
      "/",
    ] : []),
    "ATOMIC_SPECIES",
    ...elements.map((element) => `${element.padEnd(3)} ${(atomicMasses[element] ?? 1).toFixed(6)} ${pseudoFileForElement(element, options.pseudopotentials) || `${element}.UPF`}`),
    "ATOMIC_POSITIONS crystal",
    ...atoms.map((atom) => `${atom.element.padEnd(3)} ${atom.fract.map((value) => formatNumber(wrapFractional(value))).join(" ")}`),
    "K_POINTS automatic",
    `${options.kPoints.map((value) => integerPositive(value, 1)).join(" ")} ${options.kPointShift.join(" ")}`,
    "CELL_PARAMETERS angstrom",
    ...latticeVectors(structure.cell).map((vector) => vector.map((value) => value.toFixed(10)).join(" ")),
    "",
  ];

  return {
    input: lines.join("\n"),
    diagnostics: {
      atomCount: atoms.length,
      elementCount: elements.length,
      elements,
      partialOccupancyLabels,
      missingPseudopotentials,
      blockingIssues,
      warnings,
    },
    requiredPseudopotentials: elements.map((element) => pseudoFileForElement(element, options.pseudopotentials)).filter(Boolean),
  };
}

function lastNumber(text: string, pattern: RegExp) {
  const matches = [...text.matchAll(pattern)];
  const value = matches.at(-1)?.[1];
  if (!value) return null;
  const parsed = Number(value.replace(/[dD]/g, "E"));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseQuantumEspressoOutput(output: string): QuantumEspressoOutputSummary {
  const jobDone = /\bJOB DONE\.\s*$/im.test(output);
  const errorMatch = output.match(/(?:Error in routine|%%%%%%%%%%%%)[\s\S]{0,800}?\n\s*([^\n%]+)(?:\n|$)/i);
  const convergenceFailure = /convergence NOT achieved|stopping[\s\S]{0,80}convergence/i.test(output);
  const totalEnergyRy = lastNumber(output, /^!\s+total energy\s+=\s+([-+0-9.EeDd]+)\s+Ry/gim);
  const pressureKbar = lastNumber(output, /P=\s*([-+0-9.EeDd]+)\s*$/gim);
  const totalForceRyBohr = lastNumber(output, /Total force\s*=\s*([-+0-9.EeDd]+)/gim);
  const forceSectionStart = output.toLowerCase().lastIndexOf("forces acting on atoms");
  const forceSection = forceSectionStart >= 0 ? output.slice(forceSectionStart) : "";
  const forceSectionEnd = forceSection.search(/Total force\s*=/i);
  const finalForceSection = forceSectionEnd >= 0 ? forceSection.slice(0, forceSectionEnd) : forceSection;
  const forceMagnitudes = [...finalForceSection.matchAll(/atom\s+\d+\s+type\s+\d+\s+force\s*=\s*([-+0-9.EeDd]+)\s+([-+0-9.EeDd]+)\s+([-+0-9.EeDd]+)/gi)]
    .map((match) => match.slice(1, 4).map((value) => Number(value.replace(/[dD]/g, "E"))))
    .filter((vector) => vector.every(Number.isFinite))
    .map((vector) => Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0)));
  const maximumForceRyBohr = forceMagnitudes.length ? Math.max(...forceMagnitudes) : null;
  const fermiEnergyEv = lastNumber(output, /the Fermi energy is\s+([-+0-9.EeDd]+)\s+ev/gim);
  const highestOccupiedEnergyEv = lastNumber(output, /highest occupied level \(ev\):\s+([-+0-9.EeDd]+)/gim);
  const scfIterations = lastNumber(output, /convergence has been achieved in\s+(\d+)\s+iterations/gim);
  const failed = Boolean(errorMatch || convergenceFailure);
  return {
    status: failed ? "failed" : jobDone ? "completed" : "incomplete",
    jobDone,
    convergenceReached: /convergence has been achieved/i.test(output) && !convergenceFailure,
    totalEnergyRy,
    totalEnergyEv: totalEnergyRy === null ? null : totalEnergyRy * RY_TO_EV,
    pressureKbar,
    totalForceRyBohr,
    maximumForceRyBohr,
    fermiEnergyEv,
    highestOccupiedEnergyEv,
    scfIterations,
    errorMessage: errorMatch?.[1]?.trim() || (convergenceFailure ? "Electronic self-consistency was not achieved." : null),
  };
}
