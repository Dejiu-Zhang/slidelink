import { emptyNotesInk, remapStrokes } from './notes-ink-model.js';

const NS = 'http://www.w3.org/2000/svg';
const colors = { r:'#e0311f', b:'#1d5fd1', k:'#1c2430', h:'#ffd400', l:'#ff2d1f' };
const clone = value => JSON.parse(JSON.stringify(value));

export function createNotesInk({ surface, text, svg, initial, legacy = {}, onChange, onState }) {
  const model = clone(initial || emptyNotesInk()), histories = new Map();
  let page = 0, editing = false, cfg = { tool:'r', si:1, pr:true, finger:false };
  let gesture, boxes = [], byOffset = new Map(), font = 25, layoutDirty = true, lastPen = 0, focused = false, raf;
  let laser = null, laserTimer;
  const history = () => { if (!histories.has(page)) histories.set(page, { undo:[], redo:[] }); return histories.get(page); };
  const current = () => model.pages[page] || (model.pages[page] = { text:'', strokes:[] });
  const supported = () => !!colors[cfg.tool] || cfg.tool === 'x';
  function state() { onState?.({ undo:history().undo.length > 0, redo:history().redo.length > 0, hasInk:current().strokes.length > 0, tool:cfg.tool, color:colors[cfg.tool], supported:supported() }); }
  function changed() { onChange?.(snapshot()); state(); }
  function checkpoint() { const h=history(); h.undo.push(clone(current().strokes)); if(h.undo.length>40)h.undo.shift(); h.redo=[]; }
  function snapshot() {
    const out=emptyNotesInk();
    for(const [i,p] of Object.entries(model.pages)) if(p.strokes.length)out.pages[i]=clone(p);
    return out;
  }
  function rebuildLayout() {
    if (!layoutDirty || editing) return;
    layoutDirty=false; boxes=[]; byOffset=new Map();
    const contentRect=surface.getBoundingClientRect();
    font=parseFloat(getComputedStyle(text).fontSize)||25;
    const node=text.firstChild;
    if (!node || node.nodeType!==Node.TEXT_NODE || !current().text) return;
    const range=document.createRange();
    let offset=0;
    for(const char of node.textContent) {
      range.setStart(node,offset); range.setEnd(node,offset+char.length);
      const r=range.getBoundingClientRect();
      if(r.width && r.height) {
        const b={ a:offset, x:r.left-contentRect.left, y:r.top-contentRect.top, w:r.width, h:r.height };
        boxes.push(b);byOffset.set(offset,b);
      }
      offset+=char.length;
    }
    range.detach();
  }
  function anchor(event) {
    rebuildLayout();
    const r=surface.getBoundingClientRect(), x=event.clientX-r.left, y=event.clientY-r.top;
    let nearest, distance=Infinity;
    for(const b of boxes) {
      const dx=Math.max(b.x-x,0,x-b.x-b.w), dy=Math.max(b.y-y,0,y-b.y-b.h);
      const d=dx*dx+dy*dy*4;
      if(d<distance){nearest=b;distance=d;}
    }
    return { a:nearest?.a??-1, x:(x-(nearest?.x||0))/font, y:(y-(nearest?.y||0))/font, p:event.pressure>0?event.pressure:.5 };
  }
  function position(p) {
    const b=byOffset.get(p.a);
    return [(b?.x||0)+p.x*font,(b?.y||0)+p.y*font,p.p];
  }
  function outline(points, width, pressure) {
    const polygon=window.SlideLink.getStroke(points,{size:width,thinning:pressure ? .6 : 0,smoothing:.5,streamline:.25,simulatePressure:false,last:true});
    if(!polygon.length)return '';
    return 'M'+polygon.map(p=>p.map(n=>n.toFixed(2)).join(',')).join('L')+'Z';
  }
  function strokeElement(stroke) {
    const path=document.createElementNS(NS,'path');
    path.setAttribute('fill',colors[stroke.tool]);
    if(stroke.tool==='h') {path.setAttribute('opacity','.35');path.classList.add('note-highlighter');}
    // Reflow can split an underlined word across lines. Do not draw a diagonal bridge.
    const groups=[[]]; let previous;
    for(const p of stroke.points) {
      const point=position(p);
      if(previous && Math.abs(point[1]-previous.point[1])>font*1.2 && Math.abs(p.y-previous.anchor.y)<.7 && Math.abs(p.a-previous.anchor.a)<12)groups.push([]);
      groups.at(-1).push(point);previous={point,anchor:p};
    }
    path.setAttribute('d',groups.map(points=>outline(points,stroke.width*font/25,stroke.pressure)).join(' '));
    return path;
  }
  function render() {
    if(editing)return;
    rebuildLayout();svg.removeAttribute('viewBox');
    svg.replaceChildren(...current().strokes.map(strokeElement));
    if(laser) {const path=strokeElement(laser);path.classList.add('note-laser');svg.append(path);}
  }
  function schedule() { cancelAnimationFrame(raf);raf=requestAnimationFrame(render); }
  function refresh() { layoutDirty=true;schedule(); }
  function setPage(index, content) {
    finish();laser=null;page=index;
    const record=current();
    if(record.text!==content) {
      record.strokes=remapStrokes(record.strokes,record.text,content);record.text=content;
      histories.delete(page);
    }
    refresh();
    if(Array.isArray(legacy[page]) && !record.strokes.length) {
      rebuildLayout();
      const r=surface.getBoundingClientRect();
      record.strokes=legacy[page].filter(points=>Array.isArray(points)&&points.length).map(points=>({
        tool:'r',width:2.4,pressure:false,points:points.filter(p=>Array.isArray(p)&&p.every(Number.isFinite)).map(p=>anchor({clientX:r.left+p[0]/1000*r.width,clientY:r.top+p[1]/1000*r.height,pressure:.5}))
      })).filter(s=>s.points.length);
      delete legacy[page];changed();
    }
    state();
  }
  function setTool(tool) { cfg={...tool};surface.classList.toggle('finger-ink',cfg.finger);state(); }
  function setEditing(value) { finish();editing=value;svg.hidden=value;surface.classList.toggle('editing-notes',value);if(!value)refresh();state(); }
  function undo() { finish();const h=history();if(!h.undo.length)return;h.redo.push(clone(current().strokes));current().strokes=h.undo.pop();render();changed(); }
  function redo() { finish();const h=history();if(!h.redo.length)return;h.undo.push(clone(current().strokes));current().strokes=h.redo.pop();render();changed(); }
  function clear() { finish();if(!current().strokes.length)return;checkpoint();current().strokes=[];render();changed(); }
  function nearSegment(p,a,b) {
    const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const u=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
    return Math.hypot(p[0]-a[0]-u*dx,p[1]-a[1]-u*dy);
  }
  function erase(point) {
    const strokes=current().strokes.filter(s=>{
      const ps=s.points.map(position), radius=10+s.width*font/50;
      return !ps.some((p,i)=>nearSegment(point,ps[Math.max(0,i-1)],p)<radius);
    });
    if(strokes.length!==current().strokes.length) {
      if(!gesture.dirty)checkpoint();gesture.dirty=true;current().strokes=strokes;render();
    }
  }
  function move(event) {
    if(!gesture || event.pointerId!==gesture.id)return;
    event.preventDefault();
    const coalesced=event.getCoalescedEvents?.();
    for(const e of coalesced?.length ? coalesced : [event]) {
      const point=anchor(e);
      if(gesture.erase){erase(position(point));continue;}
      const points=gesture.stroke.points, last=points.at(-1);
      if(points.length>=10000)continue;
      if(!last || Math.hypot(...position(point).slice(0,2).map((v,i)=>v-position(last)[i]))>.65)points.push(point);
    }
    schedule();
  }
  function finish(event) {
    if(!gesture || (event && event.pointerId!==gesture.id))return;
    if(event?.type==='pointerup')move(event);
    const g=gesture;gesture=null;lastPen=Date.now();
    if(g.laser) {clearTimeout(laserTimer);laserTimer=setTimeout(()=>{laser=null;render();},650);}
    else if(g.dirty)changed();
    try{surface.releasePointerCapture(g.id);}catch{}
    surface.classList.remove('stylus-ink');render();
  }
  surface.addEventListener('pointerover',e=>{if(e.pointerType==='pen'&&!editing)surface.classList.add('stylus-ink');});
  surface.addEventListener('pointerleave',()=>{if(!gesture)surface.classList.remove('stylus-ink');});
  surface.addEventListener('pointerdown',e=>{
    focused=true;
    if(editing || gesture || !supported() || (e.pointerType==='mouse' && e.button!==0))return;
    if(e.pointerType==='touch' && (!cfg.finger || Date.now()-lastPen<700))return;
    e.preventDefault();rebuildLayout();
    if(e.pointerType==='pen'){lastPen=Date.now();surface.classList.add('stylus-ink');}
    gesture={id:e.pointerId,erase:cfg.tool==='x',laser:cfg.tool==='l',dirty:false};
    if(!gesture.erase) {
      const width=[1.4,2.4,4,6.4][cfg.si]*(cfg.tool==='h'?7:1);
      gesture.stroke={tool:cfg.tool,width,pressure:cfg.pr&&cfg.tool!=='h',points:[]};
      if(gesture.laser)laser=gesture.stroke;
      else {checkpoint();current().strokes.push(gesture.stroke);gesture.dirty=true;}
    }
    try{surface.setPointerCapture(e.pointerId);}catch{}move(e);
  });
  surface.addEventListener('pointermove',move);
  surface.addEventListener('pointerup',finish);surface.addEventListener('pointercancel',finish);
  surface.addEventListener('lostpointercapture',()=>finish());
  window.addEventListener('blur',()=>finish());
  // Safari exposes Pencil separately from finger touches; fingers can still scroll normally.
  surface.addEventListener('touchstart',e=>{
    if(editing)return;
    if([...e.changedTouches].some(t=>t.touchType==='stylus') || gesture || Date.now()-lastPen<700)e.preventDefault();
  },{passive:false});
  surface.addEventListener('touchmove',e=>{if(gesture)e.preventDefault();},{passive:false});
  document.addEventListener('pointerdown',e=>{if(!surface.contains(e.target)&&!e.target.closest('.notes-controls'))focused=false;},true);
  document.addEventListener('keydown',e=>{
    if(!focused || editing || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !(e.metaKey||e.ctrlKey))return;
    if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
  });
  new ResizeObserver(refresh).observe(text);
  document.fonts?.ready.then(refresh);
  return { setPage,setTool,setEditing,refresh,snapshot,undo,redo,clear,finish };
}
