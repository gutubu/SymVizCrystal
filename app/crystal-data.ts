export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export type UnitCell = {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
};

export type AtomSite = {
  label: string;
  element: string;
  fract: Vec3;
  occupancy: number;
  wyckoff: string;
  multiplicity?: number;
};

export type SymmetryOperation = {
  id: number;
  xyz: string;
  matrix: Mat3;
  translation: Vec3;
  kind: "identity" | "rotation" | "screw" | "mirror" | "glide" | "inversion" | "rotoinversion";
  label: string;
  name: string;
  order: number;
};

export type AtomInstance = {
  id: string;
  label: string;
  element: string;
  fract: Vec3;
  cart: Vec3;
  source: AtomSite;
  operationIds: number[];
};

export type Bond = {
  a: number;
  b: number;
  distance: number;
  imageShift: Vec3;
};

export type HydrogenBondCriteria = {
  maxHydrogenAcceptorDistance: number;
  maxDonorAcceptorDistance: number;
  minDonorHydrogenAcceptorAngle: number;
  donorElements: string[];
  acceptorElements: string[];
};

export type HydrogenBond = {
  donor: number;
  hydrogen: number;
  acceptor: number;
  hydrogenAcceptorDistance: number;
  donorAcceptorDistance: number;
  angle: number;
  acceptorImageShift: Vec3;
  kind: "intramolecular" | "intermolecular";
  strength: "strong" | "moderate" | "weak";
};

export type CrystalStructure = {
  name: string;
  cell: UnitCell;
  spaceGroup: string;
  spaceGroupNumber?: number;
  pointGroup: string;
  crystalSystem: string;
  sites: AtomSite[];
  operations: SymmetryOperation[];
  atoms: AtomInstance[];
  bonds: Bond[];
  formula: string;
  warnings: string[];
};

export const DEFAULT_CIF = `data_alpha_quartz
_chemical_name_common                 'Alpha quartz'
_chemical_formula_sum                 'Si O2'
_cell_length_a                        4.9130
_cell_length_b                        4.9130
_cell_length_c                        5.4050
_cell_angle_alpha                     90
_cell_angle_beta                      90
_cell_angle_gamma                     120
_space_group_name_H-M_alt             'P 31 2 1'
_space_group_IT_number                152

loop_
_space_group_symop_id
_space_group_symop_operation_xyz
1  'x,y,z'
2  '-y,x-y,z+1/3'
3  '-x+y,-x,z+2/3'
4  'y,x,-z'
5  'x-y,-y,-z+2/3'
6  '-x,-x+y,-z+1/3'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_symmetry_multiplicity
_atom_site_Wyckoff_symbol
Si1 Si 0.4697 0.0000 0.0000 1.0 3 a
O1  O  0.4133 0.2667 0.1188 1.0 6 c
`;

export const ELEMENTS: Record<string, { color: string; radius: number; covalent: number }> = {
  H: { color: "#f4f7fb", radius: 0.24, covalent: 0.31 },
  C: { color: "#4f5b6b", radius: 0.36, covalent: 0.76 },
  N: { color: "#4f79ff", radius: 0.34, covalent: 0.71 },
  O: { color: "#ff5570", radius: 0.34, covalent: 0.66 },
  F: { color: "#59df9a", radius: 0.33, covalent: 0.57 },
  Na: { color: "#9e7cff", radius: 0.48, covalent: 1.66 },
  Mg: { color: "#78d68a", radius: 0.45, covalent: 1.41 },
  Al: { color: "#b6a2a0", radius: 0.43, covalent: 1.21 },
  Si: { color: "#51d6e7", radius: 0.43, covalent: 1.11 },
  P: { color: "#ff9f43", radius: 0.4, covalent: 1.07 },
  S: { color: "#ffd84a", radius: 0.4, covalent: 1.05 },
  Cl: { color: "#51d983", radius: 0.42, covalent: 1.02 },
  K: { color: "#a85cff", radius: 0.56, covalent: 2.03 },
  Ca: { color: "#7dd36f", radius: 0.52, covalent: 1.76 },
  Ti: { color: "#96a6b8", radius: 0.46, covalent: 1.6 },
  Fe: { color: "#e57b43", radius: 0.46, covalent: 1.32 },
  Cu: { color: "#df8747", radius: 0.47, covalent: 1.32 },
  Zn: { color: "#8fa4bd", radius: 0.47, covalent: 1.22 },
  Br: { color: "#a94444", radius: 0.45, covalent: 1.2 },
  Ag: { color: "#c7d2df", radius: 0.5, covalent: 1.45 },
  I: { color: "#8b4cb6", radius: 0.5, covalent: 1.39 },
  Ba: { color: "#68c568", radius: 0.6, covalent: 2.15 },
};

