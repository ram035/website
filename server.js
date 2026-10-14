/* =========================================================
   server.js — servidor local para el sitio + CMS
   Uso:  node server.js        →  http://127.0.0.1:4321
                                  http://127.0.0.1:4321/admin/
   Sin dependencias. Sólo escucha en localhost.
   NO hace falta subirlo al hosting: el sitio publicado es
   estático (index.html, css/, js/, data/, img/, projects/).
   ========================================================= */

const http = require("http");
const fs   = require("fs");
const fsp  = require("fs/promises");
const path = require("path");
const url  = require("url");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data", "projects.json");
const PROJECTS_DIR = path.join(ROOT, "projects");
const IMG_DIR = path.join(ROOT, "img");
const PORT = Number(process.env.PORT) || 4321;
const HOST = "127.0.0.1";
const MAX_UPLOAD = 512 * 1024 * 1024; // 512 MB

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".jpg":  "image/jpeg", ".jpeg": "image/jpeg",
  ".png":  "image/png",  ".gif":  "image/gif",
  ".webp": "image/webp", ".avif": "image/avif",
  ".mp4":  "video/mp4",  ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3":  "audio/mpeg", ".wav":  "audio/wav",  ".ogg": "audio/ogg",
  ".woff2":"font/woff2", ".woff": "font/woff",
  ".ico":  "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".pdf":  "application/pdf"
};

/* ---------------- utilidades ---------------- */

function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({ "Cache-Control": "no-store" }, headers));
  res.end(body);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj, null, 2), { "Content-Type": MIME[".json"] });
}

function safeName(name) {
  return String(name || "archivo")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80) || "archivo";
}

function safeId(id) {
  return /^[a-zA-Z0-9_-]{1,40}$/.test(String(id || "")) ? String(id) : null;
}

async function readData() {
  try {
    const raw = await fsp.readFile(DATA, "utf8");
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj.projects)) obj.projects = [];
    if (!obj.site) obj.site = {};
    return obj;
  } catch (e) {
    return { site: { title: "Portfolio", url: "https://ramiropiedrabuena.website" }, projects: [] };
  }
}

async function writeData(obj) {
  await fsp.mkdir(path.dirname(DATA), { recursive: true });
  try { await fsp.copyFile(DATA, DATA + ".bak"); } catch (e) {}
  const tmp = DATA + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, DATA);
}

/* ---------------- archivos sin usar ----------------
   Un archivo está en uso si su ruta aparece en data/projects.json. Se mira de
   dos maneras a la vez, a propósito: los valores sueltos del JSON (src, icon,
   token.image, el fondo…) y además un barrido del texto completo buscando
   cualquier cosa que empiece con projects/ o img/. Lo segundo alcanza también
   a las rutas escondidas dentro de un código de embed. Ante la duda, un
   archivo cuenta como en uso: equivocarse para el otro lado significa tocar
   algo que hacía falta. */

const PAPELERA = path.join(ROOT, ".papelera");

function normalizarRuta(v) {
  if (typeof v !== "string") return "";
  let r = v.trim();
  if (!r || /^[a-z]+:/i.test(r)) return "";        // http:, data:, mailto:…
  r = r.split("?")[0].split("#")[0].replace(/^\.?\//, "");
  return r.toLowerCase().replace(/\\/g, "/");
}

function rutasEnUso(texto) {
  const usadas = new Set();
  const sumar = v => { const r = normalizarRuta(v); if (r) usadas.add(r); };

  // 1) todos los valores de cadena del JSON
  (function recorrer(n) {
    if (Array.isArray(n)) return n.forEach(recorrer);
    if (n && typeof n === "object") return Object.keys(n).forEach(k => recorrer(n[k]));
    if (typeof n === "string") sumar(n);
  })(JSON.parse(texto));

  // 2) y cualquier ruta escrita dentro del texto, aunque sea parte de un HTML
  const encontradas = texto.match(/(?:projects|img)\/[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)*/g) || [];
  encontradas.forEach(sumar);

  return usadas;
}

async function listarArchivos(dir, base) {
  let salida = [];
  let entradas;
  try { entradas = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return salida; }
  for (const e of entradas) {
    if (e.name.startsWith(".")) continue;               // .papelera y ocultos
    const completo = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) salida = salida.concat(await listarArchivos(completo, rel));
    else if (e.isFile()) {
      const st = await fsp.stat(completo);
      salida.push({ src: rel, bytes: st.size });
    }
  }
  return salida;
}

