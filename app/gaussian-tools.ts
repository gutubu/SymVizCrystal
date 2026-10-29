import {
  type CrystalStructure,
  type Vec3,
  disorderSitesCanCoexist,
  elementStyle,
  fractToCart,
  molecularComponentIds,
  molecularDisplayFracts,
} from "./crystal-data.ts";

export type GaussianCalculation = "sp" | "opt" | "freq" | "opt-freq" | "td";
export type GaussianScope = "selected-molecule" | "asymmetric-unit" | "generated-atoms";
export type GaussianWorkflow = "single" | "preopt-final";

export type GaussianInputOptions = {
  title: string;
  charge: number;
  multiplicity: number;
  method: string;
  basis: string;
  calculation: GaussianCalculation;
  memoryGB: number;
  processors: number;
  solvent: string;
  routeExtras: string;
  checkpointName: string;
  workflow?: GaussianWorkflow;
  preoptimizationMethod?: string;
  preoptimizationBasis?: string;
};

export type GaussianPreparedAtom = {
  index: number;
  element: string;
  fract: Vec3;
  cart: Vec3;
};

export type GaussianModelDiagnostics = {
  moleculeCount: number;
  fragmentCount: number;
  isolatedAtomIndices: number[];
  isolatedLabels: string[];
  periodicBondCount: number;
  cartesianBondCount: number;
  missingBondCount: number;
  extraBondCount: number;
  abnormalFragmentCount: number;
  graphConsistent: boolean;
  blockingIssues: string[];
  warnings: string[];
};

export type GaussianPreparedModel = {
  atomIndices: number[];
  atoms: GaussianPreparedAtom[];
  diagnostics: GaussianModelDiagnostics;
};

export type GaussianOutputSummary = {
  status: "completed" | "failed" | "incomplete";
  normalTermination: boolean;
  errorTermination: boolean;
  methodLabel: string | null;
  scfEnergyHartree: number | null;
  correlatedEnergyHartree: number | null;
  zeroPointCorrectionHartree: number | null;
  thermalFreeEnergyHartree: number | null;
  homoHartree: number | null;
  lumoHartree: number | null;
  gapEv: number | null;
  dipoleDebye: number | null;
  frequenciesCm1: number[];
  imaginaryFrequencyCount: number;
  elapsed: string | null;
  errorMessage: string | null;
};

export type CubeAtom = {
  atomicNumber: number;
  charge: number;
  position: Vec3;
};

export type CubeData = {
  comments: [string, string];
  origin: Vec3;
  dimensions: [number, number, number];
  axes: [Vec3, Vec3, Vec3];
  atoms: CubeAtom[];
  values: number[];
  orbitalIds: number[];
  sourceUnit: "bohr" | "angstrom";
  minimum: number;
  maximum: number;
  mean: number;
  rms: number;
};

export type CubeBond = {
  a: number;
  b: number;
  distance: number;
};

export type CubeTriangle = {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  sign: 1 | -1;
};

const BOHR_TO_ANGSTROM = 0.529177210903;
const HARTREE_TO_EV = 27.211386245988;