const fallbackElement = { color: "#d6b2ff", radius: 0.43, covalent: 1.25 };

export function elementStyle(element: string) {
  return ELEMENTS[element] ?? fallbackElement;
}

function stripComment(line: string) {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "'" && !double) single = !single;
    if (line[i] === '"' && !single) double = !double;
    if (line[i] === "#" && !single && !double) return line.slice(0, i);
  }
  return line;
}

function lineTokens(line: string) {
  const clean = stripComment(line).trim();
  if (!clean) return [];
  return (clean.match(/'(?:[^']*)'|"(?:[^"]*)"|\S+/g) ?? []).map((value) => {
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      return value.slice(1, -1);
    }
    return value;
  });
}

type CifLoop = { headers: string[]; rows: string[][] };

function readCif(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const tags = new Map<string, string>();
  const loops: CifLoop[] = [];
  let dataName = "未命名晶体";

  for (let i = 0; i < lines.length; i += 1) {
    const tokens = lineTokens(lines[i]);
    if (!tokens.length) continue;
    const head = tokens[0].toLowerCase();
    if (head.startsWith("data_")) {
      dataName = tokens[0].slice(5).replace(/[_-]+/g, " ") || dataName;
      continue;
    }
    if (head === "loop_") {
      const headers: string[] = [];
      i += 1;
      while (i < lines.length) {
        const headerTokens = lineTokens(lines[i]);
        if (!headerTokens.length) {
          i += 1;
          continue;
        }
        if (!headerTokens[0].startsWith("_")) break;
        headers.push(headerTokens[0].toLowerCase());
        i += 1;
      }
      const values: string[] = [];
      while (i < lines.length) {
        const rowTokens = lineTokens(lines[i]);
        if (!rowTokens.length) {
          i += 1;
          continue;
        }
        const rowHead = rowTokens[0].toLowerCase();
        if (rowHead === "loop_" || rowHead.startsWith("data_") || rowHead.startsWith("save_") || rowHead === "stop_" || rowHead.startsWith("_")) {
          i -= 1;
          break;
        }
        values.push(...rowTokens);
        i += 1;
      }
      const rows: string[][] = [];
      for (let offset = 0; offset + headers.length <= values.length; offset += headers.length) {
        rows.push(values.slice(offset, offset + headers.length));
      }
      if (headers.length) loops.push({ headers, rows });
      continue;
    }
    if (head.startsWith("_")) {
      if (tokens.length > 1) {
        tags.set(head, tokens.slice(1).join(" "));
      } else {
        let next = i + 1;
        while (next < lines.length && !lineTokens(lines[next]).length) next += 1;
        const nextTokens = next < lines.length ? lineTokens(lines[next]) : [];
        if (nextTokens.length && !nextTokens[0].startsWith("_")) {
          tags.set(head, nextTokens.join(" "));
          i = next;
        }
      }
    }
  }
  return { tags, loops, dataName };
}

