// Gavna website generator. Reads content/site.json (the site's data and
// shared texts, in English and Spanish), content/pages/*.json (each page as a
// list of blocks, see blocks.js) and content/legal/*.md, and writes the
// finished static site to dist/ — plain HTML pages, so search engines and
// reviewers read them as-is.
//
//   node build.js          -> dist/
//   node build.js pack     -> dist/ + gavna-digital-netlify.zip (to upload)
//
// The local editor (node server.js) runs the same build after every save.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { BLOCKS } = require('./blocks');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(ROOT, 'gavna-digital-netlify.zip');
const LANGS = ['en', 'es'];
const YEAR = new Date().getFullYear();

// ---------------------------------------------------------------- helpers

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let missing = [];
// a text in the page's language; never filled with the other language. When
// `where` says where it is, a missing translation is reported (checking
// whether an optional text is there passes no `where`).
function tr(value, lang, where) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (value[lang]) return value[lang];
  if (where) missing.push(`${where} [${lang}]`);
  return '';
}

// **bold** and [text](link); a link that isn't a web, mail or site address
// stays plain text
function inlineMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (m, text, url) => {
      const u = url.replace(/&amp;/g, '&');
      if (!/^(https?:\/\/|mailto:|\/|#|\.\.?\/)/i.test(u)) return text;
      return `<a href="${esc(u)}"${/^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
    });
}

// just what the legal texts use: # / ## headings, paragraphs, - and 1. lists
function markdown(md) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const ul = /^- (.*)/.exec(line), ol = /^\d+\. (.*)/.exec(line);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { close(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inlineMd((ul || ol)[1])}</li>`);
      continue;
    }
    close();
    if (!line) continue;
    if (line.startsWith('## ')) out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
    else out.push(`<p>${inlineMd(line)}</p>`);
  }
  close();
  return out.join('\n');
}

// page address inside the site, per language: '' is the home page
const href = (lang, p) => (lang === 'en' ? '/' : '/es/') + (p ? p + '/' : '');
// an asset in src/ (images, downloads), from any page
const asset = p => '/' + String(p).replace(/^\/+/, '');

function hashOf(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

// ---------------------------------------------------------------- fonts

// Every typeface in src/fonts can be picked in a block's "Estilo" tab. Files
// of one family are grouped by name ("inter-400.woff2", "Inter-Bold.ttf" ->
// Inter), and build.js writes css/fonts.css with one @font-face per file plus
// the classes a block uses (blk-ft-<key> for titles, blk-fx-<key> for text).
const FONT_FORMAT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };
const FONT_WEIGHT = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, heavy: 800, black: 900 };
const FONT_WORDS = Object.keys(FONT_WEIGHT).sort((a, b) => b.length - a.length).join('|');
// fonts that are part of the site's own design, not for blocks (the flag emoji)
const FONT_HIDDEN = /^twemoji/i;
// a font file is told by its first bytes, not by its extension (a text file
// renamed ".woff2" is refused by browsers and would leave a broken option)
const FONT_MAGIC = {
  '.woff2': b => b.toString('latin1', 0, 4) === 'wOF2',
  '.woff': b => b.toString('latin1', 0, 4) === 'wOFF',
  '.ttf': b => b.readUInt32BE(0) === 0x00010000 || b.toString('latin1', 0, 4) === 'true',
  '.otf': b => b.toString('latin1', 0, 4) === 'OTTO' || b.readUInt32BE(0) === 0x00010000
};
function fontFileOk(file) {
  try {
    const fd = fs.openSync(file, 'r'), b = Buffer.alloc(12);
    const n = fs.readSync(fd, b, 0, 12, 0);
    fs.closeSync(fd);
    return n === 12 && FONT_MAGIC[path.extname(file).toLowerCase()](b);
  } catch (err) { return false; }
}

// "Inter-SemiBold.ttf" -> { family: 'Inter', weight: 600, italic: false }
function parseFontFile(file) {
  const ext = path.extname(file);
  let stem = file.slice(0, file.length - ext.length), italic = false, weight = null, m;
  if ((m = stem.match(/^(.+?)[-_ ]?(italic|oblique)$/i))) { stem = m[1]; italic = true; }
  if ((m = stem.match(new RegExp('^(.+?)[-_ ]?(' + FONT_WORDS + '|[1-9]00)$', 'i')))) {
    stem = m[1];
    weight = /^\d/.test(m[2]) ? Number(m[2]) : FONT_WEIGHT[m[2].toLowerCase()];
  }
  return { family: stem, weight: weight || 400, italic };
}

const fontKey = family => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// "GavnaQad" -> "Gavna Qad", "jetbrains-mono" -> "Jetbrains Mono"
const fontLabel = family => family.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim()
  .replace(/\b[a-z]/g, ch => ch.toUpperCase());

// [{ key, label, faces: [{ file, weight, italic, format }] }], by name. Files
// that are not real fonts are left out and named in the list's `.broken`.
function listFonts() {
  const dir = path.join(SRC, 'fonts');
  const byKey = new Map(), broken = [];
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const format = FONT_FORMAT[path.extname(file).toLowerCase()];
    if (!format || FONT_HIDDEN.test(file)) continue;
    if (!fontFileOk(path.join(dir, file))) { broken.push(file); continue; }
    const p = parseFontFile(file);
    const key = fontKey(p.family);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { key, label: fontLabel(p.family), faces: [] });
    byKey.get(key).faces.push({ file, weight: p.weight, italic: p.italic, format });
  }
  const list = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  list.broken = broken;
  return list;
}

function fontsCss(fonts) {
  const out = ['/* written by build.js from the files in src/fonts - do not edit */'];
  for (const f of fonts) {
    // a family with a single file (a variable font, or one weight) covers every
    // weight, so the browser never fakes a bold on top of it
    const single = f.faces.length === 1;
    for (const face of f.faces) {
      out.push(`@font-face { font-family: 'blkfont-${f.key}'; font-weight: ${single ? '100 900' : face.weight}; font-style: ${face.italic ? 'italic' : 'normal'}; font-display: swap; src: url('../fonts/${encodeURIComponent(face.file)}') format('${face.format}'); }`);
    }
    const stack = `'blkfont-${f.key}', ${/mono|code|courier/.test(f.key) ? 'monospace' : 'sans-serif'}`;
    out.push(`.blk-ft-${f.key} { --mono: ${stack}; }`);
    out.push(`.blk-fx-${f.key} { --font: ${stack}; font-family: var(--font); }`);
  }
  return out.join('\n') + '\n';
}