function finiteNumber(value: string) {
  const parsed = Number(value.replace(/[dD]/g, "E"));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value: ${value}`);
  return parsed;
}

function safeFileStem(value: string, fallback = "symviz-job") {
  const stem = value
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem || fallback;
}

export function gaussianAtomIndices(
  structure: CrystalStructure,
  selectedAtomIndex: number,
  scope: GaussianScope,
) {
  if (scope === "generated-atoms") return structure.atoms.map((_, index) => index);
  if (scope === "asymmetric-unit") {
    const seen = new Set<string>();
    return structure.atoms.flatMap((atom, index) => {
      if (seen.has(atom.source.label)) return [];
      seen.add(atom.source.label);
      return [index];
    });
  }
  const componentIds = molecularComponentIds(structure.atoms, structure.bonds);
  const selectedComponent = componentIds[Math.min(selectedAtomIndex, componentIds.length - 1)] ?? 0;
  return componentIds.flatMap((component, index) => component === selectedComponent ? [index] : []);
}

function calculationKeywords(calculation: GaussianCalculation) {
  if (calculation === "opt") return "Opt";
  if (calculation === "freq") return "Freq";
  if (calculation === "opt-freq") return "Opt Freq";
  if (calculation === "td") return "TD(NStates=10)";
  return "";
}

function graphComponents(atomCount: number, edges: Array<[number, number]>) {
  const adjacency: number[][] = Array.from({ length: atomCount }, () => []);
  edges.forEach(([a, b]) => {
    adjacency[a]?.push(b);
    adjacency[b]?.push(a);
  });
  const componentIds = Array(atomCount).fill(-1) as number[];
  const componentSizes: number[] = [];
  let component = 0;
  for (let start = 0; start < atomCount; start += 1) {
    if (componentIds[start] >= 0) continue;
    const queue = [start];
    componentIds[start] = component;
    let size = 0;
    while (queue.length) {
      const current = queue.shift()!;
      size += 1;
      adjacency[current].forEach((target) => {
        if (componentIds[target] >= 0) return;
        componentIds[target] = component;
        queue.push(target);
      });
    }
    componentSizes.push(size);
    component += 1;
  }
  return { componentIds, componentSizes, degrees: adjacency.map((neighbors) => neighbors.length) };
}

function edgeKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function euclideanDistance(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Reconnects finite molecular components across unit-cell boundaries and then
 * independently rebuilds the Cartesian bonding graph used by Gaussian.
 */
export function prepareGaussianModel(
  structure: CrystalStructure,
  atomIndices: number[],
  scope: GaussianScope = "selected-molecule",
): GaussianPreparedModel {
  const normalizedIndices = [...new Set(atomIndices)]
    .filter((index) => Number.isInteger(index) && Boolean(structure.atoms[index]));
  const localIndex = new Map(normalizedIndices.map((index, local) => [index, local]));
  const displayFracts = molecularDisplayFracts(structure.atoms, structure.bonds);
  const atoms = normalizedIndices.map((index) => {
    const atom = structure.atoms[index];
    const fract = displayFracts[index] ?? atom.fract;
    return {
      index,
      element: atom.element,
      fract,
      cart: fractToCart(fract, structure.cell),
    } satisfies GaussianPreparedAtom;
  });

  const periodicEdges: Array<[number, number]> = [];
  structure.bonds.forEach((bond) => {
    const a = localIndex.get(bond.a);
    const b = localIndex.get(bond.b);
    if (a === undefined || b === undefined) return;
    periodicEdges.push([a, b]);
  });

  const cartesianEdges: Array<[number, number]> = [];
  for (let a = 0; a < atoms.length; a += 1) {
    for (let b = a + 1; b < atoms.length; b += 1) {
      const sourceA = structure.atoms[atoms[a].index];
      const sourceB = structure.atoms[atoms[b].index];
      if (!disorderSitesCanCoexist(sourceA.source, sourceB.source)) continue;
      const threshold = (elementStyle(atoms[a].element).covalent + elementStyle(atoms[b].element).covalent) * 1.22;
      const distance = euclideanDistance(atoms[a].cart, atoms[b].cart);
      if (distance > 0.35 && distance <= threshold) cartesianEdges.push([a, b]);
    }
  }

  const periodicKeys = new Set(periodicEdges.map(([a, b]) => edgeKey(a, b)));
  const cartesianKeys = new Set(cartesianEdges.map(([a, b]) => edgeKey(a, b)));
  const missingBondCount = [...periodicKeys].filter((key) => !cartesianKeys.has(key)).length;
  const extraBondCount = [...cartesianKeys].filter((key) => !periodicKeys.has(key)).length;
  const periodicGraph = graphComponents(atoms.length, periodicEdges);
  const cartesianGraph = graphComponents(atoms.length, cartesianEdges);
  const isolatedAtomIndices = cartesianGraph.degrees.flatMap((degree, local) => degree === 0 ? [atoms[local].index] : []);
  const isolatedLabels = isolatedAtomIndices.map((index) => structure.atoms[index]?.source.label ?? `#${index + 1}`);
  const isolatedHydrogenOrFluorine = isolatedAtomIndices.filter((index) => ["H", "F"].includes(structure.atoms[index]?.element));
  const graphConsistent = missingBondCount === 0
    && extraBondCount === 0
    && periodicGraph.componentSizes.length === cartesianGraph.componentSizes.length;
  const abnormalFragmentCount = Math.max(0, cartesianGraph.componentSizes.length - periodicGraph.componentSizes.length);
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (!atoms.length) blockingIssues.push("No atoms are available for Gaussian export.");
  if (!graphConsistent) {
    blockingIssues.push(`Periodic and Cartesian bonding graphs differ (${missingBondCount} missing, ${extraBondCount} extra bonds).`);
  }
  if (abnormalFragmentCount > 0) {
    blockingIssues.push(`Cartesian reconstruction produced ${abnormalFragmentCount} unexpected fragment(s).`);
  }
  if (isolatedHydrogenOrFluorine.length) {
    const labels = isolatedHydrogenOrFluorine.map((index) => structure.atoms[index]?.source.label ?? `#${index + 1}`);
    blockingIssues.push(`Isolated H/F atoms detected: ${labels.join(", ")}.`);
  }
  if (isolatedAtomIndices.length && !isolatedHydrogenOrFluorine.length) {
    warnings.push(`${isolatedAtomIndices.length} isolated atom(s) remain in the finite model.`);
  }
  if (scope === "asymmetric-unit" && structure.operations.length > 1) {
    warnings.push("A crystallographic asymmetric unit is not necessarily a complete molecular model.");
  }

  return {
    atomIndices: normalizedIndices,
    atoms,
    diagnostics: {
      moleculeCount: periodicGraph.componentSizes.length,
      fragmentCount: cartesianGraph.componentSizes.length,
      isolatedAtomIndices,
      isolatedLabels,
      periodicBondCount: periodicEdges.length,
      cartesianBondCount: cartesianEdges.length,
      missingBondCount,
      extraBondCount,
      abnormalFragmentCount,
      graphConsistent,
      blockingIssues,
      warnings,
    },
  };
}

