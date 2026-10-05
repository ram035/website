// The Gavna website panel (local only: node server.js).
//
// "Páginas": the block editor. Each page is a list of blocks (blocks.js):
// the list on the left (drag to reorder, hide, duplicate, delete), a live
// preview in the middle (click a block to edit it) and its properties on the
// right ("Contenido" and "Estilo"). Every text has an English and a Spanish
// box; the preview shows one language at a time.
//
// "Datos y textos": the site's data (contact, links, price…), the menu, the
// shared texts, and the legal texts.
//
// "Guardar" writes everything that changed and rebuilds the site; nothing is
// published until the zip made by "Empaquetar para Netlify" is uploaded.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = {
    data: null, pages: [], removed: [], schema: null, images: [], legal: [],
    pageId: 'home', sel: null, tab: 'content', lang: 'es', device: 'desktop',
    dirtyData: false, dirtyPages: {}, history: {}, open: {}
  };

  // ------------------------------------------------------------ small helpers
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function isLang(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(function (k) { return k === 'en' || k === 'es'; }) && ('en' in v || 'es' in v); }
  function toast(msg, err) {
    var t = el('div', 'toast' + (err ? ' err' : ''), msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 7000 : 3500);
  }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function newId() { return 'b' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6); }
  function page() { return S.pages.filter(function (p) { return p.id === S.pageId; })[0]; }
  function block(id) { var p = page(); return p && p.blocks.filter(function (b) { return b.id === id; })[0]; }
  function pageName(p) { return p.path === '' ? 'Inicio' : ((p.title && (p.title.es || p.title.en)) || p.path).replace(/^Gavna Music Composer — .*/, 'Music Composer'); }
  function textOf(v) { return isLang(v) ? (v[S.lang] || v.es || v.en || '') : (typeof v === 'string' ? v : ''); }
  function summary(b) {
    var p = b.props || {};
    var s = textOf(p.title) || textOf(p.eyebrow) || textOf(p.text) || (p.paragraphs && p.paragraphs[0] && textOf(p.paragraphs[0].text)) ||
      (p.items && p.items[0] && (textOf(p.items[0].title) || textOf(p.items[0].label) || textOf(p.items[0].q))) || p.name || '';
    return s.replace(/\*\*/g, '').slice(0, 60);
  }

  // ------------------------------------------------------------ dirty state, saving
  function refreshStatus() {
    var n = Object.keys(S.dirtyPages).length + (S.dirtyData ? 1 : 0) + S.removed.length;
    $('save').disabled = !n;
    $('status').textContent = n ? 'Cambios sin guardar' : '';
  }
  function touchData() { S.dirtyData = true; refreshStatus(); schedulePreview(); }
  // a change to the current page: remember it for "Deshacer", redraw the preview
  function touchPage(opts) {
    S.dirtyPages[S.pageId] = true;
    refreshStatus();
    rememberSoon(opts && opts.now);
    if (!opts || opts.list !== false) drawList();
    schedulePreview();
  }

  function save() {
    $('save').disabled = true;
    $('status').textContent = 'Guardando…';
    var jobs = [];
    S.removed.forEach(function (id) { jobs.push(function () { return api('DELETE', '/api/pages/' + id); }); });
    if (S.dirtyData) jobs.push(function () { return api('PUT', '/api/content', S.data); });
    Object.keys(S.dirtyPages).forEach(function (id) {
      var p = S.pages.filter(function (x) { return x.id === id; })[0];
      if (p) jobs.push(function () { return api('PUT', '/api/pages/' + id, p).then(function (j) { delete S.dirtyPages[id]; return j; }); });
    });
    var last = null;
    jobs.reduce(function (chain, job) { return chain.then(job).then(function (j) { last = j; }); }, Promise.resolve())
      .then(function () {
        S.removed = []; S.dirtyData = false; S.dirtyPages = {};
        refreshStatus();
        var miss = last && last.missing ? last.missing.length : 0;
        toast(miss ? 'Guardado. Faltan ' + miss + ' traducciones (marcadas en rojo).' : 'Guardado y sitio regenerado.');
      })
      .catch(function (e) { refreshStatus(); toast('No se pudo guardar: ' + e.message, true); });
  }

  // ------------------------------------------------------------ undo / redo (per page)
  var rememberTimer = null;
  function hist() {
    var h = S.history[S.pageId];
    if (!h) { h = S.history[S.pageId] = { stack: [JSON.stringify(page())], at: 0 }; }
    return h;
  }
  function remember() {
    var h = hist(), now = JSON.stringify(page());
    if (h.stack[h.at] === now) return;
    h.stack = h.stack.slice(0, h.at + 1);
    h.stack.push(now);
    if (h.stack.length > 80) h.stack.shift();
    h.at = h.stack.length - 1;
    drawUndo();
  }
  function rememberSoon(now) {
    clearTimeout(rememberTimer);
    if (now) remember(); else rememberTimer = setTimeout(remember, 500);
  }
  function drawUndo() {
    var h = S.history[S.pageId];
    $('undo').disabled = !h || h.at <= 0;
    $('redo').disabled = !h || h.at >= h.stack.length - 1;
  }
  function stepHistory(d) {
    clearTimeout(rememberTimer); remember();
    var h = hist(), to = h.at + d;
    if (to < 0 || to >= h.stack.length) return;
    h.at = to;
    var restored = JSON.parse(h.stack[to]);
    var i = S.pages.indexOf(page());
    S.pages[i] = restored;
    if (S.sel && S.sel !== '@page' && !block(S.sel)) S.sel = null;
    S.dirtyPages[S.pageId] = true;
    refreshStatus(); drawUndo(); drawList(); drawProps(); schedulePreview();
  }

  // ------------------------------------------------------------ preview
  var previewTimer = null, previewSeq = 0, pendingScroll = null;
  var WIDTHS = { desktop: 1280, tablet: 820, mobile: 390 };
  function schedulePreview(now) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, now ? 0 : 300);
  }
  function renderPreview() {
    var p = page();
    if (!p) return;
    var seq = ++previewSeq;
    var frame = $('frame');
    try { pendingScroll = frame.contentWindow ? frame.contentWindow.scrollY : 0; } catch (e) { pendingScroll = 0; }
    api('POST', '/api/preview', { content: S.data, pages: S.pages, page: p, lang: S.lang }).then(function (j) {
      if (seq !== previewSeq) return;
      frame.srcdoc = j.html;
      var miss = j.missing.length;
      $('stage-note').textContent = miss ? miss + (miss === 1 ? ' texto' : ' textos') + ' sin traducir en ' + (S.lang === 'es' ? 'español' : 'inglés') : '';
      $('stage-note').title = j.missing.join('\n');
    }).catch(function (e) { $('stage-note').textContent = 'Vista previa: ' + e.message; });
  }
  function fitFrame() {
    var box = $('frame-box'), frame = $('frame');
    var w = WIDTHS[S.device], avail = box.clientWidth - 24;
    var scale = Math.min(1, avail / w);
    frame.style.width = w + 'px';
    frame.style.height = (box.clientHeight / scale) + 'px';
    frame.style.transform = 'translateX(-50%) scale(' + scale + ')';
  }
  $('frame').addEventListener('load', function () {
    var win = $('frame').contentWindow;
    if (pendingScroll) win.scrollTo(0, pendingScroll);
    pointAt(S.sel, false);
  });
  function pointAt(id, scroll) {
    var win = $('frame').contentWindow;
    if (win) win.postMessage({ gavnaShow: id && id !== '@page' ? id : '', scroll: !!scroll }, '*');
  }
  window.addEventListener('message', function (e) {
    if (e.source !== $('frame').contentWindow) return;
    var d = e.data || {};
    if (d.gavnaPick) select(d.gavnaPick, false);
  });
  window.addEventListener('resize', fitFrame);

  // ------------------------------------------------------------ left: pages and blocks
  function drawPages() {
    var sel = $('page-select');
    sel.innerHTML = '';
    S.pages.forEach(function (p) {
      var o = el('option', null, pageName(p) + (p.path ? '  (/' + p.path + '/)' : '  (/)'));
      o.value = p.id;
      sel.appendChild(o);
    });
    sel.value = S.pageId;
  }
  $('page-select').addEventListener('change', function () { openPage(this.value); });
  function openPage(id) {
    S.pageId = id; S.sel = null;
    if (page()) hist(); // the page as it was before any change, for "Deshacer"
    drawPages(); drawList(); drawProps(); drawUndo(); schedulePreview(true);
  }

  var dragFrom = null;
  function drawList() {
    var list = $('blocks'), p = page();
    list.innerHTML = '';
    $('page-settings').classList.toggle('on', S.sel === '@page');
    if (!p) return;
    p.blocks.forEach(function (b, i) {
      var def = S.schema.blocks[b.type] || { label: b.type, icon: '?' };
      var li = el('li', (b.id === S.sel ? 'on' : '') + (b.hidden ? ' off' : ''));
      li.draggable = true;
      li.appendChild(el('span', 'grip', '⋮⋮'));
      li.appendChild(el('span', 'blk-ic', def.icon));
      var txt = el('span', 'blk-txt');
      txt.appendChild(el('span', 'blk-name', def.label));
      txt.appendChild(el('span', 'blk-sum', summary(b)));
      li.appendChild(txt);
      var tools = el('span', 'blk-tools');
      [['hide', b.hidden ? '◌' : '◉', b.hidden ? 'Mostrar' : 'Ocultar (sigue guardado)'], ['copy', '⧉', 'Duplicar'], ['del', '✕', 'Borrar']].forEach(function (t) {
        var bt = el('button', 'mini-ic' + (t[0] === 'del' ? ' danger' : ''), t[1]);
        bt.type = 'button'; bt.title = t[2];
        bt.addEventListener('click', function (e) { e.stopPropagation(); blockAction(t[0], i); });
        tools.appendChild(bt);
      });
      li.appendChild(tools);
      li.addEventListener('click', function () { select(b.id, true); });
      li.addEventListener('dragstart', function (e) { dragFrom = i; li.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      li.addEventListener('dragend', function () { dragFrom = null; drawList(); });
      li.addEventListener('dragover', function (e) {
        if (dragFrom == null) return;
        e.preventDefault();
        var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        Array.prototype.forEach.call(list.children, function (c) { c.classList.remove('drop-before', 'drop-after'); });
        li.classList.add(after ? 'drop-after' : 'drop-before');
      });
      li.addEventListener('drop', function (e) {
        e.preventDefault();
        if (dragFrom == null) return;
        var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        var to = i + (after ? 1 : 0);
        var moved = p.blocks.splice(dragFrom, 1)[0];
        if (dragFrom < to) to--;
        p.blocks.splice(to, 0, moved);
        dragFrom = null;
        touchPage({ now: true });
        pointAt(S.sel, true);
      });
      list.appendChild(li);
    });
  }

  function blockAction(what, i) {
    var p = page(), b = p.blocks[i];
    if (what === 'hide') { b.hidden = !b.hidden; touchPage({ now: true }); return; }
    if (what === 'copy') {
      var c = clone(b); c.id = newId();
      if (c.style && c.style.anchor) c.style.anchor = '';
      p.blocks.splice(i + 1, 0, c);
      S.sel = c.id;
      touchPage({ now: true }); drawProps();
      return;
    }
    if (what === 'del') {
      if (!confirm('¿Borrar el bloque "' + (S.schema.blocks[b.type] || {}).label + '"? (Se puede deshacer con Deshacer.)')) return;
      p.blocks.splice(i, 1);
      if (S.sel === b.id) S.sel = null;
      touchPage({ now: true }); drawProps();
    }
  }

  function select(id, scroll) {
    S.sel = id;
    if (id !== '@page') S.tab = S.tab || 'content';
    drawList(); drawProps();
    pointAt(id, scroll);
  }
  $('page-settings').addEventListener('click', function () { select('@page', false); });

  // ------------------------------------------------------------ modal
  function modal(title, body) {
    $('modal-title').textContent = title;
    var mb = $('modal-body'); mb.innerHTML = ''; mb.appendChild(body);
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; }
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  // the catalog of blocks to add
  $('add-block').addEventListener('click', function () {
    var body = el('div'), groups = {};
    Object.keys(S.schema.blocks).forEach(function (type) {
      var d = S.schema.blocks[type];
      (groups[d.group] = groups[d.group] || []).push(type);
    });
    Object.keys(groups).forEach(function (g) {
      body.appendChild(el('div', 'cat-group', g));
      var grid = el('div', 'cat-grid');
      groups[g].forEach(function (type) {
        var d = S.schema.blocks[type];
        var c = el('button', 'cat'); c.type = 'button';
        c.appendChild(el('span', 'blk-ic', d.icon));
        var t = el('div'); t.appendChild(el('strong', null, d.label)); t.appendChild(el('span', null, d.desc));
        c.appendChild(t);
        c.addEventListener('click', function () { addBlock(type); closeModal(); });
        grid.appendChild(c);
      });
      body.appendChild(grid);
    });
    modal('Agregar un bloque' + (S.sel && S.sel !== '@page' ? ' (debajo del elegido)' : ' (al final)'), body);
  });
  function addBlock(type) {
    var p = page(), d = S.schema.blocks[type];
    var b = { id: newId(), type: type, hidden: false, style: {}, props: clone(d.defaults) };
    var at = p.blocks.length;
    if (S.sel && S.sel !== '@page') { var i = p.blocks.indexOf(block(S.sel)); if (i >= 0) at = i + 1; }
    p.blocks.splice(at, 0, b);
    S.sel = b.id; S.tab = 'content';
    touchPage({ now: true }); drawProps();
    setTimeout(function () { pointAt(b.id, true); }, 700);
  }

  // a new page
  $('page-new').addEventListener('click', function () {
    var body = el('div');
    var f1 = el('div', 'f'); f1.appendChild(el('label', null, 'Nombre de la página (en español)'));
    var name = el('input'); name.type = 'text'; name.placeholder = 'Por ejemplo: Novedades'; f1.appendChild(name);
    var f2 = el('div', 'f'); f2.appendChild(el('label', null, 'Dirección: gavna.digital/…'));
    var slug = el('input'); slug.type = 'text'; slug.placeholder = 'novedades'; f2.appendChild(slug);
    var f3 = el('div', 'f'); f3.appendChild(el('label', null, 'Empezar con'));
    var from = el('select');
    [['blank', 'Una portada y un texto'], ['copy', 'Una copia de la página que estoy viendo']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; from.appendChild(op); });
    f3.appendChild(from);
    var touched = false;
    slug.addEventListener('input', function () { touched = true; });
    name.addEventListener('input', function () {
      if (!touched) slug.value = name.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    });
    var actions = el('div', 'modal-actions');
    var cancel = el('button', 'btn-plain', 'Cancelar'); cancel.type = 'button'; cancel.addEventListener('click', closeModal);
    var ok = el('button', 'btn-main', 'Crear página'); ok.type = 'button';
    ok.addEventListener('click', function () {
      var s = slug.value.trim();
      if (!name.value.trim()) return toast('Ponle un nombre.', true);
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(s)) return toast('La dirección solo puede tener minúsculas, números y guiones.', true);
      if (S.pages.some(function (p) { return p.id === s || p.path === s; })) return toast('Ya hay una página con esa dirección.', true);
      var title = { en: name.value.trim(), es: name.value.trim() };
      var p = from.value === 'copy' ? clone(page()) : {
        blocks: [
          { id: newId(), type: 'hero', hidden: false, style: {}, props: Object.assign(clone(S.schema.blocks.hero.defaults), { title: clone(title), buttons: [] }) },
          { id: newId(), type: 'text', hidden: false, style: {}, props: clone(S.schema.blocks.text.defaults) }
        ]
      };
      p.id = s; p.path = s; p.title = { en: title.en + ' — Gavna', es: title.es + ' — Gavna' };
      p.description = p.description && from.value === 'copy' ? p.description : { en: '', es: '' };
      p.image = p.image || { en: '', es: '' };
      p.blocks.forEach(function (b) { b.id = newId(); });
      S.pages.push(p);
      S.removed = S.removed.filter(function (r) { return r !== s; });
      closeModal();
      S.pageId = s; S.dirtyPages[s] = true;
      refreshStatus();
      openPage(s);
      select('@page', false);
      toast('Página creada. Para que exista de verdad, haz clic en Guardar.');
    });
    actions.appendChild(cancel); actions.appendChild(ok);
    body.appendChild(f1); body.appendChild(f2); body.appendChild(f3); body.appendChild(actions);
    modal('Nueva página', body);
    name.focus();
  });

  // pick a picture from src/img (or upload one)
  function imageModal(current, onPick) {
    var body = el('div');
    var bar = el('div', 'modal-actions'); bar.style.justifyContent = 'space-between'; bar.style.marginTop = '0'; bar.style.marginBottom = '12px';
    var up = el('button', 'btn-main', 'Subir una imagen…'); up.type = 'button';
    var none = el('button', 'btn-plain', 'Sin imagen'); none.type = 'button';
    none.addEventListener('click', function () { onPick(''); closeModal(); });
    up.addEventListener('click', function () { upload(function (p) { onPick(p); closeModal(); }); });
    bar.appendChild(none); bar.appendChild(up);
    body.appendChild(bar);
    var grid = el('div', 'img-grid');
    S.images.forEach(function (p) {
      var o = el('button', 'img-opt' + (p === current ? ' on' : '')); o.type = 'button';
      var ph = el('div', 'ph'); ph.style.backgroundImage = 'url("/' + p + '")';
      o.appendChild(ph); o.appendChild(el('span', null, p.replace(/^img\//, '')));
      o.addEventListener('click', function () { onPick(p); closeModal(); });
      grid.appendChild(o);
    });
    body.appendChild(grid);
    modal('Elegir imagen', body);
  }
  function upload(done) {
    var input = el('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.addEventListener('change', function () {
      var f = input.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        api('POST', '/api/upload', { filename: f.name, data: String(r.result).split(',')[1] }).then(function (j) {
          S.images.push(j.path); S.images.sort(); toast('Imagen subida: ' + j.path); done(j.path);
        }).catch(function (e) { toast(e.message, true); });
      };
      r.readAsDataURL(f);
    });
    input.click();
  }

  // the "Estilo" fields again from the server, so the font lists show what is in src/fonts
  function refreshStyleFields(done) {
    api('GET', '/api/blocks').then(function (r) { S.schema.style = r.style; S.schema.brokenFonts = r.brokenFonts || []; done(); }).catch(function () { done(); });
  }
  // add a typeface file (.woff2, .woff, .ttf, .otf) to src/fonts
  function fontUpload() {
    var wrap = el('div', 'f');
    var bt = el('button', 'btn-plain', 'Subir una tipografía…'); bt.type = 'button';
    bt.addEventListener('click', function () {
      var input = el('input'); input.type = 'file'; input.accept = '.woff2,.woff,.ttf,.otf';
      input.addEventListener('change', function () {
        var f = input.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          api('POST', '/api/upload-font', { filename: f.name, data: String(r.result).split(',')[1] }).then(function (j) {
            toast('Tipografía agregada: ' + j.label + '. Ya puedes elegirla en las listas de arriba.');
            refreshStyleFields(drawProps);
          }).catch(function (e) { toast(e.message, true); });
        };
        r.readAsDataURL(f);
      });
      input.click();
    });
    wrap.appendChild(bt);
    wrap.appendChild(el('p', 'hint-s', 'Si la que quieres no está en la lista. Mejor .woff2: pesa menos. Para negrita o variantes, súbelas una por una (por ejemplo Nombre-Regular y Nombre-Bold).'));
    var bad = (S.schema && S.schema.brokenFonts) || [];
    if (bad.length) wrap.appendChild(el('p', 'hint-s', 'Estos archivos de src/fonts no son tipografías válidas y no aparecen en las listas: ' + bad.join(', ') + '. Hay que volver a generarlos o reemplazarlos.'));
    return wrap;
  }

  // ------------------------------------------------------------ right: properties
  function drawProps() {
    var box = $('props'), y = box.scrollTop;
    box.innerHTML = '';
    var p = page();
    if (!p) return;
    if (S.sel === '@page') return drawPageProps(box, p);
    var b = S.sel && block(S.sel);
    if (!b) {
      box.appendChild(el('p', 'empty-props', 'Haz clic en un bloque de la vista previa o de la lista para editarlo.'));
      return;
    }
    var def = S.schema.blocks[b.type];
    var head = el('div', 'props-head');
    var t = el('div', 'props-title'); t.appendChild(el('span', 'blk-ic', def.icon)); t.appendChild(el('strong', null, def.label));
    head.appendChild(t);
    head.appendChild(el('p', 'props-desc', def.desc));
    var tabs = el('div', 'props-tabs');
    [['content', 'Contenido'], ['style', 'Estilo']].forEach(function (tb) {
      var bt = el('button', S.tab === tb[0] ? 'on' : '', tb[1]); bt.type = 'button';
      bt.addEventListener('click', function () {
        S.tab = tb[0];
        // the font lists are whatever is in src/fonts now (it may have changed)
        if (S.tab === 'style') refreshStyleFields(drawProps); else drawProps();
      });
      tabs.appendChild(bt);
    });
    head.appendChild(tabs);
    box.appendChild(head);
    var body = el('div', 'props-body');
    b.style = b.style || {};
    b.props = b.props || {};
    if (S.tab === 'style') {
      S.schema.style.forEach(function (f) {
        body.appendChild(field(f, b.style, { block: b, path: b.id + '.style' }));
        if (f.key === 'fontText') body.appendChild(fontUpload());
      });
    } else {
      def.fields.forEach(function (f) {
        if (f.showIf && b.props[f.showIf[0]] !== f.showIf[1]) return;
        body.appendChild(field(f, b.props, { block: b, path: b.id + '.' + f.key, defaults: def.defaults }));
      });
    }
    box.appendChild(body);
    box.scrollTop = y;
  }

  function drawPageProps(box, p) {
    var head = el('div', 'props-head');
    var t = el('div', 'props-title'); t.appendChild(el('span', 'blk-ic', '⚙')); t.appendChild(el('strong', null, 'Ajustes de la página'));
    head.appendChild(t);
    head.appendChild(el('p', 'props-desc', 'Dirección, título para Google y redes. La página existe en inglés (/…) y en español (/es/…).'));
    box.appendChild(head);
    var body = el('div', 'props-body');
    if (p.path !== '') {
      var f = el('div', 'f'); f.appendChild(el('label', null, 'Dirección: gavna.digital/…'));
      var inp = el('input'); inp.type = 'text'; inp.value = p.path;
      inp.addEventListener('change', function () {
        var v = inp.value.trim();
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(v)) { toast('Solo minúsculas, números y guiones.', true); inp.value = p.path; return; }
        if (S.pages.some(function (o) { return o !== p && o.path === v; })) { toast('Ya hay otra página con esa dirección.', true); inp.value = p.path; return; }
        p.path = v; touchPage({ now: true }); drawPages();
      });
      f.appendChild(inp);
      body.appendChild(f);
    }
    S.schema.page.forEach(function (fd) { body.appendChild(field(fd, p, { path: '@page.' + fd.key, onTouch: drawPages })); });
    if (p.id !== 'home') {
      var del = el('button', 'mini mini-danger', 'Borrar esta página'); del.type = 'button';
      del.addEventListener('click', function () {
        if (!confirm('¿Borrar la página "' + pageName(p) + '"? Se borra al Guardar (queda una copia en content/_backups).')) return;
        S.pages = S.pages.filter(function (o) { return o !== p; });
        delete S.dirtyPages[p.id];
        if (S.removed.indexOf(p.id) < 0) S.removed.push(p.id);
        refreshStatus();
        openPage('home');
      });
      body.appendChild(el('div', 'f')).appendChild(del);
    }
    box.appendChild(body);
  }

  // one property editor, whatever its type; `holder[f.key]` is the value
  function field(f, holder, ctx) {
    var wrap = el('div', 'f');
    if (f.type !== 'toggle') wrap.appendChild(el('label', null, f.label));
    var changed = function (structural) {
      if (ctx.onTouch) ctx.onTouch();
      touchPage({ list: true });
      if (structural) drawProps();
    };
    switch (f.type) {
      case 'text': case 'textarea': wrap.appendChild(langPair(holder, f.key, f.type === 'textarea', function () { changed(false); })); break;
      case 'plain': {
        var inp = el('input'); inp.type = 'text'; inp.value = holder[f.key] == null ? '' : holder[f.key];
        inp.addEventListener('input', function () { holder[f.key] = inp.value; changed(false); });
        wrap.appendChild(inp); break;
      }
      case 'select': {
        var sel = el('select');
        f.options.forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
        sel.value = holder[f.key] == null ? f.options[0][0] : String(holder[f.key]);
        sel.addEventListener('change', function () { holder[f.key] = sel.value; changed(true); });
        wrap.appendChild(sel); break;
      }
      case 'toggle': {
        var lab = el('label', 'toggle'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!holder[f.key];
        cb.addEventListener('change', function () { holder[f.key] = cb.checked; changed(true); });
        lab.appendChild(cb); lab.appendChild(document.createTextNode(f.label));
        wrap.appendChild(lab); break;
      }
      case 'image': wrap.appendChild(imagePair(holder, f.key, function () { changed(true); })); break;
      case 'file': wrap.appendChild(filePair(holder, f.key, function () { changed(false); })); break;
      case 'lottie': {
        var ls = el('select');
        [''].concat(S.schema.lotties).forEach(function (n) { var op = el('option', null, n || '— ninguna —'); op.value = n; ls.appendChild(op); });
        ls.value = holder[f.key] || '';
        ls.addEventListener('change', function () { holder[f.key] = ls.value; changed(false); });
        wrap.appendChild(ls);
        wrap.appendChild(el('div', 'lang-sub', 'Las animaciones son archivos .json de Lottie en src/img.'));
        break;
      }
      case 'link': wrap.appendChild(linkPicker(holder[f.key], function (v) { holder[f.key] = v; changed(false); })); break;
      case 'list': wrap.appendChild(listEditor(f, holder, ctx)); break;
    }
    return wrap;
  }

  // English and Spanish boxes; one empty while the other has text = missing
  function langPair(holder, key, long, onChange) {
    var v = holder[key];
    if (!isLang(v)) v = holder[key] = { en: typeof v === 'string' ? v : '', es: typeof v === 'string' ? v : '' };
    var box = el('div', 'lp'), inputs = [];
    function mark() {
      inputs.forEach(function (x) { x.i.classList.toggle('miss', !x.i.value.trim() && !!(v.en || v.es)); });
    }
    ['es', 'en'].forEach(function (lang) {
      var row = el('div', 'lp-row');
      var i = long ? el('textarea') : el('input');
      if (!long) i.type = 'text';
      i.value = v[lang] || '';
      i.placeholder = lang === 'es' ? 'Español' : 'English';
      i.addEventListener('input', function () { v[lang] = i.value; mark(); onChange(); });
      i.addEventListener('focus', function () { if (S.lang !== lang && (v[lang] || v.en || v.es)) setLang(lang, true); });
      row.appendChild(i); row.appendChild(el('span', 'lp-tag', lang.toUpperCase()));
      box.appendChild(row);
      inputs.push({ i: i });
    });
    mark();
    return box;
  }

  function imagePair(holder, key, onChange) {
    var v = holder[key];
    if (!isLang(v)) v = holder[key] = { en: typeof v === 'string' ? v : '', es: typeof v === 'string' ? v : '' };
    var box = el('div');
    ['es', 'en'].forEach(function (lang) {
      box.appendChild(el('div', 'lang-sub', lang === 'es' ? 'ESPAÑOL' : 'INGLÉS'));
      var row = el('div', 'img-pick');
      var th = el('div', 'thumb' + (/\.svg$/.test(v[lang] || '') ? ' dark' : ''));
      if (v[lang]) th.style.backgroundImage = 'url("/' + v[lang] + '")'; else th.textContent = '▣';
      var info = el('div');
      info.appendChild(el('div', 'img-name', v[lang] ? v[lang].replace(/^img\//, '') : 'Sin imagen'));
      var btns = el('div', 'img-btns');
      var pick = el('button', 'mini', 'Elegir…'); pick.type = 'button';
      pick.addEventListener('click', function () {
        imageModal(v[lang], function (p) {
          // the other language gets the same picture while it has none
          var other = lang === 'es' ? 'en' : 'es';
          if (!v[other]) v[other] = p;
          v[lang] = p; onChange();
        });
      });
      btns.appendChild(pick);
      var other = lang === 'es' ? 'en' : 'es';
      if (v[lang] && v[other] !== v[lang]) {
        var same = el('button', 'mini', 'Usar en ' + (other === 'es' ? 'español' : 'inglés')); same.type = 'button';
        same.addEventListener('click', function () { v[other] = v[lang]; onChange(); });
        btns.appendChild(same);
      }
      info.appendChild(btns);
      row.appendChild(th); row.appendChild(info);
      box.appendChild(row);
    });
    return box;
  }

  function filePair(holder, key, onChange) {
    var v = holder[key];
    if (!isLang(v)) v = holder[key] = { en: '', es: '' };
    var box = el('div');
    ['es', 'en'].forEach(function (lang) {
      box.appendChild(el('div', 'lang-sub', lang === 'es' ? 'ESPAÑOL' : 'INGLÉS'));
      var s = el('select');
      [''].concat(S.schema.files).forEach(function (n) { var op = el('option', null, n ? n.replace(/^downloads\//, '') : '— ninguno —'); op.value = n; s.appendChild(op); });
      s.value = v[lang] || '';
      s.addEventListener('change', function () { v[lang] = s.value; onChange(); });
      box.appendChild(s);
    });
    box.appendChild(el('div', 'lang-sub', 'Los archivos van en la carpeta src/downloads.'));
    return box;
  }

  // where a button goes: the Store, the checkout, a page, a part of a page,
  // or any web address
  function linkOptions() {
    var opts = [['', '— Ningún link —'], ['store:', 'Descargar (Microsoft Store)'], ['buy:', 'Comprar la licencia (Creem)']];
    var cur = page();
    S.pages.forEach(function (p) {
      opts.push(['page:' + p.id, 'Página: ' + pageName(p)]);
      p.blocks.forEach(function (b) {
        var a = b.style && b.style.anchor;
        if (!a) return;
        var label = (S.schema.blocks[b.type] || {}).label || b.type;
        if (p === cur) opts.push(['#' + a, 'Esta página → ' + label + ' (#' + a + ')']);
        else opts.push(['page:' + p.id + '#' + a, pageName(p) + ' → ' + label + ' (#' + a + ')']);
      });
    });
    return opts;
  }
  function linkPicker(value, onChange) {
    var box = el('div');
    var sel = el('select');
    var opts = linkOptions();
    opts.concat([['__custom', 'Otra dirección (escribirla)…']]).forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
    var known = opts.some(function (o) { return o[0] === (value || ''); });
    sel.value = known ? (value || '') : '__custom';
    var inp = el('input', 'link-custom'); inp.type = 'text'; inp.placeholder = 'https://…  ·  mailto:…  ·  #seccion';
    inp.value = known ? '' : (value || '');
    inp.hidden = known;
    sel.addEventListener('change', function () {
      if (sel.value === '__custom') { inp.hidden = false; inp.focus(); onChange(inp.value.trim()); }
      else { inp.hidden = true; onChange(sel.value); }
    });
    inp.addEventListener('input', function () { onChange(inp.value.trim()); });
    box.appendChild(sel); box.appendChild(inp);
    return box;
  }

  function blankOf(fields) {
    var o = {};
    fields.forEach(function (f) {
      if (f.type === 'text' || f.type === 'textarea' || f.type === 'image' || f.type === 'file') o[f.key] = { en: '', es: '' };
      else if (f.type === 'toggle') o[f.key] = false;
      else if (f.type === 'select') o[f.key] = f.options[0][0];
      else if (f.type === 'list') o[f.key] = [];
      else o[f.key] = '';
    });
    return o;
  }

  function listEditor(f, holder, ctx) {
    var arr = Array.isArray(holder[f.key]) ? holder[f.key] : (holder[f.key] = []);
    var box = el('div', 'list');
    arr.forEach(function (item, i) {
      var key = ctx.path + '.' + i;
      var open = S.open[key] != null ? S.open[key] : arr.length <= 2;
      var card = el('div', 'item');
      var head = el('div', 'item-head');
      head.appendChild(el('span', 'caret', open ? '▾' : '▸'));
      var name = textOf(item.label) || textOf(item.title) || textOf(item.q) || textOf(item.text) || item.value || '';
      head.appendChild(el('span', 'item-name', (f.itemLabel || 'Elemento') + ' ' + (i + 1) + (name ? ' — ' + name : '')));
      [['↑', -1, 'Subir'], ['↓', 1, 'Bajar']].forEach(function (m) {
        var bt = el('button', 'mini-ic', m[0]); bt.type = 'button'; bt.title = m[2];
        bt.disabled = (m[1] < 0 && i === 0) || (m[1] > 0 && i === arr.length - 1);
        bt.addEventListener('click', function (e) { e.stopPropagation(); var t = arr[i]; arr[i] = arr[i + m[1]]; arr[i + m[1]] = t; touchPage({ now: true }); drawProps(); });
        head.appendChild(bt);
      });
      var dup = el('button', 'mini-ic', '⧉'); dup.type = 'button'; dup.title = 'Duplicar';
      dup.addEventListener('click', function (e) { e.stopPropagation(); arr.splice(i + 1, 0, clone(item)); touchPage({ now: true }); drawProps(); });
      var del = el('button', 'mini-ic danger', '✕'); del.type = 'button'; del.title = 'Quitar';
      del.addEventListener('click', function (e) { e.stopPropagation(); arr.splice(i, 1); touchPage({ now: true }); drawProps(); });
      head.appendChild(dup); head.appendChild(del);
      head.addEventListener('click', function () { S.open[key] = !open; drawProps(); });
      card.appendChild(head);
      if (open) {
        var body = el('div', 'item-body');
        f.fields.forEach(function (sf) { body.appendChild(field(sf, item, { block: ctx.block, path: key + '.' + sf.key })); });
        card.appendChild(body);
      }
      box.appendChild(card);
    });
    var add = el('button', 'mini add-item', '+ Agregar ' + (f.itemLabel || 'elemento').toLowerCase()); add.type = 'button';
    add.addEventListener('click', function () {
      var tpl = ctx.defaults && ctx.defaults[f.key] && ctx.defaults[f.key][0];
      arr.push(tpl ? clone(tpl) : blankOf(f.fields));
      S.open[ctx.path + '.' + (arr.length - 1)] = true;
      touchPage({ now: true }); drawProps();
    });
    box.appendChild(add);
    return box;
  }

  // ------------------------------------------------------------ preview controls
  function setLang(lang, quiet) {
    S.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('#lang-seg button'), function (b) { b.classList.toggle('on', b.dataset.lang === lang); });
    drawList();
    schedulePreview(true);
  }
  Array.prototype.forEach.call(document.querySelectorAll('#lang-seg button'), function (b) {
    b.addEventListener('click', function () { setLang(b.dataset.lang); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#device-seg button'), function (b) {
    b.addEventListener('click', function () {
      S.device = b.dataset.device;
      Array.prototype.forEach.call(document.querySelectorAll('#device-seg button'), function (x) { x.classList.toggle('on', x === b); });
      fitFrame();
    });
  });
  $('undo').addEventListener('click', function () { stepHistory(-1); });
  $('redo').addEventListener('click', function () { stepHistory(1); });

  // ------------------------------------------------------------ "Datos y textos"
  var SECTIONS = [
    { sep: 'Gavna' },
    { id: 'site', label: 'Datos y contacto', path: ['site'] },
    { id: 'nav', label: 'Menú', path: ['nav'] },
    { sep: 'Music Composer' },
    { id: 'mc', label: 'Precio, links y botones', path: ['musicComposer'] },
    { sep: 'Otras páginas' },
    { id: 'purchased', label: 'Gracias por tu compra', path: ['purchased'] },
    { id: 'footer', label: 'Pie y textos sueltos', path: ['footer'] },
    { id: 'legal', label: 'Textos legales', legal: true }
  ];
  var LABELS = {
    name: 'Nombre', url: 'Dirección del sitio', email: 'Email', phoneDisplay: 'Teléfono (como se muestra)', whatsapp: 'Link de WhatsApp',
    instagram: 'Link de Instagram', discord: 'Link de Discord', legalName: 'Nombre legal', country: 'País', tagline: 'Lema (en el pie) / subtítulo (en el menú Productos)',
    description: 'Descripción', contactFormKey: 'Clave de Web3Forms del formulario de contacto (vacía = los mensajes quedan en Netlify → Forms)',
    products: 'Nombre del menú de productos', links: 'Links del menú (también aparecen en el pie, bajo "Gavna")', label: 'Texto', link: 'Lleva a',
    price: 'Precio (solo el número)', currency: 'Moneda', storeUrl: 'Link de Microsoft Store (vacío = no aparece "Descargar")',
    checkoutUrl: 'Link de compra de la licencia (vacío = no aparece "Comprar")', download: 'Botón de descarga', button: 'Texto del botón',
    available: 'Aviso "disponible" (bloque Producto destacado)', note: 'Nota bajo el botón de descarga (bloque Precio)', buyButton: 'Texto del botón de compra',
    title: 'Título', text: 'Texto', steps: 'Pasos', storeButton: 'Botón a Microsoft Store', help: 'Texto de ayuda (antes del email)',
    legal: 'Título "Legal"', privacy: 'Privacidad', terms: 'Términos', refunds: 'Reembolsos', rights: 'Derechos', notFound: 'Texto de página no encontrada',
    home: 'Botón al inicio', contactTitle: 'Título de la columna de contacto'
  };
  var current = null;
  function label(key) { return LABELS[key] || key; }
  function get(path) { return path.reduce(function (o, k) { return o[k]; }, S.data); }
  function textBox(value, onChange, long) {
    var box = long ? el('textarea') : el('input');
    if (!long) box.type = 'text';
    box.value = value || '';
    box.classList.toggle('missing', !box.value.trim());
    box.addEventListener('input', function () { box.classList.toggle('missing', !box.value.trim()); onChange(box.value); touchData(); });
    return box;
  }
  function render(parent, key, holder, prop) {
    var v = holder[prop];
    if (key === 'link') {
      var lf = el('div', 'field'); lf.appendChild(el('label', null, label(key)));
      lf.appendChild(linkPicker(v, function (x) { holder[prop] = x; touchData(); }));
      parent.appendChild(lf); return;
    }
    if (isLang(v)) {
      var f = el('div', 'field'); f.appendChild(el('label', null, label(key)));
      var pair = el('div', 'pair');
      ['en', 'es'].forEach(function (lang) {
        var col = el('div'); col.appendChild(el('div', 'lang', lang === 'en' ? 'INGLÉS' : 'ESPAÑOL'));
        col.appendChild(textBox(v[lang], function (x) { v[lang] = x; }, (v.en || '').length > 70 || (v.es || '').length > 70));
        pair.appendChild(col);
      });
      f.appendChild(pair); parent.appendChild(f); return;
    }
    if (typeof v === 'string') {
      var g = el('div', 'field'); g.appendChild(el('label', null, label(key)));
      g.appendChild(textBox(v, function (x) { holder[prop] = x; }, v.length > 70));
      parent.appendChild(g); return;
    }
    if (Array.isArray(v)) {
      var fs = el('fieldset'); fs.appendChild(el('legend', null, label(key)));
      v.forEach(function (item, i) {
        var box = el('fieldset', 'item'); box.appendChild(el('legend', null, '#' + (i + 1)));
        var tools = el('div', 'item-tools');
        [['↑', -1], ['↓', 1]].forEach(function (b) {
          var btn = el('button', 'mini', b[0]); btn.type = 'button'; btn.disabled = (b[1] < 0 && i === 0) || (b[1] > 0 && i === v.length - 1);
          btn.addEventListener('click', function () { var t = v[i]; v[i] = v[i + b[1]]; v[i + b[1]] = t; touchData(); showData(current); });
          tools.appendChild(btn);
        });
        var del = el('button', 'mini mini-danger', 'Quitar'); del.type = 'button';
        del.addEventListener('click', function () { if (confirm('¿Quitar este elemento?')) { v.splice(i, 1); touchData(); showData(current); } });
        tools.appendChild(del); box.appendChild(tools);
        if (item && typeof item === 'object' && !isLang(item)) Object.keys(item).forEach(function (k) { render(box, k, item, k); });
        else render(box, 'text', v, i);
        fs.appendChild(box);
      });
      var add = el('button', 'mini add', '+ Agregar'); add.type = 'button';
      add.addEventListener('click', function () {
        var tpl = v.length ? clone(v[v.length - 1]) : { en: '', es: '' };
        (function blank(o) { Object.keys(o).forEach(function (k) { if (isLang(o[k])) o[k] = { en: '', es: '' }; else if (typeof o[k] === 'string') o[k] = ''; else if (o[k] && typeof o[k] === 'object') blank(o[k]); }); })(tpl);
        v.push(isLang(tpl) ? { en: '', es: '' } : tpl);
        touchData(); showData(current);
      });
      fs.appendChild(add); parent.appendChild(fs); return;
    }
    if (v && typeof v === 'object') {
      var set = el('fieldset'); set.appendChild(el('legend', null, label(key)));
      Object.keys(v).forEach(function (k) { render(set, k, v, k); });
      parent.appendChild(set);
    }
  }
  function showLegal(main) {
    main.appendChild(el('p', 'hint', 'Formato: "# " título, "## " subtítulo, "- " lista, "**negrita**", "[texto](link)". Cada archivo se guarda por separado, con su botón.'));
    var sel = el('select'); S.legal.forEach(function (l, i) { var o = el('option', null, l.file); o.value = i; sel.appendChild(o); });
    var wrap = el('div', 'legal-editor field'); var ta = el('textarea'); var btn = el('button', 'mini', 'Guardar este texto'); btn.type = 'button';
    function load() { ta.value = S.legal[sel.value].text; }
    sel.addEventListener('change', load);
    btn.addEventListener('click', function () {
      var l = S.legal[sel.value];
      api('PUT', '/api/legal/' + l.file, { text: ta.value }).then(function () { l.text = ta.value; toast('Guardado y sitio regenerado.'); })
        .catch(function (e) { toast('No se pudo guardar: ' + e.message, true); });
    });
    main.appendChild(sel); wrap.appendChild(ta); main.appendChild(wrap); main.appendChild(btn);
    load();
  }
  function showData(id) {
    current = id;
    var sec = SECTIONS.filter(function (s) { return s.id === id; })[0];
    var main = $('main'); var y = window.scrollY; main.innerHTML = '';
    main.appendChild(el('h1', null, sec.label));
    Array.prototype.forEach.call(document.querySelectorAll('.side button'), function (b) { b.classList.toggle('on', b.dataset.id === id); });
    if (sec.legal) return showLegal(main);
    main.appendChild(el('p', 'hint', 'Los campos en rojo están vacíos: en ese idioma no se muestra nada. Los textos de cada página se editan en "Páginas".'));
    var obj = get(sec.path);
    Object.keys(obj).forEach(function (k) { render(main, k, obj, k); });
    window.scrollTo(0, y);
  }

  // ------------------------------------------------------------ tabs, keys, start
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (x) { x.classList.toggle('on', x === b); });
      $('view-pages').hidden = b.dataset.tab !== 'pages';
      $('view-data').hidden = b.dataset.tab !== 'data';
      if (b.dataset.tab === 'pages') { fitFrame(); schedulePreview(true); }
    });
  });
  $('save').addEventListener('click', save);
  $('pack').addEventListener('click', function () {
    if (!$('save').disabled && !confirm('Hay cambios sin guardar: el paquete se arma con lo último guardado. ¿Seguir?')) return;
    $('status').textContent = 'Empaquetando…';
    api('POST', '/api/pack').then(function (j) {
      refreshStatus();
      toast('Listo: ' + j.file + ' (' + (j.bytes / 1048576).toFixed(1) + ' MB). Ese zip es lo que se sube a Netlify.');
    }).catch(function (e) { refreshStatus(); toast('No se pudo empaquetar: ' + e.message, true); });
  });
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('save').disabled) save(); return; }
    if (e.key === 'Escape' && !$('modal').hidden) { closeModal(); return; }
    if (typing || $('view-pages').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 1 : -1); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); stepHistory(1); }
  });
  window.addEventListener('beforeunload', function (e) { if (!$('save').disabled) { e.preventDefault(); e.returnValue = ''; } });

  Promise.all([
    api('GET', '/api/content'), api('GET', '/api/pages'), api('GET', '/api/blocks'),
    api('GET', '/api/images'), api('GET', '/api/legal')
  ]).then(function (r) {
    S.data = r[0]; S.pages = r[1]; S.schema = r[2]; S.images = r[3]; S.legal = r[4];
    var side = $('side');
    SECTIONS.forEach(function (s) {
      if (s.sep) { side.appendChild(el('div', 'side-sep', s.sep)); return; }
      var b = el('button', null, s.label); b.type = 'button'; b.dataset.id = s.id;
      b.addEventListener('click', function () { showData(s.id); window.scrollTo(0, 0); });
      side.appendChild(b);
    });
    showData('site');
    fitFrame();
    openPage(S.pages.some(function (p) { return p.id === 'home'; }) ? 'home' : S.pages[0].id);
  }).catch(function (e) { $('props').textContent = 'No se pudo cargar el panel: ' + e.message; });
})();