// the fonts a block's style may name; set at the start of every build/preview
let fontKeys = new Set();
// reads src/fonts and keeps dist/css/fonts.css up to date (written only when
// it changed); returns the font list
function syncFonts() {
  const fonts = listFonts();
  fontKeys = new Set(fonts.map(f => f.key));
  const css = fontsCss(fonts);
  const file = path.join(DIST, 'css', 'fonts.css');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== css) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, css, 'utf8');
  }
  return fonts;
}

// ---------------------------------------------------------------- layout

// a Lottie animation from src/img, written into the page so it plays without
// a second download ("</" escaped so it can't close the <script> early)
function lottieJson(file) {
  return JSON.stringify(JSON.parse(fs.readFileSync(path.join(SRC, 'img', file), 'utf8'))).replace(/<\//g, '<\\/');
}

// a brand icon from src/img/icons (Simple Icons, CC0), inline so it takes
// the link's color
function icon(name) {
  return fs.readFileSync(path.join(SRC, 'img', 'icons', name + '.svg'), 'utf8')
    .replace(/<title>.*?<\/title>/, '').replace('<svg ', '<svg class="icon" aria-hidden="true" focusable="false" fill="currentColor" ');
}

// Gavna's social profiles (site.json: site.instagram, site.discord, site.facebook,
// site.x, site.reddit, site.youtube). Only the ones with a link are shown, in this order; to add
// a network, add its icon to src/img/icons, a line here, and its key to site.json
// and to LABELS in admin/admin.js.
const SOCIALS = [['instagram', 'Instagram'], ['discord', 'Discord'], ['facebook', 'Facebook'], ['x', 'X'], ['reddit', 'Reddit'], ['youtube', 'YouTube']];
function socialLinks(c, cls) {
  const s = c.site;
  return `<div class="${cls}">${SOCIALS.map(([key, name]) => [key, name, s[key]])
    .filter(x => x[2]).map(([key, name, url]) =>
      `<a class="social-link" href="${esc(url)}" target="_blank" rel="noopener">${icon(key)}<span>${name}</span></a>`).join('')}</div>`;
}

// the company logo (white), in the header and the footer
function logo() {
  return '<img src="/img/logotype-company.svg" alt="Gavna" width="300" height="63">';
}

function layout(c, lang, page) {
  const other = lang === 'en' ? 'es' : 'en';
  const url = c.site.url + href(lang, page.path);
  const v = page.versions;
  const nav = navHtml(page.nav);
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url}">
${LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${c.site.url + href(l, page.path)}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${c.site.url + href('en', page.path)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
${page.image ? `<meta property="og:image" content="${c.site.url + asset(page.image)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="/img/favicon.svg?v=${v.favicon}" type="image/svg+xml">
<link rel="stylesheet" href="/css/site.css?v=${v.css}">
<link rel="stylesheet" href="/css/fonts.css?v=${v.fonts}">
</head>
<body>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${href(lang, '')}">${logo()}</a>
    <nav class="main-nav" id="main-nav">${nav}</nav>
    <div class="header-tools">
      <a class="lang-switch" href="${href(other, page.path)}" hreflang="${other}" lang="${other}">${other.toUpperCase()}</a>
      <button class="nav-toggle" type="button" aria-controls="main-nav" aria-expanded="false" aria-label="Menu"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>
<main>
${page.body}
</main>
${footer(c, lang)}
<script src="/js/site.js?v=${v.js}"></script>
${(page.scripts || []).map(s => `<script src="/js/${s}.js?v=${v.scripts[s]}"></script>\n`).join('')}${page.preview ? PREVIEW_HELPER : ''}
</body>
</html>
`;
}

function footer(c, lang) {
  const f = c.footer, n = c.nav, s = c.site;
  const menu = homeNav(c, lang);
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <a class="brand" href="${href(lang, '')}">${logo()}</a>
      <p>${esc(tr(s.tagline, lang, 'site.tagline'))}</p>
    </div>
    <div>
      <h3>${esc(tr(n.products, lang))}</h3>
      ${menu[0].items.map(p => `<a href="${p.link}">${esc(p.label)}</a>`).join('\n      ')}
    </div>
    <div>
      <h3>Gavna</h3>
      ${menu.slice(1).map(l => `<a href="${esc(l[1])}">${esc(l[0])}</a>`).join('\n      ')}
    </div>
    <div>
      <h3>${esc(tr(f.legal, lang))}</h3>
      <a href="${href(lang, 'legal/privacy')}">${esc(tr(f.privacy, lang))}</a>
      <a href="${href(lang, 'legal/terms')}">${esc(tr(f.terms, lang))}</a>
      <a href="${href(lang, 'legal/refunds')}">${esc(tr(f.refunds, lang))}</a>
    </div>
    <div>
      <h3>${esc(tr(f.contactTitle, lang, 'footer.contactTitle'))}</h3>
      <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>
      <a href="${esc(s.whatsapp)}" rel="noopener">WhatsApp ${esc(s.phoneDisplay)}</a>
      ${socialLinks(c, 'footer-social')}
    </div>
  </div>
  <div class="wrap footer-bottom">
    <p>© ${YEAR} Gavna · ${esc(s.legalName)} · ${esc(tr(s.country, lang))}. ${esc(tr(f.rights, lang))}</p>
  </div>
</footer>`;
}

// ---------------------------------------------------------------- pages

// Gavna's products, in the order the Products menu lists them. A new product
// is one more line here: its content key in site.json and its page (by id).
const PRODUCTS = [
  { key: 'musicComposer', page: 'music-composer' }
];

// Every page made of blocks lives in content/pages/<id>.json:
//   { path, title, description, image, blocks: [{ id, type, hidden, style, props }] }
// path '' is the home page. The panel edits these files.
const PAGES_DIR = path.join(ROOT, 'content', 'pages');
const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED = ['es', 'en', 'legal', 'sent', 'purchased', 'img', 'css', 'js', 'fonts', 'downloads', 'admin', 'api', '404'];

function readPages() {
  if (!fs.existsSync(PAGES_DIR)) return [];
  return fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.json') && PAGE_ID.test(f.slice(0, -5))).map((f) => {
    const p = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, f), 'utf8'));
    p.id = f.slice(0, -5);
    return p;
  }).sort((a, b) => (a.path === '' ? -1 : b.path === '' ? 1 : a.path.localeCompare(b.path)));
}

// what is wrong with a page (for the panel, before saving), or null
function pageProblem(page, pages) {
  if (!page || typeof page !== 'object' || !Array.isArray(page.blocks)) return 'La página no tiene bloques.';
  if (typeof page.path !== 'string' || (page.path !== '' && (!PAGE_ID.test(page.path) || RESERVED.includes(page.path)))) {
    return 'Dirección no válida: solo minúsculas, números y guiones (y no puede ser ' + RESERVED.join(', ') + ').';
  }
  const other = (pages || []).find(p => p.id !== page.id && p.path === page.path);
  if (other) return 'Ya hay otra página con esa dirección.';
  for (const b of page.blocks) if (!b || !BLOCKS[b.type]) return 'Bloque desconocido: ' + (b && b.type);
  return null;
}

// Where a button or picture goes:
//   store:            the Microsoft Store page (site.json musicComposer.storeUrl)
//   buy:              the license checkout (musicComposer.checkoutUrl)
//   page:<id>[#part]  a page of this site, in the same language
//   #part             a part of this page
//   https://…, mailto:…, /…
// Anything else (or a link that isn't set yet) gives null: no button.
function resolveLink(v, x) {
  v = String(v || '').trim();
  if (!v) return null;
  const mc = x.c.musicComposer;
  if (v === 'store:') return mc.storeUrl ? { href: mc.storeUrl, external: true } : null;
  if (v === 'buy:') return mc.checkoutUrl ? { href: mc.checkoutUrl } : null;
  const pg = /^page:([a-z0-9-]+)(#[A-Za-z][\w-]*)?$/.exec(v);
  if (pg) {
    const target = x.pages.find(p => p.id === pg[1]);
    if (!target) return null;
    const part = pg[2] || '';
    // a part of the page being shown: just the anchor, so the browser scrolls
    if (target.id === x.page.id && part) return { href: part };
    return { href: href(x.lang, target.path) + part };
  }
  if (/^#[A-Za-z][\w-]*$/.test(v)) return { href: v };
  if (/^https?:\/\/[^\s"'<>]+$/i.test(v)) return { href: v, external: true };
  if (/^mailto:[^\s"'<>]+$/i.test(v) || /^\/[^\s"'<>]*$/.test(v)) return { href: v };
  return null;
}

function linkAttrs(l) {
  return `href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}`;
}

// the menu: Products (a drop-down), then the links set in the panel
function homeNav(c, lang, x) {
  const ctx = x || { c, lang, pages: readPages(), page: {} };
  const products = PRODUCTS.map((p) => {
    const target = ctx.pages.find(pg => pg.id === p.page);
    return { label: c[p.key].name, text: tr(c[p.key].tagline, lang), link: href(lang, target ? target.path : p.page) };
  });
  const links = (c.nav.links || []).map((l) => {
    const to = resolveLink(l.link, ctx);
    return to && [tr(l.label, lang, 'nav.links'), to.href];
  }).filter(Boolean);
  return [{ label: tr(c.nav.products, lang), items: products }, ...links];
}

function navHtml(items) {
  return items.map((it) => {
    if (Array.isArray(it)) return `<a href="${esc(it[1])}">${esc(it[0])}</a>`;
    return `<div class="nav-drop">
      <button class="nav-drop-btn" type="button" aria-expanded="false">${esc(it.label)}<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5"/></svg></button>
      <div class="nav-drop-menu">${it.items.map(p => `
        <a href="${p.link}"><strong>${esc(p.label)}</strong><span>${esc(p.text)}</span></a>`).join('')}
      </div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- images

// width and height of a picture in src/, so the page doesn't jump while it
// loads (PNG, JPEG, GIF, WebP and SVG; null when it can't tell)
const sizeCache = new Map();
function imageSize(rel) {
  const file = path.join(SRC, String(rel || '').replace(/^\/+/, ''));
  if (sizeCache.has(file)) return sizeCache.get(file);
  let size = null;
  try {
    const b = fs.readFileSync(file);
    if (b.readUInt32BE(0) === 0x89504e47) size = [b.readUInt32BE(16), b.readUInt32BE(20)];
    else if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i < b.length - 9;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break; }
        i += 2 + len;
      }
    } else if (b.toString('ascii', 0, 3) === 'GIF') size = [b.readUInt16LE(6), b.readUInt16LE(8)];
    else if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8 ') size = [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
      else if (kind === 'VP8L') { const n = b.readUInt32LE(21); size = [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]; }
      else if (kind === 'VP8X') size = [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    } else if (file.endsWith('.svg')) {
      const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(b.toString('utf8', 0, 2000));
      if (vb) size = [Math.round(+vb[1]), Math.round(+vb[2])];
    }
  } catch (err) { size = null; }
  sizeCache.set(file, size);
  return size;
}

