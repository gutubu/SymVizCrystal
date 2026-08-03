import {
  type CrystalStructure,
  type UnitCell,
  type Vec3,
  fractToCart,
  latticeVectors,
} from "./crystal-data.ts";

export type GeometryResult = {
  distance?: number;
  angle?: number;
  dihedral?: number;
};

export type Reflection = {
  h: number;
  k: number;
  l: number;
  d: number;
  twoTheta: number;
  real: number;
  imaginary: number;
  intensity: number;
};

export type PowderPoint = { twoTheta: number; intensity: number };
export type DensityMode = "electron" | "nuclear" | "patterson";

export type ReducedCellCandidate = {
  cell: UnitCell;
  transform: [[number, number, number], [number, number, number], [number, number, number]];
  changed: boolean;
  certified: false;
};

export type EwaldResult = {
  neutral: boolean;
  netCharge: number;
  energyEv: number | null;
  potentialsEv: number[];
  alpha: number;
};

const ATOMIC_NUMBERS: Record<string, number> = {
  H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
  Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18,
  K: 19, Ca: 20, Sc: 21, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26,
  Co: 27, Ni: 28, Cu: 29, Zn: 30, Ga: 31, Ge: 32, As: 33, Se: 34,
  Br: 35, Kr: 36, Rb: 37, Sr: 38, Y: 39, Zr: 40, Nb: 41, Mo: 42,
  Tc: 43, Ru: 44, Rh: 45, Pd: 46, Ag: 47, Cd: 48, In: 49, Sn: 50,
  Sb: 51, Te: 52, I: 53, Xe: 54, Cs: 55, Ba: 56, La: 57, Ce: 58,
  Pr: 59, Nd: 60, Pm: 61, Sm: 62, Eu: 63, Gd: 64, Tb: 65, Dy: 66,
  Ho: 67, Er: 68, Tm: 69, Yb: 70, Lu: 71, Hf: 72, Ta: 73, W: 74,
  Re: 75, Os: 76, Ir: 77, Pt: 78, Au: 79, Hg: 80, Tl: 81, Pb: 82,
  Bi: 83, Po: 84, At: 85, Rn: 86, Fr: 87, Ra: 88, Ac: 89, Th: 90,
  Pa: 91, U: 92,
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(...a);
const scale = (a: Vec3, value: number): Vec3 => a.map((component) => component * value) as Vec3;
const add = (a: Vec3, b: Vec3): Vec3 => a.map((component, index) => component + b[index]) as Vec3;
const subtract = (a: Vec3, b: Vec3): Vec3 => a.map((component, index) => component - b[index]) as Vec3;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function atomicNumber(element: string) {
  return ATOMIC_NUMBERS[element] ?? 6;
}

export function cellVolume(cell: UnitCell) {
  const [a, b, c] = latticeVectors(cell);
  return Math.abs(dot(a, cross(b, c)));
}

function reciprocalVectors(cell: UnitCell, includeTwoPi = false): [Vec3, Vec3, Vec3] {
  const [a, b, c] = latticeVectors(cell);
  const volume = dot(a, cross(b, c));
  const factor = (includeTwoPi ? 2 * Math.PI : 1) / volume;
  return [
    scale(cross(b, c), factor),
    scale(cross(c, a), factor),
    scale(cross(a, b), factor),
  ];
}

function periodicVector(from: Vec3, to: Vec3, cell: UnitCell) {
  const delta = to.map((value, index) => {
    const raw = value - from[index];
    return raw - Math.round(raw);
  }) as Vec3;
  return fractToCart(delta, cell);
}

export function measureGeometry(structure: CrystalStructure, indices: number[]): GeometryResult {
  const atoms = indices.map((index) => structure.atoms[index]).filter(Boolean);
  if (atoms.length < 2) return {};
  const result: GeometryResult = {};
  const v01 = periodicVector(atoms[0].fract, atoms[1].fract, structure.cell);
  result.distance = norm(v01);
  if (atoms.length >= 3) {
    const ba = periodicVector(atoms[1].fract, atoms[0].fract, structure.cell);
    const bc = periodicVector(atoms[1].fract, atoms[2].fract, structure.cell);
    result.angle = Math.acos(clamp(dot(ba, bc) / Math.max(norm(ba) * norm(bc), 1e-12), -1, 1)) * 180 / Math.PI;
  }
  if (atoms.length >= 4) {
    const b0 = scale(periodicVector(atoms[1].fract, atoms[0].fract, structure.cell), -1);
    const b1 = periodicVector(atoms[1].fract, atoms[2].fract, structure.cell);
    const b2 = periodicVector(atoms[2].fract, atoms[3].fract, structure.cell);
    const b1Unit = scale(b1, 1 / Math.max(norm(b1), 1e-12));
    const v = subtract(b0, scale(b1Unit, dot(b0, b1Unit)));
    const w = subtract(b2, scale(b1Unit, dot(b2, b1Unit)));
    result.dihedral = Math.atan2(dot(cross(b1Unit, v), w), dot(v, w)) * 180 / Math.PI;
  }
  return result;
}

function reflectionVector(h: number, k: number, l: number, reciprocal: [Vec3, Vec3, Vec3]) {
  return add(add(scale(reciprocal[0], h), scale(reciprocal[1], k)), scale(reciprocal[2], l));
}

export function calculateReflections(
  structure: CrystalStructure,
  wavelength = 1.5406,
  minTwoTheta = 5,
  maxTwoTheta = 80,
) {
  const reciprocal = reciprocalVectors(structure.cell);
  const dMinimum = wavelength / (2 * Math.sin(maxTwoTheta * Math.PI / 360));
  const maximumCellLength = Math.max(structure.cell.a, structure.cell.b, structure.cell.c);
  const maxIndex = Math.min(16, Math.max(4, Math.ceil(maximumCellLength / Math.max(dMinimum, 0.25)) + 1));
  const reflections: Reflection[] = [];
  for (let h = -maxIndex; h <= maxIndex; h += 1) {
    for (let k = -maxIndex; k <= maxIndex; k += 1) {
      for (let l = -maxIndex; l <= maxIndex; l += 1) {
        if (h === 0 && k === 0 && l === 0) continue;
        const g = reflectionVector(h, k, l, reciprocal);
        const reciprocalLength = norm(g);
        if (reciprocalLength < 1e-10) continue;
        const d = 1 / reciprocalLength;
        const sinTheta = wavelength / (2 * d);
        if (sinTheta <= 0 || sinTheta > 1) continue;
        const twoTheta = 2 * Math.asin(sinTheta) * 180 / Math.PI;
        if (twoTheta < minTwoTheta || twoTheta > maxTwoTheta) continue;
        let real = 0;
        let imaginary = 0;
        structure.atoms.forEach((atom) => {
          const phase = 2 * Math.PI * (h * atom.fract[0] + k * atom.fract[1] + l * atom.fract[2]);
          const weight = atomicNumber(atom.element) * atom.source.occupancy;
          real += weight * Math.cos(phase);
          imaginary += weight * Math.sin(phase);
        });
        const theta = twoTheta * Math.PI / 360;
        const lorentzPolarization = (1 + Math.cos(2 * theta) ** 2)
          / Math.max(Math.sin(theta) ** 2 * Math.cos(theta), 1e-6);
        const intensity = (real * real + imaginary * imaginary) * lorentzPolarization;
        if (intensity > 1e-8) reflections.push({ h, k, l, d, twoTheta, real, imaginary, intensity });
      }
    }
  }
  return reflections.sort((a, b) => a.twoTheta - b.twoTheta);
}

export function calculatePowderPattern(
  reflections: Reflection[],
  minTwoTheta = 5,
  maxTwoTheta = 80,
  step = 0.1,
  fwhm = 0.18,
) {
  const count = Math.max(2, Math.floor((maxTwoTheta - minTwoTheta) / step) + 1);
  const sigma = Math.max(fwhm / 2.35482, step / 4);
  const points: PowderPoint[] = Array.from({ length: count }, (_, index) => ({
    twoTheta: minTwoTheta + index * step,
    intensity: 0,
  }));
  reflections.forEach((reflection) => {
    const minimumIndex = Math.max(0, Math.floor((reflection.twoTheta - 4 * sigma - minTwoTheta) / step));
    const maximumIndex = Math.min(points.length - 1, Math.ceil((reflection.twoTheta + 4 * sigma - minTwoTheta) / step));
    for (let index = minimumIndex; index <= maximumIndex; index += 1) {
      const delta = points[index].twoTheta - reflection.twoTheta;
      points[index].intensity += reflection.intensity * Math.exp(-(delta * delta) / (2 * sigma * sigma));
    }
  });
  const maximum = Math.max(...points.map((point) => point.intensity), 1e-12);
  return points.map((point) => ({ ...point, intensity: point.intensity / maximum * 100 }));
}

function vectorCell(vectors: [Vec3, Vec3, Vec3]): UnitCell {
  const angle = (a: Vec3, b: Vec3) => Math.acos(clamp(dot(a, b) / Math.max(norm(a) * norm(b), 1e-12), -1, 1)) * 180 / Math.PI;
  return {
    a: norm(vectors[0]),
    b: norm(vectors[1]),
    c: norm(vectors[2]),
    alpha: angle(vectors[1], vectors[2]),
    beta: angle(vectors[0], vectors[2]),
    gamma: angle(vectors[0], vectors[1]),
  };
}

function determinant(matrix: number[][]) {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

function reductionScore(cell: UnitCell) {
  const orderingPenalty = Math.max(0, cell.a - cell.b) ** 2 + Math.max(0, cell.b - cell.c) ** 2;
  const [a, b, c] = latticeVectors(cell);
  const metricOffDiagonal = [2 * dot(b, c), 2 * dot(a, c), 2 * dot(a, b)];
  const boundsPenalty = Math.max(0, Math.abs(metricOffDiagonal[0]) - cell.b ** 2) ** 2
    + Math.max(0, Math.abs(metricOffDiagonal[1]) - cell.a ** 2) ** 2
    + Math.max(0, Math.abs(metricOffDiagonal[2]) - cell.a ** 2) ** 2;
  const mixedSignPenalty = metricOffDiagonal.some((value) => value > 1e-7)
    && metricOffDiagonal.some((value) => value < -1e-7) ? 5 : 0;
  return orderingPenalty * 1e4 + boundsPenalty * 1e3 + mixedSignPenalty
    + cell.a * 1e-4 + cell.b * 1e-5 + cell.c * 1e-6;
}

export function reducedCellCandidate(cell: UnitCell): ReducedCellCandidate {
  const original = latticeVectors(cell);
  let bestCell = cell;
  let bestTransform: ReducedCellCandidate["transform"] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let bestScore = reductionScore(cell);
  const candidates = [-1, 0, 1];
  for (const a0 of candidates) for (const a1 of candidates) for (const a2 of candidates)
    for (const b0 of candidates) for (const b1 of candidates) for (const b2 of candidates)
      for (const c0 of candidates) for (const c1 of candidates) for (const c2 of candidates) {
        const transform = [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] as ReducedCellCandidate["transform"];
        if (Math.abs(determinant(transform)) !== 1) continue;
        const transformed = transform.map((column) => (
          add(add(scale(original[0], column[0]), scale(original[1], column[1])), scale(original[2], column[2]))
        )) as [Vec3, Vec3, Vec3];
        if (dot(transformed[0], cross(transformed[1], transformed[2])) < 0) continue;
        const candidateCell = vectorCell(transformed);
        const score = reductionScore(candidateCell);
        if (score < bestScore - 1e-9) {
          bestScore = score;
          bestCell = candidateCell;
          bestTransform = transform;
        }
      }
  const changed = bestTransform.flat().some((value, index) => value !== [1, 0, 0, 0, 1, 0, 0, 0, 1][index]);
  return { cell: bestCell, transform: bestTransform, changed, certified: false };
}

function erfc(value: number) {
  const z = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * z);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - polynomial * Math.exp(-z * z);
  return value >= 0 ? 1 - erf : 1 + erf;
}

export function ewaldElectrostatics(
  structure: CrystalStructure,
  elementCharges: Record<string, number>,
  realShell = 2,
  reciprocalShell = 4,
): EwaldResult {
  const charges = structure.atoms.map((atom) => (elementCharges[atom.element] ?? 0) * atom.source.occupancy);
  const netCharge = charges.reduce((sum, charge) => sum + charge, 0);
  const neutral = Math.abs(netCharge) < 1e-5;
  const volume = cellVolume(structure.cell);
  const alpha = 5.6 / Math.cbrt(Math.max(volume, 1e-9));
  if (!neutral || charges.every((charge) => Math.abs(charge) < 1e-12)) {
    return { neutral, netCharge, energyEv: null, potentialsEv: [], alpha };
  }
  const vectors = latticeVectors(structure.cell);
  const reciprocal = reciprocalVectors(structure.cell, true);
  const positions = structure.atoms.map((atom) => atom.cart);
  const potentials = new Array(charges.length).fill(0);

  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      for (let nx = -realShell; nx <= realShell; nx += 1) {
        for (let ny = -realShell; ny <= realShell; ny += 1) {
          for (let nz = -realShell; nz <= realShell; nz += 1) {
            if (i === j && nx === 0 && ny === 0 && nz === 0) continue;
            const translation = add(add(scale(vectors[0], nx), scale(vectors[1], ny)), scale(vectors[2], nz));
            const displacement = add(subtract(positions[j], positions[i]), translation);
            const distance = norm(displacement);
            if (distance > 1e-9) potentials[i] += charges[j] * erfc(alpha * distance) / distance;
          }
        }
      }
    }
  }

  for (let h = -reciprocalShell; h <= reciprocalShell; h += 1) {
    for (let k = -reciprocalShell; k <= reciprocalShell; k += 1) {
      for (let l = -reciprocalShell; l <= reciprocalShell; l += 1) {
        if (h === 0 && k === 0 && l === 0) continue;
        const g = reflectionVector(h, k, l, reciprocal);
        const gSquared = dot(g, g);
        const coefficient = 4 * Math.PI / volume * Math.exp(-gSquared / (4 * alpha * alpha)) / gSquared;
        let structureReal = 0;
        let structureImaginary = 0;
        positions.forEach((position, index) => {
          const phase = dot(g, position);
          structureReal += charges[index] * Math.cos(phase);
          structureImaginary += charges[index] * Math.sin(phase);
        });
        positions.forEach((position, index) => {
          const phase = dot(g, position);
          potentials[index] += coefficient * (
            structureReal * Math.cos(phase) + structureImaginary * Math.sin(phase)
          );
        });
      }
    }
  }
  charges.forEach((charge, index) => {
    potentials[index] -= 2 * alpha / Math.sqrt(Math.PI) * charge;
  });
  const coulombEvAngstrom = 14.399645478;
  const potentialsEv = potentials.map((potential) => potential * coulombEvAngstrom);
  const energyEv = 0.5 * charges.reduce((sum, charge, index) => sum + charge * potentialsEv[index], 0);
  return { neutral, netCharge, energyEv, potentialsEv, alpha };
}

