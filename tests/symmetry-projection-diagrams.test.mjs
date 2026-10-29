import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const catalog=JSON.parse(await readFile(new URL('../public/symmetry-demo/catalog.json',import.meta.url),'utf8'));
const elementData=JSON.parse(await readFile(new URL('../public/symmetry-demo/element-diagrams.json',import.meta.url),'utf8'));
const source=await readFile(new URL('../tools/symmetry-demo/projection-diagrams.js',import.meta.url),'utf8');
const exported={exports:{}};
vm.runInNewContext(source,{module:exported,Math,Map,Set,Number,Object,Array,TypeError});
const {math,mount}=exported.exports;
const byId=new Map(catalog.groups.map(g=>[g.id,g]));
for(const g of catalog.groups)g.diagramElements=elementData.groups.find(e=>e.id===g.id);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),mv=(A,p)=>A.map(r=>dot(r,p));
const close=(a,b,message)=>assert.ok(Math.max(...a.map((v,i)=>Math.abs(v-b[i])))<1e-7,message);

test('all 230 point-group and general-position projections retain the exact operation inventory',()=>{
  let total=0;
  for(const g of catalog.groups){
    for(const view of ['a','b','c']){
      const m=math.pointGroupModel(g,view);
      const keys=new Set(g.operations.map(op=>op.R.flat().join(',')));
      assert.equal(m.rotations.length,keys.size,`No.${g.id}: translations removed only in point-group model`);
      assert.equal(m.poles.length,keys.size);
      assert.equal(m.inversion,g.centrosymmetric);
      for(const p of m.poles){
        assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x*p.x+p.y*p.y<=1+1e-8);
        assert.ok(Math.abs(Math.hypot(...p.direction)-1)<1e-8);
        const hemisphere=dot(p.direction,m.frame.normal)>=-1e-8?'upper':'lower';
        assert.equal(p.hemisphere,hemisphere);
      }
      for(const mirror of m.mirrors)for(const index of mirror.indices)close(mv(g.operations[index].Q,mirror.normal),mirror.normal.map(v=>-v),`No.${g.id}: mirror normal eigenvector`);
      for(const axis of m.axes)for(const index of axis.indices){const image=mv(g.operations[index].Q,axis.axis);assert.ok(Math.abs(Math.abs(dot(image,axis.axis))-1)<1e-7);}
      const general=math.generalPositionModel(g,view);
      assert.equal(general.points.length,g.operationCount);
      for(const p of general.points){
        assert.ok(p.fractional.every(v=>v>=0&&v<1));
        assert.ok([p.x,p.y,p.height].every(Number.isFinite));
        assert.equal(p.heightExpression,g.operations[p.index].xyz.split(',')[general.frame.k]);
        assert.ok(Math.abs(Math.abs(p.determinant)-1)<1e-8);
      }
    }
    total+=g.operationCount;
  }
  assert.equal(total,4425);
  assert.equal(math.pointGroupModel(byId.get(1),'c').axes.length,0);
  assert.equal(math.pointGroupModel(byId.get(16),'c').axes.length,3);
  assert.equal(math.pointGroupModel(byId.get(221),'c').axes.length,13);
  assert.equal(math.pointGroupModel(byId.get(221),'c').mirrors.length,9);
  assert.equal(math.pointGroupModel(byId.get(4),'b').axes[0].proper[0],2,'P21 has point group 2 after stripping translation');
  assert.equal(math.pointGroupModel(byId.get(7),'b').mirrors.length,1,'Pn has point group m after stripping glide');
  for(const id of [81,174])assert.equal(math.pointGroupModel(byId.get(id),'c').inversion,false);
});

test('selected space-group axes and mirror sections are geometrically inside the exact cell',()=>{
  for(const g of catalog.groups)for(const op of g.operations){
    const m=math.selectedElementModel(g,op);
    for(const f of m.segment||[]){
      assert.ok(f.every(v=>v>=-1e-7&&v<=1+1e-7));
      const p=mv(g.A,f),relative=p.map((v,i)=>v-op.point[i]);
      const along=dot(relative,op.axis);
      close(relative,op.axis.map(v=>v*along),`No.${g.id} operation ${op.id}: true axis`);
    }
    for(const f of m.polygon||[]){
      assert.ok(f.every(v=>v>=-1e-7&&v<=1+1e-7));
      assert.ok(Math.abs(dot(op.normal,mv(g.A,f))-op.planeD)<1e-7,`No.${g.id}: true mirror/glide plane`);
    }
    if(m.center)close(mv(g.A,m.center),op.center,`No.${g.id}: fixed-point fractionals`);
  }
});