// an <img> for a picture in src/, with its size when known
function img(rel, alt, extra) {
  if (!rel) return '';
  const s = imageSize(rel);
  return `<img src="${asset(rel)}" alt="${esc(alt)}"${s ? ` width="${s[0]}" height="${s[1]}"` : ''}${extra ? ' ' + extra : ''}>`;
}

// ---------------------------------------------------------------- blocks

const STYLE_CLASS = {
  bg: { none: 'blk-bg-none', alt: 'section-alt', dark: 'blk-bg-dark', glow: 'blk-bg-glow' },
  padTop: { 0: 'blk-pt-0', s: 'blk-pt-s', m: 'blk-pt-m', l: 'blk-pt-l', xl: 'blk-pt-xl' },
  padBottom: { 0: 'blk-pb-0', s: 'blk-pb-s', m: 'blk-pb-m', l: 'blk-pb-l', xl: 'blk-pb-xl' },
  width: { narrow: 'blk-w-narrow', normal: 'blk-w-normal' },
  align: { left: 'blk-al-left', center: 'blk-al-center' },
  fontWeight: { 400: 'blk-fw-400', 500: 'blk-fw-500', 600: 'blk-fw-600', 700: 'blk-fw-700' },
  fontSize: { xs: 'blk-fs-xs', s: 'blk-fs-s', l: 'blk-fs-l', xl: 'blk-fs-xl', xxl: 'blk-fs-xxl' },
  show: { desktop: 'blk-only-desktop', mobile: 'blk-only-mobile' }
};

