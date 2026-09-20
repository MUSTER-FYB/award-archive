(() => {
  'use strict';
  const host=document.getElementById('mind-map-scroll');
  if(!host)return;
  const $=id=>document.getElementById(id);
  const canvas=$('mm-canvas'),viewport=$('mm-viewport'),stage=host.querySelector('.mm-stage');
  const {Graph,ROOT}=window.AwardMindMapGraph;
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)') || {matches:true};
  const colors=['#b7ee43','#9ad1b2','#8eb4ff','#ffc078','#d5b5f3','#f3afa7','#bac3cb'];
  const cache=new Map(),requests=new Map(),buttons=new Map(),links=new Map(),pointers=new Map();
  let index,graph,initializing,layer,svg,frame,zoom=1,pan={x:0,y:0},dragging,moved=false;
  let hoveredKey,focusedKey,highlightSelection;
  const el=(tag,cls,text)=>{
    const node=document.createElement(tag);if(cls)node.className=cls;
    if(text!==undefined)node.textContent=text;return node;
  };
  const modalOpen=()=>$('modalBackdrop')?.classList.contains('open');
  const status=text=>{$('mm-status').textContent=text;};
  function read(url) {
    if(!cache.has(url))cache.set(url,fetch(url,{cache:'no-cache'}).then(response=>{
      if(!response.ok)throw new Error('Mind map HTTP '+response.status);
      return response.json();
    }).catch(error=>{cache.delete(url);throw error;}));
    return cache.get(url);
  }
  async function init() {
    if(initializing)return initializing;
    initializing=(async()=>{
      try {
        index=await read('./mind-map-data/index.json');graph=new Graph(index);
        layer=el('div','mm-layer');layer.dataset.root=ROOT;canvas.append(layer);
        svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('class','mm-links');svg.setAttribute('viewBox','-600 -400 1200 800');svg.setAttribute('aria-hidden','true');layer.append(svg);
        const pending=host.querySelector('[data-mm-action="pending"]');pending.hidden=!graph.pending;
        if(graph.pending)pending.textContent='待映射案例 · '+graph.pending.count;
        render();
        // Initial camera only. Node clicks never call fit/position.
        fit(graph.bounds([graph.nodes.get(ROOT),...graph.themes.map(n=>graph.nodes.get(n.id))]));
        updateScroll();
      } catch {
        initializing=undefined;status('导图暂时无法加载。');
        const retry=el('button','mm-button','重试');retry.type='button';retry.addEventListener('click',init);$('mm-status').append(retry);
      }
    })();return initializing;
  }
  function position() {
    canvas.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
    $('mm-scale').textContent=Math.round(zoom*100)+'%';
  }
  function fit(bounds=graph?.bounds()) {
    if(!bounds)return;
    zoom=Math.max(.002,Math.min(1.05,(viewport.clientWidth-40)/bounds.width,(viewport.clientHeight-110)/bounds.height));
    pan={x:-bounds.x*zoom,y:-bounds.y*zoom-26};position();
  }
  function changeZoom(factor,point={x:0,y:0}) {
    const next=Math.max(.002,Math.min(4,zoom*factor));
    pan.x=point.x-(point.x-pan.x)*next/zoom;pan.y=point.y-(point.y-pan.y)*next/zoom;
    zoom=next;position();
  }
  function inspector(item) {
    const panel=$('mm-inspector');panel.replaceChildren(el('strong','',item.displayTitle||item.title));
    const insight=item.userScenarioPain?.[0]||{};
    for(const [label,value] of [['用户',insight.user],['场景',insight.scenario],['痛点',insight.painPoint]]) {
      const row=el('p');row.append(el('b','',label),el('span','',value||'暂未记录'));panel.append(row);
    }
    panel.hidden=false;
  }
  function highlightNeighbors() {
    if(!graph)return;
    const active=[hoveredKey,focusedKey,highlightSelection,graph.selected].find(key=>buttons.has(key));
    const node=graph.nodes.get(active);
    const neighbors=new Set(node?[node.key,node.parent]:[]);
    for(const key of buttons.keys())if(graph.nodes.get(key).parent===active)neighbors.add(key);
    for(const [key,button] of buttons) {
      button.classList.toggle('mm-highlight-source',key===active);
      button.classList.toggle('mm-adjacent',key!==active&&neighbors.has(key));
    }
    for(const [key,line] of links)line.classList.toggle('mm-link-highlight',key===active||graph.nodes.get(key).parent===active);
  }
  function createButton(node) {
    const button=el('button','mm-node mm-'+node.kind);button.type='button';
    button.dataset.nodeId=node.id;button.dataset.key=node.key;button.dataset.parentId=node.parent||'';
    button.addEventListener('pointerenter',event=>{
      if(event.pointerType==='touch')return;
      hoveredKey=node.key;highlightNeighbors();
    });
    button.addEventListener('pointerleave',()=>{if(hoveredKey===node.key)hoveredKey=undefined;highlightNeighbors();});
    button.addEventListener('focus',()=>{
      if(button.matches(':focus-visible')){focusedKey=node.key;hoveredKey=undefined;highlightNeighbors();}
    });
    button.addEventListener('blur',()=>{if(focusedKey===node.key)focusedKey=undefined;highlightNeighbors();});
    button.addEventListener('click',()=>{highlightSelection=node.key;focusedKey=undefined;highlightNeighbors();});
    if(node.kind==='case') {
      const media=el('span','mm-case-media');
      if(node.thumbnail) {
        const image=new Image();image.alt='';image.loading='lazy';image.decoding='async';image.src=node.thumbnail;image.draggable=false;
        image.addEventListener('error',()=>{image.remove();media.append(el('span','mm-case-placeholder','图片待补充'));},{once:true});media.append(image);
      }else media.append(el('span','mm-case-placeholder','图片待补充'));
      const caption=el('span','mm-case-caption');caption.append(el('span','mm-node-name',node.displayTitle||node.title));
      if(node.displayTitle!==node.title)caption.append(el('span','mm-case-original',node.title));
      button.append(media,caption);button.title=(node.displayTitle||node.title)+' · '+node.title;
      button.setAttribute('aria-label',(node.displayTitle||node.title)+'，查看案例详情');
      button.addEventListener('mouseenter',()=>inspector(node));button.addEventListener('focus',()=>inspector(node));
      button.addEventListener('mouseleave',()=>{$('mm-inspector').hidden=true;});button.addEventListener('blur',()=>{$('mm-inspector').hidden=true;});
      button.addEventListener('click',()=>{
        $('mm-inspector').hidden=true;
        if(!window.awardArchive?.openCase(node.id))status('作品详情仍在加载，请稍后再次点击。');
      });
    }else {
      button.append(el('span','mm-node-eyebrow'),el('span','mm-node-name',node.label),el('span','mm-node-count'));
      button.addEventListener('click',()=>node.kind==='more'?loadBranch(node.parent,true):toggleNode(node.key));
    }
    return button;
  }
  function updateButton(button,node) {
    const selected=graph.selected===node.key,root=node.kind==='root';
    const word=root||node.kind==='branch';
    const size=root?204:node.kind==='case'?184:selected&&word?168:144;
    button.style.setProperty('--x',node.x+'px');button.style.setProperty('--y',node.y+'px');button.style.setProperty('--size',size+'px');
    button.style.setProperty('--mm-accent',colors[node.theme]||colors[0]);
    button.classList.toggle('mm-center',root||selected&&word);button.classList.toggle('mm-selected',selected&&word);
    button.classList.toggle('mm-empty',node.kind==='branch'&&!node.count);
    if(node.kind==='case')return;
    const parent=graph.nodes.get(node.parent),hint=button.querySelector('.mm-node-count'),eyebrow=button.querySelector('.mm-node-eyebrow');
    if(node.kind==='more') {
      eyebrow.hidden=true;button.disabled=parent.loading;
      button.querySelector('.mm-node-name').textContent=parent.loading?'正在加载…':parent.error?'加载失败，点击重试':'＋ 加载更多案例';
      hint.textContent='已显示 '+parent.children.length+' / '+parent.count+' 件';return;
    }
    eyebrow.hidden=!root&&!selected;eyebrow.textContent=root?'设计起点':'当前选中';
    button.setAttribute('aria-expanded',String(node.expanded));button.setAttribute('aria-controls','mm-canvas');
    button.setAttribute('aria-busy',String(node.loading));
    hint.textContent=node.loading?'正在加载…':node.error?'加载失败 · 收起后重试':node.expanded?(node.loaded&&!node.children.length?'暂无案例 · 点击收起':'点击收起下级'):root?'点击展开六类主题':node.count+' 件作品 · 展开';
    button.setAttribute('aria-label',node.label+'，'+hint.textContent);
  }
  function header(visible) {
    $('mm-title').textContent=index.title;
    $('mm-scene-label').textContent='悬停查看相邻节点 · 多分支原位展开';
    $('mm-meta').textContent=index.stats.works.toLocaleString('zh-CN')+' 件作品 · 已展开 '+visible.filter(n=>n.expanded).length+' 个分支';
    const crumbs=document.createDocumentFragment();
    graph.path().forEach((node,i)=>{
      if(i)crumbs.append(el('span','','/'));
      const b=el('button','',i===0?'设计起点':node.label);b.type='button';
      if(node.key===graph.selected)b.setAttribute('aria-current','location');
      // Breadcrumbs mark context; they never replace the graph or move the camera.
      b.addEventListener('click',()=>{graph.select(node.key);highlightSelection=node.key;render();});crumbs.append(b);
    });
    $('mm-breadcrumb').replaceChildren(crumbs);
    host.querySelector('[data-mm-action="collapse"]').disabled=!graph.nodes.get(graph.selected)?.expanded;
    host.querySelector('[data-mm-action="pending"]').setAttribute('aria-pressed',String(graph.nodes.get(graph.pending?.id)?.expanded||false));
  }
  function render() {
    if(!graph)return;
    const visible=graph.visible(),keys=new Set(visible.map(n=>n.key));header(visible);status('');$('mm-inspector').hidden=true;
    for(const [key,button] of buttons)if(!keys.has(key)) {
      if(hoveredKey===key)hoveredKey=undefined;
      if(focusedKey===key)focusedKey=undefined;
      if(highlightSelection===key)highlightSelection=undefined;
      const focused=document.activeElement===button;button.remove();buttons.delete(key);
      if(focused)buttons.get(graph.selected)?.focus({preventScroll:true});
    }
    for(const [key,line] of links)if(!keys.has(key)){line.remove();links.delete(key);}
    for(const node of visible) {
      let button=buttons.get(node.key);
      if(!button) {
        button=createButton(node);buttons.set(node.key,button);layer.append(button);
        if(!reduced.matches&&button.animate)button.animate([{opacity:0},{opacity:1}],{duration:220,easing:'ease-out'});
      }
      updateButton(button,node);
      if(node.parent) {
        let line=links.get(node.key);
        if(!line){line=document.createElementNS(svg.namespaceURI,'path');line.dataset.childKey=node.key;svg.append(line);links.set(node.key,line);}
        const parent=graph.nodes.get(node.parent),dx=node.x-parent.x,dy=node.y-parent.y;
        line.setAttribute('d',`M ${parent.x} ${parent.y} Q ${parent.x+dx*.25} ${parent.y+dy*.75} ${node.x} ${node.y}`);
        line.style.stroke=colors[node.theme]||colors[0];
      }
    }
    highlightNeighbors();
    // No fit(), scrollTo(), fullscreen request or camera mutation is allowed here.
  }
  async function loadBranch(key,more=false) {
    const node=graph.nodes.get(key);if(!node||requests.has(key))return requests.get(key);
    const url=more?node.next:node.url;if(!url||!more&&node.loaded)return;
    node.loading=true;node.error='';render();
    const task=(async()=>{
      try {graph.apply(key,await read(url));}
      catch {node.error='加载失败';}
      finally {node.loading=false;requests.delete(key);render();}
    })();requests.set(key,task);return task;
  }
  function toggleNode(key) {
    const expanded=graph.toggle(key);render();if(expanded)loadBranch(key);
  }
  function collapseSelected() {
    const node=graph?.nodes.get(graph.selected);if(node?.expanded){node.expanded=false;render();}
  }
  function sceneTop(){return host.getBoundingClientRect().top+scrollY;}
  function updateScroll() {
    frame=undefined;const rect=host.getBoundingClientRect(),visible=rect.top<innerHeight&&rect.bottom>0;
    if(visible&&!graph&&window.awardArchive?.ready)init();
    stage.style.opacity=String(Math.max(0,Math.min(1,1-rect.top/innerHeight)));stage.inert=!visible;
  }
  window.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(updateScroll);},{passive:true});
  window.addEventListener('resize',updateScroll);
  function observeEntry() {
    if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){init();observer.disconnect();}},{rootMargin:'400px'});observer.observe(host);}
    updateScroll();
  }
  if(window.awardArchive?.ready)observeEntry();else window.addEventListener('archive:ready',observeEntry,{once:true});
  host.addEventListener('click',event=>{
    const control=event.target.closest('[data-mm-action]'),action=control?.dataset.mmAction;if(!action)return;
    if(action==='exit')window.scrollTo({top:Math.max(0,sceneTop()-innerHeight*.8),behavior:reduced.matches?'instant':'smooth'});
    else if(action==='in')changeZoom(1.2);
    else if(action==='out')changeZoom(1/1.2);
    else if(action==='fit')fit();
    else if(action==='pan'){const active=viewport.classList.toggle('mm-pan-mode');control.setAttribute('aria-pressed',String(active));control.textContent=active?'纵向浏览':'移动导图';}
    else if(action==='collapse')collapseSelected();
    else if(action==='reset'&&graph){graph.collapseAll();highlightSelection=ROOT;render();}
    else if(action==='pending'&&graph){const node=graph.showPending();highlightSelection=node?.key;render();if(node)loadBranch(node.key);}
  });
  viewport.addEventListener('wheel',event=>{
    if(!event.ctrlKey&&!event.metaKey)return;
    event.preventDefault();const rect=viewport.getBoundingClientRect();
    changeZoom(Math.exp(-event.deltaY*.004),{x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2});
  },{passive:false});
  viewport.addEventListener('pointerdown',event=>{
    if(event.target.closest('.mm-zoom')||event.button>0)return;
    if(event.pointerType==='touch'&&!viewport.classList.contains('mm-pan-mode'))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    dragging={x:event.clientX,y:event.clientY,start:{...pan},distance:pointers.size===2?distance():0,zoom};moved=false;
    viewport.classList.add('mm-dragging');
  });
  function distance(){const [a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;}
  viewport.addEventListener('pointermove',event=>{
    if(!dragging||!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2){if(dragging.distance){changeZoom(dragging.zoom*distance()/dragging.distance/zoom);moved=true;}return;}
    const dx=event.clientX-dragging.x,dy=event.clientY-dragging.y;
    if(Math.hypot(dx,dy)>5){moved=true;viewport.setPointerCapture(event.pointerId);}
    if(moved){pan={x:dragging.start.x+dx,y:dragging.start.y+dy};position();}
  });
  const endPointer=event=>{
    pointers.delete(event.pointerId);
    if(!pointers.size){dragging=undefined;viewport.classList.remove('mm-dragging');}
    else{const p=[...pointers.values()][0];dragging={...p,start:{...pan},distance:0,zoom};}
  };
  viewport.addEventListener('pointerup',endPointer);viewport.addEventListener('pointercancel',endPointer);
  viewport.addEventListener('click',event=>{if(moved){event.preventDefault();event.stopPropagation();moved=false;}},true);
  viewport.addEventListener('keydown',event=>{
    if(modalOpen())return;
    if(event.key==='+'||event.key==='='){event.preventDefault();changeZoom(1.2);}
    else if(event.key==='-'){event.preventDefault();changeZoom(1/1.2);}
    else if(event.key==='0'){event.preventDefault();fit();}
    else if(event.key==='Escape')collapseSelected();
    else if(event.key.startsWith('Arrow')&&event.target===viewport){event.preventDefault();pan.x+=event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0;pan.y+=event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0;position();}
  });
  updateScroll();
})();
