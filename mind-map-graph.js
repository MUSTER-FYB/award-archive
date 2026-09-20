/* Persistent node state and world positions; this module never controls the viewport. */
((scope, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.AwardMindMapGraph = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const ROOT = 'overview';
  class Graph {
    constructor(index) {
      this.nodes = new Map();
      this.selected = ROOT;
      this.themes = index.roots.filter(n => n.label !== '待映射');
      this.pending = index.roots.find(n => n.label === '待映射');
      this.pendingVisible = false;
      this.add({id:ROOT,label:index.title,count:index.stats.works,kind:'root',loaded:true,children:[]}, null, {x:0,y:0,angle:0});
      this.themes.forEach((entry,i) => {
        const angle=-Math.PI/2+i*Math.PI*2/this.themes.length;
        this.add({...entry,theme:i}, ROOT, {x:Math.cos(angle)*330,y:Math.sin(angle)*260,angle});
        this.nodes.get(ROOT).children.push(entry.id);
      });
    }
    add(entry, parent, position) {
      const key=entry.key || entry.id;
      if (this.nodes.has(key)) return this.nodes.get(key);
      const node={key,kind:'branch',parent,children:[],expanded:false,loaded:false,loading:false,error:'',...entry};
      if(position)Object.assign(node,position);
      this.nodes.set(key,node);
      return node;
    }
    select(key) { if(this.nodes.has(key))this.selected=key; }
    toggle(key) {
      const node=this.nodes.get(key);
      if(!node || !['root','branch'].includes(node.kind))return false;
      this.select(key);node.expanded=!node.expanded;return node.expanded;
    }
    showPending() {
      if(!this.pending)return;
      this.pendingVisible=true;
      const root=this.nodes.get(ROOT);
      if(!this.nodes.has(this.pending.id)) {
        const node=this.add({...this.pending,theme:6},ROOT);
        this.place(node,root,0,1,Math.PI/2);
        root.children.push(node.key);
      }
      root.expanded=true;
      const node=this.nodes.get(this.pending.id);node.expanded=true;this.select(node.key);
      return node;
    }
    collapseAll() {
      for(const node of this.nodes.values())node.expanded=false;
      this.pendingVisible=false;
      this.selected=ROOT;
    }
    apply(key, data) {
      const parent=this.nodes.get(key);
      if(!parent || data.id!==parent.id)throw new Error('Branch data does not match its parent');
      const entries=data.children || data.cases || [];
      const fresh=[];
      for(const entry of entries) {
        // A case can belong to several branches: its occurrence, not its work id, is unique.
        const childKey=data.cases ? key+'::case::'+entry.id : entry.id;
        if(parent.children.includes(childKey))continue;
        const node=this.add({...entry,key:childKey,kind:data.cases?'case':'branch',theme:parent.theme},key);
        parent.children.push(childKey);fresh.push(node);
      }
      fresh.forEach((node,i)=>this.place(node,parent,i,fresh.length));
      parent.loaded=true;parent.error='';parent.next=data.next || null;parent.caseBranch=!!data.cases;
      if(parent.next) {
        const more=this.add({id:key+'::more',kind:'more',label:'加载更多案例',theme:parent.theme},key);
        if(more.x===undefined)this.place(more,parent,0,1);
      }
    }
    radius(node) { return node.kind==='root'?110:node.kind==='case'?134:node.kind==='more'?121:94; }
    place(node, parent, index, count, direction=parent.angle) {
      if(node.x!==undefined)return;
      const preferred=count===1?0:-1.05+(index%5)*2.1/(Math.min(count,5)-1);
      const offsets=[preferred,...Array.from({length:15},(_,i)=>-1.12+i*2.24/14).sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred))];
      const occupied=[...this.nodes.values()].filter(n=>n!==node&&n.x!==undefined);
      for(let ring=0;ring<100;ring++) {
        const distance=310+ring*100;
        for(const offset of offsets) {
          const angle=direction+offset,x=parent.x+Math.cos(angle)*distance,y=parent.y+Math.sin(angle)*distance;
          if(occupied.every(other=>Math.hypot(x-other.x,y-other.y)>=this.radius(node)+this.radius(other)+22)) {
            Object.assign(node,{x,y,angle});return;
          }
        }
      }
      throw new Error('Unable to place branch without overlap');
    }
    visible() {
      const result=[];
      const visit=key=>{
        const node=this.nodes.get(key);if(!node)return;
        result.push(node);
        if(node.expanded) {
          node.children.filter(id=>id!==this.pending?.id||this.pendingVisible).forEach(visit);
          if(node.next)visit(key+'::more');
        }
      };
      visit(ROOT);return result;
    }
    path(key=this.selected) {
      const result=[];
      for(let node=this.nodes.get(key);node;node=this.nodes.get(node.parent))result.unshift(node);
      return result;
    }
    bounds(nodes=this.visible()) {
      const minX=Math.min(...nodes.map(n=>n.x-this.radius(n))),maxX=Math.max(...nodes.map(n=>n.x+this.radius(n)));
      const minY=Math.min(...nodes.map(n=>n.y-this.radius(n))),maxY=Math.max(...nodes.map(n=>n.y+this.radius(n)));
      return {width:maxX-minX+30,height:maxY-minY+30,x:(minX+maxX)/2,y:(minY+maxY)/2};
    }
  }
  return {Graph,ROOT};
});