// the opening tag of a block: its own classes plus the "Estilo" settings,
// its anchor, and (in the panel's preview) which block it is
function openTag(tag, base, b, x) {
  const st = b.style || {};
  const cls = [base];
  for (const k of Object.keys(STYLE_CLASS)) if (st[k] != null && Object.prototype.hasOwnProperty.call(STYLE_CLASS[k], st[k])) cls.push(STYLE_CLASS[k][st[k]]);
  if (st.border) cls.push('blk-border-top');
  if (st.italic) cls.push('blk-italic');
  // typefaces: only ones that exist in src/fonts (see fonts.css)
  if (typeof st.fontTitle === 'string' && fontKeys.has(st.fontTitle)) cls.push('blk-ft-' + st.fontTitle);
  if (typeof st.fontText === 'string' && fontKeys.has(st.fontText)) cls.push('blk-fx-' + st.fontText);
  if (x.preview && b.hidden) cls.push('blk-hidden');
  const anchor = /^[A-Za-z][\w-]{0,40}$/.test(st.anchor || '') ? st.anchor : '';
  return `<${tag} class="${cls.filter(Boolean).join(' ')}"${anchor ? ` id="${anchor}"` : ''}${x.preview ? ` data-block="${esc(b.id)}"` : ''}>`;
}

// the buttons of a block; one whose link isn't set (no checkout yet…) is left out
function buttons(list, x, where) {
  const mc = x.c.musicComposer;
  return (list || []).map((bt, i) => {
    const to = resolveLink(bt.link, x);
    if (!to) return '';
    let label = tr(bt.label, x.lang);
    if (!label && bt.link === 'store:') label = tr(mc.download.button, x.lang);
    if (!label && bt.link === 'buy:') label = tr(mc.buyButton, x.lang);
    if (!label) { tr(bt.label, x.lang, `${where} → botón ${i + 1}`); return ''; }
    return `<a class="btn ${bt.style === 'ghost' ? 'btn-ghost' : 'btn-red'}" ${linkAttrs(to)}>${esc(label)}</a>`;
  }).filter(Boolean).join('\n        ');
}

