"""Derive cell-clipped symmetry elements from all exact affine representatives.

Every representative (R,t) is lifted by integer translations.  Rotation-axis
lifts are complete after reducing the parallel displacement modulo a primitive
integer vector along the axis.  Plane offsets follow h.r=(h.t+k)/2.  Improper
rotations with a fixed point use the exact finite bounds (I-R)[0,1]^3-t.
The output is a geometric diagram, not a scan of an International Tables plate.
"""
from __future__ import annotations
import hashlib
import itertools
import json
import math
from collections import Counter
from fractions import Fraction
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
DEPENDENCIES = ROOT / 'outputs/polar-space-groups/dependencies'
if DEPENDENCIES.is_dir():
    sys.path.insert(0, str(DEPENDENCIES))
import numpy as np

EPS = 1e-7
IDENTITY = np.eye(3)

def clean(value):
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (np.integer, int)):
        return int(value)
    v = float(value)
    return 0 if abs(v) < 1e-10 else round(v, 10)

def rational_key(value):
    return tuple(round(float(v), 7) for v in np.asarray(value).flat)

def primitive(vector):
    v = np.asarray(vector, dtype=float)
    v /= np.max(np.abs(v))
    fractions = [Fraction(float(x)).limit_denominator(24) for x in v]
    multiple = math.lcm(*(f.denominator for f in fractions))
    integers = [int(f * multiple) for f in fractions]
    divisor = math.gcd(*integers)
    integers = np.array([x // divisor for x in integers], dtype=int)
    if next(x for x in integers if x) < 0:
        integers *= -1
    assert np.linalg.norm(np.cross(integers, v)) < EPS
    return integers

def integer_box(low, high):
    return itertools.product(*(range(math.ceil(float(a)-EPS), math.floor(float(b)+EPS)+1)
                               for a, b in zip(low, high)))

def line_clip(point, direction):
    low, high = -math.inf, math.inf
    for p, u in zip(point, direction):
        if abs(u) < EPS:
            if p < -EPS or p > 1+EPS:
                return None
        else:
            a, b = -p/u, (1-p)/u
            low, high = max(low, min(a, b)), min(high, max(a, b))
    if low > high+EPS:
        return None
    return np.clip(point+low*direction, 0, 1), np.clip(point+high*direction, 0, 1)

CORNERS = np.array(list(itertools.product((0., 1.), repeat=3)))
EDGES = [(a, b) for a in range(8) for b in range(a+1, 8)
         if np.count_nonzero(CORNERS[a]-CORNERS[b]) == 1]

def plane_clip(h, offset, A):
    points = []
    def include(p):
        if not any(np.linalg.norm(p-q) < EPS for q in points):
            points.append(p)
    for a, b in EDGES:
        p, q = CORNERS[a], CORNERS[b]
        u, v = h@p-offset, h@q-offset
        if abs(u) < EPS:
            include(p)
        if abs(v) < EPS:
            include(q)
        if u*v < -1e-14:
            include(p+(q-p)*u/(u-v))
    if len(points) < 3:
        return []
    center = np.mean(points, axis=0)
    normal = np.linalg.inv(A).T @ h
    normal /= np.linalg.norm(normal)
    first = A@(points[0]-center)
    first /= np.linalg.norm(first)
    second = np.cross(normal, first)
    points.sort(key=lambda p: math.atan2((A@(p-center))@second, (A@(p-center))@first))
    return points

def source_ids(record, op_id):
    if op_id not in record['operationIds']:
        record['operationIds'].append(op_id)

def build_group(group, checks):
    A, Ai = np.asarray(group['A']), np.asarray(group['Ai'])
    axes, planes, roto = {}, {}, {}
    max_residual = 0.
    for op in group['operations']:
        R, t, Q = np.asarray(op['R']), np.asarray(op['t']), np.asarray(op['Q'])
        B = IDENTITY-R
        if op['kind'] in ('rotation', 'screw'):
            u = primitive(Ai@np.asarray(op['axis']))
            cart_u = A@u
            norm2 = cart_u@cart_u
            projector = Ai@np.linalg.pinv(IDENTITY-Q, rcond=1e-8)@A
            low = np.minimum(B, 0).sum(axis=1)+np.minimum(u, 0)-t
            high = np.maximum(B, 0).sum(axis=1)+np.maximum(u, 0)-t
            for n in integer_box(low, high):
                lifted = t+n
                parallel = float(cart_u@(A@lifted)/norm2)
                if parallel < -EPS or parallel >= 1-EPS:
                    continue
                p = projector@lifted
                j = int(np.flatnonzero(u)[0])
                p -= p[j]/u[j]*u
                clipped = line_clip(p, u)
                if clipped is None:
                    continue
                start, end = clipped
                residual = max(np.linalg.norm(R@v+lifted-v-parallel*u) for v in (start, end))
                max_residual = max(max_residual, residual)
                assert residual < EPS, (group['id'], op['id'], 'axis', residual)
                key = rational_key(np.r_[u, p])
                order = int(round(2*math.pi/abs(op['angle'])))
                angle = op['angle']*(1 if cart_u@op['axis'] > 0 else -1)
                step = int(round(angle*order/(2*math.pi))) % order
                amount = parallel*order
                if abs(amount-round(amount)) < EPS:
                    m = (round(amount)*pow(step, -1, order)) % order
                    label = str(order) if m == 0 else f'{order}_{m}'
                else:
                    label = f'{order} (t={Fraction(parallel).limit_denominator(48)})'
                record = axes.setdefault(key, dict(start=clean(start), end=clean(end),
                    fractionalPoint=clean(p), fractionalDirection=clean(u), labels=[], orders=[], kinds=[], operationIds=[]))
                if label not in record['labels']:
                    record['labels'].append(label)
                if order not in record['orders']:
                    record['orders'].append(order)
                kind = 'rotation' if abs(parallel) < EPS else 'screw'
                if kind not in record['kinds']:
                    record['kinds'].append(kind)
                source_ids(record, op['id'])
                checks['valid-axis-lifts'] += 1
        elif op['kind'] in ('mirror', 'glide'):
            h = primitive(A.T@np.asarray(op['normal']))
            normal = Ai.T@h
            normal /= np.linalg.norm(normal)
            normal_fractional = Ai@normal
            normal_fractional /= h@normal_fractional
            d_min, d_max = np.minimum(h, 0).sum(), np.maximum(h, 0).sum()
            for k in range(math.ceil(2*d_min-h@t-EPS), math.floor(2*d_max-h@t+EPS)+1):
                d = float((h@t+k)/2)
                polygon = plane_clip(h, d, A)
                if not polygon:
                    continue
                pure = 2*d*normal_fractional
                near = np.rint(pure-t).astype(int)
                candidates = []
                for delta in itertools.product(range(-2, 3), repeat=3):
                    n = near+delta
                    if abs(h@n-k) < EPS:
                        parallel = t+n-pure
                        candidates.append((np.linalg.norm(A@parallel), parallel))
                assert candidates, (group['id'], op['id'], 'plane lift')
                _, glide = min(candidates, key=lambda v: v[0])
                # Every point on the clipped plane is mapped to itself plus glide.
                lifted = pure+glide
                assert np.max(np.abs(lifted-t-np.rint(lifted-t))) < EPS
                residual = max(np.linalg.norm(R@v+lifted-v-glide) for v in polygon)
                max_residual = max(max_residual, residual)
                assert residual < EPS, (group['id'], op['id'], 'plane', residual)
                key = rational_key(np.r_[h, d])
                kind = 'mirror' if np.linalg.norm(A@glide) < EPS else 'glide'
                record = planes.setdefault(key, dict(h=clean(h), offset=clean(d),
                    polygonFractional=clean(polygon), kind=kind, labels=[], glideVectors=[], operationIds=[]))
                if kind == 'mirror':
                    record['kind'] = 'mirror'
                label = 'm' if record['kind'] == 'mirror' else 'g'
                record['labels'] = [label]
                if np.linalg.norm(A@glide) > EPS and not any(np.linalg.norm(glide-np.asarray(v)) < EPS for v in record['glideVectors']):
                    record['glideVectors'].append(clean(glide))
                source_ids(record, op['id'])
                checks['valid-plane-lifts'] += 1
        elif op['kind'] == 'rotoinversion':
            inverse = np.linalg.inv(B)
            u = primitive(Ai@np.asarray(op['axis']))
            low, high = np.minimum(B, 0).sum(axis=1)-t, np.maximum(B, 0).sum(axis=1)-t
            order = int(round(2*math.pi/abs(op['angle'])))
            for n in integer_box(low, high):
                point = inverse@(t+n)
                if np.any(point < -EPS) or np.any(point > 1+EPS):
                    continue
                point = np.clip(point, 0, 1)
                residual = np.linalg.norm(R@point+t+n-point)
                max_residual = max(max_residual, residual)
                assert residual < EPS
                key = rational_key(np.r_[point, u, order])
                record = roto.setdefault(key, dict(centerFractional=clean(point), axisFractional=clean(u),
                    order=order, operationIds=[]))
                source_ids(record, op['id'])
                checks['valid-rotoinversion-lifts'] += 1
    return dict(id=group['id'], axes=list(axes.values()), planes=list(planes.values()),
        rotoinversions=list(roto.values()), inversionCenters=group['inversionCenters'],
        operationIdConvention='1-based catalogue operation.id', maxResidual=max_residual)

def main():
    source = ROOT/'public/symmetry-demo/catalog.json'
    catalog = json.loads(source.read_text(encoding='utf-8'))
    checks = Counter()
    groups = [build_group(g, checks) for g in catalog['groups']]
    result = {'version': 1, 'groupCount': len(groups),
        'catalogueSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'convention': 'Finite geometric elements clipped to the closed conventional cell. Axes include boundary-touching lines; mirror/glide planes require a nonzero-area cell section. Integer translation lifts are included; coincident element sets are merged. Symbols and projection overlap are explained by the viewer.',
        'groups': groups}
    target = ROOT/'public/symmetry-demo/element-diagrams.json'
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    report = {'passed': len(groups) == 230, 'groupCount': len(groups), 'checks': dict(checks),
        'elementCounts': {name: sum(len(g[name]) for g in groups) for name in ('axes','planes','rotoinversions','inversionCenters')},
        'maxResidual': max(g['maxResidual'] for g in groups), 'catalogueSha256': result['catalogueSha256'],
        'diagramsSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'groups': [{'id': g['id'], **{name: len(g[name]) for name in ('axes','planes','rotoinversions','inversionCenters')}} for g in groups]}
    (ROOT/'reports/symmetry-element-diagrams-validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k != 'groups'}))

if __name__ == '__main__':
    main()