function gaussianRoute(
  method: string,
  basis: string,
  calculation: GaussianCalculation,
  solvent: string,
  routeExtras = "",
  geometryFromCheckpoint = false,
) {
  return [
    `#p ${method}/${basis}`,
    calculationKeywords(calculation),
    geometryFromCheckpoint ? "Geom=AllCheck Guess=Read" : "",
    solvent.trim() ? `SCRF=(SMD,Solvent=${solvent.trim()})` : "",
    "SCF=(Tight,XQC)",
    "Integral=UltraFine",
    routeExtras.trim(),
  ].filter(Boolean).join(" ");
}

export function buildGaussianInputFromModel(
  structure: CrystalStructure,
  model: GaussianPreparedModel,
  options: GaussianInputOptions,
) {
  if (!model.atoms.length) throw new Error("No atoms selected for the Gaussian input.");
  const charge = Math.trunc(options.charge);
  const multiplicity = Math.max(1, Math.trunc(options.multiplicity));
  const method = options.method.trim() || "B3LYP";
  const basis = options.basis.trim() || "6-31G(d,p)";
  const checkpoint = safeFileStem(options.checkpointName || options.title || structure.name);
  const memoryLine = `%mem=${Math.max(1, Math.round(options.memoryGB))}GB`;
  const processorLine = `%nprocshared=${Math.max(1, Math.round(options.processors))}`;
  const coordinateLines = model.atoms.map((atom) => (
    `${atom.element.padEnd(2)}  ${atom.cart[0].toFixed(8).padStart(14)}  ${atom.cart[1].toFixed(8).padStart(14)}  ${atom.cart[2].toFixed(8).padStart(14)}`
  ));
  const title = options.title.trim() || `${structure.name} — SymViz Gaussian job`;

  if (options.workflow === "preopt-final") {
    const preliminaryMethod = options.preoptimizationMethod?.trim() || "B3LYP";
    const preliminaryBasis = options.preoptimizationBasis?.trim() || "6-31G(d)";
    return [
      `%chk=${checkpoint}-preopt.chk`,
      memoryLine,
      processorLine,
      gaussianRoute(preliminaryMethod, preliminaryBasis, "opt", options.solvent),
      "",
      `${title} — preliminary optimization`,
      "",
      `${charge} ${multiplicity}`,
      ...coordinateLines,
      "",
      "--Link1--",
      `%oldchk=${checkpoint}-preopt.chk`,
      `%chk=${checkpoint}.chk`,
      memoryLine,
      processorLine,
      gaussianRoute(method, basis, options.calculation, options.solvent, options.routeExtras, true),
      "",
      "",
    ].join("\n");
  }

  return [
    `%chk=${checkpoint}.chk`,
    memoryLine,
    processorLine,
    gaussianRoute(method, basis, options.calculation, options.solvent, options.routeExtras),
    "",
    title,
    "",
    `${charge} ${multiplicity}`,
    ...coordinateLines,
    "",
    "",
  ].join("\n");
}

