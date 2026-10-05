// Local editor for the Gavna website. NEVER uploaded: it only listens on this
// computer (127.0.0.1), so nobody else can reach the panel.
//
//   node server.js   (or double-click start.bat)
//   site  -> http://127.0.0.1:4410/
//   panel -> http://127.0.0.1:4410/admin/
//
// Saving in the panel writes content/site.json or content/pages/*.json
// (keeping the previous version in content/_backups/) and rebuilds dist/
// right away.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const site = require('./build');
const { BLOCKS, STYLE_FIELDS, PAGE_FIELDS } = require('./blocks');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4410;
const ROOT = site.ROOT;
const CONTENT = path.join(ROOT, 'content', 'site.json');
const LEGAL = path.join(ROOT, 'content', 'legal');
const BACKUPS = path.join(ROOT, 'content', '_backups');
const UPLOADS = path.join(ROOT, 'src', 'img', 'uploads');
const ADMIN = path.join(ROOT, 'admin');
const MAX_BODY = 25 * 1024 * 1024;
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
// typefaces the panel can add to src/fonts; each is checked by its first bytes
const FONT_DIR = path.join(ROOT, 'src', 'fonts');
const MAX_FONT = 8 * 1024 * 1024;
const FONT_MAGIC = site.FONT_MAGIC;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'application/json', 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// a file inside `base`, or null if the path tries to leave it
function inside(base, rel) {
  const file = path.resolve(base, '.' + path.sep + rel);
  return file === base || file.startsWith(base + path.sep) ? file : null;
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

function serveStatic(res, base, rel, fallback404) {
  let file = inside(base, decodeURIComponent(rel));
  if (!file || path.basename(file).startsWith('.')) return send(res, 403, 'Forbidden', 'text/plain');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    if (fallback404 && fs.existsSync(fallback404)) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end(fs.readFileSync(fallback404)); }
    return send(res, 404, 'Not found', 'text/plain');
  }
  serveFile(res, file);
}

function backupContent() {
  if (!fs.existsSync(CONTENT)) return;
  fs.mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(CONTENT, path.join(BACKUPS, `site-${stamp}.json`));
  const old = fs.readdirSync(BACKUPS).filter(f => f.startsWith('site-')).sort();
  old.slice(0, Math.max(0, old.length - 30)).forEach(f => fs.unlinkSync(path.join(BACKUPS, f)));
}

// site.json must keep the site's data and the shared texts
function validContent(d) {
  return !!(d && typeof d === 'object' && d.site && d.nav && d.musicComposer && d.footer);
}

// the previous version of a page, kept like site.json's (last 30 per page)
function backupPage(id) {
  const file = path.join(site.PAGES_DIR, id + '.json');
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(BACKUPS, `page-${id}-${stamp}.json`));
  const old = fs.readdirSync(BACKUPS).filter(f => f.startsWith(`page-${id}-`)).sort();
  old.slice(0, Math.max(0, old.length - 30)).forEach(f => fs.unlinkSync(path.join(BACKUPS, f)));
}

function listImages() {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (IMAGE_EXT.includes(path.extname(e.name).toLowerCase()) || e.name.endsWith('.svg')) out.push('img/' + r);
    }
  })(path.join(ROOT, 'src', 'img'), '');
  return out.sort();
}

