// Import downloaded slide/presenter pages; real contents stay in the ignored data directory.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>{if(v.startsWith('--'))a.push([v.slice(2),all[i+1]]);return a;},[]));
if(!args.slides||!args.presenter)throw Error('Usage: node scripts/import-existing.mjs --slides slides.html --presenter presenter.html [--base http://127.0.0.1:3000] [--workspace slw_...]');
const base=args.base||'http://127.0.0.1:3000';
const workspace=args.workspace||`slw_${randomBytes(24).toString('hex')}`;
const headers={'Content-Type':'application/json','X-Workspace-Key':workspace,'X-Upload-Key':process.env.UPLOAD_KEY||''};
async function request(url,body){const res=await fetch(base+url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw Error(data.error||'Import failed');return data;}
const html=await readFile(args.slides,'utf8'),presenter=await readFile(args.presenter,'utf8');
const dom=new JSDOM(presenter);
const articles=[...dom.window.document.querySelectorAll('.pv-script')].sort((a,b)=>Number(a.dataset.i)-Number(b.dataset.i));
if(!articles.length)throw Error('No .pv-script pages found in presenter HTML.');
const notesPages=articles.map((article,index)=>{
 if(Number(article.dataset.i)!==index)throw Error('Presenter page indices are not contiguous.');
 article.querySelectorAll('script,style').forEach(el=>el.remove());
 article.querySelectorAll('p,li,h1,h2,h3,br').forEach(el=>el.after(dom.window.document.createTextNode('\n\n')));
 return article.textContent.trim();
});
const title=dom.window.document.title.replace(/\s*[·|—]\s*presenter.*$/i,'').trim();dom.window.close();
const existing=await request('/api/library');
const folder=existing.folders.find(f=>f.name===(args.folder||'Super Learning'))||await request('/api/folders',{name:args.folder||'Super Learning'});
const project=existing.projects.find(p=>p.name===title&&p.folderId===folder.id);
const payload={html,notesPages,title,width:1200,height:675,folderId:folder.id,projectId:project?.id,versionLabel:args.label||'最新网页导入'};
const preview=await request('/api/preview',payload);
const result=await request('/api/decks',payload);
console.log(JSON.stringify({folder:folder.name,title,pages:preview.count,workspace,library:`${base}/#workspace=${workspace}`,screen:base+result.screen,presenter:base+result.presenter,id:result.id,projectId:result.projectId},null,2));