export function buildGaussianInput(
  structure: CrystalStructure,
  atomIndices: number[],
  options: GaussianInputOptions,
) {
  return buildGaussianInputFromModel(structure, prepareGaussianModel(structure, atomIndices), options);
}

function lastMatchNumber(text: string, pattern: RegExp) {
  const matches = [...text.matchAll(pattern)];
  return matches.length ? finiteNumber(matches[matches.length - 1][1]) : null;
}

function eigenvalues(text: string, kind: "occ" | "virt") {
  return [...text.matchAll(new RegExp(`Alpha\\s+${kind}\\. eigenvalues\\s+--\\s+([^\\r\\n]+)`, "gi"))]
    .flatMap((match) => match[1].trim().split(/\s+/).map(finiteNumber));
}

export function parseGaussianOutput(text: string): GaussianOutputSummary {
  const normalTermination = /Normal termination of Gaussian/i.test(text);
  const errorTermination = /Error termination/i.test(text);
  const scfMatches = [...text.matchAll(/SCF Done:\s+E\(([^)]+)\)\s*=\s*([-\d.DE+]+)/gi)];
  const lastScf = scfMatches.at(-1);
  const scfEnergyHartree = lastScf ? finiteNumber(lastScf[2]) : null;
  const methodLabel = lastScf?.[1]?.trim() ?? null;
  const correlatedEnergyHartree = lastMatchNumber(text, /E(?:UMP2|MP2|CCSD\(T\))\s*=\s*([-\d.DE+]+)/gi);
  const zeroPointCorrectionHartree = lastMatchNumber(text, /Zero-point correction=\s*([-\d.DE+]+)/gi);
  const thermalFreeEnergyHartree = lastMatchNumber(text, /Sum of electronic and thermal Free Energies=\s*([-\d.DE+]+)/gi);
  const occupied = eigenvalues(text, "occ");
  const virtual = eigenvalues(text, "virt");
  const homoHartree = occupied.length ? occupied.at(-1)! : null;
  const lumoHartree = virtual.length ? virtual[0] : null;
  const gapEv = homoHartree !== null && lumoHartree !== null
    ? (lumoHartree - homoHartree) * HARTREE_TO_EV
    : null;
  const frequenciesCm1 = [...text.matchAll(/Frequencies --\s+([^\r\n]+)/gi)]
    .flatMap((match) => match[1].trim().split(/\s+/).map(finiteNumber));
  const dipoleDebye = lastMatchNumber(text, /Tot=\s*([-\d.]+)\s*(?:Debye)?/gi);
  const elapsedMatch = [...text.matchAll(/Elapsed time:\s*([^\r\n]+)/gi)].at(-1);
  const errorLine = [...text.matchAll(/(?:Error termination|Convergence failure|Erroneous write)[^\r\n]*/gi)].at(-1);
  return {
    status: normalTermination ? "completed" : errorTermination ? "failed" : "incomplete",
    normalTermination,
    errorTermination,
    methodLabel,
    scfEnergyHartree,
    correlatedEnergyHartree,
    zeroPointCorrectionHartree,
    thermalFreeEnergyHartree,
    homoHartree,
    lumoHartree,
    gapEv,
    dipoleDebye,
    frequenciesCm1,
    imaginaryFrequencyCount: frequenciesCm1.filter((frequency) => frequency < 0).length,
    elapsed: elapsedMatch?.[1]?.trim() ?? null,
    errorMessage: errorLine?.[0]?.trim() ?? null,
  };
}

