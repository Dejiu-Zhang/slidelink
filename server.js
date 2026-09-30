import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { importDeck } from './lib/import.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(24).toString('base64url');
const hash = s => createHash('sha256').update(s).digest('hex');
const matches = (value, digest) => typeof value === 'string' && typeof digest === 'string' && timingSafeEqual(Buffer.from(hash(value)), Buffer.from(digest));
const numberEnv = (value, fallback, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;

export async function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(root, 'data'));
  const uploadKey = options.uploadKey ?? process.env.UPLOAD_KEY ?? '';
  const publicOrigin = (options.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? '').replace(/\/$/, '');
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN must be an origin without a path.');
  if (process.env.NODE_ENV === 'production' && (!uploadKey || !publicOrigin.startsWith('https://'))) throw new Error('Production requires UPLOAD_KEY and an HTTPS PUBLIC_ORIGIN.');
  const retention = numberEnv(process.env.RETENTION_DAYS, 0, 0, 365) * 86400000;
  const maxDecks = numberEnv(process.env.MAX_DECKS, 100, 1, 10000);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const decks = new Map();
  const libraryFile = path.join(dataDir, 'library.json');
  let library = { projects: [], folders: [] };
  try { library = JSON.parse(await readFile(libraryFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let saves = Promise.resolve();
  function saveLibrary() {
    const snapshot = JSON.stringify(library);
    saves = saves.catch(() => {}).then(async () => {
      const { rename } = await import('node:fs/promises');
      await writeFile(`${libraryFile}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${libraryFile}.tmp`, libraryFile);
    });
    return saves;
  }
  for (const file of await readdir(dataDir)) {
    if (!/^[A-Za-z0-9_-]{16}\.json$/.test(file)) continue;
    const saved = JSON.parse(await readFile(path.join(dataDir, file), 'utf8'));
    if (saved.expiresAt <= Date.now()) await unlink(path.join(dataDir, file));
    else decks.set(file.slice(0, -5), saved);
  }
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' ws: wss:; frame-src 'self' about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    const expected = publicOrigin || `${req.protocol}://${req.get('host')}`;
    if (req.headers.origin && req.headers.origin !== expected) return res.status(403).json({ error: 'Origin not allowed.' });
    next();
  });
  const limits = new Map();
  function limit(req, res, next) {
    const key = req.socket.remoteAddress;
    const now = Date.now();
    let b = limits.get(key);
    if (!b || now - b.at > 60000) { b = { at: now, n: 0 }; limits.set(key, b); }
    if (++b.n > 30) return res.status(429).json({ error: '上传过于频繁，请一分钟后再试。' });
    next();
  }
  function uploader(req, res, next) {
    if (uploadKey && !matches(req.headers['x-upload-key'], hash(uploadKey))) return res.status(401).json({ error: '请输入正确的上传口令。' });
    next();
  }
  function workspace(req, res, next) {
    const key = req.headers['x-workspace-key'];
    if (typeof key !== 'string' || !/^slw_[A-Za-z0-9_-]{32,64}$/.test(key)) return res.status(401).json({ error: '请先创建或打开工作空间。' });
    req.owner = hash(key);
    next();
  }
  const json = express.json({ limit: '8mb', type: 'application/json' });
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/api/config', (req, res) => res.json({ uploadKeyRequired: !!uploadKey, retentionDays: retention / 86400000 }));
  app.get('/api/library', workspace, (req, res) => {
    const versions = [...decks.entries()].filter(([, d]) => d.owner === req.owner && d.expiresAt > Date.now()).map(([id, d]) => ({ id, projectId: d.projectId, title: d.title, createdAt: d.createdAt, expiresAt: d.expiresAt, count: d.slides.length, label: d.versionLabel, screen: d.links.screen, presenter: d.links.presenter }));
    res.json({ folders: library.folders.filter(f => f.owner === req.owner).map(({ owner, ...f }) => f), projects: library.projects.filter(p => p.owner === req.owner).map(({ owner, ...p }) => p), versions });
  });
  app.post('/api/folders', limit, uploader, workspace, json, async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: '请输入文件夹名称。' });
    if (library.folders.filter(f => f.owner === req.owner).length >= 100) return res.status(400).json({ error: '每个工作空间最多 100 个文件夹。' });
    const folder = { id: randomBytes(8).toString('hex'), name, owner: req.owner };
    library.folders.push(folder); await saveLibrary(); res.status(201).json({ id: folder.id, name });
  });
  app.patch('/api/folders/:id', workspace, json, async (req, res) => {
    const folder = library.folders.find(f => f.id === req.params.id && f.owner === req.owner);
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!folder) return res.status(404).json({ error: '文件夹不存在。' });
    if (!name) return res.status(400).json({ error: '请输入名称。' });
    folder.name = name; await saveLibrary(); res.json({ ok: true });
  });
  app.delete('/api/folders/:id', workspace, async (req, res) => {
    const folder = library.folders.find(f => f.id === req.params.id && f.owner === req.owner);
    if (!folder) return res.status(404).json({ error: '文件夹不存在。' });
    for (const p of library.projects) if (p.folderId === folder.id && p.owner === req.owner) p.folderId = '';
    library.folders = library.folders.filter(f => f !== folder);
    await saveLibrary(); res.status(204).end();
  });
  app.patch('/api/projects/:id', workspace, json, async (req, res) => {
    const project = library.projects.find(p => p.id === req.params.id && p.owner === req.owner);
    if (!project) return res.status(404).json({ error: '项目不存在。' });
    if (req.body?.folderId !== undefined) {
      if (req.body.folderId !== '' && !library.folders.some(f => f.id === req.body.folderId && f.owner === req.owner)) return res.status(400).json({ error: '文件夹不存在。' });
      project.folderId = req.body.folderId;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) project.name = req.body.name.trim().slice(0, 150);
    await saveLibrary(); res.json({ ok: true });
  });
  app.post('/api/preview', limit, uploader, json, (req, res) => {
    try {
      const deck = importDeck(req.body || {});
      res.json({ ...deck, count: deck.slides.length });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/decks', limit, uploader, workspace, json, async (req, res) => {
    try {
      if (decks.size >= maxDecks) return res.status(507).json({ error: '演示存储已满，请删除旧演示后重试。' });
      const deck = importDeck(req.body || {});
      let project;
      if (req.body.projectId) {
        project = library.projects.find(p => p.id === req.body.projectId && p.owner === req.owner);
        if (!project) return res.status(404).json({ error: '项目不存在。' });
      } else {
        const folderId = req.body.folderId || '';
        if (folderId && !library.folders.some(f => f.id === folderId && f.owner === req.owner)) return res.status(400).json({ error: '文件夹不存在。' });
        project = { id: randomBytes(8).toString('hex'), owner: req.owner, name: deck.title, folderId, createdAt: Date.now() };
      }
      const id = randomBytes(12).toString('base64url');
      const presenterKey = token(), screenKey = token();
      const links = { screen: `/screen.html?room=${id}#${screenKey}`, presenter: `/presenter.html?room=${id}#${presenterKey}` };
      const saved = { ...deck, owner: req.owner, projectId: project.id, versionLabel: String(req.body.versionLabel || '新版本').slice(0, 100), links, originalHtml: req.body.html, originalNotes: deck.notes.join('\n\n---\n\n'), presenterHash: hash(presenterKey), screenHash: hash(screenKey), createdAt: Date.now(), expiresAt: retention ? Date.now() + retention : 8640000000000000 };
      // Reserve the slot before awaiting I/O; no concurrent request can exceed MAX_DECKS.
      decks.set(id, saved);
      try { await writeFile(path.join(dataDir, `${id}.json`), JSON.stringify(saved), { flag: 'wx', mode: 0o600 }); }
      catch (error) { decks.delete(id); throw error; }
      if (!library.projects.some(p => p.id === project.id)) { library.projects.push(project); await saveLibrary(); }
      res.status(201).json({ id, projectId: project.id, ...links, expiresAt: saved.expiresAt });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  function authorize(id, key) {
    const deck = decks.get(id);
    if (!deck || deck.expiresAt <= Date.now()) return null;
    if (matches(key, deck.presenterHash)) return { deck, role: 'presenter' };
    if (matches(key, deck.screenHash)) return { deck, role: 'screen' };
    return null;
  }
  const auth = (req, res, next) => {
    req.access = authorize(req.params.id, req.headers.authorization?.replace(/^Bearer /, ''));
    if (!req.access) return res.status(404).json({ error: '链接不正确、已被删除或已过期。' });
    next();
  };
  app.get('/api/decks/:id', auth, (req, res) => {
    const { deck, role } = req.access;
    const { title, width, height, css, slides, warnings, expiresAt, format } = deck;
    // Deliberate allowlist: never send notes or presenter credentials to the screen.
    res.json({ title, width, height, css, slides, warnings, expiresAt, format, role, ...(role === 'presenter' ? { notes: deck.notes } : {}) });
  });
  app.post('/api/decks/:id/revisions', limit, auth, json, async (req, res) => {
    if (req.access.role !== 'presenter') return res.status(403).json({ error: '只有演讲者可以保存讲稿。' });
    const previous = req.access.deck;
    const notes = req.body?.notes;
    if (!Array.isArray(notes) || notes.length !== previous.slides.length || notes.some(n => typeof n !== 'string') || notes.join('').length > 500000) return res.status(400).json({ error: '讲稿页数不匹配，或内容超过 50 万字。' });
    if (decks.size >= maxDecks) return res.status(507).json({ error: '演示存储已满，请删除旧版本后重试。' });
    const id = randomBytes(12).toString('base64url'), presenterKey = token(), screenKey = token();
    const links = { screen: `/screen.html?room=${id}#${screenKey}`, presenter: `/presenter.html?room=${id}#${presenterKey}` };
    const saved = { ...previous, notes, originalNotes: notes.join('\n\n---\n\n'), versionLabel: String(req.body.label || '讲稿修改').slice(0,100), parentVersion: req.params.id, links, presenterHash: hash(presenterKey), screenHash: hash(screenKey), createdAt: Date.now(), expiresAt: retention ? Date.now() + retention : 8640000000000000 };
    decks.set(id, saved);
    try { await writeFile(path.join(dataDir, `${id}.json`), JSON.stringify(saved), { flag: 'wx', mode: 0o600 }); }
    catch (error) { decks.delete(id); throw error; }
    res.status(201).json({ id, projectId: saved.projectId, ...links, expiresAt: saved.expiresAt });
  });
  app.get('/api/sources/:id/:kind', workspace, (req, res) => {
    const d = decks.get(req.params.id);
    if (!d || d.owner !== req.owner || d.expiresAt <= Date.now()) return res.status(404).json({ error: '文件不存在。' });
    const isHtml = req.params.kind === 'slides';
    if (!isHtml && req.params.kind !== 'notes') return res.status(404).end();
    res.set('Content-Disposition', `attachment; filename="${isHtml ? 'slides.html' : 'notes.txt'}"`);
    res.type('text/plain').send(isHtml ? d.originalHtml : d.originalNotes || d.notes.join('\n\n---\n\n'));
  });
  app.delete('/api/decks/:id', auth, async (req, res) => {
    if (req.access.role !== 'presenter') return res.status(403).json({ error: '只有演讲者可以删除演示。' });
    try { await unlink(path.join(dataDir, `${req.params.id}.json`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    decks.delete(req.params.id);
    for (const client of wss.clients) if (client.room === req.params.id) client.close(4004, 'Presentation deleted');
    res.status(204).end();
  });
  app.use(express.static(path.join(root, 'public'), { etag: false }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type === 'entity.too.large' ? '文件太大，请使用小于 6 MB 的 HTML。' : '请求无法完成，请检查文件格式后重试。' }));
  const server = createServer(app);
  server.requestTimeout = 30000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const expected = publicOrigin || `http://${req.headers.host}`;
    if (req.url !== '/sync' || (req.headers.origin && req.headers.origin !== expected) || wss.clients.size >= 500) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.identity = randomBytes(8).toString('hex'); ws.alive = true;
    const deadline = setTimeout(() => ws.close(4001, 'Authentication required'), 5000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => clearTimeout(deadline));
    let at = Date.now(), count = 0;
    ws.on('message', data => {
      try {
        if (Date.now() - at > 1000) { at = Date.now(); count = 0; }
        if (++count > 150) return ws.close(4008, 'Too many messages');
        const input = JSON.parse(data.toString());
        if (!input || typeof input !== 'object' || Array.isArray(input)) return;
        if (!ws.access) {
          const access = authorize(input.room, input.key);
          if (input.type !== 'auth' || !access) return ws.close(4001, 'Invalid link');
          ws.access = access; ws.room = input.room;
          clearTimeout(deadline);
          if (access.role === 'presenter') for (const other of wss.clients) {
            if (other !== ws && other.room === ws.room && other.access?.role === 'presenter') { other.access = null; other.close(4009, 'Opened on another presenter'); }
          }
          ws.send(JSON.stringify({ type: 'ready', role: access.role }));
          return;
        }
        if (!decks.has(ws.room) || ws.access.deck.expiresAt <= Date.now()) return ws.close(4004, 'Expired');
        if (input.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
        const m = validatedMessage(input, ws.access.deck.slides.length, ws.access.role);
        if (!m) return;
        m.f = ws.identity; m.r = ws.access.role;
        const payload = JSON.stringify(m);
        for (const other of wss.clients) {
          if (other !== ws && other.room === ws.room && other.access && other.readyState === WebSocket.OPEN) {
            if (other.bufferedAmount > 1024 * 1024) other.close(4008, 'Slow connection');
            else other.send(payload);
          }
        }
      } catch { ws.close(4002, 'Invalid message'); }
    });
  });
  const interval = setInterval(async () => {
    for (const [id, saved] of decks) if (saved.expiresAt <= Date.now()) {
      decks.delete(id);
      await unlink(path.join(dataDir, `${id}.json`)).catch(() => {});
    }
    for (const [ip, entry] of limits) if (Date.now() - entry.at > 60000) limits.delete(ip);
    for (const ws of wss.clients) {
      if (!ws.alive || (ws.room && !decks.has(ws.room))) ws.terminate();
      else { ws.alive = false; ws.ping(); }
    }
  }, 15000);
  interval.unref();
  return { app, server, async close() { clearInterval(interval); for (const client of wss.clients) client.terminate(); wss.close(); await new Promise(resolve => server.close(resolve)); } };
}

export function validatedMessage(m, slideCount, role) {
  if (!['hello', 'hb', 'pos', 'ack', 'need', 'ink2'].includes(m.k)) return null;
  if (role === 'screen' && ['pos', 'ink2'].includes(m.k)) return null;
  if (m.k === 'hello') return { k: 'hello' };
  if (!Number.isInteger(m.i) || m.i < 0 || m.i >= slideCount) return null;
  const result = { k: m.k, i: m.i, v: 2, n: slideCount };
  if (m.k === 'need') return result;
  if (m.k === 'hb' || m.k === 'pos' || m.k === 'ack') {
    return { ...result, c: Number.isSafeInteger(m.c) ? m.c : 0, h: typeof m.h === 'string' ? m.h.slice(0, 64) : '', hr: role, ts: Number.isFinite(m.ts) ? m.ts : 0, to: typeof m.to === 'string' ? m.to.slice(0, 64) : '', ik2: typeof m.ik2 === 'string' ? m.ik2.slice(0, 50) : undefined };
  }
  const id = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
  const bounded = n => Number.isFinite(n) && Math.abs(n) <= 100000;
  if (m.o === 'p') {
    if (!id(m.s) || !Array.isArray(m.p) || m.p.length > 4500 || m.p.length % 3 || !m.p.every(bounded) || !Number.isInteger(m.a) || m.a < 0 || m.a > 50000) return null;
    return { ...result, o: 'p', s: m.s, a: m.a, p: m.p, tl: ['r','b','k','h','l'].includes(m.tl) ? m.tl : 'r', w: bounded(m.w) ? m.w : 24, pr: [1,2].includes(m.pr) ? m.pr : 0, e: m.e ? 1 : 0, of: Array.isArray(m.of) && m.of.length === 3 && m.of.every(Number.isFinite) ? m.of : undefined };
  }
  if (['set','d'].includes(m.o) && Array.isArray(m.ids) && m.ids.length <= 3000 && m.ids.every(id)) return { ...result, o: m.o, ids: m.ids };
  if (m.o === 'm' && Array.isArray(m.mv) && m.mv.length <= 3000 && m.mv.every(x => Array.isArray(x) && x.length === 3 && id(x[0]) && x.slice(1).every(bounded)) && Number.isSafeInteger(m.n)) return { ...result, o: 'm', mv: m.mv, n: m.n };
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await createApp();
  const port = numberEnv(process.env.PORT, 3000, 1, 65535);
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1','localhost','::1'].includes(host) && !process.env.UPLOAD_KEY) throw new Error('An UPLOAD_KEY is required when listening on the network.');
  instance.server.listen(port, host, () => console.log(`SlideLink is running on http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await instance.close(); process.exit(0); });
}