test('all 690 axial cell projections reserve a collision-free outer gutter for cell-axis names',()=>{
  const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  let checked=0;
  for(const g of catalog.groups)for(const view of ['a','b','c']){
    const layout=math.cellProjectionLayout(g,view),bounds=layout.bounds;
    const symbolEnvelope={left:bounds.left-12,right:bounds.right+12,top:bounds.top-12,bottom:bounds.bottom+12};
    assert.equal(layout.axisLabels.length,2);
    assert.equal(new Set(layout.axisLabels.map(item=>item.axis)).size,2);
    assert.ok(layout.axisLabels.every(item=>item.axis!==view));
    for(const item of layout.axisLabels){
      assert.ok([...item.position,item.baseline,...Object.values(item.box),...item.leader.flat()].every(Number.isFinite));
      assert.equal(intersects(item.box,symbolEnvelope),false,`No.${g.id} +${view}: ${item.axis} must clear every cell symbol and selection ring`);
      assert.ok(item.box.left>=4&&item.box.right<=356&&item.box.top>=4&&item.box.bottom<=280,`No.${g.id} +${view}: axis name stays in the SVG and above footer`);
    }
    assert.equal(intersects(layout.axisLabels[0].box,layout.axisLabels[1].box),false,`No.${g.id} +${view}: cell-axis names must remain distinct`);
    checked++;
  }
  assert.equal(checked,690);
  const p222=math.cellProjectionLayout(byId.get(16),'c');
  const b=p222.axisLabels.find(item=>item.axis==='b'),corner=p222.project([0,1,0]);
  assert.ok(b.box.bottom<corner[1]-12,'P222 b is outside the top-corner twofold symbol, not one pixel beside its old number label');
});

// A small DOM harness exercises the actual SVG renderer, including every full
// element-data record. It is not a screenshot or a replacement for UI QA.
class Element {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.attributes={};this.children=[];this.listeners={};this.baseText='';this.classList={add:(...a)=>this.setAttribute('class',[...new Set((this.attributes.class||'').split(/\s+/).filter(Boolean).concat(a))].join(' ')),remove:a=>this.setAttribute('class',(this.attributes.class||'').split(/\s+/).filter(v=>v!==a).join(' '))};}
  setAttribute(k,v){this.attributes[k]=String(v);}
  removeAttribute(k){delete this.attributes[k];}
  getAttribute(k){return this.attributes[k]??null;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];this.baseText='';}
  addEventListener(k,v){this.listeners[k]=v;}
  set textContent(text){this.baseText=String(text);this.children=[];}
  get textContent(){return this.baseText+this.children.map(c=>c.textContent??'').join('');}
  get dataset(){return Object.fromEntries(Object.entries(this.attributes).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,s)=>s.toUpperCase()),v]));}
  querySelectorAll(selector){const nodes=[];const match=n=>selector.startsWith('[')?selector.slice(1,-1) in n.attributes:n.tagName===selector;for(const c of this.children)if(c instanceof Element){if(match(c))nodes.push(c);nodes.push(...c.querySelectorAll(selector));}return nodes;}
}
const document={createElement(tag){return new Element(tag,this);},createElementNS(ns,tag){return new Element(tag,this);},createTextNode(text){return {textContent:String(text)};}};