function parseCubeHeaderLine(line: string) {
  const values = line.trim().split(/\s+/);
  if (values.length < 4) throw new Error("Malformed Gaussian Cube header.");
  return {
    count: Math.trunc(finiteNumber(values[0])),
    vector: [finiteNumber(values[1]), finiteNumber(values[2]), finiteNumber(values[3])] as Vec3,
    tail: values.slice(4).map(finiteNumber),
  };
}

function scaleVector(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

export function parseGaussianCube(text: string): CubeData {
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length < 7) throw new Error("The Cube file is incomplete.");
  const atomHeader = parseCubeHeaderLine(lines[2]);
  const axisHeaders = [3, 4, 5].map((index) => parseCubeHeaderLine(lines[index]));
  const sourceUnit = axisHeaders.some(({ count }) => count < 0) ? "angstrom" : "bohr";
  const lengthFactor = sourceUnit === "bohr" ? BOHR_TO_ANGSTROM : 1;
  const dimensions = axisHeaders.map(({ count }) => Math.abs(count)) as [number, number, number];
  if (dimensions.some((dimension) => dimension < 2)) throw new Error("Cube grid dimensions must be at least 2 × 2 × 2.");
  const axes = axisHeaders.map(({ vector }) => scaleVector(vector, lengthFactor)) as [Vec3, Vec3, Vec3];
  const origin = scaleVector(atomHeader.vector, lengthFactor);
  const atomCount = Math.abs(atomHeader.count);
  const atoms: CubeAtom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const values = lines[6 + index]?.trim().split(/\s+/) ?? [];
    if (values.length < 5) throw new Error("Cube atom table is incomplete.");
    atoms.push({
      atomicNumber: Math.trunc(finiteNumber(values[0])),
      charge: finiteNumber(values[1]),
      position: [
        finiteNumber(values[2]) * lengthFactor,
        finiteNumber(values[3]) * lengthFactor,
        finiteNumber(values[4]) * lengthFactor,
      ],
    });
  }
  let dataStart = 6 + atomCount;
  let orbitalIds: number[] = [];
  if (atomHeader.count < 0) {
    const orbitalLine = lines[dataStart]?.trim().split(/\s+/).map(finiteNumber) ?? [];
    const orbitalCount = Math.max(0, Math.trunc(orbitalLine[0] ?? 0));
    orbitalIds = orbitalLine.slice(1, 1 + orbitalCount).map(Math.trunc);
    dataStart += 1;
  }
  const expected = dimensions[0] * dimensions[1] * dimensions[2];
  const values = lines.slice(dataStart).join(" ").trim().split(/\s+/).filter(Boolean).map(finiteNumber);
  if (values.length < expected) throw new Error(`Cube grid contains ${values.length} values; ${expected} are required.`);
  const gridValues = values.slice(0, expected);
  // Cube grids routinely contain hundreds of thousands or millions of values.
  // Passing them to Math.min/Math.max with spread syntax exceeds the JavaScript
  // argument stack in Electron, so collect all statistics in one bounded scan.
  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  let sumSquares = 0;
  for (const value of gridValues) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / gridValues.length;
  const rms = Math.sqrt(sumSquares / gridValues.length);
  return {
    comments: [lines[0] ?? "", lines[1] ?? ""],
    origin,
    dimensions,
    axes,
    atoms,
    values: gridValues,
    orbitalIds,
    sourceUnit,
    minimum,
    maximum,
    mean,
    rms,
  };
}

