import { slideDocument, fitSlide, copyText } from './render.js';
import { t, locale, initLanguage } from './i18n.js';
initLanguage();

const $ = id => document.getElementById(id);
const makeKey = () => 'slw_' + [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2,'0')).join('');
let workspaceKey = localStorage.getItem('slidelink-workspace') || makeKey();
const importedKey = new URLSearchParams(location.hash.slice(1)).get('workspace');
if (importedKey && /^slw_[A-Za-z0-9_-]{32,64}$/.test(importedKey)) { workspaceKey=importedKey; history.replaceState(null,'',location.pathname); }
localStorage.setItem('slidelink-workspace', workspaceKey);
let uploadKey = sessionStorage.getItem('slidelink-upload-key') || '';
let data = { folders: [], projects: [], versions: [] }, folderId = '', projectId = '', uploadProject = '', preview = null, previewIndex = 0, demoHtml = '';
let toastTimer, nameAction, config = {};
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
async function request(url, body, method) {
  const res = await fetch(url, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Workspace-Key': workspaceKey, 'X-Upload-Key': uploadKey }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(t(e.error) || t("Request failed. Please try again.")); }
  return res.status === 204 ? null : res.json();
}
const date = t => new Intl.DateTimeFormat(locale(), { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(t);
const slideCount = count => t(count === 1 ? '1 slide' : '{count} slides', {count});
const versionCount = count => t(count === 1 ? '1 version' : '{count} versions', {count});
const element = (tag, className, text) => { const e = document.createElement(tag); if(className) e.className = className; if(text !== undefined) e.textContent = text; return e; };
function button(text, className, action) { const e = element('button', className, text); e.type = 'button'; e.onclick = () => Promise.resolve(action()).catch(e => toast(e.message)); return e; }
async function refresh() { data = await request('/api/library'); render(); }
function render() {
  $('total-count').textContent = data.projects.length;
  $('folders').replaceChildren();
  for (const f of data.folders) $('folders').append(button(f.name, `nav-item ${folderId === f.id ? 'selected' : ''}`, () => { folderId = f.id; projectId = ''; render(); }));
  $('all-projects').classList.toggle('selected', !folderId);
  $('library-view').hidden = !!projectId; $('project-view').hidden = !projectId;
  const folderName = data.folders.find(f=>f.id===folderId)?.name || t("All projects");
  $('breadcrumb').textContent = folderName;
  $('new-project').hidden = !!projectId;
  $('folder-actions').hidden = !folderId;
  thumbnailVisibility.disconnect();
  thumbnailResize.disconnect();
  $('projects').replaceChildren();
  const projects = data.projects.filter(p => (!folderId || p.folderId === folderId) && p.name.toLowerCase().includes($('search').value.toLowerCase())).sort((a,b) => latest(b) - latest(a));
  for (const p of projects) {
    const versions = data.versions.filter(v=>v.projectId===p.id).sort((a,b)=>b.createdAt-a.createdAt);
    const card = button('', 'project-card', () => { projectId = p.id; render(); });
    card.setAttribute('aria-label', p.name);
    const cover = thumbnail(versions[0]);
    const name = element('div','project-info');
    name.append(element('div','project-name',p.name), element('div','project-pages', slideCount(versions[0]?.count || 0)));
    name.append(element('span','project-version',versionCount(versions.length)),element('span','project-date',date(latest(p))));
    card.append(cover,name);
    $('projects').append(card);
  }
  $('empty').hidden = projects.length > 0;
  $('empty-text').textContent = $('search').value ? t("No matching projects") : t("No projects yet");
  $('demo').hidden = !!$('search').value;
  if (projectId) renderProject();
}
function latest(p) { return Math.max(p.createdAt, ...data.versions.filter(v=>v.projectId===p.id).map(v=>v.createdAt)); }
function renderProject() {
  const p = data.projects.find(p=>p.id===projectId); if(!p) {projectId='';render();return;}
  $('project-name').textContent = p.name;
  $('breadcrumb').textContent = data.folders.find(f=>f.id===p.folderId)?.name || t("All projects");
  const versions = data.versions.filter(v=>v.projectId===p.id).sort((a,b)=>b.createdAt-a.createdAt);
  $('project-meta').textContent = t('{versions} · Created {date}', {versions: versionCount(versions.length), date: date(p.createdAt)});
  $('move-folder').replaceChildren(new Option(t("Unfiled"), ''));
  for (const f of data.folders) $('move-folder').add(new Option(f.name, f.id));
  $('move-folder').value = p.folderId;
  $('versions').replaceChildren();
  if (!versions.length) $('versions').append(element('p','muted',t('No versions yet. Upload slides to start.')));
  versions.forEach((v,i) => {
    const card = element('article','version-card'), info = element('div'), heading = element('h3','',v.label || t("New version"));
    if(i===0) heading.append(element('span','badge',t("Latest")));
    info.append(heading,element('p','',`${date(v.createdAt)} · ${slideCount(v.count)}${v.expiresAt < 8000000000000000 ? ' · '+t('Retained until {date}', {date: date(v.expiresAt)}) : ''}`));
    const actions = element('div','version-actions');
    const menu = element('details','action-menu'), summary = element('summary','','⋯'), items = element('div','menu-items');
    summary.setAttribute('aria-label',t("More version actions"));menu.append(summary,items);
    for (const role of ['screen','presenter']) {
      const link = element('a','secondary',t(role === 'screen' ? 'Open screen' : 'Open presenter')); link.href=v[role]; link.target='_blank'; link.rel='noopener noreferrer'; link.style.textDecoration='none';
      actions.append(link);
      items.append(button(t(role === 'screen' ? 'Copy screen link' : 'Copy presenter link'), '', async()=>{menu.open=false;toast(await copyText(new URL(v[role],location.origin).href) ? t("Link copied") : t('Could not copy. Open the page and copy its address.'));}));
    }
    items.append(button(t("Download source files"),'',async()=>{
      menu.open=false;
      for (const kind of ['slides','notes']) {
        const r=await fetch(`/api/sources/${v.id}/${kind}`,{headers:{'X-Workspace-Key':workspaceKey}});
        if(!r.ok) throw Error(t("Source download failed."));
        download(await r.blob(),kind==='slides'?'slides.html':'notes.txt');
      }
    }));
    items.append(button(t("Delete version"),'',async()=>{
      menu.open=false;
      if(!confirm(t('Delete “{label}”? Its slides, notes and both links will stop working.', {label: v.label}))) return;
      const key=v.presenter.split('#')[1];
      const r=await fetch(`/api/decks/${v.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${key}`}});
      if(!r.ok) throw Error(t("Delete failed.")); await refresh(); toast(t("Version deleted permanently. Keep your source file backups."));
    }));
    actions.append(menu);card.append(info,actions); $('versions').append(card);
  });
}
function download(blob,name) { const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000); }
function askName(title, initial, action) { $('name-title').textContent=title; $('name-input').value=initial; nameAction=action; $('name-dialog').showModal(); $('name-input').focus(); }
$('name-form').onsubmit=async e=>{e.preventDefault();try{await nameAction($('name-input').value);$('name-dialog').close();await refresh();}catch(e){toast(e.message);}};
$('new-folder').onclick=()=>askName(t("New folder"),'',name=>request('/api/folders',{name}));
$('rename-folder').onclick=()=>askName(t("Rename folder"),data.folders.find(f=>f.id===folderId).name,name=>request(`/api/folders/${folderId}`,{name},'PATCH'));
$('delete-folder').onclick=async()=>{if(!confirm(t("Remove this folder? Projects will move to Unfiled. Files and versions will be kept.")))return;try{await request(`/api/folders/${folderId}`,undefined,'DELETE');folderId='';await refresh();toast(t("Folder removed. All projects and files kept."));}catch(e){toast(e.message);}};
$('rename-project').onclick=()=>askName(t("Rename project"),data.projects.find(p=>p.id===projectId).name,name=>request(`/api/projects/${projectId}`,{name},'PATCH'));
$('move-folder').onchange=async()=>{try{await request(`/api/projects/${projectId}`,{folderId:$('move-folder').value},'PATCH');await refresh();}catch(e){toast(e.message);}};
$('search').oninput=render;
$('all-projects').onclick=()=>{folderId='';projectId='';render();};
$('back').onclick=()=>{projectId='';render();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
function openUpload(id='') {
  uploadProject=id; preview=null; demoHtml=''; $('upload-form').reset(); $('canvas-width').value=1200; $('canvas-height').value=675;
  $('upload-title').textContent=id?t("Upload version"):t("New project"); $('title').value=data.projects.find(p=>p.id===id)?.name || '';
  $('html-file').required=true; $('preview').hidden=true; $('save-button').disabled=true; $('upload-error').textContent=''; $('upload-dialog').showModal();
}
$('new-project').onclick=()=>openUpload(); $('new-version').onclick=()=>openUpload(projectId);
function invalidate() { preview=null; $('save-button').disabled=true; $('preview').hidden=true; }
$('upload-form').addEventListener('input',e=>{if(e.target.id!=='preview-notes')invalidate();});
$('html-file').onchange=()=>{demoHtml='';invalidate();if(!$('title').value)$('title').value=$('html-file').files[0]?.name.replace(/\.html?$/i,'')||'';};
$('notes-file').onchange=async()=>{invalidate();const f=$('notes-file').files[0];if(f){if(f.size>1024*1024){$('upload-error').textContent=t("Notes files must be under 1 MB.");return;}$('notes-text').value=await f.text();}};
async function payload() {
  const file=$('html-file').files[0];
  if(!file&&!demoHtml) throw Error(t("Choose an HTML file."));
  if(file?.size>6*1024*1024) throw Error(t("HTML files must be under 6 MB."));
  return {html:demoHtml||await file.text(),notes:$('notes-text').value,title:$('title').value,width:Number($('canvas-width').value),height:Number($('canvas-height').value),versionLabel:$('version-label').value||t("Initial version"),projectId:uploadProject||undefined,folderId};
}
let checkedPayload;
$('preview-button').onclick=async()=>{
  $('preview-button').disabled=true;$('upload-error').textContent='';
  try{
    checkedPayload=await payload();preview=await request('/api/preview',checkedPayload);previewIndex=0;
    $('preview').hidden=false;$('preview-count').textContent=t('{count} slides · Notes are editable', {count: preview.count});
    $('warnings').replaceChildren(...preview.warnings.map(w=>element('li','',t(w))));
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
  try{const result=await request('/api/decks',checkedPayload);projectId=result.projectId;$('upload-dialog').close();await refresh();toast(t("Saved"));}
  catch(e){$('upload-error').textContent=e.message;$('save-button').disabled=false;}
};
$('demo').onclick=async()=>{
  openUpload();
  try{demoHtml=await (await fetch('/examples/demo.html')).text();$('notes-text').value=await (await fetch('/examples/notes.txt')).text();$('title').value=t("Sample presentation");$('html-file').required=false;$('preview-button').click();}catch(e){$('upload-error').textContent=e.message;}
};
$('workspace-settings').onclick=()=>{$('workspace-key').value=workspaceKey;$('upload-key').value=uploadKey;$('settings-message').textContent='';$('settings-dialog').showModal();};
$('upload-key').oninput=()=>{uploadKey=$('upload-key').value;sessionStorage.setItem('slidelink-upload-key',uploadKey);};
$('copy-workspace').onclick=async()=>{$('settings-message').textContent=await copyText(workspaceKey)?t('Key copied. Store it in your password manager.'):t("Could not copy. Copy the key from the input.");};
$('open-workspace').onclick=async()=>{
  const key=$('workspace-key').value.trim();if(!/^slw_[A-Za-z0-9_-]{32,64}$/.test(key)){$('settings-message').textContent=t("Invalid key format.");return;}
  workspaceKey=key;localStorage.setItem('slidelink-workspace',key);projectId='';folderId='';
  try{await refresh();$('settings-dialog').close();toast(t("Workspace opened"));}catch(e){$('settings-message').textContent=e.message;}
};
$('create-workspace').onclick=async()=>{
  download(new Blob([workspaceKey],{type:'text/plain'}),'slidelink-workspace-key.txt');
  workspaceKey=makeKey();localStorage.setItem('slidelink-workspace',workspaceKey);$('workspace-key').value=workspaceKey;projectId='';folderId='';
  await refresh();$('settings-message').textContent=t("New workspace created. The previous key was downloaded as a backup.");
};


// Fetch only visible covers; immutable version IDs make the cache safe.
const thumbnailCache = new Map();
const thumbnailQueue = [];
let thumbnailActive = 0;
function fetchThumbnail(id) {
  if (!thumbnailCache.has(id)) thumbnailCache.set(id, new Promise((resolve, reject) => {
    thumbnailQueue.push({ id, resolve, reject }); drainThumbnails();
  }));
  return thumbnailCache.get(id);
}
function drainThumbnails() {
  while (thumbnailActive < 4 && thumbnailQueue.length) {
    const { id, resolve, reject } = thumbnailQueue.shift(); thumbnailActive++;
    request('/api/thumbnails/' + id).then(resolve, error => {
      thumbnailCache.delete(id); reject(error);
    }).finally(() => { thumbnailActive--; drainThumbnails(); });
  }
}
const thumbnailResize = new ResizeObserver(entries => {
  for (const {target} of entries) if(target.deck) fitSlide(target.firstElementChild, target, target.deck);
});
const thumbnailVisibility = new IntersectionObserver(entries => {
  for (const {target, isIntersecting} of entries) {
    if (!isIntersecting) continue;
    thumbnailVisibility.unobserve(target);
    fetchThumbnail(target.dataset.version).then(deck => {
      if (!target.isConnected) return;
      const box = element('span','slide-box');
      const frame = element('iframe');
      frame.setAttribute('sandbox',''); frame.setAttribute('referrerpolicy','no-referrer');
      frame.tabIndex = -1; frame.title = t('Slide preview'); frame.setAttribute('aria-hidden','true');
      frame.srcdoc = slideDocument(deck,0);
      box.append(frame); target.replaceChildren(box);
      target.deck = deck; target.dataset.loaded = 'true'; target.style.aspectRatio = deck.width + '/' + deck.height;
      thumbnailResize.observe(target); fitSlide(box,target,deck);
    }).catch(() => { if(target.isConnected) target.textContent = t('Preview unavailable'); });
  }
}, { rootMargin: '200px' });
function thumbnail(version) {
  const cover = element('span','project-cover',version ? '' : t('No slides'));
  cover.setAttribute('aria-hidden','true');
  if(version) { cover.dataset.version = version.id; thumbnailVisibility.observe(cover); }
  return cover;
}
document.addEventListener('languagechange', () => {
  render();
  $('upload-title').textContent = t(uploadProject ? 'Upload version' : 'New project');
  if(preview) {
    $('preview-count').textContent = t('{count} slides · Notes are editable', {count:preview.count});
    $('warnings').replaceChildren(...preview.warnings.map(w=>element('li','',t(w))));
  }
  $('retention').textContent = config.retentionDays
    ? t('Files are retained for {days} days. Keep source files and back up your workspace key.', {days:config.retentionDays})
    : t('Files are kept until deleted. Keep source files and back up your workspace key.');
});

try{
  config=await request('/api/config');$('upload-key-label').hidden=!config.uploadKeyRequired;
  $('retention').textContent=config.retentionDays?t('Files are retained for {days} days. Keep source files and back up your workspace key.', {days: config.retentionDays}):t('Files are kept until deleted. Keep source files and back up your workspace key.');
  await refresh();
  if(config.uploadKeyRequired&&!uploadKey)toast(t('Enter the site upload passcode in Settings before uploading.'));
}catch(e){toast(e.message);}
