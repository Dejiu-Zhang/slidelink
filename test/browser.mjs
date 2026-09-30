import { chromium, webkit } from 'playwright';
import { createApp } from '../server.js';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dataDir=await mkdtemp(path.join(tmpdir(),'slidelink-browser-'));
const app=await createApp({dataDir,uploadKey:''});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await (process.env.TEST_WEBKIT?webkit:chromium).launch(process.env.TEST_CHROME?{channel:'chrome',headless:true}:{headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base);await page.getByRole('button',{name:'新建文件夹',exact:true}).click();await page.getByRole('textbox',{name:'名称',exact:true}).fill('学术汇报');await page.locator('#name-form').getByRole('button',{name:'保存',exact:true}).click();await page.locator('#name-dialog').waitFor({state:'hidden'});
 await page.locator('#folders button').click();await page.getByRole('button',{name:'先体验一个示例 →'}).click();await page.locator('#save-button:not([disabled])').waitFor();
 await page.locator('#preview-notes').fill('上传时编辑的私人讲稿。');
 await page.locator('#save-button').click();await page.locator('#project-view:not([hidden])').waitFor();
 let rows=page.locator('.version-card');assert.equal(await rows.count(),1);
 const screenLink=await rows.first().getByRole('link',{name:'打开投屏',exact:true}).getAttribute('href');const presenterLink=await rows.first().getByRole('link',{name:'打开演讲者',exact:true}).getAttribute('href');
 await page.getByRole('button',{name:'＋ 上传新版本'}).click();await page.locator('#html-file').setInputFiles('public/examples/demo.html');await page.locator('#notes-file').setInputFiles('public/examples/notes.txt');await page.locator('#version-label').fill('修改稿');await page.locator('#preview-button').click();await page.locator('#save-button:not([disabled])').waitFor();await page.locator('#save-button').click();await page.waitForFunction(()=>document.querySelectorAll('.version-card').length===2);
 const screenContext=await browser.newContext({viewport:{width:1440,height:900}}), presenterContext=await browser.newContext({viewport:{width:1194,height:834},hasTouch:true});
 const screen=await screenContext.newPage(),presenter=await presenterContext.newPage();
 for(const p of [screen,presenter])p.on('pageerror',e=>errors.push(e.message));
 await screen.goto(base+screenLink);await presenter.goto(base+presenterLink);
 await presenter.locator('#fatal').waitFor({state:'hidden'});await screen.locator('#fatal').waitFor({state:'hidden'});
 await presenter.waitForFunction(()=>window.SlideLink?.link?.status().startsWith('Screen linked'));
 assert.equal(await presenter.locator('#notes-text').textContent(),'上传时编辑的私人讲稿。');
 assert.equal(await screen.locator('#notes-pane').count(),0);
 await presenter.locator('#next').click();await screen.waitForFunction(()=>window.SlideLink.link.state().slide===1);
 const box=await presenter.locator('.ink-page:not([hidden])').boundingBox();
 async function pen(p,target,points){await p.locator(target).dispatchEvent('pointerdown',{pointerId:21,pointerType:'pen',isPrimary:true,pressure:.6,clientX:points[0][0],clientY:points[0][1],buttons:1});for(const [x,y]of points.slice(1))await p.locator(target).dispatchEvent('pointermove',{pointerId:21,pointerType:'pen',isPrimary:true,pressure:.6,clientX:x,clientY:y,buttons:1});await p.locator(target).dispatchEvent('pointerup',{pointerId:21,pointerType:'pen',isPrimary:true,clientX:points.at(-1)[0],clientY:points.at(-1)[1]});}
 await pen(presenter,'.ink-page:not([hidden])',[[box.x+100,box.y+100],[box.x+180,box.y+140],[box.x+240,box.y+100]]);
 await screen.waitForFunction(()=>document.querySelector('.ink-page:not([hidden]) .sl-ink path')?.getAttribute('d')?.length>10);
 const firstPath=await screen.locator('.ink-page:not([hidden]) .sl-ink path').getAttribute('d');
 await presenter.locator('#private-pen').click();const nb=await presenter.locator('#notes-ink').boundingBox();await pen(presenter,'#notes-ink',[[nb.x+40,nb.y+70],[nb.x+220,nb.y+70]]);assert.equal(await presenter.locator('#notes-ink polyline').count(),1);assert.equal(await screen.locator('.ink-page:not([hidden]) .sl-ink path').count(),1);
 await presenter.locator('#private-pen').click();
 // Force a genuine network interruption: separate browser contexts cannot use BroadcastChannel.
 await presenterContext.setOffline(true);await presenter.waitForFunction(()=>!window.SlideLink.link.state().relays[0].up);await presenter.locator('#next').click();await presenterContext.setOffline(false);await screen.waitForFunction(()=>window.SlideLink.link.state().slide===2);
 await presenter.locator('#previous').click();await screen.waitForFunction(()=>window.SlideLink.link.state().slide===1);
 await screen.reload();await screen.waitForFunction(()=>document.querySelector('.ink-page:not([hidden]) .sl-ink path')?.getAttribute('d')?.length>10);assert.equal(await screen.locator('.ink-page:not([hidden]) .sl-ink path').getAttribute('d'),firstPath);
 await presenter.reload();await presenter.locator('#fatal').waitFor({state:'hidden'});assert.equal(await presenter.locator('#notes-ink polyline').count(),1);
 await presenter.locator('#edit-notes').click();await presenter.locator('#notes-editor').fill('演讲中修改的讲稿，不应发给观众。');await presenter.locator('#save-notes').click();await presenter.locator('#saved-links:not([hidden])').waitFor();
 const revisedLink=await presenter.locator('#saved-links a').first().getAttribute('href');
 const revisedRoom=new URL(base+revisedLink).searchParams.get('room');assert.notEqual(revisedRoom,new URL(base+presenterLink).searchParams.get('room'));
 const saved=await context.request.get(`${base}/api/decks/${revisedRoom}`,{headers:{Authorization:`Bearer ${revisedLink.split('#')[1]}`}});assert.equal((await saved.json()).notes[1],'演讲中修改的讲稿，不应发给观众。');
 assert.equal(await screen.locator('body').textContent().then(s=>s.includes('演讲中修改')),false);
 await presenter.locator('#edit-notes').click();
 await mkdir('test-results',{recursive:true});await presenter.screenshot({path:'test-results/presenter.png'});
 await page.locator('#back').click();await page.screenshot({path:'test-results/library.png',fullPage:true});
 if(process.env.ORIGINAL_HTML){await page.locator('#new-project').click();await page.locator('#title').fill('Super Learning · compatibility test');await page.locator('#html-file').setInputFiles(process.env.ORIGINAL_HTML);await page.locator('#preview-button').click();await page.locator('#save-button:not([disabled])').waitFor();assert((await page.locator('#preview-count').textContent()).includes('43'));await page.frameLocator('#preview-frame').locator('.slidelink-page h1').waitFor({state:'visible'});await page.screenshot({path:'test-results/original-preview.png'});}
 assert.deepEqual(errors,[]);
 console.log('PASS: folders, project/version upload, isolated browser sync, ink, private notes, reconnect, reload, and screenshots.');
} finally {await browser.close();await app.close();}
