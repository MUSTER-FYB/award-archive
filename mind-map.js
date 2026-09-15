(() => {
  'use strict';
  const host = document.getElementById('mind-map-scroll');
  if (!host) return;
  const $ = id => document.getElementById(id);
  const canvas = $('mm-canvas'), viewport = $('mm-viewport'), stage = host.querySelector('.mm-stage');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)') || {matches:true};
  const nextFrame = window.requestAnimationFrame || (callback => setTimeout(callback,16));
  const cache = new Map(), knownNodes = new Map();
  let index, loading, scene = -1, current, rootView, page = 0, request = 0, frame, snapTimer;
  let zoom = 1, pan = {x:0, y:0}, baseZoom = 1, bounds = {width:1000, height:600};
  let activeLayer, transition, dragging, moved = false, lastPageUrl, pageHistory = [], suppressSnapUntil = 0;
  const pointers = new Map();
  const colors = ['#b7ee43','#b7ee43','#9ad1b2','#8eb4ff','#ffc078','#d5b5f3','#f3afa7','#bac3cb'];
  const el = (tag, cls, text) => {
    const node = document.createElement(tag); if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text; return node;
  };
  const modalOpen = () => $('modalBackdrop')?.classList.contains('open');
  const mobile = () => viewport.clientWidth < 600;
  const pageSize = () => current?.cases ? (mobile() ? 3 : 6) : (mobile() ? 4 : 8);
  const items = () => current?.cases || current?.children || [];
  const status = text => { $('mm-status').textContent = text; };
  function read(url) {
    if (!cache.has(url)) cache.set(url, fetch(url, {cache:'no-cache'}).then(response => {
      if (!response.ok) throw new Error('Mind map HTTP ' + response.status);
      return response.json();
    }).catch(error => { cache.delete(url); throw error; }));
    return cache.get(url);
  }
  function register(node) { if (node?.id && node.url) knownNodes.set(node.id, node); }
  function showError(retry) {
    status('此分支暂时无法加载。');
    const button = el('button', 'mm-button', '重试'); button.type = 'button';
    button.addEventListener('click', retry); $('mm-status').append(button);
  }
  async function init() {
    if (loading) return loading;
    loading = (async () => {
      try {
        index = await read('./mind-map-data/index.json');
        index.roots.forEach(register);
        rootView = {id:'overview',label:index.title,path:[],count:index.stats.works,children:index.roots};
        host.style.height = (index.roots.length + 1) * 100 + 'svh';
        $('mm-scenes').replaceChildren(...[rootView,...index.roots].map((entry,i) => {
          const b = el('button'); b.type='button'; b.title=entry.label; b.setAttribute('aria-label',entry.label);
          b.addEventListener('click',()=>goScene(i)); return b;
        }));
        updateScroll();
      } catch { loading = undefined; showError(init); }
    })();
    return loading;
  }
  function position() {
    canvas.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
    $('mm-scale').textContent = Math.round(zoom / baseZoom * 100) + '%';
  }
  function fit() {
    baseZoom = Math.min(1.05, (viewport.clientWidth - 28) / bounds.width, (viewport.clientHeight - 85) / bounds.height);
    zoom = Math.max(.15,baseZoom); pan = {x:0,y:-16}; position();
  }
  function changeZoom(factor, point = {x:0,y:0}) {
    const next = Math.max(baseZoom * .55, Math.min(baseZoom * 3.2, zoom * factor));
    pan.x = point.x - (point.x - pan.x) * next / zoom;
    pan.y = point.y - (point.y - pan.y) * next / zoom;
    zoom = next; position();
  }
  function inspector(item) {
    const panel = $('mm-inspector'); panel.replaceChildren(el('strong','',item.title));
    const insight = item.userScenarioPain?.[0] || {};
    for (const [label,value] of [['用户',insight.user],['场景',insight.scenario],['痛点',insight.painPoint]]) {
      const row=el('p');row.append(el('b','',label),el('span','',value || '暂未记录'));panel.append(row);
    }
    panel.hidden=false;
  }
  function showDetails(item) {
    $('mm-inspector').hidden=true;
    if (!window.awardArchive?.openCase(item.id)) status('作品详情仍在加载，请稍后再次点击。');
  }
  function nodeButton(item, x, y, size, kind) {
    const node=el('button','mm-node' + (kind==='case' ? ' mm-case' : kind==='center' ? ' mm-center' : !item.count ? ' mm-empty' : ''));
    node.type='button';node.style.setProperty('--x',x+'px');node.style.setProperty('--y',y+'px');node.style.setProperty('--size',size+'px');
    node.dataset.nodeId=item.id;
    if(kind==='case') {
      if(item.thumbnail) {
        const image=new Image();image.alt='';image.loading='lazy';image.decoding='async';image.src=item.thumbnail;image.draggable=false;
        image.addEventListener('error',()=>{image.remove();node.prepend(el('span','mm-case-placeholder','图片待补充'));},{once:true});
        node.append(image);
      } else node.append(el('span','mm-case-placeholder','图片待补充'));
      node.append(el('span','mm-node-name',item.title));
      const tags=el('span','mm-case-tags');for(const name of ['用户','场景','痛点'])tags.append(el('span','',name));node.append(tags);
      node.setAttribute('aria-label',item.title+'，查看案例详情');
      node.addEventListener('mouseenter',()=>inspector(item));node.addEventListener('focus',()=>inspector(item));
      node.addEventListener('mouseleave',()=>{$('mm-inspector').hidden=true;});node.addEventListener('blur',()=>{$('mm-inspector').hidden=true;});
      node.addEventListener('click',()=>showDetails(item));
    } else {
      node.append(el('span','mm-node-name',item.label),el('span','mm-node-count',kind==='center' ? (current.id==='overview'?'六条设计主线':item.count+' 件作品 · 点击收起') : item.count+' 件作品 · 展开'));
      node.setAttribute('aria-expanded',String(kind==='center'));node.setAttribute('aria-controls','mm-canvas');
      node.setAttribute('aria-label',item.label+'，'+item.count+' 件作品，'+(kind==='center'?'收起到上一级':'展开并聚焦'));
      node.addEventListener('click',()=>kind==='center' ? collapse() : open(item,{focus:true}));
    }
    return node;
  }
  function header() {
    $('mm-title').textContent=current.id==='overview' ? index.title : current.label;
    $('mm-scene-label').textContent=scene===0 ? '从作品出发，探索设计的联系' : String(scene).padStart(2,'0')+' / '+index.roots[scene-1].label;
    $('mm-meta').textContent=current.id==='overview' ? index.stats.works.toLocaleString('zh-CN')+' 件作品 · '+index.stats.taxonomyNodes+' 个分类节点' : current.count+' 件关联作品 · '+(current.cases?'点击案例查看详情':'点击气泡，继续深入');
    const crumbs = [{id:'overview',label:'总览'},...(current.path || [])];
    const frag=document.createDocumentFragment();
    for(const [i,entry] of crumbs.entries()) {
      if(i)frag.append(el('span','','/'));
      const b=el('button','',entry.label);b.type='button';
      if(i===crumbs.length-1)b.setAttribute('aria-current','location');
      b.addEventListener('click',()=>entry.id==='overview'?overview(true):open(knownNodes.get(entry.id)||entry,{focus:true}));frag.append(b);
    }
    $('mm-breadcrumb').replaceChildren(frag);
  }
  function render(animate=true, focus=false) {
    if(!current)return;
    header();$('mm-inspector').hidden=true;status('');
    const subset=items().slice(page*pageSize(),(page+1)*pageSize());
    const layer=el('div','mm-layer');layer.dataset.branch=current.id;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','mm-links');svg.setAttribute('viewBox','-600 -400 1200 800');svg.setAttribute('aria-hidden','true');layer.append(svg);
    const caseMode=!!current.cases, small=mobile();
    const size=caseMode?(small?146:178):(small?130:150), centerSize=small?142:178;
    const rx=small?137:350, ry=small?245:207;
    const angles=subset.length===1 ? [-Math.PI/2] : Array.from({length:subset.length},(_,i)=>-Math.PI/2+i*Math.PI*2/subset.length);
    const coordinates=angles.map(a=>({x:Math.cos(a)*rx,y:Math.sin(a)*ry}));
    let maxX=centerSize/2,maxY=centerSize/2;
    for(const [i,item] of subset.entries()) {
      const {x,y}=coordinates[i];maxX=Math.max(maxX,Math.abs(x)+size/2);maxY=Math.max(maxY,Math.abs(y)+size/2);
      const line=document.createElementNS(svg.namespaceURI,'path');line.setAttribute('d',`M 0 0 Q ${x*.25} ${y*.75} ${x} ${y}`);svg.append(line);
      register(item);layer.append(nodeButton(item,x,y,size,caseMode?'case':'branch'));
    }
    layer.append(nodeButton(current,0,0,centerSize,'center'));
    bounds={width:maxX*2+24,height:maxY*2+24};
    const pages=Math.ceil(items().length/pageSize());
    $('mm-pagination').hidden=pages<=1&&!current.next&&!pageHistory.length;
    $('mm-page-label').textContent=`${page+1} / ${Math.max(pages,1)}`+(current.next?' · 更多案例':'');
    host.querySelector('[data-mm-action="previous-page"]').disabled=page===0&&!pageHistory.length;
    host.querySelector('[data-mm-action="next-page"]').disabled=page>=pages-1&&!current.next;
    if(!subset.length)status('这个分类暂时没有已映射的案例。可点击中心气泡返回上一级。');
    transition?.cancel();
    const old=activeLayer;if(old)old.inert=true;activeLayer=layer;canvas.append(layer);fit();
    if(animate&&!reduced.matches&&layer.animate) {
      old?.animate([{opacity:1},{opacity:0}],{duration:180}).finished.then(()=>old.remove()).catch(()=>old.remove());
      transition=layer.animate([{opacity:0,transform:'scale(.94)'},{opacity:1,transform:'scale(1)'}],{duration:340,easing:'ease-out'});
    } else old?.remove();
    for(const stale of canvas.querySelectorAll('.mm-layer'))if(stale!==layer&&stale!==old)stale.remove();
    if(focus) layer.querySelector('.mm-center').focus({preventScroll:true});
  }
  async function open(entry, options={}) {
    if(!entry?.url){if(entry?.id==='overview')overview();return;}
    const token=++request;status('正在展开 '+entry.label+'…');
    try {
      const data=await read(entry.url);if(token!==request)return;
      current=data;lastPageUrl=entry.url;page=0;if(!options.paging)pageHistory=[];
      (data.children||[]).forEach(register);
      for(const ancestor of data.path||[])register(ancestor);
      render(true,options.focus);
    } catch {if(token===request)showError(()=>open(entry,options));}
  }
  function overview(focus=false){++request;current=rootView;page=0;pageHistory=[];render(true,focus);}
  function collapse(){if(!current)return;const path=current.path||[];if(path.length<2)overview(true);else open(knownNodes.get(path[path.length-2].id)||path[path.length-2],{focus:true});}
  function enterScene(next) {
    if(scene===next)return;scene=next;
    host.style.setProperty('--mm-accent',colors[scene]||colors[0]);
    [...$('mm-scenes').children].forEach((b,i)=>{if(i===scene)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    if(scene===0)overview();else open(index.roots[scene-1]);
  }
  const sceneHeight = () => stage.clientHeight;
  function sceneTop(n){return host.getBoundingClientRect().top+scrollY+n*sceneHeight();}
  function goScene(n) {
    if(!index)return;
    n=Math.max(0,Math.min(index.roots.length,n));
    clearTimeout(snapTimer);suppressSnapUntil=performance.now()+1000;window.scrollTo({top:sceneTop(n),behavior:reduced.matches?'instant':'smooth'});
  }
  function updateScroll() {
    frame=undefined;const rect=host.getBoundingClientRect();
    const visible=rect.top<innerHeight&&rect.bottom>0;
    if(visible&&!index&&window.awardArchive?.ready)init();
    stage.style.opacity=String(Math.max(0,Math.min(1,1-rect.top/innerHeight)));
    stage.inert=!visible;
    if(!index||!visible||modalOpen())return;
    const progress=Math.max(0,Math.min(index.roots.length,-rect.top/sceneHeight()));
    enterScene(Math.round(progress));
    clearTimeout(snapTimer);
    const fraction=Math.abs(progress-Math.round(progress));
    if(!dragging&&performance.now()>suppressSnapUntil&&rect.top<0&&fraction>.025) snapTimer=setTimeout(()=>{
      if(!modalOpen()&&!dragging)goScene(Math.round(progress));
    },210);
  }
  window.addEventListener('scroll',()=>{if(!frame)frame=nextFrame(updateScroll);},{passive:true});
  window.addEventListener('resize',()=>{if(current){page=0;render(false);}updateScroll();});
  function observeEntry() {
    if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){init();observer.disconnect();}},{rootMargin:'400px'});observer.observe(host);}
    updateScroll();
  }
  if(window.awardArchive?.ready)observeEntry();else window.addEventListener('archive:ready',observeEntry,{once:true});
  host.addEventListener('click',async event=>{
    const action=event.target.closest('[data-mm-action]')?.dataset.mmAction;if(!action)return;
    if(action==='exit'){clearTimeout(snapTimer);suppressSnapUntil=performance.now()+1600;window.scrollTo({top:Math.max(0,sceneTop(0)-innerHeight*.8),behavior:reduced.matches?'instant':'smooth'});}
    else if(action==='in')changeZoom(1.2);
    else if(action==='out')changeZoom(1/1.2);
    else if(action==='fit')fit();
    else if(action==='pan'){const active=viewport.classList.toggle('mm-pan-mode');event.target.setAttribute('aria-pressed',String(active));event.target.textContent=active?'纵向浏览':'移动导图';}
    else if(action==='next-scene')goScene(scene+1);
    else if(action==='previous-scene')scene>0?goScene(scene-1):host.querySelector('[data-mm-action="exit"]').click();
    else if(action==='next-page'){
      if(page<Math.ceil(items().length/pageSize())-1){page++;render();}
      else if(current.next){pageHistory.push(lastPageUrl);await open({url:current.next,label:current.label},{paging:true});}
    } else if(action==='previous-page'){
      if(page>0){page--;render();}else if(pageHistory.length){const url=pageHistory.pop();await open({url,label:current.label},{paging:true});page=Math.max(0,Math.ceil(items().length/pageSize())-1);render();}
    }
  });
  viewport.addEventListener('wheel',event=>{
    if(!event.ctrlKey&&!event.metaKey)return;
    event.preventDefault();const rect=viewport.getBoundingClientRect();
    changeZoom(Math.exp(-event.deltaY*.004),{x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2});
  },{passive:false});
  viewport.addEventListener('pointerdown',event=>{
    if(event.target.closest('.mm-zoom,.mm-pagination')||event.button>0)return;
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
    else if(event.key==='Escape'){collapse();}
    else if(event.key.startsWith('Arrow')&&event.target===viewport){event.preventDefault();pan.x+=event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0;pan.y+=event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0;position();}
  });
  updateScroll();
})();
