"""Symmetry geometry and reference settings used by the offline catalogue builder.

These pure helpers retain the previously validated exporter mathematics; no
runtime imports, downloads or filesystem writes occur in this module.
"""
from __future__ import annotations
import math
from fractions import Fraction
from functools import reduce
import gemmi
import numpy as np
EPS = 1e-9
REUSED = {1, 4, 7}

def clean(value):
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return 0 if abs(value) < 1e-12 else round(float(value), 12)
    return value

def scalar(value: float) -> str:
    if abs(value) < 1e-9:
        return "0"
    f = Fraction(float(value)).limit_denominator(192)
    if abs(float(f) - value) < 1e-8:
        return str(f.numerator) if f.denominator == 1 else f"{f.numerator}/{f.denominator}"
    return f"{value:.6f}".rstrip("0").rstrip(".")

def vector(values) -> str:
    return "(" + ", ".join(scalar(float(v)) for v in values) + ")"

def normsign(unit, preferred=None):
    unit = np.asarray(unit, dtype=float)
    unit /= np.linalg.norm(unit)
    if preferred is not None:
        dot = float(unit @ preferred)
        if abs(dot) > 1e-8:
            return unit if dot > 0 else -unit
    for component in unit:
        if abs(component) > 1e-8:
            return unit if component > 0 else -unit
    raise ValueError("Zero direction")

def cell_for(number: int, system: str):
    if number in (1, 2):
        return [1.15, 1, 1.3, 80, 105, 75]
    if system == "monoclinic":
        return [1.25, 1.45, 1.15, 90, 105, 90]
    if system == "orthorhombic":
        return [1.25, 1.45, 1.1, 90, 90, 90]
    if system == "tetragonal":
        return [1.25, 1.25, 1.6, 90, 90, 90]
    if system in ("trigonal", "hexagonal"):
        return [1.3, 1.3, 1.8, 90, 90, 120]
    if system == "cubic":
        return [1.3, 1.3, 1.3, 90, 90, 90]
    raise ValueError((number, system))

def basis_matrix(cell):
    a, b, c, alpha, beta, gamma = cell
    alpha, beta, gamma = np.deg2rad([alpha, beta, gamma])
    cx = c * math.cos(beta)
    cy = c * (math.cos(alpha) - math.cos(beta) * math.cos(gamma)) / math.sin(gamma)
    cz_sq = c * c - cx * cx - cy * cy
    if cz_sq <= 0:
        raise ValueError("Invalid unit-cell metric")
    return np.array([[a, b * math.cos(gamma), cx], [0, b * math.sin(gamma), cy], [0, 0, math.sqrt(cz_sq)]])

def reference_group(number):
    if number == 7:
        return gemmi.SpaceGroup("P 1 n 1")
    if number == 13:
        return gemmi.SpaceGroup("P 1 2/n 1")
    reference = gemmi.get_spacegroup_reference_setting(number)
    if reference.hm.startswith("R "):
        return gemmi.SpaceGroup(reference.hm + ":H")
    return reference

def plane_equation(normal, plane_d, A):
    coefficients = A.T @ normal
    coefficients /= np.max(np.abs(coefficients))
    divisor = np.max(np.abs(A.T @ normal))
    rhs = float(plane_d / divisor)
    fractions = [Fraction(float(v)).limit_denominator(24) for v in coefficients]
    if max(abs(float(f) - v) for f, v in zip(fractions, coefficients)) < 1e-8:
        lcm = math.lcm(*(f.denominator for f in fractions))
        integers = [int(f * lcm) for f in fractions]
        gcd = reduce(math.gcd, [abs(i) for i in integers if i])
        factor = lcm / gcd
        coefficients *= factor
        rhs *= factor
    first = next(v for v in coefficients if abs(v) > 1e-8)
    if first < 0:
        coefficients *= -1
        rhs *= -1
    terms = []
    for coefficient, name in zip(coefficients, "xyz"):
        if abs(coefficient) < 1e-8:
            continue
        sign = "−" if coefficient < 0 else "+"
        magnitude = "" if abs(abs(coefficient) - 1) < 1e-8 else scalar(abs(coefficient)) + "·"
        terms.append((sign, magnitude + name))
    result = ""
    for i, (sign, term) in enumerate(terms):
        result += (("−" if sign == "−" else "") if i == 0 else f" {sign} ") + term
    return result + " = " + scalar(rhs)

