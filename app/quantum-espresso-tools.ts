import { type CrystalStructure, type Vec3 } from "./crystal-data.ts";

export type QuantumEspressoCalculation = "scf" | "relax" | "vc-relax";
export type QuantumEspressoOccupations = "fixed" | "smearing";
export type QuantumEspressoDispersion = "none" | "d3-bj";

export type QuantumEspressoInputOptions = {
  title: string;
  prefix: string;
  calculation: QuantumEspressoCalculation;
  inputDft: "PBE";
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
  fermiEnergyEv: number | null;
  highestOccupiedEnergyEv: number | null;
  scfIterations: number | null;
  errorMessage: string | null;
};

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

  const calculation = options.calculation;
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
    ...(calculation !== "scf" ? [`  forc_conv_thr = ${finitePositive(options.forceConvThr, 1e-4).toExponential(8)},`] : []),
    ...(calculation === "vc-relax" ? [`  press_conv_thr = ${finitePositive(options.pressureConvThr, 0.5).toFixed(6)},`] : []),
    "/",
    "&SYSTEM",
    "  ibrav = 0,",
    `  nat = ${atoms.length},`,
    `  ntyp = ${elements.length},`,
    `  input_dft = '${options.inputDft}',`,
    `  ecutwfc = ${ecutwfc.toFixed(4)},`,
    `  ecutrho = ${ecutrho.toFixed(4)},`,
    `  occupations = '${options.occupations}',`,
    ...(options.occupations === "smearing" ? [
      `  smearing = '${options.smearing}',`,
      `  degauss = ${finitePositive(options.degaussRy, 0.01).toFixed(6)},`,
    ] : []),
    ...(options.dispersion === "d3-bj" ? [
      "  vdw_corr = 'grimme-d3',",
      "  dftd3_version = 3,",
    ] : []),
    "/",
    "&ELECTRONS",
    `  conv_thr = ${convThr.toExponential(8)},`,
    "  mixing_beta = 0.3,",
    "/",
    ...(calculation !== "scf" ? [
      "&IONS",
      "  ion_dynamics = 'bfgs',",
      "/",
    ] : []),
    ...(calculation === "vc-relax" ? [
      "&CELL",
      "  cell_dynamics = 'bfgs',",
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
    fermiEnergyEv,
    highestOccupiedEnergyEv,
    scfIterations,
    errorMessage: errorMatch?.[1]?.trim() || (convergenceFailure ? "Electronic self-consistency was not achieved." : null),
  };
}
