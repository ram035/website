/* =========================================================
   admin.js — CMS del portfolio
   Habla con server.js:  GET/PUT /api/projects, POST /api/upload…
   ========================================================= */
(function () {
  "use strict";

  var API = "../api";
  /* La vista previa copia la ventana en la que estás trabajando: misma
     proporción y mismo ancho de referencia. Antes era una caja 16/9 fija que
     representaba 1440 px, y eso mentía por partida doble en cualquier pantalla
     que no fuera exactamente así: los tokens salían relativamente más grandes
     de lo que iban a verse, y la distancia entre dos de ellos quedaba
     comprimida o estirada según la diferencia de proporción. */
  function pantalla() {
    return {
      w: Math.max(320, window.innerWidth || 1440),
      h: Math.max(240, window.innerHeight || 810)
    };
  }

  function ajustarMini() {
    var s = pantalla();
    elMini.style.aspectRatio = s.w + " / " + s.h;
    var nota = $("miniRef");
    if (nota) {
      nota.textContent = "La vista previa representa tu pantalla: " +
                         s.w + " × " + s.h + " px.";
    }
  }

  var LANGS = ["es", "en"];

  // Los dos tipos de hashtag. Sus nombres en el sitio salen de js/i18n.js.
  var TAG_GROUPS = [
    { id: "category", title: "Categoría" },
    { id: "industry", title: "Industria" }
  ];

  var data = { site: {}, projects: [] };
  var currentId = null;
  var dirty = false;
  var iconosBoton = [];      // img/button-icons/…, los ofrece la tarjeta de botón

  /* Archivos que se dejan de usar al guardar. Se comparan las rutas de lo
     último guardado (y de lo subido desde entonces) con las de lo que se va a
     guardar: las que faltan viajan con el guardado y el servidor las aparta a
     .papelera, siempre que nada más las use. */
  var RE_RUTA = /(?:projects|img)\/[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)*/g;
  var rutasGuardadas = [];
  var subidos = [];
  function rutasDe(obj) { return JSON.stringify(obj).match(RE_RUTA) || []; }
  function sinUso() {
    var hoy = {};
    rutasDe(data).forEach(function (r) { hoy[r.toLowerCase()] = true; });
    var visto = {};
    return rutasGuardadas.concat(subidos).filter(function (r) {
      var k = r.toLowerCase();
      if (hoy[k] || visto[k]) return false;
      return (visto[k] = true);
    });
  }
  var editLang = "en";        // el inglés es la raíz: se trabaja acá

  var $ = function (id) { return document.getElementById(id); };

  var elList    = $("projectList");
  var elEditor  = $("editor");
  var elEmpty   = $("empty");
  var elSite    = $("siteEditor");
  var elStatus  = $("status");
  var elBlocks  = $("blocks");
  var elMini    = $("mini");
  var elGhosts  = $("miniGhosts");
  var elMiniTok = $("miniToken");
  var elMiniImg = $("miniImg");

  /* ---------------- campos de color: sólo hex ----------------
     Texto con el código y una muestra al lado. El "#" se agrega solo: se
     puede escribir o pegar con o sin él. Mientras el código está a medias no
     se le avisa al resto del panel (así nunca se guarda un color roto), y al
     salir del campo, si quedó incompleto, vuelve al último color válido.
     Un código de 3 cifras (#f64) se completa a 6 al salir.
     Esto corre antes que cualquier otro listener de estos campos: por eso
     puede frenar el evento con stopImmediatePropagation. */
  var VALOR = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  function campoHex(el) {
    var muestra = el.parentNode.querySelector(".hex__muestra");
    var leer = function () { return VALOR.get.call(el); };
    var escribir = function (v) { VALOR.set.call(el, v); };
    var completo = function (v) { return /^#[0-9a-f]{6}$/.test(v); };
    var ultimo = completo(leer()) ? leer() : "#000000";

    function pintar(v) { if (muestra) muestra.style.background = completo(v) ? v : ultimo; }

    // cuando el panel carga un proyecto escribe .value por código: también pinta
    Object.defineProperty(el, "value", {
      configurable: true,
      get: leer,
      set: function (v) {
        escribir(v);
        if (completo(String(v).toLowerCase())) ultimo = String(v).toLowerCase();
        pintar(ultimo);
      }
    });

    el.addEventListener("input", function (e) {
      var crudo = leer();
      var limpio = "#" + crudo.replace(/[^0-9a-fA-F]/g, "").slice(0, 6).toLowerCase();
      if (limpio !== crudo) {
        var pos = el.selectionStart || 0;
        escribir(limpio);
        var p = Math.max(1, Math.min(limpio.length, pos + limpio.length - crudo.length));
        try { el.setSelectionRange(p, p); } catch (err) {}
      }
      if (!completo(limpio)) { e.stopImmediatePropagation(); return; }
      ultimo = limpio;
      pintar(ultimo);
    });

    el.addEventListener("change", function (e) {
      if (!completo(leer())) e.stopImmediatePropagation();
    });

    el.addEventListener("blur", function () {
      var v = leer();
      var m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
      if (m) {
        escribir("#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (!completo(v)) {
        escribir(ultimo);
      }
      pintar(ultimo);
    });

    pintar(ultimo);
  }

  Array.prototype.forEach.call(document.querySelectorAll(".hex input"), campoHex);

  /* ---------------- helpers ---------------- */

  function toast(msg, kind) {
    var t = $("toast");
    t.textContent = msg;
    t.dataset.kind = kind || "ok";
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function setStatus(text, cls) {
    elStatus.textContent = text;
    elStatus.className = "status" + (cls ? " " + cls : "");
  }

  function markDirty() {
    dirty = true;
    $("btnSave").disabled = false;
    setStatus("sin guardar", "is-dirty");
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

  function current() {
    return data.projects.filter(function (p) { return p.id === currentId; })[0] || null;
  }

  /* ---------------- campos traducibles ----------------
     Se guardan como { es, en, esAuto }. El inglés es la raíz: lo que escribís
     ahí baja solo al español. El español es una rama con candado: apenas lo
     tocás a mano, esAuto pasa a false y no se vuelve a pisar nunca, cambies lo
     que cambies en inglés. Vaciar el campo español suelta el candado y vuelve
     a seguir al inglés, que es la forma de arrepentirse.

     Ojo con el orden: el arrastre pasa acá, al escribir, y queda GUARDADO en
     el dato. El sitio sigue leyendo sólo lo que tiene guardado, sin mirar
     nunca el otro idioma. El cruce ocurre una vez, en el panel, no en vivo. */

  function toML(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      var o = {};
      LANGS.forEach(function (l) { o[l] = typeof v[l] === "string" ? v[l] : ""; });
      // Sin dato previo: lo que ya tiene español escrito es tuyo y no se toca;
      // lo que está vacío queda libre para que lo llene el inglés.
      o.esAuto = typeof v.esAuto === "boolean" ? v.esAuto : !o.es;
      // contenido viejo escrito sólo en inglés: la rama nace ahora, copiada
      if (o.esAuto && !o.es && o.en) o.es = o.en;
      return o;
    }
    // texto suelto de una versión vieja: es español escrito a mano
    return { es: typeof v === "string" ? v : "", en: "", esAuto: !(typeof v === "string" && v) };
  }

  /* ¿Este campo sigue viniendo del inglés, sin revisar? */
  function esAutomatico(obj, key) {
    var v = obj && obj[key];
    return !!(v && typeof v === "object" && v.esAuto && (v.es || v.en));
  }

  /* La regla, en un solo lugar, para textos y para hashtags. */
  function aplicarRaiz(campo, lang, valor) {
    campo[lang] = valor;
    if (lang === "en") {
      if (campo.esAuto) campo.es = valor;      // la rama sigue al tronco
    } else if (valor) {
      campo.esAuto = false;                    // lo tocaste: es tuyo
    } else {
      campo.esAuto = true;                     // lo vaciaste: vuelve al tronco
      campo.es = campo.en || "";
    }
  }

  /* Lee el valor en el idioma que se está editando. */
  /* El link de un botón también va por idioma. Uno viejo (un solo texto)
     vale para los dos: el español queda siguiendo al inglés. */
  function urlML(v) {
    if (typeof v === "string") return { es: v, en: v, esAuto: true };
    return toML(v);
  }

  function ml(obj, key) {
    if (!obj) return "";
    var v = obj[key];
    if (typeof v === "string") return editLang === "es" ? v : "";
    return (v && v[editLang]) || "";
  }

  function setMl(obj, key, value) {
    obj[key] = toML(obj[key]);
    aplicarRaiz(obj[key], editLang, value);
  }

  /* Para listados: el idioma actual, y si está vacío el otro. */
  function mlAny(v) {
    if (typeof v === "string") return v;
    if (!v) return "";
    if (v[editLang]) return v[editLang];
    for (var i = 0; i < LANGS.length; i++) { if (v[LANGS[i]]) return v[LANGS[i]]; }
    return "";
  }

  /* Convierte todo el archivo al esquema bilingüe al cargarlo. */
  function normalize(d) {
    d.site = d.site || {};
    if (!d.site.defaultLang) d.site.defaultLang = "es";
    if (!Array.isArray(d.site.languages)) d.site.languages = LANGS.slice();
    d.site.ui = d.site.ui === "clear" ? "clear" : "dark";
    d.site.background = d.site.background || {};
    Object.keys(FONDO_POR_DEFECTO).forEach(function (k) {
      if (typeof d.site.background[k] !== "string") {
        d.site.background[k] = FONDO_POR_DEFECTO[k];
      }
    });
    d.site.tags = d.site.tags || {};
    TAG_GROUPS.forEach(function (g) {
      if (!Array.isArray(d.site.tags[g.id])) d.site.tags[g.id] = [];
      // misma regla que los textos: raíz inglesa, rama española con candado
      d.site.tags[g.id].forEach(function (t) {
        if (typeof t.esAuto !== "boolean") t.esAuto = !t.es;
        if (t.esAuto && !t.es && t.en) t.es = t.en;
      });
    });
    (d.projects || []).forEach(function (p) {
      // "bulletin" era el nombre viejo de la subpágina
      p.kind = p.kind === "bulletin" || p.kind === "page" ? "page"
             : p.kind === "html" ? "html" : "project";
      p.tags = p.tags || {};
      TAG_GROUPS.forEach(function (g) {
        if (!Array.isArray(p.tags[g.id])) p.tags[g.id] = [];
      });
      p.title = toML(p.title);
      p.subtitle = toML(p.subtitle);
      p.role = toML(p.role);
      (p.blocks || []).forEach(function (b) {
        if (b.type === "text") b.content = toML(b.content);
        if (b.type === "button") { b.label = toML(b.label); b.url = urlML(b.url); }
        if (b.type === "row") {
          b.cells = Array.isArray(b.cells) ? b.cells : [];
          b.cells.forEach(function (c) {
            if (c.type === "text") c.content = toML(c.content);
            if (c.type === "button") { c.label = toML(c.label); c.url = urlML(c.url); }
            if (["image", "video", "lottie"].indexOf(c.type) >= 0) c.caption = toML(c.caption);
          });
        }
        if (["image", "video", "lottie"].indexOf(b.type) >= 0 || "caption" in b) {
          b.caption = toML(b.caption);
        }
        if ("alt" in b) b.alt = toML(b.alt);
      });
    });
    return d;
  }

  function rootSrc(src) {          // "projects/x/a.jpg" → "../projects/x/a.jpg"
    if (!src) return "";
    if (/^(https?:)?\/\//.test(src)) return src;
    return "../" + src.replace(/^\.?\//, "");
  }

  function extOf(src) {
    var s = String(src || "").split("?")[0];
    var i = s.lastIndexOf(".");
    return i < 0 ? "" : s.slice(i + 1).toLowerCase();
  }

  function typeFromFile(name) {
    var e = extOf(name);
    if (["mp4", "webm", "mov", "m4v", "ogv"].indexOf(e) >= 0) return "video";
    if (e === "json") return "lottie";
    return "image";
  }

  /* ---------------- API ---------------- */

  function getJSON(u) {
    return fetch(u, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function saveAll() {
    setStatus("guardando…");
    return fetch(API + "/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function () {
      var descartar = sinUso();
      rutasGuardadas = rutasDe(data);
      subidos = [];
      dirty = false;
      $("btnSave").disabled = true;
      setStatus("guardado", "is-ok");
      if (!descartar.length) return toast("Cambios guardados en data/projects.json");
      // lo reemplazado se aparta recién ahora, con los datos ya guardados
      return fetch(API + "/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: descartar })
      }).then(function (r) { return r.ok ? r.json() : { total: 0 }; })
        .catch(function () { return { total: 0 }; })
        .then(function (r) {
          toast("Cambios guardados" + (r.total
            ? " · " + r.total + (r.total === 1 ? " archivo reemplazado pasó" : " archivos reemplazados pasaron") + " a .papelera"
            : ""));
        });
    }).catch(function (e) {
      setStatus("error al guardar", "is-dirty");
      toast("No se pudo guardar: " + e.message + " · ¿está corriendo node server.js?", "error");
    });
  }

  function uploadFile(file) {
    var u = API + "/upload?id=" + encodeURIComponent(currentId) +
            "&name=" + encodeURIComponent(file.name);
    return fetch(u, { method: "POST", body: file }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (r) { subidos.push(r.src); return r; });
  }

  /* ---------------- lista lateral ---------------- */

  function renderList() {
    elList.innerHTML = "";
    data.projects.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pitem" + (p.id === currentId ? " is-active" : "");
      b.onclick = function () { select(p.id); };

      var img = document.createElement("img");
      img.className = "pitem__thumb";
      img.alt = "";
      if (p.token && p.token.image) ponerVista(img, p.token.image);
      b.appendChild(img);

      var txt = document.createElement("span");
      txt.className = "pitem__txt";
      txt.innerHTML = '<span class="pitem__name"></span><span class="pitem__id"></span>';
      txt.querySelector(".pitem__name").textContent = mlAny(p.title) || "(sin título)";
      var marcas = [];
      if (p.kind === "page") marcas.push("subpágina");
      if (p.kind === "html") marcas.push("página HTML");
      if (p.token && p.token.show === false) marcas.push("sin token");
      txt.querySelector(".pitem__id").textContent = p.id + (marcas.length ? " · " + marcas.join(" · ") : "");
      b.appendChild(txt);

      elList.appendChild(b);
    });
  }

  /* ---------------- formulario ---------------- */

  /* Cambiar de proyecto no pierde nada: todo vive en `data` y se guarda junto
     (saveAll manda el archivo entero). Antes preguntaba "¿cambiar igual?" y
     ponía dirty = false: los cambios seguían en memoria pero el panel decía
     "listo" y el botón Guardar se apagaba, así que al recargar se perdían sin
     aviso. Ahora el aviso de "sin guardar" se mantiene hasta guardar. */
  function select(id) {
    currentId = id;
    var p = current();
    renderList();

    if (p) elSite.hidden = true;
    if (p && elPaginas) elPaginas.hidden = true;
    elEmpty.hidden = !!p || !elSite.hidden;
    elEditor.hidden = !p;
    $("btnDelete").disabled = !p;
    $("btnPreview").disabled = !p;
    $("btnSave").disabled = !dirty;
    if (dirty) setStatus("sin guardar", "is-dirty"); else setStatus("listo");
    $("topId").textContent = p ? p.id : "—";
    if (p) fillForm(p);
  }

  var TINTA_DEFECTO = "#ff5221";   // color por defecto de las tres tintas de la acuarela

  function fillForm(p) {
    p.token = p.token || {};
    ajustarMini();
    $("fTitle").value    = ml(p, "title");
    $("fSubtitle").value = ml(p, "subtitle");
    $("fYear").value     = p.year || "";
    $("fRole").value     = ml(p, "role");
    $("fTheme").value    = p.theme === "light" ? "light" : "dark";
    $("fHoverFx").value  = p.token.hoverFx === "scribble" ? "scribble" : "none";
    $("fInkColor").value = /^#[0-9a-fA-F]{6}$/.test(p.token.inkColor || "") ? p.token.inkColor : "#251a57";
    $("inkColorWrap").hidden = $("fHoverFx").value !== "scribble";
    $("inkHint").hidden      = $("fHoverFx").value !== "scribble";
    $("fFloat").value = p.token.float ? "si" : "no";
    $("fStrokes").value = p.token.strokes === false ? "no" : "si";   // por defecto, sí
    $("fStrokesLoop").checked = p.token.strokeLoop !== false;         // por defecto, sí
    $("fStrokesFree").checked = p.token.strokeFree === true;          // por defecto, no
    avisoTrazos(p);
    avisoFlotar(p);

    var wc = p.token.watercolor || {};
    var tintas = Array.isArray(wc.colors) ? wc.colors : [];
    $("fWcOn").value    = wc.on ? "si" : "no";
    // por defecto, las tres en #ff5221; apagada, muestra las que tendrá al prenderla
    if (!wc.on) tintas = [];
    $("fWc1").value     = tinta(tintas[0], TINTA_DEFECTO);
    $("fWc2").value     = tinta(tintas[1], TINTA_DEFECTO);
    $("fWc3").value     = tinta(tintas[2], TINTA_DEFECTO);
    // por defecto: debajo del token y en mezcla normal
    // apagada, muestra lo que tendrá al prenderla (lo guardado es de otra época)
    $("fWcBlend").value = (wc.on && wc.blend) || "normal";
    $("fWcLayer").value = wc.on && wc.layer === "over" ? "over" : "under";
    var op = Math.round((Number(wc.opacity) > 0 ? Number(wc.opacity) : 1) * 100);
    $("fWcOp").value = op;
    $("outWcOp").textContent = op;
    $("wcWrap").hidden  = !wc.on;
    $("fKind").value     = p.kind;
    $("fShowToken").value = p.token.show === false ? "no" : "si";
    $("fId").value       = p.id;
    // el tope del slider se abre antes de asignar el valor, si no lo recorta
    $("fWidth").max      = Math.max(1200, num(p.token.width, 200) * 1.5);
    $("fWidth").value    = num(p.token.width, 200);
    $("fRot").value      = num(p.token.rotation, 0);
    $("fX").value        = num(p.token.x, 0.5).toFixed(2);
    $("fY").value        = num(p.token.y, 0.5).toFixed(2);
    $("outWidth").value = num(p.token.width, 200);
    $("outRot").textContent   = num(p.token.rotation, 0);

    var prev = $("tokenPreview");
    if (p.token.image) { ponerVista(prev, p.token.image); prev.hidden = false; }
    else { prev.removeAttribute("src"); prev.hidden = true; }

    if (p.token.image) { ponerVista(elMiniImg, p.token.image); elMiniImg.hidden = false; }
    else { elMiniImg.removeAttribute("src"); elMiniImg.hidden = true; }

    lapizProyecto("wrapTitle", "fTitle", p, "title");
    lapizProyecto("wrapSubtitle", "fSubtitle", p, "subtitle");
    lapizProyecto("wrapRole", "fRole", p, "role");

    aplicarTipo(p);
    paintHover(p);
    readNatural(p.token.image);
    syncMini();
    pintarFantasmas();
    renderTags();
    renderBlocks();
  }

  /* Los tres campos de arriba son HTML fijo, así que el lápiz se les cuelga
     y se les saca a mano en cada carga. */
  function lapizProyecto(wrapId, inputId, p, key) {
    var caja = $(wrapId), campo = $(inputId);
    if (!caja || !campo) return;
    var viejo = caja.querySelector(".trad__lapiz");
    if (viejo) viejo.remove();
    caja.classList.remove("es-copia", "is-editing");
    campo.readOnly = false;

    if (editLang !== "es" || !esAutomatico(p, key)) return;

    caja.classList.add("es-copia");
    campo.readOnly = true;
    var lapiz = document.createElement("button");
    lapiz.type = "button";
    lapiz.className = "trad__lapiz";
    lapiz.textContent = "✎";
    lapiz.title = "Viene del inglés. Tocá para escribir la versión en español.";
    lapiz.setAttribute("aria-label", lapiz.title);
    lapiz.addEventListener("click", function () {
      campo.readOnly = false;
      caja.classList.remove("es-copia");
      caja.classList.add("is-editing");
      campo.focus();
      campo.select();
    });
    caja.appendChild(lapiz);
  }

  function bindField(inputId, key, translatable) {
    $(inputId).addEventListener("input", function () {
      var p = current(); if (!p) return;
      if (translatable) setMl(p, key, this.value);
      else p[key] = this.value;
      if (key === "title") renderList();
      markDirty();
    });
  }

  bindField("fTitle", "title", true);
  bindField("fSubtitle", "subtitle", true);
  bindField("fYear", "year");
  bindField("fRole", "role", true);
  $("fTheme").addEventListener("change", function () {
    var p = current(); if (!p) return;
    p.theme = this.value;
    markDirty();
  });

  function tinta(v, porDefecto) {
    return /^#[0-9a-fA-F]{6}$/.test(v || "") ? v : porDefecto;
  }

  /* Mancha de acuarela: hasta tres tintas que se mezclan entre ellas. Es
     independiente de los rayones, así que se pueden usar los dos juntos. */
  function acuarela() {
    var p = current(); if (!p) return null;
    p.token = p.token || {};
    p.token.watercolor = p.token.watercolor || {};
    return p.token.watercolor;
  }

  function guardarTintas() {
    var wc = acuarela(); if (!wc) return;
    wc.colors = [$("fWc1").value, $("fWc2").value, $("fWc3").value];
    markDirty();
  }

  /* Baile 3D: el ícono entero se acerca y gira a un lado y al otro. Sirve
     para cualquier imagen de token. */
  function avisoFlotar(p) {
    var aviso = $("floatHint");
    aviso.hidden = !p.token.float;
    aviso.textContent = "Con el cursor encima, el ícono se acerca un poco y gira en 3D " +
                        "hacia un lado y hacia el otro, en bucle; al salir vuelve a su lugar.";
    aviso.classList.remove("is-alerta");
  }
  /* Trazos animados: sólo SVG, y sólo si conserva líneas como trazos (sin
     relleno). Se revisa el archivo y se avisa si no hay nada que animar. */
  function avisoTrazos(p) {
    var aviso = $("strokesHint");
    var loopWrap = $("strokesLoopWrap");
    var freeWrap = $("strokesFreeWrap");
    var src = (p.token && p.token.image) || "";
    var prendido = p.token.strokes !== false;   // por defecto, sí
    var esSvg = /\.svg($|\?)/i.test(src);
    if (loopWrap) {
      loopWrap.hidden = !prendido || !esSvg;
      $("fStrokesLoop").checked = p.token.strokeLoop !== false;
    }
    if (freeWrap) {
      freeWrap.hidden = !prendido || !esSvg;
      $("fStrokesFree").checked = p.token.strokeFree === true;
    }
    // prendido por defecto en un token que no es SVG: no hay nada que avisar
    aviso.hidden = !prendido || (p.token.strokes !== true && !esSvg);
    aviso.classList.remove("is-alerta");
    if (aviso.hidden) return;
    if (!esSvg) {
      aviso.textContent = "Necesita que el token sea un .svg.";
      aviso.classList.add("is-alerta");
      return;
    }
    aviso.textContent = "Revisando las líneas del SVG…";
    fetch(rootSrc(src), { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (texto) {
      var caja = document.createElement("div");
      caja.style.cssText = "position:absolute;left:-9999px;top:0;width:100px;height:100px";
      caja.innerHTML = texto.replace(/<\?xml[^>]*>/, "").replace(/<script[\s\S]*?<\/script>/gi, "");
      document.body.appendChild(caja);
      var n = Array.prototype.filter.call(caja.querySelectorAll("path, circle, ellipse, rect, polygon, polyline, line"), function (e) {
        var cs = getComputedStyle(e);
        return cs.stroke && cs.stroke !== "none" && (cs.fill === "none" || cs.fillOpacity === "0");
      }).length;
      caja.remove();
      if (!current() || current() !== p) return;
      var enBucle = p.token.strokeLoop !== false;
      aviso.textContent = n
        ? (enBucle
            ? "Con el cursor encima, sus " + n + (n === 1 ? " línea se borra" : " líneas se borran") + " y se vuelve" + (n === 1 ? "" : "n") + " a dibujar, escalonadas y en bucle; al salir, las que iban por la mitad terminan rápido y no empieza ninguna más."
            : "Con el cursor encima, sus " + n + (n === 1 ? " línea se dibuja" : " líneas se dibujan") + " hasta completarse y se detiene" + (n === 1 ? "" : "n") + "; al salir, regresa" + (n === 1 ? "" : "n") + " en reversa a su posición original.")
        : "Este SVG no tiene líneas sueltas (quizás se expandieron en Illustrator): el token se ve tal cual. Podés dejarlo en «Sí»: si cambiás a un archivo con líneas, se animan solas.";
      aviso.classList.remove("is-alerta");
    }).catch(function () { aviso.textContent = "No se pudo revisar el SVG."; });
  }
  $("fStrokes").addEventListener("change", function () {
    var p = current(); if (!p) return;
    // "sí" es el valor por defecto: no se guarda; "no" queda escrito
    if (this.value === "no") p.token.strokes = false; else delete p.token.strokes;
    avisoTrazos(p);
    markDirty();
  });

  $("fStrokesLoop").addEventListener("change", function () {
    var p = current(); if (!p || !p.token) return;
    if (this.checked) delete p.token.strokeLoop; else p.token.strokeLoop = false;
    avisoTrazos(p);
    markDirty();
  });

  // "Extender trazo libre": sin marcar (lo normal) el trazo se recorta en el
  // borde del SVG y no se guarda nada; marcada queda escrito strokeFree: true
  $("fStrokesFree").addEventListener("change", function () {
    var p = current(); if (!p || !p.token) return;
    if (this.checked) p.token.strokeFree = true; else delete p.token.strokeFree;
    markDirty();
  });

  $("fFloat").addEventListener("change", function () {
    var p = current(); if (!p) return;
    if (this.value === "si") p.token.float = true; else delete p.token.float;
    avisoFlotar(p);
    markDirty();
  });

  /* Rayones de lapicera: un efecto de hover que se genera solo, sin archivo.
     No reemplaza a la imagen de hover; se dibuja encima. */
  $("fHoverFx").addEventListener("change", function () {
    var p = current(); if (!p) return;
    p.token = p.token || {};
    p.token.hoverFx = this.value === "scribble" ? "scribble" : "none";
    if (p.token.hoverFx === "scribble" && !p.token.inkColor) {
      p.token.inkColor = $("fInkColor").value || "#251a57";
    }
    $("inkColorWrap").hidden = p.token.hoverFx !== "scribble";
    $("inkHint").hidden      = p.token.hoverFx !== "scribble";
    markDirty();
  });

  $("fInkColor").addEventListener("input", function () {
    var p = current(); if (!p) return;
    p.token = p.token || {};
    p.token.inkColor = this.value;
    markDirty();
  });

  $("fWcOn").addEventListener("change", function () {
    var wc = acuarela(); if (!wc) return;
    var prende = this.value === "si" && !wc.on;
    wc.on = this.value === "si";
    if (wc.on && !Array.isArray(wc.colors)) {
      wc.colors = [$("fWc1").value, $("fWc2").value, $("fWc3").value];
    }
    // al prenderla, las tres tintas en el color por defecto
    if (prende) {
      wc.colors = [TINTA_DEFECTO, TINTA_DEFECTO, TINTA_DEFECTO];
      ["fWc1", "fWc2", "fWc3"].forEach(function (id) { $(id).value = TINTA_DEFECTO; });   // la muestra se pinta sola
    }
    // Al prenderla arranca siempre con lo de por defecto: debajo y normal.
    // Antes conservaba la mezcla que el token tenía guardada de otra época
    // (Keysense volvía con "Subexponer color").
    if (prende) {
      wc.blend = "normal";
      wc.layer = "under";
      $("fWcBlend").value = "normal";
      $("fWcLayer").value = "under";
    }
    $("wcWrap").hidden = !wc.on;
    markDirty();
  });

  ["fWc1", "fWc2", "fWc3"].forEach(function (id) {
    $(id).addEventListener("input", guardarTintas);
  });

  /* Encima mancha el dibujo; debajo pasa por detrás. En los dos casos el modo
     de mezcla actúa contra el papel del fondo. */
  $("fWcLayer").addEventListener("change", function () {
    var wc = acuarela(); if (!wc) return;
    wc.layer = this.value === "under" ? "under" : "over";
    markDirty();
  });

  $("fWcOp").addEventListener("input", function () {
    var wc = acuarela(); if (!wc) return;
    wc.opacity = Number(this.value) / 100;
    $("outWcOp").textContent = this.value;
    markDirty();
  });

  $("fWcBlend").addEventListener("change", function () {
    var wc = acuarela(); if (!wc) return;
    wc.blend = this.value;
    markDirty();
  });

  /* ---------------- tipo de página ----------------
     Proyecto de portfolio: todo. Subpágina: bloques, sin año, rol ni
     hashtags, fuera del paso entre proyectos. Página HTML: un archivo .html
     de la carpeta, que se edita acá mismo. Cualquiera puede no tener token:
     entonces se llega desde un botón de otra página. */
  function aplicarTipo(p) {
    var k = p.kind, conToken = p.token.show !== false;
    $("campoYear").hidden = k !== "project";
    $("campoRole").hidden = k !== "project";
    $("cardTags").hidden = k !== "project";
    $("cardBlocks").hidden = k === "html";
    $("cardHtml").hidden = k !== "html";
    $("cardToken").hidden = !conToken;

    var aviso = $("kindHint");
    aviso.hidden = true;
    if (!conToken) {
      var llegan = quienesEnlazan(p);
      aviso.hidden = false;
      aviso.textContent = llegan.length
        ? "Se llega desde: " + llegan.join(", ") + "."
        : "Todavía nadie llega a esta página: enlazala desde un botón de otra página (Link → Página del sitio).";
    }
    if (k === "html") cargarHtml(p);
  }

  // qué otras páginas tienen un link a esta
  function quienesEnlazan(p) {
    var nombres = [p.id].concat(p.aliases || []);
    return data.projects.filter(function (o) {
      if (o === p) return false;
      var t = JSON.stringify(o.blocks || []);
      return nombres.some(function (n) { return t.indexOf('"#/p/' + n + '"') >= 0; });
    }).map(function (o) { return mlAny(o.title) || o.id; });
  }

  $("fKind").addEventListener("change", function () {
    var p = current(); if (!p) return;
    p.kind = this.value;
    markDirty();
    aplicarTipo(p);
    renderList();
  });

  $("fShowToken").addEventListener("change", function () {
    var p = current(); if (!p) return;
    if (this.value === "no") p.token.show = false; else delete p.token.show;
    markDirty();
    aplicarTipo(p);
    renderList();
    pintarFantasmas();
  });

  /* ---------------- página HTML de la carpeta ----------------
     Editor de código a la izquierda, vista previa en vivo a la derecha (con
     <base> apuntando a la carpeta, así las imágenes se ven), la lista de
     archivos para insertarlos y subir más. El HTML se guarda aparte de los
     datos: "Guardar HTML" (o Ctrl+S dentro del editor). */
  var editorHtml = { id: null, nombre: null, original: "", sucio: false };
  var vistaPendiente = 0;

  function marcarHtml(sucio, texto) {
    editorHtml.sucio = sucio;
    $("htmlGuardar").disabled = !sucio;
    $("htmlEstado").textContent = texto || (sucio ? "HTML sin guardar" : "");
    $("htmlEstado").className = "html-estado" + (sucio ? " is-sucio" : "");
  }

  function listarCarpeta(id) {
    return getJSON(API + "/project/files?id=" + encodeURIComponent(id))
      .then(function (r) { return Array.isArray(r.files) ? r.files : []; });
  }

  function cargarHtml(p) {
    if (editorHtml.sucio && editorHtml.id && editorHtml.id !== p.id &&
        confirm("El HTML de " + editorHtml.id + "/" + editorHtml.nombre +
                " tiene cambios sin guardar. ¿Guardarlos ahora?")) {
      guardarHtml();
    }
    var id = p.id;
    listarCarpeta(id).then(function (files) {
      if (!current() || current().id !== id) return;
      var htmls = files.filter(function (f) { return /\.html?$/i.test(f.src); });
      var sel = $("htmlArchivo");
      sel.innerHTML = "";
      var elegido = p.html ? p.html.split("/").pop() : "";
      var vacia = document.createElement("option");
      vacia.value = "";
      vacia.textContent = htmls.length ? "— elegí un archivo —" : "(la carpeta no tiene páginas)";
      sel.appendChild(vacia);
      htmls.forEach(function (f) {
        var o = document.createElement("option");
        o.value = f.src;
        o.textContent = f.src;
        sel.appendChild(o);
      });
      sel.value = htmls.some(function (f) { return f.src === elegido; }) ? elegido : "";
      pintarArchivos(files);
      if (sel.value && !(editorHtml.id === id && editorHtml.nombre === sel.value)) leerHtml(id, sel.value);
      else if (!sel.value) { editorHtml.id = id; editorHtml.nombre = null; $("htmlCodigo").value = ""; marcarHtml(false); vista(); }
    }).catch(function (e) { toast("No se pudo leer la carpeta: " + e.message + " · ¿reiniciaste node server.js?", "error"); });
  }

  function leerHtml(id, nombre) {
    return fetch(rootSrc("projects/" + id + "/" + nombre), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (t) {
        editorHtml.id = id; editorHtml.nombre = nombre; editorHtml.original = t;
        $("htmlCodigo").value = t;
        $("htmlCodigo").scrollTop = $("htmlCodigo").scrollLeft = 0;   // arriba de todo, archivo nuevo
        marcarHtml(false);
        vista();
      })
      .catch(function (e) { toast("No se pudo abrir " + nombre + ": " + e.message, "error"); });
  }

  function vista() {
    var cod = $("htmlCodigo").value;
    if (!editorHtml.id || !cod) { $("htmlVista").srcdoc = ""; return; }
    var base = '<base href="' + new URL(rootSrc("projects/" + editorHtml.id + "/"), location.href).href + '">';
    cod = /<head[^>]*>/i.test(cod) ? cod.replace(/<head[^>]*>/i, function (m) { return m + base; }) : base + cod;
    $("htmlVista").srcdoc = cod;
  }

  function guardarHtml() {
    if (!editorHtml.id || !editorHtml.nombre) return Promise.resolve();
    var texto = $("htmlCodigo").value;
    var u = API + "/project/html?id=" + encodeURIComponent(editorHtml.id) +
            "&name=" + encodeURIComponent(editorHtml.nombre);
    return fetch(u, { method: "PUT", headers: { "Content-Type": "text/html; charset=utf-8" }, body: texto })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function () {
        editorHtml.original = texto;
        marcarHtml(false, "HTML guardado");
      })
      .catch(function (e) { toast("No se pudo guardar el HTML: " + e.message + " · ¿reiniciaste node server.js?", "error"); });
  }

  function pintarArchivos(files) {
    var caja = $("htmlLista");
    caja.innerHTML = "";
    files.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = f.src;
      b.addEventListener("click", function () { insertarEnCodigo(fragmentoDe(f.src)); });
      caja.appendChild(b);
    });
    if (!files.length) caja.textContent = "La carpeta está vacía.";
  }

  function fragmentoDe(nombre) {
    var ext = extOf(nombre);
    if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].indexOf(ext) >= 0) return '<img src="' + nombre + '" alt="">';
    if (["mp4", "webm", "mov"].indexOf(ext) >= 0) return '<video src="' + nombre + '" controls playsinline></video>';
    if (["mp3", "wav", "ogg", "m4a"].indexOf(ext) >= 0) return '<audio src="' + nombre + '" controls></audio>';
    if (ext === "css") return '<link rel="stylesheet" href="' + nombre + '">';
    if (ext === "js") return '<script src="' + nombre + '"></' + 'script>';
    return '<a href="' + nombre + '">' + nombre + '</a>';
  }

  function insertarEnCodigo(txt) {
    var t = $("htmlCodigo");
    var a = t.selectionStart || 0, z = t.selectionEnd || 0;
    t.value = t.value.slice(0, a) + txt + t.value.slice(z);
    t.selectionStart = t.selectionEnd = a + txt.length;
    t.focus();
    t.dispatchEvent(new Event("input"));
  }

  $("htmlCodigo").addEventListener("input", function () {
    if (!editorHtml.nombre) return;
    marcarHtml(this.value !== editorHtml.original);
    clearTimeout(vistaPendiente);
    vistaPendiente = setTimeout(vista, 250);
  });
  $("htmlCodigo").addEventListener("keydown", function (e) {
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {       // tab = dos espacios
      e.preventDefault();
      insertarEnCodigo("  ");
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      guardarHtml();
    }
  });
  $("htmlGuardar").addEventListener("click", guardarHtml);
  $("htmlVisual").addEventListener("click", function () {
    var p = current(); if (!p) return;
    var nombre = $("htmlArchivo").value;
    abrirPaginas(nombre ? "projects/" + p.id + "/" + nombre : null);
  });

  $("htmlArchivo").addEventListener("change", function () {
    var p = current(); if (!p) return;
    var nombre = this.value;
    if (editorHtml.sucio && !confirm("Hay cambios sin guardar en " + editorHtml.nombre + ". ¿Descartarlos?")) {
      this.value = editorHtml.nombre || "";
      return;
    }
    if (nombre) { p.html = "projects/" + p.id + "/" + nombre; leerHtml(p.id, nombre); }
    else delete p.html;
    markDirty();
  });

  $("htmlNueva").addEventListener("click", function () {
    var p = current(); if (!p) return;
    var opciones = Array.prototype.map.call($("htmlArchivo").options, function (o) { return o.value; });
    var nombre = prompt("Nombre del archivo nuevo:", opciones.indexOf("index.html") >= 0 ? "pagina.html" : "index.html");
    if (!nombre) return;
    nombre = nombre.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
    if (!/\.html?$/i.test(nombre)) nombre += ".html";
    if (opciones.indexOf(nombre) >= 0) { toast("Ya existe " + nombre + " en la carpeta.", "error"); return; }
    var titulo = mlAny(p.title) || p.id;
    var plantilla = [
      "<!doctype html>",
      '<html lang="es">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>" + titulo + "</title>",
      "<style>",
      "  body{ margin:0; padding:96px 24px 48px; font-family:system-ui, sans-serif; color:#e9e6e0; }",
      "  .contenido{ max-width:860px; margin:0 auto; }",
      "  img{ max-width:100%; height:auto; display:block; }",
      "  a{ color:inherit; }",
      "</style>",
      "</head>",
      "<body>",
      '<div class="contenido">',
      "  <h1>" + titulo + "</h1>",
      "  <p>Escribí acá el contenido de la página.</p>",
      "  <!-- Otra página del sitio, en una ventana encima:",
      '       <a href="#/p/nombre-de-la-pagina">Otra página</a> -->',
      "</div>",
      "</body>",
      "</html>",
      ""
    ].join("\n");
    fetch(API + "/project/html?id=" + encodeURIComponent(p.id) + "&name=" + encodeURIComponent(nombre),
          { method: "PUT", headers: { "Content-Type": "text/html; charset=utf-8" }, body: plantilla })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function () {
        p.html = "projects/" + p.id + "/" + nombre;
        editorHtml.nombre = null;       // que la recargue
        markDirty();
        cargarHtml(p);
        toast("Página creada: " + nombre);
      })
      .catch(function (e) { toast("No se pudo crear: " + e.message + " · ¿reiniciaste node server.js?", "error"); });
  });

  $("htmlSubir").addEventListener("click", function () { $("htmlSubirArchivo").click(); });
  $("htmlSubirArchivo").addEventListener("change", function () {
    var p = current(); if (!p) return;
    var files = Array.prototype.slice.call(this.files || []);
    this.value = "";
    files.reduce(function (cad, f) {
      return cad.then(function () { return uploadFile(f); });
    }, Promise.resolve())
      .then(function () { return listarCarpeta(p.id); })
      .then(function (lista) {
        pintarArchivos(lista);
        toast(files.length === 1 ? "Subido: " + files[0].name : files.length + " archivos subidos");
      })
      .catch(function (e) { toast("Error al subir: " + e.message, "error"); });
  });

  /* ---------------- token: imagen ---------------- */

  function setupDrop(dropId, inputId, pickId, onFiles, accept) {
    var drop = $(dropId), input = $(inputId), pick = $(pickId);
    pick.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      if (input.files && input.files.length) onFiles(Array.prototype.slice.call(input.files));
      input.value = "";
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
    });
    drop.addEventListener("drop", function (e) {
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (files.length) onFiles(files);
    });
  }

  setupDrop("tokenDrop", "tokenFile", "btnTokenPick", function (files) {
    var p = current(); if (!p) return toast("Elegí primero un proyecto", "error");
    uploadFile(files[0]).then(function (r) {
      p.token = p.token || {};
      p.token.image = r.src;
      // Archivo nuevo, trazos de nuevo por defecto (prendidos): un "No"
      // elegido para el archivo anterior (que quizás no tenía líneas) no
      // tiene por qué valer para este, y dejaba sus líneas a la vista.
      delete p.token.strokes;
      delete p.token.strokeLoop;
      delete p.token.strokeFree;
      $("fStrokes").value = "si";
      $("fStrokesLoop").checked = true;
      $("fStrokesFree").checked = false;
      avisoTrazos(p);
      ponerVista($("tokenPreview"), r.src);
      $("tokenPreview").hidden = false;
      ponerVista(elMiniImg, r.src);
      elMiniImg.hidden = false;
      syncMini();
      renderList();
      markDirty();
      readNatural(r.src, function (n) {
        setWidth(p, n.w);
        toast("Token cargado a tamaño real: " + n.w + "×" + n.h + " px");
      });
    }).catch(function (e) { toast("Error al subir: " + e.message, "error"); });
  });

  /* ---------------- vista de un token Lottie ----------------
     Un token puede ser un Lottie (.json): las vistas del panel (tarjeta,
     mini-mapa, lista) muestran su primer cuadro. Se dibuja una vez con
     lottie (el mismo del sitio) y se guarda como imagen SVG. */
  var LOTTIE_PANEL = "https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie_light.min.js";
  var lottiePanel = null;
  var vistasLottie = {};

  function cargarLottiePanel() {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (lottiePanel) return lottiePanel;
    lottiePanel = new Promise(function (ok, mal) {
      var sc = document.createElement("script");
      sc.src = LOTTIE_PANEL;
      sc.onload = function () { ok(window.lottie); };
      sc.onerror = mal;
      document.head.appendChild(sc);
    });
    return lottiePanel;
  }

  function vistaLottie(src) {
    if (vistasLottie[src]) return vistasLottie[src];
    vistasLottie[src] = Promise.all([
      cargarLottiePanel(),
      fetch(rootSrc(src), { cache: "no-store" }).then(function (r) { return r.json(); })
    ]).then(function (res) {
      var datos = res[1];
      var caja = document.createElement("div");
      caja.style.cssText = "position:absolute;left:-9999px;top:0;width:" + (datos.w || 100) + "px;height:" + (datos.h || 100) + "px";
      document.body.appendChild(caja);
      return new Promise(function (ok) {
        var anim = res[0].loadAnimation({ container: caja, renderer: "svg", loop: false, autoplay: false, animationData: datos });
        anim.addEventListener("DOMLoaded", function () {
          anim.goToAndStop(0, true);
          var svg = caja.querySelector("svg");
          var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
          anim.destroy();
          caja.remove();
          ok(url);
        });
      });
    });
    return vistasLottie[src];
  }

  // pone en un <img> la vista del token: la imagen, o el primer cuadro si es Lottie
  function ponerVista(img, src) {
    if (!/\.json($|\?)/i.test(src || "")) { img.src = rootSrc(src); return; }
    img.removeAttribute("src");
    vistaLottie(src).then(function (u) { img.src = u; })
      .catch(function () { toast("No se pudo mostrar el Lottie del token (¿hay internet?)", "error"); });
  }

  /* ---------------- imagen de hover (opcional) ---------------- */

  function isLottieFile(src) { return /\.(json|lottie)$/i.test(String(src || "")); }
  function isVideoFile(src) { return /\.(webm|mp4|m4v|mov|ogv)$/i.test(String(src || "")); }

  /* Formatos que pueden traer animación adentro del archivo. */
  function esAnimable(src) { return /\.(gif|avif|webp|png)$/i.test(String(src || "")); }

  function paintHover(p) {
    var prev = $("hoverPreview");
    var note = $("hoverNote");
    var clear = $("btnHoverClear");
    var loopWrap = $("hoverLoopWrap");
    var src = p && p.token ? p.token.hover : "";
    var lottie = isLottieFile(src);
    var video = isVideoFile(src);

    clear.hidden = !src;

    // Ni el .json de Lottie ni un video se previsualizan con un <img>:
    // en esos casos va el nombre del archivo.
    if (src && (lottie || video)) {
      prev.removeAttribute("src");
      prev.hidden = true;
      note.textContent = (lottie ? "Lottie · " : extOf(src).toUpperCase() + " · ") +
                         src.split("/").pop();
      note.hidden = false;
    } else if (src) {
      prev.src = rootSrc(src);
      prev.hidden = false;
      note.textContent = esAnimable(src)
        ? (extOf(src).toUpperCase() + " · si trae animación, arranca al pasar el cursor")
        : "";
      note.hidden = !note.textContent;
    } else {
      prev.removeAttribute("src");
      prev.hidden = true;
      note.hidden = true;
    }

    // El bucle se puede controlar donde el sitio maneja la reproducción:
    // Lottie y video. Un GIF o un AVIF animado traen el suyo adentro.
    loopWrap.hidden = !(lottie || video);
    $("fHoverLoop").checked = !p || !p.token || p.token.hoverLoop !== false;
  }

  $("fHoverLoop").addEventListener("change", function () {
    var p = current(); if (!p || !p.token) return;
    p.token.hoverLoop = this.checked;
    markDirty();
  });

  setupDrop("hoverDrop", "hoverFile", "btnHoverPick", function (files) {
    var p = current(); if (!p) return toast("Elegí primero un proyecto", "error");
    uploadFile(files[0]).then(function (r) {
      p.token = p.token || {};
      p.token.hover = r.src;
      paintHover(p);
      markDirty();
      toast("Imagen de hover cargada: " + r.name);
    }).catch(function (e) { toast("Error al subir: " + e.message, "error"); });
  });

  $("btnHoverClear").addEventListener("click", function () {
    var p = current(); if (!p || !p.token) return;
    delete p.token.hover;
    delete p.token.hoverLoop;
    paintHover(p);
    markDirty();
    toast("Imagen de hover quitada (el archivo queda en la carpeta)");
  });

  /* ---------------- tamaño real del archivo ---------------- */

  /* Los tokens se dibujan 1:1 en el sitio, así que el ancho por defecto es el
     ancho real de la imagen. Igual se puede cambiar con el slider. */

  var natural = { w: 0, h: 0 };

  function paintNatural() {
    var out = $("outNatural");
    var btn = $("btnRealSize");
    var p = current();
    var actual = p ? num(p.token && p.token.width, 200) : 200;
    if (natural.w) {
      out.textContent = "· archivo: " + natural.w + "×" + natural.h + " px";
      btn.disabled = false;
    } else {
      out.textContent = "";
      btn.disabled = true;
    }
    $("fWidth").max = Math.max(1200, natural.w * 2, actual * 1.5);
  }

  function readNatural(src, cb) {
    natural = { w: 0, h: 0 };
    if (!src) { paintNatural(); return; }
    function listo(n) { natural = n; paintNatural(); if (cb) cb(natural); }
    if (/\.json($|\?)/i.test(src)) {
      fetch(rootSrc(src), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.w > 0 && d.h > 0) listo({ w: Math.round(d.w), h: Math.round(d.h) }); else paintNatural(); })
        .catch(function () { paintNatural(); });
      return;
    }
    // Un SVG sin width/height (sólo viewBox, como exporta Illustrator) no
    // tiene tamaño propio y el navegador le inventa 300×150: el tamaño real
    // es el de su width/height, o si no, el de su viewBox.
    if (/\.svg($|\?)/i.test(src)) {
      fetch(rootSrc(src), { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          var n = medidaSvg(t);
          if (n) listo(n); else porImagen();
        })
        .catch(porImagen);
      return;
    }
    porImagen();
    function porImagen() {
      var img = new Image();
      img.onload = function () { listo({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { paintNatural(); };
      img.src = rootSrc(src);
    }
  }

  function medidaSvg(texto) {
    var m = /<svg\b[^>]*>/i.exec(texto || "");
    if (!m) return null;
    var tag = m[0];
    function attr(n) { var a = new RegExp("\\s" + n + "\\s*=\\s*[\"']([^\"']+)[\"']", "i").exec(tag); return a ? a[1] : ""; }
    var w = parseFloat(attr("width")), h = parseFloat(attr("height"));
    var porcentaje = /%/.test(attr("width") + attr("height"));
    if (w > 0 && h > 0 && !porcentaje) return { w: Math.round(w), h: Math.round(h) };
    var vb = attr("viewBox").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: Math.round(vb[2]), h: Math.round(vb[3]) };
    return null;
  }

  function setWidth(p, w) {
    p.token.width = w;
    $("fWidth").value = w;
    $("outWidth").value = w;
    syncMini();
    composicionTocada();
  }

  /* La composición se arma mirando esta pantalla (el mini la representa):
     su tamaño queda anotado como referencia. En una pantalla más chica, el
     sitio achica los tokens en la misma proporción que las posiciones. */
  function anotarPantalla() {
    var s = pantalla();
    if (!data.site) data.site = {};
    data.site.pantalla = { w: s.w, h: s.h };
  }
  function composicionTocada() {
    anotarPantalla();
    markDirty();
  }

  $("btnRealSize").addEventListener("click", function () {
    var p = current();
    if (!p || !natural.w) return;
    setWidth(p, natural.w);
  });

  /* ---------------- token: tamaño, rotación, posición ---------------- */

  $("fWidth").addEventListener("input", function () {
    var p = current(); if (!p) return;
    p.token.width = num(this.value, 200);
    $("outWidth").value = p.token.width;
    syncMini(); composicionTocada();
  });

  /* El ancho también se escribe: la barra sola no da para acertar a un
     píxel. Flechas: ±1; con Shift, ±10 (lo hace el propio campo numérico). */
  $("outWidth").addEventListener("input", function () {
    var p = current(); if (!p) return;
    var w = Math.round(Number(this.value));
    if (!(w >= 20)) return;                      // a medio escribir: se espera
    w = Math.min(w, 4000);
    p.token.width = w;
    var barra = $("fWidth");
    if (w > Number(barra.max)) barra.max = w;
    barra.value = w;
    syncMini(); composicionTocada();
  });
  $("outWidth").addEventListener("change", function () {
    var p = current(); if (!p) return;
    this.value = num(p.token.width, 200);        // al salir, lo que quedó de verdad
  });
  $("outWidth").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); this.blur(); }
    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      this.value = Math.max(20, Math.round(Number(this.value) || 0) + (e.key === "ArrowUp" ? 10 : -10));
      this.dispatchEvent(new Event("input"));
    }
  });

  $("fRot").addEventListener("input", function () {
    var p = current(); if (!p) return;
    p.token.rotation = num(this.value, 0);
    $("outRot").textContent = p.token.rotation;
    syncMini(); composicionTocada();
  });

  ["fX", "fY"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      var p = current(); if (!p) return;
      p.token[id === "fX" ? "x" : "y"] = clamp(num(this.value, 0.5), 0, 1);
      syncMini(); composicionTocada();
    });
  });

  $("btnCenter").addEventListener("click", function () {
    var p = current(); if (!p) return;
    p.token.x = 0.5; p.token.y = 0.5; p.token.rotation = 0;
    fillForm(p); composicionTocada();
  });

  $("btnRandom").addEventListener("click", function () {
    var p = current(); if (!p) return;
    p.token.x = Math.round((0.15 + Math.random() * 0.7) * 100) / 100;
    p.token.y = Math.round((0.18 + Math.random() * 0.64) * 100) / 100;
    p.token.rotation = Math.round((Math.random() - 0.5) * 60);
    fillForm(p); composicionTocada();
  });

  /* Dibuja el token dentro del mini-mapa con la proporción real del canvas. */
  /* Siluetas de los otros tokens, en la misma posición y tamaño que tendrán en
     el sitio. Se dibujan una sola vez por proyecto, no en cada cuadro del
     arrastre: no se mueven mientras acomodás el que estás editando. */
  function pintarFantasmas() {
    if (!elGhosts) return;
    elGhosts.innerHTML = "";
    var p = current();
    if (!p || !data || !Array.isArray(data.projects)) return;

    var r = elMini.getBoundingClientRect();
    if (!r.width) return;
    var escala = r.width / pantalla().w;

    data.projects.forEach(function (otro) {
      if (otro.id === p.id) return;
      var tk = otro.token || {};
      if (!tk.image || tk.show === false) return;

      var img = document.createElement("img");
      img.className = "mini__ghost";
      img.alt = "";
      img.draggable = false;
      img.title = (ml(otro, "title") || otro.id);

      var w = Math.max(6, num(tk.width, 200) * escala);
      img.style.width = w + "px";

      // el alto recién se sabe cuando la imagen cargó: hasta entonces, invisible
      img.addEventListener("load", function () {
        var h = img.offsetHeight || w * 0.62;
        var cx = clamp(num(tk.x, 0.5), 0, 1) * r.width;
        var cy = clamp(num(tk.y, 0.5), 0, 1) * r.height;
        img.style.transform = "translate(" + (cx - w / 2) + "px," + (cy - h / 2) +
                              "px) rotate(" + num(tk.rotation, 0) + "deg)";
        img.classList.add("is-set");
      });
      img.addEventListener("error", function () { img.remove(); });

      ponerVista(img, tk.image);
      elGhosts.appendChild(img);
    });
  }

  function syncMini() {
    var p = current(); if (!p) return;
    var r = elMini.getBoundingClientRect();
    var scale = r.width / pantalla().w;
    var w = Math.max(10, num(p.token.width, 200) * scale);
    elMiniTok.style.width = w + "px";
    elMiniTok.classList.toggle("is-empty", !p.token.image);
    if (!p.token.image) elMiniTok.style.height = (w * 0.62) + "px";
    else elMiniTok.style.height = "";

    var h = elMiniTok.offsetHeight || w * 0.62;
    var cx = clamp(num(p.token.x, 0.5), 0, 1) * r.width;
    var cy = clamp(num(p.token.y, 0.5), 0, 1) * r.height;
    elMiniTok.style.transform =
      "translate(" + (cx - w / 2) + "px," + (cy - h / 2) + "px) rotate(" + num(p.token.rotation, 0) + "deg)";
  }

  (function miniDrag() {
    var dragging = false;
    elMiniTok.addEventListener("pointerdown", function (e) {
      var p = current(); if (!p) return;
      e.preventDefault();
      dragging = true;
      elMiniTok.setPointerCapture(e.pointerId);
    });
    elMiniTok.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var p = current(); if (!p) return;
      var r = elMini.getBoundingClientRect();
      p.token.x = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 1000) / 1000;
      p.token.y = Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * 1000) / 1000;
      $("fX").value = p.token.x.toFixed(2);
      $("fY").value = p.token.y.toFixed(2);
      syncMini(); composicionTocada();
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      elMiniTok.addEventListener(ev, function () { dragging = false; });
    });
    // rueda del mouse sobre el token = rotar
    elMiniTok.addEventListener("wheel", function (e) {
      var p = current(); if (!p) return;
      e.preventDefault();
      var next = num(p.token.rotation, 0) + (e.deltaY > 0 ? 3 : -3);
      while (next > 180) next -= 360;
      while (next < -180) next += 360;
      p.token.rotation = next;
      $("fRot").value = next;
      $("outRot").textContent = next;
      syncMini(); composicionTocada();
    }, { passive: false });
    // clic en el fondo del mini = mover el token ahí
    elMini.addEventListener("pointerdown", function (e) {
      if (e.target !== elMini && e.target.className !== "mini__grid") return;
      var p = current(); if (!p) return;
      var r = elMini.getBoundingClientRect();
      p.token.x = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 1000) / 1000;
      p.token.y = Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * 1000) / 1000;
      $("fX").value = p.token.x.toFixed(2);
      $("fY").value = p.token.y.toFixed(2);
      syncMini(); composicionTocada();
    });
    window.addEventListener("resize", syncMini);
  })();

  /* ---------------- hashtags ---------------- */

  /* El vocabulario de hashtags vive una sola vez en site.tags; cada proyecto
     guarda nada más los ids en p.tags. Así los nombres y sus traducciones se
     editan en un solo lugar. */

  function siteTags(group) {
    data.site = data.site || {};
    data.site.tags = data.site.tags || {};
    if (!Array.isArray(data.site.tags[group])) data.site.tags[group] = [];
    return data.site.tags[group];
  }

  function projectTags(p, group) {
    p.tags = p.tags || {};
    if (!Array.isArray(p.tags[group])) p.tags[group] = [];
    return p.tags[group];
  }

  function slug(s) {
    return String(s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }

  function findTag(group, id) {
    return siteTags(group).filter(function (t) { return t.id === id; })[0] || null;
  }

  function addTag(group, label) {
    label = String(label || "").trim();
    if (!label) return null;
    var list = siteTags(group);

    // si ya existe uno con ese nombre en este idioma, se reusa
    var same = list.filter(function (t) {
      return (t[editLang] || "").toLowerCase() === label.toLowerCase();
    })[0];
    if (same) return same;

    var base = slug(label) || "tag";
    var id = base, n = 2;
    while (findTag(group, id)) id = base + "-" + (n++);

    var tag = { id: id, es: "", en: "", esAuto: true };
    aplicarRaiz(tag, editLang, label);
    list.push(tag);
    return tag;
  }

  function toggleTag(p, group, id) {
    var mine = projectTags(p, group);
    var i = mine.indexOf(id);
    if (i >= 0) mine.splice(i, 1);
    else mine.push(id);
    markDirty();
  }

  function renderTags() {
    var box = $("tagEditor");
    box.innerHTML = "";
    var p = current();
    if (!p) return;
    TAG_GROUPS.forEach(function (g) { box.appendChild(tagGroup(g, p)); });
  }

  function tagGroup(g, p) {
    var wrap = document.createElement("div");

    var h = document.createElement("h3");
    h.className = "taggroup__title";
    h.textContent = g.title;
    wrap.appendChild(h);

    var list = siteTags(g.id);

    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "taggroup__empty";
      empty.textContent = "Todavía no hay hashtags de " + g.title.toLowerCase() + ".";
      wrap.appendChild(empty);
    } else {
      var chips = document.createElement("div");
      chips.className = "taggroup__chips";
      list.forEach(function (tag) {
        chips.appendChild(tagChip(tag, g, p));
      });
      wrap.appendChild(chips);
    }

    // alta rápida
    var add = document.createElement("div");
    add.className = "taggroup__add";
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Nuevo hashtag (" + editLang.toUpperCase() + ")";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--tiny";
    btn.textContent = "Agregar";

    function create() {
      var tag = addTag(g.id, input.value);
      if (!tag) return;
      var mine = projectTags(p, g.id);
      if (mine.indexOf(tag.id) < 0) mine.push(tag.id);
      input.value = "";
      markDirty();
      renderTags();
    }
    btn.addEventListener("click", create);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); create(); }
    });
    add.appendChild(input);
    add.appendChild(btn);

    // Crear desde español es lo que genera duplicados: nace un hashtag nuevo
    // con sólo español, hermano del que ya existe en inglés. El alta vive en
    // la raíz y nada más.
    if (editLang === "en") {
      wrap.appendChild(add);
    } else {
      var nota = document.createElement("p");
      nota.className = "taggroup__aviso";
      nota.textContent = "Los hashtags se crean y se borran en inglés. " +
                         "Acá los traducís con el lápiz de cada uno.";
      wrap.appendChild(nota);
    }

    if (list.length) wrap.appendChild(tagManager(g));
    return wrap;
  }

  function nombreTag(tag) {
    return "#" + (tag[editLang] || mlAny(tag) || tag.id);
  }

  /* Borrar un hashtag lo saca del vocabulario del sitio, así que también hay
     que sacárselo a los proyectos que lo tengan puesto: si no, quedarían
     apuntando a algo que ya no existe. Es el único borrado del panel: lo usan
     la cruz del chip, la de "Editar nombres y traducciones" y la de
     Configuración. */
  function borrarTag(g, tag) {
    var usan = (data.projects || []).filter(function (pr) {
      return projectTags(pr, g.id).indexOf(tag.id) >= 0;
    });

    var aviso = "Se va a borrar " + nombreTag(tag) + " del sitio.";
    if (usan.length) {
      aviso += "\n\nLo tienen puesto " + usan.length +
               (usan.length === 1 ? " proyecto" : " proyectos") +
               ", y también se lo voy a sacar:\n· " +
               usan.map(function (pr) { return ml(pr, "title") || pr.id; }).join("\n· ");
    }
    aviso += "\n\n¿Seguimos?";
    if (!confirm(aviso)) return;

    var lista = siteTags(g.id);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === tag.id) { lista.splice(i, 1); break; }
    }
    (data.projects || []).forEach(function (pr) {
      var propios = projectTags(pr, g.id);
      var k = propios.indexOf(tag.id);
      if (k >= 0) propios.splice(k, 1);
    });

    renderTags();
    renderSiteTags();
    renderAtajos();
    markDirty();
    toast(nombreTag(tag) + " borrado");
  }

  /* Pone al día el texto y la marca de un chip sin redibujar el grupo: si se
     redibuja mientras escribís, el campo pierde el foco en cada tecla. */
  function refrescarChip(tag) {
    var b = document.querySelector('.tagchip[data-tag-id="' + tag.id + '"]');
    if (!b) return;
    var label = tag[editLang];
    var prestado = editLang === "es" && tag.esAuto && !!tag.es;
    b.textContent = "#" + (label || mlAny(tag) || tag.id);
    b.classList.toggle("is-untranslated", !label || prestado);
    b.title = prestado
      ? "Viene del inglés, sin revisar. Editalo en “Editar nombres y traducciones”."
      : (label ? "" : "Sin nombre en " + editLang.toUpperCase());
  }

  /* Cambia el chip por un campo de texto, ahí donde está. Enter o salir
     guarda; Escape deja todo como estaba. */
  function editarTagEnLinea(wrap, tag) {
    var previo = wrap.innerHTML;
    wrap.innerHTML = "";
    wrap.classList.add("is-editing");

    var i = document.createElement("input");
    i.type = "text";
    i.className = "tagchip-input";
    i.value = tag.es || tag.en || "";
    wrap.appendChild(i);
    i.focus();
    i.select();

    var cerrado = false;
    function guardar() {
      if (cerrado) return;
      cerrado = true;
      aplicarRaiz(tag, "es", i.value.trim());
      renderTags();
      markDirty();
    }
    function cancelar() {
      if (cerrado) return;
      cerrado = true;
      wrap.classList.remove("is-editing");
      wrap.innerHTML = previo;
      renderTags();
    }

    i.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); guardar(); }
      if (e.key === "Escape") { e.preventDefault(); cancelar(); }
    });
    i.addEventListener("blur", guardar);
  }

  function tagChip(tag, g, p) {
    var wrap = document.createElement("span");
    wrap.className = "tagchip-wrap";

    var b = document.createElement("button");
    b.type = "button";
    var mine = projectTags(p, g.id);
    var label = tag[editLang];
    var copia = editLang === "es" && tag.esAuto && !!tag.es;
    b.className = "tagchip" +
      (mine.indexOf(tag.id) >= 0 ? " is-on" : "") +
      (copia ? " is-untranslated" : "");
    b.dataset.tagId = tag.id;
    b.textContent = "#" + (label || mlAny(tag) || tag.id);
    b.title = copia ? "Todavía dice lo mismo que en inglés." : "";
    b.addEventListener("click", function () {
      toggleTag(p, g.id, tag.id);
      renderTags();
    });
    wrap.appendChild(b);

    // En español, el que todavía repite el inglés trae su lápiz: se edita acá
    // mismo, sin abrir ninguna sección.
    if (copia) {
      var lap = document.createElement("button");
      lap.type = "button";
      lap.className = "tagchip-edit";
      lap.textContent = "✎";
      lap.title = "Escribir “" + (tag.en || tag.es) + "” en español";
      lap.setAttribute("aria-label", lap.title);
      lap.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        editarTagEnLinea(wrap, tag);
      });
      wrap.appendChild(lap);
    }

    // Borrar es estructural: saca el hashtag de todo el sitio, en los dos
    // idiomas. Por eso vive sólo en inglés, que es la raíz. En español no hay
    // cruz, porque ahí únicamente se traduce.
    if (editLang === "en") {
      var x = document.createElement("button");
      x.type = "button";
      x.className = "tagchip-del";
      x.textContent = "×";
      x.title = "Borrar " + nombreTag(tag) + " de todo el sitio";
      x.setAttribute("aria-label", x.title);
      x.addEventListener("click", function (e) {
        // sin esto, el clic también le llegaría al chip y lo encendería
        e.preventDefault();
        e.stopPropagation();
        borrarTag(g, tag);
      });
      wrap.appendChild(x);
    }

    return wrap;
  }

  /* Panel plegable para renombrar, traducir y borrar hashtags. */
  function tagManager(g) {
    var det = document.createElement("details");
    det.className = "taggroup__manage";
    var sum = document.createElement("summary");
    sum.textContent = "Editar nombres y traducciones";
    det.appendChild(sum);

    siteTags(g.id).forEach(function (tag) {
      var campos = {};
      LANGS.forEach(function (l) {
        var row = document.createElement("div");
        row.className = "tagrow";

        var lab = document.createElement("span");
        lab.className = "tagrow__lang";
        lab.textContent = l.toUpperCase();
        row.appendChild(lab);

        var inp = document.createElement("input");
        inp.type = "text";
        inp.value = tag[l] || "";
        inp.placeholder = l === "es" ? "Nombre en español" : "Name in English";
        campos[l] = inp;
        inp.addEventListener("input", function () {
          aplicarRaiz(tag, l, inp.value);
          // el espejo se ve al toque, pero sin rehacer el bloque: si se
          // redibuja, el campo pierde el foco en cada tecla
          if (l === "en" && campos.es) campos.es.value = tag.es || "";
          // vaciar el español suelta el candado: se ve volver el inglés
          if (l === "es" && !inp.value) inp.value = tag.es || "";
          refrescarChip(tag);
          markDirty();
        });
        row.appendChild(inp);

        if (l === LANGS[0]) {
          var x = document.createElement("button");
          x.type = "button";
          x.className = "tagrow__x";
          x.textContent = "✕";
          x.title = "Eliminar este hashtag de todos los proyectos";
          x.addEventListener("click", function () { borrarTag(g, tag); });
          row.appendChild(x);
        } else {
          var spacer = document.createElement("span");
          spacer.style.width = "27px";
          spacer.style.flex = "none";
          row.appendChild(spacer);
        }

        det.appendChild(row);
      });
    });

    return det;
  }

  /* Hashtags en Configuración: todo el vocabulario en un solo lugar, inglés y
     español lado a lado. Los proyectos guardan sólo el id del hashtag, así
     que cambiar el nombre acá lo cambia en todos lados de una vez. */
  /* ---------------- direcciones cortas ----------------
     data.site.atajos = [{ desde: "/keysense/terms", hacia: "projects/…/terms.en.html" }]
     El servidor local las respeta y el empaquetado las escribe en _redirects
     de Netlify (ver DEPLOY.md). */
  var archivosSitio = null;   // se piden una vez, al abrir Configuración
  var RESERVADAS = ["css", "js", "img", "projects", "data", "geo", "admin", "index.html",
                    "_headers", "_redirects", "api"];

  function atajos() {
    if (!data.site) data.site = {};
    if (!Array.isArray(data.site.atajos)) data.site.atajos = [];
    return data.site.atajos;
  }

  // "Keysense/Terms " → "/keysense/terms"
  function limpiarAtajo(v) {
    return "/" + String(v || "").trim().toLowerCase()
      .replace(/\\/g, "/")
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/\/{2,}/g, "/")
      .replace(/^[/-]+|[/-]+$/g, "");
  }

  function problemaAtajo(a, i) {
    if (!a.desde || a.desde === "/") return "Falta la dirección.";
    var primera = a.desde.split("/")[1];
    if (RESERVADAS.indexOf(primera) >= 0) return "“/" + primera + "” es una carpeta del sitio: elegí otro nombre.";
    var lista = atajos();
    for (var k = 0; k < lista.length; k++) {
      if (k === i) continue;
      if (lista[k].desde === a.desde) return "Esa dirección ya está usada.";
    }
    if (!a.hacia) return "Elegí a qué archivo lleva.";
    var dir = a.desde.slice(0, a.desde.lastIndexOf("/"));
    var real = a.hacia.slice(0, a.hacia.lastIndexOf("/"));
    for (k = 0; k < lista.length; k++) {
      if (k === i || !lista[k].hacia) continue;
      var d2 = lista[k].desde.slice(0, lista[k].desde.lastIndexOf("/"));
      var r2 = lista[k].hacia.slice(0, lista[k].hacia.lastIndexOf("/"));
      if (dir && d2 === dir && r2 !== real) {
        return "“" + dir + "/” ya lleva a otra carpeta (" + r2 + "): usá otra carpeta corta.";
      }
    }
    return "";
  }

  function renderAtajos() {
    var box = $("atajos");
    if (!box) return;
    if (!archivosSitio) {
      box.textContent = "Cargando archivos…";
      getJSON(API + "/site-files").then(function (r) {
        archivosSitio = Array.isArray(r.files) ? r.files : [];
        renderAtajos();
      }).catch(function () {
        box.textContent = "No se pudo leer la lista de archivos · ¿reiniciaste node server.js?";
      });
      return;
    }
    box.innerHTML = "";
    var lista = atajos();
    if (!lista.length) {
      var vacio = document.createElement("p");
      vacio.className = "taggroup__empty";
      vacio.textContent = "Todavía no hay direcciones cortas.";
      box.appendChild(vacio);
      return;
    }
    lista.forEach(function (a, i) {
      var fila = document.createElement("div");
      fila.className = "atajos__fila";

      var desde = document.createElement("input");
      desde.type = "text";
      desde.value = a.desde || "";
      desde.placeholder = "/keysense/terms";
      desde.addEventListener("change", function () {
        a.desde = limpiarAtajo(desde.value);
        markDirty();
        renderAtajos();
      });

      var flecha = document.createElement("span");
      flecha.className = "atajos__flecha";
      flecha.textContent = "→";

      var hacia = document.createElement("select");
      var ninguno = document.createElement("option");
      ninguno.value = "";
      ninguno.textContent = "— elegí un archivo —";
      hacia.appendChild(ninguno);
      var grupos = {};
      archivosSitio.forEach(function (f) {
        var dir = f.slice(0, f.lastIndexOf("/"));
        if (!grupos[dir]) {
          grupos[dir] = document.createElement("optgroup");
          grupos[dir].label = dir;
          hacia.appendChild(grupos[dir]);
        }
        var o = document.createElement("option");
        o.value = f;
        o.textContent = f.slice(f.lastIndexOf("/") + 1);
        grupos[dir].appendChild(o);
      });
      if (a.hacia && archivosSitio.indexOf(a.hacia) < 0) {   // ya no existe: que se note
        var perdido = document.createElement("option");
        perdido.value = a.hacia;
        perdido.textContent = a.hacia + " (no existe)";
        hacia.appendChild(perdido);
      }
      hacia.value = a.hacia || "";
      hacia.addEventListener("change", function () {
        a.hacia = hacia.value;
        markDirty();
        renderAtajos();
      });

      var probar = document.createElement("a");
      probar.className = "btn btn--tiny";
      probar.textContent = "Probar";
      probar.target = "_blank";
      probar.rel = "noopener";
      probar.href = ".." + (a.desde || "/");
      probar.title = "Abre la dirección corta en el sitio local (guardá antes)";

      var borrar = document.createElement("button");
      borrar.type = "button";
      borrar.className = "tagrow__x";
      borrar.textContent = "✕";
      borrar.title = "Quitar esta dirección corta";
      borrar.addEventListener("click", function () {
        atajos().splice(i, 1);
        markDirty();
        renderAtajos();
      });

      fila.appendChild(desde);
      fila.appendChild(flecha);
      fila.appendChild(hacia);
      fila.appendChild(probar);
      fila.appendChild(borrar);
      box.appendChild(fila);

      var mal = problemaAtajo(a, i);
      if (mal) {
        var aviso = document.createElement("p");
        aviso.className = "atajos__aviso";
        aviso.textContent = mal;
        box.appendChild(aviso);
      }
    });
  }

  /* ---------------- publicar en Netlify ---------------- */
  $("btnPack").addEventListener("click", function () {
    var caja = $("packResultado");
    if (dirty && !confirm("Hay cambios sin guardar: el zip se arma con lo guardado. ¿Seguir igual?")) return;
    var b = this;
    b.disabled = true;
    b.textContent = "Armando…";
    caja.hidden = false;
    caja.textContent = "Verificando y armando el zip…";
    fetch(API + "/pack", { method: "POST" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (r) {
        caja.innerHTML = "";
        function linea(txt, clase) {
          var p = document.createElement("p");
          p.className = "pack__linea" + (clase ? " " + clase : "");
          p.textContent = txt;
          caja.appendChild(p);
        }
        if (!r.ok) {
          linea("No se armó el zip: hay que corregir esto primero.", "is-mal");
          (r.problemas || []).forEach(function (x) { linea("• " + x, "is-mal"); });
          return;
        }
        linea("Listo: " + r.zip + " — " + r.zipMb + " MB, " + r.archivos + " archivos" +
              (r.atajos ? ", " + r.atajos + " direcciones cortas" : "") + ".", "is-ok");
        (r.avisos || []).forEach(function (x) { linea("• " + x, "is-mal"); });
        if (r.afuera && r.afuera.length) {
          linea("Quedaron afuera " + r.afuera.length + " archivos que nada usa (siguen en tu disco): " +
                r.afuera.slice(0, 12).join(", ") + (r.afuera.length > 12 ? "…" : ""));
        }
        toast("Zip para Netlify armado");
      })
      .catch(function (e) {
        caja.textContent = "No se pudo armar el zip: " + e.message + " · ¿reiniciaste node server.js?";
      })
      .then(function () { b.disabled = false; b.textContent = "Armar zip para Netlify"; });
  });

  $("atajoNuevo").addEventListener("click", function () {
    atajos().push({ desde: "", hacia: "" });
    markDirty();
    renderAtajos();
    var campos = $("atajos").querySelectorAll(".atajos__fila input");
    if (campos.length) campos[campos.length - 1].focus();
  });

  function renderSiteTags() {
    var box = $("siteTags");
    if (!box) return;
    box.innerHTML = "";
    TAG_GROUPS.forEach(function (g) {
      var grupo = document.createElement("div");
      var h = document.createElement("h3");
      h.className = "taggroup__title";
      h.textContent = g.title;
      grupo.appendChild(h);

      var lista = siteTags(g.id);
      if (!lista.length) {
        var vacio = document.createElement("p");
        vacio.className = "taggroup__empty";
        vacio.textContent = "Todavía no hay hashtags de " + g.title.toLowerCase() +
                            ". Se crean desde un proyecto.";
        grupo.appendChild(vacio);
      } else {
        var cab = document.createElement("div");
        cab.className = "sitetags__fila sitetags__cab";
        ["Inglés", "Español", "", ""].forEach(function (txt) {
          var s = document.createElement("span");
          s.textContent = txt;
          cab.appendChild(s);
        });
        grupo.appendChild(cab);
        lista.forEach(function (tag) { grupo.appendChild(filaSiteTag(g, tag)); });
      }
      box.appendChild(grupo);
    });
  }

  function filaSiteTag(g, tag) {
    var fila = document.createElement("div");
    fila.className = "sitetags__fila";

    var en = document.createElement("input");
    en.type = "text";
    en.value = tag.en || "";
    en.placeholder = "Name in English";

    var es = document.createElement("input");
    es.type = "text";
    es.value = tag.es || "";
    es.placeholder = "Nombre en español";

    function marcarEs() { es.classList.toggle("is-auto", !!tag.esAuto); }

    en.addEventListener("input", function () {
      aplicarRaiz(tag, "en", en.value);
      es.value = tag.es || "";      // si el español sigue al inglés, se ve al toque
      marcarEs();
      markDirty();
    });
    es.addEventListener("input", function () {
      aplicarRaiz(tag, "es", es.value);
      // vaciarlo suelta el candado: vuelve a mostrar el inglés, pero recién al
      // salir, para no escribirle encima mientras borrás
      marcarEs();
      markDirty();
    });
    es.addEventListener("blur", function () { es.value = tag.es || ""; marcarEs(); });
    marcarEs();

    var usan = (data.projects || []).filter(function (pr) {
      return projectTags(pr, g.id).indexOf(tag.id) >= 0;
    }).length;
    var uso = document.createElement("span");
    uso.className = "sitetags__uso";
    uso.textContent = usan === 1 ? "1 proyecto" : usan + " proyectos";

    // borrarlo lo saca del sitio y de todos los proyectos que lo tengan
    var x = document.createElement("button");
    x.type = "button";
    x.className = "tagrow__x";
    x.textContent = "✕";
    x.title = "Borrar " + nombreTag(tag) + " del sitio y de todos los proyectos";
    x.setAttribute("aria-label", x.title);
    x.addEventListener("click", function () { borrarTag(g, tag); });

    fila.appendChild(en);
    fila.appendChild(es);
    fila.appendChild(uso);
    fila.appendChild(x);
    return fila;
  }

  /* ---------------- bloques ---------------- */

  /* Embeds que se miden por proporción y no por alto fijo: YouTube, Vimeo y
     cualquier iframe pegado a mano. */
  function isVideoEmbed(b) {
    return b.type === "embed" &&
           ["youtube", "vimeo", "raw"].indexOf(b.provider) >= 0;
  }

  /* Lee width/height del código de embed pegado. Un valor en % no sirve. */
  function medidaEmbed(code, nombre) {
    code = String(code || "");
    var m = code.match(new RegExp("\\b" + nombre + "\\s*=\\s*[\"']?([^\"'\\s>]+)", "i"));
    if (m && /^[0-9]+(\.[0-9]+)?$/.test(m[1])) return Math.round(parseFloat(m[1]));
    m = code.match(new RegExp(nombre + "\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*px", "i"));
    return m ? Math.round(parseFloat(m[1])) : 0;
  }


  /* ---------------- paleta de tipos ----------------
     La misma lista alimenta los chips de arriba y el selector de cada columna,
     así no pueden quedar desparejos. */

  var TIPOS = [
    { id: "title",      label: "Título",           nuevo: function () { return { type: "text", variant: "title",    content: { es: "", en: "" } }; } },
    { id: "subtitle",   label: "Subtítulo",        nuevo: function () { return { type: "text", variant: "subtitle", content: { es: "", en: "" } }; } },
    { id: "body",       label: "Texto",            nuevo: function () { return { type: "text", variant: "body",     content: { es: "", en: "" } }; } },
    { id: "quote",      label: "Cita",             nuevo: function () { return { type: "text", variant: "quote",    content: { es: "", en: "" } }; } },
    { id: "file",       label: "Imagen o archivo", nuevo: function () { return { type: "image", src: "", caption: { es: "", en: "" } }; } },
    { id: "button",     label: "Botón",            nuevo: function () { return { type: "button", label: { es: "", en: "" }, url: "", newTab: true }; } },
    { id: "youtube",    label: "YouTube",          nuevo: function () { return { type: "embed", provider: "youtube", url: "", code: "", full: false }; } },
    { id: "vimeo",      label: "Vimeo",            nuevo: function () { return { type: "embed", provider: "vimeo",   url: "", code: "", full: false }; } },
    { id: "iframe",     label: "Embed / iframe",   nuevo: function () { return { type: "embed", provider: "raw",     url: "", code: "", width: 0, height: 0 }; } },
    { id: "soundcloud", label: "SoundCloud",       nuevo: function () { return { type: "embed", provider: "soundcloud", url: "", code: "", height: 420 }; } },
    { id: "bandcamp",   label: "Bandcamp",         nuevo: function () { return { type: "embed", provider: "bandcamp",   url: "", code: "", height: 442 }; } },
    { id: "divider",    label: "Separador",        nuevo: function () { return { type: "divider" }; } }
  ];

  /* Qué opción de la paleta le corresponde a un bloque que ya existe. */
  function tipoDe(b) {
    if (!b || !b.type) return "";
    if (b.type === "text") return b.variant || "body";
    if (b.type === "embed") return b.provider === "raw" ? "iframe" : (b.provider || "soundcloud");
    if (["image", "video", "lottie"].indexOf(b.type) >= 0) return "file";
    return b.type;
  }

  function nuevoDe(id) {
    var t = TIPOS.filter(function (x) { return x.id === id; })[0];
    return t ? t.nuevo() : { type: "" };
  }

  /* Botón para subir el archivo de un bloque de medios. El tipo real
     (imagen, video o Lottie) sale de la extensión. */
  /* Un archivo que vive en otro lado (Behance, por ejemplo) se enlaza en vez
     de subirse, así no ocupa hosting. Tiene que ser la dirección directa del
     archivo, no la de la página que lo muestra. */
  function campoUrlExterna(b, contenedor) {
    var esExterna = /^https?:\/\//i.test(b.src || "");
    var inp = input(esExterna ? b.src : "", function (v) {
      v = v.trim();
      if (!v) return;
      b.src = v;
      b.type = typeFromFile(v.split("?")[0].split("#")[0]);
      markDirty();
    }, "https://…  dirección directa del archivo");
    // al salir del campo se redibuja, así la ficha muestra la ruta nueva
    inp.addEventListener("change", function () { if (inp.value.trim()) renderBlocks(); });
    contenedor.appendChild(field("…o pegar una URL externa", inp));
  }

  /* Lado por el que se descubre la imagen al entrar en pantalla. */
  var LADOS = [
    ["left",   "Desde la izquierda"],
    ["right",  "Desde la derecha"],
    ["top",    "Desde arriba"],
    ["bottom", "Desde abajo"],
    ["none",   "Sin efecto"]
  ];

  function campoCortina(b, contenedor) {
    var sel = document.createElement("select");
    LADOS.forEach(function (l) {
      var op = document.createElement("option");
      op.value = l[0];
      op.textContent = l[1];
      sel.appendChild(op);
    });
    sel.value = b.reveal || "left";
    sel.addEventListener("change", function () {
      b.reveal = sel.value;
      markDirty();
    });
    var f = field("Aparición", sel);
    f.style.flex = "0 0 170px";
    contenedor.appendChild(f);
  }

  function controlArchivo(b, contenedor) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*,.avif,video/*,.json,.lottie";
    inp.hidden = true;
    inp.addEventListener("change", function () {
      if (!inp.files || !inp.files.length) return;
      uploadFile(inp.files[0]).then(function (r) {
        b.type = typeFromFile(r.name);
        b.src = r.src;
        renderBlocks();
        markDirty();
        toast("Cargado: " + r.name);
      }).catch(function (e) { toast("Error al subir: " + e.message, "error"); });
      inp.value = "";
    });
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--tiny";
    btn.textContent = b.src ? "Cambiar archivo" : "Elegir archivo";
    btn.addEventListener("click", function () { inp.click(); });
    contenedor.appendChild(inp);
    contenedor.appendChild(btn);
  }

  function blockLabel(b) {
    if (b.type === "text") {
      return { title: "Título", subtitle: "Subtítulo", quote: "Cita", body: "Texto" }[b.variant || "body"];
    }
    if (b.type === "embed") {
      return { youtube: "YouTube", vimeo: "Vimeo", bandcamp: "Bandcamp", raw: "Embed / iframe" }[b.provider] || "SoundCloud";
    }
    return {
      image: "Imagen", video: "Video", lottie: "Lottie",
      button: "Botón", row: "Columnas", divider: "Separador"
    }[b.type] || b.type;
  }

  function field(labelText, node, translatable) {
    var l = document.createElement("label");
    l.className = "field" + (translatable ? " field--tr" : "");
    var s = document.createElement("span");
    s.textContent = labelText;
    if (translatable) s.setAttribute("data-lang", editLang.toUpperCase());
    l.appendChild(s);
    l.appendChild(node);
    return l;
  }

  /* En español, un campo que todavía repite el inglés se muestra tal cual,
     apagado, con un lápiz al lado. Tocás el lápiz y escribís la versión en
     español ahí mismo. Desde que escribís, el campo es tuyo y el inglés no lo
     vuelve a pisar. */
  function conLapiz(campo, obj, key) {
    if (editLang !== "es" || !esAutomatico(obj, key)) return campo;

    var caja = document.createElement("span");
    caja.className = "trad es-copia";
    campo.readOnly = true;
    caja.appendChild(campo);

    var lapiz = document.createElement("button");
    lapiz.type = "button";
    lapiz.className = "trad__lapiz";
    lapiz.textContent = "✎";
    lapiz.title = "Viene del inglés. Tocá para escribir la versión en español.";
    lapiz.setAttribute("aria-label", lapiz.title);
    lapiz.addEventListener("click", function () {
      campo.readOnly = false;
      caja.classList.remove("es-copia");
      caja.classList.add("is-editing");
      campo.focus();
      campo.select();
    });
    caja.appendChild(lapiz);
    return caja;
  }

  function input(value, onInput, placeholder) {
    var i = document.createElement("input");
    i.type = "text";
    i.value = value == null ? "" : value;
    if (placeholder) i.placeholder = placeholder;
    i.addEventListener("input", function () { onInput(i.value); markDirty(); });
    return i;
  }

  function textarea(value, onInput, placeholder) {
    var t = document.createElement("textarea");
    t.value = value == null ? "" : value;
    if (placeholder) t.placeholder = placeholder;
    t.addEventListener("input", function () { onInput(t.value); markDirty(); });
    return t;
  }

  function toggle(labelText, checked, onChange) {
    var l = document.createElement("label");
    l.className = "toggle";
    var c = document.createElement("input");
    c.type = "checkbox";
    c.checked = !!checked;
    c.addEventListener("change", function () { onChange(c.checked); markDirty(); });
    l.appendChild(c);
    l.appendChild(document.createTextNode(labelText));
    return l;
  }

  function renderBlocks() {
    var p = current();
    elBlocks.innerHTML = "";
    if (!p) return;
    p.blocks = p.blocks || [];
    $("blocksEmpty").hidden = p.blocks.length > 0;
    if ($("addbarBottom")) $("addbarBottom").hidden = p.blocks.length === 0;

    p.blocks.forEach(function (b, index) {
      elBlocks.appendChild(blockCard(b, index, p));
    });
  }

  function blockCard(b, index, p) {
    var card = document.createElement("div");
    card.className = "block-card";
    card.dataset.index = index;

    var handle = document.createElement("div");
    handle.className = "block-card__handle";
    handle.textContent = "⋮⋮";
    handle.title = "Arrastrar para reordenar";
    card.appendChild(handle);

    var main = document.createElement("div");
    main.className = "block-card__main";
    card.appendChild(main);

    var top = document.createElement("div");
    top.className = "block-card__top";
    var tag = document.createElement("span");
    tag.className = "block-card__type";
    tag.textContent = blockLabel(b);
    top.appendChild(tag);

    // Cualquier bloque se puede partir en columnas: no es un tipo aparte.
    // Al pasar de 1 a N, lo que ya estaba queda en la primera columna; al
    // volver a 1 se recupera tal cual.
    var cols = b.type === "row" ? clamp(parseInt(b.columns, 10) || 1, 1, 6) : 1;
    var selN = document.createElement("select");
    selN.className = "block-card__cols";
    selN.title = "Dividir el bloque en columnas";
    for (var n = 1; n <= 6; n++) {
      var op = document.createElement("option");
      op.value = n;
      op.textContent = n === 1 ? "1 columna" : n + " columnas";
      if (cols === n) op.selected = true;
      selN.appendChild(op);
    }
    selN.addEventListener("change", function () {
      var nuevo = clamp(parseInt(selN.value, 10) || 1, 1, 6);
      if (nuevo === cols) return;

      if (cols === 1) {
        // el bloque actual pasa a ser la primera columna
        var celdas = [b];
        while (celdas.length < nuevo) celdas.push({ type: "" });
        p.blocks[index] = { type: "row", columns: nuevo, cells: celdas };
      } else if (nuevo === 1) {
        // vuelve a ser un bloque suelto, con lo que hubiera en la primera columna
        var primera = (b.cells && b.cells[0] && b.cells[0].type)
          ? b.cells[0]
          : { type: "text", variant: "body", content: { es: "", en: "" } };
        p.blocks[index] = primera;
      } else {
        b.columns = nuevo;
      }
      renderBlocks();
      markDirty();
    });
    top.appendChild(selN);

    var sp = document.createElement("span");
    sp.className = "block-card__spacer";
    top.appendChild(sp);

    // (Ya no hay interruptor "Ancho completo": en el post todo ocupa el ancho
    // entero de la columna. El campo `full` de datos viejos se ignora.)

    var x = document.createElement("button");
    x.type = "button";
    x.className = "block-card__x";
    x.textContent = "✕";
    x.title = "Eliminar bloque";
    x.onclick = function () {
      p.blocks.splice(index, 1);
      renderBlocks();
      markDirty();
    };
    top.appendChild(x);
    main.appendChild(top);

    var row = document.createElement("div");
    row.className = "block-card__row";
    main.appendChild(row);

    blockFields(b, row, top, tag, p);

    setupCardDrag(card, handle, p);
    return card;
  }

  /* Campos de edición de un bloque. Los usan igual las tarjetas de arriba y
     las columnas: un bloque se edita igual esté donde esté. */
  function blockFields(b, row, top, tag, p) {
    if (b.type === "text") {
      row.appendChild(field("Contenido",
        conLapiz(textarea(ml(b, "content"), function (v) { setMl(b, "content", v); },
          "Escribí acá. Una línea en blanco separa párrafos."), b, "content"), true));

      var sel = document.createElement("select");
      [["title", "Título"], ["subtitle", "Subtítulo"], ["body", "Texto"], ["quote", "Cita"]]
        .forEach(function (o) {
          var op = document.createElement("option");
          op.value = o[0]; op.textContent = o[1];
          if ((b.variant || "body") === o[0]) op.selected = true;
          sel.appendChild(op);
        });
      sel.addEventListener("change", function () {
        b.variant = sel.value;
        renderBlocks();
        markDirty();
      });
      var f = field("Estilo", sel);
      f.style.flex = "0 0 160px";
      row.appendChild(f);

    } else if (b.type === "image" || b.type === "video") {
      var thumb;
      if (b.type === "image") {
        thumb = document.createElement("img");
        if (b.src) thumb.src = rootSrc(b.src); else thumb.hidden = true;
      } else {
        thumb = document.createElement("video");
        thumb.src = rootSrc(b.src);
        thumb.muted = true;
        thumb.preload = "metadata";
      }
      thumb.className = "block-card__thumb";
      row.appendChild(thumb);

      var col = document.createElement("div");
      col.style.flex = "1 1 240px";
      col.appendChild(field("Epígrafe (opcional)",
        conLapiz(input(ml(b, "caption"), function (v) { setMl(b, "caption", v); }, "Texto al pie"), b, "caption"), true));
      var fileInfo = document.createElement("p");
      fileInfo.className = "block-card__file";
      fileInfo.textContent = b.src || "(sin archivo todavía)";
      col.appendChild(fileInfo);
      controlArchivo(b, col);
      campoUrlExterna(b, col);
      if (b.type === "image") campoCortina(b, row);
      row.appendChild(col);

      if (b.type === "video") {
        var vopts = document.createElement("div");
        vopts.style.display = "flex";
        vopts.style.flexDirection = "column";
        vopts.style.gap = "6px";
        vopts.appendChild(toggle("Auto-play en bucle, sin sonido", b.autoplay !== false, function (v) { b.autoplay = v; }));
        vopts.appendChild(toggle("Mostrar controles", b.controls !== false, function (v) { b.controls = v; }));
        row.appendChild(vopts);
      }

    } else if (b.type === "lottie") {
      var col2 = document.createElement("div");
      col2.style.flex = "1 1 240px";
      var nota2 = document.createElement("p");
      nota2.className = "block-card__file";
      nota2.textContent = b.src || "(sin archivo todavía)";
      col2.appendChild(nota2);
      controlArchivo(b, col2);
      campoUrlExterna(b, col2);
      col2.appendChild(field("Epígrafe (opcional)",
        conLapiz(input(ml(b, "caption"), function (v) { setMl(b, "caption", v); }), b, "caption"), true));
      row.appendChild(col2);
      var lopts = document.createElement("div");
      lopts.style.display = "flex";
      lopts.style.flexDirection = "column";
      lopts.style.gap = "6px";
      lopts.appendChild(toggle("Bucle", b.loop !== false, function (v) { b.loop = v; }));
      row.appendChild(lopts);

    } else if (b.type === "embed") {
      var help = {
        youtube:    "Pegá el link del video: youtube.com/watch?v=… , youtu.be/… o un Short. Si el link lleva tiempo (&t=90) el video arranca ahí.",
        vimeo:      "Pegá el link del video: vimeo.com/123456789 (o vimeo.com/123456789/hash si es privado).",
        bandcamp:   "Pegá el código <iframe> que da Bandcamp en “Share / Embed”.",
        soundcloud: "Pegá la URL del track/playlist de SoundCloud, o el código <iframe> de “Share → Embed”.",
        raw:        "Pegá el código <iframe> completo de cualquier servicio. El ancho y el alto que trae se cargan solos acá abajo y el video se muestra en su tamaño y proporción originales."
      }[b.provider] || "Pegá la URL o el código <iframe>.";

      var labelText = {
        youtube: "Link de YouTube", vimeo: "Link de Vimeo",
        bandcamp: "Embed de Bandcamp", raw: "Código <iframe>"
      }[b.provider] || "URL o embed de SoundCloud";

      var anchoIn, altoIn;

      var ta = textarea(b.code || b.url, function (v) {
        v = v.trim();
        if (/<iframe/i.test(v)) { b.code = v; b.url = ""; }
        else { b.url = v; b.code = ""; }
        // Si el código pegado trae medidas y no se cargaron a mano, se toman.
        if (isVideoEmbed(b) && b.code) {
          var aw = medidaEmbed(b.code, "width");
          var ah = medidaEmbed(b.code, "height");
          if (aw && !b.width)  { b.width = aw;  if (anchoIn) anchoIn.value = aw; }
          if (ah && !b.height) { b.height = ah; if (altoIn)  altoIn.value = ah; }
        }
      }, help);
      ta.style.minHeight = "72px";
      row.appendChild(field(labelText, ta));

      if (isVideoEmbed(b)) {
        // Tamaño original. Vacío en los dos = 16:9 a todo el ancho, como antes.
        anchoIn = document.createElement("input");
        anchoIn.type = "number";
        anchoIn.min = "80"; anchoIn.max = "4000"; anchoIn.step = "1";
        anchoIn.placeholder = "auto";
        anchoIn.value = b.width || "";
        anchoIn.addEventListener("input", function () {
          b.width = num(anchoIn.value, 0); markDirty();
        });
        var fw = field("Ancho (px)", anchoIn);
        fw.style.flex = "0 0 110px";
        row.appendChild(fw);

        altoIn = document.createElement("input");
        altoIn.type = "number";
        altoIn.min = "80"; altoIn.max = "4000"; altoIn.step = "1";
        altoIn.placeholder = "auto";
        altoIn.value = b.height || "";
        altoIn.addEventListener("input", function () {
          b.height = num(altoIn.value, 0); markDirty();
        });
        var fa = field("Alto (px)", altoIn);
        fa.style.flex = "0 0 110px";
        row.appendChild(fa);
      }

      if (!isVideoEmbed(b)) {
        var hIn = document.createElement("input");
        hIn.type = "number";
        hIn.min = "80"; hIn.max = "1000"; hIn.step = "2";
        hIn.value = b.height || (b.provider === "bandcamp" ? 442 : 420);
        hIn.addEventListener("input", function () { b.height = num(hIn.value, 420); markDirty(); });
        var fh = field("Alto (px)", hIn);
        fh.style.flex = "0 0 120px";
        row.appendChild(fh);
      }

    } else if (b.type === "button") {
      var colB = document.createElement("div");
      colB.style.flex = "1 1 240px";
      colB.appendChild(field("Texto del botón",
        conLapiz(input(ml(b, "label"), function (v) { setMl(b, "label", v); }, "VER EL PROYECTO"), b, "label"), true));
      // destino: una página del sitio (se abre en una ventana encima) o un link
      var destP = document.createElement("select");
      var manual = document.createElement("option");
      manual.value = "";
      manual.textContent = "— link manual —";
      destP.appendChild(manual);
      var grPag = document.createElement("optgroup");
      grPag.label = "Páginas";
      destP.appendChild(grPag);
      data.projects.forEach(function (o) {
        if (current() && o.id === current().id) return;
        var op = document.createElement("option");
        op.value = "#/p/" + o.id;
        op.textContent = (mlAny(o.title) || o.id) + " (" + o.id + ")";
        grPag.appendChild(op);
      });
      var cortas = ((data.site && data.site.atajos) || []).filter(function (a) { return a.desde && a.hacia; });
      if (cortas.length) {
        var grCor = document.createElement("optgroup");
        grCor.label = "Direcciones cortas";
        destP.appendChild(grCor);
        cortas.forEach(function (a) {
          var op = document.createElement("option");
          op.value = a.desde;
          op.textContent = a.desde + "  →  " + a.hacia.slice(a.hacia.lastIndexOf("/") + 1);
          grCor.appendChild(op);
        });
      }
      function marcarDestino(v) {
        destP.value = v && destP.querySelector('option[value="' + v.replace(/"/g, "") + '"]') ? v : "";
      }
      // el link es por idioma, como el texto: el español sigue al inglés
      // hasta que se le escribe uno propio
      marcarDestino(ml(b, "url"));
      var linkIn = input(ml(b, "url"), function (v) {
        setMl(b, "url", v);
        marcarDestino(v || "");
      }, "https://… · mailto:… · #ancla");
      destP.addEventListener("change", function () {
        if (!destP.value) return;
        setMl(b, "url", destP.value);
        markDirty();
        renderBlocks();   // si el español seguía al inglés, ahora es suyo: se redibuja el lápiz
      });
      colB.appendChild(field("Página del sitio", destP));
      colB.appendChild(field("Link", conLapiz(linkIn, b, "url"), true));
      row.appendChild(colB);

      // icono opcional: uno de la biblioteca (img/button-icons) o uno propio
      var colI = document.createElement("div");
      colI.style.flex = "0 0 214px";

      if (iconosBoton.length) {
        var lib = document.createElement("div");
        lib.className = "iconos-boton";
        iconosBoton.forEach(function (src) {
          var op = document.createElement("button");
          op.type = "button";
          op.className = "iconos-boton__op" + (b.icon === src ? " is-on" : "");
          op.title = src.split("/").pop();
          op.setAttribute("aria-pressed", b.icon === src ? "true" : "false");
          var im = document.createElement("img");
          im.src = rootSrc(src);
          im.alt = "";
          op.appendChild(im);
          op.addEventListener("click", function () {
            if (b.icon === src) delete b.icon; else b.icon = src;   // otro clic lo quita
            renderBlocks();
            markDirty();
          });
          lib.appendChild(op);
        });
        colI.appendChild(lib);
      }

      var prevI = document.createElement("img");
      prevI.className = "block-card__icon";
      // los de la biblioteca ya se ven marcados arriba: la vista previa es para uno propio
      if (b.icon && iconosBoton.indexOf(b.icon) < 0) prevI.src = rootSrc(b.icon); else prevI.hidden = true;
      colI.appendChild(prevI);

      var fileI = document.createElement("input");
      fileI.type = "file";
      fileI.accept = "image/*,.avif,.svg";
      fileI.hidden = true;
      fileI.addEventListener("change", function () {
        if (!fileI.files || !fileI.files.length) return;
        uploadFile(fileI.files[0]).then(function (r) {
          b.icon = r.src;
          renderBlocks();
          markDirty();
          toast("Ícono cargado: " + r.name);
        }).catch(function (e) { toast("Error al subir: " + e.message, "error"); });
        fileI.value = "";
      });
      colI.appendChild(fileI);

      var accI = document.createElement("div");
      accI.className = "drop__actions";
      var pickI = document.createElement("button");
      pickI.type = "button";
      pickI.className = "btn btn--tiny";
      pickI.textContent = b.icon && iconosBoton.indexOf(b.icon) < 0 ? "Cambiar ícono" : "Agregar ícono";
      pickI.addEventListener("click", function () { fileI.click(); });
      accI.appendChild(pickI);

      if (b.icon) {
        var delI = document.createElement("button");
        delI.type = "button";
        delI.className = "btn btn--tiny";
        delI.textContent = "Quitar";
        delI.addEventListener("click", function () {
          delete b.icon;
          renderBlocks();
          markDirty();
        });
        accI.appendChild(delI);
      }
      colI.appendChild(accI);
      row.appendChild(colI);

      top.appendChild(toggle("Abrir en otra pestaña", b.newTab !== false,
        function (v) { b.newTab = v; }));

    } else if (b.type === "row") {
      b.cells = Array.isArray(b.cells) ? b.cells : [];
      var grid = document.createElement("div");
      grid.className = "cells";
      // tantas columnas en el editor como en el sitio: si no, engaña
      grid.style.setProperty("--cols", b.columns);
      for (var ci = 0; ci < b.columns; ci++) {
        if (!b.cells[ci]) b.cells[ci] = { type: "" };
        grid.appendChild(cellEditor(b.cells[ci], ci, p));
      }
      row.appendChild(grid);
      row.style.flexDirection = "column";
      row.style.alignItems = "stretch";

    } else if (b.type === "divider") {
      var note = document.createElement("p");
      note.className = "block-card__file";
      note.textContent = "Línea separadora.";
      row.appendChild(note);
    }
  }

  /* ---------------- celdas de una fila de columnas ----------------
     Una celda es un bloque común (texto, archivo o botón), así que en el sitio
     la dibuja el mismo renderBlock de siempre. Acá va su editor compacto. */

  function cellEditor(cell, indice, p) {
    var box = document.createElement("div");
    box.className = "cell";

    var cab = document.createElement("div");
    cab.className = "cell__head";
    var num = document.createElement("span");
    num.className = "cell__num";
    num.textContent = indice + 1;
    cab.appendChild(num);

    var sel = document.createElement("select");
    var vacia = document.createElement("option");
    vacia.value = "";
    vacia.textContent = "Vacía";
    sel.appendChild(vacia);
    TIPOS.forEach(function (t) {
      var op = document.createElement("option");
      op.value = t.id;
      op.textContent = t.label;
      sel.appendChild(op);
    });
    sel.value = tipoDe(cell);
    sel.addEventListener("change", function () {
      var reemplazo = sel.value ? nuevoDe(sel.value) : { type: "" };
      Object.keys(cell).forEach(function (k) { delete cell[k]; });
      Object.keys(reemplazo).forEach(function (k) { cell[k] = reemplazo[k]; });
      renderBlocks();
      markDirty();
    });
    cab.appendChild(sel);
    box.appendChild(cab);

    if (cell.type) {
      var cuerpo = document.createElement("div");
      cuerpo.className = "block-card__row cell__body";
      box.appendChild(cuerpo);
      blockFields(cell, cuerpo, cab, null, p);
    }
    return box;
  }

  /* Reordenamiento por arrastre (Behance-style) */
  function setupCardDrag(card, handle, p) {
    handle.addEventListener("mousedown", function () { card.draggable = true; });
    handle.addEventListener("touchstart", function () { card.draggable = true; }, { passive: true });

    card.addEventListener("dragstart", function (e) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.dataset.index);
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", function () {
      card.draggable = false;
      card.classList.remove("is-dragging");
      Array.prototype.forEach.call(elBlocks.children, function (c) {
        c.classList.remove("is-drop-target");
      });
    });
    card.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("is-drop-target");
    });
    card.addEventListener("dragleave", function () { card.classList.remove("is-drop-target"); });
    card.addEventListener("drop", function (e) {
      e.preventDefault();
      var from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      var to = parseInt(card.dataset.index, 10);
      if (isNaN(from) || isNaN(to) || from === to) return;
      var moved = p.blocks.splice(from, 1)[0];
      p.blocks.splice(to, 0, moved);
      renderBlocks();
      markDirty();
    });
  }

  /* botones + de la barra: todos salen de la misma paleta */
  /* La misma barra se repite debajo de los bloques, para no tener que volver
     arriba cada vez que el post crece. Es una copia: los mismos data-add. */
  (function () {
    var abajo = document.querySelector(".addbar").cloneNode(true);
    abajo.id = "addbarBottom";
    abajo.classList.add("addbar--abajo");
    abajo.hidden = true;
    elBlocks.parentNode.insertBefore(abajo, elBlocks.nextSibling);
  })();
  Array.prototype.forEach.call(document.querySelectorAll("[data-add]"), function (btn) {
    btn.addEventListener("click", function () {
      var p = current(); if (!p) return toast("Elegí primero un proyecto", "error");
      p.blocks = p.blocks || [];
      p.blocks.push(nuevoDe(btn.dataset.add));
      renderBlocks();
      markDirty();
      elBlocks.lastChild.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  /* subida múltiple de media → crea bloques automáticamente */
  /* ---------------- acciones generales ---------------- */

  $("btnNew").addEventListener("click", function () {
    // crear vuelve a leer el archivo del servidor: lo no guardado se pierde
    if (dirty && !confirm("Hay cambios sin guardar y se van a perder si creás un proyecto ahora.\n\n¿Crear igual? (Cancelar para guardar primero)")) return;
    var title = prompt("Título del proyecto nuevo:", "Proyecto sin título");
    if (title === null) return;
    fetch(API + "/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "Proyecto sin título" })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) throw new Error(res.error);
        return load().then(function () {
          dirty = false;
          select(res.project.id);
          toast("Proyecto creado: " + res.project.id);
        });
      })
      .catch(function (e) { toast("No se pudo crear: " + e.message, "error"); });
  });

  $("btnSave").addEventListener("click", saveAll);

  /* Renombrar la carpeta del proyecto. Lo hace el servidor de una sola vez:
     carpeta, id y todas las rutas del JSON, y el nombre viejo queda como
     alias para que los links que ya circulan sigan andando. Después el panel
     relee el archivo, así que lo pendiente se guarda antes: releer sin
     guardar lo perdería. */
  $("btnRename").addEventListener("click", function () {
    var p = current(); if (!p) return;
    var viejo = p.id;
    // para los nombres automáticos (proj0004) se propone uno a partir del título
    var propuesta = /^proj\d+$/.test(viejo)
      ? (slug((p.title && (p.title.en || p.title.es)) || "") || viejo)
      : viejo;
    var nuevo = prompt("Nuevo nombre para la carpeta de este proyecto.\n\n" +
                       "Sólo letras, números, guion y guion bajo. Los links viejos " +
                       "van a seguir funcionando.", propuesta);
    if (nuevo === null) return;
    nuevo = nuevo.trim();
    if (nuevo === viejo) return;
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(nuevo)) {
      toast("Sólo letras, números, guion y guion bajo (hasta 40).", "error");
      return;
    }
    (dirty ? saveAll() : Promise.resolve())
      .then(function () {
        if (dirty) throw new Error("no se pudieron guardar los cambios pendientes");
        return fetch(API + "/project/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: viejo, to: nuevo })
        });
      })
      .then(function (r) {
        return r.json().then(function (res) {
          if (!r.ok || res.error) throw new Error(res.error || "HTTP " + r.status);
          return res;
        });
      })
      .then(function (res) {
        return load().then(function () {
          select(res.id);
          toast("Carpeta renombrada: " + viejo + " → " + res.id +
                " · " + res.rutas + (res.rutas === 1 ? " ruta actualizada" : " rutas actualizadas"));
        });
      })
      .catch(function (e) { toast("No se pudo renombrar: " + e.message, "error"); });
  });

  $("btnDelete").addEventListener("click", function () {
    var p = current(); if (!p) return;
    // eliminar también vuelve a leer el archivo: antes lo no guardado se perdía sin aviso
    var aviso = "¿Eliminar “" + (mlAny(p.title) || p.id) + "” del sitio?";
    if (dirty) aviso += "\n\nOjo: hay cambios sin guardar en el panel y se van a perder. Cancelá y guardá primero si los querés conservar.";
    if (!confirm(aviso)) return;
    var withFiles = confirm("¿Borrar también la carpeta projects/" + p.id + " con sus archivos?\n\nAceptar = borrar archivos · Cancelar = conservarlos");
    fetch(API + "/project?id=" + encodeURIComponent(p.id) + (withFiles ? "&files=1" : ""), { method: "DELETE" })
      .then(function (r) { return r.json(); })
      .then(function () {
        dirty = false;
        return load();
      })
      .then(function () {
        currentId = null;
        select(data.projects.length ? data.projects[0].id : null);
        toast("Proyecto eliminado");
      })
      .catch(function (e) { toast("No se pudo eliminar: " + e.message, "error"); });
  });

  $("btnPreview").addEventListener("click", function () {
    var p = current(); if (!p) return;
    var go = function () {
      window.open("../index.html?lang=" + editLang + "#/p/" + p.id, "_blank", "noopener");
    };
    if (dirty) saveAll().then(go); else go();
  });

  /* ---------------- vista en celular ----------------
     El sitio de verdad, en un iframe del tamaño de un teléfono (390 × 844):
     como el iframe mide eso, el sitio entra en su modo celular por las mismas
     reglas que en un teléfono real. Muestra lo guardado, así que si hay algo
     pendiente se guarda antes, igual que en Previsualizar. */
  var CEL_ALTO = 868;   // 844 del teléfono + el bisel (ver admin.css)

  function escalarCelular() {
    var disponible = window.innerHeight - 110;   // la barra de botones y la nota
    var escala = Math.min(1, disponible / CEL_ALTO);
    $("celular").style.setProperty("--cel-escala", escala.toFixed(3));
  }

  function mostrarEnCelular(queVer) {
    var p = current();
    var ruta = "../index.html?lang=" + editLang + "&cel=" + Date.now();   // siempre recargado
    if (queVer === "proyecto" && p) ruta += "#/p/" + p.id;
    $("celFrame").src = ruta;
    $("celProyecto").disabled = !p;
  }

  function abrirCelular() {
    var abrir = function () {
      if (dirty) toast("No se pudo guardar: la vista muestra la última versión guardada", "error");
      escalarCelular();
      $("celular").hidden = false;
      mostrarEnCelular(current() ? "proyecto" : "inicio");
    };
    if (dirty) saveAll().then(abrir); else abrir();
  }

  function cerrarCelular() {
    $("celular").hidden = true;
    $("celFrame").src = "about:blank";   // corta videos y animaciones
  }

  $("btnMobile").addEventListener("click", abrirCelular);
  $("celCerrar").addEventListener("click", cerrarCelular);
  $("celRecargar").addEventListener("click", function () {
    try { $("celFrame").contentWindow.location.reload(); } catch (e) { mostrarEnCelular("inicio"); }
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-cel-ver]"), function (b) {
    b.addEventListener("click", function () { mostrarEnCelular(b.dataset.celVer); });
  });
  // tocar afuera del teléfono también cierra
  $("celular").addEventListener("click", function (e) {
    if (e.target === this) cerrarCelular();
  });
  window.addEventListener("resize", function () {
    if (!$("celular").hidden) escalarCelular();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("celular").hidden) { cerrarCelular(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (dirty) saveAll();
    }
  });

  window.addEventListener("beforeunload", function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------------- idioma de edición ---------------- */

  function paintLang() {
    elEditor.setAttribute("data-lang", editLang);
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-edit-lang]"),
      function (b) { b.classList.toggle("is-on", b.dataset.editLang === editLang); }
    );
    Array.prototype.forEach.call(
      document.querySelectorAll(".field--tr > span"),
      function (s) { s.setAttribute("data-lang", editLang.toUpperCase()); }
    );
  }

  function setEditLang(l) {
    if (LANGS.indexOf(l) < 0 || l === editLang) return;
    editLang = l;
    paintLang();
    var p = current();
    if (p) fillForm(p);     // vuelve a llenar todo con el otro idioma
    renderList();
  }

  Array.prototype.forEach.call(
    document.querySelectorAll("[data-edit-lang]"),
    function (b) {
      b.addEventListener("click", function () { setEditLang(b.dataset.editLang); });
    }
  );

  paintLang();

  /* ---------------- fondo del sitio ----------------
     Las mismas propiedades que tiene un fondo en CSS, cada una con su control.
     Lo que quede vacío no se escribe en el sitio: cae en el valor de la hoja
     de estilos y nunca se queda sin fondo. */

  var FONDO_POR_DEFECTO = {
    image: "img/background-1.webp",
    repeat: "repeat",
    size: "auto",
    sizeCustom: "",
    position: "left top",
    positionCustom: "",
    attachment: "scroll",
    color: "#ebebeb"      // promedio del papel: sin destello oscuro mientras carga
  };

  /* Tema de los elementos que van sobre el fondo. Los dos juegos de color
     están en la hoja de estilos del sitio; acá sólo se elige cuál. */
  function temaUi() {
    if (!data.site) data.site = {};
    return data.site.ui === "clear" ? "clear" : "dark";
  }

  function fondo() {
    if (!data.site) data.site = {};
    if (!data.site.background) {
      data.site.background = JSON.parse(JSON.stringify(FONDO_POR_DEFECTO));
    }
    return data.site.background;
  }

  function valorFondo(bg, clave) {
    return bg[clave] === "custom" ? bg[clave + "Custom"] : bg[clave];
  }

  /* La vista previa de posición de los tokens usa el mismo papel que el sitio
     (achicado: el recuadro representa la pantalla entera). Antes el CSS tenía
     escrito un archivo fijo, que quedó apuntando a un fondo borrado. */
  function pintarFondoMini() {
    var bg = fondo();
    elMini.style.backgroundColor = bg.color || "#ebebeb";
    elMini.style.backgroundImage = bg.image
      ? 'url("' + rootSrc(bg.image).replace(/["'()]/g, "") + '")'
      : "none";
  }

  function pintarPreviaFondo() {
    pintarFondoMini();
    var bg = fondo();
    var vista = $("bgPreview");
    vista.style.backgroundColor = bg.color || "#ebebeb";
    vista.style.backgroundImage = bg.image
      ? 'url("' + rootSrc(bg.image).replace(/["'()]/g, "") + '")'
      : "none";
    vista.style.backgroundRepeat = bg.repeat || "repeat";
    vista.style.backgroundSize = valorFondo(bg, "size") || "auto";
    vista.style.backgroundPosition = valorFondo(bg, "position") || "left top";
    // en la previa no tiene sentido fixed: mostraría el fondo de la ventana
    vista.style.backgroundAttachment = "scroll";
    $("bgPreviewUi").setAttribute("data-ui", temaUi());
  }

  function sincronizarFondo() {
    var bg = fondo();
    $("bgImage").value = bg.image || "";
    $("bgRepeat").value = bg.repeat || "repeat";
    $("bgSize").value = bg.size || "auto";
    $("bgSizeCustom").value = bg.sizeCustom || "";
    $("bgPosition").value = bg.position || "left top";
    $("bgPositionCustom").value = bg.positionCustom || "";
    $("bgAttachment").value = bg.attachment || "scroll";
    $("bgColor").value = /^#[0-9a-fA-F]{6}$/.test(bg.color || "") ? bg.color : "#ebebeb";
    $("bgSizeCustomField").hidden = bg.size !== "custom";
    $("bgPositionCustomField").hidden = bg.position !== "custom";
    $("uiTheme").value = temaUi();
    pintarPreviaFondo();
    sincronizarMantenimiento();
  }

  /* Sitio en mantenimiento: site.maintenance = { on, message: { en, es } }.
     Los textos por defecto viven también en app.js (MANT_TEXTO). */
  var MANT_TEXTO = {
    en: "Website under maintenance, check back soon! Sorry for the inconvenience.",
    es: "Sitio en mantenimiento, ¡volvé pronto! Disculpá las molestias."
  };
  function mantenimiento() {
    if (!data.site) data.site = {};
    var m = data.site.maintenance;
    if (!m || typeof m !== "object") m = data.site.maintenance = { on: false };
    if (!m.message || typeof m.message !== "object") m.message = { en: MANT_TEXTO.en, es: MANT_TEXTO.es };
    return m;
  }
  function sincronizarMantenimiento() {
    var m = (data.site && data.site.maintenance) || {};
    var msj = m.message || {};
    $("mantOn").value = m.on ? "si" : "no";
    $("mantEn").value = msj.en || MANT_TEXTO.en;
    $("mantEs").value = msj.es || MANT_TEXTO.es;
  }

  function campoFondo(id, clave) {
    function aplicar() {
      fondo()[clave] = this.value;
      $("bgSizeCustomField").hidden = fondo().size !== "custom";
      $("bgPositionCustomField").hidden = fondo().position !== "custom";
      pintarPreviaFondo();
      markDirty();
    }
    $(id).addEventListener("input", aplicar);
    $(id).addEventListener("change", aplicar);
  }

  function iniciarFondo() {
    [["bgImage", "image"], ["bgRepeat", "repeat"], ["bgSize", "size"],
     ["bgSizeCustom", "sizeCustom"], ["bgPosition", "position"],
     ["bgPositionCustom", "positionCustom"], ["bgAttachment", "attachment"],
     ["bgColor", "color"]].forEach(function (par) { campoFondo(par[0], par[1]); });

    $("bgPick").addEventListener("click", function () { $("bgFile").click(); });

    $("bgFile").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (!f) return;
      // va a img/, no a la carpeta de un proyecto: el fondo es del sitio
      fetch(API + "/upload?to=img&name=" + encodeURIComponent(f.name),
            { method: "POST", body: f })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (r) {
          subidos.push(r.src);
          fondo().image = r.src;
          sincronizarFondo();
          markDirty();
          toast("Cargado: " + r.name);
        })
        .catch(function (e) { toast("Error al subir: " + e.message, "error"); });
    });

    $("bgClear").addEventListener("click", function () {
      fondo().image = "";
      sincronizarFondo();
      markDirty();
    });

    $("btnScanFiles").addEventListener("click", buscarSinUsar);
    $("btnCleanFiles").addEventListener("click", limpiarSinUsar);

    $("mantOn").addEventListener("change", function () {
      mantenimiento().on = this.value === "si";
      markDirty();
    });
    [["mantEn", "en"], ["mantEs", "es"]].forEach(function (par) {
      $(par[0]).addEventListener("input", function () {
        // vacío vuelve al texto por defecto (el sitio nunca queda sin aviso)
        mantenimiento().message[par[1]] = this.value.trim() || MANT_TEXTO[par[1]];
        markDirty();
      });
    });

    $("uiTheme").addEventListener("change", function () {
      if (!data.site) data.site = {};
      data.site.ui = this.value === "clear" ? "clear" : "dark";
      pintarPreviaFondo();
      markDirty();
    });

    // Siempre abre (antes era un interruptor: un clic de más la cerraba).
    // Para volver a un proyecto, se lo elige en la lista.
    $("btnSite").addEventListener("click", function () {
      elPaginas.hidden = true;
      elSite.hidden = false;
      elEditor.hidden = true;
      elEmpty.hidden = true;
      sincronizarFondo();
      renderSiteTags();
      renderAtajos();
    });
  }

  /* ---------------- páginas: editor visual ----------------
     Abre cualquier .html de las carpetas de proyecto y se edita sobre la
     página misma (designMode): lo que se ve es lo que queda. Barra con
     bloque, fuente, tamaño, color, estilos, alineación, listas, links,
     imágenes, separador. "Código" muestra el HTML para tocarlo a mano.
     Se guarda con "Guardar página" o Ctrl+S (PUT /api/project/html). */
  var pag = { ruta: null, carpeta: null, nombre: null, sucio: false, codigo: false, img: null };
  var elPaginas = $("paginasEditor");
  var marco = $("pagMarco");

  var FUENTES = [
    ["", "Fuente…"],
    ['system-ui, -apple-system, "Segoe UI", sans-serif', "Sistema"],
    ['ui-sans-serif, system-ui, "Segoe UI", Inter, Helvetica, Arial, sans-serif', "La del sitio"],
    ['"Inter", sans-serif', "Inter", "Inter:wght@400;600;700"],
    ['"Roboto", sans-serif', "Roboto", "Roboto:wght@400;700"],
    ['"Montserrat", sans-serif', "Montserrat", "Montserrat:wght@400;600;700"],
    ['"Space Grotesk", sans-serif', "Space Grotesk", "Space+Grotesk:wght@400;600;700"],
    ['"Lora", serif', "Lora", "Lora:wght@400;700"],
    ['"Merriweather", serif', "Merriweather", "Merriweather:wght@400;700"],
    ['"Playfair Display", serif', "Playfair Display", "Playfair+Display:wght@400;700"],
    ['Georgia, "Times New Roman", serif', "Georgia"],
    ['"IBM Plex Mono", monospace', "IBM Plex Mono", "IBM+Plex+Mono:wght@400;700"],
    ['ui-monospace, Consolas, "Courier New", monospace', "Monoespaciada"]
  ];
  var TAMANOS = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 64, 72];

  function docPag() { try { return marco.contentDocument; } catch (e) { return null; } }

  function estadoPag(txt, sucio) {
    pag.sucio = !!sucio;
    $("pagGuardar").disabled = !pag.ruta || !pag.sucio;
    $("pagEstado").textContent = txt || (pag.sucio ? "sin guardar" : "");
    $("pagEstado").className = "pag-info__estado" + (pag.sucio ? " is-sucio" : "");
  }

  function abrirPaginas(ruta) {
    elSite.hidden = true;
    elEditor.hidden = true;
    elEmpty.hidden = true;
    elPaginas.hidden = false;
    if (!$("pagBarra").children.length) armarBarra();
    listarPaginas().then(function () { if (ruta) abrirPagina(ruta); });
  }

  function listarPaginas() {
    return getJSON(API + "/site-files").then(function (r) {
      var htmls = (r.files || []).filter(function (f) { return /^projects\/.+\.html?$/i.test(f); });
      var caja = $("pagLista");
      caja.innerHTML = "";
      var grupos = {};
      htmls.forEach(function (f) {
        var carpeta = f.split("/")[1];
        if (!grupos[carpeta]) {
          var t = document.createElement("div");
          t.className = "paginas__carpeta";
          t.textContent = carpeta;
          caja.appendChild(t);
          grupos[carpeta] = true;
        }
        var b = document.createElement("button");
        b.type = "button";
        b.className = "paginas__item" + (f === pag.ruta ? " is-on" : "");
        b.textContent = f.slice(f.lastIndexOf("/") + 1);
        b.title = f;
        b.addEventListener("click", function () { abrirPagina(f); });
        caja.appendChild(b);
      });
      if (!htmls.length) caja.textContent = "Todavía no hay páginas. Creá una con “Nueva”.";
    }).catch(function (e) {
      $("pagLista").textContent = "No se pudo leer la lista · ¿reiniciaste node server.js?";
    });
  }

  function abrirPagina(ruta) {
    if (pag.sucio && pag.ruta !== ruta &&
        !confirm("“" + pag.nombre + "” tiene cambios sin guardar. ¿Descartarlos?")) return;
    var partes = ruta.split("/");
    pag.ruta = ruta;
    pag.carpeta = partes[1];
    pag.nombre = partes[partes.length - 1];
    salirDeCodigo(false);
    cerrarPops();
    $("pagRuta").textContent = ruta;
    var corta = ((data.site && data.site.atajos) || []).filter(function (a) { return a.hacia === ruta; })[0];
    $("pagAbrir").hidden = false;
    $("pagAbrir").href = ".." + (corta ? corta.desde : "/" + ruta);
    $("pagAbrir").title = corta ? "Dirección corta: " + corta.desde : ruta;
    $("pagModo").disabled = false;
    estadoPag("abriendo…", false);
    // una sola vez: reescribir el documento desde "Código" también dispara load
    marco.onload = function () { marco.onload = null; prepararDoc(); estadoPag("", false); };
    marco.src = "../" + ruta + "?editar=" + Date.now();
    Array.prototype.forEach.call(document.querySelectorAll(".paginas__item"), function (b) {
      b.classList.toggle("is-on", b.title === ruta);
    });
  }

  // se llama al cargar y cada vez que se reescribe el documento (vuelta de "Código")
  function prepararDoc() {
    var d = docPag();
    if (!d) return;
    d.designMode = "on";
    try { d.execCommand("styleWithCSS", false, true); } catch (e) {}
    d.addEventListener("input", function () { estadoPag("", true); });
    d.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); guardarPagina(); }
    });
    d.addEventListener("selectionchange", reflejarSeleccion);
    d.addEventListener("click", function (e) {
      var img = e.target && e.target.tagName === "IMG" ? e.target : null;
      Array.prototype.forEach.call(d.querySelectorAll("img[data-editando]"), function (i) { i.removeAttribute("data-editando"); i.style.outline = ""; });
      pag.img = img;
      if (img) { img.setAttribute("data-editando", "1"); img.style.outline = "2px solid #c0233a"; }
      reflejarSeleccion();
    });
  }

  function htmlDePagina() {
    if (pag.codigo) return $("pagCodigo").value;
    var d = docPag();
    if (!d) return "";
    // la marca de la imagen elegida no se guarda
    var marcada = d.querySelector("img[data-editando]");
    if (marcada) { marcada.removeAttribute("data-editando"); marcada.style.outline = ""; if (!marcada.getAttribute("style")) marcada.removeAttribute("style"); }
    var html = "<!doctype html>\n" + d.documentElement.outerHTML + "\n";
    if (marcada && pag.img === marcada) { marcada.setAttribute("data-editando", "1"); marcada.style.outline = "2px solid #c0233a"; }
    return html;
  }

  function guardarPagina() {
    if (!pag.ruta) return;
    var texto = htmlDePagina();
    estadoPag("guardando…", pag.sucio);
    fetch(API + "/project/html?id=" + encodeURIComponent(pag.carpeta) + "&name=" + encodeURIComponent(pag.nombre),
          { method: "PUT", headers: { "Content-Type": "text/html; charset=utf-8" }, body: texto })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function () { estadoPag("guardada", false); })
      .catch(function (e) {
        estadoPag("no se pudo guardar", true);
        toast("No se pudo guardar la página: " + e.message + " · ¿reiniciaste node server.js?", "error");
      });
  }

  // ---- modo código ----
  function entrarACodigo() {
    var t = $("pagCodigo");
    t.value = htmlDePagina();
    t.hidden = false;
    marco.hidden = true;
    $("pagBarra").classList.add("is-off");
    pag.codigo = true;
    $("pagModo").textContent = "Visual";
  }
  function salirDeCodigo(aplicar) {
    if (!pag.codigo) return;
    var t = $("pagCodigo");
    if (aplicar) {
      var d = docPag();
      if (d) { d.open(); d.write(t.value); d.close(); prepararDoc(); estadoPag("", pag.sucio); }
    }
    t.hidden = true;
    marco.hidden = false;
    $("pagBarra").classList.remove("is-off");
    pag.codigo = false;
    $("pagModo").textContent = "Código";
  }
  $("pagModo").addEventListener("click", function () {
    if (!pag.ruta) return;
    if (pag.codigo) salirDeCodigo(true); else entrarACodigo();
  });
  $("pagCodigo").addEventListener("input", function () { estadoPag("", true); });
  $("pagCodigo").addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); guardarPagina(); }
    if (e.key === "Tab" && !e.ctrlKey) {
      e.preventDefault();
      var a = this.selectionStart, z = this.selectionEnd;
      this.value = this.value.slice(0, a) + "  " + this.value.slice(z);
      this.selectionStart = this.selectionEnd = a + 2;
    }
  });
  $("pagGuardar").addEventListener("click", guardarPagina);

  // ---- barra de herramientas ----
  function orden(nombre, valor) {
    var d = docPag();
    if (!d || pag.codigo) return;
    marco.contentWindow.focus();
    d.execCommand(nombre, false, valor == null ? null : valor);
    estadoPag("", true);
    reflejarSeleccion();
  }

  function boton(txt, titulo, fn, clase) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pag-b" + (clase ? " " + clase : "");
    b.innerHTML = txt;
    b.title = titulo;
    // que el clic no le saque la selección a la página
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", fn);
    return b;
  }

  function grupo() {
    var g = document.createElement("span");
    g.className = "pag-grupo";
    for (var i = 0; i < arguments.length; i++) g.appendChild(arguments[i]);
    return g;
  }

  var ctl = {};

  function armarBarra() {
    var barra = $("pagBarra");

    ctl.bloque = document.createElement("select");
    [["p", "Párrafo"], ["h1", "Título 1"], ["h2", "Título 2"], ["h3", "Título 3"], ["h4", "Título 4"],
     ["blockquote", "Cita"], ["pre", "Preformateado"]].forEach(function (o) {
      var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; ctl.bloque.appendChild(op);
    });
    ctl.bloque.title = "Tipo de bloque";
    ctl.bloque.addEventListener("change", function () { orden("formatBlock", "<" + this.value + ">"); });

    ctl.fuente = document.createElement("select");
    ctl.fuente.title = "Fuente";
    FUENTES.forEach(function (f) {
      var op = document.createElement("option"); op.value = f[0]; op.textContent = f[1];
      if (f[0]) op.style.fontFamily = f[0];
      ctl.fuente.appendChild(op);
    });
    ctl.fuente.addEventListener("change", function () {
      var f = FUENTES.filter(function (x) { return x[0] === ctl.fuente.value; })[0];
      if (!f || !f[0]) return;
      if (f[2]) cargarFuente(f[2]);
      orden("fontName", f[0]);
    });

    ctl.tamano = document.createElement("select");
    ctl.tamano.title = "Tamaño del texto";
    var t0 = document.createElement("option"); t0.value = ""; t0.textContent = "Tamaño"; ctl.tamano.appendChild(t0);
    TAMANOS.forEach(function (px) {
      var op = document.createElement("option"); op.value = px; op.textContent = px + " px"; ctl.tamano.appendChild(op);
    });
    ctl.tamano.addEventListener("change", function () { if (this.value) aplicarTamano(this.value + "px"); });

    ctl.color = document.createElement("input");
    ctl.color.type = "color"; ctl.color.value = "#000000"; ctl.color.title = "Color del texto";
    ctl.color.addEventListener("input", function () { orden("foreColor", this.value); });
    ctl.fondo = document.createElement("input");
    ctl.fondo.type = "color"; ctl.fondo.value = "#fff59d"; ctl.fondo.title = "Resaltado (fondo del texto)";
    ctl.fondo.addEventListener("input", function () { orden("hiliteColor", this.value); });

    ctl.negrita = boton("<b>B</b>", "Negrita (Ctrl+B)", function () { orden("bold"); });
    ctl.cursiva = boton("<i>I</i>", "Cursiva (Ctrl+I)", function () { orden("italic"); });
    ctl.subrayado = boton("<u>U</u>", "Subrayado (Ctrl+U)", function () { orden("underline"); });
    ctl.tachado = boton("<s>S</s>", "Tachado", function () { orden("strikeThrough"); });

    barra.appendChild(grupo(ctl.bloque, ctl.fuente, ctl.tamano));
    barra.appendChild(grupo(ctl.negrita, ctl.cursiva, ctl.subrayado, ctl.tachado));
    barra.appendChild(grupo(etiqueta("A", ctl.color), etiqueta("▮", ctl.fondo)));
    barra.appendChild(grupo(
      boton("⯇", "Alinear a la izquierda", function () { orden("justifyLeft"); }),
      boton("≡", "Centrar", function () { orden("justifyCenter"); }),
      boton("⯈", "Alinear a la derecha", function () { orden("justifyRight"); }),
      boton("☰", "Justificar", function () { orden("justifyFull"); })));
    barra.appendChild(grupo(
      boton("• —", "Lista con viñetas", function () { orden("insertUnorderedList"); }),
      boton("1.", "Lista numerada", function () { orden("insertOrderedList"); }),
      boton("⇤", "Menos sangría", function () { orden("outdent"); }),
      boton("⇥", "Más sangría", function () { orden("indent"); })));
    barra.appendChild(grupo(
      boton("Link", "Agregar o cambiar un link", abrirLink),
      boton("Imagen", "Insertar una imagen de la carpeta", abrirImagenes),
      boton("—", "Línea separadora", function () { orden("insertHorizontalRule"); })));

    // imagen elegida: su ancho
    ctl.imgAncho = document.createElement("input");
    ctl.imgAncho.type = "number"; ctl.imgAncho.min = "5"; ctl.imgAncho.max = "100"; ctl.imgAncho.step = "5";
    ctl.imgAncho.title = "Ancho de la imagen elegida, en % del ancho disponible";
    ctl.imgAncho.addEventListener("input", function () {
      if (!pag.img) return;
      var v = Math.max(5, Math.min(100, Number(this.value) || 100));
      pag.img.style.width = v + "%";
      pag.img.style.height = "auto";
      estadoPag("", true);
    });
    ctl.imgGrupo = grupo(etiqueta("Imagen %", ctl.imgAncho),
      boton("Quitar", "Quitar la imagen elegida", function () {
        if (!pag.img) return;
        pag.img.remove(); pag.img = null; estadoPag("", true); reflejarSeleccion();
      }));
    ctl.imgGrupo.hidden = true;
    barra.appendChild(ctl.imgGrupo);

    barra.appendChild(grupo(
      boton("Tx", "Quitar formato", function () { orden("removeFormat"); }),
      boton("↶", "Deshacer (Ctrl+Z)", function () { orden("undo"); }),
      boton("↷", "Rehacer (Ctrl+Y)", function () { orden("redo"); })));
  }

  function etiqueta(txt, control) {
    var l = document.createElement("label");
    l.className = "pag-etq";
    var s = document.createElement("span");
    s.textContent = txt;
    l.appendChild(s);
    l.appendChild(control);
    return l;
  }

  // Google Fonts: se agrega a la página la primera vez que se usa esa fuente
  function cargarFuente(familia) {
    var d = docPag();
    if (!d || !d.head) return;
    var nombre = familia.split(":")[0];
    if (d.head.querySelector('link[data-fuente="' + nombre + '"]')) return;
    var l = d.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + familia + "&display=swap";
    l.setAttribute("data-fuente", nombre);
    d.head.appendChild(l);
  }

  /* Tamaño exacto en px: execCommand sólo sabe de 7 tamaños fijos, así que se
     aplica el más grande como marca y después se lo reemplaza por el pedido. */
  function aplicarTamano(px) {
    var d = docPag();
    if (!d || pag.codigo) return;
    marco.contentWindow.focus();
    d.execCommand("fontSize", false, "7");
    Array.prototype.forEach.call(d.querySelectorAll('span[style*="xxx-large"], font[size="7"]'), function (n) {
      if (n.tagName === "FONT") {
        var s = d.createElement("span");
        while (n.firstChild) s.appendChild(n.firstChild);
        n.parentNode.replaceChild(s, n);
        n = s;
      }
      n.style.fontSize = px;
    });
    estadoPag("", true);
  }

  function reflejarSeleccion() {
    var d = docPag();
    if (!d || !ctl.bloque) return;
    try {
      ctl.negrita.classList.toggle("is-on", d.queryCommandState("bold"));
      ctl.cursiva.classList.toggle("is-on", d.queryCommandState("italic"));
      ctl.subrayado.classList.toggle("is-on", d.queryCommandState("underline"));
      ctl.tachado.classList.toggle("is-on", d.queryCommandState("strikeThrough"));
      var blq = String(d.queryCommandValue("formatBlock") || "p").toLowerCase();
      ctl.bloque.value = ["h1", "h2", "h3", "h4", "blockquote", "pre"].indexOf(blq) >= 0 ? blq : "p";
    } catch (e) {}
    var sel = d.getSelection && d.getSelection();
    var nodo = sel && sel.anchorNode;
    var el = nodo ? (nodo.nodeType === 1 ? nodo : nodo.parentElement) : null;
    if (el) {
      var cs = marco.contentWindow.getComputedStyle(el);
      var px = Math.round(parseFloat(cs.fontSize));
      ctl.tamano.value = TAMANOS.indexOf(px) >= 0 ? String(px) : "";
      var fam = cs.fontFamily.replace(/["']/g, "").replace(/\s+/g, " ").toLowerCase();
      var hit = FUENTES.filter(function (f) { return f[0] && fam.indexOf(f[0].split(",")[0].replace(/"/g, "").toLowerCase()) === 0; })[0];
      ctl.fuente.value = hit ? hit[0] : "";
    }
    ctl.imgGrupo.hidden = !pag.img;
    if (pag.img) {
      var w = pag.img.style.width;
      ctl.imgAncho.value = /%$/.test(w) ? parseFloat(w) : 100;
    }
  }

  // ---- ventanitas ----
  function cerrarPops() { $("popLink").hidden = true; $("popImg").hidden = true; }
  var rangoGuardado = null;
  function guardarRango() {
    var d = docPag(), s = d && d.getSelection();
    rangoGuardado = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  }
  function volverRango() {
    var d = docPag();
    if (!d || !rangoGuardado) return;
    marco.contentWindow.focus();
    var s = d.getSelection();
    s.removeAllRanges();
    s.addRange(rangoGuardado);
  }
  function linkActual() {
    var d = docPag(), s = d && d.getSelection();
    var n = s && s.anchorNode;
    n = n && (n.nodeType === 1 ? n : n.parentElement);
    return n && n.closest ? n.closest("a") : null;
  }

  function abrirLink() {
    if (!docPag() || pag.codigo) return;
    guardarRango();
    var a = linkActual();
    $("linkUrl").value = a ? a.getAttribute("href") || "" : "";
    $("linkPestana").checked = a ? a.target === "_blank" : false;
    var sel = $("linkSugerencias");
    sel.innerHTML = '<option value="">—</option>';
    function grupoOps(titulo, lista) {
      if (!lista.length) return;
      var g = document.createElement("optgroup"); g.label = titulo;
      lista.forEach(function (x) { var o = document.createElement("option"); o.value = x[0]; o.textContent = x[1]; g.appendChild(o); });
      sel.appendChild(g);
    }
    listarCarpeta(pag.carpeta).then(function (files) {
      grupoOps("Archivos de esta carpeta", files.map(function (f) { return [f.src, f.src]; }));
      grupoOps("Direcciones cortas", ((data.site && data.site.atajos) || []).filter(function (x) { return x.desde; })
        .map(function (x) { return [x.desde, x.desde]; }));
      grupoOps("Páginas del sitio", data.projects.map(function (p) {
        return ["/#/p/" + p.id, (mlAny(p.title) || p.id) + " (" + p.id + ")"];
      }));
    });
    $("popImg").hidden = true;
    $("popLink").hidden = false;
    $("linkUrl").focus();
  }
  $("linkSugerencias").addEventListener("change", function () { if (this.value) $("linkUrl").value = this.value; });
  $("linkCancelar").addEventListener("click", cerrarPops);
  $("linkQuitar").addEventListener("click", function () {
    volverRango();
    var a = linkActual();
    if (a) {
      var r = docPag().createRange(); r.selectNodeContents(a);
      var s = docPag().getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    orden("unlink");
    cerrarPops();
  });
  $("linkAplicar").addEventListener("click", function () {
    var url = $("linkUrl").value.trim();
    if (!url) { cerrarPops(); return; }
    volverRango();
    var d = docPag();
    var a = linkActual();
    if (a) {
      a.setAttribute("href", url);
    } else {
      var s = d.getSelection();
      if (!s.rangeCount || s.isCollapsed) {
        // sin texto elegido: el link se escribe con su propia dirección
        orden("insertHTML", '<a href="' + url.replace(/"/g, "&quot;") + '">' + url.replace(/</g, "&lt;") + "</a>");
      } else {
        orden("createLink", url);
      }
      a = linkActual();
    }
    if (a) {
      if ($("linkPestana").checked) { a.target = "_blank"; a.rel = "noopener"; }
      else { a.removeAttribute("target"); a.removeAttribute("rel"); }
    }
    estadoPag("", true);
    cerrarPops();
  });
  $("linkUrl").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $("linkAplicar").click(); }
    if (e.key === "Escape") cerrarPops();
  });

  function abrirImagenes() {
    if (!docPag() || pag.codigo) return;
    guardarRango();
    pintarImagenes();
    $("popLink").hidden = true;
    $("popImg").hidden = false;
  }
  function pintarImagenes() {
    var caja = $("imgLista");
    caja.textContent = "Cargando…";
    listarCarpeta(pag.carpeta).then(function (files) {
      caja.innerHTML = "";
      var imgs = files.filter(function (f) { return /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f.src); });
      if (!imgs.length) caja.textContent = "La carpeta no tiene imágenes: subí una.";
      imgs.forEach(function (f) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "pag-pop__img";
        b.title = f.src;
        var im = document.createElement("img");
        im.src = "../projects/" + pag.carpeta + "/" + f.src;
        im.alt = "";
        b.appendChild(im);
        b.addEventListener("mousedown", function (e) { e.preventDefault(); });
        b.addEventListener("click", function () {
          volverRango();
          orden("insertHTML", '<img src="' + f.src + '" alt="" style="max-width:100%; height:auto;">');
          cerrarPops();
        });
        caja.appendChild(b);
      });
    });
  }
  $("imgCancelar").addEventListener("click", cerrarPops);
  $("imgSubir").addEventListener("click", function () { $("imgArchivo").click(); });
  $("imgArchivo").addEventListener("change", function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = "";
    files.reduce(function (cad, f) {
      return cad.then(function () {
        var u = API + "/upload?id=" + encodeURIComponent(pag.carpeta) + "&name=" + encodeURIComponent(f.name);
        return fetch(u, { method: "POST", body: f }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); });
      });
    }, Promise.resolve()).then(pintarImagenes)
      .catch(function (e) { toast("Error al subir: " + e.message, "error"); });
  });

  // ---- nueva página ----
  $("pagNueva").addEventListener("click", function () {
    var carpetas = data.projects.map(function (p) { return p.id; });
    var carpeta = prompt("¿En qué carpeta? (la de un proyecto)\n\n" + carpetas.join(" · "),
                         pag.carpeta || (currentId || carpetas[0] || ""));
    if (!carpeta) return;
    carpeta = carpeta.trim();
    if (carpetas.indexOf(carpeta) < 0) { toast("No hay un proyecto “" + carpeta + "”.", "error"); return; }
    var nombre = prompt("Nombre del archivo:", "pagina.html");
    if (!nombre) return;
    nombre = nombre.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
    if (!/\.html?$/i.test(nombre)) nombre += ".html";
    var ruta = "projects/" + carpeta + "/" + nombre;
    fetch("../" + ruta, { method: "HEAD", cache: "no-store" }).then(function (r) {
      if (r.ok) { toast("Ya existe " + ruta + ".", "error"); return; }
      var plantilla = [
        "<!doctype html>",
        '<html lang="es">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>" + nombre.replace(/\.html?$/i, "") + "</title>",
        "<style>",
        "  body{ margin:0; background:#fbfaf7; color:#1d1d1f; font:16px/1.6 system-ui, -apple-system, \"Segoe UI\", sans-serif; }",
        "  main{ max-width:760px; margin:0 auto; padding:40px 20px 64px; }",
        "  h1{ font-size:30px; line-height:1.25; }",
        "  img{ max-width:100%; height:auto; }",
        "  a{ color:#c0233a; }",
        "</style>",
        "</head>",
        "<body>",
        "<main>",
        "  <h1>Título de la página</h1>",
        "  <p>Escribí acá.</p>",
        "</main>",
        "</body>",
        "</html>",
        ""
      ].join("\n");
      return fetch(API + "/project/html?id=" + encodeURIComponent(carpeta) + "&name=" + encodeURIComponent(nombre),
                   { method: "PUT", headers: { "Content-Type": "text/html; charset=utf-8" }, body: plantilla })
        .then(function (r2) { if (!r2.ok) throw new Error("HTTP " + r2.status); })
        .then(function () { pag.sucio = false; return listarPaginas(); })
        .then(function () { abrirPagina(ruta); toast("Página creada: " + ruta); });
    }).catch(function (e) { toast("No se pudo crear: " + e.message, "error"); });
  });

  $("btnPaginas").addEventListener("click", function () { abrirPaginas(); });
  window.addEventListener("beforeunload", function (e) {
    if (pag.sucio) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------------- archivos sin usar ----------------
     Nunca se borra nada: se aparta en .papelera. Y nunca se actúa a ciegas,
     primero hay que ver la lista. Con cambios sin guardar no se toca nada: un
     archivo recién subido todavía no figura en el JSON del disco y parecería
     estar de más. */

  var sinUsar = [];

  function pesoLegible(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  }

  function pintarSinUsar(lista, bytes) {
    var caja = $("unusedList");
    caja.innerHTML = "";
    if (!lista.length) {
      caja.textContent = "No hay archivos sin usar: está todo en uso.";
      $("btnCleanFiles").disabled = true;
      return;
    }
    var resumen = document.createElement("p");
    resumen.className = "unused__resumen";
    resumen.textContent = lista.length + (lista.length === 1 ? " archivo" : " archivos") +
                          " sin usar · " + pesoLegible(bytes);
    caja.appendChild(resumen);
    lista.forEach(function (f) {
      var fila = document.createElement("div");
      fila.className = "unused__item";
      var a = document.createElement("span");
      a.textContent = f.src;
      var b = document.createElement("span");
      b.textContent = pesoLegible(f.bytes);
      fila.appendChild(a);
      fila.appendChild(b);
      caja.appendChild(fila);
    });
    $("btnCleanFiles").disabled = false;
  }

  function buscarSinUsar() {
    if (dirty) {
      toast("Guardá los cambios antes de revisar los archivos", "error");
      return;
    }
    $("unusedList").textContent = "Buscando…";
    $("btnCleanFiles").disabled = true;
    getJSON(API + "/unused").then(function (r) {
      sinUsar = r.files || [];
      pintarSinUsar(sinUsar, r.bytes || 0);
    }).catch(function (e) {
      $("unusedList").textContent = "No se pudo revisar: " + e.message;
    });
  }

  function limpiarSinUsar() {
    if (dirty) {
      toast("Guardá los cambios antes de limpiar", "error");
      return;
    }
    if (!sinUsar.length) return;
    var ok = confirm("Se van a apartar " + sinUsar.length +
      (sinUsar.length === 1 ? " archivo" : " archivos") +
      ".\n\nNo se borran: se mueven a la carpeta .papelera, dentro del sitio.\n\n¿Seguimos?");
    if (!ok) return;

    $("btnCleanFiles").disabled = true;
    fetch(API + "/unused/clean", { method: "POST" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (r) {
        sinUsar = [];
        $("unusedList").textContent = r.total
          ? r.total + (r.total === 1 ? " archivo apartado en " : " archivos apartados en ") + r.dest
          : "No había nada para apartar.";
        toast("Listo: " + r.total + " en " + r.dest);
      })
      .catch(function (e) {
        $("unusedList").textContent = "No se pudo limpiar: " + e.message;
        toast("Error al limpiar: " + e.message, "error");
      });
  }

  /* ---------------- lo que falta revisar ----------------
     Recorre todo el archivo buscando campos cuyo español siga siendo el
     inglés copiado. No bloquea nada: sólo lo pone a la vista, porque si no
     hay que ir campo por campo pasando el cursor para enterarse. */

  /* ---------------- carga ---------------- */

  /* Relee los datos (al arrancar, y después de crear, eliminar o renombrar un
     proyecto). No registra listeners: eso se hace una sola vez, abajo. Antes
     llamaba a iniciarFondo() cada vez y los botones de Configuración quedaban
     con el listener repetido: el botón se abría y cerraba en el mismo clic, y
     subir fondo o mover a la papelera se ejecutaban dos veces. */
  function load() {
    return getJSON(API + "/projects").then(function (json) {
      data = normalize(json);
      if (!Array.isArray(data.projects)) data.projects = [];
      rutasGuardadas = rutasDe(data);
      if (!data.site.pantalla && data.projects.length) {
        // todavía no hay referencia: la composición se armó en esta pantalla
        anotarPantalla();
        markDirty();
        toast("Se anotó tu pantalla (" + data.site.pantalla.w + " × " + data.site.pantalla.h +
              ") como referencia de la composición. Guardá para que el sitio la use.");
      }
      renderList();
      ajustarMini();
      pintarFondoMini();
    });
  }

  var reMini;
  window.addEventListener("resize", function () {
    clearTimeout(reMini);
    reMini = setTimeout(function () {
      ajustarMini();
      if (current()) { syncMini(); pintarFantasmas(); }
    }, 120);
  });

  iniciarFondo();   // los listeners de Configuración, una sola vez
  // la biblioteca de íconos de botón; si llega con un proyecto abierto, se redibuja
  getJSON(API + "/button-icons").then(function (r) {
    iconosBoton = Array.isArray(r.icons) ? r.icons : [];
    if (iconosBoton.length && current()) renderBlocks();
  }).catch(function () {});
  load().then(function () {
    if (data.projects.length) select(data.projects[0].id);
    else setStatus("sin proyectos");
  }).catch(function (e) {
    setStatus("sin conexión", "is-dirty");
    elEmpty.innerHTML = "<p>No se pudo contactar al servidor.<br>Abrí una terminal en la carpeta del sitio y ejecutá <code>node server.js</code>, después entrá a <code>http://127.0.0.1:4321/admin/</code></p>";
  });
})();