/* El código del sitio también usa archivos de img/ (el favicon, por ejemplo):
   esos cuentan como en uso aunque projects.json ya no los nombre. */
async function rutasDelCodigo() {
  const usadas = new Set();
  const fuentes = [path.join(ROOT, "index.html")];
  for (const d of ["css", "js"]) {
    try {
      (await fsp.readdir(path.join(ROOT, d))).forEach(n => fuentes.push(path.join(ROOT, d, n)));
    } catch {}
  }
  for (const f of fuentes) {
    let t;
    try { t = await fsp.readFile(f, "utf8"); } catch { continue; }
    (t.match(/(?:projects|img)\/[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)*/g) || [])
      .forEach(r => usadas.add(r.toLowerCase()));
  }
  return usadas;
}

async function enUso() {
  const usadas = rutasEnUso(await fsp.readFile(DATA, "utf8"));
  (await rutasDelCodigo()).forEach(r => usadas.add(r));
  return usadas;
}

/* Aparta archivos a .papelera/<fecha>/ conservando su ruta. No borra nada. */
async function apartar(srcs) {
  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const destino = path.join(PAPELERA, sello);
  const movidos = [];
  for (const src of srcs) {
    const origen = path.join(ROOT, src);
    const fin = path.join(destino, src);
    await fsp.mkdir(path.dirname(fin), { recursive: true });
    try {
      await fsp.rename(origen, fin);
    } catch {
      // rename falla entre volúmenes: se copia y recién después se saca
      await fsp.copyFile(origen, fin);
      await fsp.unlink(origen);
    }
    movidos.push(src);
  }
  return { moved: movidos, total: movidos.length, dest: movidos.length ? ".papelera/" + sello : "" };
}

/* Los íconos de botón son una biblioteca: se ofrecen en el panel aunque
   ningún post los use todavía, así que nunca cuentan como sobrantes. */
const ICONOS_BOTON = "img/button-icons/";
const ICONOS_DIR = path.join(IMG_DIR, "button-icons");

/* Una página HTML de la carpeta usa sus archivos desde su propio código
   (imágenes, estilos…), que projects.json no nombra: toda la carpeta de una
   página así cuenta como en uso. */
async function carpetasDePaginasHtml() {
  const data = await readData();
  return data.projects
    .filter(p => p.kind === "html")
    .map(p => ("projects/" + p.id + "/").toLowerCase());
}

async function archivosApartables() {
  const todos = (await listarArchivos(PROJECTS_DIR, "projects"))
          .concat(await listarArchivos(IMG_DIR, "img"));
  const protegidas = [ICONOS_BOTON].concat(await carpetasDePaginasHtml());
  return todos.filter(a => {
    const r = a.src.toLowerCase();
    return !protegidas.some(pre => r.startsWith(pre));
  });
}

async function archivosSinUsar() {
  const usadas = await enUso();
  return (await archivosApartables()).filter(a => !usadas.has(a.src.toLowerCase()));
}

