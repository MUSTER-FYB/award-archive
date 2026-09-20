(() => {
  'use strict';
  const host = document.getElementById('mind-map-scroll');
  if (!host) return;
  const $ = id => document.getElementById(id);
  const canvas = $('mm-canvas'), viewport = $('mm-viewport'), stage = host.querySelector('.mm-stage');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)') || {matches:true};
  const nextFrame = window.requestAnimationFrame || (callback => setTimeout(callback,16));
  const cache = new Map(), knownNodes = new Map();
  let index, loading, current, rootView, pendingRoot, expanded = false, page = 0, request = 0, frame, snapTimer;
  let zoom = 1, pan = {x:0, y:0}, baseZoom = 1, bounds = {width:1000, height:600, x:0, y:0};
  let activeLayer, transition, dragging, moved = false, lastPageUrl, pageHistory = [], suppressSnapUntil = 0;
  let lastScroll = window.scrollY, scrollDirection = 0;
  const pointers = new Map();
  const colors = ['#b7ee43','#9ad1b2','#8eb4ff','#ffc078','#d5b5f3','#f3afa7'];
  const el = (tag, cls, text) => {
    const node = document.createElement(tag); if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text; return node;
  };
  const modalOpen = () => $('modalBackdrop')?.classList.contains('open');
  const mobile = () => viewport.clientWidth < 600;
  const pageSize = () => current?.id === 'overview' ? 6 : current?.cases ? (mobile() ? 2 : 4) : (mobile() ? 3 : 6);
  const items = () => current?.cases || current?.children || [];
  const status = text => { $('mm-status').textContent = text; };
  function read(url) {
    if (!cache.has(url)) cache.set(url, fetch(url, {cache:'no-cache'}).then(response => {
      if (!response.ok) throw new Error('Mind map HTTP ' + response.status);
      return response.json();
    }).catch(error => { cache.delete(url); throw error; }));
    return cache.get(url);
  }
  function register(node) { if (node?.id && node.url) knownNodes.set(node.id, {...knownNodes.get(node.id), ...node}); }
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
        pendingRoot = index.roots.find(entry => entry.label === '待映射');
        rootView = {id:'overview',label:index.title,path:[],count:index.stats.works,children:index.roots.filter(entry => entry !== pendingRoot)};
        const pendingButton = host.querySelector('[data-mm-action="pending"]');
        pendingButton.hidden = !pendingRoot;
        if (pendingRoot) pendingButton.textContent = '待映射案例 · ' + pendingRoot.count;
        overview(false, false);
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
    zoom = Math.max(.15,baseZoom); pan = {x:-bounds.x*zoom,y:-bounds.y*zoom-24}; position();
  }
  function changeZoom(factor, point = {x:0,y:0}) {
    const next = Math.max(baseZoom * .55, Math.min(baseZoom * 3.2, zoom * factor));
    pan.x = point.x - (point.x - pan.x) * next / zoom;
    pan.y = point.y - (point.y - pan.y) * next / zoom;
    zoom = next; position();
  }
  function inspector(item) {
    const panel = $('mm-inspector'); panel.replaceChildren(el('strong','',item.displayTitle || item.title));
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
    const isRoot=kind==='root', selected=kind==='selected', emphasized=isRoot||selected;
    const node=el('button','mm-node mm-'+kind + (emphasized ? ' mm-center' : '') + (kind==='branch'&&!item.count ? ' mm-empty' : ''));
    node.type='button';node.style.setProperty('--x',x+'px');node.style.setProperty('--y',y+'px');node.style.setProperty('--size',size+'px');
    node.dataset.nodeId=item.id;
    if(kind==='case') {
      const media=el('span','mm-case-media');
      if(item.thumbnail) {
        const image=new Image();image.alt='';image.loading='lazy';image.decoding='async';image.src=item.thumbnail;image.draggable=false;
        image.addEventListener('error',()=>{image.remove();media.append(el('span','mm-case-placeholder','图片待补充'));},{once:true});
        media.append(image);
      } else media.append(el('span','mm-case-placeholder','图片待补充'));
      const caption=el('span','mm-case-caption');
      caption.append(el('span','mm-node-name',item.displayTitle || item.title));
      if(item.displayTitle!==item.title)caption.append(el('span','mm-case-original',item.title));
      node.append(media,caption);
      node.title=(item.displayTitle || item.title)+' · '+item.title;
      node.setAttribute('aria-label',(item.displayTitle || item.title)+'，'+item.title+'，查看案例详情');
      node.addEventListener('mouseenter',()=>inspector(item));node.addEventListener('focus',()=>inspector(item));
      node.addEventListener('mouseleave',()=>{$('mm-inspector').hidden=true;});node.addEventListener('blur',()=>{$('mm-inspector').hidden=true;});
      node.addEventListener('click',()=>showDetails(item));
    } else {
      const descendants=current.cases?'案例':'关联词';
      const hint=isRoot ? (current.id!=='overview'?'返回六类主题':expanded?'点击收起主题':'点击展开六类主题') : selected ? ('点击'+(expanded?'收起':'展开')+descendants) : kind==='ancestor'?'返回这一级':item.count+' 件作品 · 展开';
      if(emphasized)node.append(el('span','mm-node-eyebrow',isRoot?'设计起点':'当前选中'));
      node.append(el('span','mm-node-name',item.label),el('span','mm-node-count',hint));
      node.setAttribute('aria-expanded',String(isRoot ? current.id!=='overview'||expanded : selected&&expanded));node.setAttribute('aria-controls','mm-canvas');
      node.setAttribute('aria-label',item.label+'，'+hint);
      node.addEventListener('click',()=>{
        if(isRoot){if(current.id==='overview')toggle();else overview(true,true);}
        else if(selected)toggle();
        else open(item,{focus:true});
      });
    }
    return node;
  }
  function header() {
    $('mm-title').textContent=current.id==='overview' ? index.title : current.label;
    $('mm-scene-label').textContent=current.id==='overview' ? '从一个词开始，展开六类设计主题' : (current.path?.[0]?.label || '设计主题')+' / 逐层探索';
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
    host.querySelector('[data-mm-action="parent"]').disabled=current.id==='overview';
    host.querySelector('[data-mm-action="pending"]').setAttribute('aria-pressed',String(current.id===pendingRoot?.id));
  }
  function render(animate=true, focus=false) {
    if(!current)return;
    header();$('mm-inspector').hidden=true;status('');
    const subset=expanded ? items().slice(page*pageSize(),(page+1)*pageSize()) : [];
    const layer=el('div','mm-layer');layer.dataset.branch=current.id;
    layer.dataset.expanded=String(expanded);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','mm-links');svg.setAttribute('viewBox','-600 -400 1200 800');svg.setAttribute('aria-hidden','true');layer.append(svg);
    const caseMode=!!current.cases, small=mobile(), overviewMode=current.id==='overview';
    const size=caseMode?(small?164:184):(small?104:132);
    const rootPosition=overviewMode ? {x:0,y:0} : small ? {x:0,y:-238} : {x:-440,y:0};
    const selectedPosition=small&&!overviewMode ? {x:0,y:-30} : {x:0,y:0};
    const placed=[];
    const addNode=(item,point,diameter,kind)=>{
      const button=nodeButton(item,point.x,point.y,diameter,kind);
      layer.append(button);placed.push({...point,size:diameter});return button;
    };
    const link=(from,to,context=false)=>{
      const line=document.createElementNS(svg.namespaceURI,'path');
      line.setAttribute('d',`M ${from.x} ${from.y} Q ${from.x+(to.x-from.x)*.25} ${from.y+(to.y-from.y)*.75} ${to.x} ${to.y}`);
      if(context)line.setAttribute('class','mm-context-link');svg.append(line);
    };
    if(!overviewMode){
      const ancestors=(current.path||[]).slice(0,-1);
      const parent=ancestors.at(-1);
      if(parent&&!small){
        const parentPosition={x:-225,y:0};
        link(rootPosition,parentPosition,true);link(parentPosition,selectedPosition,true);
        addNode(knownNodes.get(parent.id)||parent,parentPosition,106,'ancestor');
      }else link(rootPosition,selectedPosition,true);
    }
    const coordinates=subset.map((_,i)=>{
      if(overviewMode){
        const angle=-Math.PI/2+i*Math.PI*2/6;
        return {x:Math.cos(angle)*(small?170:310),y:Math.sin(angle)*(small?220:238)};
      }
      if(small){
        if(caseMode)return {x:subset.length===1?0:(i===0?-99:99),y:172};
        const angle=subset.length===1?0:(i/(subset.length-1)-.5)*1.6;
        return {x:Math.sin(angle)*180,y:Math.cos(angle)*235-30};
      }
      const arc=caseMode?2.5:2.97;
      const angle=subset.length===1?0:(i/(subset.length-1)-.5)*arc;
      return {x:Math.cos(angle)*(caseMode?355:345),y:Math.sin(angle)*(caseMode?300:320)};
    });
    for(const [i,item] of subset.entries()) {
      const point=coordinates[i];link(selectedPosition,point);register(item);
      const button=addNode(item,point,size,caseMode?'case':'branch');
      if(animate&&!reduced.matches&&button.animate){
        button.animate([
          {opacity:0,transform:`translate(calc(-50% + ${selectedPosition.x-point.x}px),calc(-50% + ${selectedPosition.y-point.y}px)) scale(.35)`},
          {opacity:1,transform:'translate(-50%,-50%) scale(1)'}
        ],{duration:430,delay:i*26,easing:'cubic-bezier(.2,.7,.2,1)',fill:'backwards'});
      }
    }
    addNode(rootView,rootPosition,small?164:204,'root');
    if(!overviewMode)addNode(current,selectedPosition,small?156:192,'selected');
    const minX=Math.min(...placed.map(p=>p.x-p.size/2)),maxX=Math.max(...placed.map(p=>p.x+p.size/2));
    const minY=Math.min(...placed.map(p=>p.y-p.size/2)),maxY=Math.max(...placed.map(p=>p.y+p.size/2));
    bounds={width:maxX-minX+24,height:maxY-minY+24,x:(minX+maxX)/2,y:(minY+maxY)/2};
    const pages=Math.ceil(items().length/pageSize());
    $('mm-pagination').hidden=!expanded||(pages<=1&&!current.next&&!pageHistory.length);
    const offset=pageHistory.length*12+page*pageSize();
    $('mm-page-label').textContent=caseMode ? `${offset+1}–${offset+subset.length} / ${current.count} 件` : `${page+1} / ${Math.max(pages,1)} 组关联词`;
    host.querySelector('[data-mm-action="previous-page"]').disabled=page===0&&!pageHistory.length;
    host.querySelector('[data-mm-action="next-page"]').disabled=page>=pages-1&&!current.next;
    if(expanded&&!subset.length)status('这个分类暂时没有已映射的案例，可返回上一级继续探索。');
    transition?.cancel();
    const old=activeLayer;if(old)old.inert=true;activeLayer=layer;canvas.append(layer);fit();
    if(animate&&!reduced.matches&&layer.animate) {
      old?.animate([{opacity:1},{opacity:0}],{duration:180}).finished.then(()=>old.remove()).catch(()=>old.remove());
      transition=layer.animate([{opacity:0,transform:'scale(.94)'},{opacity:1,transform:'scale(1)'}],{duration:340,easing:'ease-out'});
    } else old?.remove();
    for(const stale of canvas.querySelectorAll('.mm-layer'))if(stale!==layer&&stale!==old)stale.remove();
    if(focus) (layer.querySelector('.mm-selected')||layer.querySelector('.mm-root')).focus({preventScroll:true});
  }
  async function open(entry, options={}) {
    if(!entry?.url){if(entry?.id==='overview')overview();return;}
    const token=++request;status('正在展开 '+entry.label+'…');
    try {
      const data=await read(entry.url);if(token!==request)return;
      current=data;expanded=true;lastPageUrl=entry.url;page=0;if(!options.paging)pageHistory=[];
      (data.children||[]).forEach(register);
      for(const ancestor of data.path||[])register(ancestor);
      const theme=rootView.children.findIndex(root=>root.id===data.path?.[0]?.id);
      host.style.setProperty('--mm-accent',colors[theme]||'#bac3cb');
      render(true,options.focus);
    } catch {if(token===request)showError(()=>open(entry,options));}
  }
  function overview(focus=false, reveal=true){++request;current=rootView;expanded=reveal;page=0;pageHistory=[];host.style.setProperty('--mm-accent',colors[0]);render(true,focus);}
  function toggle(){++request;expanded=!expanded;render(true,true);}
  function collapse(){if(!current)return;const path=current.path||[];if(current.id==='overview'){expanded=false;render(true,true);}else if(path.length<2)overview(true);else open(knownNodes.get(path[path.length-2].id)||path[path.length-2],{focus:true});}
  function sceneTop(){return host.getBoundingClientRect().top+scrollY;}
  function updateScroll() {
    frame=undefined;const rect=host.getBoundingClientRect();
    const visible=rect.top<innerHeight&&rect.bottom>0;
    if(visible&&!index&&window.awardArchive?.ready)init();
    stage.style.opacity=String(Math.max(0,Math.min(1,1-rect.top/innerHeight)));
    stage.inert=!visible;
    if(window.scrollY!==lastScroll)scrollDirection=Math.sign(window.scrollY-lastScroll);
    lastScroll=window.scrollY;
    if(!index||!visible||modalOpen())return;
    clearTimeout(snapTimer);
    // Snap only on entry. Scrolling never changes the branch selected by a click.
    if(scrollDirection>0&&!dragging&&performance.now()>suppressSnapUntil&&rect.top>2&&rect.top<innerHeight*.3) snapTimer=setTimeout(()=>{
      if(!modalOpen()&&!dragging)window.scrollTo({top:sceneTop(),behavior:reduced.matches?'instant':'smooth'});
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
    if(action==='exit'){clearTimeout(snapTimer);suppressSnapUntil=performance.now()+1600;window.scrollTo({top:Math.max(0,sceneTop()-innerHeight*.8),behavior:reduced.matches?'instant':'smooth'});}
    else if(action==='in')changeZoom(1.2);
    else if(action==='out')changeZoom(1/1.2);
    else if(action==='fit')fit();
    else if(action==='pan'){const active=viewport.classList.toggle('mm-pan-mode');event.target.setAttribute('aria-pressed',String(active));event.target.textContent=active?'纵向浏览':'移动导图';}
    else if(action==='parent')collapse();
    else if(action==='reset')overview(true,false);
    else if(action==='pending'&&pendingRoot)open(pendingRoot,{focus:true});
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
