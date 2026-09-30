import { slideDocument, fitSlide } from './render.js';
import { createTransport } from './transport.js';
import { createNotesInk } from './notes-ink.js';
import { emptyNotesInk, validateNotesInk } from './notes-ink-model.js';
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
  let host, notesInk, toolState, shown=false;
  let legacyInk={};try{legacyInk=JSON.parse(stored(`notes-ink-${room}`)||'{}');}catch{}
  let scrollPositions={};try{scrollPositions=JSON.parse(stored(`notes-scroll-${room}`)||'{}');}catch{}
  let lastSavedInk=JSON.stringify(deck.notesInk||emptyNotesInk());
  let noteInkDraft=deck.notesInk||emptyNotesInk();
  let edited=false,editing=false,lastSaved=deck.notes?[...deck.notes]:[];
  if(role==='presenter'){
    try{const draft=JSON.parse(stored(`notes-draft-${room}`)||'null');if(Array.isArray(draft)&&draft.length===deck.notes.length&&draft.every(n=>typeof n==='string')){deck.notes=draft;edited=JSON.stringify(draft)!==JSON.stringify(lastSaved);}}catch{}
  }
  if(role==='presenter') {
    try { noteInkDraft=validateNotesInk(JSON.parse(stored(`notes-ink-v1-${room}`)||'null')||noteInkDraft,deck.notes); } catch { noteInkDraft=deck.notesInk||emptyNotesInk(); }
    edited=edited || JSON.stringify(noteInkDraft)!==lastSavedInk;
  }
  let noteStatusMessage, saving=false;
  function updateEdited() {
    edited=JSON.stringify(deck.notes)!==JSON.stringify(lastSaved) || JSON.stringify(notesInk?.snapshot()||noteInkDraft)!==lastSavedInk;
    stored(`notes-draft-${room}`,JSON.stringify(deck.notes));
    stored(`notes-ink-v1-${room}`,JSON.stringify(notesInk?.snapshot()||noteInkDraft));
    noteStatus();
  }
  function renderTool(state=toolState) {
    if(!state)return;toolState=state;
    $('private-undo').disabled=editing||!state.undo;
    $('private-redo').disabled=editing||!state.redo;
    $('private-clear').disabled=editing||!state.hasInk;
    $('note-tool-color').style.background=state.color||'#999';
    const labels={r:'red pen',b:'blue pen',k:'black pen',h:'Highlighter',x:'Eraser',l:'Laser',s:'Select',q:'Select'};
    $('note-tool-label').textContent=t(labels[state.tool]||'Pen');
    $('notes-tool').title=t(state.supported?'Use the same pen here. Pencil marks; fingers scroll.':'Choose a pen, highlighter or eraser to mark notes.');
  }
  function noteStatus(text){noteStatusMessage=text; if($('notes-status'))$('notes-status').textContent=t(text || (edited?'Draft saved in this tab · Save a new version to keep changes':'Notes and marks are saved as a new version')); if($('save-notes'))$('save-notes').disabled=saving||!edited;}
  function sizeEditor(){if(!editing)return;$('notes-editor').style.height='auto';$('notes-editor').style.height=`${Math.max(240,$('notes-editor').scrollHeight)}px`;}
  if(role==='presenter') notesInk=createNotesInk({
    surface:$('notes-content'),text:$('notes-text'),svg:$('notes-ink'),initial:noteInkDraft,legacy:legacyInk,
    onChange:value=>{noteInkDraft=value;updateEdited();},onState:renderTool
  });
  function show(i){
    const changed=current!==i;
    if(role==='presenter'&&changed)scrollPositions[current]=$('notes-scroll').scrollTop;
    current=Math.max(0,Math.min(deck.slides.length-1,i));
    layers.forEach((e,k)=>e.hidden=k!==current);
    $('slide-frame').srcdoc=slideDocument(deck,current);
    if(role==='presenter'){
      $('counter').textContent=`${current+1} / ${deck.slides.length}`;$('jump').value=String(current);
      $('previous').disabled=current===0;$('next').disabled=current===deck.slides.length-1;
      $('notes-text').textContent=deck.notes[current]||t('No notes for this slide.');
      $('notes-editor').value=deck.notes[current]||'';sizeEditor();
      $('note-page').textContent=t('Slide {number}', {number:current+1});
      notesInk.setPage(current,deck.notes[current]||'');
      if(changed||!shown)$('notes-scroll').scrollTop=Number(scrollPositions[current])||0;
      shown=true;
      stored(`page-${room}`,String(current));
    }
    fit();host?.onmove?.();
  }
  const fit=()=>fitSlide($('slide-box'),$('viewport'),deck);
  host={count:deck.slides.length,index:()=>current,show,slideEl:i=>layers[i],surface:$('stage')};
  show(current);new ResizeObserver(fit).observe($('viewport'));
  const transport=createTransport(room,key,text=>{if($('connection'))$('connection').textContent=text;});
  window.SlideLink.start({role,room,deck:room,host,aspect:deck.width/deck.height,transport,translate:t,onToolChange:cfg=>notesInk?.setTool(cfg)});
  if(role==='presenter'){
    noteStatus();
    $('notes-scroll').addEventListener('scroll',()=>{scrollPositions[current]=$('notes-scroll').scrollTop;stored(`notes-scroll-${room}`,JSON.stringify(scrollPositions));},{passive:true});
    $('edit-notes').onclick=()=>{
      editing=!editing;$('notes-text').hidden=editing;$('notes-editor').hidden=!editing;
      $('edit-notes').textContent=t(editing?'Done editing':'Edit notes');
      notesInk.setEditing(editing);
      if(!editing)notesInk.setPage(current,deck.notes[current]||'');
      if(editing){$('notes-editor').value=deck.notes[current];sizeEditor();$('notes-editor').focus();}
    };
    $('notes-editor').oninput=()=>{deck.notes[current]=$('notes-editor').value;$('notes-text').textContent=deck.notes[current];notesInk.setPage(current,deck.notes[current]);sizeEditor();updateEdited();};
    $('save-notes').onclick=async()=>{
      notesInk.finish();saving=true;noteStatus('Saving new version…');
      const notesToSave=[...deck.notes], inkToSave=notesInk.snapshot();
      try{
        const res=await fetch(`/api/decks/${encodeURIComponent(room)}/revisions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({notes:notesToSave,notesInk:inkToSave,label:t('Notes update')+' · '+new Date().toLocaleString(locale())})});
        const result=await res.json();if(!res.ok)throw Error(result.error||"Save failed");
        lastSaved=notesToSave;lastSavedInk=JSON.stringify(inkToSave);updateEdited();
        noteStatus(edited?'Version saved; newer edits are still unsaved':'New version saved · Current screen link is unchanged');
        $('saved-links').replaceChildren();
        for(const [name,url]of [["Open new presenter",result.presenter],["Open new screen",result.screen]]){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.dataset.i18n=name;a.textContent=t(name);$('saved-links').append(a);}
        $('saved-links').hidden=false;
      }catch(e){noteStatus(e.message);}finally{saving=false;noteStatus(noteStatusMessage);}
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
    function setFont(n){font=Math.max(16,Math.min(46,n));$('notes-content').style.setProperty('--note-size',`${font}px`);stored('notes-font',String(font));notesInk.refresh();$('font-minus').disabled=font<=16;$('font-plus').disabled=font>=46;}
    setFont(font);$('font-minus').onclick=()=>setFont(font-2);$('font-plus').onclick=()=>setFont(font+2);
    let running=false,elapsed=0,started=0;
    $('timer').onclick=()=>{if(running){elapsed+=Date.now()-started;running=false;}else{started=Date.now();running=true;}$('timer').textContent=t(running?'Pause timer':'Start timer');};
    setInterval(()=>{const s=Math.floor((elapsed+(running?Date.now()-started:0))/1000);$('clock').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;},500);
    $('private-undo').onclick=notesInk.undo;
    $('private-redo').onclick=notesInk.redo;
    $('private-clear').onclick=notesInk.clear;
    applyLanguage();
    document.addEventListener('languagechange',()=>{
      document.title=deck.title+' · '+t('Presenter');
      $('note-page').textContent=t('Slide {number}',{number:current+1});
      $('notes-text').textContent=deck.notes[current]||t('No notes for this slide.');
      $('edit-notes').textContent=t(editing?'Done editing':'Edit notes');
      $('timer').textContent=t(running?'Pause timer':'Start timer');
      renderTool();notesInk.refresh();
      noteStatus(noteStatusMessage);
    });

  }else{
    $('notes-pane').remove();$('gutter').remove();$('footer').remove();$('header').remove();
    $('screen-hint').hidden=false;setTimeout(()=>$('screen-hint').hidden=true,6000);
  }
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{if(role==='presenter')$('connection').textContent=t('Fullscreen is unavailable in this browser.');}}
  $('fullscreen')?.addEventListener('click',fullscreen);$('screen-hint').onclick=fullscreen;
  if(role==='screen')document.addEventListener('keydown',e=>{if(e.key==='f'||e.key==='F')fullscreen();});
  $('fatal').hidden=true;
}catch(e){fatal(e.message);}
