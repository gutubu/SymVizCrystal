(function (global) {
  'use strict';
  const TWO_FOLD_OPS = [
    { id: 'E', label: 'E · 恒等', xyz: 'x,y,z', sign: [1, 1, 1] },
    { id: 'C2a', label: 'C₂a · 绕 a 转 180°', xyz: 'x,-y,-z', sign: [1, -1, -1] },
    { id: 'C2b', label: 'C₂b · 绕 b 转 180°', xyz: '-x,y,-z', sign: [-1, 1, -1] },
    { id: 'C2c', label: 'C₂c · 绕 c 转 180°', xyz: '-x,-y,z', sign: [-1, -1, 1] },
  ];
  const MIRROR_OPS = [
    { id: 'E', label: 'E · 恒等', xyz: 'x,y,z', sign: [1, 1, 1] },
    { id: 'm', label: 'm · 关于 ac 镜面反射', xyz: 'x,-y,z', sign: [1, -1, 1] },
  ];
  const P0 = [.35, .55, .75], U = [.22, .31, .43], R0 = [.173, .237, .291], C = [.5, .5, .5];
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const scale = (a, s) => a.map(v => v * s);
  const apply = (sign, p) => sign.map((s, i) => s * p[i]);
  const norm = p => Math.hypot(...p);
  const mod = v => ((v % 1) + 1) % 1;
  const close = (a, b, tol = 1e-9) => norm(sub(a, b)) < tol;
  const periodicClose = (a, b) => a.every((v, i) => Math.abs(mod(v - b[i] + .5) - .5) < 1e-9);
  function createModel(operations, parentPolarization, increment) {
    function domainIncrement(domain) { return apply(operations[domain].sign, increment); }
    function domainVector(domain) { return add(parentPolarization, domainIncrement(domain)); }
    function configuration(q, domain = 0) {
      const delta = scale(domainIncrement(domain), q);
      return operations.map((operation, i) => ({
        id: i, position: add(C, apply(operation.sign, R0)),
        dipole: add(apply(operation.sign, U), delta),
      }));
    }
    function polarization(q, domain = 0) { return add(parentPolarization, scale(domainIncrement(domain), q)); }
    function residual(q, domain, operationIndex) {
      const sites = configuration(q, domain), sign = operations[operationIndex].sign;
      let error = 0;
      for (const site of sites) {
        const mappedPosition = apply(sign, site.position).map(mod);
        const target = sites.find(candidate => periodicClose(candidate.position, mappedPosition));
        if (!target) return Infinity;
        error = Math.max(error, norm(sub(apply(sign, site.dipole), target.dipole)));
      }
      return error;
    }
    function stabilizer(q, domain = 0) {
      // All parent operations preserve the baseline. For q>0, q(RδP-δP)=0
      // iff RδP=δP. Test the increment to avoid a fictitious q threshold.
      const delta = domainIncrement(domain);
      return operations.filter(operation => q === 0 || close(apply(operation.sign, delta), delta));
    }
    function affineStabilizer(q, domain = 0) {
      // Independent finite search includes displaced planes/axes and all
      // candidate translations. Distinct orthorhombic lengths admit eight signs.
      const sites = configuration(q, domain), found = [], seen = new Set();
      for (let mask = 0; mask < 8; mask++) {
        const sign = [0, 1, 2].map(i => mask & (1 << i) ? -1 : 1);
        for (const image of sites) {
          const t = sub(image.position, apply(sign, sites[0].position)).map(mod);
          const valid = sites.every(site => {
            const position = add(apply(sign, site.position), t).map(mod);
            const target = sites.find(candidate => periodicClose(candidate.position, position));
            return target && close(apply(sign, site.dipole), target.dipole, 1e-10);
          });
          const key = sign.join(',') + ';' + t.map(v => Math.round(mod(v) * 1e9)).join(',');
          if (valid && !seen.has(key)) { seen.add(key); found.push({ sign, t }); }
        }
      }
      return found;
    }
    return { operations, parentOrder: operations.length, childOrder: 1, parentPolarization,
      domainCount: operations.length, domainIncrement, domainVector, configuration, polarization, residual, stabilizer, affineStabilizer };
  }
  const model = createModel(TWO_FOLD_OPS, [0, 0, 0], P0);
  const models = { '222F1': model, mF1: createModel(MIRROR_OPS, [U[0], 0, U[2]], [0, .55, 0]) };
  const NS = 'http://www.w3.org/2000/svg';
  let instanceCount = 0;
  function mount(container, options = {}) {
    if (!container || !container.ownerDocument) throw new TypeError('A DOM container is required.');
    const species = options.species || '222F1';
    if (!Object.hasOwn(models, species)) throw new RangeError('Unknown transition species.');
    const selectedModel = models[species], mirror = species === 'mF1';
    const { operations: OPS, domainVector, domainIncrement, configuration, polarization, residual, stabilizer } = selectedModel;
    const parentSymbol = mirror ? 'm' : '222', stateNotation = mirror ? '2/2' : '4/2';
    const lostElement = mirror ? '镜面' : '轴';
    const doc = container.ownerDocument, instance = ++instanceCount;
    const root = doc.createElement('section'); root.className = 'ferro-transition'; root.dataset.ftSpecies = species;
    root.setAttribute('aria-label', species + ' 铁电相变演示');
    root.innerHTML = `
      <header class="ft-heading"><div><h2>铁电相变：${parentSymbol} F 1（${stateNotation}）</h2><p>点群 ${parentSymbol} → 1 · 空间群教学例 ${mirror ? 'Pm（No.6，unique b）' : 'P222（No.16）'} → P1（No.1）</p></div><span class="ft-phase-badge" data-ft-phase-label></span></header>
      ${mirror ? '<p class="ft-polar-caveat"><b>m 本身已是极性点群。</b>镜面内的 P_a、P_c 可以非零；相变的关键是出现原先被镜面对称禁止的法向分量 P_b，而不是把高对称相设成无极化。</p>' : ''}
      <div class="ft-controls" role="group" aria-label="相变动画控制">
        <button type="button" class="btn btn-primary" data-ft-cool>冷却：${parentSymbol} → 1</button><button type="button" class="btn" data-ft-heat>加热：1 → ${parentSymbol}</button><button type="button" class="btn" data-ft-pause disabled>暂停</button>
        <label class="form-label ft-slider-label"><span>${mirror ? '镜面破缺序参量' : '极性序参量'} q <output data-ft-q-label></output></span><input type="range" class="form-range" min="0" max="1" step="0.002" value="0" aria-label="铁电相变进度" data-ft-phase></label>
        <label class="form-check"><input type="checkbox" class="form-check-input" data-ft-ghost checked><span>显示失去的${lostElement}的参考残影</span></label>
      </div>
      <p class="ft-live-summary" data-ft-summary aria-live="polite"></p>
      <div class="ft-main-grid">
        <div class="ft-model"><svg class="ft-cell-svg" viewBox="0 0 650 390" role="img" aria-label="电子云式局域偶极与对称元素变化" data-ft-cell></svg><div class="ft-model-legend"><span><i class="ft-cloud-key"></i>渐变云：蓝 δ− → 红 δ＋</span><span><i class="ft-atom-key"></i>示意原子中心</span><span><i class="ft-polar"></i>平均极化 P</span>${mirror ? '<span><i class="ft-normal"></i>新出现的法向分量 ΔP_b</span><span><i class="ft-plane-key"></i>ac 镜面 / 虚线参考残影</span>' : '<span><i class="ft-lost-line"></i>已失去的轴，仅作参考</span>'}<span><i class="ft-image-key"></i>橙色虚线：操作检验像</span></div><p class="ft-small">拖动晶胞改变视角。${OPS.length} 个连通花生状云包围示意原子，随局域偶极的方向与大小变化；蓝色为相对电子富集侧，红色为相对缺电子侧。云形为电荷分布示意。${mirror ? '镜面为 y = 1/2 的代表面，法向沿 b；Pm 的镜面族为 y = n/2。' : '仅画出每族一条代表轴。'}</p></div>
        <aside class="ft-element-panel" aria-label="相变前后对称元素变化"><h3>少了哪些对称元素？</h3><div class="ft-op-summary"><span>相变后保留：<b>E</b> 与全部整数晶格平移</span><span>相变后失去：<b>${mirror ? 'm · ac 镜面' : 'C₂a、C₂b、C₂c'}</b></span></div><p class="ft-small">${mirror ? '失去镜映操作 m：(x,y,z) → (x,−y,z)，即一族平行 ac 面的镜面；并非空间群只有一个镜面。两相均无反演中心。' : '点群的 3 个二重旋转操作消失，即沿 a、b、c 的 3 族二重轴消失；并非整个空间群只有 3 根轴。两相均无镜面、无反演中心。'}</p><table class="table table-sm ft-check-table"><thead><tr><th>操作与分数坐标</th><th>当前构型</th></tr></thead><tbody data-ft-operations></tbody></table><p class="ft-small" data-ft-test-status></p><p class="ft-small ft-ghost-note">可点击表中操作检验：橙色虚线轮廓为执行该操作后的云形检验像；对照轮廓及 δ−/δ＋ 方位；不能与原云重合时，该操作已失去。</p><div class="ft-polar-readout" data-ft-polarization></div>${mirror ? '<p class="ft-component-readout" data-ft-components></p>' : ''}</aside>
      </div>
      <div class="ft-phase-comparison" aria-label="相变前后点群投影对照">
        <section class="ft-parent-card"><h3>相变前 · ${mirror ? '高对称极性相' : '顺电相'}示意</h3><div class="ft-pointgroup">${mirror ? 'm（Cₛ）' : '222（D₂）'}</div><svg viewBox="0 0 290 235" role="img" aria-label="${parentSymbol} 点群立体投影" data-ft-parent></svg><div class="ft-operation-chips">${mirror ? 'E　m' : 'E　C₂a　C₂b　C₂c'}</div><p>${mirror ? 'P = (p, 0, r)；2 个参考极点' : 'P = 0；4 个参考极点'}</p></section>
        <div class="ft-transition-arrows"><span>冷却 · 对称性降低</span><b>${parentSymbol} → 1</b><span>加热 · 对称性恢复</span><small>保持晶格平移<br>丢失 ${OPS.length - 1} 个非恒等点群操作</small></div>
        <section class="ft-child-card"><h3>相变后 · ${mirror ? '低对称极性相' : '铁电相'}示意</h3><div class="ft-pointgroup">1（C₁）</div><svg viewBox="0 0 290 235" role="img" aria-label="1 点群立体投影" data-ft-child></svg><div class="ft-operation-chips">E</div><p>${mirror ? 'P = (p, ±s, r)，s ≠ 0' : '选定取向的 P ≠ 0'}；1 个参考极点</p></section>
      </div>
      <div class="ft-symbol-legend" aria-label="相变投影符号说明"><span><b>●</b> 上半球参考极点</span><span><b>○</b> 下半球参考极点</span>${mirror ? '<span><b class="ft-mirror-symbol">—</b> 紫色实线直径：ac 镜面投影</span>' : '<span><b class="ft-axis-symbol">2</b> 二重轴投影</span>'}<span><b>外圆</b> 投影赤道，非镜面</span>${mirror ? '<span>实线镜面仅出现在母相 m 的投影中</span><span>参考极点表示通用方向的等价轨道，不是实际极化箭头</span>' : '<span>a、b 的边界两端分别是同一条轴</span><span>参考极点用于表示点群操作，不是非极性相的实际极化</span>'}</div>
      <section class="ft-domains-section"><h3>${OPS.length} 个等价极化取向</h3><div class="ft-domain-buttons" role="group" aria-label="选择铁电畴取向" data-ft-domains></div><p class="ft-domain-note">${mirror ? '镜映使法向分量反号：D1 = (p, +s, r)，D2 = (p, −s, r)。本例 P_a、P_c 已非零；两种取向不是一对 ±P 的 180° 畴，而是相对于 ac 面互为镜像的取向。' : '本例三个极化分量均不为零。222 只改变偶数个分量的符号，4 个取向中不包含任一取向的 −P，不能画成两对 ±P 的 180° 畴。'}</p><p class="ft-small">${mirror ? 'F 是 Aizu 相变记号，不是面心晶格，也不要求高对称 m 相无极化。“2/2”沿用所给表格：左侧 2 表示 2 个等价极化取向；“/2”是该表对可重取向类型的记号，不是 2÷2。' : 'F 表示顺电到铁电的相变关系，不是面心晶格。“4/2”沿用所给表格：左侧 4 表示 4 个等价极化取向；“/2”是该表对可重取向类型的记号，不是 2 个畴，也不是 4÷2。'}</p></section>
      <details class="ft-method"><summary>模型、设定与来源</summary><p>这是 ${parentSymbol} → 1 的对称性教学模型，不代表特定材料的实测相变。Aizu 记号指定点群的群—子群关系，不唯一确定空间群对；本例选用 ${mirror ? 'Pm → P1' : 'P222 → P1'}，保留同一平移晶格及正交示意度量。</p><p>${mirror ? '2 个局域偶极的中心构成 m 等价轨道；dᵢ(q) = Rᵢu + q(0, ±0.55, 0)，u = (0.22, 0.31, 0.43)。平均极化 P(q) = ½Σdᵢ = (0.22, ±0.55q, 0.43)。镜面内的基线极化始终保留，随 q 出现法向分量。' : '4 个局域偶极的中心构成 222 等价轨道；dᵢ(q) = Rᵢu + qPₖ。归一化平均极化 P(q) = ¼Σdᵢ = qPₖ。'}等效电荷分离用 cᵢ ± αdᵢ 表示；图中以包围示意原子的连通渐变云呈现，云形并非计算电子密度。q = 0 时严格满足 ${parentSymbol}，任意 q &gt; 0 时只保留 E。</p>${mirror ? '<p>极性点群允许宏观极化，但仅凭对称性不能证明可由电场切换的铁电性；这里展示 mF1 的对称破缺与取向关系。</p>' : ''}<p>冷却和加热是示意播放方向；q 不是实测温度，连续中间帧不是相变动力学，也不代表必须连续的相变路径。</p><p>来源：<a href="https://pubs.rsc.org/en/content/getauthorversionpdf/C5CS00308C" target="_blank" rel="noopener">Shi 等，Chem. Soc. Rev. 2016，Table 2</a>；<a href="https://species.fzu.cz/ordinary.php?item=domains" target="_blank" rel="noopener">FZU Aizu species ${mirror ? '003：m → 1，2 个畴态' : '009：222 → 1，4 个畴态'}</a>；<a href="https://www.iucr.org/__data/assets/pdf_file/0006/13929/final_23.pdf" target="_blank" rel="noopener">IUCr 立体投影符号</a>。</p></details>
    `;
    container.replaceChildren(root);
    const get = selector => root.querySelector(selector);
    const cell = get('[data-ft-cell]'), parentSvg = get('[data-ft-parent]'), childSvg = get('[data-ft-child]');
    const slider = get('[data-ft-phase]'), ghostInput = get('[data-ft-ghost]'), pauseButton = get('[data-ft-pause]');
    const reduced = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let q = 0, domain = 0, checkedOperation = 1, visible = true, raf = 0, yaw = .65, pitch = .34, drag = null, destroyed = false;
    const number = value => value === 0 ? '0' : Math.abs(value) < .001 ? value.toExponential(1) : value.toFixed(3);
    const vector = values => '(' + values.map(number).join(', ') + ')';
    function node(tag, attrs = {}, text) { const result = doc.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value)); if (text != null) result.textContent = text; return result; }
    function stop() { if (raf) global.cancelAnimationFrame(raf); raf = 0; pauseButton.disabled = true; }
    function stereo(svg, isParent) {
      svg.replaceChildren(); const cx = 145, cy = 112, radius = 80, color = isParent ? '#a442a9' : '#276fae';
      svg.append(node('circle', { cx, cy, r: radius, fill: isParent ? '#f7eaf7' : '#edf5fc', stroke: color, 'stroke-width': 1.4 }));
      const reference = mirror ? domainVector(0) : P0;
      const references = isParent ? OPS.map(op => apply(op.sign, reference)) : [domainVector(domain)];
      for (let i = 0; i < references.length; i++) {
        const v = scale(references[i], 1 / norm(references[i])), denominator = 1 + Math.abs(v[2]);
        const x = cx + radius * v[0] / denominator, y = cy - radius * v[1] / denominator;
        const pole = node('circle', { cx: x, cy: y, r: 4.5, fill: v[2] >= 0 ? color : '#fff', stroke: color, 'stroke-width': 1.8, 'data-ft-pole': i, 'data-hemisphere': v[2] >= 0 ? 'upper' : 'lower' });
        pole.append(node('title', {}, (v[2] >= 0 ? '上半球 ●' : '下半球 ○') + ' 参考方向 ' + vector(references[i]))); svg.append(pole);
      }
      if (isParent && mirror) {
        svg.append(node('line', { x1:cx-radius, y1:cy, x2:cx+radius, y2:cy, stroke:color, 'stroke-width':3, 'data-ft-mirror-symbol':'m' }));
        svg.append(node('text', { x:cx+radius+8, y:cy+4, fill:color, 'font-size':12 }, 'm'));
      } else if (isParent) {
        for (const [x, y, angle, label, dx, dy] of [[cx-radius,cy,0,'C₂a',-30,4],[cx+radius,cy,0,'C₂a',8,4],[cx,cy-radius,90,'C₂b',10,-4],[cx,cy+radius,90,'C₂b',10,5],[cx,cy,0,'C₂c',10,5]]) {
          svg.append(node('ellipse', { cx:x, cy:y, rx:7.2, ry:3.3, fill:color, transform:`rotate(${angle} ${x} ${y})`, 'data-ft-axis-symbol':label }));
          svg.append(node('text', { x:x+dx, y:y+dy, fill:color, 'font-size':11 }, label));
        }
      }
      svg.append(node('text', { x: cx, y: 221, 'text-anchor': 'middle', fill: '#627184', 'font-size': 11 }, '沿 +c 观察 · a 向右 · b 向上'));
    }
    function renderCell() {
      cell.replaceChildren();
      const defs = node('defs');
      for (const [name, color] of [['p','#2678b9'],['normal','#168775']]) {
        const marker = node('marker', { id:`ft-${instance}-${name}`, viewBox:'0 0 10 10', refX:8, refY:5, markerWidth:4, markerHeight:4, orient:'auto-start-reverse' }); marker.append(node('path', { d:'M0 0 L10 5 L0 10 z', fill:color })); defs.append(marker);
      }
      const sheen=node('radialGradient',{id:`ft-${instance}-cloud-sheen`,cx:'.35',cy:'.22',r:'.8'});
      sheen.append(node('stop',{offset:'0%','stop-color':'#fff','stop-opacity':'.8'}),node('stop',{offset:'48%','stop-color':'#fff','stop-opacity':'.06'}),node('stop',{offset:'100%','stop-color':'#324876','stop-opacity':'.16'}));defs.append(sheen);
      const atom=node('radialGradient',{id:`ft-${instance}-atom`,cx:'.3',cy:'.25',r:'.8'});
      atom.append(node('stop',{offset:'0%','stop-color':'#eaf0f7'}),node('stop',{offset:'40%','stop-color':'#8295ad'}),node('stop',{offset:'100%','stop-color':'#344a65'}));defs.append(atom);
      const soft=node('filter',{id:`ft-${instance}-cloud-soft`,x:'-20%',y:'-40%',width:'140%',height:'180%'});soft.append(node('feGaussianBlur',{stdDeviation:'.7'}));defs.append(soft);
      cell.append(defs);
      function project(p) {
        const a = [1.15,1.35,1.65], v = p.map((n,i)=>(n-.5)*a[i]);
        const x = v[0]*Math.cos(yaw)+v[1]*Math.sin(yaw), depth = -v[0]*Math.sin(yaw)+v[1]*Math.cos(yaw);
        return [315+175*x, 199-175*(v[2]*Math.cos(pitch)-depth*Math.sin(pitch)), depth*Math.cos(pitch)+v[2]*Math.sin(pitch)];
      }
      function line(a,b,attrs={}) { const p=project(a),r=project(b);return node('line',{x1:p[0],y1:p[1],x2:r[0],y2:r[1],...attrs}); }
      function label(p,text,color='#475569',dx=8,dy=-8) { const a=project(p); cell.append(node('text',{x:a[0]+dx,y:a[1]+dy,fill:color,'font-size':12,'paint-order':'stroke',stroke:'#fff','stroke-width':3,'stroke-linejoin':'round'},text)); }
      function cloudGlyph(site, operationId) {
        const center=project(site.position), negative=project(sub(site.position,scale(site.dipole,.13))), positive=project(add(site.position,scale(site.dipole,.13)));
        const dx=(positive[0]-negative[0])/2,dy=(positive[1]-negative[1])/2,half=Math.hypot(dx,dy);
        const magnitude=Math.hypot(...site.dipole.map((v,i)=>v*[1.15,1.35,1.65][i]));
        const side=Math.min(1,half/Math.max(1e-9,175*.13*magnitude)),radius=13+Math.min(3,magnitude*1.4),length=half+radius*.8;
        // A smooth, closed surface silhouette: two lobes remain connected at
        // the atom. Looking along the dipole foreshortens it to a round cloud.
        const points=Array.from({length:40},(_,i)=>{const a=i*Math.PI/20,s=Math.cos(a);return [length*s,radius*Math.sin(a)*(1-.58*side+1.45*side*s*s)];});
        let path=`M${points[0].join(',')}`;
        for(let i=0;i<points.length;i++) {const p0=points[(i+39)%40],p1=points[i],p2=points[(i+1)%40],p3=points[(i+2)%40];path+=` C${p1[0]+(p2[0]-p0[0])/6},${p1[1]+(p2[1]-p0[1])/6} ${p2[0]-(p3[0]-p1[0])/6},${p2[1]-(p3[1]-p1[1])/6} ${p2.join(',')}`;}
        path+=' Z';
        const group=node('g',{transform:`translate(${center[0]} ${center[1]}) rotate(${half>1e-8?Math.atan2(dy,dx)*180/Math.PI:0})`});
        if(operationId) {
          group.setAttribute('data-ft-operation-image',operationId);
          group.append(node('path',{d:path,fill:'none',stroke:'#dd9330','stroke-width':1.5,'stroke-dasharray':'4 3',opacity:'.8','data-ft-cloud-image':''}));
          for(const [sign,x] of [['δ−',-.65*length],['δ＋',.65*length]]) group.append(node('text',{x,y:2.5,'text-anchor':'middle','font-size':7,fill:'#ad6d14','paint-order':'stroke',stroke:'#fff','stroke-width':2.2,transform:`rotate(${half>1e-8?-Math.atan2(dy,dx)*180/Math.PI:0} ${x} 0)`},sign));
          return {z:center[2]+.02,node:group};
        }
        const gradientId=`ft-${instance}-cloud-${site.id}`,gradient=node('linearGradient',{id:gradientId,gradientUnits:'userSpaceOnUse',x1:-length,y1:0,x2:length,y2:0});
        const colors=['#267bd4','#86baf0','#e8e8f4','#f4a3b5','#e44f76'],front=positive[2]>=negative[2]?colors[4]:colors[0],visibility=Math.min(1,side/.35);
        function mix(a,b,t){const channel=(color,i)=>parseInt(color.slice(1+i*2,3+i*2),16);return '#'+[0,1,2].map(i=>Math.round(channel(a,i)*(1-t)+channel(b,i)*t).toString(16).padStart(2,'0')).join('');}
        colors.forEach((color,i)=>gradient.append(node('stop',{offset:`${i*25}%`,'stop-color':mix(front,color,visibility)})));defs.append(gradient);
        group.setAttribute('data-ft-dipole-cloud',String(site.id));group.setAttribute('data-ft-cloud-vector',site.dipole.join(','));
        group.append(node('title',{},`局域偶极 ${site.id+1}：蓝 δ− 为相对电子富集侧，红 δ＋ 为相对缺电子侧；中心为示意原子。云形是电荷分布示意。`));
        group.append(node('path',{d:path,fill:`url(#${gradientId})`,opacity:'.3',filter:`url(#ft-${instance}-cloud-soft)`}));
        group.append(node('path',{d:path,fill:`url(#${gradientId})`,'fill-opacity':'.88',stroke:'#6b83ac','stroke-opacity':'.12','stroke-width':'.6','data-ft-cloud-envelope':''}));
        group.append(node('path',{d:path,fill:`url(#ft-${instance}-cloud-sheen)`,'pointer-events':'none'}));
        group.append(node('circle',{cx:0,cy:0,r:4.6,fill:`url(#ft-${instance}-atom)`,stroke:'#fff','stroke-width':'.7','data-ft-cloud-atom':''}));
        // Counter-rotate the site number so the atom remains readable while
        // its surrounding charge distribution follows the 3D dipole.
        group.append(node('text',{x:0,y:2.1,'text-anchor':'middle',fill:'#fff','font-size':6.2,transform:`rotate(${half>1e-8?-Math.atan2(dy,dx)*180/Math.PI:0})`},String(site.id+1)));
        return {z:center[2],node:group};
      }
      const corners = Array.from({length:8},(_,i)=>[i&1?1:0,i&2?1:0,i&4?1:0]);
      for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if([1,2,4].includes(i^j))cell.append(line(corners[i],corners[j],{stroke:'#aab4c1','stroke-width':1,opacity:.7}));
      if(mirror && (q===0 || ghostInput.checked)) {
        const lost=q>0, plane=[[0,.5,0],[1,.5,0],[1,.5,1],[0,.5,1]];
        cell.append(node('polygon', { points:plane.map(point=>project(point).slice(0,2).join(',')).join(' '),
          fill:lost?'#d6757b':'#ac5aae', 'fill-opacity':lost?.035:.13,
          stroke:lost?'#bf646b':'#a442a9', 'stroke-width':2,
          'stroke-dasharray':lost?'6 5':'', 'stroke-opacity':lost?.48:.9,
          'data-ft-plane':'m', 'data-state':lost?'lost':'retained',
        }));
        label([1,.5,1],lost?'m（已失去，仅作参考）':'m · ac 镜面',lost?'#b15359':'#964399',8,-6);
      }
      for(let axis=0;!mirror&&axis<3;axis++) {
        if(q>0&&!ghostInput.checked)continue;
        const a=[.5,.5,.5],b=[.5,.5,.5];a[axis]=-.08;b[axis]=1.08;
        const lost=q>0;cell.append(line(a,b,{stroke:lost?'#cd5c62':'#a442a9','stroke-width':2,'stroke-dasharray':lost?'5 5':'','opacity':lost?.22+.4*(1-q):.9,'data-ft-axis':OPS[axis+1].id,'data-state':lost?'lost':'retained'}));
        label(b,`C₂${'abc'[axis]}${lost?'（已失去）':''}`,lost?'#b15359':'#964399',8,-6);
      }
      const sites = configuration(q,domain), items=[];
      sites.forEach(site=>items.push(cloudGlyph(site)));
      if(checkedOperation!==0 && q>0) {
        const operation=OPS[checkedOperation];
        for(const site of sites) {
          const position=apply(operation.sign,site.position).map(mod), dipole=apply(operation.sign,site.dipole);
          items.push(cloudGlyph({...site,position,dipole},operation.id));
        }
      }
      items.sort((a,b)=>a.z-b.z).forEach(item=>cell.append(item.node));
      const p=polarization(q,domain);
      if(q>0 || mirror) {
        const end=add(C,scale(p,.48));
        cell.append(line(C,end,{stroke:'#2678b9','stroke-width':4.5,'marker-end':`url(#ft-${instance}-p)`,'data-ft-p-vector':p.join(',')}));label(end,'P','#17659e',9,-10);
        if(mirror && q>0) {
          const baseline=add(C,scale(selectedModel.parentPolarization,.48));
          cell.append(line(C,baseline,{stroke:'#788fa4','stroke-width':1.5,'stroke-dasharray':'3 3','data-ft-inplane-vector':selectedModel.parentPolarization.join(',')}));
          cell.append(line(baseline,end,{stroke:'#168775','stroke-width':3.2,'marker-end':`url(#ft-${instance}-normal)`,'data-ft-normal-vector':scale(domainIncrement(domain),q).join(',')}));
          label(scale(add(baseline,end),.5),'ΔP_b','#167f70',12,18);
        }
      }
      else label(C,'P = 0','#a442a9',10,-18);
      for(let i=0;i<3;i++) { const end=[0,0,0];end[i]=.2;cell.append(line([0,0,0],end,{stroke:'#465b71','stroke-width':1.2})); label(end,'abc'[i],'#465b71',i===2?-10:5,5); }
      const elementState=mirror ? (q===0?'E及ac镜面m':'E，一族ac镜面已失去') : (q===0?'E及沿a、b、c的二重旋转':'E，3族二重轴已失去');
      cell.setAttribute('aria-label',`q=${number(q)}，当前点群${q===0?parentSymbol:'1'}，保留${elementState}。归一化平均极化${vector(p)}。`);
    }
    const operationsBody = get('[data-ft-operations]');
    OPS.forEach((operation,index)=>{
      const row=doc.createElement('tr'); row.dataset.ftOperation=operation.id;
      const first=doc.createElement('td'),button=doc.createElement('button');button.className='ft-check-operation';button.type='button';button.dataset.ftCheck=String(index);button.textContent=operation.label;
      first.append(button);const formula=doc.createElement('code');formula.textContent='('+operation.xyz+')';first.append(formula);
      const status=doc.createElement('td');status.dataset.ftOperationStatus=operation.id;row.append(first,status);operationsBody.append(row);
      button.addEventListener('click',()=>{checkedOperation=index;draw();});
    });
    const domains=get('[data-ft-domains]');
    OPS.forEach((operation,index)=>{ const button=doc.createElement('button');button.type='button';button.className='ft-domain-button';button.dataset.ftDomain=String(index);button.innerHTML=`<strong>D${index+1}</strong><span>${vector(domainVector(index))}</span>`;button.addEventListener('click',()=>{stop();domain=index;draw();});domains.append(button); });
    function draw() {
      if(destroyed)return;
      root.dataset.ftOrderParameter=String(q);root.dataset.ftActiveDomain=String(domain);root.dataset.ftPointGroup=q===0?parentSymbol:'1';
      slider.value=String(q);get('[data-ft-q-label]').textContent=number(q);slider.setAttribute('aria-valuetext',`q=${number(q)}，当前点群 ${q===0?parentSymbol:'1'}`);
      get('[data-ft-phase-label]').textContent=q===0?(mirror?'高对称极性相 · m':'非极性相 · 222'):(mirror?'低对称极性相 · 1':'极性有序构型 · 1');
      get('[data-ft-phase-label]').classList.toggle('is-ferro',q>0);
      get('[data-ft-summary]').textContent=mirror
        ? (q===0?'q = 0：E 与镜映 m 均成立；P_b = 0，镜面内已有 P_a = 0.220、P_c = 0.430。':'q > 0：新出现的法向 P_b 打破镜映 m；当前只保留 E 与整数晶格平移，镜面内的极化仍保留。虚线面是相变前的参考残影。')
        : (q===0?'q = 0：4 个局域偶极矢量和为零，E、C₂a、C₂b、C₂c 均成立。':'q > 0：通用极性取向打破 3 个 C₂ 操作；当前只保留 E 与整数晶格平移。虚线轴是相变前的参考残影。');
      get('[data-ft-summary]').setAttribute('aria-live',raf?'off':'polite');
      const keep=stabilizer(q,domain);
      OPS.forEach((operation,index)=>{
        const retained=keep.some(item=>item.id===operation.id),row=root.querySelector(`[data-ft-operation="${operation.id}"]`),status=get(`[data-ft-operation-status="${operation.id}"]`);
        row.dataset.retained=String(retained);status.textContent=retained?'✓ 仍成立':'× 已失去';
        root.querySelector(`[data-ft-check="${index}"]`).setAttribute('aria-pressed',String(index===checkedOperation));
      });
      const error=residual(q,domain,checkedOperation), operationKept=keep.some(operation=>operation.id===OPS[checkedOperation].id);
      get('[data-ft-test-status]').textContent=`当前检验 ${OPS[checkedOperation].id}：${operationKept?'变换前后完全重合。':'局域偶极不重合，归一化最大差 '+number(error)+'。'}`;
      const p=polarization(q,domain);get('[data-ft-polarization]').textContent=mirror
        ? `P(q) = P∥ + q × ΔP(D${domain+1}) = ${vector(p)}` : `P(q) = q × P(D${domain+1}) = ${vector(p)}`;
      if(mirror)get('[data-ft-components]').textContent=`P_a = ${number(p[0])}，P_b：0 → ${number(p[1])}，P_c = ${number(p[2])}；绿色箭头为新增法向分量，灰色虚线为已有面内极化。`;
      root.querySelectorAll('[data-ft-domain]').forEach(button=>{if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(Number(button.dataset.ftDomain)===domain));});
      stereo(parentSvg,true);stereo(childSvg,false);renderCell();
    }
    function animate(to) {
      stop(); if(!visible)return;
      if(reduced.matches){q=to;draw();return;}
      q=to===1?0:1; const from=q,start=global.performance.now();pauseButton.disabled=false;
      function tick(now){const t=Math.min(1,(now-start)/3600);q=from+(to-from)*(t*t*(3-2*t));if(t<1){raf=global.requestAnimationFrame(tick);draw();}else{raf=0;q=to;pauseButton.disabled=true;draw();}}
      raf=global.requestAnimationFrame(tick);
    }
    get('[data-ft-cool]').addEventListener('click',()=>animate(1));get('[data-ft-heat]').addEventListener('click',()=>animate(0));pauseButton.addEventListener('click',()=>{stop();draw();});
    slider.addEventListener('input',()=>{stop();q=Number(slider.value);draw();});ghostInput.addEventListener('change',draw);
    cell.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,yaw,pitch};cell.setPointerCapture(event.pointerId);});
    cell.addEventListener('pointermove',event=>{if(!drag)return;yaw=drag.yaw+(event.clientX-drag.x)*.008;pitch=Math.max(-1.1,Math.min(1.1,drag.pitch+(event.clientY-drag.y)*.006));renderCell();});
    function endDrag(){drag=null;}cell.addEventListener('pointerup',endDrag);cell.addEventListener('pointercancel',endDrag);
    function onVisibility(){if(doc.hidden){stop();draw();}}doc.addEventListener('visibilitychange',onVisibility);
    draw();
    return {
      setVisible(value){visible=Boolean(value);if(!visible){stop();draw();}},
      setPhase(value){if(!Number.isFinite(value))throw new TypeError('Phase must be finite.');stop();q=Math.max(0,Math.min(1,value));draw();},
      setDomain(value){if(!Number.isInteger(value)||value<0||value>=OPS.length)throw new RangeError(`Domain must be 0–${OPS.length-1}.`);stop();domain=value;draw();},
      destroy(){stop();destroyed=true;doc.removeEventListener('visibilitychange',onVisibility);root.remove();},
    };
  }
  const api={mount,model,models};
  if(typeof module==='object'&&module.exports)module.exports=api;
  global.SymVizFerroTransition=api;
})(typeof window!=='undefined'?window:globalThis);
