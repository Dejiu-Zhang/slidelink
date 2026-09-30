import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { importDeck, splitNotes } from '../lib/import.js';
import { createApp, validatedMessage } from '../server.js';
import { translate } from '../public/i18n.js';

const html='<title>Test deck</title><style>.slide{color:navy}</style><section class="slide"><h1>Hello</h1><aside class="notes">PRIVATE INLINE NOTE</aside><script>bad()</script><img onerror="bad()" src="x"><!-- secret comment --></section><section class="slide"><h2>End</h2></section>';
test('import preserves rendered content and separates private notes',()=>{
 const d=importDeck({html});assert.equal(d.slides.length,2);assert.equal(d.notes[0],'PRIVATE INLINE NOTE');
 assert(!JSON.stringify(d.slides).includes('PRIVATE'));assert(!d.slides[0].html.includes('<script'));assert(!d.slides[0].html.includes('onerror'));assert(!d.slides[0].html.includes('secret comment'));
 assert.throws(()=>importDeck({html,notes:'one'}),/2 slides but 1 note sections/);
 assert.deepEqual(splitNotes('# Slide 1\nFirst\n# Slide 2\nSecond'),['First','Second']);
 assert.deepEqual(splitNotes('First\n---\n\n---\nThird'),['First','','Third']);
 assert.throws(()=>importDeck({html:'<p>No slides</p>'}),/No slides found/);
});
test('English default and Chinese UI messages preserve user content',()=>{
 assert.equal(translate('New project'),'New project');
 assert.equal(translate('New project','zh'),'新建项目');
 assert.equal(translate('{count} slides','zh',{count:43}),'43 页');
 assert.equal(translate('Found 43 slides but 1 note sections. Separate each page with --- on its own line, including empty pages.','zh'),'识别到 43 页 slides，但讲稿分成了 1 页。请用单独一行 --- 分隔每一页（无稿页也保留空白段）。');
 assert.equal(translate('My presentation title','zh'),'My presentation title');
 assert.equal(translate(undefined),'');
});
test('socket validation denies screen control and bounds stroke payloads',()=>{
 assert.equal(validatedMessage({k:'pos',i:0},2,'screen'),null);
 assert.equal(validatedMessage({k:'ink2',i:0,o:'p'},2,'screen'),null);
 assert.equal(validatedMessage({k:'hb',i:999},2,'presenter'),null);
 assert.equal(validatedMessage({k:'ink2',i:0,o:'p',s:'a',a:0,p:[1,2,Infinity]},2,'presenter'),null);
 assert(!('notes' in validatedMessage({k:'hb',i:0,notes:'secret'},2,'presenter')));
});