const RENDER = {
  hero(p, b, x) {
    const t = x.t;
    const btns = buttons(p.buttons, x, x.where('botones'));
    const text = `<p class="eyebrow">${t(p.eyebrow)}</p>
      <h1>${t(p.title, 'título')}</h1>
      ${tr(p.text, x.lang) ? `<p class="lead">${t(p.text)}</p>` : ''}
      ${btns ? `<div class="cta-row">\n        ${btns}\n      </div>` : ''}
      ${tr(p.note, x.lang) ? `<p class="hero-note">${t(p.note)}</p>` : ''}`;
    const picture = tr(p.image, x.lang);
    if (p.layout === 'center') {
      return `${openTag('section', 'hero hero-product', b, x)}
  <div class="wrap hero-inner">
      ${text}
  </div>
  ${p.media === 'image' && picture ? `<div class="wrap">\n    <div class="hero-shot">${img(picture, tr(p.title, x.lang))}</div>\n  </div>` : ''}
</section>`;
    }
    let media = '';
    if (p.media === 'lottie' && p.lottie && fs.existsSync(path.join(SRC, 'img', p.lottie))) {
      const id = 'anim-' + String(b.id).replace(/[^\w-]/g, '');
      media = `<div class="hero-art" aria-hidden="true">
      <div class="hero-art-haze"></div>
      <div class="hero-art-anim" data-anim="${id}"${p.glow ? ' data-glow="galaxy"' : ''}></div>
      <script type="application/json" id="${id}">${lottieJson(p.lottie)}</script>
    </div>`;
      x.scripts.add('lottie-light'); x.scripts.add('hero-art');
    } else if (p.media === 'image' && picture) {
      media = `<div class="hero-art hero-art-img">${img(picture, '', 'aria-hidden="true"')}</div>`;
    }
    return `${openTag('section', 'hero hero-home', b, x)}
  <div class="wrap hero-home-row${media ? '' : ' hero-home-row-solo'}${p.media === 'image' && media ? ' hero-has-img' : ''}${p.layout === 'split-right' ? ' hero-home-row-rev' : ''}">
    ${media}
    <div class="hero-inner">
      ${text}
    </div>
  </div>
</section>`;
  },

  heading(p, b, x) {
    return `${openTag('section', 'blk-section blk-heading', b, x)}
  <div class="wrap">
    ${tr(p.eyebrow, x.lang) ? `<p class="eyebrow">${x.t(p.eyebrow)}</p>` : ''}
    <h2 class="section-title blk-size-${p.size === 's' || p.size === 'm' ? p.size : 'l'}">${x.t(p.title, 'título')}</h2>
    ${tr(p.text, x.lang) ? `<p class="section-intro">${x.t(p.text)}</p>` : ''}
  </div>
</section>`;
  },

  text(p, b, x) {
    const cls = p.size === 'm' ? 'blk-text' : 'about-text';
    return `${openTag('section', 'section', b, x)}
  <div class="wrap narrow">
    ${tr(p.title, x.lang) ? `<h2 class="section-title">${x.t(p.title)}</h2>` : ''}
    ${(p.paragraphs || []).map((q, i) => `<p class="${cls}">${x.md(q.text, `párrafo ${i + 1}`)}</p>`).join('\n    ')}
    ${tr(p.highlight, x.lang) ? `<p class="credit">${x.t(p.highlight)}</p>` : ''}
  </div>
</section>`;
  },

  image(p, b, x) {
    const picture = tr(p.image, x.lang);
    if (!picture) return x.preview ? `${openTag('section', 'blk-section', b, x)}<div class="wrap"><p class="blk-empty">Imagen: elige una en el panel de la derecha.</p></div></section>` : '';
    const to = resolveLink(p.link, x);
    const pic = img(picture, tr(p.alt, x.lang), 'loading="lazy"');
    return `${openTag('section', 'blk-section', b, x)}
  <div class="wrap">
    <figure class="blk-figure blk-figure-${p.size === 's' || p.size === 'm' ? p.size : 'l'}${p.frame ? ' blk-figure-frame' : ''}">
      ${to ? `<a ${linkAttrs(to)}>${pic}</a>` : pic}
      ${tr(p.caption, x.lang) ? `<figcaption>${x.t(p.caption)}</figcaption>` : ''}
    </figure>
  </div>
</section>`;
  },

  feature(p, b, x) {
    const picture = tr(p.image, x.lang, x.where('imagen'));
    const pic = img(picture, tr(p.title, x.lang), 'loading="lazy"');
    return `
  ${openTag('section', 'feature' + (p.side === 'left' ? ' feature-flip' : ''), b, x)}
    <div class="wrap feature-row">
      <div class="feature-text">
        ${tr(p.kicker, x.lang) ? `<p class="kicker">${x.t(p.kicker)}</p>` : ''}
        <h2>${x.t(p.title, 'título')}</h2>
        ${tr(p.text, x.lang) ? `<p>${x.t(p.text)}</p>` : ''}
        ${(p.bullets || []).length ? `<ul class="ticks">${p.bullets.map((q, i) => `<li>${x.t(q.text, `punto ${i + 1}`)}</li>`).join('')}</ul>` : ''}
      </div>
      ${picture ? (p.zoom ? `<a class="feature-media" href="${asset(picture)}" target="_blank" rel="noopener">${pic}</a>` : `<div class="feature-media">${pic}</div>`) : ''}
    </div>
  </section>`;
  },

  stats(p, b, x) {
    return `${openTag('section', 'stats', b, x)}
  <div class="wrap stats-row">
    ${(p.items || []).map((s, i) => `<div class="stat"><span class="stat-value">${esc(s.value)}</span><span class="stat-label">${x.t(s.label, `cifra ${i + 1}`)}</span></div>`).join('\n    ')}
  </div>
</section>`;
  },

  cards(p, b, x) {
    const cols = ['2', '4'].includes(p.columns) ? ` more-grid-${p.columns}` : '';
    return `${openTag('section', 'more', b, x)}
  <div class="wrap">
    ${tr(p.title, x.lang) ? `<h2 class="center">${x.t(p.title)}</h2>` : ''}
    <div class="more-grid${cols}">
      ${(p.items || []).map((m, i) => `<article class="more-card"><h3>${x.t(m.title, `tarjeta ${i + 1}`)}</h3><p>${x.t(m.text, `tarjeta ${i + 1}`)}</p></article>`).join('\n      ')}
    </div>
  </div>
</section>`;
  },

  showcase(p, b, x) {
    const mc = x.c.musicComposer;
    const to = resolveLink(p.link, x);
    const wrapLink = (cls, inner) => (to ? `<a class="${cls}" ${linkAttrs(to)}>${inner}</a>` : `<div class="${cls}">${inner}</div>`);
    const btns = buttons(p.buttons, x, x.where('botones'));
    const note = [tr(p.note, x.lang), p.available && mc.storeUrl ? tr(mc.download.available, x.lang) : ''].filter(Boolean).join(' · ');
    return `${openTag('section', 'showcase', b, x)}
  <div class="wrap">
    ${tr(p.eyebrow, x.lang) ? `<p class="eyebrow center">${x.t(p.eyebrow)}</p>` : ''}
    ${tr(p.logo, x.lang) ? wrapLink('showcase-logo', img(tr(p.logo, x.lang), p.name || '')) : ''}
    ${tr(p.text, x.lang) ? `<p class="lead center">${x.t(p.text)}</p>` : ''}
    ${tr(p.image, x.lang) ? wrapLink('hero-shot showcase-shot', img(tr(p.image, x.lang), p.name || '')) : ''}
    ${(p.cards || []).length ? `<div class="highlights">
      ${p.cards.map((h, i) => `<article class="more-card"><h3>${x.t(h.title, `tarjeta ${i + 1}`)}</h3><p>${x.t(h.text, `tarjeta ${i + 1}`)}</p></article>`).join('\n      ')}
    </div>` : ''}
    ${btns ? `<div class="cta-row center-row">\n      ${btns}\n    </div>` : ''}
    ${note ? `<p class="hero-note center">${esc(note)}</p>` : ''}
  </div>
</section>`;
  },

  pricing(p, b, x) {
    const mc = x.c.musicComposer;
    const store = resolveLink('store:', x), checkout = resolveLink('buy:', x);
    const dl = cls => (store ? `<a class="btn ${cls}" ${linkAttrs(store)}>${esc(tr(mc.download.button, x.lang))}</a>` : '');
    const buy = cls => (checkout ? `<a class="btn ${cls}" ${linkAttrs(checkout)}>${esc(tr(mc.buyButton, x.lang))}</a>` : '');
    const action = checkout ? buy('btn-red') + dl('btn-ghost') : dl('btn-red');
    const specs = (p.specs || []).length || tr(p.manualTitle, x.lang);
    const manual = tr(p.manualFile, x.lang);
    return `${openTag('section', 'pricing', b, x)}
  <div class="wrap pricing-row${specs ? '' : ' pricing-row-solo'}">
    <div class="price-card">
      ${tr(p.logo, x.lang) ? img(tr(p.logo, x.lang), p.name || '', 'class="price-logo"') : ''}
      <h2>${x.t(p.title, 'título')}</h2>
      <p class="price"><span class="price-value">${esc(mc.currency + mc.price)}</span> <span class="price-per">${x.t(p.per)}</span></p>
      <ul class="ticks">${(p.bullets || []).map((q, i) => `<li>${x.t(q.text, `punto ${i + 1}`)}</li>`).join('')}</ul>
      ${action ? `<div class="cta-row">${action}</div>` : ''}
      ${store ? `<p class="form-note">${esc(tr(mc.download.note, x.lang, 'musicComposer.download.note'))}</p>` : ''}
      ${tr(p.follow, x.lang) ? `<div class="follow">
        <p class="follow-label">${x.t(p.follow)}</p>
        ${socialLinks(x.c, 'follow-links')}
      </div>` : ''}
    </div>
    ${specs ? `<div class="specs">
      ${tr(p.specsTitle, x.lang) ? `<h3>${x.t(p.specsTitle)}</h3>` : ''}
      ${(p.specs || []).length ? `<ul class="ticks">${p.specs.map((q, i) => `<li>${x.t(q.text, `requisito ${i + 1}`)}</li>`).join('')}</ul>` : ''}
      ${tr(p.manualTitle, x.lang) ? `<h3>${x.t(p.manualTitle)}</h3>` : ''}
      ${manual ? `<a class="btn btn-ghost" href="${asset(manual)}" download>${x.t(p.manualLabel, 'botón del manual')}</a>` : ''}
    </div>` : ''}
  </div>
</section>`;
  },

  faq(p, b, x) {
    return `${openTag('section', 'faq', b, x)}
  <div class="wrap narrow">
    ${tr(p.title, x.lang) ? `<h2 class="center">${x.t(p.title)}</h2>` : ''}
    ${(p.items || []).map((f, i) => `<details><summary>${x.t(f.q, `pregunta ${i + 1}`)}</summary><p>${x.md(f.a, `respuesta ${i + 1}`)}</p></details>`).join('\n    ')}
    ${tr(p.supportTitle, x.lang) ? `<div class="support-box">
      <h3>${x.t(p.supportTitle)}</h3>
      <p>${x.t(p.supportText)} <a href="mailto:${esc(x.c.site.email)}">${esc(x.c.site.email)}</a></p>
    </div>` : ''}
  </div>
</section>`;
  },

  buttons(p, b, x) {
    const btns = buttons(p.buttons, x, x.where('botones'));
    if (!btns) return x.preview ? `${openTag('section', 'blk-section', b, x)}<div class="wrap"><p class="blk-empty">Botones: ninguno tiene un link que funcione todavía.</p></div></section>` : '';
    return `${openTag('section', 'blk-section', b, x)}
  <div class="wrap">
    <div class="cta-row blk-buttons">
      ${btns}
    </div>
  </div>
</section>`;
  },

  social(p, b, x) {
    return `${openTag('section', 'blk-section', b, x)}
  <div class="wrap">
    <div class="follow blk-social">
      ${tr(p.text, x.lang) ? `<p class="follow-label">${x.t(p.text)}</p>` : ''}
      ${socialLinks(x.c, 'follow-links')}
    </div>
  </div>
</section>`;
  },

  contact(p, b, x) {
    x.scripts.add('contact');
    return contactSection(x.c, x.lang, tr(p.title, x.lang, x.where('título')), tr(p.text, x.lang, x.where('texto')), openTag('section', 'section', b, x));
  },

  productbar(p, b, x) {
    const logoTo = resolveLink(p.logoLink, x) || { href: href(x.lang, x.page.path) };
    const mc = x.c.musicComposer;
    const checkout = resolveLink('buy:', x), store = resolveLink('store:', x);
    const btn = !p.button ? '' : checkout ? `<a class="btn btn-red btn-small" ${linkAttrs(checkout)}>${esc(tr(mc.buyButton, x.lang))}</a>`
      : store ? `<a class="btn btn-red btn-small" ${linkAttrs(store)}>${esc(tr(mc.download.button, x.lang))}</a>` : '';
    return `${openTag('nav', 'product-bar', b, x)}
  <div class="wrap product-bar-row">
    <a class="product-bar-logo" ${linkAttrs(logoTo)}>${tr(p.logo, x.lang) ? img(tr(p.logo, x.lang), p.name || '') : esc(p.name || '')}</a>
    <div class="product-bar-links">
      ${(p.links || []).map((l, i) => { const to = resolveLink(l.link, x); return to ? `<a ${linkAttrs(to)}>${x.t(l.label, `link ${i + 1}`)}</a>` : ''; }).filter(Boolean).join('\n      ')}
      ${btn}
    </div>
  </div>
</nav>`;
  },

  spacer(p, b, x) {
    return `${openTag('div', `blk-spacer blk-spacer-${['s', 'l'].includes(p.size) ? p.size : 'm'}`, b, x)}${p.line ? '<div class="wrap"><hr class="blk-line"></div>' : ''}</div>`;
  }
};

