export type CharacterRow = {
  irrep: string;
  characters: number[];
  basis?: string;
};

export type PointGroupCharacterTable = {
  hm: string;
  schoenflies: string;
  system: "三斜" | "单斜" | "正交" | "四方" | "三方" | "六方" | "立方";
  classes: string[];
  rows: CharacterRow[];
};

const row = (irrep: string, characters: number[], basis = ""): CharacterRow => ({ irrep, characters, basis });

// Conventional orientation: the principal rotation axis is z. The tables use
// real physical bases, pairing conjugate complex irreps where appropriate.
export const characterTables: PointGroupCharacterTable[] = [
  {
    hm: "1", schoenflies: "C₁", system: "三斜", classes: ["E"],
    rows: [row("A", [1], "x, y, z; Rₓ, Rᵧ, Rz; all quadratic functions")],
  },
  {
    hm: "-1", schoenflies: "Cᵢ", system: "三斜", classes: ["E", "i"],
    rows: [
      row("A_g", [1, 1], "Rₓ, Rᵧ, Rz; x², y², z², xy, xz, yz"),
      row("A_u", [1, -1], "x, y, z"),
    ],
  },
  {
    hm: "2", schoenflies: "C₂", system: "单斜", classes: ["E", "C₂(z)"],
    rows: [
      row("A", [1, 1], "z, Rz; x², y², z², xy"),
      row("B", [1, -1], "x, y, Rₓ, Rᵧ; xz, yz"),
    ],
  },
  {
    hm: "m", schoenflies: "Cₛ", system: "单斜", classes: ["E", "σ(xy)"],
    rows: [
      row("A′", [1, 1], "x, y, Rz; x², y², z², xy"),
      row("A″", [1, -1], "z, Rₓ, Rᵧ; xz, yz"),
    ],
  },
  {
    hm: "2/m", schoenflies: "C₂ₕ", system: "单斜", classes: ["E", "C₂(z)", "i", "σ(xy)"],
    rows: [
      row("A_g", [1, 1, 1, 1], "Rz; x², y², z², xy"),
      row("B_g", [1, -1, 1, -1], "Rₓ, Rᵧ; xz, yz"),
      row("A_u", [1, 1, -1, -1], "z"),
      row("B_u", [1, -1, -1, 1], "x, y"),
    ],
  },
  {
    hm: "222", schoenflies: "D₂", system: "正交", classes: ["E", "C₂(z)", "C₂(y)", "C₂(x)"],
    rows: [
      row("A", [1, 1, 1, 1], "x², y², z²"),
      row("B₁", [1, 1, -1, -1], "z, Rz; xy"),
      row("B₂", [1, -1, 1, -1], "y, Rᵧ; xz"),
      row("B₃", [1, -1, -1, 1], "x, Rₓ; yz"),
    ],
  },
  {
    hm: "mm2", schoenflies: "C₂ᵥ", system: "正交", classes: ["E", "C₂(z)", "σ(xz)", "σ(yz)"],
    rows: [
      row("A₁", [1, 1, 1, 1], "z; x², y², z²"),
      row("A₂", [1, 1, -1, -1], "Rz; xy"),
      row("B₁", [1, -1, 1, -1], "x, Rᵧ; xz"),
      row("B₂", [1, -1, -1, 1], "y, Rₓ; yz"),
    ],
  },
  {
    hm: "mmm", schoenflies: "D₂ₕ", system: "正交", classes: ["E", "C₂(z)", "C₂(y)", "C₂(x)", "i", "σ(xy)", "σ(xz)", "σ(yz)"],
    rows: [
      row("A_g", [1, 1, 1, 1, 1, 1, 1, 1], "x², y², z²"),
      row("B₁g", [1, 1, -1, -1, 1, 1, -1, -1], "Rz; xy"),
      row("B₂g", [1, -1, 1, -1, 1, -1, 1, -1], "Rᵧ; xz"),
      row("B₃g", [1, -1, -1, 1, 1, -1, -1, 1], "Rₓ; yz"),
      row("A_u", [1, 1, 1, 1, -1, -1, -1, -1]),
      row("B₁u", [1, 1, -1, -1, -1, -1, 1, 1], "z"),
      row("B₂u", [1, -1, 1, -1, -1, 1, -1, 1], "y"),
      row("B₃u", [1, -1, -1, 1, -1, 1, 1, -1], "x"),
    ],
  },
  {
    hm: "4", schoenflies: "C₄", system: "四方", classes: ["E", "2C₄", "C₂"],
    rows: [
      row("A", [1, 1, 1], "z, Rz; x² + y², z²"),
      row("B", [1, -1, 1], "x² − y², xy"),
      row("E", [2, 0, -2], "(x, y), (Rₓ, Rᵧ); (xz, yz)"),
    ],
  },
  {
    hm: "-4", schoenflies: "S₄", system: "四方", classes: ["E", "2S₄", "C₂"],
    rows: [
      row("A", [1, 1, 1], "Rz; x² + y², z²"),
      row("B", [1, -1, 1], "z; x² − y², xy"),
      row("E", [2, 0, -2], "(x, y), (Rₓ, Rᵧ); (xz, yz)"),
    ],
  },
  {
    hm: "4/m", schoenflies: "C₄ₕ", system: "四方", classes: ["E", "2C₄", "C₂", "i", "2S₄", "σₕ"],
    rows: [
      row("A_g", [1, 1, 1, 1, 1, 1], "Rz; x² + y², z²"),
      row("B_g", [1, -1, 1, 1, -1, 1], "x² − y², xy"),
      row("E_g", [2, 0, -2, 2, 0, -2], "(Rₓ, Rᵧ); (xz, yz)"),
      row("A_u", [1, 1, 1, -1, -1, -1], "z"),
      row("B_u", [1, -1, 1, -1, 1, -1]),
      row("E_u", [2, 0, -2, -2, 0, 2], "(x, y)"),
    ],
  },
  {
    hm: "422", schoenflies: "D₄", system: "四方", classes: ["E", "2C₄", "C₂", "2C₂′", "2C₂″"],
    rows: [
      row("A₁", [1, 1, 1, 1, 1], "x² + y², z²"),
      row("A₂", [1, 1, 1, -1, -1], "z, Rz"),
      row("B₁", [1, -1, 1, 1, -1], "x² − y²"),
      row("B₂", [1, -1, 1, -1, 1], "xy"),
      row("E", [2, 0, -2, 0, 0], "(x, y), (Rₓ, Rᵧ); (xz, yz)"),
    ],
  },
  {
    hm: "4mm", schoenflies: "C₄ᵥ", system: "四方", classes: ["E", "2C₄", "C₂", "2σᵥ", "2σd"],
    rows: [
      row("A₁", [1, 1, 1, 1, 1], "z; x² + y², z²"),
      row("A₂", [1, 1, 1, -1, -1], "Rz"),
      row("B₁", [1, -1, 1, 1, -1], "x² − y²"),
      row("B₂", [1, -1, 1, -1, 1], "xy"),
      row("E", [2, 0, -2, 0, 0], "(x, y), (Rᵧ, −Rₓ); (xz, yz)"),
    ],
  },
  {
    hm: "-42m", schoenflies: "D₂d", system: "四方", classes: ["E", "2S₄", "C₂", "2C₂′", "2σd"],
    rows: [
      row("A₁", [1, 1, 1, 1, 1], "x² + y², z²"),
      row("A₂", [1, 1, 1, -1, -1], "Rz"),
      row("B₁", [1, -1, 1, 1, -1], "x² − y²"),
      row("B₂", [1, -1, 1, -1, 1], "z; xy"),
      row("E", [2, 0, -2, 0, 0], "(x, y), (Rₓ, Rᵧ); (xz, yz)"),
    ],
  },
  {
    hm: "4/mmm", schoenflies: "D₄ₕ", system: "四方", classes: ["E", "2C₄", "C₂", "2C₂′", "2C₂″", "i", "2S₄", "σₕ", "2σᵥ", "2σd"],
    rows: [
      row("A₁g", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "x² + y², z²"),
      row("A₂g", [1, 1, 1, -1, -1, 1, 1, 1, -1, -1], "Rz"),
      row("B₁g", [1, -1, 1, 1, -1, 1, -1, 1, 1, -1], "x² − y²"),
      row("B₂g", [1, -1, 1, -1, 1, 1, -1, 1, -1, 1], "xy"),
      row("E_g", [2, 0, -2, 0, 0, 2, 0, -2, 0, 0], "(Rₓ, Rᵧ); (xz, yz)"),
      row("A₁u", [1, 1, 1, 1, 1, -1, -1, -1, -1, -1]),
      row("A₂u", [1, 1, 1, -1, -1, -1, -1, -1, 1, 1], "z"),
      row("B₁u", [1, -1, 1, 1, -1, -1, 1, -1, -1, 1]),
      row("B₂u", [1, -1, 1, -1, 1, -1, 1, -1, 1, -1]),
      row("E_u", [2, 0, -2, 0, 0, -2, 0, 2, 0, 0], "(x, y)"),
    ],
  },
  {
    hm: "3", schoenflies: "C₃", system: "三方", classes: ["E", "2C₃"],
    rows: [
      row("A", [1, 1], "z, Rz; x² + y², z²"),
      row("E", [2, -1], "(x, y), (Rₓ, Rᵧ); (x² − y², 2xy); (xz, yz)"),
    ],
  },
  {
    hm: "-3", schoenflies: "C₃ᵢ", system: "三方", classes: ["E", "2C₃", "i", "2S₆"],
    rows: [
      row("A_g", [1, 1, 1, 1], "Rz; x² + y², z²"),
      row("E_g", [2, -1, 2, -1], "(Rₓ, Rᵧ); (x² − y², 2xy); (xz, yz)"),
      row("A_u", [1, 1, -1, -1], "z"),
      row("E_u", [2, -1, -2, 1], "(x, y)"),
    ],
  },
  {
    hm: "32", schoenflies: "D₃", system: "三方", classes: ["E", "2C₃", "3C₂′"],
    rows: [
      row("A₁", [1, 1, 1], "x² + y², z²"),
      row("A₂", [1, 1, -1], "z, Rz"),
      row("E", [2, -1, 0], "(x, y), (Rₓ, Rᵧ); (x² − y², 2xy); (xz, yz)"),
    ],
  },
  {
    hm: "3m", schoenflies: "C₃ᵥ", system: "三方", classes: ["E", "2C₃", "3σᵥ"],
    rows: [
      row("A₁", [1, 1, 1], "z; x² + y², z²"),
      row("A₂", [1, 1, -1], "Rz"),
      row("E", [2, -1, 0], "(x, y), (Rᵧ, −Rₓ); (x² − y², 2xy); (xz, yz)"),
    ],
  },
  {
    hm: "-3m", schoenflies: "D₃d", system: "三方", classes: ["E", "2C₃", "3C₂′", "i", "2S₆", "3σd"],
    rows: [
      row("A₁g", [1, 1, 1, 1, 1, 1], "x² + y², z²"),
      row("A₂g", [1, 1, -1, 1, 1, -1], "Rz"),
      row("E_g", [2, -1, 0, 2, -1, 0], "(Rₓ, Rᵧ); (x² − y², 2xy); (xz, yz)"),
      row("A₁u", [1, 1, 1, -1, -1, -1]),
      row("A₂u", [1, 1, -1, -1, -1, 1], "z"),
      row("E_u", [2, -1, 0, -2, 1, 0], "(x, y)"),
    ],
  },
  {
    hm: "6", schoenflies: "C₆", system: "六方", classes: ["E", "C₆⁺", "C₃⁺", "C₂", "C₃⁻", "C₆⁻"],
    rows: [
      row("A", [1, 1, 1, 1, 1, 1], "z, Rz; x² + y², z²"),
      row("B", [1, -1, 1, -1, 1, -1]),
      row("E₁", [2, 1, -1, -2, -1, 1], "(x, y), (Rₓ, Rᵧ); (xz, yz)"),
      row("E₂", [2, -1, -1, 2, -1, -1], "(x² − y², 2xy)"),
    ],
  },
  {
    hm: "-6", schoenflies: "C₃ₕ", system: "六方", classes: ["E", "C₃⁺", "C₃⁻", "σₕ", "S₃⁺", "S₃⁻"],
    rows: [
      row("A′", [1, 1, 1, 1, 1, 1], "Rz; x² + y², z²"),
      row("E′", [2, -1, -1, 2, -1, -1], "(x, y); (x² − y², 2xy)"),
      row("A″", [1, 1, 1, -1, -1, -1], "z"),
      row("E″", [2, -1, -1, -2, 1, 1], "(Rₓ, Rᵧ); (xz, yz)"),
    ],
  },
  {
    hm: "6/m", schoenflies: "C₆ₕ", system: "六方", classes: ["E", "2C₆", "2C₃", "C₂", "i", "2S₃", "2S₆", "σₕ"],
    rows: [
      row("A_g", [1, 1, 1, 1, 1, 1, 1, 1], "Rz; x² + y², z²"),
      row("B_g", [1, -1, 1, -1, 1, -1, 1, -1]),
      row("E₁g", [2, 1, -1, -2, 2, 1, -1, -2], "(Rₓ, Rᵧ); (xz, yz)"),
      row("E₂g", [2, -1, -1, 2, 2, -1, -1, 2], "(x² − y², 2xy)"),
      row("A_u", [1, 1, 1, 1, -1, -1, -1, -1], "z"),
      row("B_u", [1, -1, 1, -1, -1, 1, -1, 1]),
      row("E₁u", [2, 1, -1, -2, -2, -1, 1, 2], "(x, y)"),
      row("E₂u", [2, -1, -1, 2, -2, 1, 1, -2]),
    ],
  },
  {
    hm: "622", schoenflies: "D₆", system: "六方", classes: ["E", "2C₆", "2C₃", "C₂", "3C₂′", "3C₂″"],
    rows: [
      row("A₁", [1, 1, 1, 1, 1, 1], "x² + y², z²"),
      row("A₂", [1, 1, 1, 1, -1, -1], "z, Rz"),
      row("B₁", [1, -1, 1, -1, 1, -1]),
      row("B₂", [1, -1, 1, -1, -1, 1]),
      row("E₁", [2, 1, -1, -2, 0, 0], "(x, y), (Rₓ, Rᵧ); (xz, yz)"),
      row("E₂", [2, -1, -1, 2, 0, 0], "(x² − y², 2xy)"),
    ],
  },
  {
    hm: "6mm", schoenflies: "C₆ᵥ", system: "六方", classes: ["E", "2C₆", "2C₃", "C₂", "3σᵥ", "3σd"],
    rows: [
      row("A₁", [1, 1, 1, 1, 1, 1], "z; x² + y², z²"),
      row("A₂", [1, 1, 1, 1, -1, -1], "Rz"),
      row("B₁", [1, -1, 1, -1, 1, -1]),
      row("B₂", [1, -1, 1, -1, -1, 1]),
      row("E₁", [2, 1, -1, -2, 0, 0], "(x, y), (Rᵧ, −Rₓ); (xz, yz)"),
      row("E₂", [2, -1, -1, 2, 0, 0], "(x² − y², 2xy)"),
    ],
  },
  {
    hm: "-6m2", schoenflies: "D₃ₕ", system: "六方", classes: ["E", "2C₃", "3C₂′", "σₕ", "2S₃", "3σᵥ"],
    rows: [
      row("A₁′", [1, 1, 1, 1, 1, 1], "x² + y², z²"),
      row("A₂′", [1, 1, -1, 1, 1, -1], "Rz"),
      row("E′", [2, -1, 0, 2, -1, 0], "(x, y); (x² − y², 2xy)"),
      row("A₁″", [1, 1, 1, -1, -1, -1]),
      row("A₂″", [1, 1, -1, -1, -1, 1], "z"),
      row("E″", [2, -1, 0, -2, 1, 0], "(Rₓ, Rᵧ); (xz, yz)"),
    ],
  },
  {
    hm: "6/mmm", schoenflies: "D₆ₕ", system: "六方", classes: ["E", "2C₆", "2C₃", "C₂", "3C₂′", "3C₂″", "i", "2S₃", "2S₆", "σₕ", "3σd", "3σᵥ"],
    rows: [
      row("A₁g", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "x² + y², z²"),
      row("A₂g", [1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, -1], "Rz"),
      row("B₁g", [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1]),
      row("B₂g", [1, -1, 1, -1, -1, 1, 1, -1, 1, -1, -1, 1]),
      row("E₁g", [2, 1, -1, -2, 0, 0, 2, 1, -1, -2, 0, 0], "(Rₓ, Rᵧ); (xz, yz)"),
      row("E₂g", [2, -1, -1, 2, 0, 0, 2, -1, -1, 2, 0, 0], "(x² − y², 2xy)"),
      row("A₁u", [1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1]),
      row("A₂u", [1, 1, 1, 1, -1, -1, -1, -1, -1, -1, 1, 1], "z"),
      row("B₁u", [1, -1, 1, -1, 1, -1, -1, 1, -1, 1, -1, 1]),
      row("B₂u", [1, -1, 1, -1, -1, 1, -1, 1, -1, 1, 1, -1]),
      row("E₁u", [2, 1, -1, -2, 0, 0, -2, -1, 1, 2, 0, 0], "(x, y)"),
      row("E₂u", [2, -1, -1, 2, 0, 0, -2, 1, 1, -2, 0, 0]),
    ],
  },
  {
    hm: "23", schoenflies: "T", system: "立方", classes: ["E", "4C₃⁺", "4C₃⁻", "3C₂"],
    rows: [
      row("A", [1, 1, 1, 1], "x² + y² + z²"),
      row("E", [2, -1, -1, 2], "(√3(x² − y²), 2z² − x² − y²)"),
      row("T", [3, 0, 0, -1], "(x, y, z), (Rₓ, Rᵧ, Rz); (yz, xz, xy)"),
    ],
  },
  {
    hm: "m-3", schoenflies: "Tₕ", system: "立方", classes: ["E", "4C₃⁺", "4C₃⁻", "3C₂", "i", "4S₆⁺", "4S₆⁻", "3σₕ"],
    rows: [
      row("A_g", [1, 1, 1, 1, 1, 1, 1, 1], "x² + y² + z²"),
      row("E_g", [2, -1, -1, 2, 2, -1, -1, 2], "(√3(x² − y²), 2z² − x² − y²)"),
      row("T_g", [3, 0, 0, -1, 3, 0, 0, -1], "(Rₓ, Rᵧ, Rz); (yz, xz, xy)"),
      row("A_u", [1, 1, 1, 1, -1, -1, -1, -1]),
      row("E_u", [2, -1, -1, 2, -2, 1, 1, -2]),
      row("T_u", [3, 0, 0, -1, -3, 0, 0, 1], "(x, y, z)"),
    ],
  },
  {
    hm: "432", schoenflies: "O", system: "立方", classes: ["E", "8C₃", "3C₂", "6C₄", "6C₂′"],
    rows: [
      row("A₁", [1, 1, 1, 1, 1], "x² + y² + z²"),
      row("A₂", [1, 1, 1, -1, -1]),
      row("E", [2, -1, 2, 0, 0], "(√3(x² − y²), 2z² − x² − y²)"),
      row("T₁", [3, 0, -1, 1, -1], "(Rₓ, Rᵧ, Rz); (x, y, z)"),
      row("T₂", [3, 0, -1, -1, 1], "(yz, xz, xy)"),
    ],
  },
  {
    hm: "-43m", schoenflies: "T_d", system: "立方", classes: ["E", "8C₃", "3C₂", "6S₄", "6σd"],
    rows: [
      row("A₁", [1, 1, 1, 1, 1], "x² + y² + z²"),
      row("A₂", [1, 1, 1, -1, -1]),
      row("E", [2, -1, 2, 0, 0], "(√3(x² − y²), 2z² − x² − y²)"),
      row("T₁", [3, 0, -1, 1, -1], "(Rₓ, Rᵧ, Rz)"),
      row("T₂", [3, 0, -1, -1, 1], "(x, y, z); (yz, xz, xy)"),
    ],
  },
  {
    hm: "m-3m", schoenflies: "Oₕ", system: "立方", classes: ["E", "8C₃", "3C₂", "6C₄", "6C₂′", "i", "8S₆", "3σₕ", "6S₄", "6σd"],
    rows: [
      row("A₁g", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "x² + y² + z²"),
      row("A₂g", [1, 1, 1, -1, -1, 1, 1, 1, -1, -1]),
      row("E_g", [2, -1, 2, 0, 0, 2, -1, 2, 0, 0], "(√3(x² − y²), 2z² − x² − y²)"),
      row("T₁g", [3, 0, -1, 1, -1, 3, 0, -1, 1, -1], "(Rₓ, Rᵧ, Rz)"),
      row("T₂g", [3, 0, -1, -1, 1, 3, 0, -1, -1, 1], "(yz, xz, xy)"),
      row("A₁u", [1, 1, 1, 1, 1, -1, -1, -1, -1, -1]),
      row("A₂u", [1, 1, 1, -1, -1, -1, -1, -1, 1, 1]),
      row("E_u", [2, -1, 2, 0, 0, -2, 1, -2, 0, 0]),
      row("T₁u", [3, 0, -1, 1, -1, -3, 0, 1, -1, 1], "(x, y, z)"),
      row("T₂u", [3, 0, -1, -1, 1, -3, 0, 1, 1, -1]),
    ],
  },
];

const pointGroupAliases: Record<string, string> = {
  "2mm": "mm2", "m2m": "mm2",
  "-4m2": "-42m",
  "3m1": "3m", "31m": "3m",
  "-3m1": "-3m", "-31m": "-3m",
  "-62m": "-6m2",
};

export function normalizePointGroup(value: string) {
  const normalized = value.trim().replace(/\s+/g, "").replace(/−/g, "-");
  return pointGroupAliases[normalized] ?? normalized;
}

export function characterTableForPointGroup(value: string) {
  const normalized = normalizePointGroup(value);
  return characterTables.find((table) => table.hm === normalized) ?? characterTables[0];
}
