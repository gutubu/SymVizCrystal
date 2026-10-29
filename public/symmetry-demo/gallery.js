(async () => {
  const root=document.getElementById('polar-space-group-gallery');
  const [response,elementResponse]=await Promise.all([fetch(new URL('./catalog.json',window.location.href)),fetch(new URL('./element-diagrams.json',window.location.href))]);
  if(!response.ok||!elementResponse.ok)throw new Error('空间群目录或投影图数据加载失败');
  const [database,elementDatabase]=await Promise.all([response.json(),elementResponse.json()]);
  const elementById=new Map(elementDatabase.groups.map(g=>[g.id,g]));
  for(const g of database.groups){g.diagramElements=elementById.get(g.id);if(!g.diagramElements)throw new Error('空间群投影图数据不完整');}
  const groups=database.groups,byId=new Map(groups.map(g=>[g.id,g]));
  const categorySelect=root.querySelector('#pg-category'),familySelect=root.querySelector('#pg-family'),groupSelect=root.querySelector('#pg-group'),opSelect=root.querySelector('#pg-operation'),viewSelect=root.querySelector('#pg-view');
  const svg=root.querySelector('.pg-stage'),scene=root.querySelector('[data-scene]'),slider=root.querySelector('#pg-phase'),readout=root.querySelector('#pg-readout');
  const meta=root.querySelector('[data-meta]'),polar=root.querySelector('[data-polar]'),formula=root.querySelector('[data-formula]'),geometry=root.querySelector('[data-geometry]'),result=root.querySelector('[data-result]');
  const play=root.querySelector('[data-play]'),table=root.querySelector('[data-table]'),allDetails=root.querySelector('[data-all-operations]');
  const repeatInput=root.querySelector('#pg-repeat'),centersInput=root.querySelector('#pg-centers');
  const explanationTitle=root.querySelector('[data-explanation-title]'),explanationGroup=root.querySelector('[data-explanation-group]'),descriptionText=root.querySelector('[data-description]'),stepsList=root.querySelector('[data-steps]'),compositionText=root.querySelector('[data-composition]'),inversionStatus=root.querySelector('[data-inversion-status]');
  const NS='http://www.w3.org/2000/svg',reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),seed=[.173,.287,.219];
  const offsets=[[0,0,0],[.14,.012,.018],[.025,.115,.06],[-.025,.008,.105]];
  function categoryOf(g){return g.centrosymmetric?'centrosymmetric':g.polarGroup?'polar':'nonpolar-acentric';}
  function categoryLabel(g){return {polar:'极性',centrosymmetric:'中心对称','nonpolar-acentric':'非中心对称、非极性'}[categoryOf(g)];}
  function polarityText(g){return g.centrosymmetric?'有反演中心 · 不允许非零宏观极化':g.polarGroup?`允许极性：${g.polar}`:'无反演中心 · 对称性禁止非零宏观极化';}
  const families=[...new Set(groups.map(g=>g.pointGroup))],categories=['all','polar','centrosymmetric','nonpolar-acentric'];
  let state={groupId:3,category:'all',filter:'all',opIndex:1,phase:1,mode:'operation',view:'3d',yaw:.6,pitch:.3,tableOpen:false,repeats:false,showCenters:true},frame=0,drag=null,lastExplanation='';
  let pageView='spacegroup',parentVisible=true;
  const add=(a,b)=>a.map((n,i)=>n+b[i]),sub=(a,b)=>a.map((n,i)=>n-b[i]),mul=(a,s)=>a.map(n=>n*s),dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),unit=a=>mul(a,1/norm(a));
  const mv=(A,v)=>A.map(r=>dot(r,v)),mod=n=>{const v=((n%1)+1)%1;return v<1e-9||v>1-1e-9?0:v;};
  const fmt=n=>(Math.abs(n)<.00005?0:n).toFixed(3),frac=f=>`(${f.map(fmt).join(', ')})`;
  const integerExamples=Object.fromEntries(['a','b','c'].map((name,i)=>{
    const t=[0,0,0];t[i]=1;const R=[[1,0,0],[0,1,0],[0,0,1]],xyz=['x','y','z'].map((s,k)=>s+(k===i?'+1':'')).join(',');
    return ['t'+name,{id:'t'+name,xyz,R,t,kind:'translation',label:'整数平移 +'+name,geometryText:'沿 '+name+' 平移一个晶格周期，取向保持不变',description:'将整个基元沿晶格 '+name+' 方向平移一个晶胞周期。所有点具有相同的位移，基元的形状和取向保持不变。',steps:['各点的 '+name+' 分数坐标增加 1，另两个分数坐标不变。','得到与起始基元周期等价的像；折回同一晶胞后重合。']}];
  }));
  const activeGroup=()=>byId.get(state.groupId),activeOp=()=>{
    if(Number.isInteger(state.opIndex))return activeGroup().operations[state.opIndex];
    const op=integerExamples[state.opIndex];return {...op,Q:op.R,v:mv(activeGroup().A,op.t)};
  };
  const matchesCategory=g=>state.category==='all'||categoryOf(g)===state.category;
  const matchesFilter=g=>matchesCategory(g)&&(state.filter==='all'||g.pointGroup===state.filter);
  const repetitions=()=>state.mode==='orbit'?1:state.repeats?2:1;
  const notify=(type,payload={})=>{if(window.parent!==window)window.parent.postMessage({type,...payload},window.location.origin);};
  function restore(snapshot){
    const s=snapshot?.privateContent;if(!s||s.version!==1||s.collection!=='symviz-library-v1')return;
    if(byId.has(s.groupId))state.groupId=s.groupId;
    if(categories.includes(s.category))state.category=s.category;
    if(s.filter==='comparison'){state.category='centrosymmetric';state.filter='all';}
    else if(s.filter==='all'||families.includes(s.filter))state.filter=s.filter;
    if(!matchesCategory(activeGroup()))state.category='all';
    if(!matchesFilter(activeGroup()))state.filter='all';
    if(Number.isInteger(s.opIndex))state.opIndex=Math.max(0,Math.min(activeGroup().operations.length-1,s.opIndex));
    else if(Object.hasOwn(integerExamples,s.opIndex))state.opIndex=s.opIndex;
    if(Number.isFinite(s.phase))state.phase=Math.max(0,Math.min(1,s.phase));
    if(s.mode==='orbit'||s.mode==='operation')state.mode=s.mode;
    if(['3d','a','b','c'].includes(s.view))state.view=s.view;
    if(Number.isFinite(s.yaw))state.yaw=s.yaw;
    if(Number.isFinite(s.pitch))state.pitch=Math.max(-1.1,Math.min(1.1,s.pitch));
    if(typeof s.tableOpen==='boolean')state.tableOpen=s.tableOpen;
    if(typeof s.repeats==='boolean')state.repeats=s.repeats;
    if(typeof s.showCenters==='boolean')state.showCenters=s.showCenters;
    if(state.mode==='orbit'&&!Number.isInteger(state.opIndex))state.opIndex=0;
  }
  function save(){try{window.localStorage.setItem('symviz.symmetry-demo.v1',JSON.stringify({privateContent:{version:1,collection:'symviz-library-v1',...state}}));}catch{}}
  function option(value,label,disabled=false){const o=document.createElement('option');o.value=String(value);o.textContent=label;o.disabled=disabled;return o;}
  try{restore(JSON.parse(window.localStorage.getItem('symviz.symmetry-demo.v1')||'null'));}catch{}
  root.querySelector('[data-catalog-summary]').textContent=`全部 ${groups.length} 类空间群 · 68 类极性 · 92 类中心对称 · 70 类非心非极性 · ${groups.reduce((n,g)=>n+g.operations.length,0)} 个代表操作`;
  function buildFamilyOptions(){
    familySelect.replaceChildren(option('all','全部点群'));
    for(const f of families){const count=groups.filter(g=>matchesCategory(g)&&g.pointGroup===f).length;if(count)familySelect.append(option(f,`${f} · ${count} 类`));}
    if(!Array.from(familySelect.options).some(o=>o.value===state.filter))state.filter='all';
    familySelect.value=state.filter;categorySelect.value=state.category;
  }
  function buildGroupOptions(){
    groupSelect.replaceChildren();
    for(const g of database.groups){if(!matchesFilter(g))continue;groupSelect.append(option(g.id,`${g.id} · ${g.name}${state.category==='all'?' · '+categoryLabel(g):''}`));}
    groupSelect.value=String(state.groupId);familySelect.value=state.filter;
  }
  function buildOperations(){
    const g=activeGroup();opSelect.replaceChildren();table.replaceChildren();
    g.operations.forEach((op,i)=>{
      opSelect.append(option(i,`${i+1}. ${op.label} · ${op.xyz}`));
      const row=document.createElement('tr');row.dataset.index=String(i);
      for(const content of [String(i+1),op.label,op.xyz]){const c=document.createElement('td');c.textContent=content;c.className='pg-table-formula';row.append(c);}table.append(row);
    });
    const translationOptions=document.createElement('optgroup');translationOptions.label='整数晶格平移示例';for(const [key,op] of Object.entries(integerExamples))translationOptions.append(option(key,op.label+' · '+op.xyz));opSelect.append(translationOptions);
    root.querySelector('[data-table-title]').textContent=`全部 ${g.operations.length} 个代表操作（模整数晶格平移）`;
    root.querySelector('[data-setting]').textContent=`H–M：${g.hm}；设定：${g.setting}；Hall：${g.hall}${g.aliases?.length?'；旧名/别名：'+g.aliases.join(', '):''}`;
    root.querySelector('[data-cell]').textContent=`示意晶胞比例 a:b:c = ${g.cell.slice(0,3).join(':')}；α, β, γ = ${g.cell.slice(3).join('°, ')}°`;
    allDetails.open=state.tableOpen;
  }
  function rotate(p,n,angle){const c=Math.cos(angle),s=Math.sin(angle);return add(add(mul(p,c),mul(cross(n,p),s)),mul(n,dot(n,p)*(1-c)));}
  function transformOnce(p,op,t){
    if(op.kind==='identity')return [...p];
    if(op.kind==='translation')return add(p,mul(op.v,t));
    if(op.kind==='inversion')return add(op.center,mul(sub(p,op.center),1-2*t));
    if(op.kind==='rotoinversion'){
      const turned=rotate(sub(p,op.center),op.axis,op.angle*Math.min(1,2*t));
      return add(op.center,mul(turned,1-2*Math.max(0,2*t-1)));
    }
    if(op.kind==='rotation'||op.kind==='screw')return add(add(op.point,rotate(sub(p,op.point),op.axis,op.angle*t)),mul(op.parallel,t));
    const reflection=op.kind==='mirror'?t:Math.min(1,2*t),slide=op.kind==='mirror'?0:Math.max(0,2*t-1);
    return add(sub(p,mul(op.normal,2*reflection*(dot(op.normal,p)-op.planeD))),mul(op.parallel,slide));
  }
  function exact(p,op){return add(mv(op.Q,p),op.v);}
  function selectedExact(p,op){return repetitions()===2?exact(exact(p,op),op):exact(p,op);}
  function transform(p,op,t){if(repetitions()===1)return transformOnce(p,op,t);return t<=.5?transformOnce(p,op,2*t):transformOnce(exact(p,op),op,2*t-1);}
  function rational(n){
    if(Math.abs(n)<1e-8)return '0';const sign=n<0?'-':'';let p=Math.round(Math.abs(n)*48),q=48;
    const gcd=(a,b)=>b?gcd(b,a%b):a,d=gcd(p,q);p/=d;q/=d;return sign+(q===1?String(p):`${p}/${q}`);
  }
  function coordinateFormula(op){
    if(repetitions()===1)return op.xyz;
    const R=op.R.map(row=>[0,1,2].map(j=>row.reduce((s,c,k)=>s+c*op.R[k][j],0))),t=add(mv(op.R,op.t),op.t);
    return R.map((row,i)=>{let s='';row.forEach((c,j)=>{if(!c)return;s+=(c>0&&s?'+':'')+(c===1?'':c===-1?'-':String(c))+['x','y','z'][j];});if(Math.abs(t[i])>1e-8)s+=(t[i]>0&&s?'+':'')+rational(t[i]);return s||'0';}).join(',');
  }
  function explain(g,op,orbit){
    const key=`${g.id}:${state.opIndex}:${repetitions()}:${orbit}:${state.showCenters}`;
    if(key===lastExplanation)return;lastExplanation=key;
    explanationGroup.textContent=`No.${g.id} ${g.name} · ${categoryLabel(g)}空间群`;
    explanationTitle.textContent=op.label;
    descriptionText.textContent=op.description||op.geometryText;
    const notes=[...(op.steps||[op.geometryText])];
    if(op.kind==='rotoinversion')notes.push('旋转与同心反演的顺序可交换；分解的每一步未必单独属于该空间群。');
    if(op.kind==='glide')notes.push('镜映与平移是几何分解，镜映本身未必属于该空间群。');
    stepsList.replaceChildren(...notes.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    compositionText.textContent=orbit?'总览将基元中心折回常规晶胞，基元保持完整。':repetitions()===2?`连续两次的结果为 (${coordinateFormula(op).replaceAll(',',', ')})。进度前半段为第一次，后半段为第二次。`:'单次映射；中间帧为几何插值。';
    const centers=g.inversionCenters||[];
    inversionStatus.classList.toggle('has-centers',!!g.centrosymmetric);
    inversionStatus.textContent=g.centrosymmetric?`${state.showCenters?'红色亮点标出':'当前隐藏了'} ${centers.length} 个反演中心显示点（含晶胞边界）。悬停查看分数坐标；投影时可能重合。`:`本空间群没有反演中心。${!g.polarGroup?'对称性禁止非零宏观极化。':''}${op.kind==='rotoinversion'?'所选旋转反演的固定点用绿色圈标示；该分解包含反演步骤，但反演单独并不是本群的对称操作。':''}`;
  }
  function camera(p,g){
    if(state.view!=='3d'){
      const k={a:0,b:1,c:2}[state.view],direction=unit(g.A.map(r=>r[k]));
      let ref=g.A.map(r=>r[(k+1)%3]);if(k===2)ref=g.A.map(r=>r[0]);
      const right=unit(sub(ref,mul(direction,dot(ref,direction)))),up=unit(cross(direction,right));
      return [dot(p,right),-dot(p,up),dot(p,direction)];
    }
    const mono=g.system==='monoclinic',depth=mono?p[2]:p[1],vertical=mono?p[1]:p[2];
    const x=p[0]*Math.cos(state.yaw)+depth*Math.sin(state.yaw),d=-p[0]*Math.sin(state.yaw)+depth*Math.cos(state.yaw);
    return [x,-vertical*Math.cos(state.pitch)+d*Math.sin(state.pitch),d*Math.cos(state.pitch)+vertical*Math.sin(state.pitch)];
  }
  function element(tag,attrs={},content){const node=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,String(v)));if(content!=null)node.textContent=content;if(attrs['data-tooltip']){const title=document.createElementNS(NS,'title');title.textContent=attrs['data-tooltip'];node.append(title);}return node;}
  const cubeEdges=[];for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if([1,2,4].includes(i^j))cubeEdges.push([i,j]);
  function boxCorners(lo,hi,A){const out=[];for(let i=0;i<8;i++)out.push(mv(A,[i&1?hi[0]:lo[0],i&2?hi[1]:lo[1],i&4?hi[2]:lo[2]]));return out;}
  function planePolygon(op,corners){
    const points=[];function include(p){if(!points.some(q=>norm(sub(p,q))<1e-7))points.push(p);}
    for(const [i,j] of cubeEdges){const a=corners[i],b=corners[j],da=dot(op.normal,a)-op.planeD,db=dot(op.normal,b)-op.planeD;if(Math.abs(da)<1e-8)include(a);if(Math.abs(db)<1e-8)include(b);if(da*db<0)include(add(a,mul(sub(b,a),da/(da-db))));}
    if(points.length<3)return [];
    const center=mul(points.reduce(add,[0,0,0]),1/points.length),u=unit(sub(points[0],center)),v=unit(cross(op.normal,u));
    return points.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
  }
  function draw(){
    const g=activeGroup(),op=activeOp(),cart=f=>mv(g.A,f),toFrac=p=>mv(g.Ai,p),base=cart(seed),orbit=state.mode==='orbit';
    const box=svg.getBoundingClientRect(),w=Math.max(280,box.width||700),h=w<480?350:420;if(Math.abs(box.height-h)>1)svg.style.height=`${h}px`;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);scene.replaceChildren();
    const cellCorners=boxCorners([0,0,0],[1,1,1],g.A),path=[];for(let i=0;i<=40;i++)path.push(transform(base,op,i/40));
    const pool=[...cellCorners];
    let plane=[],axisEnds=[];
    if(!orbit){
      pool.push(...path);for(let i=0;i<=40;i++)for(const v of offsets)pool.push(transform(add(base,v),op,i/40));
      if(op.kind==='mirror'||op.kind==='glide'){
        const f=pool.map(toFrac),lo=[0,1,2].map(k=>Math.min(0,...f.map(p=>p[k]))-.04),hi=[0,1,2].map(k=>Math.max(1,...f.map(p=>p[k]))+.04);
        plane=planePolygon(op,boxCorners(lo,hi,g.A));pool.push(...plane);
      }
      if(op.kind==='rotation'||op.kind==='screw'||op.kind==='rotoinversion'){
        const length=Math.max(...g.cell.slice(0,3)),along=[...cellCorners,...path].map(p=>dot(sub(p,op.point),op.axis));
        axisEnds=[add(op.point,mul(op.axis,Math.min(...along)-.08*length)),add(op.point,mul(op.axis,Math.max(...along)+.08*length))];pool.push(...axisEnds);
      }
    }
    const cam=pool.map(p=>camera(p,g)),minX=Math.min(...cam.map(p=>p[0])),maxX=Math.max(...cam.map(p=>p[0])),minY=Math.min(...cam.map(p=>p[1])),maxY=Math.max(...cam.map(p=>p[1]));
    const scale=Math.min((w-(w<480?62:112))/Math.max(.1,maxX-minX),(h-84)/Math.max(.1,maxY-minY));
    const cx=w/2-scale*(minX+maxX)/2,cy=h/2-scale*(minY+maxY)/2,project=p=>{const v=camera(p,g);return [cx+v[0]*scale,cy+v[1]*scale,v[2]];};
    const line=(a,b,cls,extra={})=>element('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],class:cls,...extra});
    function polyline(points,cls,extra={}){return element('path',{d:points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '),class:cls,...extra});}
    function label(p,text,dx=0,dy=0,anchor='start',minor=false){const t=element('text',{x:p[0]+dx,y:p[1]+dy,class:`halo text-small${minor?' minor':''}`,'text-anchor':anchor},text);scene.append(t);return t;}
    const wireEdges=cubeEdges.map(([i,j])=>[project(cellCorners[i]),project(cellCorners[j])]);wireEdges.sort((a,b)=>(a[0][2]+a[1][2])-(b[0][2]+b[1][2])).forEach(([a,b])=>scene.append(line(a,b,'wire')));
    if(plane.length){
      const p=plane.map(project);scene.append(element('polygon',{points:p.map(v=>`${v[0]},${v[1]}`).join(' '),fill:'var(--viz-series-3)','fill-opacity':.08,stroke:'var(--viz-series-3)','stroke-opacity':.4,'stroke-width':1.2}));
      const anchor=p.reduce((best,v)=>v[0]>best[0]?v:best,p[0]);label(anchor,op.kind==='mirror'?'镜面':'滑移面',-6,-10,'end');
    }
    if(axisEnds.length){
      const a=project(axisEnds[0]),b=project(axisEnds[1]);scene.append(line(a,b,'element',{'stroke-dasharray':'5 4'}));
      if(Math.hypot(a[0]-b[0],a[1]-b[1])<8){scene.append(element('circle',{cx:a[0],cy:a[1],r:6,fill:'var(--background)',stroke:'var(--viz-series-3)','stroke-width':1.5}));label(a,op.label,10,-12);}
      else{const high=a[1]<b[1]?a:b;label(high,op.label,0,-10,'middle');}
    }
    if(!orbit&&op.kind!=='identity'){
      scene.append(polyline(path.map(project),'track',{'stroke-dasharray':'3 5',opacity:.3}));
      const p=[];for(let i=0;i<=40;i++)p.push(project(transform(base,op,state.phase*i/40)));scene.append(polyline(p,'trace'));
      if(op.kind==='glide'){
        const R=project(transformOnce(base,op,.5));scene.append(element('circle',{cx:R[0],cy:R[1],r:3.5,fill:'var(--background)',stroke:'var(--viz-series-2)','stroke-width':1.3}));label(R,'R',-10,17,'end');
      }
    }
    const drawables=[],hitTargets=[];
    function motif(center,opToUse,cls,alpha,size=1){
      const pts=offsets.map(v=>project(opToUse(add(base,mul(v,size)))));
      for(let i=1;i<pts.length;i++)drawables.push({depth:(pts[0][2]+pts[i][2])/2,node:line(pts[0],pts[i],cls,{'stroke-width':orbit?2.8:4.2,'stroke-linecap':'round',opacity:alpha})});
      pts.forEach((p,i)=>drawables.push({depth:p[2]+.001,node:element('circle',{cx:p[0],cy:p[1],r:(orbit?[4.5,3.3,2.5,2]:[7,5,4,3])[i],class:cls,opacity:alpha,'stroke-width':1})}));
    }
    if(orbit){
      g.operations.forEach((operation,i)=>{
        const raw=exact(base,operation),f=toFrac(raw),wrap=cart(f.map((n,k)=>mod(n)-f[k]));
        motif(raw,p=>add(exact(p,operation),wrap),i===state.opIndex?'image':'seed',i===state.opIndex?1:.5,.6);
        const center=project(add(raw,wrap));
        const mark=element('circle',{cx:center[0],cy:center[1],r:16,fill:'var(--foreground)','fill-opacity':0,'data-tooltip':`#${i+1} ${operation.xyz} → ${frac(f.map(mod))}`});hitTargets.push(mark);
      });
    }else{
      motif(base,p=>p,'seed',op.kind==='identity'?1:.65);
      if(op.kind!=='identity'){
        if(state.phase<.998)motif(base,p=>selectedExact(p,op),'image',.13);
        motif(base,p=>transform(p,op,state.phase),'image',1);
      }
    }
    drawables.sort((a,b)=>a.depth-b.depth).forEach(d=>scene.append(d.node));
    hitTargets.forEach(node=>scene.append(node));
    if(g.centrosymmetric&&state.showCenters){
      for(const fractional of g.inversionCenters||[]){
        const p=project(cart(fractional)),selected=!orbit&&op.kind==='inversion'&&norm(sub(cart(fractional),op.center))<1e-7;
        const coordinates=`(${fractional.map(rational).join(', ')})`,tooltip=`反演中心 ${coordinates}（分数坐标；边界中心与相邻晶胞共享）`;
        scene.append(element('circle',{cx:p[0],cy:p[1],r:selected?10:7,class:'inversion-glow','aria-hidden':'true'}));
        if(selected)scene.append(element('circle',{cx:p[0],cy:p[1],r:8,class:'inversion-ring','aria-hidden':'true'}));
        scene.append(element('circle',{cx:p[0],cy:p[1],r:selected?4.7:3.8,class:'inversion-center','data-inversion-center':fractional.join(','),'data-selected':String(selected),'data-tooltip':tooltip,'aria-label':tooltip}));
        if(selected)label(p,w<480?'O':'O · 反演中心',12,-11);
      }
    }
    if(!orbit&&op.kind==='rotoinversion'){
      const O=project(op.center);scene.append(element('circle',{cx:O[0],cy:O[1],r:5,fill:'none',stroke:'var(--viz-series-3)','stroke-width':1.5}));label(O,'旋转反演固定点',10,17);
    }
    if(orbit){
      g.operations.forEach((operation,i)=>{if(g.operations.length>8&&i!==state.opIndex)return;const raw=toFrac(exact(base,operation)),p=project(cart(raw.map(mod)));label(p,`#${i+1}`,10,-10);});
    }else{
      const pA=project(base),pB=project(selectedExact(base,op)),overlap=Math.hypot(pA[0]-pB[0],pA[1]-pB[1])<15;
      label(pA,op.kind==='identity'?'A = E(A)':overlap?'A / B':'A',-12,-13,'end');if(!overlap&&op.kind!=='identity')label(pB,'B',12,18);
    }
    const triad=[40,h-40];
    for(const [i,name] of ['a','b','c'].entries()){
      const v=camera(g.A.map(r=>r[i]),g),length=Math.hypot(v[0],v[1]);if(length<1e-8)continue;
      const end=[triad[0]+v[0]/length*25,triad[1]+v[1]/length*25];scene.append(line(triad,end,'axis'));label(end,name,v[0]>=0?6:-6,v[1]>=0?12:-5,v[0]>=0?'start':'end');
    }
    if(state.view!=='3d')label([w/2,20],`沿 ${state.view} 轴投影 · 轴向位移被隐藏`,0,0,'middle',true);
    opSelect.value=String(state.opIndex);viewSelect.value=state.view;
    meta.textContent=`No.${g.id} · ${g.hm} · 点群 ${g.pointGroup} · ${categoryLabel(g)}`;polar.textContent=polarityText(g);
    formula.textContent=`→ (${coordinateFormula(op).replaceAll(',',', ')})`;
    const description=op.geometryText+(repetitions()===2?'；连续执行两次':'');if(geometry.textContent!==description)geometry.textContent=description;
    explain(g,op,orbit);
    root.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode)));
    table.querySelectorAll('tr').forEach(row=>row.setAttribute('aria-current',String(Number(row.dataset.index)===state.opIndex)));
    root.querySelector('[data-count]').textContent=`一般位置重数 ${g.operations.length}`;
    root.querySelector('[data-seed-legend]').textContent=orbit?'其余等价位置':'A 原始基元';root.querySelector('[data-image-legend]').textContent=orbit?'所选等价位置':'当前操作的映射像';
    root.querySelector('[data-center-legend]').hidden=!g.centrosymmetric;
    root.querySelector('[data-center-count]').textContent=`反演中心 ${g.inversionCenters?.length||0}（含边界）${state.showCenters?'':' · 已隐藏'}`;
    centersInput.checked=state.showCenters;centersInput.disabled=!g.centrosymmetric;
    const disabled=orbit||op.kind==='identity';slider.disabled=disabled;play.disabled=disabled;slider.value=String(state.phase);
    repeatInput.checked=state.repeats;repeatInput.disabled=disabled;
    opSelect.querySelectorAll('optgroup option').forEach(o=>o.disabled=orbit);
    readout.textContent=orbit?'单胞内全部位置':op.kind==='identity'?'恒等：无位移':repetitions()===2?(state.phase>.999?'连续两次完成':`第 ${state.phase<.5?1:2} 次 · ${Math.round((state.phase*2%1)*100)}%`):op.kind==='glide'?(state.phase<.5?`镜映 ${Math.round(state.phase*200)}%`:`镜映完成 · 滑移 ${Math.round((state.phase-.5)*200)}%`):op.kind==='rotoinversion'?(state.phase<.5?`旋转 ${Math.round(state.phase*200)}%`:`旋转完成 · 反演 ${Math.round((state.phase-.5)*200)}%`):`${Math.round(state.phase*100)}%`;
    slider.setAttribute('aria-valuetext',readout.textContent);
    const f=orbit?toFrac(exact(base,op)):toFrac(transform(base,op,state.phase));
    result.setAttribute('aria-live',frame?'off':'polite');
    result.textContent=`${orbit?'所选位置':op.kind==='identity'?'A':state.phase<.998?'变换中':'B'} ${frac(f)} · 单胞内 ${frac(f.map(mod))}`;
    svg.setAttribute('aria-label',`No.${g.id} ${g.name}，${op.label}，${coordinateFormula(op)}。${orbit?'显示全部一般等价位置。':op.geometryText}。${g.centrosymmetric&&state.showCenters?'红色亮点标示反演中心。':'无红色反演中心标记。'}`);
    if(pageView==='spacegroup')diagrams.update({group:g,operationIndex:Number.isInteger(state.opIndex)?state.opIndex:0,operation:op,view:state.view});
  }
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;play.textContent='重播映射';}
  function animate(){
    stop();if(state.mode==='orbit'||activeOp().kind==='identity'||reduced.matches){state.phase=1;draw();save();return;}
    const start=performance.now();state.phase=0;play.textContent='暂停';
    function tick(now){const t=Math.min(1,(now-start)/(1600*repetitions()));state.phase=t*t*(3-2*t);if(t<1){frame=requestAnimationFrame(tick);draw();}else{frame=0;state.phase=1;play.textContent='重播映射';draw();save();}}
    frame=requestAnimationFrame(tick);
  }
  function chooseOperation(i){stop();state.opIndex=i;state.phase=1;animate();}
  function applyFilters(){stop();const candidates=groups.filter(matchesFilter);if(!candidates.some(g=>g.id===state.groupId))state.groupId=candidates[0].id;state.opIndex=Math.min(1,activeGroup().operations.length-1);state.phase=1;state.repeats=false;buildGroupOptions();buildOperations();draw();save();}
  categorySelect.addEventListener('change',()=>{state.category=categorySelect.value;buildFamilyOptions();applyFilters();});
  familySelect.addEventListener('change',()=>{state.filter=familySelect.value;applyFilters();});
  function selectGroup(number){if(!byId.has(number))return false;stop();state.groupId=number;if(!matchesCategory(activeGroup()))state.category='all';if(!matchesFilter(activeGroup()))state.filter='all';state.opIndex=Math.min(1,activeGroup().operations.length-1);state.phase=1;state.repeats=false;buildFamilyOptions();buildGroupOptions();buildOperations();draw();save();return true;}
  groupSelect.addEventListener('change',()=>selectGroup(Number(groupSelect.value)));
  opSelect.addEventListener('change',()=>chooseOperation(Object.hasOwn(integerExamples,opSelect.value)?opSelect.value:Number(opSelect.value)));
  root.querySelector('[data-next]').addEventListener('click',()=>{const indices=activeGroup().operations.map((_,i)=>i).concat(state.mode==='orbit'?[]:Object.keys(integerExamples));chooseOperation(indices[(indices.indexOf(state.opIndex)+1)%indices.length]);});
  viewSelect.addEventListener('change',()=>{stop();state.view=viewSelect.value;draw();save();});
  root.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{stop();state.mode=b.dataset.mode;if(state.mode==='orbit'&&!Number.isInteger(state.opIndex))state.opIndex=0;state.phase=1;draw();save();}));
  repeatInput.addEventListener('change',()=>{stop();state.repeats=repeatInput.checked;state.phase=1;draw();save();});
  centersInput.addEventListener('change',()=>{state.showCenters=centersInput.checked;draw();save();});
  slider.addEventListener('input',()=>{stop();state.phase=Number(slider.value);draw();});slider.addEventListener('change',save);
  play.addEventListener('click',()=>{if(frame){stop();draw();save();}else animate();});
  allDetails.addEventListener('toggle',()=>{if(state.tableOpen===allDetails.open)return;state.tableOpen=allDetails.open;save();});
  svg.addEventListener('pointerdown',e=>{if(e.button!==0||state.view!=='3d')return;drag={x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch};svg.setPointerCapture(e.pointerId);svg.style.cursor='grabbing';});
  svg.addEventListener('pointermove',e=>{if(!drag)return;state.yaw=drag.yaw+(e.clientX-drag.x)*.008;state.pitch=Math.max(-1.1,Math.min(1.1,drag.pitch+(e.clientY-drag.y)*.006));draw();});
  function endDrag(){if(!drag)return;drag=null;svg.style.cursor='';save();}svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);
  window.addEventListener('message',e=>{if(e.source!==window.parent||e.origin!==window.location.origin)return;const data=e.data;if(data?.type==='symviz:symmetry-demo/select-group'&&Number.isInteger(data.number)){selectGroup(data.number);setPageView('spacegroup');}if(data?.type==='symviz:symmetry-demo/select-view'&&['spacegroup','transition'].includes(data.view))setPageView(data.view);if(data?.type==='symviz:symmetry-demo/visibility'&&typeof data.visible==='boolean'){parentVisible=data.visible;if(!parentVisible){stop();draw();save();}syncTransitionVisibility();}});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();notify('symviz:symmetry-demo/open-file');}});
  let lastHeight=0;function reportHeight(){const height=Math.ceil(root.getBoundingClientRect().height+32);if(height!==lastHeight){lastHeight=height;notify('symviz:symmetry-demo/height',{height});}}
  const diagrams=window.SymVizDiagrams.mount(root.querySelector('[data-diagram-panel]'),{onSelectOperation:index=>chooseOperation(index)});
  const transitionSelect=root.querySelector('#pg-transition-species');
  const transitions=new Map([...root.querySelectorAll('[data-transition-panel]')].map(container=>[container.dataset.transitionSpecies,{container,viewer:window.SymVizFerroTransition.mount(container,{species:container.dataset.transitionSpecies})}]));
  let transitionSpecies='222F1';
  function syncTransitionVisibility(){transitions.forEach(({container,viewer},species)=>{container.hidden=species!==transitionSpecies;viewer.setVisible(parentVisible&&pageView==='transition'&&species===transitionSpecies);});}
  function selectTransitionSpecies(species){if(!transitions.has(species))return;transitionSpecies=species;transitionSelect.value=species;syncTransitionVisibility();reportHeight();notify('symviz:symmetry-demo/scroll-top');}
  transitionSelect.addEventListener('change',()=>selectTransitionSpecies(transitionSelect.value));
  function setPageView(value){if(!['spacegroup','transition'].includes(value))return;const changed=pageView!==value;pageView=value;root.querySelector('#pg-space-view').hidden=value!=='spacegroup';root.querySelector('#pg-transition-view').hidden=value!=='transition';root.querySelectorAll('[data-suite-view]').forEach(button=>{const selected=button.dataset.suiteView===value;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});stop();syncTransitionVisibility();if(value==='spacegroup')draw();reportHeight();if(changed)notify('symviz:symmetry-demo/scroll-top');}
  root.querySelectorAll('[data-suite-view]').forEach(button=>{button.addEventListener('click',()=>setPageView(button.dataset.suiteView));button.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const value=e.key==='Home'?'spacegroup':e.key==='End'?'transition':pageView==='spacegroup'?'transition':'spacegroup';setPageView(value);root.querySelector(`[data-suite-view="${value}"]`).focus();});});
  buildFamilyOptions();buildGroupOptions();buildOperations();new ResizeObserver(draw).observe(svg);new ResizeObserver(reportHeight).observe(root);setPageView('spacegroup');draw();reportHeight();
  notify('symviz:symmetry-demo/ready',{numbers:groups.map(g=>g.id)});
})().catch(error=>{const root=document.getElementById('polar-space-group-gallery');root.textContent=error instanceof Error?error.message:'演示加载失败';window.parent.postMessage({type:'symviz:symmetry-demo/error',message:root.textContent},window.location.origin);});