// a page of blocks, in one language
function blockPage(c, pages, page, lang, preview) {
  const x = {
    c, lang, page, pages, preview, scripts: new Set(),
    where: () => '', t: null, md: null
  };
  const blocks = page.blocks.filter(b => preview || !b.hidden);
  const body = blocks.map((b) => {
    const label = (BLOCKS[b.type] || {}).label || b.type;
    x.where = what => `página ${page.id || '(nueva)'} → ${label}${what ? ' → ' + what : ''}`;
    x.t = (v, what) => esc(tr(v, lang, x.where(what)));
    x.md = (v, what) => inlineMd(tr(v, lang, x.where(what)));
    try {
      return RENDER[b.type] ? RENDER[b.type](b.props || {}, b, x) : '';
    } catch (err) {
      return preview ? `<section class="blk-section"><div class="wrap"><p class="blk-empty">Este bloque no se pudo mostrar: ${esc(err.message)}</p></div></section>` : '';
    }
  }).join('\n\n');
  return {
    path: page.path,
    title: tr(page.title, lang, `página ${page.id} → título`) || c.site.name,
    description: tr(page.description, lang),
    image: tr(page.image, lang),
    nav: homeNav(c, lang, x),
    scripts: [...x.scripts],
    body,
    preview
  };
}

// ---------------------------------------------------------------- contact form

// The form's own words (labels, checks, the sent / not sent messages). They
// live here rather than in site.json because they are part of how the form
// works; the section's title and intro are in site.json (home.contact).
const CONTACT_UI = {
  en: {
    name: 'Full name', country: 'Country', countryPlaceholder: 'Select your country', countrySearch: 'Search country',
    noCountry: 'No country matches', email: 'Email', emailPlaceholder: 'name@example.com', phone: 'Phone',
    optional: 'optional', message: 'Message', messagePlaceholder: 'How can we help?',
    send: 'Send message', sending: 'Sending…',
    note: 'We only use your details to answer you.',
    errName: 'Please enter your name.', errCountry: 'Please choose your country.',
    errEmail: 'Please enter your email.', errEmailBad: 'That email doesn\'t look right. Example: name@example.com',
    errPhone: 'That phone number doesn\'t look right. Use digits, spaces and an optional + at the start.',
    errMessage: 'Please write your message.',
    sentTitle: 'Message sent', sentText: 'Thanks, {name}. We got your message and will reply to {email}.',
    sentAgain: 'Send another message', sentPlain: 'Thanks for writing. We got your message and will reply by email.',
    sentBack: 'Back to home',
    failTitle: 'Your message wasn\'t sent', failText: 'Check your connection and try again. If it keeps failing, write to us at {email}.'
  },
  es: {
    name: 'Nombre completo', country: 'País', countryPlaceholder: 'Elige tu país', countrySearch: 'Buscar país',
    noCountry: 'Ningún país coincide', email: 'Email', emailPlaceholder: 'nombre@ejemplo.com', phone: 'Teléfono',
    optional: 'opcional', message: 'Mensaje', messagePlaceholder: '¿En qué podemos ayudarte?',
    send: 'Enviar mensaje', sending: 'Enviando…',
    note: 'Solo usamos tus datos para responderte.',
    errName: 'Escribe tu nombre.', errCountry: 'Elige tu país.',
    errEmail: 'Escribe tu email.', errEmailBad: 'Ese email no parece correcto. Ejemplo: nombre@ejemplo.com',
    errPhone: 'Ese teléfono no parece correcto. Usa números, espacios y, si quieres, un + al principio.',
    errMessage: 'Escribe tu mensaje.',
    sentTitle: 'Mensaje enviado', sentText: 'Gracias, {name}. Recibimos tu mensaje y te responderemos a {email}.',
    sentAgain: 'Enviar otro mensaje', sentPlain: 'Gracias por escribirnos. Recibimos tu mensaje y te responderemos por email.',
    sentBack: 'Volver al inicio',
    failTitle: 'Tu mensaje no se envió', failText: 'Revisa tu conexión y vuelve a intentarlo. Si sigue fallando, escríbenos a {email}.'
  }
};

