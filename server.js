'use strict';

/*
 * AUTOVANT server
 * - serves the public site from /public
 * - serves the private admin page from /admin (password protected)
 * - stores features in data/articles.json and photos in uploads/
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

// sharp is optional. When installed, uploads are resized and converted to WebP.
let sharp = null;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

/* ---------- settings (.env) ---------- */

(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Autovant123';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 1000 * 60 * 60 * 12; // stay signed in for 12 hours

// The example file ships with placeholder values. Never run with them: anyone could read them on GitHub.
if (/change-this|paste-the/i.test(ADMIN_PASSWORD + ' ' + (process.env.SESSION_SECRET || ''))) {
  console.error('Your .env file still has the example values. Set your own ADMIN_PASSWORD and SESSION_SECRET (see .env.example), then start again.');
  process.exit(1);
}
if (PROD && (ADMIN_PASSWORD.length < 10 || (process.env.SESSION_SECRET || '').length < 32)) {
  console.error('Set ADMIN_PASSWORD (10+ characters) and SESSION_SECRET (32+ characters) in .env before running in production.');
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD is not set. The admin page is locked until you add it to .env and restart.');
}

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const ADMIN_DIR = path.join(ROOT, 'admin');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscribers.json');

const CATEGORIES = ['Exterior', 'Interior', 'Custom Builds', 'Designers & Brands', 'Concepts', 'Features'];
const SOURCES = ['Official', 'Verified', 'Our view'];
const SRC_RE = /^\/(uploads|img)\/[A-Za-z0-9._-]{1,100}$/;

/* ---------- admin session (signed cookie) ---------- */

const revoked = new Set();
const sign = (s) => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('base64url');

function makeToken() {
  const payload = Buffer.from(JSON.stringify({
    sid: crypto.randomBytes(8).toString('hex'),
    exp: Date.now() + SESSION_MS
  })).toString('base64url');
  return payload + '.' + sign(payload);
}

function readToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now() || revoked.has(data.sid)) return null;
    return data;
  } catch (_) { return null; }
}

function cookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const session = (req) => readToken(cookie(req, 'av_admin'));
const isAdmin = (req) => !!session(req);
const csrfOk = (req) => req.get('x-csrf') === '1';

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Sign in required.' });
  if (req.method !== 'GET' && !csrfOk(req)) return res.status(403).json({ error: 'Blocked request.' });
  next();
}

function passwordOk(input) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// 5 wrong passwords in 15 minutes locks that address out for the rest of the window.
const attempts = new Map();
function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > 15 * 60 * 1000) { attempts.delete(ip); return false; }
  return rec.count >= 5;
}
function noteFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count += 1;
}

/* ---------- storage ---------- */

let articles = [];
let subscribers = [];
let writeChain = Promise.resolve();

function writeJson(file, data) {
  writeChain = writeChain.then(async () => {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
    await fsp.rename(tmp, file);
  });
  return writeChain;
}

async function loadStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    articles = JSON.parse(await fsp.readFile(ARTICLES_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    articles = JSON.parse(await fsp.readFile(path.join(ROOT, 'seed', 'articles.json'), 'utf8'));
    await writeJson(ARTICLES_FILE, articles);
  }
  try {
    subscribers = JSON.parse(await fsp.readFile(SUBS_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    subscribers = [];
  }
}

/* ---------- cleaning input ---------- */

const str = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

function slugify(title) {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'story';
}

function uniqueSlug(title, ownId) {
  const base = slugify(title);
  let slug = base;
  let n = 2;
  while (articles.some((a) => a.slug === slug && a.id !== ownId)) slug = base + '-' + n++;
  return slug;
}

function cleanBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 300).map((b) => {
    if (!b || typeof b !== 'object') return null;
    switch (b.type) {
      case 'heading':
        return { type: 'heading', text: str(b.text, 200) };
      case 'text':
        return { type: 'text', text: str(b.text, 20000) };
      case 'quote':
        return { type: 'quote', text: str(b.text, 500), cite: str(b.cite, 120) };
      case 'image':
        return {
          type: 'image',
          src: SRC_RE.test(b.src || '') ? b.src : '',
          caption: str(b.caption, 300),
          alt: str(b.alt, 200),
          layout: pick(b.layout, ['fit', 'fill', 'spread'], 'fit'),
          focus: pick(b.focus, ['left', 'center', 'right'], 'center')
        };
      case 'specs':
        return {
          type: 'specs',
          title: str(b.title, 80),
          rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 40).map((r) => ({
            field: str(r && r.field, 80),
            value: str(r && r.value, 200),
            source: pick(r && r.source, SOURCES, 'Our view')
          }))
        };
      default:
        return null;
    }
  }).filter(Boolean);
}