export function defaultCubeIsovalue(cube: CubeData) {
  const maximumAbsolute = Math.max(Math.abs(cube.minimum), Math.abs(cube.maximum), 1e-8);
  // Nuclear cusps can be orders of magnitude larger than the chemically useful
  // part of a density or potential grid.  Basing the initial contour on the
  // absolute maximum therefore hides almost the entire surface.  RMS keeps the
  // default tied to the bulk of the sampled field while remaining scale-aware.
  return Math.max(1e-8, Math.min(maximumAbsolute * 0.2, cube.rms * 0.08));
}

export function cubeIsovalueRange(cube: CubeData) {
  const suggested = defaultCubeIsovalue(cube);
  const maximumAbsolute = Math.max(Math.abs(cube.minimum), Math.abs(cube.maximum), 1e-8);
  const maximum = Math.max(
    suggested * 1.01,
    Math.min(maximumAbsolute * 0.8, Math.max(suggested * 20, cube.rms * 2)),
  );
  const minimum = Math.max(1e-8, Math.min(suggested / 50, maximum / 1000));
  return {
    minimum,
    maximum,
    step: Math.max(1e-8, suggested / 100),
    suggested,
  };
}

export function cubePhaseAvailability(cube: Pick<CubeData, "minimum" | "maximum">) {
  const scale = Math.max(Math.abs(cube.minimum), Math.abs(cube.maximum), 1e-12);
  const tolerance = Math.max(1e-12, scale * 1e-10);
  return {
    positive: cube.maximum > tolerance,
    negative: cube.minimum < -tolerance,
  };
}

// Cordero-style single-bond covalent radii in angstrom.  Cube atom positions
// are normalized to angstrom by parseGaussianCube, so the same cutoff works
// for both Bohr- and angstrom-authored files.
const CUBE_COVALENT_RADII = [
  0,
  0.31, 0.28,
  1.28, 0.96, 0.84, 0.76, 0.71, 0.66, 0.57, 0.58,
  1.66, 1.41, 1.21, 1.11, 1.07, 1.05, 1.02, 1.06,
  2.03, 1.76, 1.70, 1.60, 1.53, 1.39, 1.39, 1.32, 1.26, 1.24, 1.32, 1.22, 1.22, 1.20, 1.19, 1.20, 1.20, 1.16,
  2.20, 1.95, 1.90, 1.75, 1.64, 1.54, 1.47, 1.46, 1.42, 1.39, 1.45, 1.44, 1.42, 1.39, 1.39, 1.38, 1.39, 1.40,
  2.44, 2.15, 2.07, 2.04, 2.03, 2.01, 1.99, 1.98, 1.98, 1.96, 1.94, 1.92, 1.92, 1.89, 1.90, 1.87, 1.87,
  1.75, 1.70, 1.62, 1.51, 1.44, 1.41, 1.36, 1.36, 1.32, 1.45, 1.46, 1.48, 1.40, 1.50, 1.50,
  2.60, 2.21, 2.15, 2.06, 2.00, 1.96, 1.90, 1.87, 1.80, 1.69,
] as const;

export function inferCubeBonds(cube: Pick<CubeData, "atoms">, tolerance = 1.22): CubeBond[] {
  const bonds: CubeBond[] = [];
  for (let a = 0; a < cube.atoms.length; a += 1) {
    const radiusA = CUBE_COVALENT_RADII[cube.atoms[a].atomicNumber] ?? 1.25;
    for (let b = a + 1; b < cube.atoms.length; b += 1) {
      const radiusB = CUBE_COVALENT_RADII[cube.atoms[b].atomicNumber] ?? 1.25;
      const distance = euclideanDistance(cube.atoms[a].position, cube.atoms[b].position);
      if (distance > 0.35 && distance <= (radiusA + radiusB) * tolerance) {
        bonds.push({ a, b, distance });
      }
    }
  }
  return bonds;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector) || 1;
  return scaleVector(vector, 1 / length);
}