function numeric(value: string | undefined, fallback: number) {
  if (!value || value === "." || value === "?") return fallback;
  const parsed = Number.parseFloat(value.replace(/\([^)]*\)$/, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstTag(tags: Map<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = tags.get(alias.toLowerCase());
    if (value && value !== "." && value !== "?") return value;
  }
  return undefined;
}

function findColumn(loop: CifLoop, aliases: string[]) {
  for (const alias of aliases) {
    const index = loop.headers.indexOf(alias.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function fraction(value: string) {
  const clean = value.trim();
  if (clean.includes("/")) {
    const [a, b] = clean.split("/").map(Number);
    return b ? a / b : 0;
  }
  return Number(clean) || 0;
}

function parseCoordinate(expression: string): { row: Vec3; offset: number } {
  const row: Vec3 = [0, 0, 0];
  let offset = 0;
  const normalized = expression.replace(/\s+/g, "").replace(/−/g, "-");
  const terms = normalized.match(/[+-]?[^+-]+/g) ?? [];
  for (const raw of terms) {
    const sign = raw.startsWith("-") ? -1 : 1;
    const term = raw.replace(/^[+-]/, "");
    const variable = term.match(/[xyz]/i)?.[0]?.toLowerCase();
    if (variable) {
      const coefficientText = term.replace(/[xyz*]/gi, "");
      const coefficient = coefficientText ? fraction(coefficientText) : 1;
      row[{ x: 0, y: 1, z: 2 }[variable] as 0 | 1 | 2] += sign * coefficient;
    } else {
      offset += sign * fraction(term);
    }
  }
  return { row, offset };
}

function determinant(m: Mat3) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function multiplyMatrix(a: Mat3, b: Mat3): Mat3 {
  return a.map((row) =>
    [0, 1, 2].map((column) => row[0] * b[0][column] + row[1] * b[1][column] + row[2] * b[2][column]) as Vec3,
  ) as Mat3;
}

function matrixOrder(matrix: Mat3) {
  const identity: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let product = identity;
  for (let order = 1; order <= 12; order += 1) {
    product = multiplyMatrix(product, matrix);
    const matches = product.every((row, r) => row.every((value, c) => Math.abs(value - identity[r][c]) < 1e-5));
    if (matches) return order;
  }
  return 1;
}

const subscripts: Record<string, string> = { "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆" };

function describeOperation(matrix: Mat3, translation: Vec3) {
  const identity = matrix.every((row, r) => row.every((value, c) => Math.abs(value - (r === c ? 1 : 0)) < 1e-5));
  const negativeIdentity = matrix.every((row, r) => row.every((value, c) => Math.abs(value - (r === c ? -1 : 0)) < 1e-5));
  const det = Math.round(determinant(matrix));
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  const hasFractionalTranslation = translation.some((value) => Math.abs(value - Math.round(value)) > 1e-5);
  const order = matrixOrder(matrix);

  if (identity && !hasFractionalTranslation) return { kind: "identity" as const, label: "E", name: "恒等操作", order: 1 };
  if (negativeIdentity) return { kind: "inversion" as const, label: "ī", name: "反演中心", order: 2 };
  if (det < 0 && Math.abs(trace - 1) < 1e-5) {
    return hasFractionalTranslation
      ? { kind: "glide" as const, label: "g", name: "滑移反射", order: 2 }
      : { kind: "mirror" as const, label: "m", name: "镜面反射", order: 2 };
  }
  if (det > 0) {
    if (hasFractionalTranslation) {
      const axisCandidates: Vec3[] = [];
      for (let x = -2; x <= 2; x += 1) {
        for (let y = -2; y <= 2; y += 1) {
          for (let z = -2; z <= 2; z += 1) {
            if (!x && !y && !z) continue;
            const candidate: Vec3 = [x, y, z];
            const transformed = multiply(matrix, candidate);
            const residual = Math.hypot(
              transformed[0] - candidate[0],
              transformed[1] - candidate[1],
              transformed[2] - candidate[2],
            );
            if (residual < 1e-5) axisCandidates.push(candidate);
          }
        }
      }
      let axis = axisCandidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0] ?? [0, 0, 1] as Vec3;
      const firstNonZero = axis.find((value) => Math.abs(value) > 1e-6) ?? 1;
      if (firstNonZero < 0) axis = axis.map((value) => -value) as Vec3;
      const axisLengthSquared = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2 || 1;
      const axialTranslation = translation.reduce((sum, value, index) => sum + value * axis[index], 0) / axisLengthSquared;
      const wrappedTranslation = ((axialTranslation % 1) + 1) % 1;
      const screwIndex = Math.max(1, Math.min(order - 1, Math.round(wrappedTranslation * order) || 1));
      const screwLabel = `${order}${subscripts[String(screwIndex)] ?? screwIndex}`;
      return { kind: "screw" as const, label: screwLabel, name: `${screwLabel} 螺旋轴`, order };
    }
    return { kind: "rotation" as const, label: `C${subscripts[String(order)] ?? order}`, name: `${order} 重旋转`, order };
  }
  return { kind: "rotoinversion" as const, label: `S${subscripts[String(order)] ?? order}`, name: "旋转反演", order };
}

export function parseOperation(xyz: string, id: number): SymmetryOperation {
  const parts = xyz.replace(/[()]/g, "").split(",").map((part) => part.trim());
  if (parts.length !== 3) throw new Error(`无法解析对称操作：${xyz}`);
  const coordinates = parts.map(parseCoordinate);
  const matrix = coordinates.map((coordinate) => coordinate.row) as Mat3;
  const translation = coordinates.map((coordinate) => coordinate.offset) as Vec3;
  return { id, xyz: parts.join(", "), matrix, translation, ...describeOperation(matrix, translation) };
}

function multiply(matrix: Mat3, vector: Vec3): Vec3 {
  return matrix.map((row) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]) as Vec3;
}

function wrap(value: number) {
  const wrapped = value - Math.floor(value);
  return Math.abs(wrapped - 1) < 1e-8 ? 0 : wrapped;
}

export function applyOperation(operation: SymmetryOperation, fract: Vec3): Vec3 {
  const transformed = multiply(operation.matrix, fract);
  return transformed.map((value, index) => wrap(value + operation.translation[index])) as Vec3;
}

export function latticeVectors(cell: UnitCell): [Vec3, Vec3, Vec3] {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const alpha = radians(cell.alpha);
  const beta = radians(cell.beta);
  const gamma = radians(cell.gamma);
  const a: Vec3 = [cell.a, 0, 0];
  const b: Vec3 = [cell.b * Math.cos(gamma), cell.b * Math.sin(gamma), 0];
  const cx = cell.c * Math.cos(beta);
  const cy = cell.c * (Math.cos(alpha) - Math.cos(beta) * Math.cos(gamma)) / Math.max(Math.sin(gamma), 1e-8);
  const cz = Math.sqrt(Math.max(0, cell.c * cell.c - cx * cx - cy * cy));
  return [a, b, [cx, cy, cz]];
}

export function fractToCart(fract: Vec3, cell: UnitCell): Vec3 {
  const [a, b, c] = latticeVectors(cell);
  return [
    fract[0] * a[0] + fract[1] * b[0] + fract[2] * c[0],
    fract[0] * a[1] + fract[1] * b[1] + fract[2] * c[1],
    fract[0] * a[2] + fract[1] * b[2] + fract[2] * c[2],
  ];
}

function closeFract(a: Vec3, b: Vec3) {
  return a.every((value, index) => {
    const delta = Math.abs(value - b[index]);
    return Math.min(delta, 1 - delta) < 1e-4;
  });
}

function generateAtoms(sites: AtomSite[], operations: SymmetryOperation[], cell: UnitCell) {
  const atoms: AtomInstance[] = [];
  for (const site of sites) {
    for (const operation of operations) {
      const fract = applyOperation(operation, site.fract);
      const existing = atoms.find((atom) => atom.element === site.element && atom.source.label === site.label && closeFract(atom.fract, fract));
      if (existing) {
        existing.operationIds.push(operation.id);
      } else {
        atoms.push({
          id: `${site.label}-${atoms.length + 1}`,
          label: `${site.element}${atoms.filter((atom) => atom.element === site.element).length + 1}`,
          element: site.element,
          fract,
          cart: fractToCart(fract, cell),
          source: site,
          operationIds: [operation.id],
        });
      }
    }
  }
  return atoms;
}

function distancePeriodic(a: AtomInstance, b: AtomInstance, cell: UnitCell) {
  const delta = a.fract.map((value, index) => {
    const raw = value - b.fract[index];
    return raw - Math.round(raw);
  }) as Vec3;
  const cart = fractToCart(delta, cell);
  return Math.hypot(...cart);
}

function generateBonds(atoms: AtomInstance[], cell: UnitCell) {
  const bonds: Bond[] = [];
  for (let a = 0; a < atoms.length; a += 1) {
    for (let b = a + 1; b < atoms.length; b += 1) {
      const distance = distancePeriodic(atoms[a], atoms[b], cell);
      const threshold = (elementStyle(atoms[a].element).covalent + elementStyle(atoms[b].element).covalent) * 1.22;
      if (distance > 0.35 && distance <= threshold) {
        const imageShift = atoms[b].fract.map((value, index) => -Math.round(value - atoms[a].fract[index])) as Vec3;
        bonds.push({ a, b, distance, imageShift });
      }
    }
  }
  return bonds;
}

export function molecularComponentIds(atoms: AtomInstance[], bonds: Bond[]) {
  const adjacency: number[][] = Array.from({ length: atoms.length }, () => []);
  bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  });
  const componentIds = Array(atoms.length).fill(-1) as number[];
  let componentId = 0;
  for (let start = 0; start < atoms.length; start += 1) {
    if (componentIds[start] >= 0) continue;
    const queue = [start];
    componentIds[start] = componentId;
    while (queue.length) {
      const current = queue.shift()!;
      adjacency[current].forEach((target) => {
        if (componentIds[target] >= 0) return;
        componentIds[target] = componentId;
        queue.push(target);
      });
    }
    componentId += 1;
  }
  return componentIds;
}