function cleanArticle(body, existing) {
  const now = new Date().toISOString();
  const title = str(body.title, 200);
  const status = body.status === 'published' ? 'published' : 'draft';
  const a = {
    id: existing ? existing.id : crypto.randomUUID(),
    slug: existing ? existing.slug : '',
    title,
    category: pick(body.category, CATEGORIES, 'Features'),
    dek: str(body.dek, 400),
    cover: SRC_RE.test(body.cover || '') ? body.cover : '',
    featured: !!body.featured,
    status,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    publishedAt: existing ? existing.publishedAt : null,
    blocks: cleanBlocks(body.blocks)
  };
  if (!a.slug) a.slug = uniqueSlug(title, a.id);
  if (status === 'published' && !a.publishedAt) a.publishedAt = now;
  return a;
}

function summary(a) {
  const words = a.blocks.reduce((n, b) => n + (b.type === 'text' ? b.text.split(/\s+/).filter(Boolean).length : 0), 0);
  return {
    id: a.id, slug: a.slug, title: a.title, category: a.category, dek: a.dek, cover: a.cover,
    featured: a.featured, status: a.status, publishedAt: a.publishedAt, updatedAt: a.updatedAt,
    minutes: Math.max(1, Math.round(words / 200))
  };
}

const byPublished = (a, b) => String(b.publishedAt || b.updatedAt).localeCompare(String(a.publishedAt || a.updatedAt));

/* ---------- photo uploads ---------- */

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }
});

/* ---------- app ---------- */

const app = express();
app.disable('x-powered-by');
if (PROD) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  next();
});

app.use(express.json({ limit: '2mb' }));

/* --- public API --- */

app.get('/api/articles', (req, res) => {
  let list = articles.filter((a) => a.status === 'published');
  if (req.query.category) list = list.filter((a) => a.category === req.query.category);
  list.sort(byPublished);
  res.set('Cache-Control', 'no-cache').json(list.map(summary));
});

app.get('/api/articles/:slug', (req, res) => {
  const a = articles.find((x) => x.slug === req.params.slug);
  if (!a || (a.status !== 'published' && !isAdmin(req))) return res.status(404).json({ error: 'Not found.' });
  res.set('Cache-Control', 'no-cache').json(a);
});