function bodyJson(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new Error("body demasiado grande")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function nextProjectId(data) {
  const used = new Set(data.projects.map(p => p.id));
  try {
    (await fsp.readdir(PROJECTS_DIR)).forEach(d => used.add(d));
  } catch (e) {}
  let n = 1;
  while (used.has("proj" + String(n).padStart(4, "0"))) n++;
  return "proj" + String(n).padStart(4, "0");
}

/* ---------------- API ---------------- */

async function api(req, res, pathname, query) {
  const method = req.method.toUpperCase();

  // GET /api/projects  → contenido de data/projects.json
  if (pathname === "/api/projects" && method === "GET") {
    return json(res, 200, await readData());
  }

  // PUT /api/projects  → guarda el JSON completo
  if (pathname === "/api/projects" && method === "PUT") {
    const incoming = await bodyJson(req);
    if (!incoming || !Array.isArray(incoming.projects)) {
      return json(res, 400, { error: "Formato inválido: falta 'projects'." });
    }
    await writeData(incoming);
    return json(res, 200, { ok: true, saved: incoming.projects.length });
  }

  // POST /api/project  → crea proyecto vacío (carpeta + entrada)
  if (pathname === "/api/project" && method === "POST") {
    const body = await bodyJson(req).catch(() => ({}));
    const data = await readData();
    const id = safeId(body.id) || await nextProjectId(data);
    if (data.projects.some(p => p.id === id)) {
      return json(res, 409, { error: "Ya existe un proyecto con ese id." });
    }
    await fsp.mkdir(path.join(PROJECTS_DIR, id), { recursive: true });
    // Los campos traducibles se guardan como { es, en }.
    const project = {
      id,
      title: { es: body.title || "Proyecto sin título", en: "" },
      subtitle: { es: "", en: "" },
      role: { es: "", en: "" },
      year: "",
      theme: "dark",
      tags: { category: [], industry: [] },
      token: { image: "", width: 200, x: 0.5, y: 0.5, rotation: 0 },
      blocks: []
    };
    data.projects.push(project);
    await writeData(data);
    return json(res, 201, { ok: true, project });
  }

  // DELETE /api/project?id=proj0001[&files=1]
  if (pathname === "/api/project" && method === "DELETE") {
    const id = safeId(query.id);
    if (!id) return json(res, 400, { error: "id inválido" });
    const data = await readData();
    const before = data.projects.length;
    data.projects = data.projects.filter(p => p.id !== id);
    if (data.projects.length === before) return json(res, 404, { error: "no existe" });
    await writeData(data);
    if (query.files === "1") {
      try { await fsp.rm(path.join(PROJECTS_DIR, id), { recursive: true, force: true }); } catch (e) {}
    }
    return json(res, 200, { ok: true });
  }

  // POST /api/project/rename  { from, to } → renombra carpeta e id de un proyecto
  if (pathname === "/api/project/rename" && method === "POST") {
    const body = await bodyJson(req).catch(() => ({}));
    const from = safeId(body.from), to = safeId(body.to);
    if (!from || !to) {
      return json(res, 400, { error: "Nombre inválido: sólo letras, números, guion y guion bajo (hasta 40)." });
    }
    if (from === to) return json(res, 400, { error: "Es el mismo nombre." });
    const data = await readData();
    const project = data.projects.find(p => p.id === from);
    if (!project) return json(res, 404, { error: "No existe el proyecto " + from + "." });
    const ocupado = data.projects.some(p => p !== project &&
      [p.id].concat(p.aliases || []).some(n => n.toLowerCase() === to.toLowerCase()));
    if (ocupado) return json(res, 409, { error: "Ese nombre ya lo usa otro proyecto." });

    const viejo = path.join(PROJECTS_DIR, from), nuevo = path.join(PROJECTS_DIR, to);
    const soloMayusculas = from.toLowerCase() === to.toLowerCase();   // Windows no distingue
    if (!soloMayusculas && fs.existsSync(nuevo)) {
      return json(res, 409, { error: "Ya hay una carpeta projects/" + to + "." });
    }
    // Primero la carpeta. Si después falla guardar el JSON, se deshace: nunca
    // quedan la carpeta con un nombre y los datos con otro.
    const renombrar = async (a, b) => {
      if (!fs.existsSync(a)) return fsp.mkdir(b, { recursive: true });
      if (soloMayusculas) {
        const tmp = a + ".renombrando";
        await fsp.rename(a, tmp);
        return fsp.rename(tmp, b);
      }
      return fsp.rename(a, b);
    };
    await renombrar(viejo, nuevo);

    // Todas las rutas projects/<from>/… de todo el JSON (también las que viven
    // dentro de un código de embed) pasan a projects/<to>/….
    const re = new RegExp("(^|[^A-Za-z0-9_-])projects/" + from.replace(/[-_]/g, "\\$&") + "(?=/)", "g");
    let rutas = 0;
    const reescribir = n => {
      if (Array.isArray(n)) return n.map(reescribir);
      if (n && typeof n === "object") {
        Object.keys(n).forEach(k => { n[k] = reescribir(n[k]); });
        return n;
      }
      if (typeof n === "string") {
        return n.replace(re, (m, antes) => { rutas++; return antes + "projects/" + to; });
      }
      return n;
    };
    reescribir(data);
    project.id = to;
    // el nombre viejo queda como alias: los links que ya circulan siguen andando
    project.aliases = Array.from(new Set((project.aliases || []).concat(from)))
                           .filter(n => n.toLowerCase() !== to.toLowerCase());

    try {
      await writeData(data);
    } catch (e) {
      try { await renombrar(nuevo, viejo); } catch (e2) {}
      throw e;
    }
    return json(res, 200, { ok: true, id: to, rutas, aliases: project.aliases });
  }

  // POST /api/pack → arma _subir/ y el zip para Netlify (botón de Configuración)
  if (pathname === "/api/pack" && method === "POST") {
    return json(res, 200, await empaquetar());
  }

  // GET /api/site-files → los archivos del sitio a los que puede llevar una dirección corta
  if (pathname === "/api/site-files" && method === "GET") {
    const files = (await listarArchivos(PROJECTS_DIR, "projects"))
      .concat(await listarArchivos(IMG_DIR, "img"))
      .filter(f => !f.src.toLowerCase().startsWith(ICONOS_BOTON))
      .map(f => f.src)
      .sort();
    return json(res, 200, { files });
  }

  // GET /api/button-icons → los íconos que el panel ofrece para los botones
  if (pathname === "/api/button-icons" && method === "GET") {
    let nombres = [];
    try { nombres = await fsp.readdir(ICONOS_DIR); } catch {}
    const icons = nombres
      .filter(n => !n.startsWith(".") && /\.(webp|png|svg|avif|jpe?g|gif)$/i.test(n))
      .sort()
      .map(n => ICONOS_BOTON + n);
    return json(res, 200, { icons });
  }

  // GET /api/unused → qué archivos no están referenciados en projects.json
  if (pathname === "/api/unused" && method === "GET") {
    const sueltos = await archivosSinUsar();
    return json(res, 200, {
      files: sueltos,
      total: sueltos.length,
      bytes: sueltos.reduce((a, f) => a + f.bytes, 0)
    });
  }

  // POST /api/unused/clean → los aparta en .papelera/<fecha>/ (no los borra)
  if (pathname === "/api/unused/clean" && method === "POST") {
    const sueltos = await archivosSinUsar();
    return json(res, 200, await apartar(sueltos.map(f => f.src)));
  }

  // POST /api/discard  { files: [...] } → el panel, después de guardar, manda
  // lo que se reemplazó o quitó. Sólo se aparta lo que sigue existiendo y nada
  // usa ya (ni projects.json ni el código del sitio).
  if (pathname === "/api/discard" && method === "POST") {
    const body = await bodyJson(req).catch(() => ({}));
    const pedidos = Array.isArray(body.files) ? body.files : [];
    const usadas = await enUso();
    const todos = await archivosApartables();
    const porRuta = new Map(todos.map(a => [a.src.toLowerCase(), a.src]));
    const elegidos = new Set();
    pedidos.forEach(v => {
      const r = normalizarRuta(v);
      if (porRuta.has(r) && !usadas.has(r)) elegidos.add(porRuta.get(r));
    });
    return json(res, 200, await apartar(Array.from(elegidos)));
  }

  // GET /api/project/files?id=x → los archivos de la carpeta de un proyecto
  if (pathname === "/api/project/files" && method === "GET") {
    const id = safeId(query.id);
    if (!id) return json(res, 400, { error: "id inválido" });
    const files = await listarArchivos(path.join(PROJECTS_DIR, id), "");
    return json(res, 200, { files: files.sort((a, b) => a.src.localeCompare(b.src)) });
  }

  // PUT /api/project/html?id=x&name=pagina.html  (cuerpo = el HTML) → la escribe
  if (pathname === "/api/project/html" && method === "PUT") {
    const id = safeId(query.id);
    const name = safeName(query.name);
    if (!id) return json(res, 400, { error: "id inválido" });
    if (!/\.html?$/i.test(name)) return json(res, 400, { error: "sólo archivos .html" });
    const texto = await new Promise((resolve, reject) => {
      let size = 0; const partes = [];
      req.on("data", c => {
        size += c.length;
        if (size > 5 * 1024 * 1024) { req.destroy(); reject(new Error("demasiado grande")); return; }
        partes.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
      req.on("error", reject);
    });
    const dir = path.join(PROJECTS_DIR, id);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, "." + name + ".tmp");
    await fsp.writeFile(tmp, texto, "utf8");
    await fsp.rename(tmp, path.join(dir, name));
    return json(res, 200, { ok: true, src: "projects/" + id + "/" + name, name });
  }

  // POST /api/upload?id=proj0001&name=archivo.jpg   (cuerpo = binario crudo)
  if (pathname === "/api/upload" && method === "POST") {
    // to=img guarda en img/ (cosas del sitio, como el fondo); si no, en la
    // carpeta del proyecto.
    const alSitio = query.to === "img";
    const id = alSitio ? "" : safeId(query.id);
    if (!alSitio && !id) return json(res, 400, { error: "id inválido" });
    const dir = alSitio ? IMG_DIR : path.join(PROJECTS_DIR, id);
    await fsp.mkdir(dir, { recursive: true });

    let name = safeName(query.name);
    let dest = path.join(dir, name);
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    let i = 1;
    while (fs.existsSync(dest)) { name = `${base}-${i++}${ext}`; dest = path.join(dir, name); }

    await new Promise((resolve, reject) => {
      let size = 0;
      const out = fs.createWriteStream(dest);
      req.on("data", c => {
        size += c.length;
        if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); reject(new Error("archivo demasiado grande")); }
      });
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
    });

    const src = alSitio ? `img/${name}` : `projects/${id}/${name}`;
    return json(res, 201, { ok: true, src, name });
  }

  return json(res, 404, { error: "endpoint desconocido" });
}