function hydrogenBondStrength(hydrogenAcceptorDistance: number, donorAcceptorDistance: number, angle: number): HydrogenBond["strength"] {
  if (hydrogenAcceptorDistance <= 1.5 && donorAcceptorDistance <= 2.5 && angle >= 170) return "strong";
  if (hydrogenAcceptorDistance <= 2.2 && donorAcceptorDistance <= 3.2 && angle >= 130) return "moderate";
  return "weak";
}

/**
 * Geometry-based hydrogen-bond candidate search with periodic minimum images.
 * The result is a screening aid, not a claim that geometry alone proves bonding.
 */
export function findHydrogenBonds(structure: CrystalStructure, criteria: HydrogenBondCriteria) {
  const { atoms, bonds, cell } = structure;
  const adjacency: number[][] = Array.from({ length: atoms.length }, () => []);
  bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  });
  const componentIds = molecularComponentIds(atoms, bonds);
  const donorElements = new Set(criteria.donorElements);
  const acceptorElements = new Set(criteria.acceptorElements);
  const results: HydrogenBond[] = [];

  atoms.forEach((hydrogenAtom, hydrogen) => {
    if (hydrogenAtom.element !== "H") return;
    adjacency[hydrogen].forEach((donor) => {
      const donorAtom = atoms[donor];
      if (!donorElements.has(donorAtom.element)) return;
      const donorDelta = donorAtom.fract.map((value, axis) => {
        const raw = value - hydrogenAtom.fract[axis];
        return raw - Math.round(raw);
      }) as Vec3;
      const donorVector = fractToCart(donorDelta, cell);
      const donorHydrogenDistance = Math.hypot(...donorVector);
      if (donorHydrogenDistance < 0.35 || donorHydrogenDistance > 1.75) return;

      atoms.forEach((acceptorAtom, acceptor) => {
        if (acceptor === donor || acceptor === hydrogen || !acceptorElements.has(acceptorAtom.element)) return;
        if (adjacency[hydrogen].includes(acceptor)) return;
        const acceptorImageShift = acceptorAtom.fract.map((value, axis) => -Math.round(value - hydrogenAtom.fract[axis])) as Vec3;
        const acceptorDelta = acceptorAtom.fract.map((value, axis) => (
          value + acceptorImageShift[axis] - hydrogenAtom.fract[axis]
        )) as Vec3;
        const acceptorVector = fractToCart(acceptorDelta, cell);
        const hydrogenAcceptorDistance = Math.hypot(...acceptorVector);
        if (hydrogenAcceptorDistance < 0.65 || hydrogenAcceptorDistance > criteria.maxHydrogenAcceptorDistance) return;
        const donorAcceptorVector = acceptorVector.map((value, axis) => value - donorVector[axis]) as Vec3;
        const donorAcceptorDistance = Math.hypot(...donorAcceptorVector);
        if (donorAcceptorDistance > criteria.maxDonorAcceptorDistance) return;
        const cosine = Math.max(-1, Math.min(1, (
          donorVector[0] * acceptorVector[0] + donorVector[1] * acceptorVector[1] + donorVector[2] * acceptorVector[2]
        ) / Math.max(1e-8, donorHydrogenDistance * hydrogenAcceptorDistance)));
        const angle = Math.acos(cosine) * 180 / Math.PI;
        if (angle < criteria.minDonorHydrogenAcceptorAngle) return;

        results.push({
          donor,
          hydrogen,
          acceptor,
          hydrogenAcceptorDistance,
          donorAcceptorDistance,
          angle,
          acceptorImageShift,
          kind: componentIds[donor] === componentIds[acceptor] ? "intramolecular" : "intermolecular",
          strength: hydrogenBondStrength(hydrogenAcceptorDistance, donorAcceptorDistance, angle),
        });
      });
    });
  });

  return results.sort((a, b) => (
    Number(a.kind === "intermolecular") - Number(b.kind === "intermolecular")
    || a.hydrogenAcceptorDistance - b.hydrogenAcceptorDistance
    || b.angle - a.angle
  ));
}