async function api(req, res, route) {
  // the panel is the only client: refuse requests from any other web page
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) {
    return send(res, 403, { error: 'origin' });
  }

  if (route === 'content' && req.method === 'GET') return send(res, 200, fs.readFileSync(CONTENT, 'utf8'));
  if (route === 'content' && req.method === 'PUT') {
    const data = JSON.parse(await readBody(req));
    if (!validContent(data)) return send(res, 400, { error: 'invalid content' });
    backupContent();
    fs.writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return send(res, 200, { ok: true, ...site.build() });
  }

  // the block editor: what blocks exist, the pages, saving them, and the
  // live preview of a page that may not be saved yet
  if (route === 'blocks' && req.method === 'GET') {
    const list = (dir, ok) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(ok).sort() : []);
    // the font pickers list whatever is in src/fonts right now
    const found = site.syncFonts();
    const fonts = found.map(f => [f.key, f.label]);
    const style = STYLE_FIELDS.map(f => (f.key === 'fontTitle' || f.key === 'fontText' ? Object.assign({}, f, { options: f.options.concat(fonts) }) : f));
    return send(res, 200, {
      blocks: BLOCKS, style, page: PAGE_FIELDS, brokenFonts: found.broken,
      lotties: list(path.join(ROOT, 'src', 'img'), f => f.endsWith('.json')),
      files: list(path.join(ROOT, 'src', 'downloads'), f => !f.startsWith('.')).map(f => 'downloads/' + f)
    });
  }
  if (route === 'pages' && req.method === 'GET') return send(res, 200, site.readPages());
  if (route.startsWith('pages/')) {
    const id = route.slice(6);
    if (!site.PAGE_ID.test(id)) return send(res, 400, { error: 'Nombre de página no válido.' });
    const file = path.join(site.PAGES_DIR, id + '.json');
    if (req.method === 'PUT') {
      const page = JSON.parse(await readBody(req));
      page.id = id;
      const problem = site.pageProblem(page, site.readPages());
      if (problem) return send(res, 400, { error: problem });
      if (id === 'home' && page.path !== '') return send(res, 400, { error: 'La página de inicio no puede cambiar de dirección.' });
      backupPage(id);
      const stored = Object.assign({}, page);
      delete stored.id;
      fs.mkdirSync(site.PAGES_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n', 'utf8');
      return send(res, 200, { ok: true, ...site.build() });
    }
    if (req.method === 'DELETE') {
      if (id === 'home') return send(res, 400, { error: 'La página de inicio no se puede borrar.' });
      if (!fs.existsSync(file)) return send(res, 404, { error: 'No existe.' });
      backupPage(id);
      fs.unlinkSync(file);
      return send(res, 200, { ok: true, ...site.build() });
    }
  }
  if (route === 'preview' && req.method === 'POST') {
    const { content, pages, page, lang } = JSON.parse(await readBody(req));
    if (!validContent(content) || !Array.isArray(pages) || !page || !Array.isArray(page.blocks)) return send(res, 400, { error: 'invalid preview' });
    return send(res, 200, site.preview(content, pages, page, lang));
  }

  if (route === 'legal' && req.method === 'GET') {
    const files = fs.readdirSync(LEGAL).filter(f => /^[a-z]+\.(en|es)\.md$/.test(f)).sort();
    return send(res, 200, files.map(f => ({ file: f, text: fs.readFileSync(path.join(LEGAL, f), 'utf8') })));
  }
  if (route.startsWith('legal/') && req.method === 'PUT') {
    const name = route.slice(6);
    if (!/^[a-z]+\.(en|es)\.md$/.test(name) || !fs.existsSync(path.join(LEGAL, name))) return send(res, 400, { error: 'file' });
    const { text } = JSON.parse(await readBody(req));
    if (typeof text !== 'string' || !text.trim()) return send(res, 400, { error: 'empty' });
    fs.writeFileSync(path.join(LEGAL, name), text.replace(/\r\n/g, '\n'), 'utf8');
    return send(res, 200, { ok: true, ...site.build() });
  }

  if (route === 'images' && req.method === 'GET') return send(res, 200, listImages());
  if (route === 'upload' && req.method === 'POST') {
    const { filename, data } = JSON.parse(await readBody(req));
    const ext = path.extname(String(filename || '')).toLowerCase();
    if (!IMAGE_EXT.includes(ext) || typeof data !== 'string') return send(res, 400, { error: 'Only JPG, PNG, WebP or GIF images.' });
    const base = path.basename(String(filename), ext).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
    fs.mkdirSync(UPLOADS, { recursive: true });
    let name = base + ext, n = 2;
    while (fs.existsSync(path.join(UPLOADS, name))) name = `${base}-${n++}${ext}`;
    fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(data, 'base64'));
    site.build();
    return send(res, 200, { ok: true, path: 'img/uploads/' + name });
  }

  // a typeface added from the panel: copied into src/fonts, never over a file
  // that is already there
  if (route === 'upload-font' && req.method === 'POST') {
    const { filename, data } = JSON.parse(await readBody(req));
    const given = String(filename || '');
    const ext = path.extname(given).toLowerCase();
    if (!FONT_MAGIC[ext] || typeof data !== 'string') return send(res, 400, { error: 'Solo archivos de tipografía .woff2, .woff, .ttf u .otf.' });
    const buf = Buffer.from(data, 'base64');
    if (buf.length < 12 || buf.length > MAX_FONT) return send(res, 400, { error: 'La tipografía está vacía o pesa más de 8 MB.' });
    if (!FONT_MAGIC[ext](buf)) return send(res, 400, { error: 'El archivo no parece una tipografía ' + ext + ' válida.' });
    const stem = path.basename(given, path.extname(given)).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'font';
    const name = stem + ext;
    fs.mkdirSync(FONT_DIR, { recursive: true });
    if (fs.existsSync(path.join(FONT_DIR, name))) return send(res, 409, { error: `Ya hay una tipografía llamada ${name} en src/fonts.` });
    fs.writeFileSync(path.join(FONT_DIR, name), buf);
    site.build();
    const family = site.listFonts().find(f => f.faces.some(x => x.file === name));
    if (!family) {
      fs.unlinkSync(path.join(FONT_DIR, name));
      site.build();
      return send(res, 400, { error: 'Ese nombre de archivo no se puede usar como tipografía; cámbiale el nombre.' });
    }
    return send(res, 200, { ok: true, file: name, key: family.key, label: family.label });
  }

  if (route === 'pack' && req.method === 'POST') {
    const b = site.build();
    const z = site.pack();
    return send(res, 200, { ok: true, missing: b.missing, file: z.file, files: z.files, bytes: z.bytes });
  }
  send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  // only this computer's own address, never a name pointing here from outside
  const host = (req.headers.host || '').split(':')[0];
  if (host !== HOST && host !== 'localhost') return send(res, 403, 'Forbidden', 'text/plain');
  const url = req.url.split('?')[0];
  try {
    if (url.startsWith('/api/')) return await api(req, res, url.slice(5));
    if (url === '/admin') { res.writeHead(302, { location: '/admin/' }); return res.end(); }
    if (url.startsWith('/admin/')) return serveStatic(res, ADMIN, url.slice(7) || 'index.html');
    serveStatic(res, site.DIST, url.slice(1), path.join(site.DIST, '404.html'));
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err.message || err) });
  }
});

const first = site.build();
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Gavna website  ->  http://' + HOST + ':' + PORT + '/');
  console.log('  Panel          ->  http://' + HOST + ':' + PORT + '/admin/');
  if (first.missing.length) console.log('  Missing translations: ' + first.missing.join(', '));
  const badFonts = site.listFonts().broken;
  if (badFonts.length) console.log('  Typefaces in src/fonts that are not valid font files (ignored): ' + badFonts.join(', '));
  console.log('');
});