// ISO 3166-1 countries and territories; their names come from the build
// machine's Intl data, in each page's language
const COUNTRIES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
  'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET ' +
  'FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO ' +
  'IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH ' +
  'MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM ' +
  'PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG ' +
  'TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');

// Where messages go: with a Web3Forms access key in site.json
// (site.contactFormKey) each message arrives by email; without one they stay
// in Netlify Forms (the "contact" form). Either way it works without
// JavaScript too, ending on the /sent/ page. js/contact.js adds the flag
// picker, the checks and sending without leaving the page.
const WEB3FORMS = 'https://api.web3forms.com/submit';

function contactSection(c, lang, title, text, open) {
  const u = CONTACT_UI[lang];
  const key = (c.site.contactFormKey || '').trim();
  const formOpen = key
    ? `<form id="contact-form" class="contact-form" name="contact" method="POST" action="${WEB3FORMS}" data-endpoint="${WEB3FORMS}" data-ui="%UI%">
        <input type="hidden" name="access_key" value="${esc(key)}">
        <input type="hidden" name="subject" value="New message from gavna.digital (${lang.toUpperCase()})">
        <input type="hidden" name="from_name" value="gavna.digital">
        <input type="hidden" name="redirect" value="${esc(c.site.url + href(lang, 'sent'))}">
        <p class="hidden-field"><input type="checkbox" name="botcheck" tabindex="-1" autocomplete="off"></p>`
    : `<form id="contact-form" class="contact-form" name="contact" method="POST" action="${href(lang, 'sent')}" data-netlify="true" netlify-honeypot="bot-field" data-ui="%UI%">
        <input type="hidden" name="form-name" value="contact">
        <p class="hidden-field"><label>Leave this empty: <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>`;
  const names = new Intl.DisplayNames([lang], { type: 'region' });
  const english = new Intl.DisplayNames(['en'], { type: 'region' });
  const order = new Intl.Collator(lang);
  const countries = COUNTRIES.map(code => ({ code, name: names.of(code), value: `${english.of(code)} (${code})` }))
    .sort((a, b) => order.compare(a.name, b.name));
  const ui = Object.assign({}, u, { supportEmail: c.site.email });
  const field = (id, label, control, wide) => `
        <div class="form-field${wide ? ' form-field-wide' : ''}">
          <label for="cf-${id}">${label}</label>
          ${control}
          <p class="field-error" id="cf-${id}-error"></p>
        </div>`;
  return `${open}
  <div class="wrap contact-row">
    <div class="contact-intro">
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
    </div>
    <div class="contact-card">
      ${formOpen.replace('%UI%', () => esc(JSON.stringify(ui)))}
        <input type="hidden" name="language" value="${lang}">
        <div class="form-grid">${
  field('name', esc(u.name), `<input class="input" id="cf-name" name="name" type="text" autocomplete="name" maxlength="100" required>`)}${
  field('country', esc(u.country), `<select class="input country-select" id="cf-country" name="country" autocomplete="country" required>
            <option value="">${esc(u.countryPlaceholder)}</option>${countries.map(x => `
            <option value="${esc(x.value)}" data-code="${x.code}">${esc(x.name)}</option>`).join('')}
          </select>`)}${
  field('email', esc(u.email), `<input class="input" id="cf-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="${esc(u.emailPlaceholder)}" required>`)}${
  field('phone', `${esc(u.phone)} <span class="optional">(${esc(u.optional)})</span>`, `<input class="input" id="cf-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30">`)}${
  field('message', esc(u.message), `<textarea class="input" id="cf-message" name="message" rows="6" maxlength="5000" placeholder="${esc(u.messagePlaceholder)}" required></textarea>`, true)}
        </div>
        <div class="form-alert" role="alert" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>
          <div><strong>${esc(u.failTitle)}</strong><p></p></div>
        </div>
        <div class="form-actions">
          <p class="form-note">${esc(u.note)} <a href="${href(lang, 'legal/privacy')}">${esc(tr(c.footer.privacy, lang))}</a></p>
          <button class="btn btn-red" type="submit"><span class="spinner" aria-hidden="true"></span><span class="btn-label">${esc(u.send)}</span></button>
        </div>
      </form>
      <div class="contact-done" tabindex="-1" hidden>
        <div class="done-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h3>${esc(u.sentTitle)}</h3>
        <p></p>
        <button class="btn btn-ghost btn-small" type="button">${esc(u.sentAgain)}</button>
      </div>
    </div>
  </div>