export function molecularDisplayFracts(atoms: AtomInstance[], bonds: Bond[]) {
  const adjacency: Array<Array<{ target: number; shift: Vec3 }>> = Array.from({ length: atoms.length }, () => []);
  bonds.forEach((bond) => {
    adjacency[bond.a].push({ target: bond.b, shift: bond.imageShift });
    adjacency[bond.b].push({ target: bond.a, shift: bond.imageShift.map((value) => -value) as Vec3 });
  });

  const assigned: Array<Vec3 | undefined> = Array(atoms.length);
  const result = atoms.map((atom) => [...atom.fract] as Vec3);

  for (let start = 0; start < atoms.length; start += 1) {
    if (assigned[start]) continue;
    assigned[start] = [0, 0, 0];
    const queue = [start];
    const component: number[] = [];
    let periodicNetwork = false;

    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      const currentShift = assigned[current]!;
      adjacency[current].forEach(({ target, shift }) => {
        const expected = currentShift.map((value, index) => value + shift[index]) as Vec3;
        if (!assigned[target]) {
          assigned[target] = expected;
          queue.push(target);
        } else if (assigned[target]!.some((value, index) => Math.abs(value - expected[index]) > 1e-6)) {
          periodicNetwork = true;
        }
      });
    }

    if (periodicNetwork) continue;
    const centroid = component.reduce<Vec3>((sum, index) => {
      const shift = assigned[index]!;
      return sum.map((value, axis) => value + atoms[index].fract[axis] + shift[axis]) as Vec3;
    }, [0, 0, 0]).map((value) => value / component.length) as Vec3;
    const centerShift = centroid.map((value) => Math.round(0.5 - value)) as Vec3;
    component.forEach((index) => {
      result[index] = atoms[index].fract.map((value, axis) => value + assigned[index]![axis] + centerShift[axis]) as Vec3;
    });
  }

  return result;
}