test('workspace ownership, versions, notes privacy, WebSocket roles, deletion and restart',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'slidelink-test-'));
 let instance=await createApp({dataDir,uploadKey:'upload-test'});
 await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
 let base=`http://127.0.0.1:${instance.server.address().port}`;
 const a='slw_'+ 'a'.repeat(48),b='slw_'+'b'.repeat(48);
 const req=async(url,body,owner=a,method=body?'POST':'GET')=>fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Workspace-Key':owner,'X-Upload-Key':'upload-test'},body:body?JSON.stringify(body):undefined});
 let p,s;
 try {
  assert.equal((await fetch(base+'/api/decks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html})})).status,401);
  const folder=await (await req('/api/folders',{name:'Research'})).json();
  const r=await req('/api/decks',{html,notes:'SCRIPT SECRET\n---\nFinish',folderId:folder.id,versionLabel:'v1'});assert.equal(r.status,201);
  const first=await r.json();
  const thumb=await (await req('/api/thumbnails/'+first.id)).json();
  assert.deepEqual(Object.keys(thumb).sort(),['css','format','height','slides','width']);
  assert.equal(thumb.slides.length,1);assert(thumb.slides[0].html.includes('Hello'));
  assert(!JSON.stringify(thumb).includes('SECRET'));assert(!JSON.stringify(thumb).includes('PRIVATE'));
  assert.equal((await req('/api/thumbnails/'+first.id,undefined,b)).status,404);
  assert.equal((await fetch(base+'/api/thumbnails/'+first.id)).status,401);
  const second=await (await req('/api/decks',{html,projectId:first.projectId,versionLabel:'v2'})).json();assert.notEqual(first.id,second.id);
  assert.equal((await req('/api/decks',{html,projectId:first.projectId},b)).status,404);
  const lib=await(await req('/api/library')).json();assert.equal(lib.versions.length,2);assert.equal(lib.projects.length,1);
  assert.equal((await(await req('/api/library',undefined,b)).json()).projects.length,0);
  assert.equal((await req(`/api/sources/${first.id}/slides`,undefined,b)).status,404);
  const screenKey=first.screen.split('#')[1],presenterKey=first.presenter.split('#')[1];
  const access=async key=>fetch(base+`/api/decks/${first.id}`,{headers:{Authorization:`Bearer ${key}`}});
  const screen=await(await access(screenKey)).json();assert.equal(screen.role,'screen');assert(!('notes'in screen));assert(!JSON.stringify(screen).includes('SCRIPT SECRET'));assert(!JSON.stringify(screen).includes('PRIVATE INLINE'));
  assert.equal((await(await access(presenterKey)).json()).notes[0],'SCRIPT SECRET');
  const revised=await fetch(base+`/api/decks/${first.id}/revisions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${presenterKey}`},body:JSON.stringify({notes:['EDITED SECRET','Finish'],label:'Edited script'})});
  assert.equal(revised.status,201);const revision=await revised.json();
  assert.equal((await(await access(presenterKey)).json()).notes[0],'SCRIPT SECRET');
  const revisedData=await(await fetch(base+`/api/decks/${revision.id}`,{headers:{Authorization:`Bearer ${revision.presenter.split('#')[1]}`}})).json();assert.equal(revisedData.notes[0],'EDITED SECRET');
  assert.equal((await fetch(base+`/api/decks/${first.id}/revisions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${screenKey}`},body:JSON.stringify({notes:['bad','bad']})})).status,403);
  assert.equal((await access('bad')).status,404);
  assert.equal((await fetch(base+`/api/decks/${first.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${screenKey}`}})).status,403);
  async function connect(key){const ws=new WebSocket(base.replace('http:','ws:')+'/sync');await once(ws,'open');const ready=once(ws,'message');ws.send(JSON.stringify({type:'auth',room:first.id,key}));assert.equal(JSON.parse((await ready)[0]).type,'ready');return ws;}
  p=await connect(presenterKey);s=await connect(screenKey);
  const move=once(s,'message');p.send(JSON.stringify({k:'pos',i:1,c:1,notes:'SHOULD NOT BROADCAST'}));
  const received=JSON.parse((await move)[0]);assert.equal(received.i,1);assert.equal(received.r,'presenter');assert(!('notes'in received));
  const messages=[];p.on('message',m=>messages.push(JSON.parse(m)));
  s.send(JSON.stringify({k:'pos',i:0,r:'presenter'}));s.send(JSON.stringify({type:'ping'}));await once(s,'message');assert.equal(messages.length,0);
  const ink=once(s,'message');p.send(JSON.stringify({k:'ink2',i:1,o:'p',s:'stroke1',p:[100,100,50,200,200,50],a:0,w:24,tl:'r',e:1}));assert.equal(JSON.parse((await ink)[0]).k,'ink2');
  p.close();s.close();await instance.close();
  instance=await createApp({dataDir,uploadKey:'upload-test'});await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${instance.server.address().port}`;
  assert.equal((await(await req('/api/library')).json()).versions.length,3);assert.equal((await access(screenKey)).status,200);
  assert.equal((await fetch(base+`/api/decks/${first.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${presenterKey}`}})).status,204);
  assert.equal((await access(screenKey)).status,404);assert(!(await readdir(dataDir)).includes(first.id+'.json'));
  assert.equal((await req('/api/thumbnails/'+first.id)).status,404);
 }finally{p?.terminate();s?.terminate();await instance.close();}
});
