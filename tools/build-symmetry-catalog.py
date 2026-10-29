"""Build SymViz's complete offline symmetry-demonstration catalogue.

The catalogue contains every crystallographic space-group type:
68 polar + 92 centrosymmetric + 70 nonpolar acentric = 230 types. Geometry,
exact affine sets, explanatory text and the full
set of inversion centres in the closed conventional cell are validated here.
Gemmi 0.7.5 and numpy suffice to reproduce the offline build; --reference-pdf
can independently refresh the checked-in PSI rational-set certificate.
"""
from __future__ import annotations

import copy
import argparse
import hashlib
import importlib.util
import json
import math
import ast
import bisect
import re
from collections import Counter
from itertools import product
from datetime import datetime, timezone
from pathlib import Path
import sys

PROJECT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT / "outputs" / "polar-space-groups"
SOURCE_CATALOG = SOURCE_ROOT / "polar-space-groups.json"
DESTINATION = PROJECT / "public" / "symmetry-demo" / "catalog.json"
REPORT = PROJECT / "reports" / "symmetry-catalog-validation.json"
REFERENCE = PROJECT / "tools" / "symmetry-catalog-reference.json"
IUCR_228_SOURCE = PROJECT / "tools" / "symmetry-228-iucr-source.json"
PSI_212_SOURCE = PROJECT / "tools" / "symmetry-212-psi-source.json"
PREVIOUS_OPERATIONS = PROJECT / "tools" / "symmetry-160-operation-reference.json"
if (SOURCE_ROOT / "dependencies").is_dir():
    sys.path.insert(0, str(SOURCE_ROOT / "dependencies"))

import gemmi
import numpy as np

spec = importlib.util.spec_from_file_location("symviz_symmetry_geometry", PROJECT / "tools" / "symmetry-geometry.py")
geometry = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(geometry)

POLAR_IDS = (
    [1, 3, 4, 5, 6, 7, 8, 9]
    + list(range(25, 47)) + list(range(75, 81)) + list(range(99, 111))
    + list(range(143, 147)) + list(range(156, 162))
    + list(range(168, 174)) + list(range(183, 187))
)
RESTORED_IDS = {1, 4, 7}
CENTROSYMMETRIC_IDS = [2, 10, 11, 12, 13, 14, 15, *range(47, 75), *range(83, 89),
                       *range(123, 143), 147, 148, *range(162, 168), 175, 176,
                       *range(191, 195), *range(200, 207), *range(221, 231)]
NONPOLAR_ACENTRIC_IDS = [n for n in range(1, 231) if n not in POLAR_IDS and n not in CENTROSYMMETRIC_IDS]
EXPECTED_IDS = list(range(1, 231))
EPS = 1e-8
SAMPLE_POINTS = np.array([[.173, .287, .219], [.412, -.291, .583], [-.371, .119, .827], [.091, .733, -.167]])


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inversion_centers(operations):
    """c=(t+n)/2 for every (-I,t), using exact denominator-48 numerators.

    Boundary copies are retained in the *closed* [0,1]^3 cell.  They are
    equivalent across neighbouring cells, not extra independent centres.
    """
    centers = set()
    for op in operations:
        if not np.array_equal(op["R"], -np.eye(3, dtype=int)):
            continue
        tran = np.rint(np.asarray(op["t"]) * 24).astype(int) % 24
        choices = [[int(value + 24 * n) for n in (0, 1, 2) if value + 24 * n <= 48] for value in tran]
        centers.update(product(*choices))
    return [[value / 48 for value in center] for center in sorted(centers)]


def operation_key(R, t):
    r = np.asarray(R, dtype=int)
    translation = np.rint(np.asarray(t, dtype=float) * 24).astype(int) % 24
    return tuple(r.flat), tuple(translation)


def affine_set_fingerprint(operations):
    keys = sorted((tuple(int(value) for row in op["R"] for value in row),
                   tuple(int(round(value * 24)) % 24 for value in op["t"])) for op in operations)
    return hashlib.sha256(json.dumps(keys, separators=(",", ":")).encode("ascii")).hexdigest()