function normalizeElement(value: string) {
  const match = value.match(/[A-Za-z]{1,2}/)?.[0] ?? "X";
  return match[0].toUpperCase() + match.slice(1).toLowerCase();
}

function pointGroupFromNumber(number?: number) {
  if (!number) return "未知";
  const ranges: Array<[number, number, string]> = [
    [1, 1, "1"], [2, 2, "-1"], [3, 5, "2"], [6, 9, "m"], [10, 15, "2/m"],
    [16, 24, "222"], [25, 46, "mm2"], [47, 74, "mmm"], [75, 80, "4"], [81, 82, "-4"],
    [83, 88, "4/m"], [89, 98, "422"], [99, 110, "4mm"], [111, 122, "-42m"], [123, 142, "4/mmm"],
    [143, 146, "3"], [147, 148, "-3"], [149, 155, "32"], [156, 161, "3m"], [162, 167, "-3m"],
    [168, 173, "6"], [174, 174, "-6"], [175, 176, "6/m"], [177, 182, "622"], [183, 186, "6mm"],
    [187, 190, "-6m2"], [191, 194, "6/mmm"], [195, 199, "23"], [200, 206, "m-3"], [207, 214, "432"],
    [215, 220, "-43m"], [221, 230, "m-3m"],
  ];
  return ranges.find(([start, end]) => number >= start && number <= end)?.[2] ?? "未知";
}

