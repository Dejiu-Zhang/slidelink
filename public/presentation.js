import { slideDocument, fitSlide } from './render.js';
import { createTransport } from './transport.js';
const $ = id=>document.getElementById(id);
const role=location.pathname.includes('presenter')?'presenter':'screen';
document.body.className=role;
const room=new URLSearchParams(location.search).get('room'), key=location.hash.slice(1);
function fatal(text){$('fatal').hidden=false;$('fatal').textContent=text;}
try {
  if(!room||!key)throw Error('请从项目库打开完整的演示链接。');
  const response=await fetch(`/api/decks/${encodeURIComponent(room)}`,{headers:{Authorization:`Bearer ${key}`}});
  if(!response.ok)throw Error('链接不正确、演示已删除或已过期。请从项目库重新打开。');
  const deck=await response.json();
  if(deck.role!==role)throw Error('这不是此视图的链接，请使用项目库中的对应按钮打开。');
  document.title=`${deck.title} · ${role==='presenter'?'演讲者':'投屏'}`;$('deck-title').textContent=deck.title;
  let current=0;
  const stored=(k,v)=>{try{if(v===undefined)return sessionStorage.getItem(k);sessionStorage.setItem(k,v);}catch{}return null;};
  if(role==='presenter')current=Math.max(0,Math.min(deck.slides.length-1,Number(stored(`page-${room}`))||0));
  const layers=deck.slides.map((s,i)=>{const e=document.createElement('div');e.className='ink-page';e.hidden=i!==current;$('slide-box').append(e);return e;});
  deck.slides.forEach((s,i)=>$('jump').add(new Option(`${i+1} · ${s.title}`,i)));
  let host;
  let noteInk={};try{noteInk=JSON.parse(stored(`notes-ink-${room}`)||'{}');}catch{}
  let edited=false,editing=false,lastSaved=deck.notes?[...deck.notes]:[];
  if(role==='presenter'){
    try{const draft=JSON.parse(stored(`notes-draft-${room}`)||'null');if(Array.isArray(draft)&&draft.length===deck.notes.length&&draft.every(n=>typeof n==='string')){deck.notes=draft;edited=JSON.stringify(draft)!==JSON.stringify(lastSaved);}}catch{}
  }
  function noteStatus(text){if($('notes-status'))$('notes-status').textContent=text|| (edited?'草稿保存在本标签页 · 点击保存新版本':'讲稿可编辑 · 修改后保存为新版本');}
  function sizeEditor(){if(!editing)return;$('notes-editor').style.height='auto';$('notes-editor').style.height=`${Math.max(240,$('notes-editor').scrollHeight)}px`;}
  function drawNotes(){
    $('notes-ink').replaceChildren();
    for(const points of noteInk[current]||[]){const path=document.createElementNS('http://www.w3.org/2000/svg','polyline');path.setAttribute('points',points.map(p=>p.join(',')).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#d69223');path.setAttribute('stroke-width','4');path.setAttribute('stroke-linecap','round');$('notes-ink').append(path);}
  }
  function show(i){
    const changed=current!==i;
    current=Math.max(0,Math.min(deck.slides.length-1,i));
    layers.forEach((e,k)=>e.hidden=k!==current);
    $('slide-frame').srcdoc=slideDocument(deck,current);
    if(role==='presenter'){
      $('counter').textContent=`${current+1} / ${deck.slides.length}`;$('jump').value=String(current);
      $('previous').disabled=current===0;$('next').disabled=current===deck.slides.length-1;
      $('notes-text').textContent=deck.notes[current]||'这一页没有讲稿。';
      $('notes-editor').value=deck.notes[current]||'';sizeEditor();
      $('note-page').textContent=`第 ${current+1} 页`;
      if(changed)$('notes-scroll').scrollTop=0;
      stored(`page-${room}`,String(current));drawNotes();
    }
    fit();host?.onmove?.();
  }
  const fit=()=>fitSlide($('slide-box'),$('viewport'),deck);
  host={count:deck.slides.length,index:()=>current,show,slideEl:i=>layers[i],surface:$('stage')};
  show(current);new ResizeObserver(fit).observe($('viewport'));
  const transport=createTransport(room,key,text=>{if($('connection'))$('connection').textContent=text;});
  window.SlideLink.start({role,room,deck:room,host,aspect:deck.width/deck.height,transport});
  if(role==='presenter'){
    noteStatus();
    $('edit-notes').onclick=()=>{
      editing=!editing;$('notes-text').hidden=editing;$('notes-editor').hidden=!editing;
      $('edit-notes').textContent=editing?'完成编辑':'编辑讲稿';
      $('notes-ink').hidden=editing;$('private-pen').disabled=editing;
      if(editing){$('notes-editor').value=deck.notes[current];sizeEditor();$('notes-editor').focus();}
    };
    $('notes-editor').oninput=()=>{deck.notes[current]=$('notes-editor').value;$('notes-text').textContent=deck.notes[current];edited=JSON.stringify(deck.notes)!==JSON.stringify(lastSaved);stored(`notes-draft-${room}`,JSON.stringify(deck.notes));sizeEditor();noteStatus();};
    $('save-notes').onclick=async()=>{
      $('save-notes').disabled=true;noteStatus('正在保存新版本…');
      const notesToSave=[...deck.notes];
      try{
        const res=await fetch(`/api/decks/${encodeURIComponent(room)}/revisions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({notes:notesToSave,label:'讲稿修改 · '+new Date().toLocaleString('zh-CN')})});
        const result=await res.json();if(!res.ok)throw Error(result.error||'保存失败');
        lastSaved=notesToSave;edited=JSON.stringify(deck.notes)!==JSON.stringify(lastSaved);
        noteStatus(edited?'新版已保存，另有新的未保存改动':'已保存新版本 · 当前投屏继续使用原链接');
        $('saved-links').replaceChildren();
        for(const [name,url]of [['打开新版演讲者',result.presenter],['打开新版投屏',result.screen]]){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=name;$('saved-links').append(a);}
        $('saved-links').hidden=false;
      }catch(e){noteStatus(e.message);}finally{$('save-notes').disabled=false;}
    };
    window.addEventListener('beforeunload',e=>{if(edited){e.preventDefault();e.returnValue='';}});
    $('previous').onclick=()=>show(current-1);$('next').onclick=()=>show(current+1);$('jump').onchange=()=>show(Number($('jump').value));
    document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)||e.target.id==='gutter'||e.metaKey||e.ctrlKey||e.altKey)return;if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(current+1);}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(current-1);}});
    let swipe;
    $('stage').addEventListener('touchstart',e=>{if(e.touches.length===1&&!e.target.closest('.sl-ui'))swipe=[e.touches[0].clientX,e.touches[0].clientY];},{passive:true});
    $('stage').addEventListener('touchend',e=>{if(!swipe)return;const [x,y]=swipe;swipe=null;const t=e.changedTouches[0];if(Math.abs(t.clientX-x)>60&&Math.abs(t.clientX-x)>Math.abs(t.clientY-y)*1.5)show(current+(t.clientX<x?1:-1));},{passive:true});
    const portrait=()=>matchMedia('(orientation:portrait)').matches;
    function split(value){value=Math.max(25,Math.min(75,value));$('panes').style.setProperty('--split',`${value}%`);stored(`split-${portrait()?'p':'l'}`,String(value));}
    function resetSplit(){split(Number(stored(`split-${portrait()?'p':'l'}`))||(portrait()?43:58));}
    resetSplit();matchMedia('(orientation:portrait)').addEventListener('change',resetSplit);
    let drag=false;$('gutter').onpointerdown=e=>{drag=true;e.target.setPointerCapture(e.pointerId);e.preventDefault();};
    $('gutter').onpointermove=e=>{if(!drag)return;const r=$('panes').getBoundingClientRect();split((portrait()?(e.clientY-r.top)/r.height:(e.clientX-r.left)/r.width)*100);};
    $('gutter').onpointerup=$('gutter').onpointercancel=()=>drag=false;
    $('gutter').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();split(parseFloat($('panes').style.getPropertyValue('--split'))+(['ArrowLeft','ArrowUp'].includes(e.key)?-2:2));};
    let font=Number(stored('notes-font'))||25;
    function setFont(n){font=Math.max(16,Math.min(46,n));$('notes-content').style.setProperty('--note-size',`${font}px`);stored('notes-font',String(font));}
    setFont(font);$('font-minus').onclick=()=>setFont(font-2);$('font-plus').onclick=()=>setFont(font+2);
    let running=false,elapsed=0,started=0;
    $('timer').onclick=()=>{if(running){elapsed+=Date.now()-started;running=false;}else{started=Date.now();running=true;}$('timer').textContent=running?'暂停':'计时';};
    setInterval(()=>{const s=Math.floor((elapsed+(running?Date.now()-started:0))/1000);$('clock').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;},500);
    $('private-pen').onclick=()=>{const on=$('notes-ink').classList.toggle('drawing');$('private-pen').classList.toggle('active',on);$('private-pen').textContent=on?'退出私人批注':'私人批注';};
    let drawing=null;
    $('notes-ink').onpointerdown=e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();if(drawing)return;drawing={id:e.pointerId,points:[]};(noteInk[current]||=[]).push(drawing.points);try{e.target.setPointerCapture(e.pointerId);}catch{}addPoint(e);};
    function addPoint(e){if(!drawing||e.pointerId!==drawing.id)return;const r=$('notes-ink').getBoundingClientRect();drawing.points.push([(e.clientX-r.left)/r.width*1000,(e.clientY-r.top)/r.height*1000]);drawNotes();}
    $('notes-ink').onpointermove=addPoint;
    $('notes-ink').onpointerup=$('notes-ink').onpointercancel=e=>{if(drawing?.id!==e.pointerId)return;drawing=null;stored(`notes-ink-${room}`,JSON.stringify(noteInk));};
    $('private-undo').onclick=()=>{noteInk[current]?.pop();drawNotes();stored(`notes-ink-${room}`,JSON.stringify(noteInk));};
  }else{
    $('notes-pane').remove();$('gutter').remove();$('footer').remove();$('header').remove();
    $('screen-hint').hidden=false;setTimeout(()=>$('screen-hint').hidden=true,6000);
  }
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{if(role==='presenter')$('connection').textContent='此浏览器不支持全屏，可隐藏浏览器工具栏。';}}
  $('fullscreen')?.addEventListener('click',fullscreen);$('screen-hint').onclick=fullscreen;
  if(role==='screen')document.addEventListener('keydown',e=>{if(e.key==='f'||e.key==='F')fullscreen();});
  $('fatal').hidden=true;
}catch(e){fatal(e.message);}