function gridPoint(cube: CubeData, x: number, y: number, z: number) {
  return add(cube.origin, add(
    scaleVector(cube.axes[0], x),
    add(scaleVector(cube.axes[1], y), scaleVector(cube.axes[2], z)),
  ));
}

function orderPolygon(points: Vec3[]) {
  const center = scaleVector(points.reduce(add, [0, 0, 0] as Vec3), 1 / points.length);
  const normal = normalize(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
  const u = normalize(subtract(points[0], center));
  const v = normalize(cross(normal, u));
  return [...points].sort((a, b) => {
    const relativeA = subtract(a, center);
    const relativeB = subtract(b, center);
    return Math.atan2(dot(relativeA, v), dot(relativeA, u))
      - Math.atan2(dot(relativeB, v), dot(relativeB, u));
  });
}

export function buildCubeIsosurface(
  cube: CubeData,
  isovalue: number,
  includePositive = true,
  includeNegative = true,
  maximumCells = 45_000,
) {
  const [nx, ny, nz] = cube.dimensions;
  const cellCount = Math.max(1, (nx - 1) * (ny - 1) * (nz - 1));
  const stride = Math.max(1, Math.ceil(Math.cbrt(cellCount / maximumCells)));
  const cornerOffsets: Vec3[] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];
  const tetraEdges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const valueAt = (x: number, y: number, z: number) => cube.values[(x * ny + y) * nz + z];
  const triangles: CubeTriangle[] = [];
  const signs = ([includePositive ? 1 : null, includeNegative ? -1 : null].filter(Boolean) as Array<1 | -1>);

  for (let x = 0; x < nx - 1; x += stride) {
    const x2 = Math.min(nx - 1, x + stride);
    for (let y = 0; y < ny - 1; y += stride) {
      const y2 = Math.min(ny - 1, y + stride);
      for (let z = 0; z < nz - 1; z += stride) {
        const z2 = Math.min(nz - 1, z + stride);
        const coordinates = cornerOffsets.map(([dx, dy, dz]) => [
          dx ? x2 : x,
          dy ? y2 : y,
          dz ? z2 : z,
        ] as Vec3);
        const positions = coordinates.map(([gx, gy, gz]) => gridPoint(cube, gx, gy, gz));
        const samples = coordinates.map(([gx, gy, gz]) => valueAt(gx, gy, gz));
        for (const sign of signs) {
          for (const tetrahedron of tetrahedra) {
            const intersections: Vec3[] = [];
            for (const [edgeA, edgeB] of tetraEdges) {
              const cornerA = tetrahedron[edgeA];
              const cornerB = tetrahedron[edgeB];
              const valueA = samples[cornerA] * sign;
              const valueB = samples[cornerB] * sign;
              if ((valueA >= isovalue) === (valueB >= isovalue)) continue;
              const denominator = valueB - valueA;
              const t = Math.abs(denominator) < 1e-12 ? 0.5 : (isovalue - valueA) / denominator;
              const start = positions[cornerA];
              const end = positions[cornerB];
              intersections.push(start.map((value, axis) => value + (end[axis] - value) * t) as Vec3);
            }
            const unique = intersections.filter((point, index) => intersections.findIndex((candidate) => (
              Math.hypot(...subtract(point, candidate)) < 1e-7
            )) === index);
            if (unique.length < 3) continue;
            const polygon = orderPolygon(unique);
            for (let index = 1; index < polygon.length - 1; index += 1) {
              triangles.push({ a: polygon[0], b: polygon[index], c: polygon[index + 1], sign });
            }
          }
        }
      }
    }
  }
  return { triangles, stride };
}