function crystalSystemFromNumber(number?: number) {
  if (!number) return "未知晶系";
  if (number <= 2) return "三斜晶系";
  if (number <= 15) return "单斜晶系";
  if (number <= 74) return "正交晶系";
  if (number <= 142) return "四方晶系";
  if (number <= 167) return "三方晶系";
  if (number <= 194) return "六方晶系";
  return "立方晶系";
}

function greatestCommonDivisor(a: number, b: number): number {
  return b ? greatestCommonDivisor(b, a % b) : a;
}

const unicodeDigits: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", ".": "." };

function formulaSubscript(value: number) {
  return value > 1 ? String(value).split("").map((digit) => unicodeDigits[digit] ?? digit).join("") : "";
}

function formulaFromCif(value?: string) {
  if (!value) return null;
  const counts = new Map<string, number>();
  for (const match of value.matchAll(/([A-Z][a-z]?)\s*(\d+(?:\.\d+)?)?/g)) {
    const element = match[1];
    const count = match[2] ? Number(match[2]) : 1;
    counts.set(element, (counts.get(element) ?? 0) + count);
  }
  if (!counts.size) return null;
  return [...counts.entries()]
    .sort(([a], [b]) => hillElementOrder(a, b, counts.has("C")))
    .map(([element, count]) => element + formulaSubscript(count))
    .join("");
}

function formulaFromAtoms(atoms: AtomInstance[]) {
  const counts = new Map<string, number>();
  atoms.forEach((atom) => counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1));
  const values = [...counts.values()];
  const divisor = values.reduce((result, count) => greatestCommonDivisor(result, count), values[0] ?? 1);
  return [...counts.entries()].sort(([a], [b]) => hillElementOrder(a, b, counts.has("C"))).map(([element, count]) => {
    const reduced = count / divisor;
    return element + formulaSubscript(reduced);
  }).join("");
}

export function hillElementOrder(a: string, b: string, containsCarbon = true) {
  if (!containsCarbon) return 0;
  if (containsCarbon) {
    if (a === "C") return b === "C" ? 0 : -1;
    if (b === "C") return 1;
    if (a === "H") return b === "H" ? 0 : -1;
    if (b === "H") return 1;
  }
  return a.localeCompare(b, "en");
}

