/* Exact-operation-driven diagrams. No remote assets or application globals. */
(function (global, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.SymVizDiagrams = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const EPS = 1e-8, NS = 'http://www.w3.org/2000/svg';
  const add = (a,b) => a.map((v,i)=>v+b[i]);
  const sub = (a,b) => a.map((v,i)=>v-b[i]);
  const mul = (a,s) => a.map(v=>v*s);
  const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => Math.hypot(...a);
  const unit = a => mul(a,1/norm(a));
  const mv = (A,v) => A.map(r=>dot(r,v));
  const identity = [[1,0,0],[0,1,0],[0,0,1]];
  const det = A => dot(A[0],cross(A[1],A[2]));
  const closeMatrix = (A,B) => A.every((r,i)=>r.every((v,j)=>Math.abs(v-B[i][j])<EPS));
  const matrixKey = A => A.flat().map(v=>Math.round(v*1e8)).join(',');
  const vectorKey = a => a.map(v=>Math.round(v*1e7)).join(',');
  const mod = n => { const x=((n%1)+1)%1; return x<EPS||x>1-EPS?0:x; };
  function rational(n) {
    if(Math.abs(n)<1e-8)return '0';
    for(let d=1;d<=192;d++){const p=Math.round(n*d);if(Math.abs(n-p/d)<1e-8)return d===1?String(p):`${p}/${d}`;}
    return n.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  }
  const vector = a => `(${a.map(rational).join(', ')})`;
  function canonical(a) {let u=unit(a); const first=u.find(v=>Math.abs(v)>EPS);return first<0?mul(u,-1):u;}
  function nullVector(A) {
    const candidates=[cross(A[0],A[1]),cross(A[0],A[2]),cross(A[1],A[2])];
    return canonical(candidates.reduce((a,b)=>norm(a)>norm(b)?a:b));
  }
  function classifyMatrix(Q) {
    if(closeMatrix(Q,identity))return {kind:'identity'};
    if(closeMatrix(Q,identity.map(r=>r.map(v=>-v))))return {kind:'inversion'};
    const determinant=det(Q);
    if(determinant<0&&Math.abs(Q[0][0]+Q[1][1]+Q[2][2]-1)<EPS){
      return {kind:'mirror',normal:nullVector(Q.map((r,i)=>r.map((v,j)=>v+identity[i][j])))};
    }
    const S=Q.map(r=>r.map(v=>determinant<0?-v:v));
    const axis=nullVector(S.map((r,i)=>r.map((v,j)=>v-identity[i][j])));
    const angle=Math.acos(Math.max(-1,Math.min(1,(S[0][0]+S[1][1]+S[2][2]-1)/2)));
    return {kind:determinant<0?'rotoinversion':'rotation',axis,order:Math.round(2*Math.PI/angle)};
  }
  function projectionFrame(group,requestedView) {
    const view=['a','b','c'].includes(requestedView)?requestedView:(group.system==='monoclinic'?'b':'c');
    const k={a:0,b:1,c:2}[view],i=k===0?1:0,j=[0,1,2].find(n=>n!==k&&n!==i);
    const normal=unit(group.A.map(r=>r[k]));
    const a=group.A.map(r=>r[i]);
    const right=unit(sub(a,mul(normal,dot(a,normal))));
    const up=unit(cross(normal,right));
    return {view,k,i,j,normal,right,up,coordinates:p=>[dot(p,right),dot(p,up),dot(p,normal)]};
  }
  function projectStereographic(direction,frame) {
    const p=frame.coordinates(unit(direction)),d=1+Math.abs(p[2]);
    return {x:p[0]/d,y:-p[1]/d,hemisphere:p[2]>=-EPS?'upper':'lower',height:p[2]};
  }
  function uniqueRotations(group) {
    const seen=new Map();
    group.operations.forEach((op,index)=>{
      const key=matrixKey(op.R);
      if(!seen.has(key))seen.set(key,{R:op.R,Q:op.Q,indices:[]});
      seen.get(key).indices.push(index);
    });
    return [...seen.values()];
  }
  function pointGroupModel(group,requestedView) {
    const frame=projectionFrame(group,requestedView),rotations=uniqueRotations(group);
    const seed=unit([.183,.427,.885]),axes=new Map(),mirrors=new Map();let inversion=false;
    const poles=rotations.map((item,index)=>{
      const cls=classifyMatrix(item.Q),direction=mv(item.Q,seed);
      if(cls.axis){const key=vectorKey(cls.axis);if(!axes.has(key))axes.set(key,{axis:cls.axis,proper:[],improper:[],indices:[]});const a=axes.get(key);a[cls.kind==='rotation'?'proper':'improper'].push(cls.order);a.indices.push(...item.indices);}
      if(cls.kind==='mirror'){const key=vectorKey(cls.normal);if(!mirrors.has(key))mirrors.set(key,{normal:cls.normal,indices:[]});mirrors.get(key).indices.push(...item.indices);}
      if(cls.kind==='inversion')inversion=true;
      return {...projectStereographic(direction,frame),direction,index,indices:item.indices,determinant:det(item.Q)};
    });
    return {frame,poles,rotations,axes:[...axes.values()].map(a=>({...a,proper:[...new Set(a.proper)].sort((a,b)=>b-a),improper:[...new Set(a.improper)].sort((a,b)=>b-a)})),mirrors:[...mirrors.values()],inversion};
  }
  function generalPositionModel(group,requestedView) {
    const frame=projectionFrame(group,requestedView),seed=[.173,.287,.219];
    return {frame,seed,points:group.operations.map((op,index)=>{
      const raw=add(mv(op.R,seed),op.t),fractional=raw.map(mod),cartesian=mv(group.A,fractional);
      const coords=frame.coordinates(cartesian);
      return {index,fractional,raw,x:coords[0],y:-coords[1],height:fractional[frame.k],heightExpression:op.xyz.split(',')[frame.k],determinant:det(op.R),xyz:op.xyz};
    })};
  }
  const cubeEdges=[];for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if([1,2,4].includes(i^j))cubeEdges.push([i,j]);
  function cellCorners(group) {return Array.from({length:8},(_,i)=>mv(group.A,[i&1?1:0,i&2?1:0,i&4?1:0]));}
  function cellProjectionLayout(group,view) {
    const frame=projectionFrame(group,view),raw=cellCorners(group).map(p=>frame.coordinates(p));
    const lo=[Math.min(...raw.map(p=>p[0])),Math.min(...raw.map(p=>p[1]))],hi=[Math.max(...raw.map(p=>p[0])),Math.max(...raw.map(p=>p[1]))];
    const scale=Math.min(256/Math.max(.1,hi[0]-lo[0]),204/Math.max(.1,hi[1]-lo[1]));
    const project=f=>{const p=frame.coordinates(mv(group.A,f));return [180+(p[0]-(lo[0]+hi[0])/2)*scale,145-(p[1]-(lo[1]+hi[1])/2)*scale];};
    const corners=Array.from({length:8},(_,i)=>project([i&1?1:0,i&2?1:0,i&4?1:0]));
    const bounds={left:Math.min(...corners.map(p=>p[0])),right:Math.max(...corners.map(p=>p[0])),top:Math.min(...corners.map(p=>p[1])),bottom:Math.max(...corners.map(p=>p[1]))};
    const center=[(bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2];
    const axisLabels=[frame.i,frame.j].map(k=>{
      const f=[0,0,0];f[k]=1;const endpoint=project(f),outward=unit(sub(endpoint,center)),distances=[];
      for(let coordinate=0;coordinate<2;coordinate++)if(Math.abs(outward[coordinate])>EPS){const limit=coordinate===0?(outward[0]>0?bounds.right+24:bounds.left-24):(outward[1]>0?bounds.bottom+24:bounds.top-24);distances.push((limit-endpoint[coordinate])/outward[coordinate]);}
      const distance=Math.min(...distances),position=add(endpoint,mul(outward,distance));
      // These labels occupy an outer gutter. Even a selected symbol's 12 px
      // ring remains inside it; do not put cell-axis names next to corner glyphs.
      return {axis:'abc'[k],endpoint,position,baseline:position[1]+4,leader:[add(endpoint,mul(outward,15)),sub(position,mul(outward,8))],box:{left:position[0]-6,right:position[0]+6,top:position[1]-9,bottom:position[1]+8}};
    });
    return {frame,project,bounds,axisLabels};
  }
  function axisSegment(group,op) {
    const point=mv(group.Ai,op.point),direction=mv(group.Ai,op.axis);let lo=-Infinity,hi=Infinity;
    for(let k=0;k<3;k++){
      if(Math.abs(direction[k])<EPS){if(point[k]<-EPS||point[k]>1+EPS)return [];}
      else{const a=-point[k]/direction[k],b=(1-point[k])/direction[k];lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
    }
    if(lo>hi+EPS||!Number.isFinite(lo)||!Number.isFinite(hi))return [];
    return [add(point,mul(direction,lo)),add(point,mul(direction,hi))];
  }
  function planeSection(group,op) {
    const corners=cellCorners(group),points=[];
    const include=p=>{if(!points.some(q=>norm(sub(p,q))<EPS))points.push(p);};
    for(const [i,j] of cubeEdges){const a=corners[i],b=corners[j],da=dot(op.normal,a)-op.planeD,db=dot(op.normal,b)-op.planeD;if(Math.abs(da)<EPS)include(a);if(Math.abs(db)<EPS)include(b);if(da*db<0)include(add(a,mul(sub(b,a),da/(da-db))));}
    if(points.length<3)return points.map(p=>mv(group.Ai,p));
    const center=mul(points.reduce(add,[0,0,0]),1/points.length),u=unit(sub(points[0],center)),v=unit(cross(op.normal,u));
    points.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
    return points.map(p=>mv(group.Ai,p));
  }
  function selectedElementModel(group,operation) {
    const op=operation||group.operations[0];
    if(op.kind==='rotation'||op.kind==='screw')return {kind:op.kind,segment:axisSegment(group,op),order:Math.round(2*Math.PI/Math.abs(op.angle))};
    if(op.kind==='mirror'||op.kind==='glide')return {kind:op.kind,polygon:planeSection(group,op)};
    if(op.kind==='inversion'||op.kind==='rotoinversion')return {kind:op.kind,center:mv(group.Ai,op.center),axis:op.axis?mv(group.Ai,op.axis):null,order:op.angle?Math.round(2*Math.PI/Math.abs(op.angle)):null};
    return {kind:op.kind};
  }
  const css=`
  .sv-diagrams{font:inherit;color:var(--foreground,#18212f);min-width:0;padding:13px;border:1px solid var(--border,#d5dae1);background:#fff;border-radius:6px}
  .sv-diagrams h3{margin:0 0 9px;font-size:15px}.sv-diagrams p{margin:7px 0;line-height:1.5}.sv-diagrams .sv-diagram-tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px}
  .sv-diagram-tabs button{font:inherit;font-size:11px;border:1px solid #bdc9d5;background:#f6f8fa;color:#29465f;padding:5px 7px;border-radius:3px;cursor:pointer}.sv-diagram-tabs button[aria-pressed=true]{background:#286fae;color:white;border-color:#286fae}
  .sv-diagrams svg{display:block;width:100%;height:auto;max-height:330px}.sv-diagrams svg text{font-family:inherit;fill:#263747}.sv-diagrams .sv-diagram-caption{font-size:11px;color:#596b7b}.sv-diagrams .sv-diagram-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 8px;font-size:11px;margin:8px 0;padding:0;list-style:none}.sv-diagrams .sv-diagram-legend li{display:flex;align-items:flex-start;gap:5px}.sv-diagrams .sv-legend-symbol{display:inline-flex;align-items:center;justify-content:center;flex:0 0 27px;height:18px;font-size:15px;color:#273848;font-weight:600}.sv-diagrams .sv-legend-symbol.mirror{color:#36806e}.sv-diagrams .sv-legend-symbol.selected{color:#db7b22}.sv-diagrams .sv-legend-symbol.inversion{color:#ed233b}.sv-diagrams .sv-diagram-note{font-size:10px;color:#6b7784}.sv-diagrams [hidden]{display:none!important}
  .sv-diagrams .sv-diagram-outline{fill:none;stroke:#a7b1bd;stroke-width:1}.sv-diagrams .sv-point{cursor:pointer}.sv-diagrams .sv-point:focus{outline:none;stroke:#e58a23;stroke-width:3}
  @media(max-width:400px){.sv-diagrams .sv-diagram-legend{grid-template-columns:1fr}}
  `;
  function mount(container,options={}) {
    if(!container||!container.ownerDocument)throw new TypeError('Diagram mount requires a DOM element.');
    const doc=container.ownerDocument;container.replaceChildren();container.classList.add('sv-diagrams');
    const html=(tag,attributes={},text)=>{const el=doc.createElement(tag);for(const [k,v]of Object.entries(attributes))el.setAttribute(k,String(v));if(text!=null)el.textContent=text;return el;};
    const svgEl=(tag,attributes={},text)=>{const el=doc.createElementNS(NS,tag);for(const [k,v]of Object.entries(attributes))el.setAttribute(k,String(v));if(text!=null)el.textContent=text;return el;};
    const style=html('style',{},css),heading=html('h3',{},'对称操作投影图'),tabs=html('div',{class:'sv-diagram-tabs',role:'group','aria-label':'投影图类型'}),caption=html('p',{class:'sv-diagram-caption','data-diagram-caption':''}),filters=html('div',{class:'sv-diagram-tabs',role:'group','aria-label':'对称元素类型显示'}),svg=svgEl('svg',{viewBox:'0 0 360 300',role:'img','aria-label':'对称操作投影图','data-symmetry-diagram':''}),legend=html('ul',{class:'sv-diagram-legend','aria-label':'投影图符号图例'}),note=html('p',{class:'sv-diagram-note','data-diagram-note':''});
    container.append(style,heading,tabs,caption,filters,svg,legend,note);
    const modes=[['elements','空间群元素'],['point','点群投影'],['positions','一般位置'],['selected','当前元素']];
    let mode='elements',state=null,cacheKey='',destroyed=false;
    const visibleTypes={axes:true,planes:true,centers:true,roto:true};
    [['axes','旋转/螺旋轴'],['planes','镜/滑移面'],['centers','反演中心'],['roto','旋转反演']].forEach(([key,name])=>{
      const control=html('label',{style:'display:inline-flex;align-items:center;gap:3px;font-size:10px;cursor:pointer'}),input=html('input',{type:'checkbox','aria-label':`图谱显示${name}`,'data-diagram-filter':key});input.checked=true;control.append(input,doc.createTextNode(name));input.addEventListener('change',()=>{visibleTypes[key]=input.checked;render();});filters.append(control);
    });
    modes.forEach(([key,label])=>{const button=html('button',{type:'button','data-diagram-mode':key,'aria-pressed':key===mode},label);button.addEventListener('click',()=>{mode=key;render();});tabs.append(button);});
    const line=(a,b,attrs={})=>svgEl('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],...attrs});
    const label=(x,y,text,attrs={})=>svgEl('text',{x,y,'font-size':11,'text-anchor':'middle',...attrs},text);
    const titled=(node,text)=>{node.append(svgEl('title',{},text));return node;};
    function addLegend(symbol,text,kind=''){const li=html('li'),s=html('span',{class:`sv-legend-symbol ${kind}`},symbol);li.append(s,html('span',{},text));legend.append(li);}
    function glyph(x,y,n,{improper=false,screw=false,selected=false,title='',attrs={}}={}) {
      const g=svgEl('g',{'data-diagram-symbol':screw?'screw':improper?'rotoinversion':'rotation','data-order':n,...attrs});
      const color=selected?'#dc7d24':'#253e55',radius=6;
      if(screw&&n===2){g.append(svgEl('path',{d:`M${x},${y-9} C${x-8},${y-5} ${x-7},${y+1} ${x},${y+2} C${x+7},${y+3} ${x+7},${y+8} ${x},${y+10} C${x+3},${y+4} ${x-3},${y-3} ${x},${y-9}`,fill:color,stroke:color,'stroke-width':.5}),svgEl('circle',{cx:x,cy:y,r:1.5,fill:'#fff'}));}
      else if(n===2)g.append(svgEl('ellipse',{cx:x,cy:y,rx:3.4,ry:7.2,fill:improper?'none':color,stroke:color,'stroke-width':1.3}));
      else{const count=[3,4,6].includes(n)?n:4,angle=n===4?Math.PI/4:-Math.PI/2;const points=Array.from({length:count},(_,i)=>`${x+radius*Math.cos(angle+i*2*Math.PI/count)},${y+radius*Math.sin(angle+i*2*Math.PI/count)}`).join(' ');g.append(svgEl('polygon',{points,fill:improper||screw?'none':color,stroke:color,'stroke-width':1.3}));}
      if(improper)g.append(line([x-6,y-11],[x+6,y-11],{stroke:color,'stroke-width':1.5}));
      if(screw&&n!==2)g.append(svgEl('path',{d:`M${x-3},${y+9} Q${x+7},${y+12} ${x+8},${y+3}`,fill:'none',stroke:color,'stroke-width':1.2}));
      if(selected)g.append(svgEl('circle',{cx:x,cy:y,r:12,fill:'none',stroke:'#ed9828','stroke-width':1.4}));
      if(title)titled(g,title);return g;
    }
    function addSelectable(node,indices,title) {
      node.setAttribute('class',`${node.getAttribute('class')||''} sv-point`);node.setAttribute('data-operation-indices',indices.join(','));
      node.setAttribute('aria-label',title);titled(node,title);
      if(typeof options.onSelectOperation==='function'){node.setAttribute('role','button');node.setAttribute('tabindex','0');const pick=()=>options.onSelectOperation(indices.includes(state.operationIndex)?state.operationIndex:indices[0]);node.addEventListener('click',pick);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();pick();}});}
      return node;
    }
    function renderPoint() {
      const g=state.group,model=pointGroupModel(g,state.view),center=[180,146],r=113,project=p=>[center[0]+r*p.x,center[1]+r*p.y];
      caption.textContent=`No.${g.id} ${g.name} → 点群 ${g.pointGroup}；沿 +${model.frame.view} 方向观察。${model.rotations.length} 个去平移后的不同操作。`;
      svg.append(svgEl('circle',{cx:center[0],cy:center[1],r,class:'sv-diagram-outline','data-diagram-equator':''}));
      for(const mirror of model.mirrors){const n=mirror.normal,ref=Math.abs(n[0])<.8?[1,0,0]:[0,1,0],u=unit(cross(n,ref)),v=cross(n,u),pts=[];for(let i=0;i<=160;i++){const a=i*2*Math.PI/160;pts.push(project(projectStereographic(add(mul(u,Math.cos(a)),mul(v,Math.sin(a))),model.frame)));}const path=svgEl('path',{d:pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' '),fill:'none',stroke:mirror.indices.includes(state.operationIndex)?'#d9822c':'#3a8b73','stroke-width':mirror.indices.includes(state.operationIndex)?2.3:1.2,'data-point-mirror':''});titled(path,`点群镜面，笛卡尔法向 ${vector(n)}；对应空间群操作 ${mirror.indices.map(i=>i+1).join(', ')}`);svg.append(path);}
      for(const axis of model.axes){
        const ends=[project(projectStereographic(axis.axis,model.frame)),project(projectStereographic(mul(axis.axis,-1),model.frame))];
        if(Math.abs(dot(axis.axis,model.frame.normal))<EPS)svg.append(line(ends[0],ends[1],{stroke:'#a2aab3','stroke-dasharray':'3 4','stroke-width':.9}));
        const seen=new Set();for(const p of ends){const k=vectorKey(p);if(seen.has(k))continue;seen.add(k);const selected=axis.indices.includes(state.operationIndex);const proper=axis.proper[0],improper=axis.improper[0];
          if(proper)svg.append(glyph(p[0],p[1],proper,{selected,title:`${proper} 重纯旋转轴（点群）；笛卡尔方向 ${vector(axis.axis)}`,attrs:{'data-point-axis':'proper'}}));
          if(improper)svg.append(glyph(p[0]+(proper?11:0),p[1]+(proper?9:0),improper,{improper:true,selected,title:`${improper} 重旋转反演轴（点群）；与独立反演操作不同`,attrs:{'data-point-axis':'improper'}}));
        }
      }
      model.poles.sort((a,b)=>(a.hemisphere==='upper')-(b.hemisphere==='upper')).forEach(p=>{
        const [x,y]=project(p),selected=p.indices.includes(state.operationIndex),upper=p.hemisphere==='upper';
        const node=svgEl('circle',{cx:x,cy:y,r:upper?2.9:4.7,fill:upper?'#28465d':'none',stroke:'#28465d','stroke-width':1.25,'data-point-pole':'','data-hemisphere':p.hemisphere,'data-direction':p.direction.join(',')});
        svg.append(addSelectable(node,p.indices,`${upper?'上':'下'}半球的一般方向，笛卡尔向量 ${vector(p.direction)}；对应操作 ${p.indices.map(i=>i+1).join(', ')}`));
        if(selected)svg.append(svgEl('circle',{cx:x,cy:y,r:7.4,fill:'none',stroke:'#e28c27','stroke-width':2,'pointer-events':'none','data-selected-pole':''}));
      });
      if(model.inversion){svg.append(titled(svgEl('circle',{cx:center[0],cy:center[1],r:10,fill:'none',stroke:'#ed233b','stroke-width':1.6,'data-point-inversion':''}),'i：点群包含独立反演；不表示其在实际晶胞中的位置'));}
      svg.append(label(center[0],285,`点群 ${g.pointGroup} · ${model.inversion?'含反演':'无独立反演'}`,{'font-size':12}));
      addLegend('● / ○','上半球 / 下半球的等价方向；本图约定沿观察正轴为上半球');
      if(model.axes.some(a=>a.proper.length))addLegend('⬭ △ □ ⬡','2、3、4、6 重旋转轴；虚直径是位于投影面的轴');
      if(model.axes.some(a=>a.improper.length))addLegend('n̅','空心△/□/⬡上划线：3̅/4̅/6̅旋转反演轴');
      if(model.mirrors.length)addLegend('━','绿色实线/曲线：镜面与单位球交线的投影','mirror');
      if(model.inversion)addLegend('ⓘ','点群包含反演；实际晶胞中的红点位置见空间群元素图','inversion');
      addLegend('◯','橙色圈：当前空间群操作的方向映射','selected');
      note.textContent='此图只表达点群：螺旋和平移被约去，滑移只留下镜映部分。同一点可能叠加上下半球符号；符号所在纸面上下不代表半球上下。';
    }
    function cellProjector(group,view) {
      const {frame,project,axisLabels}=cellProjectionLayout(group,view);
      const cornersF=Array.from({length:8},(_,i)=>[i&1?1:0,i&2?1:0,i&4?1:0]);
      const edges=new Map();for(const [i,j]of cubeEdges){const a=project(cornersF[i]),b=project(cornersF[j]);if(norm(sub(a,b))<EPS)continue;const key=[vectorKey(a),vectorKey(b)].sort().join(';');if(!edges.has(key))edges.set(key,[a,b]);}
      for(const [a,b]of edges.values())svg.append(line(a,b,{stroke:'#9daab8','stroke-width':1,'data-cell-edge':''}));
      for(const item of axisLabels){svg.append(line(item.leader[0],item.leader[1],{stroke:'#77899a','stroke-width':.9,'data-cell-axis-leader':item.axis}),label(item.position[0],item.baseline,item.axis,{'font-size':12,'font-style':'italic','data-cell-axis-label':item.axis}));}
      return {frame,project};
    }
    function renderPositions() {
      const g=state.group,model=generalPositionModel(g,state.view),{project}=cellProjector(g,state.view),clusters=new Map();
      caption.textContent=`No.${g.id} ${g.name}；沿 +${model.frame.view} 投影，保留平移。基点 ${vector(model.seed)}。`;
      model.points.forEach(p=>{const pos=project(p.fractional),key=vectorKey(pos);if(!clusters.has(key))clusters.set(key,{pos,points:[]});clusters.get(key).points.push(p);});
      for(const cluster of clusters.values()){
        const [x,y]=cluster.pos,selected=cluster.points.some(p=>p.index===state.operationIndex),improper=cluster.points.some(p=>p.determinant<0);
        const title=cluster.points.map(p=>`#${p.index+1} (${p.xyz}) → ${vector(p.fractional)}；高度 ${model.frame.view}=${rational(p.height)}（${p.heightExpression} 折回单胞）；${p.determinant<0?'反手':'同手'}`).join('\n');
        const group=svgEl('g',{'data-general-position':'','data-position-count':cluster.points.length,'data-fractional':cluster.points.map(p=>p.fractional.join(',')).join(';')});
        group.append(svgEl('circle',{cx:x,cy:y,r:5,fill:'white',stroke:selected?'#d77b1f':'#285b80','stroke-width':selected?2.4:1.3}));
        if(improper)group.append(svgEl('path',{d:`M${x+1},${y-2}q3,2 -1,5`,fill:'none',stroke:'#6e387f','stroke-width':1.3}));
        svg.append(addSelectable(group,cluster.points.map(p=>p.index),title));
      }
      svg.append(label(180,292,`${g.operations.length} 个一般等价位置；重合高度在提示中列出`,{'font-size':10}));
      addLegend('○','与基元同手性的等价位置（不是原子种类）');addLegend('◔','圈内逗号：与基元相反手性的映射像');addLegend('N / z','投影重合的位置数与各高度见悬停提示');addLegend('◯','橙色符号：当前操作对应的像','selected');
      note.textContent=`这是一般位置投影，不是所有对称元素的位置图。高度为 ${model.frame.view} 分数坐标；悬停可见原始高度表达式、折回坐标和手性。空间群平移未被约去。`;
    }
    function drawPlane(polygon,project,{kind,labelText,title,selected=false,attrs={}}) {
      if(!polygon||!polygon.length)return;
      const points=polygon.map(project),unique=[];points.forEach(p=>{if(!unique.some(q=>norm(sub(p,q))<1e-5))unique.push(p);});
      if(unique.length===1)svg.append(titled(svgEl('circle',{cx:unique[0][0],cy:unique[0][1],r:3,fill:'white',stroke:selected?'#de852b':kind==='mirror'?'#287961':'#8267a3','stroke-width':1.4,...attrs}),title));
      else if(unique.length===2){svg.append(titled(line(unique[0],unique[1],{stroke:selected?'#de852b':kind==='mirror'?'#287961':'#8267a3','stroke-width':selected?2.7:1.8,'stroke-dasharray':kind==='glide'?'6 3':'none',...attrs}),title));}
      else if(unique.length>2){svg.append(titled(svgEl('polygon',{points:points.map(p=>p.join(',')).join(' '),fill:kind==='mirror'?'#4f9d81':'#9b80b8','fill-opacity':selected?.10:.035,stroke:selected?'#de852b':kind==='mirror'?'#39866b':'#9170ad','stroke-width':selected?2:1,'stroke-dasharray':kind==='glide'?'6 3':'none',...attrs}),title));}
    }
    function axisGlyphLabel(axis) {
      const subscript=s=>s.replace(/_([0-9]+)/g,(_,n)=>[...n].map(v=>'₀₁₂₃₄₅₆₇₈₉'[Number(v)]).join(''));
      const labels=axis.labels||[];return labels.length?labels.map(subscript).join(' / '):(axis.orders||[]).join('/');
    }
    function renderElements(selectedOnly) {
      const g=state.group,op=state.operation||g.operations[state.operationIndex]||g.operations[0],{frame,project}=cellProjector(g,state.view),elements=g.diagramElements;
      caption.textContent=`No.${g.id} ${g.name}；沿 +${frame.view} 投影。${selectedOnly?'当前代表操作的几何元素。':'闭合晶胞内对称元素，投影重合时合并符号。'}`;
      let axes=[],planes=[],centers=[],roto=[],hasTranslation=false,unavailable=false;
      if(selectedOnly){const m=selectedElementModel(g,op);if(m.segment?.length)axes=[{start:m.segment[0],end:m.segment[1],orders:[m.order],kinds:[m.kind],labels:[m.kind==='screw'?`${m.order} 重螺旋`:`${m.order}`],operationIds:[state.operationIndex+1]}];if(m.polygon?.length)planes=[{polygonFractional:m.polygon,kind:m.kind,labels:[m.kind==='glide'?'滑移面':'m'],operationIds:[state.operationIndex+1]}];if(m.kind==='inversion')centers=[m.center];if(m.kind==='rotoinversion')roto=[{centerFractional:m.center,axisFractional:m.axis,order:m.order,operationIds:[state.operationIndex+1]}];hasTranslation=m.kind==='translation';}
      else if(elements){axes=elements.axes||[];planes=elements.planes||[];centers=elements.inversionCenters||g.inversionCenters||[];roto=elements.rotoinversions||[];}
      else unavailable=true;
      const allCounts={axes:axes.length,planes:planes.length,centers:centers.length,roto:roto.length};
      if(!selectedOnly){if(!visibleTypes.axes)axes=[];if(!visibleTypes.planes)planes=[];if(!visibleTypes.centers)centers=[];if(!visibleTypes.roto)roto=[];caption.textContent+=` 轴 ${allCounts.axes}、面 ${allCounts.planes}、反演中心 ${allCounts.centers}、旋转反演 ${allCounts.roto}（含边界）。`;}
      const selectedFor=item=>(item.operationIds||[]).includes(state.operationIndex+1);
      const planeClusters=new Map();
      for(const plane of planes){const polygon=plane.polygonFractional||plane.polygon||[],key=plane.kind+'|'+[...new Set(polygon.map(p=>vectorKey(project(p))))].sort().join(';');if(!planeClusters.has(key))planeClusters.set(key,{plane,items:[],selected:false});const c=planeClusters.get(key);c.items.push(plane);c.selected=c.selected||selectedOnly||selectedFor(plane);}
      for(const c of planeClusters.values()){const plane=c.plane;drawPlane(plane.polygonFractional||plane.polygon,project,{kind:plane.kind,labelText:(plane.labels||[plane.kind==='glide'?'滑移面':'m']).join('/'),title:c.items.map(p=>`${p.kind==='glide'?'滑移面':'镜面'}；${p.h?`${vector(p.h)} · r = ${rational(p.offset)}`:op.geometryText}${p.glideVectors?.length?`；滑移分数向量 ${p.glideVectors.map(vector).join(' / ')}`:''}`).join('\n'),selected:c.selected,attrs:{'data-spacegroup-plane':plane.kind,'data-plane-count':c.items.length}});}
      const axisClusters=new Map();
      axes.forEach(axis=>{
        const a=project(axis.start||axis.startFractional),b=project(axis.end||axis.endFractional),mid=mul(add(a,b),.5),key=vectorKey(mid),selected=selectedOnly||selectedFor(axis),screw=(axis.kinds||[]).includes('screw');
        if(!axisClusters.has(key))axisClusters.set(key,{mid,axes:[],selected:false});const c=axisClusters.get(key);c.axes.push(axis);c.selected=c.selected||selected;
      });
      const projectedLines=new Map();
      for(const axis of axes){const a=project(axis.start||axis.startFractional),b=project(axis.end||axis.endFractional);if(norm(sub(a,b))<1e-5)continue;const key=[vectorKey(a),vectorKey(b)].sort().join(';');if(!projectedLines.has(key))projectedLines.set(key,{a,b,axes:[],selected:false});const c=projectedLines.get(key);c.axes.push(axis);c.selected=c.selected||selectedOnly||selectedFor(axis);}
      for(const c of projectedLines.values()){const screw=c.axes.some(a=>(a.kinds||[]).includes('screw'));svg.append(titled(line(c.a,c.b,{stroke:c.selected?'#de852b':'#365d7b','stroke-width':c.selected?2.4:1.1,'stroke-dasharray':screw?'4 3':'none','data-spacegroup-axis-line':'','data-axis-count':c.axes.length}),c.axes.map(a=>`轴 ${axisGlyphLabel(a)}；分数线段 ${vector(a.start||a.startFractional)} → ${vector(a.end||a.endFractional)}`).join('\n')));}
      for(const cluster of axisClusters.values()){
        const allOrders=cluster.axes.flatMap(a=>a.orders||[]),n=allOrders.length?Math.max(...allOrders):2,screw=cluster.axes.some(a=>(a.kinds||[]).includes('screw'));
        svg.append(glyph(cluster.mid[0],cluster.mid[1],n,{screw,selected:cluster.selected,title:cluster.axes.map(a=>`轴 ${axisGlyphLabel(a)}：${vector(a.start||a.startFractional)} → ${vector(a.end||a.endFractional)}`).join('\n'),attrs:{'data-spacegroup-axis':'','data-axis-count':cluster.axes.length}}));
      }
      const centerClusters=new Map();centers.forEach(center=>{const p=project(center),key=vectorKey(p);if(!centerClusters.has(key))centerClusters.set(key,{p,centers:[]});centerClusters.get(key).centers.push(center);});
      for(const c of centerClusters.values())svg.append(titled(svgEl('circle',{cx:c.p[0],cy:c.p[1],r:3.8,fill:'#f52235',stroke:'white','stroke-width':1,'data-diagram-inversion-center':'','data-center-count':c.centers.length}),`反演中心：${c.centers.map(vector).join('；')}。边界位置与相邻晶胞共享。`));
      const rotoClusters=new Map(),rotoLines=new Map();for(const item of roto){const c=item.centerFractional||item.center,p=project(c),key=vectorKey(p);if(!rotoClusters.has(key))rotoClusters.set(key,{p,items:[],selected:false});const cluster=rotoClusters.get(key);cluster.items.push(item);cluster.selected=cluster.selected||selectedOnly||selectedFor(item);
        if(item.axisFractional){const segment=axisSegment(g,{point:mv(g.A,c),axis:unit(mv(g.A,item.axisFractional))});if(segment.length){const a=project(segment[0]),b=project(segment[1]);if(norm(sub(a,b))>1e-5){const lk=[vectorKey(a),vectorKey(b)].sort().join(';');if(!rotoLines.has(lk))rotoLines.set(lk,{a,b,items:[]});rotoLines.get(lk).items.push(item);}}}
      }
      for(const c of rotoLines.values())svg.append(titled(line(c.a,c.b,{stroke:'#3a806c','stroke-width':.95,'stroke-dasharray':'2 3','data-spacegroup-roto-axis':''}),c.items.map(i=>`旋转反演轴 ${i.order}；过 ${vector(i.centerFractional||i.center)}、沿 ${vector(i.axisFractional)}`).join('\n')));
      for(const c of rotoClusters.values())svg.append(glyph(c.p[0],c.p[1],Math.max(...c.items.map(i=>i.order||4)),{improper:true,selected:c.selected,title:c.items.map(item=>`旋转反演 ${item.order}；固定点 ${vector(item.centerFractional||item.center)}；分数轴向 ${vector(item.axisFractional||[0,0,1])}。独立反演中心须另查红点。`).join('\n'),attrs:{'data-spacegroup-rotoinversion':'','data-roto-count':c.items.length}}));
      if(unavailable)svg.append(label(180,136,'对称元素数据尚未载入',{'font-size':12}));
      else if(!axes.length&&!planes.length&&!centers.length&&!roto.length){svg.append(label(180,141,hasTranslation?'t：整个基元平移，无固定轴/面/中心':selectedOnly&&op.kind==='identity'?'E：恒等，所有位置保持不变':selectedOnly?'当前代表操作的元素未穿过所画晶胞':Object.values(allCounts).some(Boolean)?'所选类型当前已隐藏':'E 与晶格平移；无其它对称元素',{'font-size':11}));}
      svg.append(label(180,292,selectedOnly?`当前操作 ${state.operationIndex>=0?'#'+(state.operationIndex+1):'平移示例'} · ${op.label}`:'边、面与顶点上的元素在相邻晶胞周期重复',{'font-size':10}));
      if(axes.some(a=>(a.kinds||[]).includes('rotation')))addLegend('⬭ △ □ ⬡','纯旋转轴：2、3、4、6 重；轴线投影为实线');
      if(axes.some(a=>(a.kinds||[]).includes('screw')))addLegend('2₁ / nₚ','扭瓣与下标：螺旋轴；虚线表示轴的空间投影');
      if(planes.some(p=>p.kind==='mirror'))addLegend('━ m','绿色实线/浅色面：镜面','mirror');
      if(planes.some(p=>p.kind==='glide'))addLegend('┄ g','紫色虚线/浅色面：通用滑移面 g；具体滑移向量见提示');
      if(centers.length)addLegend('● i','红点：实际反演中心；重合高度在提示中列出','inversion');
      if(roto.length)addLegend('n̅','空心△/□/⬡上划线：3̅/4̅/6̅旋转反演；细绿点线为轴');
      if(!axes.length&&!planes.length&&!centers.length&&!roto.length)addLegend('E / t','恒等与晶格平移；不产生固定的轴、面或中心');
      addLegend('◯',selectedOnly?'橙色标记：当前代表操作的元素':'橙色标记：当前代表操作关联的周期元素族','selected');
      note.textContent=selectedOnly?'只画当前代表操作与闭合晶胞相交的部分；轴未穿过此晶胞时不人为平移它。每条轴/面的位置、螺旋分量仍以操作公式和旁栏为准。':unavailable?'可先使用当前元素、点群或一般位置图。':'同位元素及重合的不同高度/阶数符号已合并，悬停列出全部；可按类型显隐。采用本软件符号图例。';
    }
    function render(){
      if(!state||destroyed)return;
      svg.replaceChildren();legend.replaceChildren();filters.hidden=mode!=='elements';
      tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.diagramMode===mode)));
      container.setAttribute('data-diagram-group',String(state.group.id));container.setAttribute('data-diagram-type',mode);svg.setAttribute('aria-label',`No.${state.group.id} ${state.group.name} ${modes.find(item=>item[0]===mode)[1]}`);
      if(mode==='point')renderPoint();else if(mode==='positions')renderPositions();else renderElements(mode==='selected');
    }
    function update(next){if(!next?.group||destroyed)return;const opIndex=Number.isInteger(next.operationIndex)&&next.operationIndex>=0&&next.operationIndex<next.group.operations.length?next.operationIndex:-1;const key=[next.group.id,opIndex,next.view||'',next.operation?.id||'',Boolean(next.group.diagramElements)].join('|');state={...next,operationIndex:opIndex};if(key!==cacheKey){cacheKey=key;render();}}
    function destroy(){destroyed=true;container.replaceChildren();container.classList.remove('sv-diagrams');}
    return {update,destroy,setMode(value){if(modes.some(item=>item[0]===value)){mode=value;render();}},getMode(){return mode;}};
  }
  return {mount,math:{projectionFrame,projectStereographic,uniqueRotations,pointGroupModel,generalPositionModel,selectedElementModel,axisSegment,planeSection,classifyMatrix,cellProjectionLayout}};
});
