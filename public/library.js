import { slideDocument, fitSlide, copyText } from './render.js';

const $ = id => document.getElementById(id);
const makeKey = () => 'slw_' + [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2,'0')).join('');
let workspaceKey = localStorage.getItem('slidelink-workspace') || makeKey();
const importedKey = new URLSearchParams(location.hash.slice(1)).get('workspace');
if (importedKey && /^slw_[A-Za-z0-9_-]{32,64}$/.test(importedKey)) { workspaceKey=importedKey; history.replaceState(null,'',location.pathname); }
localStorage.setItem('slidelink-workspace', workspaceKey);
let uploadKey = sessionStorage.getItem('slidelink-upload-key') || '';
let data = { folders: [], projects: [], versions: [] }, folderId = '', projectId = '', uploadProject = '', preview = null, previewIndex = 0, demoHtml = '';
let toastTimer, nameAction;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
async function request(url, body, method) {
  const res = await fetch(url, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Workspace-Key': workspaceKey, 'X-Upload-Key': uploadKey }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '请求失败，请重试。'); }
  return res.status === 204 ? null : res.json();
}
const date = t => new Intl.DateTimeFormat('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(t);
const element = (tag, className, text) => { const e = document.createElement(tag); if(className) e.className = className; if(text !== undefined) e.textContent = text; return e; };
function button(text, className, action) { const e = element('button', className, text); e.type = 'button'; e.onclick = () => Promise.resolve(action()).catch(e => toast(e.message)); return e; }
async function refresh() { data = await request('/api/library'); render(); }
function render() {
  $('total-count').textContent = data.projects.length;
  $('project-count').textContent = data.projects.length;
  $('version-count').textContent = data.versions.length;
  $('folders').replaceChildren();
  for (const f of data.folders) $('folders').append(button(`▱  ${f.name}`, `nav-item ${folderId === f.id ? 'selected' : ''}`, () => { folderId = f.id; projectId = ''; render(); }));
  $('all-projects').classList.toggle('selected', !folderId);
  $('library-view').hidden = !!projectId; $('project-view').hidden = !projectId;
  const folderName = data.folders.find(f=>f.id===folderId)?.name || '全部项目';
  $('breadcrumb').textContent = `工作空间 / ${folderName}`;
  $('list-title').textContent = folderName;
  $('folder-actions').hidden = !folderId;
  $('projects').replaceChildren();
  const projects = data.projects.filter(p => (!folderId || p.folderId === folderId) && p.name.toLowerCase().includes($('search').value.toLowerCase())).sort((a,b) => latest(b) - latest(a));
  for (const p of projects) {
    const versions = data.versions.filter(v=>v.projectId===p.id).sort((a,b)=>b.createdAt-a.createdAt);
    const card = button('', 'project-card', () => { projectId = p.id; render(); });
    const graphic = element('div','card-preview'), mini = element('div','mini-slide');
    mini.append(element('strong','',p.name), element('span','', `${versions[0]?.count || 0} SLIDES`)); graphic.append(mini);
    const body = element('div','card-body'), meta = element('p');
    meta.append(element('span','',`${versions.length} 个版本`),element('span','',date(latest(p))));
    body.append(element('h3','',p.name),meta); card.append(graphic,body); $('projects').append(card);
  }
  $('empty').hidden = projects.length > 0;
  if (projectId) renderProject();
}
function latest(p) { return Math.max(p.createdAt, ...data.versions.filter(v=>v.projectId===p.id).map(v=>v.createdAt)); }
function renderProject() {
  const p = data.projects.find(p=>p.id===projectId); if(!p) {projectId='';render();return;}
  $('project-name').textContent = p.name;
  $('breadcrumb').textContent = `工作空间 / ${p.name}`;
  const versions = data.versions.filter(v=>v.projectId===p.id).sort((a,b)=>b.createdAt-a.createdAt);
  $('project-meta').textContent = `${versions.length} 个版本 · 创建于 ${date(p.createdAt)}`;
  $('move-folder').replaceChildren(new Option('未分类', ''));
  for (const f of data.folders) $('move-folder').add(new Option(f.name, f.id));
  $('move-folder').value = p.folderId;
  $('versions').replaceChildren();
  if (!versions.length) $('versions').append(element('p','muted','还没有可用版本。上传新的 slides 开始演示。'));
  versions.forEach((v,i) => {
    const card = element('article','version-card'), info = element('div'), heading = element('h3','',v.label || '新版本');
    if(i===0) heading.append(element('span','badge','最新'));
    info.append(heading,element('p','',`${date(v.createdAt)} · ${v.count} 页${v.expiresAt < 8000000000000000 ? ` · 保留至 ${date(v.expiresAt)}` : ' · 持续保留'}`));
    const actions = element('div','version-actions');
    for (const [role,label] of [['screen','投屏'],['presenter','演讲者']]) {
      const link = element('a','secondary',`打开${label}`); link.href=v[role]; link.target='_blank'; link.rel='noopener noreferrer'; link.style.textDecoration='none';
      actions.append(link, button(`复制${label}链接`, 'secondary', async()=>toast(await copyText(new URL(v[role],location.origin).href) ? '链接已复制' : '复制失败，请打开页面后复制地址')));
    }
    actions.append(button('源文件','secondary',async()=>{
      for (const kind of ['slides','notes']) {
        const r=await fetch(`/api/sources/${v.id}/${kind}`,{headers:{'X-Workspace-Key':workspaceKey}});
        if(!r.ok) throw Error('源文件下载失败。');
        download(await r.blob(),kind==='slides'?'slides.html':'notes.txt');
      }
    }));
    actions.append(button('删除版本','secondary',async()=>{
      if(!confirm(`删除“${v.label}”？该版本的 slides、讲稿和两个链接都将失效。`)) return;
      const key=v.presenter.split('#')[1];
      const r=await fetch(`/api/decks/${v.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${key}`}});
      if(!r.ok) throw Error('删除失败。'); await refresh(); toast('版本已删除；服务器副本无法恢复，请保留源文件备份。');
    }));
    card.append(info,actions); $('versions').append(card);
  });
}
function download(blob,name) { const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000); }
function askName(title, initial, action) { $('name-title').textContent=title; $('name-input').value=initial; nameAction=action; $('name-dialog').showModal(); $('name-input').focus(); }
$('name-form').onsubmit=async e=>{e.preventDefault();try{await nameAction($('name-input').value);$('name-dialog').close();await refresh();}catch(e){toast(e.message);}};
$('new-folder').onclick=()=>askName('新建文件夹','',name=>request('/api/folders',{name}));
$('rename-folder').onclick=()=>askName('重命名文件夹',data.folders.find(f=>f.id===folderId).name,name=>request(`/api/folders/${folderId}`,{name},'PATCH'));
$('delete-folder').onclick=async()=>{if(!confirm('移除此文件夹？其中的项目会移到未分类，文件和版本会保留。'))return;try{await request(`/api/folders/${folderId}`,undefined,'DELETE');folderId='';await refresh();toast('文件夹已移除，所有项目和文件均保留。');}catch(e){toast(e.message);}};
$('rename-project').onclick=()=>askName('重命名项目',data.projects.find(p=>p.id===projectId).name,name=>request(`/api/projects/${projectId}`,{name},'PATCH'));
$('move-folder').onchange=async()=>{try{await request(`/api/projects/${projectId}`,{folderId:$('move-folder').value},'PATCH');await refresh();}catch(e){toast(e.message);}};
$('search').oninput=render;
$('all-projects').onclick=()=>{folderId='';projectId='';render();};
$('back').onclick=()=>{projectId='';render();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
function openUpload(id='') {
  uploadProject=id; preview=null; demoHtml=''; $('upload-form').reset(); $('canvas-width').value=1200; $('canvas-height').value=675;
  $('upload-title').textContent=id?'上传新版本':'新建演示项目'; $('title').value=data.projects.find(p=>p.id===id)?.name || '';
  $('html-file').required=true; $('preview').hidden=true; $('save-button').disabled=true; $('upload-error').textContent=''; $('upload-dialog').showModal();
}
$('new-project').onclick=()=>openUpload(); $('new-version').onclick=()=>openUpload(projectId);
function invalidate() { preview=null; $('save-button').disabled=true; $('preview').hidden=true; }
$('upload-form').addEventListener('input',e=>{if(e.target.id!=='preview-notes')invalidate();});
$('html-file').onchange=()=>{demoHtml='';invalidate();if(!$('title').value)$('title').value=$('html-file').files[0]?.name.replace(/\.html?$/i,'')||'';};
$('notes-file').onchange=async()=>{invalidate();const f=$('notes-file').files[0];if(f){if(f.size>1024*1024){$('upload-error').textContent='讲稿文件不能超过 1 MB。';return;}$('notes-text').value=await f.text();}};
async function payload() {
  const file=$('html-file').files[0];
  if(!file&&!demoHtml) throw Error('请选择 HTML 文件。');
  if(file?.size>6*1024*1024) throw Error('HTML 文件不能超过 6 MB。');
  return {html:demoHtml||await file.text(),notes:$('notes-text').value,title:$('title').value,width:Number($('canvas-width').value),height:Number($('canvas-height').value),versionLabel:$('version-label').value||'初稿',projectId:uploadProject||undefined,folderId};
}
let checkedPayload;
$('preview-button').onclick=async()=>{
  $('preview-button').disabled=true;$('upload-error').textContent='';
  try{
    checkedPayload=await payload();preview=await request('/api/preview',checkedPayload);previewIndex=0;
    $('preview').hidden=false;$('preview-count').textContent=`已匹配 ${preview.count} 页 slides 与讲稿`;
    $('warnings').replaceChildren(...preview.warnings.map(w=>element('li','',w)));
    drawPreview();$('save-button').disabled=false;
  }catch(e){$('upload-error').textContent=e.message;}finally{$('preview-button').disabled=false;}
};
function drawPreview(){
  if(!preview)return;
  // A fresh frame also resets browsers that suspend a frame inside a closed dialog.
  const frame=$('preview-frame').cloneNode(false);
  frame.srcdoc=slideDocument(preview,previewIndex);
  $('preview-frame').replaceWith(frame);
  $('preview-notes').value=preview.notes[previewIndex]||'';
  $('preview-index').textContent=`${previewIndex+1} / ${preview.count}`;
  $('preview-prev').disabled=previewIndex===0;$('preview-next').disabled=previewIndex===preview.count-1;
  fitSlide($('preview-box'),$('preview-stage'),preview);
}
$('preview-notes').oninput=()=>{
  if(!preview)return;
  preview.notes[previewIndex]=$('preview-notes').value;
  checkedPayload.notesPages=[...preview.notes];
  $('notes-text').value=preview.notes.join('\n\n---\n\n');
};
new ResizeObserver(()=>{if(preview)fitSlide($('preview-box'),$('preview-stage'),preview);}).observe($('preview-stage'));
$('preview-prev').onclick=()=>{previewIndex--;drawPreview();};$('preview-next').onclick=()=>{previewIndex++;drawPreview();};
$('upload-form').onsubmit=async e=>{
  e.preventDefault();if(!preview)return;$('save-button').disabled=true;
  try{const result=await request('/api/decks',checkedPayload);projectId=result.projectId;$('upload-dialog').close();await refresh();toast('版本已保存。两个链接可以随时从项目中打开。');}
  catch(e){$('upload-error').textContent=e.message;$('save-button').disabled=false;}
};
$('demo').onclick=async()=>{
  openUpload();
  try{demoHtml=await (await fetch('/examples/demo.html')).text();$('notes-text').value=await (await fetch('/examples/notes.txt')).text();$('title').value='从容开场 · SlideLink 使用演示';$('html-file').required=false;$('preview-button').click();}catch(e){$('upload-error').textContent=e.message;}
};
$('workspace-settings').onclick=()=>{$('workspace-key').value=workspaceKey;$('upload-key').value=uploadKey;$('settings-message').textContent='';$('settings-dialog').showModal();};
$('upload-key').oninput=()=>{uploadKey=$('upload-key').value;sessionStorage.setItem('slidelink-upload-key',uploadKey);};
$('copy-workspace').onclick=async()=>{$('settings-message').textContent=await copyText(workspaceKey)?'当前工作空间密钥已复制，请保存在密码管理器中。':'复制失败，请从输入框手动复制。';};
$('open-workspace').onclick=async()=>{
  const key=$('workspace-key').value.trim();if(!/^slw_[A-Za-z0-9_-]{32,64}$/.test(key)){$('settings-message').textContent='密钥格式不正确。';return;}
  workspaceKey=key;localStorage.setItem('slidelink-workspace',key);projectId='';folderId='';
  try{await refresh();$('settings-dialog').close();toast('已打开工作空间');}catch(e){$('settings-message').textContent=e.message;}
};
$('create-workspace').onclick=async()=>{
  download(new Blob([workspaceKey],{type:'text/plain'}),'slidelink-workspace-key.txt');
  workspaceKey=makeKey();localStorage.setItem('slidelink-workspace',workspaceKey);$('workspace-key').value=workspaceKey;projectId='';folderId='';
  await refresh();$('settings-message').textContent='已创建空白工作空间，并下载上一工作空间的密钥备份。';
};
try{
  const config=await request('/api/config');$('upload-key-label').hidden=!config.uploadKeyRequired;
  $('retention').textContent=config.retentionDays?`文件保存 ${config.retentionDays} 天。请保留原始文件；工作空间密钥可在设置中备份。`:'文件持续保留，直到你主动删除。请保留原始文件，并在设置中备份工作空间密钥。';
  await refresh();
  if(config.uploadKeyRequired&&!uploadKey)toast('上传前，请在工作空间设置中填写网站提供的上传口令。');
}catch(e){toast(e.message);}