const subAttempts = new Map();
app.post('/api/subscribe', async (req, res, next) => {
  try {
    const ip = req.ip;
    const rec = subAttempts.get(ip) || { count: 0, first: Date.now() };
    if (Date.now() - rec.first > 60 * 60 * 1000) { rec.count = 0; rec.first = Date.now(); }
    if (rec.count >= 10) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    rec.count += 1;
    subAttempts.set(ip, rec);

    const email = str(req.body && req.body.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!subscribers.some((s) => s.email === email)) {
      subscribers.push({ email, at: new Date().toISOString() });
      await writeJson(SUBS_FILE, subscribers);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* --- admin API --- */

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin is not set up yet. Add ADMIN_PASSWORD to the .env file and restart the server.' });
  if (!csrfOk(req)) return res.status(403).json({ error: 'Blocked request.' });
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!passwordOk(req.body && req.body.password)) {
    noteFailure(ip);
    return setTimeout(() => res.status(401).json({ error: 'That password is not right.' }), 600);
  }
  attempts.delete(ip);
  res.append('Set-Cookie', `av_admin=${makeToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const s = session(req);
  if (s) revoked.add(s.sid);
  res.append('Set-Cookie', `av_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.get('/api/admin/articles', requireAdmin, (req, res) => {
  const list = articles.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.set('Cache-Control', 'no-store').json(list.map(summary));
});

app.get('/api/admin/articles/:id', requireAdmin, (req, res) => {
  const a = articles.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  res.set('Cache-Control', 'no-store').json(a);
});

app.post('/api/admin/articles', requireAdmin, async (req, res, next) => {
  try {
    const a = cleanArticle(req.body || {}, null);
    if (!a.title) return res.status(400).json({ error: 'Add a title first.' });
    articles.push(a);
    await writeJson(ARTICLES_FILE, articles);
    res.status(201).json(a);
  } catch (e) { next(e); }
});

app.put('/api/admin/articles/:id', requireAdmin, async (req, res, next) => {
  try {
    const i = articles.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Not found.' });
    const a = cleanArticle(req.body || {}, articles[i]);
    if (!a.title) return res.status(400).json({ error: 'Add a title first.' });
    articles[i] = a;
    await writeJson(ARTICLES_FILE, articles);
    res.json(a);
  } catch (e) { next(e); }
});

app.delete('/api/admin/articles/:id', requireAdmin, async (req, res, next) => {
  try {
    const i = articles.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Not found.' });
    articles.splice(i, 1);
    await writeJson(ARTICLES_FILE, articles);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/admin/upload', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload.' });
    const type = sniff(req.file.buffer);
    if (!type) return res.status(400).json({ error: 'Use a JPG, PNG or WebP photo.' });

    const id = crypto.randomBytes(12).toString('hex');
    let name = id + '.' + type;
    let data = req.file.buffer;

    if (sharp) {
      try {
        data = await sharp(req.file.buffer).rotate()
          .resize({ width: 2600, height: 2600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 86 }).toBuffer();
        name = id + '.webp';
      } catch (_) {
        return res.status(400).json({ error: 'That photo could not be read.' });
      }
    }
    await fsp.writeFile(path.join(UPLOAD_DIR, name), data);
    res.json({ url: '/uploads/' + name });
  } catch (e) { next(e); }
});

app.get('/api/admin/subscribers.csv', requireAdmin, (req, res) => {
  const rows = ['email,signed_up'].concat(subscribers.map((s) => `${s.email},${s.at}`));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="autovant-subscribers.csv"' }).send(rows.join('\n'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* --- admin pages --- */

app.get('/admin', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.sendFile(path.join(ADMIN_DIR, isAdmin(req) ? 'editor.html' : 'login.html'));
});

app.use('/admin/assets', (req, res, next) => {
  if (req.path === '/editor.js' && !isAdmin(req)) return res.status(404).end();
  res.set('Cache-Control', 'no-cache');
  next();
}, express.static(path.join(ADMIN_DIR, 'assets')));

/* --- public pages --- */

app.get('/read/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'read.html')));
app.get('/section/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'section.html')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0 }));

app.use((req, res) => {
  res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="background:#0d0c0b;color:#f2efe9;font:16px system-ui;padding:48px"><p>That page does not exist.</p><p><a style="color:#cfba8f" href="/">Back to AUTOVANT</a></p>');
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That photo is larger than 25 MB.' : 'Upload failed.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

loadStore().then(() => {
  app.listen(PORT, () => {
    console.log(`AUTOVANT is running at http://localhost:${PORT}`);
    console.log(`Admin page: http://localhost:${PORT}/admin`);
    if (!sharp) console.log('Tip: install "sharp" to resize and compress uploaded photos automatically.');
  });
}).catch((e) => { console.error('Could not start:', e); process.exit(1); });