def operation_objects_fingerprint(operations):
    """Canonical complete objects; JSON numeric 1 and 1.0 are equivalent."""
    def normalize(value):
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    payload = json.dumps(normalize(operations), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def iucr_228_reference(group):
    """Independently transform the saved IUCr coordinate facts, not PSI rows."""
    source = json.loads(IUCR_228_SOURCE.read_text(encoding="utf-8"))
    maps = [gemmi.Op(xyz) for xyz in source["coordinateMaps"]]
    centring = source["centringTranslationsUnits1over24"]
    shift = np.asarray(source["originShiftUnits1over24"], dtype=int)
    source_keys, target_keys = set(), set()
    for op, center in product(maps, centring):
        R = np.asarray(op.rot, dtype=int) // op.DEN
        t24 = (np.asarray(op.tran, dtype=int) + center) % 24
        source_keys.add((tuple(int(v) for v in R.flat), tuple(int(v) for v in t24)))
        transformed = (t24 + shift - R @ shift) % 24
        target_keys.add((tuple(int(v) for v in R.flat), tuple(int(v) for v in transformed)))
    expected = {operation_key(op["R"], op["t"]) for op in group["operations"]}
    source_fingerprint = hashlib.sha256(json.dumps(sorted(source_keys), separators=(",", ":")).encode("ascii")).hexdigest()
    target_fingerprint = hashlib.sha256(json.dumps(sorted(target_keys), separators=(",", ":")).encode("ascii")).hexdigest()
    passed = len(maps) == 48 and len(source_keys) == 192 and len(target_keys) == 192 and target_keys == expected
    return {"passed": passed, "sourceUrl": source["sourceUrl"], "accessMethod": source["accessMethod"],
            "sourceOriginChoice": 1, "targetOriginChoice": 2, "coordinateMapCount": len(maps),
            "centringCount": len(centring), "operationCount": len(target_keys),
            "originShiftUnits1over24": shift.tolist(), "originTransform": source["originTransform"],
            "sourceFile": str(IUCR_228_SOURCE.relative_to(PROJECT)), "sourceFileSha256": digest(IUCR_228_SOURCE),
            "auditScript": source["auditScript"], "auditScriptSha256": source["auditScriptSha256"],
            "sourceAffineSetSha256": source_fingerprint, "targetAffineSetSha256": target_fingerprint}


def psi_212_reference(group):
    """Reconstruct a disclosed one-row PSI exception using independent closure.

    Parsing and affine multiplication below use Python integers only. No
    Gemmi generators or catalogue matrices enter the reconstruction; the
    catalogue is compared only after the source-derived group is complete.
    """
    source = json.loads(PSI_212_SOURCE.read_text(encoding="utf-8"))

    def parse(xyz):
        rows, translation = [], []
        for expression in xyz.split(","):
            match = re.fullmatch(r"([+-]?)([xyz])(?:([+-])(\d+)(?:/(\d+))?)?", expression)
            if not match:
                raise ValueError(f"Unsupported PSI coordinate fact: {expression}")
            row = [0, 0, 0]
            row["xyz".index(match[2])] = -1 if match[1] == "-" else 1
            rows.extend(row)
            numerator, denominator = int(match[4] or 0), int(match[5] or 1)
            if 24 % denominator:
                raise ValueError("Source translation is not on the exact denominator-24 grid")
            translation.append(((-1 if match[3] == "-" else 1) * numerator * (24 // denominator)) % 24)
        return tuple(rows), tuple(translation)

    def compose(left, right):
        R, t = left
        S, u = right
        product_R = tuple(sum(R[i * 3 + k] * S[k * 3 + j] for k in range(3)) for i in range(3) for j in range(3))
        product_t = tuple((t[i] + sum(R[i * 3 + k] * u[k] for k in range(3))) % 24 for i in range(3))
        return product_R, product_t

    printed = [parse(xyz) for xyz in source["coordinateMaps"]]
    excluded_index = source["excludedSourceRow1Based"] - 1
    trusted = [op for index, op in enumerate(printed) if index != excluded_index]
    trusted_set = set(trusted)
    derived = set(trusted)
    while True:
        additions = {compose(a, b) for a, b in product(derived, derived)} - derived
        if not additions:
            break
        derived.update(additions)
        if len(derived) > 192:
            raise ValueError("Source closure unexpectedly exceeds a crystallographic conventional cell")
    additions = derived - trusted_set
    witnesses = []
    for i, a in enumerate(printed):
        if i == excluded_index:
            continue
        for j, b in enumerate(printed):
            if j != excluded_index and compose(a, b) in additions:
                witnesses.append({"leftSourceRow1Based": i + 1, "rightSourceRow1Based": j + 1,
                                  "composition": "left after right", "result": compose(a, b)})
    expected = {operation_key(op["R"], op["t"]) for op in group["operations"]}
    fingerprint = hashlib.sha256(json.dumps(sorted(derived), separators=(",", ":")).encode("ascii")).hexdigest()
    passed = (len(printed) == 24 and len(trusted_set) == 23 and len(derived) == 24
              and printed[excluded_index] not in derived and len(additions) == 1
              and bool(witnesses) and derived == expected)
    return {"passed": passed, "method": source["method"], "sourceUrl": source["sourceUrl"],
            "pages": source["pages"], "sourcePdfSha256": source["sourcePdfSha256"],
            "sourceFile": str(PSI_212_SOURCE.relative_to(PROJECT)), "sourceFileSha256": digest(PSI_212_SOURCE),
            "printedCoordinateCount": len(printed), "trustedSourceRows": len(trusted_set),
            "reconstructedOperationCount": len(derived), "rawPrintedSetIsClosed": not bool(
                {compose(a, b) for a, b in product(printed, printed)} - set(printed)),
            "excludedSourceRow1Based": excluded_index + 1, "excludedPrintedMap": source["coordinateMaps"][excluded_index],
            "derivedMissingMaps": [op["xyz"] for op in group["operations"] if operation_key(op["R"], op["t"]) in additions],
            "sourceOnlyMultiplicationWitnesses": witnesses,
            "targetAffineSetSha256": fingerprint, "hallPrimarySourceUrl": source["hallPrimarySourceUrl"],
            "hallPrimaryValue": source["hallPrimaryValue"], "hallPrimaryAccessMethod": source["hallPrimaryAccessMethod"]}


def check_reference(groups):
    """Check exact rational sets against fingerprints from the parsed PSI PDF."""
    certificate = json.loads(REFERENCE.read_text(encoding="utf-8"))
    known = {entry["id"]: entry for entry in certificate["groups"]}
    results = []
    for group in groups:
        entry = known.get(group["id"])
        fingerprint = affine_set_fingerprint(group["operations"])
        matched = entry is not None and fingerprint == entry["affineSetSha256"] and len(group["operations"]) == entry["operationCount"]
        independently_matched = matched and entry.get("pdfConfirmed", True)
        primary_check = iucr_228_reference(group) if group["id"] == 228 else None
        closure_check = psi_212_reference(group) if group["id"] == 212 else None
        independently_confirmed = independently_matched or (matched and bool(
            (primary_check and primary_check["passed"]) or (closure_check and closure_check["passed"])))
        results.append({"id": group["id"], "status": "matched" if independently_matched else "not_matched_to_PSI" if matched else "failed",
                        "independentFullSetConfirmed": independently_confirmed,
                        "affineSetSha256": fingerprint, "operationCount": len(group["operations"]),
                        "pdfTag": entry.get("pdfTag") if entry else None,
                        "pages": entry.get("pages") if entry else None,
                        "matchingMethod": "previously_pdf_verified_exact_affine_set_fingerprint" if independently_matched else "iucr_primary_full_set_in_reference_setting" if primary_check and primary_check["passed"] else "independent_source_integer_closure_with_disclosed_one_row_error" if closure_check and closure_check["passed"] else "gemmi_exact_set_with_disclosed_PSI_exception",
                        "note": entry.get("note") if entry else None,
                        **({"alternatePrimarySource": primary_check} if primary_check else {}),
                        **({"alternateSourceClosure": closure_check} if closure_check else {})})
    failed = sum(result["status"] == "failed" for result in results)
    unavailable = sum(result["status"] == "not_matched_to_PSI" for result in results)
    return {"status": "passed" if not failed and not unavailable and len(results) == 230 else "partial" if not failed else "failed",
            "method": "Offline fingerprint verification against prior parsed PSI full-operation sets; PDF not downloaded or reparsed by this command",
            "sha256": certificate["sourcePdfSha256"], "sourceUrl": certificate["sourceUrl"],
            "referenceCertificateSha256": digest(REFERENCE), "matchedFullSets": len(results) - failed - unavailable,
            "failed": failed, "unavailable": unavailable, "groups": results}


def refresh_reference(groups, pdf_path):
    """Parse actual PSI rows and compare full exact affine sets, never names alone."""
    from pypdf import PdfReader
    pages = [page.extract_text() or "" for page in PdfReader(pdf_path).pages]
    starts, cursor = [], 0
    for page in pages:
        starts.append(cursor)
        cursor += len(page) + 2
    text = "\n\n".join(pages)
    headers = list(re.finditer(r"space group:\s*(\d+)(?::([^\s{]+))?\s+(\{[^\n]+\})", text))
    records = []
    for index, header in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(text)
        metadata = ast.literal_eval(header.group(3))
        rows = re.findall(r"\|\s*\{[^}]+\}\s*\|\s*([^|]+)\|", text[header.end():end], re.S)
        try:
            parsed = [gemmi.Op(re.sub(r"\s+", "", rhs).replace("−", "-")) for rhs in rows]
            operations = [{"R": (np.asarray(op.rot, dtype=int) // op.DEN).tolist(),
                           "t": (np.asarray(op.tran) / op.DEN).tolist()} for op in parsed]
            fingerprint = affine_set_fingerprint(operations)
        except Exception:
            fingerprint = None
        records.append({"id": int(header.group(1)), "affineSetSha256": fingerprint,
                        "operationCount": len(rows), "pdfHall": metadata["Hall"].strip(),
                        "pdfTag": header.group(1) + (":" + header.group(2) if header.group(2) else ""),
                        "pages": [bisect.bisect_right(starts, header.start()), bisect.bisect_right(starts, end - 1)]})
    entries, failures = [], []
    for group in groups:
        fingerprint = affine_set_fingerprint(group["operations"])
        candidates = [record for record in records if record["id"] == group["id"]
                      and record["operationCount"] == len(group["operations"])
                      and record["affineSetSha256"] == fingerprint]
        hall_matches = [r for r in candidates if " ".join(r["pdfHall"].split()) == " ".join(group["hall"].split())]
        if len(hall_matches) == 1:
            candidates = hall_matches
        if len(candidates) != 1:
            failures.append({"id": group["id"], "hall": group["hall"], "exactMatches": len(candidates)})
            alternate = iucr_228_reference(group) if group["id"] == 228 else None
            source_closure = psi_212_reference(group) if group["id"] == 212 else None
            entries.append({"id": group["id"], "operationCount": len(group["operations"]),
                            "affineSetSha256": fingerprint, "gemmiHall": group["hall"], "pdfConfirmed": False,
                            "primaryFullSetConfirmed": bool(alternate and alternate["passed"]),
                            "sourceClosureConfirmed": bool(source_closure and source_closure["passed"]),
                            **({"alternatePrimarySource": alternate} if alternate else {}),
                            **({"alternateSourceClosure": source_closure} if source_closure else {}),
                            "note": "No identical complete PSI coordinate set found for this reference setting; the saved IUCr No.228 origin-1 general-position list, expanded by F centring and transformed by p=(1/8,1/8,1/8), independently matches all 192 reference-origin-2 operations." if alternate and alternate["passed"] else "PSI No.212 row 16 is not closed with the other 23 rows. Independent exact integer closure of those 23 source rows reconstructs all 24 catalogue operations and gives the corrected map with explicit source-row multiplication witnesses. This is a source-closure reconstruction, not a direct full printed-set match." if source_closure and source_closure["passed"] else "No identical PSI full set found; not independently verified."})
            continue
        entry = {**candidates[0], "gemmiHall": group["hall"],
                 "pdfConfirmed": True,
                 "matchingMethod": "number_and_hall_and_exact_full_set" if hall_matches else "number_and_exact_full_set_equivalent_hall"}
        entries.append(entry)
    certificate = {"version": 2,
                   "sourceUrl": "https://www.psi.ch/sites/default/files/import/lns-diffraction/Support2EN/Symmetry_Elements_of_all_Space_Groups.pdf",
                   "sourcePdfSha256": digest(pdf_path), "pageCount": len(pages), "recordCount": len(records),
                   "method": "Actual PSI PDF coordinate rows independently parsed. pdfConfirmed marks direct full exact-set matches. Disclosed exceptions are checked separately by primary IUCr coordinates (No.228) or independent source-row integer closure (No.212); neither exception is claimed as a direct full PSI set match.",
                   "matchedFullSets": len(groups) - len(failures), "exceptions": failures,
                   "groups": entries}
    REFERENCE.write_text(json.dumps(certificate, ensure_ascii=False, indent=2), encoding="utf-8")


def operation_animation(operation, points, phase):
    """Animation audit independently compares geometric endpoints to affine maps."""
    Q, v = np.asarray(operation["Q"]), np.asarray(operation["v"])
    kind = operation["kind"]
    if kind == "identity":
        return points.copy()
    if kind == "translation":
        return points + phase * v
    if kind == "inversion":
        center = np.asarray(operation["center"])
        return center + (1 - 2 * phase) * (points - center)
    if kind in ("rotation", "screw"):
        axis, point = np.asarray(operation["axis"]), np.asarray(operation["point"])
        angle = phase * operation["angle"]
        shifted = points - point
        rotated = (shifted * math.cos(angle)
                   + np.cross(axis, shifted) * math.sin(angle)
                   + (shifted @ axis)[:, None] * axis * (1 - math.cos(angle)))
        return point + rotated + phase * np.asarray(operation["parallel"])
    if kind == "rotoinversion":
        axis, center = np.asarray(operation["axis"]), np.asarray(operation["center"])
        angle = min(1, 2 * phase) * operation["angle"]
        shifted = points - center
        rotated = (shifted * math.cos(angle) + np.cross(axis, shifted) * math.sin(angle)
                   + (shifted @ axis)[:, None] * axis * (1 - math.cos(angle)))
        return center + (1 - 2 * max(0, 2 * phase - 1)) * rotated
    normal = np.asarray(operation["normal"])
    distance = points @ normal - operation["planeD"]
    reflection, slide = min(1, 2 * phase), max(0, 2 * phase - 1)
    return points - 2 * reflection * distance[:, None] * normal + slide * np.asarray(operation["parallel"])


def validate(groups, source):
    checks, errors, maxima, group_reports = Counter(), [], Counter(), []

    def verify(name, condition, context):
        checks[name] += 1
        if not condition:
            errors.append({"check": name, **context})

    verify("group-count", len(groups) == 230, {})
    verify("polar-count", sum(group["polarGroup"] for group in groups) == 68, {})
    verify("polar-id-list", sorted(g["id"] for g in groups if g["polarGroup"]) == POLAR_IDS, {})
    verify("centrosymmetric-id-list", [g["id"] for g in groups if g["centrosymmetric"]] == CENTROSYMMETRIC_IDS, {})
    verify("nonpolar-acentric-id-list", [g["id"] for g in groups if g["nonpolarAcentric"]] == NONPOLAR_ACENTRIC_IDS, {})
    verify("nonpolar-acentric-count", sum(g["nonpolarAcentric"] for g in groups) == 70, {})
    verify("gemmi-centrosymmetric-inventory", [n for n in range(1, 231) if gemmi.get_spacegroup_reference_setting(n).is_centrosymmetric()] == CENTROSYMMETRIC_IDS, {})
    verify("unique-id-list", [g["id"] for g in groups] == EXPECTED_IDS, {})
    verify("operation-count", sum(len(group["operations"]) for group in groups) == 4425, {})
    old_by_id = {group["id"]: group for group in source["groups"]}
    old_operation_reference = json.loads(PREVIOUS_OPERATIONS.read_text(encoding="utf-8"))
    old_operation_by_id = {g["id"]: g for g in old_operation_reference["groups"]}
    verify("previous-160-reference-count", len(old_operation_by_id) == 160, {})
    for group in groups:
        gid, operations = group["id"], group["operations"]
        start_errors = len(errors)
        ctx = {"group": gid}
        A, Ai = np.asarray(group["A"]), np.asarray(group["Ai"])
        points = SAMPLE_POINTS @ A.T
        verify("nonempty-operations", bool(operations), ctx)
        verify("operation-count-metadata", len(operations) == group["operationCount"], ctx)
        verify("positive-cell", np.linalg.det(A) > EPS, ctx)
        verify("cell-inverse", np.max(np.abs(A @ Ai - np.eye(3))) < EPS, ctx)
        if gid in old_operation_by_id:
            verify("previous-160-operation-objects-preserved", operation_objects_fingerprint(operations)
                   == old_operation_by_id[gid]["operationObjectsSha256"], ctx)
        if gid in old_by_id and gid not in RESTORED_IDS:
            previous = old_by_id[gid]["operations"]
            verify("existing-operations-preserved", len(operations) == len(previous) and all(
                all(op.get(key) == value for key, value in old.items()) for op, old in zip(operations, previous)), ctx)
        keys = {operation_key(op["R"], op["t"]) for op in operations}
        verify("unique-operations", len(keys) == len(operations), ctx)
        verify("identity-present", operation_key(np.eye(3, dtype=int), np.zeros(3)) in keys, ctx)
        all_q = [np.asarray(operation["Q"]) for operation in operations]
        stacked = np.concatenate([Q - np.eye(3) for Q in all_q])
        computed_dimension = 3 - np.linalg.matrix_rank(stacked, tol=1e-8)
        verify("polar-dimension", computed_dimension == group["polarDimension"], ctx)
        verify("polar-classification", bool(computed_dimension) == group["polarGroup"], ctx)
        expected_dimension = 0 if not group["polarGroup"] else 3 if gid == 1 else 2 if gid in (6, 7, 8, 9) else 1
        verify("expected-polar-dimension", computed_dimension == expected_dimension, ctx)
        flags = [group["polarGroup"], group["centrosymmetric"], group["nonpolarAcentric"]]
        verify("category-exclusive", sum(flags) == 1, ctx)
        expected_category = "polar" if group["polarGroup"] else "centrosymmetric" if group["centrosymmetric"] else "nonpolar-acentric"
        verify("category-metadata", group["category"] == expected_category, ctx)
        inversion_ops = [op for op in operations if np.array_equal(op["R"], -np.eye(3, dtype=int))]
        verify("inversion-classification", bool(inversion_ops) == group["centrosymmetric"] == group["hasInversion"], ctx)
        centers_declared = group["inversionCenters"]
        center_keys = {tuple(int(round(v * 48)) for v in center) for center in centers_declared}
        verify("inversion-centers-unique", len(center_keys) == len(centers_declared), ctx)
        verify("inversion-centers-complete", centers_declared == inversion_centers(operations), ctx)
        weighted_count = 0
        for center in centers_declared:
            center = np.asarray(center)
            verify("inversion-center-in-closed-cell", np.all(center >= 0) and np.all(center <= 1), ctx)
            verify("inversion-center-valid-operation", operation_key(-np.eye(3, dtype=int), 2 * center) in keys, ctx)
            weighted_count += 2.0 ** -sum(abs(v) < EPS or abs(v - 1) < EPS for v in center)
        verify("inversion-centers-boundary-weight", weighted_count == 8 * len(inversion_ops), ctx)
        for op1 in operations:
            R1, t1 = np.asarray(op1["R"], dtype=int), np.asarray(op1["t"])
            for op2 in operations:
                R2, t2 = np.asarray(op2["R"], dtype=int), np.asarray(op2["t"])
                verify("affine-closure", operation_key(R1 @ R2, R1 @ t2 + t1) in keys, ctx)
        centers = []
        for operation, Q in zip(operations, all_q):
            R, t, v = np.asarray(operation["R"]), np.asarray(operation["t"]), np.asarray(operation["v"])
            op_ctx = {"group": gid, "operation": operation["id"], "xyz": operation["xyz"]}
            verify("operation-description", isinstance(operation.get("description"), str) and len(operation["description"]) >= 12, op_ctx)
            verify("operation-steps", isinstance(operation.get("steps"), list) and len(operation["steps"]) >= 2
                   and all(isinstance(step, str) and len(step) >= 4 for step in operation["steps"]), op_ctx)
            parsed = gemmi.Op(operation["xyz"])
            verify("formula-agrees-with-matrix", np.array_equal(R, np.asarray(parsed.rot) / parsed.DEN)
                   and np.max(np.abs(t - np.asarray(parsed.tran) / parsed.DEN)) < EPS, op_ctx)
            verify("cartesian-map", np.max(np.abs(Q - A @ R @ Ai)) < EPS
                   and np.max(np.abs(v - A @ t)) < EPS, op_ctx)
            determinant = np.linalg.det(Q)
            expected_sign = -1 if operation["kind"] in ("mirror", "glide", "inversion", "rotoinversion") else 1
            verify("operation-handedness", abs(determinant - expected_sign) < EPS, op_ctx)
            isometry = float(np.max(np.abs(Q.T @ Q - np.eye(3))))
            maxima["isometry"] = max(maxima["isometry"], isometry)
            verify("isometry", isometry < EPS, op_ctx)
            initial = operation_animation(operation, points, 0)
            final = operation_animation(operation, points, 1)
            endpoint = float(np.max(np.abs(final - (points @ Q.T + v))))
            maxima["animation-endpoint"] = max(maxima["animation-endpoint"], endpoint)
            verify("animation-start", np.max(np.abs(initial - points)) < EPS, op_ctx)
            verify("animation-endpoint", endpoint < EPS, op_ctx)
            verify("endpoint-distance-preserved", np.max(np.abs(
                np.linalg.norm(final[:, None] - final[None, :], axis=-1)
                - np.linalg.norm(points[:, None] - points[None, :], axis=-1))) < EPS, op_ctx)
            if operation["kind"] in ("rotation", "screw", "identity", "translation"):
                middle = operation_animation(operation, points, .413)
                verify("proper-midpoint-distance-preserved", np.max(np.abs(
                    np.linalg.norm(middle[:, None] - middle[None, :], axis=-1)
                    - np.linalg.norm(points[:, None] - points[None, :], axis=-1))) < EPS, op_ctx)
            if operation["kind"] in ("inversion", "rotoinversion"):
                center = np.asarray(operation["center"])
                verify("operation-fixed-center", np.max(np.abs(Q @ center + v - center)) < EPS, op_ctx)
            if operation["kind"] == "rotoinversion":
                verify("rotoinversion-axis", abs(np.linalg.norm(operation["axis"]) - 1) < EPS
                       and np.max(np.abs(Q @ operation["axis"] + operation["axis"])) < EPS, op_ctx)
            for direction in group["polarBasis"]:
                verify("polar-direction-fixed", np.max(np.abs(Q @ direction - direction)) < EPS, op_ctx)
            centers.append(np.mod(R @ SAMPLE_POINTS[0] + t, 1))
        minimum = min((np.linalg.norm(np.mod(a-b+.5, 1)-.5)
                       for index, a in enumerate(centers) for b in centers[index+1:]), default=1)
        verify("general-orbit-multiplicity", minimum > 1e-7, ctx)
        group_reports.append({"id": gid, "name": group["name"], "polarGroup": group["polarGroup"],
                              "centrosymmetric": group["centrosymmetric"], "nonpolarAcentric": group["nonpolarAcentric"],
                              "category": group["category"], "inversionCenterCount": len(centers_declared),
                              "operationCount": len(operations), "polarDimension": int(computed_dimension),
                              "passed": len(errors) == start_errors})
    return {"passed": not errors, "groupCount": len(groups), "polarGroupCount": 68,
            "centrosymmetricGroupCount": 92, "nonpolarAcentricGroupCount": 70,
            "operationCount": sum(len(g["operations"]) for g in groups),
            "checks": dict(checks), "checkCount": sum(checks.values()), "errorCount": len(errors),
            "errors": errors, "maxResiduals": dict(maxima), "groups": group_reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild-all", action="store_true", help="Recompute all group geometry from Gemmi, without importing any ignored exporter")
    parser.add_argument("--reference-pdf", type=Path, help="Refresh the exact-set certificate from this actual local PSI PDF before validating it")
    args = parser.parse_args()
    source_path = SOURCE_CATALOG if SOURCE_CATALOG.exists() else DESTINATION if DESTINATION.exists() else None
    if source_path:
        source_bytes = source_path.read_bytes()
        source = json.loads(source_bytes)
        source["groups"] = [group for group in source["groups"] if group["id"] in POLAR_IDS]
        source_sha = hashlib.sha256(source_bytes).hexdigest()
    else:
        source = {"sources": [
            {"id": "gemmi", "title": "Gemmi space-group table and exact operations", "version": gemmi.__version__, "url": "https://gemmi.readthedocs.io/en/stable/symmetry.html#groups-of-operations"},
            {"id": "psi", "title": "PSI Symmetry Elements of all Space Groups", "url": "https://www.psi.ch/sites/default/files/import/lns-diffraction/Support2EN/Symmetry_Elements_of_all_Space_Groups.pdf"},
        ], "groups": [geometry.build_group(number)[0] for number in POLAR_IDS]}
        source_sha = None
    assert sorted(group["id"] for group in source["groups"]) == POLAR_IDS
    groups = [geometry.build_group(number)[0] for number in POLAR_IDS] if args.rebuild_all else copy.deepcopy(source["groups"])
    for group in groups:
        gid = group["id"]
        if gid in RESTORED_IDS:
            restored, _, _, _ = geometry.build_group(gid)
            group.update(restored)
        group.update(polarGroup=True, reused=False, previouslyDemonstrated=gid in RESTORED_IDS)
    groups.extend(geometry.build_group(number)[0] for number in CENTROSYMMETRIC_IDS)
    groups.extend(geometry.build_group(number)[0] for number in NONPOLAR_ACENTRIC_IDS)
    groups.sort(key=lambda group: group["id"])
    for group in groups:
        group["polarGroup"] = group["id"] in POLAR_IDS
        group["centrosymmetric"] = group["id"] in CENTROSYMMETRIC_IDS
        group["nonpolarAcentric"] = group["id"] in NONPOLAR_ACENTRIC_IDS
        group["hasInversion"] = group["centrosymmetric"]
        group["category"] = "polar" if group["polarGroup"] else "centrosymmetric" if group["centrosymmetric"] else "nonpolar-acentric"
        group["reused"] = False
        group["previouslyDemonstrated"] = group["id"] in (1, 4, 7, 13)
        group["inversionCenters"] = inversion_centers(group["operations"])
        group["inversionCenterConvention"] = "闭合常规晶胞 [0,1]³；包含边界上的周期等价显示点，边界点不重复计入独立晶胞数目"
        group["inversionCenterHalfOpenCount"] = 8 * sum(op["kind"] == "inversion" for op in group["operations"])
        for operation in group["operations"]:
            geometry.operation_notes(operation, np.asarray(group["A"]), np.asarray(group["Ai"]))
    report = validate(groups, source)
    if not report["passed"]:
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"passed": False, "errorCount": report["errorCount"], "report": str(REPORT)}))
        return 1
    sources = [{key: value for key, value in entry.items() if key != "localPath"} for entry in source["sources"] if entry["id"] in ("gemmi", "psi")]
    if args.reference_pdf:
        refresh_reference(groups, args.reference_pdf)
    pdf_check = check_reference(groups)
    independent_count = sum(result["independentFullSetConfirmed"] for result in pdf_check["groups"])
    independent_check = {"status": "passed" if independent_count == len(groups) else "failed",
                         "matchedFullSets": independent_count, "groupCount": len(groups),
                         "PSIFullSets": pdf_check["matchedFullSets"],
                         "IUCrFullSets": sum(bool(r.get("alternatePrimarySource", {}).get("passed")) for r in pdf_check["groups"]),
                         "sourceClosureReconstructedSets": sum(bool(r.get("alternateSourceClosure", {}).get("passed")) for r in pdf_check["groups"]),
                         "method": "Direct PSI full exact-set matches plus IUCr No.228 coordinate facts and separately disclosed exact integer source-closure reconstruction of No.212",
                         "groups": [{"id": r["id"], "confirmed": r["independentFullSetConfirmed"], "method": r["matchingMethod"]} for r in pdf_check["groups"]]}
    iucr_source = json.loads(IUCR_228_SOURCE.read_text(encoding="utf-8"))
    sources.append({"id": "iucr-228", "title": "IUCr International Tables A1 No.228 general positions", "url": iucr_source["sourceUrl"],
                    "role": "Independent full 192-operation affine-set check, expanded from 48 origin-1 coordinate maps and F centring, then transformed to origin choice 2",
                    "accessMethod": iucr_source["accessMethod"], "sourceFileSha256": digest(IUCR_228_SOURCE)})
    sources.append({"id": "psi-212-closure", "title": "No.212 PSI source-row closure reconstruction with a disclosed printed-map error",
                    "url": "https://www.psi.ch/sites/default/files/import/lns-diffraction/Support2EN/Symmetry_Elements_of_all_Space_Groups.pdf",
                    "role": "Independent exact integer closure of 23 printed source rows reconstructs 24 maps; raw PSI row 16 is not claimed as matched",
                    "sourceFileSha256": digest(PSI_212_SOURCE)})
    sources.append({"id": "integrated-reference", "title": "Exact affine-set reference with per-group PSI verification status",
                    "sha256": digest(REFERENCE), "role": f"{independent_count}/230 complete representative sets supported: {pdf_check['matchedFullSets']} direct PSI full sets, IUCr No.228, and source-closure reconstruction of No.212. Both raw PSI exceptions remain explicitly recorded."})
    output = {"version": 3, "catalogueVersion": "symviz-complete-230-v1", "sources": sources,
              "polarGroupCount": 68, "centrosymmetricGroupCount": 92, "nonpolarAcentricGroupCount": 70,
              "groupCount": 230, "operationCount": 4425, "groups": groups}
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    report.update(generatedAt=datetime.now(timezone.utc).isoformat(), gemmiVersion=gemmi.__version__,
                  cataloguePath=str(DESTINATION.relative_to(PROJECT)), catalogueSha256=digest(DESTINATION),
                  sourceCatalogueSha256=source_sha,
                  sourceCataloguePath=str(source_path.relative_to(PROJECT)) if source_path else None,
                  originalCatalogueUnchanged=digest(SOURCE_CATALOG) == source_sha if source_path == SOURCE_CATALOG else None,
                  pdfCrossCheck=pdf_check,
                  independentFullSetCrossCheck=independent_check,
                  previous160OperationReferenceSha256=digest(PREVIOUS_OPERATIONS),
                  sourceFullOperationCrossCheck=f"{independent_count}/230 full sets supported: {pdf_check['matchedFullSets']} direct PSI coordinate sets, IUCr No.228 coordinate facts with explicit origin transform, and independent exact source-row closure reconstruction for No.212. All 230 pass exact Gemmi and mathematical validation. Use --reference-pdf to reproduce PDF parsing.")
    report["passed"] = report["passed"] and pdf_check["failed"] == 0 and independent_check["status"] == "passed"
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ["passed", "groupCount", "polarGroupCount", "centrosymmetricGroupCount", "nonpolarAcentricGroupCount", "operationCount", "checkCount", "errorCount", "maxResiduals"]}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