def decompose(op, operation_id, A, Ai, preferred_axis):
    R = np.asarray(op.rot, dtype=int) // op.DEN
    t = np.asarray(op.tran, dtype=float) / op.DEN
    Q = A @ R @ Ai
    v = A @ t
    result = dict(id=operation_id, xyz=op.triplet(), R=clean(R), t=clean(t), Q=clean(Q), v=clean(v),
                  kind=None, label=None, axis=None, point=None, angle=0, parallel=None,
                  normal=None, planeD=None, geometryText=None)
    I = np.eye(3)
    if np.max(np.abs(Q - I)) < EPS:
        if np.linalg.norm(v) < EPS:
            result.update(kind="identity", label="恒等", geometryText="恒等：位置与取向不变")
        else:
            result.update(kind="translation", label="中心化平移", parallel=clean(v),
                          geometryText=f"纯平移：分数位移 {vector(t)}；取向不变")
        return result
    determinant = np.linalg.det(Q)
    if determinant > 0:
        _, _, vt = np.linalg.svd(I - Q)
        axis = normsign(vt[-1], preferred_axis)
        sine = float(axis @ np.array([Q[2, 1] - Q[1, 2], Q[0, 2] - Q[2, 0], Q[1, 0] - Q[0, 1]]) / 2)
        cosine = float(np.clip((np.trace(Q) - 1) / 2, -1, 1))
        angle = math.atan2(sine, cosine)
        if abs(abs(angle) - math.pi) < 1e-8:
            angle = math.pi
        parallel = axis * float(axis @ v)
        point = np.linalg.lstsq(I - Q, v - parallel, rcond=None)[0]
        axis_fractional = Ai @ axis
        axis_fractional /= np.max(np.abs(axis_fractional))
        point_fractional = Ai @ point
        parallel_fractional = Ai @ parallel
        screw = np.linalg.norm(parallel) > EPS
        order = int(round(2 * math.pi / abs(angle)))
        signed_degrees = f"{math.degrees(angle):+.6f}".rstrip("0").rstrip(".")
        result.update(kind="screw" if screw else "rotation", label=f"{order} 重螺旋" if screw else f"{order} 重旋转",
                      axis=clean(axis), point=clean(point), angle=clean(angle), parallel=clean(parallel),
                      geometryText=f"轴：{vector(point_fractional)} + λ{vector(axis_fractional)}；转角 {signed_degrees}°；轴向位移 {vector(parallel_fractional)}")
        return result
    if np.max(np.abs(Q + I)) < EPS:
        center = v / 2
        result.update(kind="inversion", label="反演", point=clean(center), center=clean(center),
                      centerFractional=clean(Ai @ center),
                      geometryText=f"反演中心：{vector(Ai @ center)}；三个相对坐标同时反号")
        return result
    if np.max(np.abs(Q @ Q - I)) > 1e-8 or abs(np.trace(Q) - 1) > 1e-8:
        # Every non-mirror improper isometry here has a unique fixed point.
        # Q=-S; rotate by the proper S about that point, then invert there.
        S = -Q
        _, _, vt = np.linalg.svd(I - S)
        axis = normsign(vt[-1], preferred_axis)
        sine = float(axis @ np.array([S[2, 1] - S[1, 2], S[0, 2] - S[2, 0], S[1, 0] - S[0, 1]]) / 2)
        cosine = float(np.clip((np.trace(S) - 1) / 2, -1, 1))
        angle = math.atan2(sine, cosine)
        if abs(abs(angle) - math.pi) < 1e-8:
            angle = math.pi
        center = np.linalg.solve(I - Q, v)
        order = int(round(2 * math.pi / abs(angle)))
        direction = Ai @ axis
        direction /= np.max(np.abs(direction))
        degrees = scalar(math.degrees(angle))
        result.update(kind="rotoinversion", label=f"{order} 重旋转反演", axis=clean(axis),
                      point=clean(center), center=clean(center), centerFractional=clean(Ai @ center),
                      angle=clean(angle), parallel=[0, 0, 0],
                      geometryText=f"旋转反演：经过 {vector(Ai @ center)}、沿 {vector(direction)} 的轴；先转 {degrees}°，再关于该点反演")
        return result
    _, _, vt = np.linalg.svd(Q + I)
    normal = normsign(vt[-1])
    fractional_coefficients = A.T @ normal
    first_nonzero = next(value for value in fractional_coefficients if abs(value) > 1e-8)
    if first_nonzero < 0:
        normal *= -1
    perpendicular = normal * float(normal @ v)
    plane_d = float(normal @ v) / 2
    parallel = v - perpendicular
    is_glide = np.linalg.norm(parallel) > EPS
    equation = plane_equation(normal, plane_d, A)
    result.update(kind="glide" if is_glide else "mirror", label="滑移反射" if is_glide else "镜面反射",
                  normal=clean(normal), planeD=clean(plane_d), parallel=clean(parallel),
                  geometryText=f"{'滑移面' if is_glide else '镜面'}：{equation}；面内滑移向量 {vector(Ai @ parallel)}")
    return result