</section>`;
}

function textPage(c, lang, pathName, title, inner, theme) {
  return {
    path: pathName, theme: theme || 'plain', title: `${title} — Gavna`, description: title,
    nav: homeNav(c, lang),
    body: `<section class="section"><div class="wrap narrow ${theme === 'plain' || !theme ? 'legal' : ''}">${inner}</div></section>`
  };
}

function legalPage(c, lang, name) {
  const file = path.join(ROOT, 'content', 'legal', `${name}.${lang}.md`);
  const md = fs.readFileSync(file, 'utf8');
  const title = (/^# (.*)/m.exec(md) || [, name])[1];
  return textPage(c, lang, 'legal/' + name, title, markdown(md));
}

// where Creem sends a buyer after paying (the product's Return URL):
// how to activate the key they just got
function purchasedPage(c, lang) {
  const p = c.purchased, mc = c.musicComposer;
  const t = (v, w) => esc(tr(v, lang, w && 'purchased.' + w));
  return textPage(c, lang, 'purchased', tr(p.title, lang, 'purchased.title'),
    `<div class="message purchased"><h1>${t(p.title)}</h1><p>${t(p.text, 'text')}</p>
     <ol class="steps">${p.steps.map((s, i) => `<li>${t(s, `steps[${i}]`)}</li>`).join('')}</ol>
     ${mc.storeUrl ? `<a class="btn btn-red" href="${esc(mc.storeUrl)}" target="_blank" rel="noopener">${t(p.storeButton, 'storeButton')}</a>` : ''}
     <p class="purchased-help">${t(p.help, 'help')} <a href="mailto:${esc(c.site.email)}">${esc(c.site.email)}</a></p></div>`, 'message');
}

// where the contact form ends when the browser has no JavaScript
function sentPage(c, lang) {
  const u = CONTACT_UI[lang];
  return textPage(c, lang, 'sent', u.sentTitle,
    `<div class="message"><h1>${esc(u.sentTitle)}</h1><p>${esc(u.sentPlain)}</p>
     <a class="btn btn-red" href="${href(lang, '')}">${esc(u.sentBack)}</a></div>`, 'message');
}

function notFoundPage(c) {
  const inner = LANGS.map(l => `<div class="message" lang="${l}"><h1>404</h1><p>${esc(tr(c.footer.notFound, l))}</p><a class="btn btn-red" href="${href(l, '')}">${esc(tr(c.footer.home, l))}</a></div>`).join('');
  const p = textPage(c, 'en', '', 'Not found', inner, 'message');
  p.title = '404 — Gavna';
  return p;
}

// ---------------------------------------------------------------- build

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

function write(rel, text) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

// file fingerprints for ?v=, so browsers never keep an old copy (the files
// are cached for a year): site.css, site.js and each page script by name
function versionsOf() {
  const versions = { css: hashOf(path.join(SRC, 'css', 'site.css')), js: hashOf(path.join(SRC, 'js', 'site.js')),
    favicon: hashOf(path.join(SRC, 'img', 'favicon.svg')), scripts: {},
    fonts: crypto.createHash('sha1').update(fontsCss(listFonts())).digest('hex').slice(0, 10) };
  for (const f of fs.readdirSync(path.join(SRC, 'js'))) {
    if (f.endsWith('.js')) versions.scripts[f.slice(0, -3)] = hashOf(path.join(SRC, 'js', f));
  }
  return versions;
}

const readContent = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'site.json'), 'utf8'));

// The panel's live preview: one page (maybe not saved yet), with the site
// data the panel has (maybe not saved either), as one HTML document.
function preview(c, pages, page, lang) {
  missing = [];
  syncFonts();
  const l = LANGS.includes(lang) ? lang : 'en';
  const p = blockPage(c, pages, page, l, true);
  p.versions = versionsOf();
  return { html: layout(c, l, p), missing: [...new Set(missing)] };
}

// Shown only in the panel's preview: clicking a block selects it in the
// panel, and the panel can point at a block. Links don't navigate away.
const PREVIEW_HELPER = `<style>
[data-block]{cursor:pointer;outline-offset:-2px}
[data-block]:hover{outline:1px dashed rgba(255,44,74,.55)}
[data-block].is-picked{outline:2px solid #FF2C4A}
.blk-hidden{opacity:.3}
</style>
<script>
(function(){
  document.addEventListener('click',function(e){
    var a=e.target.closest('a,button,summary');
    if(a&&!a.closest('.nav-drop')&&!a.closest('.cp')&&a.tagName!=='SUMMARY')e.preventDefault();
    var b=e.target.closest('[data-block]');
    if(b)parent.postMessage({gavnaPick:b.getAttribute('data-block')},'*');
  },true);
  document.addEventListener('submit',function(e){e.preventDefault();},true);
  window.addEventListener('message',function(e){
    var d=e.data||{};
    if(d.gavnaShow===undefined)return;
    [].forEach.call(document.querySelectorAll('[data-block].is-picked'),function(n){n.classList.remove('is-picked');});
    var n=d.gavnaShow&&document.querySelector('[data-block="'+String(d.gavnaShow).replace(/"/g,'')+'"]');
    if(n){n.classList.add('is-picked');if(d.scroll)n.scrollIntoView({block:'center',behavior:'smooth'});}
  });
  parent.postMessage({gavnaReady:true},'*');
})();
</script>`;

function build() {
  const c = readContent();
  missing = [];
  fs.rmSync(DIST, { recursive: true, force: true });
  copyDir(SRC, DIST);
  syncFonts();
  const versions = versionsOf();
  const blockPages = readPages();

  const pages = [];
  for (const lang of LANGS) {
    const base = lang === 'en' ? '' : 'es/';
    const add = (p) => { p.versions = versions; pages.push(p.path); write(base + (p.path ? p.path + '/' : '') + 'index.html', layout(c, lang, p)); };
    for (const pg of blockPages) add(blockPage(c, blockPages, pg, lang, false));
    for (const name of ['privacy', 'terms', 'refunds']) add(legalPage(c, lang, name));
    add(sentPage(c, lang));
    add(purchasedPage(c, lang));
  }
  const nf = notFoundPage(c); nf.versions = versions;
  write('404.html', layout(c, 'en', nf));

  write('_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/css/*
  Cache-Control: public, max-age=31536000, immutable
/js/*
  Cache-Control: public, max-age=31536000, immutable
`);
  const urls = [];
  for (const lang of LANGS) for (const p of [...blockPages.map(pg => pg.path), 'legal/privacy', 'legal/terms', 'legal/refunds']) urls.push(c.site.url + href(lang, p));
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /sent/\nDisallow: /es/sent/\nDisallow: /purchased/\nDisallow: /es/purchased/\nSitemap: ${c.site.url}/sitemap.xml\n`);

  return { pages: pages.length + 1, missing: [...new Set(missing)] };
}

// ---------------------------------------------------------------- zip

// A plain .zip (deflate) with forward-slash paths and index.html at the root,
// the way Netlify's drag-and-drop upload expects it.
function pack() {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const a = path.join(dir, e.name);
      if (e.isDirectory()) walk(a); else files.push(a);
    }
  })(DIST);
  const parts = [], central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(path.relative(DIST, file).split(path.sep).join('/'), 'utf8');
    const data = fs.readFileSync(file);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10); cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(ZIP, Buffer.concat([...parts, cd, end]));
  return { file: ZIP, files: files.length, bytes: fs.statSync(ZIP).size };
}

module.exports = { build, pack, preview, readPages, pageProblem, listFonts, syncFonts, FONT_MAGIC, ROOT, DIST, ZIP, PAGES_DIR, PAGE_ID };

if (require.main === module) {
  const r = build();
  console.log(`dist/: ${r.pages} pages`);
  if (r.missing.length) console.log('Missing translations:\n  ' + r.missing.join('\n  '));
  if (process.argv[2] === 'pack') {
    const z = pack();
    console.log(`${path.basename(z.file)}: ${z.files} files, ${(z.bytes / 1048576).toFixed(1)} MB`);
  }
}