function periodicFractionalDelta(value: number) {
  return value - Math.round(value);
}

function blurGrid(values: number[], size: number, passes = 2) {
  let current = values;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Array(values.length).fill(0);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      let total = 0;
      let weight = 0;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const sampleX = (x + dx + size) % size;
        const sampleY = (y + dy + size) % size;
        const localWeight = Math.exp(-(dx * dx + dy * dy) / 3);
        total += current[sampleY * size + sampleX] * localWeight;
        weight += localWeight;
      }
      next[y * size + x] = total / weight;
    }
    current = next;
  }
  return current;
}

export function calculateDensitySlice(
  structure: CrystalStructure,
  mode: DensityMode,
  slice = 0.5,
  size = 56,
) {
  let values = new Array(size * size).fill(0);
  if (mode === "patterson") {
    structure.atoms.forEach((from) => structure.atoms.forEach((to) => {
      const dx = ((to.fract[0] - from.fract[0]) % 1 + 1) % 1;
      const dy = ((to.fract[1] - from.fract[1]) % 1 + 1) % 1;
      const dz = ((to.fract[2] - from.fract[2]) % 1 + 1) % 1;
      const sliceDelta = Math.abs(periodicFractionalDelta(dz - slice));
      if (sliceDelta > 0.08) return;
      const x = Math.round(dx * (size - 1));
      const y = Math.round((1 - dy) * (size - 1));
      values[y * size + x] += atomicNumber(from.element) * atomicNumber(to.element)
        * from.source.occupancy * to.source.occupancy * Math.exp(-(sliceDelta ** 2) / 0.002);
    }));
    values = blurGrid(values, size, 3);
  } else {
    const sigma = mode === "electron" ? 0.34 : 0.22;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const fract: Vec3 = [x / (size - 1), 1 - y / (size - 1), slice];
        let density = 0;
        structure.atoms.forEach((atom) => {
          const delta = atom.fract.map((value, axis) => periodicFractionalDelta(fract[axis] - value)) as Vec3;
          const distance = norm(fractToCart(delta, structure.cell));
          const weight = mode === "electron" ? atomicNumber(atom.element) : 1;
          density += weight * atom.source.occupancy * Math.exp(-(distance * distance) / (2 * sigma * sigma));
        });
        values[y * size + x] = density;
      }
    }
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 1e-12);
  const normalized = values.map((value) => (value - minimum) / range);
  const lineProfile = Array.from({ length: size }, (_, x) => normalized[Math.floor(size / 2) * size + x]);
  return { size, values: normalized, lineProfile, minimum, maximum };
}