/* ---------------- empaquetado para Netlify ----------------
   Lo mismo que describe DEPLOY.md, en un botón: verifica, arma _subir/ con
   lo publicable y el zip ../ramiropiedrabuena-netlify.zip (rutas con "/",
   index.html en la raíz). Nunca va: admin/, server.js, documentos,
   .papelera, projects.json.bak, ni archivos que nada usa. Las direcciones
   cortas se agregan al _redirects de _subir/. */
const ZIP_NETLIFY = path.join(ROOT, "..", "ramiropiedrabuena-netlify.zip");
const SUBIR = path.join(ROOT, "_subir");
const RE_RUTA = /(?:projects|img)\/[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)*/g;
const RESERVADAS = ["css", "js", "img", "projects", "data", "geo", "admin", "index.html", "_headers", "_redirects", "api"];

async function empaquetar() {
  const problemas = [];
  const avisos = [];

  // 1) el código tiene que andar
  for (const f of ["js/app.js", "js/project.js", "js/i18n.js"]) {
    const r = spawnSync(process.execPath, ["--check", path.join(ROOT, f)], { encoding: "utf8" });
    if (r.status !== 0) problemas.push(f + ": error de sintaxis — " + String(r.stderr || "").split("\n").slice(0, 4).join(" "));
  }
  const index = await fsp.readFile(path.join(ROOT, "index.html"), "utf8");
  const versiones = Array.from(new Set((index.match(/\?v=\d+/g) || [])));
  if (versiones.length > 1) problemas.push("index.html tiene versiones de caché distintas: " + versiones.join(", "));
  if (/localhost|127\.0\.0\.1/.test(index)) problemas.push("index.html nombra localhost o 127.0.0.1");

  // 2) los datos
  const texto = await fsp.readFile(DATA, "utf8");
  let data;
  try { data = JSON.parse(texto); } catch (e) { problemas.push("data/projects.json no es JSON válido"); }
  if (problemas.length) return { ok: false, problemas, avisos };

  const vocab = (data.site && data.site.tags) || {};
  (data.projects || []).forEach(p => {
    Object.keys(p.tags || {}).forEach(g => {
      const ids = new Set((vocab[g] || []).map(t => (t && t.id) || t));
      (p.tags[g] || []).forEach(t => { if (!ids.has(t)) avisos.push("“" + p.id + "” tiene un hashtag que ya no existe: " + t); });
    });
  });
  const referenciados = Array.from(new Set(texto.match(RE_RUTA) || []));
  referenciados.forEach(r => { if (!fs.existsSync(path.join(ROOT, r))) avisos.push("Falta el archivo " + r + " (lo usa projects.json)"); });

  // 3) qué va
  let codigo = index;
  for (const d of ["css", "js"]) {
    for (const n of await fsp.readdir(path.join(ROOT, d))) codigo += await fsp.readFile(path.join(ROOT, d, n), "utf8");
  }
  const usados = new Set(referenciados.concat(codigo.match(RE_RUTA) || []).map(r => r.toLowerCase()));
  const carpetasHtml = (data.projects || []).filter(p => p.kind === "html").map(p => ("projects/" + p.id + "/").toLowerCase());
  const archivos = ["index.html", "_headers", "_redirects", "data/projects.json", "geo/es.json", "geo/en.json"];
  for (const d of ["css", "js"]) (await fsp.readdir(path.join(ROOT, d))).forEach(n => archivos.push(d + "/" + n));
  const medios = (await listarArchivos(PROJECTS_DIR, "projects")).concat(await listarArchivos(IMG_DIR, "img"));
  const porRuta = new Map(medios.map(f => [f.src.toLowerCase(), f.src]));

  // Las páginas HTML de las carpetas van siempre (una política de privacidad
  // o unos términos tienen que estar en línea aunque ningún post los enlace),
  // y arrastran lo que ellas mismas usan: sus links (a otra página, a un PDF)
  // e imágenes, relativos a su carpeta. Se sigue la cadena.
  const pendientes = Array.from(porRuta.keys()).filter(r => /^projects\/.+\.html?$/.test(r));
  pendientes.forEach(r => usados.add(r));
  const vistas = new Set();
  while (pendientes.length) {
    const r = pendientes.pop();
    if (vistas.has(r)) continue;
    vistas.add(r);
    let html;
    try { html = await fsp.readFile(path.join(ROOT, porRuta.get(r)), "utf8"); } catch (e) { continue; }
    (html.match(RE_RUTA) || []).forEach(x => usados.add(x.toLowerCase()));
    const carpeta = r.slice(0, r.lastIndexOf("/") + 1);
    (html.match(/\b(?:href|src)\s*=\s*["'][^"'#?]+/gi) || []).forEach(m => {
      const v = m.replace(/^[^"']*["']/, "");
      if (/^[a-z]+:|^\/\//i.test(v)) return;             // http:, mailto:, data:…
      const k = (v.charAt(0) === "/" ? v.slice(1) : path.posix.normalize(carpeta + v)).toLowerCase();
      if (!porRuta.has(k)) return;
      usados.add(k);
      if (/\.html?$/.test(k) && !vistas.has(k)) pendientes.push(k);
    });
  }

  const afuera = [];
  medios.forEach(f => {
    const r = f.src.toLowerCase();
    if (usados.has(r) || carpetasHtml.some(c => r.startsWith(c))) archivos.push(f.src);
    else afuera.push(f.src);
  });

  // 4) _subir/ desde cero
  await fsp.rm(SUBIR, { recursive: true, force: true });
  for (const a of archivos) {
    const fin = path.join(SUBIR, a);
    await fsp.mkdir(path.dirname(fin), { recursive: true });
    await fsp.copyFile(path.join(ROOT, a), fin);
  }

  // direcciones cortas → reglas de Netlify (exactas primero, carpetas después)
  const dirDe = r => { const i = r.lastIndexOf("/"); return i > 0 ? r.slice(0, i) : ""; };
  const atajos = ((data.site && data.site.atajos) || []).filter(a =>
    a && a.desde && a.hacia && a.desde.charAt(0) === "/" &&
    RESERVADAS.indexOf(a.desde.split("/")[1]) < 0 && fs.existsSync(path.join(ROOT, a.hacia)));
  if (atajos.length) {
    const lineas = ["", "# Direcciones cortas (Configuración del panel). Las escribe el empaquetado."];
    atajos.forEach(a => lineas.push(a.desde + "  /" + a.hacia.replace(/^\/+/, "") + "  200"));
    const vistos = new Set();
    atajos.forEach(a => {
      const d = dirDe(a.desde);
      if (d && !vistos.has(d)) { vistos.add(d); lineas.push(d + "/*  /" + dirDe(a.hacia.replace(/^\/+/, "")) + "/:splat  200"); }
    });
    await fsp.appendFile(path.join(SUBIR, "_redirects"), lineas.join("\n") + "\n", "utf8");
  }

  // 5) el zip
  const entradas = [];
  let bytes = 0;
  for (const a of archivos.slice().sort()) {
    const contenido = await fsp.readFile(path.join(SUBIR, a));
    bytes += contenido.length;
    entradas.push({ nombre: a.split(path.sep).join("/"), datos: contenido });
  }
  const zip = armarZip(entradas);
  await fsp.writeFile(ZIP_NETLIFY, zip);

  return {
    ok: true,
    zip: ZIP_NETLIFY,
    archivos: archivos.length,
    mb: +(bytes / 1024 / 1024).toFixed(2),
    zipMb: +(zip.length / 1024 / 1024).toFixed(2),
    atajos: atajos.length,
    afuera,
    avisos
  };
}

// zip mínimo (deflate), sin dependencias
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function armarZip(entradas) {
  const ahora = new Date();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const fecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
  const locales = [], centrales = [];
  let desplazamiento = 0;
  entradas.forEach(e => {
    const nombre = Buffer.from(e.nombre, "utf8");
    const comprimido = zlib.deflateRawSync(e.datos, { level: 9 });
    const usar = comprimido.length < e.datos.length;
    const cuerpo = usar ? comprimido : e.datos;
    const crc = crc32(e.datos);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6);
    loc.writeUInt16LE(usar ? 8 : 0, 8); loc.writeUInt16LE(hora, 10); loc.writeUInt16LE(fecha, 12);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(cuerpo.length, 18); loc.writeUInt32LE(e.datos.length, 22);
    loc.writeUInt16LE(nombre.length, 26); loc.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(usar ? 8 : 0, 10); cen.writeUInt16LE(hora, 12); cen.writeUInt16LE(fecha, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(cuerpo.length, 20); cen.writeUInt32LE(e.datos.length, 24);
    cen.writeUInt16LE(nombre.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(desplazamiento, 42);
    locales.push(loc, nombre, cuerpo);
    centrales.push(cen, nombre);
    desplazamiento += loc.length + nombre.length + cuerpo.length;
  });
  const central = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat(locales.concat([central, fin]));
}

/* ---------------- estáticos ---------------- */

/* Los medios de los proyectos se cachean un rato. Si el navegador los vuelve a
   pedir en cada recarga también los vuelve a decodificar, y con AVIF pesados esa
   decodificación se ve como un parpadeo. El código y los datos siguen sin
   cachearse, para que los cambios se vean al instante. */
function cacheFor(rel) {
  // las páginas HTML de una carpeta se editan en el panel: sin caché, como el código
  if (/\.html?$/i.test(rel)) return "no-store";
  return /^(projects|img)\//.test(rel) ? "public, max-age=300" : "no-store";
}

/* ---------------- direcciones cortas ----------------
   data.site.atajos = [{ desde: "/keysense/terms", hacia: "projects/keysense/terms.en.html" }]
   Mismas reglas que el empaquetado escribe en _redirects para Netlify:
   primero la dirección exacta; después, si la corta está dentro de una
   carpeta, todo lo que cuelgue de esa carpeta va a la carpeta real (así los
   links y archivos relativos de la página siguen andando). Un archivo que
   existe de verdad siempre gana. */
function carpetaDe(ruta) {
  const i = ruta.lastIndexOf("/");
  return i <= 0 ? "" : ruta.slice(0, i);
}

async function resolverAtajo(pedido) {
  const data = await readData();
  const lista = Array.isArray(data.site.atajos) ? data.site.atajos : [];
  const p = ("/" + pedido.replace(/^\/+/, "")).replace(/\/+$/, "").toLowerCase();
  for (const a of lista) {
    if (a && a.desde && a.hacia && a.desde.toLowerCase() === p) return a.hacia;
  }
  for (const a of lista) {
    if (!a || !a.desde || !a.hacia) continue;
    const dir = carpetaDe(a.desde).toLowerCase();
    if (dir && p.startsWith(dir + "/")) return carpetaDe(a.hacia) + p.slice(dir.length);
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  // una dirección corta, con o sin barra final, antes de buscar un index.html
  if (rel && !fs.existsSync(path.join(ROOT, rel))) {
    const destino = await resolverAtajo(rel).catch(() => null);
    if (destino) rel = destino.replace(/^\/+/, "");
  }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);

  if (!file.startsWith(ROOT)) return send(res, 403, "Prohibido");

  // Nada que empiece con punto se sirve: .papelera y compañía no son el sitio.
  if (rel.split(/[\/]/).some(t => t.startsWith("."))) return send(res, 404, "No encontrado");

  let stat;
  try { stat = await fsp.stat(file); }
  catch (e) { return send(res, 404, "No encontrado", { "Content-Type": "text/plain; charset=utf-8" }); }

  if (stat.isDirectory()) {
    res.writeHead(302, { Location: pathname.replace(/\/?$/, "/") + "index.html" });
    return res.end();
  }

  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  // Soporte de Range para que los videos se puedan buscar/adelantar
  if (range && /^bytes=/.test(range)) {
    const [s, e] = range.replace("bytes=", "").split("-");
    const start = parseInt(s, 10) || 0;
    const end = e ? Math.min(parseInt(e, 10), stat.size - 1) : stat.size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Cache-Control": cacheFor(rel)
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheFor(rel)
  });
  fs.createReadStream(file).pipe(res);
}

/* ---------------- servidor ---------------- */

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    if (pathname.startsWith("/api/")) return await api(req, res, pathname, parsed.query);
    return await serveStatic(req, res, pathname);
  } catch (err) {
    console.error("Error:", err.message);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Portfolio  →  http://" + HOST + ":" + PORT + "/");
  console.log("  Admin      →  http://" + HOST + ":" + PORT + "/admin/");
  console.log("");
  console.log("  Ctrl+C para detener.");
});
