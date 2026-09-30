import { slideDocument, fitSlide } from './render.js';
import { createTransport } from './transport.js';
import { t, locale, initLanguage, applyLanguage } from './i18n.js';
initLanguage();
const $ = id=>document.getElementById(id);
const role=location.pathname.includes('presenter')?'presenter':'screen';
document.body.className=role;
const room=new URLSearchParams(location.search).get('room'), key=location.hash.slice(1);
function fatal(text){$('fatal').hidden=false;$('fatal').textContent=t(text);}
try {
  if(!room||!key)throw Error("Open the full presentation link from the library.");
  const response=await fetch(`/api/decks/${encodeURIComponent(room)}`,{headers:{Authorization:`Bearer ${key}`}});
  if(!response.ok)throw Error("Invalid, deleted or expired link. Open it again from the library.");
  const deck=await response.json();
  if(deck.role!==role)throw Error("This link is for a different view. Use the matching library button.");
  document.title=`${deck.title} · ${t(role==='presenter'?'Presenter':'Screen')}`;$('deck-title').textContent=deck.title;
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
  let noteStatusMessage;
  function noteStatus(text){noteStatusMessage=text; if($('notes-status'))$('notes-status').textContent=t(text || (edited?'Draft saved in this tab · Save a new version to keep changes':'Edits are saved as a new version'));}
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
      $('notes-text').textContent=deck.notes[current]||t('No notes for this slide.');
      $('notes-editor').value=deck.notes[current]||'';sizeEditor();
      $('note-page').textContent=t('Slide {number}', {number:current+1});
      if(changed)$('notes-scroll').scrollTop=0;
      stored(`page-${room}`,String(current));drawNotes();
    }
    fit();host?.onmove?.();
  }
  const fit=()=>fitSlide($('slide-box'),$('viewport'),deck);
  host={count:deck.slides.length,index:()=>current,show,slideEl:i=>layers[i],surface:$('stage')};
  show(current);new ResizeObserver(fit).observe($('viewport'));
  const transport=createTransport(room,key,text=>{if($('connection'))$('connection').textContent=text;});
  window.SlideLink.start({role,room,deck:room,host,aspect:deck.width/deck.height,transport,translate:t});
  if(role==='presenter'){
    noteStatus();
    $('edit-notes').onclick=()=>{
      editing=!editing;$('notes-text').hidden=editing;$('notes-editor').hidden=!editing;
      $('edit-notes').textContent=t(editing?'Done editing':'Edit notes');
      $('notes-ink').hidden=editing;$('private-pen').disabled=editing;
      if(editing){$('notes-editor').value=deck.notes[current];sizeEditor();$('notes-editor').focus();}
    };
    $('notes-editor').oninput=()=>{deck.notes[current]=$('notes-editor').value;$('notes-text').textContent=deck.notes[current];edited=JSON.stringify(deck.notes)!==JSON.stringify(lastSaved);stored(`notes-draft-${room}`,JSON.stringify(deck.notes));sizeEditor();noteStatus();};
    $('save-notes').onclick=async()=>{
      $('save-notes').disabled=true;noteStatus("Saving new version…");
      const notesToSave=[...deck.notes];
      try{
        const res=await fetch(`/api/decks/${encodeURIComponent(room)}/revisions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({notes:notesToSave,label:t('Notes update')+' · '+new Date().toLocaleString(locale())})});
        const result=await res.json();if(!res.ok)throw Error(result.error||"Save failed");
        lastSaved=notesToSave;edited=JSON.stringify(deck.notes)!==JSON.stringify(lastSaved);
        noteStatus(edited?'Version saved; newer edits are still unsaved':'New version saved · Current screen link is unchanged');
        $('saved-links').replaceChildren();
        for(const [name,url]of [["Open new presenter",result.presenter],["Open new screen",result.screen]]){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.dataset.i18n=name;a.textContent=t(name);$('saved-links').append(a);}
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
    $('timer').onclick=()=>{if(running){elapsed+=Date.now()-started;running=false;}else{started=Date.now();running=true;}$('timer').textContent=running?"Pause timer":"Start timer";};
    setInterval(()=>{const s=Math.floor((elapsed+(running?Date.now()-started:0))/1000);$('clock').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;},500);
    $('private-pen').onclick=()=>{const on=$('notes-ink').classList.toggle('drawing');$('private-pen').classList.toggle('active',on);$('private-pen').textContent=t(on?'Exit private pen':'Private pen');};
    applyLanguage();
    document.addEventListener('languagechange',()=>{
      document.title=deck.title+' · '+t('Presenter');
      $('note-page').textContent=t('Slide {number}',{number:current+1});
      $('notes-text').textContent=deck.notes[current]||t('No notes for this slide.');
      $('edit-notes').textContent=t(editing?'Done editing':'Edit notes');
      $('timer').textContent=t(running?'Pause timer':'Start timer');
      $('private-pen').textContent=t($('notes-ink').classList.contains('drawing')?'Exit private pen':'Private pen');
      noteStatus(noteStatusMessage);
    });
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
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{if(role==='presenter')$('connection').textContent=t('Fullscreen is unavailable in this browser.');}}
  $('fullscreen')?.addEventListener('click',fullscreen);$('screen-hint').onclick=fullscreen;
  if(role==='screen')document.addEventListener('keydown',e=>{if(e.key==='f'||e.key==='F')fullscreen();});
  $('fatal').hidden=true;
}catch(e){fatal(e.message);}
