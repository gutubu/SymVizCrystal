import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bytes = readFileSync(new URL('../public/symmetry-demo/catalog.json', import.meta.url));
const catalog = JSON.parse(bytes);
const diagrams = JSON.parse(readFileSync(new URL('../public/symmetry-demo/element-diagrams.json', import.meta.url), 'utf8'));
const byId = new Map(catalog.groups.map(g => [g.id, g]));
const table = new Map(diagrams.groups.map(g => [g.id, g]));
const EPS = 1e-7;
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const add = (a,b) => a.map((v,i)=>v+b[i]);
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const scale = (a,s) => a.map(v=>v*s);
const mv = (A,v) => A.map(r=>dot(r,v));
const transpose = A => A[0].map((_,j)=>A.map(row=>row[j]));
const same = (a,b) => a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<EPS);
const integerVector = v => v.every(x=>Math.abs(x-Math.round(x))<EPS);
const inCell = p => p.length===3&&p.every(x=>Number.isFinite(x)&&x>=-EPS&&x<=1+EPS);
const operation = (g,id) => {assert.ok(Number.isInteger(id)&&id>=1&&id<=g.operations.length);return g.operations[id-1];};
function liftedAxisExists(op,point,u){
  const displacement=sub(add(mv(op.R,point),op.t),point),j=u.findIndex(x=>Math.abs(x)>EPS);
  // A primitive integer direction admits a lift with parallel fraction in [0,1).
  for(let n=-4;n<=4;n++){
    const fraction=(displacement[j]+n)/u[j];
    if(fraction>=-EPS&&fraction<1+EPS&&integerVector(sub(scale(u,fraction),displacement)))return true;
  }
  return false;
}

test('the geometric diagram catalogue covers the exact current 230-type catalogue',()=>{
  assert.equal(diagrams.catalogueSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(diagrams.groupCount,230);
  assert.deepEqual(diagrams.groups.map(g=>g.id),Array.from({length:230},(_,i)=>i+1));
  for(const d of diagrams.groups){
    assert.ok(Array.isArray(d.axes)&&Array.isArray(d.planes)&&Array.isArray(d.rotoinversions));
    assert.deepEqual(d.inversionCenters,byId.get(d.id).inversionCenters);
    assert.ok(d.maxResidual<EPS);
  }
});

test('every displayed axis and fixed point belongs to a genuine integer-translated operation',()=>{
  for(const d of diagrams.groups){
    const g=byId.get(d.id);
    for(const axis of d.axes){
      assert.ok(inCell(axis.start)&&inCell(axis.end));
      const u=axis.fractionalDirection,delta=sub(axis.end,axis.start);
      assert.ok(integerVector(u)&&u.some(v=>v!==0));
      for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(delta[i]*u[j]-delta[j]*u[i])<EPS);
      for(const id of axis.operationIds){
        const op=operation(g,id);
        assert.ok(['rotation','screw'].includes(op.kind));
        assert.ok(same(mv(op.R,u),u));
        assert.ok(liftedAxisExists(op,axis.start,u),`${g.id}/${id} starts on an actual lifted axis`);
        assert.ok(liftedAxisExists(op,axis.end,u),`${g.id}/${id} ends on the same lifted axis`);
      }
    }
    for(const point of d.rotoinversions){
      assert.ok(inCell(point.centerFractional));
      for(const id of point.operationIds){
        const op=operation(g,id);
        assert.equal(op.kind,'rotoinversion');
        assert.ok(integerVector(sub(sub(point.centerFractional,mv(op.R,point.centerFractional)),op.t)),`${g.id}/${id} actual lifted fixed point`);
        assert.ok(same(mv(op.R,point.axisFractional),scale(point.axisFractional,-1)));
      }
    }
  }
});

test('every mirror or glide section has the correct reciprocal plane, offset and lattice lift',()=>{
  for(const d of diagrams.groups){
    const g=byId.get(d.id);
    for(const plane of d.planes){
      assert.ok(plane.polygonFractional.length>=3);
      const h=plane.h;
      assert.ok(integerVector(h));
      for(const p of plane.polygonFractional){assert.ok(inCell(p));assert.ok(Math.abs(dot(h,p)-plane.offset)<EPS);}
      let pureMirror=false;
      // The Cartesian normal in fractional coordinates follows the cell metric.
      const normalCart=mv(transpose(g.Ai),h);
      const w=mv(g.Ai,normalCart),pure=scale(w,2*plane.offset/dot(h,w));
      for(const id of plane.operationIds){
        const op=operation(g,id);
        assert.ok(['mirror','glide'].includes(op.kind));
        assert.ok(same(mv(transpose(op.R),h),scale(h,-1)));
        const lift=2*plane.offset-dot(h,op.t);
        assert.ok(Math.abs(lift-Math.round(lift))<EPS,`${g.id}/${id} mirror-plane integer lift`);
        if(integerVector(sub(pure,op.t)))pureMirror=true;
      }
      assert.equal(plane.kind,pureMirror?'mirror':'glide',`No.${g.id}: genuine mirror versus glide`);
      for(const v of plane.glideVectors)assert.ok(Math.abs(dot(h,v))<EPS);
    }
  }
});

test('simple independent cell diagrams retain boundary axes and quarter-height mirrors',()=>{
  const p1=table.get(1),p21=table.get(4),pn=table.get(7),p21m=table.get(11),p222=table.get(16),pmmm=table.get(47);
  assert.equal(p1.axes.length+p1.planes.length+p1.rotoinversions.length+p1.inversionCenters.length,0);
  assert.equal(p21.axes.length,9);
  assert.ok(p21.axes.every(a=>a.labels.includes('2_1')&&same(a.fractionalDirection,[0,1,0])));
  assert.deepEqual(pn.planes.map(p=>p.offset),[0,.5,1]);
  assert.ok(pn.planes.every(p=>p.kind==='glide'));
  assert.deepEqual(p21m.planes.map(p=>p.offset),[.25,.75]);
  assert.ok(p21m.planes.every(p=>p.kind==='mirror'));
  assert.equal(p222.axes.length,27);
  for(const u of [[1,0,0],[0,1,0],[0,0,1]])assert.equal(p222.axes.filter(a=>same(a.fractionalDirection,u)).length,9);
  assert.equal(pmmm.axes.length,27);assert.equal(pmmm.planes.length,9);assert.equal(pmmm.inversionCenters.length,27);
  for(const id of [81,174]){assert.ok(table.get(id).rotoinversions.length>0);assert.equal(table.get(id).inversionCenters.length,0);}
});