def operation_notes(operation, A, Ai):
    """Plain Chinese explanations use the same affine geometry as the renderer."""
    kind = operation["kind"]
    target = f"最终分数坐标为 ({operation['xyz']})。"
    if kind == "identity":
        description = "恒等操作保持基元的位置、取向和手性不变。"
        steps = ["保持每个点的三个分数坐标不变。", target]
    elif kind == "translation":
        displacement = vector(operation["t"])
        description = f"把整个基元沿分数位移向量 {displacement} 平移，基元的取向和手性保持不变。"
        steps = [f"给每个点加上相同的分数位移 {displacement}。", target]
    elif kind in ("rotation", "screw"):
        direction = Ai @ np.asarray(operation["axis"])
        direction /= np.max(np.abs(direction))
        point = vector(Ai @ np.asarray(operation["point"]))
        angle = scalar(math.degrees(operation["angle"]))
        axis = f"经过分数点 {point}、沿分数方向 {vector(direction)} 的轴"
        rotate = f"绕{axis}按右手规则旋转 {angle}°。"
        if kind == "screw":
            shift = vector(Ai @ np.asarray(operation["parallel"]))
            description = f"螺旋操作把绕轴旋转与沿同一轴平移组合；基元的手性保持不变。"
            steps = [rotate, f"同时沿该轴平移，分数位移为 {shift}。", target]
        else:
            description = "旋转操作使基元绕指定轴转动，轴上的点保持不动，基元的手性保持不变。"
            steps = [rotate, target]
    elif kind in ("mirror", "glide"):
        equation = plane_equation(np.asarray(operation["normal"]), operation["planeD"], A)
        mirror = f"关于平面 {equation} 镜映：点在平面法向上的相对位置反号，面内位置保持不变。"
        if kind == "glide":
            shift = vector(Ai @ np.asarray(operation["parallel"]))
            description = "滑移反射先镜映，再沿该平面平移；映射后的基元手性与原来相反。"
            steps = [mirror, f"沿平面平移，分数位移向量为 {shift}。", target]
        else:
            description = "镜面反射把基元映到平面另一侧的等距位置，平面上的点保持不动；基元的手性反转。"
            steps = [mirror, target]
    elif kind == "inversion":
        center = vector(Ai @ np.asarray(operation["center"]))
        description = f"以分数点 {center} 为反演中心，每个点与它的映射像位于中心两侧，距离相同；基元手性反转。"
        steps = [f"从每个点减去反演中心 {center}，得到相对坐标。", "把三个相对坐标同时变号，再加回中心，即 r′ = 2c − r。", target]
    elif kind == "rotoinversion":
        center = vector(Ai @ np.asarray(operation["center"]))
        direction = Ai @ np.asarray(operation["axis"])
        direction /= np.max(np.abs(direction))
        angle = scalar(math.degrees(operation["angle"]))
        description = "旋转反演把旋转与点反演组合成一个对称操作，基元手性反转。复合操作的固定点不应单独当作一个反演操作。"
        steps = [f"先绕经过分数点 {center}、沿分数方向 {vector(direction)} 的轴，按右手规则旋转 {angle}°。", f"再把旋转后的基元关于分数点 {center} 反演。", target]
    else:
        raise ValueError(f"No explanation for {kind}")
    operation.update(description=description, steps=steps)