test('actual renderer draws every group in all four modes with complete legends and finite SVG attributes',()=>{
  const container=new Element('div',document),view=mount(container);
  let renders=0;
  for(const g of catalog.groups){
    for(const direction of ['a','b','c']){
    view.update({group:g,operationIndex:Math.min(1,g.operations.length-1),view:direction});
    for(const mode of ['elements','point','positions','selected']){
      view.setMode(mode);renders++;
      assert.equal(container.getAttribute('data-diagram-group'),String(g.id));
      assert.equal(container.getAttribute('data-diagram-type'),mode);
      assert.equal(container.querySelectorAll('[data-symmetry-diagram]')[0].getAttribute('hidden'),null,'the interactive SVG remains visible');
      assert.ok(container.querySelectorAll('li').length>0,`No.${g.id} ${mode}: permanent legend`);
      assert.ok(!container.textContent.includes('尚未载入'),`No.${g.id}: precomputed elements loaded`);
      const inspect=node=>{if(!(node instanceof Element))return;for(const [key,value]of Object.entries(node.attributes))assert.doesNotMatch(value,/NaN|Infinity|undefined/,`No.${g.id} ${mode} ${node.tagName}.${key}`);node.children.forEach(inspect);};inspect(container);
      if(mode!=='point'){
        const names=container.querySelectorAll('[data-cell-axis-label]');
        assert.equal(names.length,2,`No.${g.id} +${direction} ${mode}: two visible cell-axis names`);
        assert.equal(names.some(name=>name.textContent===direction),false);
        assert.equal(container.querySelectorAll('[data-cell-axis-leader]').length,2);
        // Element type/order is already encoded by its glyph and tooltip. No
        // repeated corner number can collide with an outer cell-axis name.
        if(mode==='elements'||mode==='selected')assert.ok(container.querySelectorAll('text').every(node=>!/^(?:[2346](?:_\d)?(?:\/|$)|m$|g$)/.test(node.textContent)));
      }
    }
    }
  }
  assert.equal(renders,2760);
  view.update({group:byId.get(225),operationIndex:1,view:'c'});view.setMode('elements');
  const filter=container.querySelectorAll('[data-diagram-filter]').find(el=>el.dataset.diagramFilter==='centers');
  assert.ok(container.querySelectorAll('[data-diagram-inversion-center]').length>0);
  filter.checked=false;filter.listeners.change();
  assert.equal(container.querySelectorAll('[data-diagram-inversion-center]').length,0,'dense diagrams permit hiding one element family');
  view.destroy();assert.equal(container.children.length,0);
});

test('all 230 groups default to software-drawn elements with no original-table UI or assets',()=>{
  for(const group of catalog.groups){
    const container=new Element('div',document),viewer=mount(container);
    viewer.update({group,operationIndex:Math.min(1,group.operations.length-1),view:'c'});
    assert.equal(viewer.getMode(),'elements');
    assert.equal(container.getAttribute('data-diagram-type'),'elements');
    assert.deepEqual(Array.from(container.querySelectorAll('[data-diagram-mode]'),button=>button.dataset.diagramMode),['elements','point','positions','selected']);
    assert.ok(container.querySelectorAll('[data-symmetry-diagram]')[0].children.length>0);
    assert.ok(container.querySelectorAll('li').length>0,'software symbol legend is present by default');
    assert.equal(container.querySelectorAll('img').length,0);
    assert.equal(container.querySelectorAll('dialog').length,0);
    assert.equal(container.querySelectorAll('a').length,0);
    assert.doesNotMatch(container.textContent,/国际表|International Tables|原版 PDF|原版图组/);
    viewer.destroy();
  }
});

test('legacy original-plate metadata and mode requests cannot replace the interactive projection',()=>{
  const group={...byId.get(16),get internationalTables(){throw new Error('Original plate data must not be read');}};
  const container=new Element('div',document),viewer=mount(container);
  viewer.update({group,operationIndex:1,view:'c'});
  viewer.setMode('original');
  assert.equal(viewer.getMode(),'elements');
  assert.equal(container.getAttribute('data-diagram-type'),'elements');
  const tabs=container.querySelectorAll('[data-diagram-mode]'),point=tabs.find(button=>button.dataset.diagramMode==='point');
  point.listeners.click();
  assert.equal(viewer.getMode(),'point');
  assert.equal(point.getAttribute('aria-pressed'),'true');
  assert.ok(container.querySelectorAll('[data-point-pole]').length>0);
  viewer.setMode('original');
  assert.equal(viewer.getMode(),'point','unsupported modes do not alter the current interactive diagram');
  viewer.destroy();
});