export function parseCif(text: string): CrystalStructure {
  const { tags, loops, dataName } = readCif(text);
  const warnings: string[] = [];
  const cell: UnitCell = {
    a: numeric(firstTag(tags, ["_cell_length_a"]), 1),
    b: numeric(firstTag(tags, ["_cell_length_b"]), 1),
    c: numeric(firstTag(tags, ["_cell_length_c"]), 1),
    alpha: numeric(firstTag(tags, ["_cell_angle_alpha"]), 90),
    beta: numeric(firstTag(tags, ["_cell_angle_beta"]), 90),
    gamma: numeric(firstTag(tags, ["_cell_angle_gamma"]), 90),
  };
  const spaceGroup = firstTag(tags, ["_space_group_name_h-m_alt", "_symmetry_space_group_name_h-m", "_space_group_name_h-m_ref"]) ?? "P 1";
  const spaceGroupNumber = numeric(firstTag(tags, ["_space_group_it_number", "_symmetry_int_tables_number"]), 0) || undefined;
  const explicitPointGroup = firstTag(tags, ["_space_group_point_group_h-m", "_symmetry_point_group_name_h-m"]);
  const explicitFormula = firstTag(tags, ["_chemical_formula_sum", "_chemical_formula_structural"]);

  const atomLoop = loops.find((loop) => findColumn(loop, ["_atom_site_fract_x"]) >= 0 && findColumn(loop, ["_atom_site_fract_y"]) >= 0 && findColumn(loop, ["_atom_site_fract_z"]) >= 0);
  if (!atomLoop) throw new Error("CIF 中没有找到分数坐标 _atom_site_fract_x/y/z。");
  const ix = findColumn(atomLoop, ["_atom_site_fract_x"]);
  const iy = findColumn(atomLoop, ["_atom_site_fract_y"]);
  const iz = findColumn(atomLoop, ["_atom_site_fract_z"]);
  const ilabel = findColumn(atomLoop, ["_atom_site_label"]);
  const itype = findColumn(atomLoop, ["_atom_site_type_symbol"]);
  const iocc = findColumn(atomLoop, ["_atom_site_occupancy"]);
  const imult = findColumn(atomLoop, ["_atom_site_symmetry_multiplicity"]);
  const iwyckoff = findColumn(atomLoop, ["_atom_site_wyckoff_symbol", "_atom_site_wyckoff_label"]);
  const sites: AtomSite[] = atomLoop.rows.map((row, index) => {
    const label = ilabel >= 0 ? row[ilabel] : `A${index + 1}`;
    return {
      label,
      element: normalizeElement(itype >= 0 ? row[itype] : label),
      fract: [numeric(row[ix], 0), numeric(row[iy], 0), numeric(row[iz], 0)] as Vec3,
      occupancy: numeric(iocc >= 0 ? row[iocc] : undefined, 1),
      multiplicity: imult >= 0 ? numeric(row[imult], 0) || undefined : undefined,
      wyckoff: iwyckoff >= 0 && row[iwyckoff] !== "." ? row[iwyckoff] : "—",
    };
  }).filter((site) => site.occupancy > 0);

  const operationAliases = ["_space_group_symop_operation_xyz", "_symmetry_equiv_pos_as_xyz", "_space_group_symop.operation_xyz"];
  const operationLoop = loops.find((loop) => findColumn(loop, operationAliases) >= 0);
  let operations: SymmetryOperation[] = [];
  if (operationLoop) {
    const operationColumn = findColumn(operationLoop, operationAliases);
    operations = operationLoop.rows.map((row, index) => parseOperation(row[operationColumn], index + 1));
  } else {
    warnings.push("文件未包含对称操作列表，当前仅显示恒等操作；建议导出包含 symop loop 的 CIF。");
    operations = [parseOperation("x,y,z", 1)];
  }
  if (!sites.length) throw new Error("CIF 中没有可显示的原子位点。");
  const atoms = generateAtoms(sites, operations, cell);
  if (atoms.length > 1800) warnings.push("等价原子较多，视图已自动简化部分标签。");
  const bonds = atoms.length <= 500 ? generateBonds(atoms, cell) : [];
  return {
    name: firstTag(tags, ["_chemical_name_common", "_chemical_name_mineral", "_chemical_name_systematic"]) ?? dataName,
    cell,
    spaceGroup,
    spaceGroupNumber,
    pointGroup: explicitPointGroup ?? pointGroupFromNumber(spaceGroupNumber),
    crystalSystem: crystalSystemFromNumber(spaceGroupNumber),
    sites,
    operations,
    atoms,
    bonds,
    formula: formulaFromCif(explicitFormula) ?? formulaFromAtoms(atoms),
    warnings,
  };
}

export function formatFractional(value: number) {
  const wrapped = wrap(value);
  const candidates: Array<[number, number]> = [[0, 1], [1, 8], [1, 6], [1, 4], [1, 3], [3, 8], [1, 2], [5, 8], [2, 3], [3, 4], [5, 6], [7, 8], [1, 1]];
  const match = candidates.find(([numerator, denominator]) => Math.abs(wrapped - numerator / denominator) < 1e-4);
  if (!match) return wrapped.toFixed(4);
  if (match[0] === 0) return "0";
  if (match[0] === match[1]) return "1";
  return `${match[0]}/${match[1]}`;
}

export function operationKindLabel(kind: SymmetryOperation["kind"]) {
  return {
    identity: "恒等",
    rotation: "旋转轴",
    screw: "螺旋轴",
    mirror: "镜面",
    glide: "滑移面",
    inversion: "反演",
    rotoinversion: "旋转反演",
  }[kind];
}