def polar_info(rotations, Qs, point_group, A):
    stacked = np.vstack([Q - np.eye(3) for Q in Qs])
    _, singular, vt = np.linalg.svd(stacked)
    rank = int(np.sum(singular > 1e-8))
    dimension = 3 - rank
    fractional_basis = [np.eye(3)[i].tolist() for i in range(3) if all(np.max(np.abs(R @ np.eye(3)[i] - np.eye(3)[i])) < EPS for R in rotations)]
    if len(fractional_basis) != dimension:
        raise ValueError("Unexpected non-coordinate polar subspace in chosen reference setting")
    basis = [clean((A @ direction) / np.linalg.norm(A @ direction)) for direction in fractional_basis]
    if dimension == 0:
        text = "无（对称性禁止非零宏观极性矢量）"
    elif point_group == "1":
        text = "任意方向（a、b、c 三方向独立）"
    elif point_group == "m":
        text = "ac 平面内任意方向"
    elif point_group == "2":
        text = "沿 b 轴"
    else:
        text = "沿 c 轴"
    return text, dimension, basis, fractional_basis

def build_group(number):
    sg = reference_group(number)
    system, pg = sg.crystal_system_str(), sg.point_group_hm()
    cell = cell_for(number, system)
    A = basis_matrix(cell)
    Ai = np.linalg.inv(A)
    all_ops = list(sg.operations())
    preferred = (A[:, 1] if system == "monoclinic" else A[:, 2]).copy()
    preferred /= np.linalg.norm(preferred)
    operations = [decompose(op, i + 1, A, Ai, preferred) for i, op in enumerate(all_ops)]
    rotations = [np.asarray(op.rot, dtype=int) // op.DEN for op in all_ops]
    Qs = [A @ R @ Ai for R in rotations]
    polar, dimension, polar_basis, fractional_basis = polar_info(rotations, Qs, pg, A)
    hm, name = sg.hm, sg.hm.replace(" ", "")
    if number in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15):
        name = {1: "P1", 2: "P-1", 3: "P2", 4: "P21", 5: "C2", 6: "Pm", 7: "Pn", 8: "Cm", 9: "Cc", 10: "P2/m", 11: "P21/m", 12: "C2/m", 13: "P2/n", 14: "P21/c", 15: "C2/c"}[number]
    aliases = []
    legacy_hm = None
    if number in (39, 41, 64, 67, 68):
        legacy_hm = hm
        aliases = [name, hm]
        name, hm = {39: ("Aem2", "A e m 2"), 41: ("Aea2", "A e a 2"),
                    64: ("Cmce", "C m c e"), 67: ("Cmme", "C m m e"), 68: ("Ccce", "C c c e")}[number]
    if number == 7:
        name = "Pn"
        aliases = ["Pc", "P 1 c 1"]
    if number == 13:
        aliases = ["P2/c (No.13, b1)"]
    setting = "b2 (P 1 n 1)" if number == 7 else "b2 (P 1 2/n 1)" if number == 13 else ("H (六方轴)" if sg.hm.startswith("R ") else "reference")
    group = dict(id=number, name=name, hm=hm, setting=setting, hall=sg.hall, pointGroup=pg, system=system,
                 polar=polar, polarDimension=dimension, polarBasis=polar_basis, polarFractionalBasis=fractional_basis, reused=number in REUSED,
                 cell=cell, A=clean(A), Ai=clean(Ai), operations=operations, aliases=aliases,
                 xhm=sg.xhm(), basisop=sg.basisop.triplet(), operationCount=len(operations))
    if legacy_hm:
        group["legacyHm"] = legacy_hm
    return group, all_ops, A, Ai
