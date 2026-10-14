/* =========================================================
   app.js — superficie con tokens arrastrables y rotables
   Ramiro Piedrabuena · https://ramiropiedrabuena.website
   ========================================================= */
(function () {
  "use strict";

  var DATA_URL     = "data/projects.json";
  var STORE_KEY    = "rp-layout-v1";
  var ROTATE_BAND  = 0.60;   // a partir de este radio normalizado se rota
  var CLICK_SLOP   = 5;      // px de tolerancia para considerar "clic" y no "arrastre"
  var CLICK_MAX_MS = 500;    // más que esto apretado sin moverlo no es un clic: no abre

  var stage   = document.getElementById("stage");
  var layer   = document.getElementById("tokens");
  var stageUi = document.getElementById("stageUi");

  var data     = null;
  var tokens   = [];        // { p, el, img, ratio, aspect, rot, w }
  var zTop     = 10;
  var saved    = readStore();
  var drag     = null;

  /* ---------------- almacenamiento ---------------- */

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function writeStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch (e) {}
    stageUi.classList.add("is-dirty");
  }
  function clearStore() {
    saved = {};
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    stageUi.classList.remove("is-dirty");
  }

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  /* Dispersión determinista para tokens sin posición definida. */
  function scatter(id, index) {
    var h = hash(id + "·" + index);
    var a = (h % 1000) / 1000;
    var b = ((h >>> 10) % 1000) / 1000;
    var ang = index * 2.39996;                    // ángulo áureo
    var rad = 0.13 + 0.30 * Math.sqrt((index + 0.7) / 7);
    return {
      x: clamp(0.5 + Math.cos(ang) * rad + (a - 0.5) * 0.06, 0.1, 0.9),
      y: clamp(0.5 + Math.sin(ang) * rad * 0.85 + (b - 0.5) * 0.06, 0.12, 0.88),
      rotation: Math.round((a - 0.5) * 50)
    };
  }

  /* `piso`: hasta dónde pueden llegar los tokens. En celular, arriba de la
     zona de la firma y los hashtags (reservaAbajo); en escritorio, el borde. */
  function stageSize() {
    var h = stage.clientHeight;
    return { w: stage.clientWidth, h: h, piso: h - reservaAbajo };
  }

  /* ---- celular: grilla ----
     La composición de escritorio no entra en una pantalla angosta: los tokens
     miden píxeles fijos y quedaban apretados en una columna. En celular van en
     una grilla compacta de columnas alineadas (5; 4 si la pantalla es muy
     angosta), en el orden de los proyectos, con un desorden mínimo y siempre
     igual para cada token (sale de su id). Las celdas son cuadradas y cada
     token se achica, si hace falta, para entrar en la suya (GRILLA_CUPO): así
     ninguno invade al vecino, y entre ellos se conserva la proporción de
     tamaños. Si no entran en una pantalla, la página crece hacia abajo y se
     descubren desplazándose. El bloque se centra en el espacio libre y una
     última fila incompleta también. El giro es el de escritorio. Nunca entra
     en la zona de la firma y los hashtags (reservaAbajo).
     Mismo corte que el CSS. */
  var CELULAR       = "(max-width: 720px)";
  var GRILLA_CUPO   = 0.84;  // lado máximo del token, en proporción de su celda
  var GRILLA_MARGEN = 32;    // px libres arriba, y entre la grilla y los hashtags
  var GRILLA_LADOS  = 0.06;  // margen a cada costado, en proporción del ancho
  var GRILLA_JITTER = 0.08;  // desorden, en proporción de la celda

  var reservaAbajo = 0;      // px de la zona de firma + hashtags (sólo celular)

  function esCelular() {
    return !!(window.matchMedia && window.matchMedia(CELULAR).matches);
  }

  function columnasGrilla() { return window.innerWidth < 340 ? 4 : 5; }

  // lado de cada celda (y alto de cada fila), en px
  function celdaGrilla() {
    var ancho = (stage && stage.clientWidth) || window.innerWidth || 360;
    return ancho * (1 - 2 * GRILLA_LADOS) / columnasGrilla();
  }

  /* En celular cada token entra en su celda: se achica lo justo para que su
     lado mayor no pase de GRILLA_CUPO de la celda. Nunca se agranda. */
  function escalaCelular(t) {
    var w = t.w || 200, h = w / (t.aspect || 1.6);
    return Math.min(1, celdaGrilla() * GRILLA_CUPO / Math.max(w, h));
  }

  /* ---- tipos de página ----
     project: pieza de portfolio (hashtags, flechas entre proyectos).
     page:    subpágina armada con bloques (lo que antes era "boletín").
     html:    una página HTML de la carpeta del proyecto, dentro de la ventana.
     Cualquiera puede tener o no token en la superficie: a una página sin
     token se llega desde otra (un botón con "Página del sitio"). */
  function tipoDe(p) {
    var k = p && p.kind;
    if (k === "bulletin" || k === "page") return "page";
    return k === "html" ? "html" : "project";
  }
  function esPortfolio(p) { return !!p && tipoDe(p) === "project"; }
  function tieneToken(p) { return !(p.token && p.token.show === false); }
  function conToken() {
    return data && Array.isArray(data.projects) ? data.projects.filter(tieneToken) : [];
  }

  function filasGrilla() {
    var n = conToken().length || 1;
    return Math.ceil(n / columnasGrilla());
  }

  /* Cuánto ocupa abajo la barra fija (firma, idiomas, hashtags): se mide,
     porque cambia con el idioma y con la cantidad de hashtags. */
  /* Cuánto ocupan, contado desde abajo, la firma y los hashtags. Se mide por
     su propio alto y su distancia al borde de abajo, no por dónde están en la
     pantalla: así da lo mismo si van pegados a la pantalla o al final de la
     página (ver sizeSurface). */
  function medirReserva() {
    if (!esCelular()) return 0;
    var alto = 0;
    ["stageUi", "filters"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.hidden) return;
      var abajo = parseFloat(getComputedStyle(el).bottom) || 0;
      alto = Math.max(alto, abajo + el.offsetHeight);
    });
    return alto + GRILLA_MARGEN;
  }

  function enGrilla(id, index) {
    var cols = columnasGrilla(), filas = filasGrilla();
    var n = conToken().length || 1;
    var s = stageSize();
    var h = hash("grilla·" + id);
    var jx = ((h % 1000) / 1000 - 0.5) * GRILLA_JITTER;
    var jy = (((h >>> 10) % 1000) / 1000 - 0.5) * GRILLA_JITTER;
    var col = index % cols, fila = Math.floor(index / cols);
    // la última fila, si quedó incompleta, se centra
    var enFila = fila === filas - 1 ? n - fila * cols : cols;
    var xCol = col + (cols - enFila) / 2;
    // el bloque, centrado en el espacio libre entre el margen de arriba y el piso
    var libre = s.piso - GRILLA_MARGEN;
    var lado = celdaGrilla();
    var arriba = GRILLA_MARGEN + Math.max(0, (libre - filas * lado) / 2);
    var ancho = 1 - 2 * GRILLA_LADOS;
    return {
      x: GRILLA_LADOS + ancho * (xCol + 0.5 + jx) / cols,
      y: (arriba + lado * (fila + 0.5 + jy)) / s.h
    };
  }

  /* Dónde va un token que nadie movió: en escritorio, lo que se armó en el
     panel (o la dispersión automática); en celular, su lugar en la grilla. */
  function posicionBase(p, index) {
    var def  = p.token || {};
    var auto = scatter(p.id, index);
    var pos  = esCelular() ? enGrilla(p.id, index)
                           : { x: num(def.x, auto.x), y: num(def.y, auto.y) };
    pos.rotation = num(def.rotation, auto.rotation);
    return pos;
  }

  /* En escritorio la superficie mide exactamente una pantalla. En celular
     también, salvo que la grilla pida más: entonces crece hacia abajo. */
  function sizeSurface() {
    var vh = window.innerHeight || 800;
    var alto = vh;
    reservaAbajo = medirReserva();
    if (esCelular() && conToken().length) {
      alto = Math.max(vh, GRILLA_MARGEN + filasGrilla() * celdaGrilla() + reservaAbajo);
    }
    stage.style.height = alto + "px";
    // Si la grilla no entra en una pantalla, la página se desplaza: la firma y
    // los hashtags dejan de estar pegados a la pantalla (tapaban la última
    // fila) y van al final de la página, debajo del último token.
    document.body.classList.toggle("pagina-larga", alto > vh);
  }

  /* Los que el visitante no movió vuelven a su lugar base: al girar el
     celular, o al pasar de escritorio a celular, cambia cuál es. */
  function reubicarBase() {
    tokens.forEach(function (t) {
      if (saved[t.p.id]) return;
      var base = posicionBase(t.p, t.i);
      t.x = base.x;
      t.y = base.y;
    });
  }

  /* Todo de nuevo: al cambiar el tamaño, al girar, al cambiar de idioma (la
     barra de hashtags cambia de alto) y cuando terminó de armarse todo. */
  function reacomodar() {
    sizeSurface();
    reubicarBase();
    placeAll();
    separarEncimados();
  }

  /* Los tokens se dibujan a su tamaño real en píxeles (1:1).
     Este factor sólo baja de 1 cuando un token no entraría en la pantalla. */
  /* La composición de escritorio se armó en el panel mirando una pantalla
     (data.site.pantalla). En una más chica se achica entera: los tokens en la
     misma proporción que sus posiciones, así los espacios entre ellos quedan
     como se diseñaron. Nunca se agrandan (perderían nitidez). En celular manda
     la grilla. */
  function escalaDiseno() {
    var ref = data && data.site && data.site.pantalla;
    if (esCelular() || !ref || !(ref.w > 0) || !(ref.h > 0)) return 1;
    var w = Math.max(320, window.innerWidth || ref.w);
    var h = Math.max(240, window.innerHeight || ref.h);
    return Math.min(1, w / ref.w, h / ref.h);
  }

  function fitFactor(t) {
    var s = stageSize();
    var w = t.w || 200;
    var h = w / (t.aspect || 1.6);
    return Math.min(1, (s.w * 0.86) / w, (s.h * 0.72) / h);
  }

  /* ---------------- construcción ---------------- */

  /* Si el proyecto se renombró, lo que el visitante había acomodado quedó
     guardado con el nombre viejo: se recupera y pasa al nombre nuevo. */
  function memoriaPorAlias(p) {
    var alias = (p.aliases || []).filter(function (a) { return saved[a]; })[0];
    if (!alias) return null;
    saved[p.id] = saved[alias];
    delete saved[alias];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch (e) {}
    return saved[p.id];
  }

  function buildToken(p, index) {
    var def  = p.token || {};
    var base = posicionBase(p, index);
    var mem  = saved[p.id] || memoriaPorAlias(p) || {};

    var t = {
      p: p,
      i: index,                                            // su lugar en la grilla de celular
      w: Number(def.width) > 0 ? Number(def.width) : 0,   // 0 = tamaño real del archivo
      aspect: 16 / 10,
      x: num(mem.x, base.x),
      y: num(mem.y, base.y),
      rot: num(mem.rotation, base.rotation)
    };

    var name = I18N.tx(p.title);

    var el = document.createElement("div");
    el.className = "token";
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", I18N.t("openProject") + " " + (name || p.id));
    el.dataset.id = p.id;

    var tokenAnimado = !!def.image && isLottie(def.image);
    if (tokenAnimado) {
      // el token mismo es un Lottie: quieto en su primer cuadro hasta el hover
      var cuadro = document.createElement("div");
      cuadro.className = "token__img token__img--base token__anim";
      el.appendChild(cuadro);
      cargarTokenLottie(t, p, el, cuadro, def);
    } else if (def.image) {
      var img = document.createElement("img");
      img.className = "token__img token__img--base";
      img.src = def.image;
      img.alt = name;
      img.draggable = false;
      img.addEventListener("load", function () {
        if (img.naturalWidth && img.naturalHeight) {
          t.aspect = img.naturalWidth / img.naturalHeight;
          // dimensiones explícitas: el navegador reserva la caja antes de decodificar
          img.setAttribute("width", img.naturalWidth);
          img.setAttribute("height", img.naturalHeight);
          // sin ancho definido, manda el tamaño real del archivo
          if (!t.w) t.w = img.naturalWidth;
          t.forma = formaDeImagen(img);   // forma de choque, sale sola del dibujo
          place(t);
          separarPronto();                // si quedó encimado con otro, se separan
        }
        el.classList.add("is-ready");
      });
      img.addEventListener("error", function () {
        img.remove();
        el.insertBefore(fallback(p), el.firstChild);
        el.classList.add("is-ready");
      });
      el.appendChild(img);
    } else {
      el.appendChild(fallback(p));
      el.classList.add("is-ready");   // sin imagen, se muestra ya
    }

    // Archivo opcional de hover. Si es un .json, es una animación Lottie que
    // queda quieta en el primer fotograma y se reproduce al pasar el cursor.
    if (def.hover && isLottie(def.hover) && !tokenAnimado) {
      var holder = document.createElement("div");
      holder.className = "token__lottie";
      el.appendChild(holder);
      loadHoverLottie(t, holder, def);
    } else if (def.hover && isVideo(def.hover)) {
      // En WebKit no se crea nada: ni siquiera se pide el archivo, así un
      // iPhone no se baja un video que no va a poder mostrar bien. El token
      // se queda estático, que es la degradación buena.
      if (!esWebKit()) {
        // Un video (WebM con alfa, por ejemplo) se controla igual que el Lottie:
        // queda en el primer fotograma y se reproduce al pasar el cursor.
        var vid = document.createElement("video");
        vid.className = "token__img token__img--hover";
        vid.src = def.hover;
        vid.muted = true;
        vid.defaultMuted = true;
        vid.setAttribute("muted", "");
        vid.playsInline = true;
        vid.setAttribute("playsinline", "");
        vid.preload = "auto";
        vid.loop = def.hoverLoop !== false;
        vid.addEventListener("loadeddata", function () {
          // deja el primer fotograma dibujado, si no el hueco arranca en negro
          try { vid.currentTime = 0; } catch (e) {}
        });
        vid.addEventListener("error", function () {
          // si el navegador no sabe leerlo, queda sólo el token estático
          vid.remove();
          el.classList.remove("has-hover");
        });
        el.appendChild(vid);
        el.classList.add("has-hover");
        t.video = vid;
      }
    } else if (def.hover) {
      var hov = document.createElement("img");
      hov.className = "token__img token__img--hover";
      hov.src = def.hover;
      hov.alt = "";
      hov.draggable = false;
      hov.addEventListener("error", function () {
        hov.remove();
        el.classList.remove("has-hover");
      });
      el.appendChild(hov);
      el.classList.add("has-hover");
      // Se decodifica ya, con la página cargando, para que el primer hover no
      // tenga que esperar al decodificador (que es cuando aparece el flash).
      if (hov.decode) hov.decode().catch(function () {});
      prepararAnimada(t, hov, def.hover);
    }

    // Capa de acuarela. Va debajo de los rayones y se mezcla con el dibujo del
    // token, no lo tapa: de eso se encarga el modo de fusión.
    // El canvas NO va dentro del token: el token es un grupo aislado (tiene
    // transform) y la mezcla nunca llegaría al papel. Va como hermano en la
    // capa de tokens, justo debajo o justo encima, siguiéndolo en place().
    if (def.watercolor && def.watercolor.on) {
      var acuarela = document.createElement("canvas");
      acuarela.className = "token__wc";
      acuarela.setAttribute("aria-hidden", "true");
      acuarela.style.mixBlendMode = def.watercolor.blend || "normal";   // por defecto, normal
      var intensidad = Number(def.watercolor.opacity);
      if (intensidad > 0 && intensidad <= 1) acuarela.style.setProperty("--wc-op", intensidad);
      t.wc = acuarela;
      t.wcDebajo = def.watercolor.layer !== "over";   // por defecto, debajo
      // La configuración viaja con el token: el handler de hover se engancha
      // en otro alcance y no ve la definición del proyecto.
      t.wcDef = def.watercolor;
      // En modo recortado, busca una shape/capa llamada "mask" dentro del SVG.
      // Si no existe o no se puede cargar, conserva la máscara automática anterior.
      if ((def.watercolor.freeExpansion === false || def.watercolor.freeExpansion === "false") && extOf(def.image) === "svg") {
        t.wcMaskBase = el.querySelector(".token__img--base");
        cargarMascaraSVG(t, def.image);
      }
    }

    // Capa de rayones, si el proyecto los pidió. Va encima de todo lo demás,
    // así que convive con la imagen de hover en vez de reemplazarla.
    if (def.hoverFx === "scribble") {
      var garabatos = document.createElementNS(SVG_NS, "svg");
      garabatos.setAttribute("class", "token__scribble");
      garabatos.setAttribute("aria-hidden", "true");
      if (def.inkColor) garabatos.style.setProperty("--tinta", def.inkColor);
      el.appendChild(garabatos);
      t.scribble = garabatos;
    }

    // Baile 3D al pasar el cursor (token.float): el ícono entero se acerca y
    // gira mirando a un lado y al otro. Sirve para cualquier imagen.
    if (def.float) t.baile = { x: 0, vel: 0, meta: 0, reloj: 0 };
    // Trazos animados (token.strokes): las líneas sin relleno de un SVG se
    // barren como en los Lottie del portfolio. Hace falta una copia en línea.
    // Por defecto, prendido en todo SVG (en reposo sin líneas); sólo se apaga
    // con strokes: false. Si el SVG no tiene líneas, no pasa nada.
    if (def.strokes !== false && extOf(def.image) === "svg") {
      // mientras se prepara la copia, la imagen (que sí tiene las líneas) no
      // se muestra: si no, al cargar se veían las líneas un instante
      el.classList.add("trazos-espera");
      prepararTrazos(t, el, def.image);
    }

    // Sin etiqueta de nombre al pasar el cursor: tapaba el dibujo. El nombre
    // queda en aria-label para lectores de pantalla.
    t.el = el;
    layer.appendChild(el);
    // debajo: pasa por detrás del dibujo, sin mancharlo; encima: lo mancha
    if (t.wc) layer.insertBefore(t.wc, t.wcDebajo ? el : el.nextSibling);
    bind(t);
    place(t);
    return t;
  }

  function fallback(p) {
    var d = document.createElement("div");
    d.className = "token__fallback";
    d.textContent = I18N.tx(p.title) || p.id;
    return d;
  }

  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }

  function extOf(src) {
    var s = String(src || "").split("?")[0].split("#")[0];
    var i = s.lastIndexOf(".");
    return i < 0 ? "" : s.slice(i + 1).toLowerCase();
  }

  /* Busca una shape o capa con id="mask", name="mask" o etiqueta de capa
     "mask" (por ejemplo, inkscape:label="mask"). Se renderiza como una imagen
     blanca independiente para usar su alfa como máscara real de la acuarela. */
  function cargarMascaraSVG(t, src) {
    t.wcMaskLoading = true;
    fetch(src).then(function (r) {
      if (!r.ok) throw new Error("No se pudo cargar el SVG de la máscara");
      return r.text();
    }).then(function (texto) {
      var doc = new DOMParser().parseFromString(texto, "image/svg+xml");
      var svg = doc.documentElement;
      if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) throw new Error("SVG inválido");

      var todos = Array.prototype.slice.call(svg.querySelectorAll("*"));
      var objetivo = todos.filter(function (n) {
        if ((n.getAttribute("id") || "").toLowerCase() === "mask" ||
            (n.getAttribute("name") || "").toLowerCase() === "mask") return true;
        return Array.prototype.some.call(n.attributes, function (a) {
          return /(^|:)label$/i.test(a.name) && (a.value || "").trim().toLowerCase() === "mask";
        });
      })[0];
      if (!objetivo) throw new Error('El SVG no contiene una shape llamada "mask"');

      var conservar = new Set();
      for (var n = objetivo; n && n !== svg; n = n.parentNode) conservar.add(n);
      todos.forEach(function (n) {
        if (n === objetivo || objetivo.contains(n) || conservar.has(n) ||
            /^(defs|style|title|desc|linearGradient|radialGradient|pattern|clipPath)$/i.test(n.tagName)) return;
        n.remove();
      });

      // La máscara define el área permitida, no sus colores originales.
      [objetivo].concat(Array.prototype.slice.call(objetivo.querySelectorAll("*"))).forEach(function (n) {
        n.style.setProperty("fill", "#fff", "important");
        n.style.setProperty("fill-opacity", "1", "important");
        n.style.setProperty("stroke", "#fff", "important");
        n.style.setProperty("stroke-opacity", "1", "important");
      });
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      if (!svg.getAttribute("viewBox")) {
        var sw = parseFloat(svg.getAttribute("width")) || 100;
        var sh = parseFloat(svg.getAttribute("height")) || 100;
        svg.setAttribute("viewBox", "0 0 " + sw + " " + sh);
      }
      svg.setAttribute("width", "1000");
      svg.setAttribute("height", "1000");

      var imagen = new Image();
      imagen.onload = function () {
        t.wcMask = imagen;
        t.wcMaskNamed = true;
        t.wcMaskLoading = false;
        if (t.el && t.el.classList.contains("is-hover") && !t.el.classList.contains("is-active")) pintarAcuarela(t);
      };
      imagen.onerror = function () {
        t.wcMask = t.wcMaskBase;
        t.wcMaskNamed = false;
        t.wcMaskLoading = false;
        if (t.el && t.el.classList.contains("is-hover") && !t.el.classList.contains("is-active")) pintarAcuarela(t);
      };
      imagen.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    }).catch(function () {
      t.wcMask = t.wcMaskBase;
      t.wcMaskNamed = false;
      t.wcMaskLoading = false;
      if (t.el && t.el.classList.contains("is-hover") && !t.el.classList.contains("is-active")) pintarAcuarela(t);
    });
  }

  function isLottie(src) { var e = extOf(src); return e === "json" || e === "lottie"; }

  function isVideo(src) {
    return ["webm", "mp4", "m4v", "mov", "ogv"].indexOf(extOf(src)) >= 0;
  }

  /* Safari y TODO lo que corre en iPhone usan WebKit, que reproduce WebM pero
     ignora el canal alfa: un token recortado se vería como un rectángulo negro
     tapando el dibujo. Preferimos dejarlo estático antes que mostrar eso. */
  function esWebKit() {
    var v = navigator.vendor || "";
    if (/Apple/i.test(v)) return true;
    var ua = navigator.userAgent || "";
    if (/\b(iPad|iPhone|iPod)\b/.test(ua)) return true;
    return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|SamsungBrowser/.test(ua);
  }

  /* Formatos de imagen que pueden traer animación adentro.
     AVIF queda afuera a propósito: rebobinarlo obliga a decodificarlo de nuevo
     (el <img> queda sin píxeles que pintar por un instante) y los decodificadores
     AV1 de Chromium tienen un bug conocido que convierte ese instante en un
     flash blanco o negro. Un AVIF animado se deja correr en bucle y listo;
     si necesitás que arranque siempre del primer cuadro, usá WebM. */
  var ANIMABLES = ["gif", "webp", "png"];

  function puedeAnimar(src) { return ANIMABLES.indexOf(extOf(src)) >= 0; }

  function buscaMarca(bytes, marca, hasta) {
    var m = [], i;
    for (i = 0; i < marca.length; i++) m.push(marca.charCodeAt(i));
    var fin = Math.min(bytes.length, hasta) - m.length;
    for (i = 0; i <= fin; i++) {
      var ok = true;
      for (var k = 0; k < m.length; k++) {
        if (bytes[i + k] !== m[k]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  /* Mira los primeros bytes para saber si el archivo está realmente animado.
     Un estático no necesita reinicio, y cambiarle el src de gusto puede
     provocar un parpadeo. */
  function estaAnimado(bytes, ext) {
    if (ext === "gif")  return true;                            // casi siempre lo está
    if (ext === "webp") return buscaMarca(bytes, "ANIM", 64);   // chunk de animación
    if (ext === "avif") return buscaMarca(bytes, "avis", 64);   // marca de AVIF animado
    if (ext === "png")  return buscaMarca(bytes, "acTL", 128);  // APNG
    return false;
  }

  /* Una imagen animada dentro de un <img> arranca sola y no se puede rebobinar
     desde JS. Guardamos el archivo en memoria y en cada hover le damos una URL
     nueva: así vuelve a empezar desde el primer cuadro sin volver a pedirlo. */
  function prepararAnimada(t, img, src) {
    if (!puedeAnimar(src)) return;
    fetch(src)
      .then(function (r) {
        if (!r.ok) return null;
        var tipo = r.headers.get("content-type") || "";
        return r.arrayBuffer().then(function (buf) { return { buf: buf, tipo: tipo }; });
      })
      .then(function (res) {
        if (!res) return;
        var bytes = new Uint8Array(res.buf);
        if (!estaAnimado(bytes, extOf(src))) return;
        t.anim = {
          blob: new Blob([res.buf], { type: res.tipo || "application/octet-stream" }),
          img: img,
          url: null
        };
      })
      .catch(function () { /* sin rebobinado: la imagen igual se ve */ });
  }

  function reiniciarAnimada(t) {
    if (!t.anim) return;
    try {
      if (t.anim.url) URL.revokeObjectURL(t.anim.url);
      t.anim.url = URL.createObjectURL(t.anim.blob);
      t.anim.img.src = t.anim.url;
    } catch (e) {}
  }

  /* Carga el Lottie del token y lo deja detenido en el primer fotograma.
     La animación nunca se corta: al sacar el cursor termina su vuelta, y
     recién al llegar al final vuelve al primer fotograma y se esconde (queda
     el dibujo del token). Si el cursor vuelve antes, sigue desde donde iba.
     Mientras se ve, el token lleva la clase .lottie-play. */
  function lottieEntrar(t) {
    var anim = t.lottie;
    if (!anim) return;
    t.lottieSaliendo = false;
    anim.loop = t.lottieLoop;
    t.el.classList.add("lottie-play");
    // si todavía estaba terminando la vuelta anterior, sigue; si no, arranca
    if (anim.isPaused) { try { anim.goToAndPlay(0, true); } catch (e) {} }
  }

  function lottieSalir(t) {
    var anim = t.lottie;
    if (!anim) return;
    if (anim.isPaused) { lottieReposo(t); return; }   // ya había terminado
    t.lottieSaliendo = true;
    anim.loop = false;          // termina esta vuelta y dispara "complete"
  }

  function lottieReposo(t) {
    t.lottieSaliendo = false;
    try { t.lottie.goToAndStop(0, true); } catch (e) {}
    t.el.classList.remove("lottie-play");
  }

  /* Token que es un Lottie: su tamaño sale del propio archivo (w × h), se
     queda en el primer cuadro y se anima con el cursor encima; al salir
     termina la vuelta y vuelve al primer cuadro (lottieEntrar/lottieSalir,
     lo mismo que el Lottie de hover). La forma de choque sale del dibujo de
     ese primer cuadro. */
  function cargarTokenLottie(t, p, el, holder, def) {
    fetch(def.image).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (datos) {
      var w = Number(datos.w) || 100, h = Number(datos.h) || 100;
      t.aspect = w / h;
      if (!t.w) t.w = w;
      place(t);
      return window.ProjectView.loadLottie().then(function (lottie) {
        if (!lottie) throw 0;
        if (!holder.isConnected) return;
        var anim = lottie.loadAnimation({
          container: holder,
          renderer: "svg",
          loop: def.hoverLoop !== false,
          autoplay: false,
          animationData: datos
        });
        anim.addEventListener("DOMLoaded", function () {
          anim.goToAndStop(0, true);
          el.classList.add("is-ready");
          formaDeLottie(t, holder);
        });
        anim.addEventListener("complete", function () {
          if (t.lottieSaliendo || !el.classList.contains("is-hover")) lottieReposo(t);
        });
        t.lottieLoop = def.hoverLoop !== false;
        t.lottie = anim;
      });
    }).catch(function () {
      holder.remove();
      el.insertBefore(fallback(p), el.firstChild);
      el.classList.add("is-ready");
    });
  }

  // el primer cuadro, dibujado como imagen, para sacarle la forma de choque
  function formaDeLottie(t, holder) {
    var svg = holder.querySelector("svg");
    if (!svg) return;
    var img = new Image();
    img.onload = function () {
      t.forma = formaDeImagen(img);
      place(t);
      separarPronto();
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  }

  function loadHoverLottie(t, holder, def) {
    window.ProjectView.loadLottie().then(function (lottie) {
      if (!lottie || !holder.isConnected) return;
      var anim = lottie.loadAnimation({
        container: holder,
        renderer: "svg",
        loop: def.hoverLoop !== false,   // por defecto, en bucle
        autoplay: false,
        path: def.hover
      });
      anim.addEventListener("DOMLoaded", function () {
        anim.goToAndStop(0, true);
        t.el.classList.add("lottie-ready");
      });
      // terminó una vuelta sin bucle: si el cursor ya se fue, a reposo;
      // si sigue encima (animación de una sola vez), queda en su último cuadro
      anim.addEventListener("complete", function () {
        if (t.lottieSaliendo || !t.el.classList.contains("is-hover")) lottieReposo(t);
      });
      t.lottieLoop = def.hoverLoop !== false;
      t.lottie = anim;
    }).catch(function () { /* si falla, queda la imagen del token */ });
  }

  /* Posiciona el token según sus ratios y el tamaño actual de la superficie. */
  function place(t) {
    var s = stageSize();
    t.fit = fitFactor(t);
    var escala = esCelular() ? escalaCelular(t) : escalaDiseno();
    var w = Math.round((t.w || 200) * Math.min(t.fit, escala));
    var h = Math.round(w / (t.aspect || 1.6));
    t.el.style.width = w + "px";
    t.el.style.height = h + "px";
    var cx = t.x * s.w;
    var cy = t.y * s.h;
    t.pw = w;   // tamaño sin rotar: la física lo usa como caja de choque
    t.ph = h;
    // Píxeles enteros: con un desplazamiento fraccionario el navegador tiene que
    // interpolar la capa al componerla y el dibujo se ve apenas borroso.
    var px = Math.round(cx - w / 2);
    var py = Math.round(cy - h / 2);
    t.el.style.transform =
      "translate(" + px + "px," + py + "px) rotate(" + t.rot + "deg)";
    if (t.wc) t.wc.style.transform = t.el.style.transform;   // la acuarela lo sigue
  }

  function placeAll() { tokens.forEach(place); }

  /* ---------------- interacción ---------------- */

  function rect(t) { return t.el.getBoundingClientRect(); }

  /* Devuelve true si el punto cae en la zona exterior (rotación). */
  function inRotateZone(t, clientX, clientY) {
    var r = rect(t);
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var nx = (clientX - cx) / (r.width / 2 || 1);
    var ny = (clientY - cy) / (r.height / 2 || 1);
    return Math.max(Math.abs(nx), Math.abs(ny)) > ROTATE_BAND;
  }

  /* El que se agarra pasa adelante. El z tiene techo: si creciera sin límite,
     después de varios arrastres un token pasaba por encima de la barra de
     abajo (firma, idiomas, hashtags: z 80) y hasta del post abierto (z 200).
     Al llegar al techo se renumeran todos, conservando el orden. */
  var Z_BASE  = 10;
  var Z_TECHO = 45;   // el agarrado sube a 50 (.is-active): sigue debajo de 80

  function ponerZ(t, z) {
    t.el.style.zIndex = z;
    // mismo z que su token: el orden en el DOM decide si queda debajo o encima
    if (t.wc) t.wc.style.zIndex = z;
  }

  function toFront(t) {
    if (zTop >= Z_TECHO) {
      tokens.slice()
        .sort(function (a, b) { return (Number(a.el.style.zIndex) || 0) - (Number(b.el.style.zIndex) || 0); })
        .forEach(function (o, i) { ponerZ(o, Z_BASE + i); });
      zTop = Z_BASE + tokens.length - 1;
    }
    zTop += 1;
    ponerZ(t, zTop);
  }

  /* ---------------- física de tejo ----------------
     Los tokens son fichas de tejo sobre una mesa. Soltado con velocidad, un
     token desliza y frena con fricción constante: frena parejo y se clava, no
     patina para siempre. Chocan como rectángulos girados (su caja sin rotar,
     t.pw × t.ph) y el choque se resuelve con un impulso en el punto de
     contacto, así que un golpe descentrado hace girar a las dos fichas.

     - Son sólidos: NUNCA se enciman. Sólo chocan y se empujan.
     - El token agarrado no se teletransporta al cursor: lo persigue de a pasos
       cortos (PASO_MAX_PX), así no puede saltar por encima de otro. Pesa el
       doble y empuja; si lo que tiene adelante no puede moverse (contra el
       borde o contra otro), se frena en el límite.
     - Los que arrancan encimados (depende del tamaño de pantalla: los tokens
       miden píxeles fijos) se separan al cargar, sin animación.
     - Los filtrados por hashtag no juegan: ni chocan ni se mueven.
     - Con movimiento reducido no hay deslizamiento: sólo el empujón directo.

     Todo en píxeles de la superficie; al final de cada cuadro se vuelve a las
     proporciones t.x / t.y de siempre y se dibuja con place(). */

  // Frenado de disco sobre una mesa (referencia pedida: Soccer Stars): roce
  // constante más un arrastre que crece con la velocidad. A toda velocidad
  // frena fuerte y al final se desliza suave hasta quedar quieto, en vez de
  // clavarse de golpe. Recorridos medidos: ver "Física de tejo" en ESTADO.md.
  var FRICCION      = 900;   // px/s² de roce constante
  var ARRASTRE      = 2.6;   // 1/s: frenado proporcional a la velocidad
  // El giro lo frena el mismo roce con la mesa: cuanto más chica la ficha, más
  // rápido se frena (rad/s² = FRENO_GIRO × FRICCION / semidiagonal en px).
  var FRENO_GIRO    = 5;
  var REBOTE        = 0.55;  // entre fichas: 0 se pegan, 1 choque perfecto
  var REBOTE_BORDE  = 0.45;
  var ROCE          = 0.12;  // roce entre fichas al chocar: un golpe de costado hace girar, sin trompos
  var VEL_MAX       = 2500;  // px/s: tope para todos, también después de un choque
  var GIRO_MAX      = 900;   // °/s
  var PASO          = 1 / 120;

  var PASO_MAX_PX   = 6;     // lo más que avanza el agarrado por paso: no saltea a nadie
  var GIRO_MAX_PASO = .06;   // ídem para el giro, en radianes
  var ITERACIONES   = 4;     // pasadas de choques por paso: hasta que nadie quede encimado
  var MASA_AGARRADO = 2;     // el que arrastrás pesa el doble: empuja con naturalidad
  var GOLPE_MIN     = 150;   // px/s: por debajo, el agarrado empuja sin golpear
  var PASOS_MAX     = 24;    // tope de pasos por cuadro

  var fisica = { raf: 0, last: 0, movidos: {} };

  function reducido() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function juega(t) {
    return t.el.classList.contains("is-ready") && !t.el.classList.contains("is-filtered-out");
  }

  /* Velocidad del puntero en los últimos ~80 ms. Si se quedó quieto antes de
     soltar, es cero: soltar sin tirar no lanza nada. */
  function velArrastre() {
    var cero = { x: 0, y: 0, r: 0 };
    var m = drag && drag.muestras;
    if (!m || m.length < 2) return cero;
    var ult = m[m.length - 1];
    if (performance.now() - ult.t > 60) return cero;
    var pri = ult;
    for (var i = m.length - 2; i >= 0 && ult.t - m[i].t <= 80; i--) pri = m[i];
    if (pri === ult) return cero;
    var dt = Math.max((ult.t - pri.t) / 1000, 0.008);
    var vx = (ult.x - pri.x) / dt, vy = (ult.y - pri.y) / dt;
    var v = Math.sqrt(vx * vx + vy * vy);
    if (v > VEL_MAX) { vx *= VEL_MAX / v; vy *= VEL_MAX / v; }
    return { x: vx, y: vy, r: clamp((ult.r - pri.r) / dt, -GIRO_MAX, GIRO_MAX) };
  }

  function cuerpo(t, s) {
    var a = t.rot * Math.PI / 180;
    var hw = (t.pw || 100) / 2, hh = (t.ph || 100) / 2;
    var m = (4 * hw * hh) / 10000;                 // la masa va con el área
    var agarrado = !!(drag && drag.t === t);
    var b = {
      t: t, x: t.x * s.w, y: t.y * s.h, a: a, c: Math.cos(a), s: Math.sin(a),
      hw: hw, hh: hh,
      vx: t.vx || 0, vy: t.vy || 0, w: (t.va || 0) * Math.PI / 180,
      im: agarrado ? 1 / (m * MASA_AGARRADO) : 1 / m,
      // el agarrado no gira por los choques: su giro lo manda la mano
      ii: agarrado ? 0 : 12 / (m * (4 * hw * hw + 4 * hh * hh)),
      agarrado: agarrado,
      activo: agarrado || !!t.despierto,
      fijo: false,
      tocado: false,
      sucio: true,
      locales: piezasLocales(t, hw, hh),
      rad: Math.sqrt(hw * hw + hh * hh)
    };
    if (agarrado) {
      // adónde quiere llevarlo la mano
      b.ox = drag.objX * s.w;
      b.oy = drag.objY * s.h;
      b.oa = drag.objRot * Math.PI / 180;
      b.vx = 0; b.vy = 0; b.w = 0;
      // qué tan rápido va la mano (suavizado): el agarrado nunca golpea más fuerte
      var vm = velArrastre();
      b.vMano = Math.sqrt(vm.x * vm.x + vm.y * vm.y);
      b.wMano = Math.abs(vm.r) * Math.PI / 180;
    }
    return b;
  }

  /* ---- forma de choque ----
     Sale sola de la transparencia de la imagen del token, al cargarla: nadie
     la mide a mano. La imagen se parte en una grilla de GRILLA × GRILLA y cada
     casillero con dibujo aporta el polígono convexo que lo envuelve. Así la
     forma sigue las entradas del dibujo (un rectángulo o un solo polígono
     convexo taparían los huecos). Coordenadas 0–1 de la imagen.
     Si no se pueden leer los píxeles (imagen de otro dominio) o no hay imagen,
     queda null y el token choca como rectángulo. */
  var GRILLA = 6;
  var RECTANGULO = [[[0, 0], [1, 0], [1, 1], [0, 1]]];

  function casco(P) {
    P.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop();
      lo.push(P[i]);
    }
    for (i = P.length - 1; i >= 0; i--) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop();
      up.push(P[i]);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  var MACIZO = 0.78;   // cuánto de su contorno convexo tiene que llenar un dibujo para chocar como una sola pieza

  function formaDeImagen(img) {
    var W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) return null;
    // una imagen grande se lee achicada: para la forma alcanza y sobra
    var k = Math.min(1, 240 / Math.max(W, H));
    var w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    var d;
    try {
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var g = cv.getContext("2d");
      g.drawImage(img, 0, 0, w, h);
      d = g.getImageData(0, 0, w, h).data;
    } catch (e) { return null; }

    /* Dibujo macizo (disco, escudo, cuadrado redondeado: casi igual a su
       contorno convexo): una sola pieza, ese contorno. Con la grilla, sus
       celdas interiores son cuadrados perfectos que al encimarse empujan
       sólo en horizontal o vertical, cambian de dirección de un cuadro al
       otro, y el choque vibra y deja tokens metidos uno en otro. */
    var todos = [], llenos = 0;
    for (var yy = 0; yy < h; yy++) {
      var i0 = -1, i1 = -1;
      for (var xx = 0; xx < w; xx++) {
        if (d[(yy * w + xx) * 4 + 3] > 40) { llenos++; if (i0 < 0) i0 = xx; i1 = xx; }
      }
      if (i0 >= 0) todos.push([i0, yy], [i1 + 1, yy], [i0, yy + 1], [i1 + 1, yy + 1]);
    }
    if (todos.length >= 8) {
      var contorno = casco(todos);
      var area = 0;
      for (var q = 0; q < contorno.length; q++) {
        var p1 = contorno[q], p2 = contorno[(q + 1) % contorno.length];
        area += p1[0] * p2[1] - p2[0] * p1[1];
      }
      area = Math.abs(area) / 2;
      if (contorno.length >= 3 && area > 0 && llenos / area >= MACIZO) {
        return [contorno.map(function (p) { return [p[0] / w, p[1] / h]; })];
      }
    }

    var piezas = [];
    for (var gy = 0; gy < GRILLA; gy++) {
      for (var gx = 0; gx < GRILLA; gx++) {
        var xa = Math.floor(gx * w / GRILLA), xb = Math.floor((gx + 1) * w / GRILLA);
        var ya = Math.floor(gy * h / GRILLA), yb = Math.floor((gy + 1) * h / GRILLA);
        var pts = [];
        // por fila alcanza con el primer y el último píxel con dibujo
        for (var y = ya; y < yb; y++) {
          var izq = -1, der = -1;
          for (var x = xa; x < xb; x++) {
            if (d[(y * w + x) * 4 + 3] > 40) { if (izq < 0) izq = x; der = x; }
          }
          if (izq >= 0) pts.push([izq, y], [der + 1, y], [izq, y + 1], [der + 1, y + 1]);
        }
        if (pts.length < 8) continue;
        var cs = casco(pts);
        if (cs.length >= 3) piezas.push(cs.map(function (p) { return [p[0] / w, p[1] / h]; }));
      }
    }
    return piezas.length ? piezas : null;
  }

  /* Piezas en coordenadas del token (px, centradas), con su círculo envolvente
     para descartar rápido los pares que ni se acercan. */
  function piezasLocales(t, hw, hh) {
    var llave = hw + "x" + hh + (t.forma ? "f" : "r");
    if (t.locales && t.localesLlave === llave) return t.locales;
    t.localesLlave = llave;
    return (t.locales = (t.forma || RECTANGULO).map(function (pz) {
      var v = pz.map(function (p) { return [(p[0] - 0.5) * 2 * hw, (p[1] - 0.5) * 2 * hh]; });
      var cx = 0, cy = 0, r = 0;
      v.forEach(function (p) { cx += p[0]; cy += p[1]; });
      cx /= v.length; cy /= v.length;
      v.forEach(function (p) { r = Math.max(r, Math.sqrt((p[0] - cx) * (p[0] - cx) + (p[1] - cy) * (p[1] - cy))); });
      return { v: v, cx: cx, cy: cy, r: r };
    }));
  }

  /* Las piezas en coordenadas de la superficie; se recalculan sólo si el
     cuerpo se movió desde la última vez. */
  function mundo(b) {
    if (!b.sucio && b.mundo) return b.mundo;
    b.mundo = b.locales.map(function (pz) {
      return {
        v: pz.v.map(function (p) {
          return [b.x + b.c * p[0] - b.s * p[1], b.y + b.s * p[0] + b.c * p[1]];
        }),
        cx: b.x + b.c * pz.cx - b.s * pz.cy,
        cy: b.y + b.s * pz.cx + b.c * pz.cy,
        r: pz.r
      };
    });
    b.sucio = false;
    return b.mundo;
  }

  function proyectar(v, nx, ny) {
    var mn = Infinity, mx = -Infinity;
    for (var i = 0; i < v.length; i++) {
      var p = v[i][0] * nx + v[i][1] * ny;
      if (p < mn) mn = p;
      if (p > mx) mx = p;
    }
    return [mn, mx];
  }

  /* Ejes separadores entre dos polígonos convexos: normal (de P hacia Q) y
     cuánto se encimaron; null si no se tocan. */
  function satPiezas(P, Q, aire) {
    var mejor = Infinity, nx = 0, ny = 0;
    var listas = [P.v, Q.v];
    for (var l = 0; l < 2; l++) {
      var v = listas[l];
      for (var i = 0; i < v.length; i++) {
        var a = v[i], b = v[(i + 1) % v.length];
        var ex = -(b[1] - a[1]), ey = b[0] - a[0];
        var len = Math.sqrt(ex * ex + ey * ey);
        if (len < 1e-9) continue;
        ex /= len; ey /= len;
        var pp = proyectar(P.v, ex, ey), pq = proyectar(Q.v, ex, ey);
        var o = Math.min(pp[1] - pq[0], pq[1] - pp[0]) + (aire || 0);
        if (o <= 0) return null;
        if (o < mejor) { mejor = o; nx = ex; ny = ey; }
      }
    }
    if ((Q.cx - P.cx) * nx + (Q.cy - P.cy) * ny < 0) { nx = -nx; ny = -ny; }
    return { nx: nx, ny: ny, o: mejor };
  }

  function dentroDe(v, px, py) {
    var signo = 0;
    for (var i = 0; i < v.length; i++) {
      var a = v[i], b = v[(i + 1) % v.length];
      var c = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
      if (Math.abs(c) < 1e-9) continue;
      var s = c > 0 ? 1 : -1;
      if (!signo) signo = s;
      else if (s !== signo) return false;
    }
    return true;
  }

  /* Choque entre dos tokens: el par de piezas más encimado manda la normal y
     el punto de contacto. Devuelve la normal (de A hacia B), cuánto se
     encimaron y el punto; null si no se tocan. */
  function choque(A, B, aire) {
    aire = aire || 0;   // separación que cuenta como choque (sólo al acomodar)
    var dx = B.x - A.x, dy = B.y - A.y, rr = A.rad + B.rad + aire;
    if (dx * dx + dy * dy > rr * rr) return null;
    var pa = mundo(A), pb = mundo(B), mejor = null, P = null, Q = null;
    for (var i = 0; i < pa.length; i++) {
      for (var j = 0; j < pb.length; j++) {
        var ddx = pb[j].cx - pa[i].cx, ddy = pb[j].cy - pa[i].cy, r = pa[i].r + pb[j].r + aire;
        if (ddx * ddx + ddy * ddy > r * r) continue;
        var k = satPiezas(pa[i], pb[j], aire);
        if (k && (!mejor || k.o > mejor.o)) { mejor = k; P = pa[i]; Q = pb[j]; }
      }
    }
    if (!mejor) return null;
    // contacto: los vértices de cada pieza que quedaron dentro de la otra
    var px = 0, py = 0, n = 0;
    Q.v.forEach(function (p) { if (dentroDe(P.v, p[0], p[1])) { px += p[0]; py += p[1]; n++; } });
    P.v.forEach(function (p) { if (dentroDe(Q.v, p[0], p[1])) { px += p[0]; py += p[1]; n++; } });
    if (n) { px /= n; py /= n; }
    else { px = (P.cx + Q.cx) / 2; py = (P.cy + Q.cy) / 2; }
    mejor.px = px; mejor.py = py;
    return mejor;
  }

  /* Masa efectiva en este paso: lo que quedó contra el borde no se mueve más,
     así el que empuja se frena en el límite en vez de meterse adentro. */
  function imDe(b) { return b.fijo ? 0 : b.im; }
  function iiDe(b) { return b.fijo ? 0 : b.ii; }

  function impulso(A, B, jx, jy, rax, ray, rbx, rby) {
    var ia = imDe(A), ib = imDe(B), ja = iiDe(A), jb = iiDe(B);
    A.vx -= jx * ia; A.vy -= jy * ia; A.w -= (rax * jy - ray * jx) * ja;
    B.vx += jx * ib; B.vy += jy * ib; B.w += (rbx * jy - rby * jx) * jb;
  }

  function resolver(A, B, k, conImpulso) {
    var ia = imDe(A), ib = imDe(B);
    var sumIm = ia + ib;
    if (!sumIm) return;
    var nx = k.nx, ny = k.ny;
    var rax = k.px - A.x, ray = k.py - A.y, rbx = k.px - B.x, rby = k.py - B.y;
    // velocidad relativa en el punto de contacto, contando el giro de cada uno
    var rvx = (B.vx - B.w * rby) - (A.vx - A.w * ray);
    var rvy = (B.vy + B.w * rbx) - (A.vy + A.w * rax);
    var vn = rvx * nx + rvy * ny;
    // con el agarrado, un empujón lento sólo desplaza: nada de dejarlo patinando
    var lento = (A.agarrado || B.agarrado) && vn > -GOLPE_MIN;
    if (conImpulso && vn < 0 && !lento) {
      var ja = iiDe(A), jb = iiDe(B);
      var ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx;
      var e = vn > -30 ? 0 : REBOTE;               // apoyados no rebotan: no tiemblan
      var j = -(1 + e) * vn / (sumIm + ran * ran * ja + rbn * rbn * jb);
      impulso(A, B, nx * j, ny * j, rax, ray, rbx, rby);
      // roce en el contacto: un golpe de costado las hace girar
      var tx = rvx - vn * nx, ty = rvy - vn * ny;
      var tl = Math.sqrt(tx * tx + ty * ty);
      if (tl > 1e-6) {
        tx /= tl; ty /= tl;
        var rat = rax * ty - ray * tx, rbt = rbx * ty - rby * tx;
        var jt = -(rvx * tx + rvy * ty) / (sumIm + rat * rat * ja + rbt * rbt * jb);
        jt = clamp(jt, -ROCE * j, ROCE * j);
        impulso(A, B, tx * jt, ty * jt, rax, ray, rbx, rby);
      }
    }
    // despegarlos del todo: el más pesado se corre menos; lo fijo no se corre
    var c = Math.max(k.o - 0.3, 0) / sumIm;
    A.x -= nx * c * ia; A.y -= ny * c * ia;
    B.x += nx * c * ib; B.y += ny * c * ib;
    if (ia) { A.tocado = true; A.sucio = true; }
    if (ib) { B.tocado = true; B.sucio = true; }
  }

  /* Un token quieto que recibe un golpe o un empujón se suma al juego. */
  function despertar(b) {
    b.activo = true;
    b.t.despierto = true;
  }

  /* Bordes: el mismo margen que al arrastrar (el centro puede llegar hasta el
     35% del lado menor de la caja), para que no haya saltos al soltar. */
  function borde(b, s) {
    var ex = Math.abs(b.c) * b.hw + Math.abs(b.s) * b.hh;
    var ey = Math.abs(b.s) * b.hw + Math.abs(b.c) * b.hh;
    var m = 0.7 * Math.min(ex, ey);
    // contra el borde: rebota si viene rápido; si no, se queda apoyado quieto
    function rebote(v) { return Math.abs(v) < 60 ? 0 : -v * REBOTE_BORDE; }
    var toco = false;
    if (b.x < m)            { b.x = m;       if (b.vx < 0) b.vx = rebote(b.vx); toco = true; }
    else if (b.x > s.w - m) { b.x = s.w - m; if (b.vx > 0) b.vx = rebote(b.vx); toco = true; }
    if (b.y < m)            { b.y = m;       if (b.vy < 0) b.vy = rebote(b.vy); toco = true; }
    else if (b.y > s.piso - m) { b.y = s.piso - m; if (b.vy > 0) b.vy = rebote(b.vy); toco = true; }
    if (toco) { b.fijo = true; b.sucio = true; b.tocado = true; }
    return toco;
  }

  function topeVelocidad(b) {
    var v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (v > VEL_MAX) { b.vx *= VEL_MAX / v; b.vy *= VEL_MAX / v; }
    var wMax = GIRO_MAX * Math.PI / 180;
    if (Math.abs(b.w) > wMax) b.w = b.w > 0 ? wMax : -wMax;
  }

  function paso(cs, dt, s, red) {
    cs.forEach(function (b) {
      b.fijo = false;
      if (b.agarrado) {
        // persigue a la mano, de a poco: nunca saltea a nadie
        var dx = b.ox - b.x, dy = b.oy - b.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > PASO_MAX_PX) { dx *= PASO_MAX_PX / d; dy *= PASO_MAX_PX / d; }
        var da = clamp(b.oa - b.a, -GIRO_MAX_PASO, GIRO_MAX_PASO);
        b.x += dx; b.y += dy; b.a += da;
        // Su velocidad para golpear: la de este paso, pero nunca más que la de la
        // mano. Antes era sólo "paso ÷ duración del paso": cuando la mano iba
        // lejos los pasos duraban fracciones de milisegundo y se disparaba
        // (medido: mano a 1500 px/s, golpe a más de 4900 px/s). Si está
        // frenado contra algo, avanza poco y golpea poco.
        var avance = Math.sqrt(dx * dx + dy * dy);
        var rapidez = Math.min(avance / dt, b.vMano);
        b.vx = avance ? dx / avance * rapidez : 0;
        b.vy = avance ? dy / avance * rapidez : 0;
        b.w = da ? (da > 0 ? 1 : -1) * Math.min(Math.abs(da) / dt, b.wMano) : 0;
        topeVelocidad(b);
        b.c = Math.cos(b.a); b.s = Math.sin(b.a);
        b.tocado = true; b.sucio = true;
        return;
      }
      if (!b.activo) return;
      var v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (v > 0) {
        var nv = Math.max(0, v - (FRICCION + ARRASTRE * v) * dt);
        b.vx *= nv / v; b.vy *= nv / v;
      }
      var fw = FRENO_GIRO * FRICCION / Math.sqrt(b.hw * b.hw + b.hh * b.hh) * dt;
      b.w = Math.abs(b.w) <= fw ? 0 : b.w - (b.w > 0 ? fw : -fw);
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.w * dt;
      b.c = Math.cos(b.a); b.s = Math.sin(b.a);
      b.tocado = true;
      b.sucio = true;
    });

    // Varias pasadas: despegar a dos puede meter a uno en un tercero, o contra
    // el borde. Se repite hasta que nadie queda encimado. Lo que toca el borde
    // pasa a fijo, y entonces el que empuja es el que se corre.
    for (var it = 0; it < ITERACIONES; it++) {
      var hubo = false;
      for (var i = 0; i < cs.length; i++) {
        for (var j = i + 1; j < cs.length; j++) {
          var A = cs[i], B = cs[j];
          if (!A.activo && !B.activo) continue;
          var k = choque(A, B);
          if (!k) continue;
          hubo = true;
          if (!A.activo) despertar(A);
          if (!B.activo) despertar(B);
          resolver(A, B, k, it === 0);
        }
      }
      cs.forEach(function (b) { if (b.activo) borde(b, s); });
      if (!hubo) break;
    }

    cs.forEach(function (b) {
      if (b.agarrado || !b.activo) return;
      if (red) { b.vx = 0; b.vy = 0; b.w = 0; }
      topeVelocidad(b);   // ningún choque lanza a nadie más rápido que el tope
      if (b.vx * b.vx + b.vy * b.vy < 16 && Math.abs(b.w) < 0.05) {
        b.vx = 0; b.vy = 0; b.w = 0;
        b.activo = false;
        b.t.despierto = false;
      }
    });
  }

  function tick(now) {
    fisica.raf = 0;
    var s = stageSize();
    var dt = Math.min(0.05, (now - (fisica.last || now)) / 1000);
    fisica.last = now;
    var red = reducido();
    var cs = tokens.filter(juega).map(function (t) { return cuerpo(t, s); });

    // Pasos: los de siempre y, si la mano va lejos, los que hagan falta para
    // que el agarrado la alcance sin saltar más de PASO_MAX_PX por vez.
    var n = Math.ceil(dt / PASO);
    cs.forEach(function (b) {
      if (!b.agarrado) return;
      var d = Math.sqrt((b.ox - b.x) * (b.ox - b.x) + (b.oy - b.y) * (b.oy - b.y));
      n = Math.max(n, Math.ceil(d / PASO_MAX_PX), Math.ceil(Math.abs(b.oa - b.a) / GIRO_MAX_PASO));
    });
    n = Math.min(PASOS_MAX, n);
    var agarrado = cs.filter(function (b) { return b.agarrado; })[0];
    var x0 = agarrado ? agarrado.x : 0, y0 = agarrado ? agarrado.y : 0;
    for (var i = 0; i < n && dt > 0; i++) paso(cs, dt / n, s, red);
    // Lo que de verdad avanzó el agarrado en este cuadro: con eso se suelta si
    // venía frenado. (La del último micro-paso servía mal: muchas veces el token
    // ya había alcanzado a la mano dentro del cuadro y daba casi cero.)
    if (agarrado && dt > 0) {
      agarrado.vx = (agarrado.x - x0) / dt;
      agarrado.vy = (agarrado.y - y0) / dt;
      topeVelocidad(agarrado);
    }

    var sigue = !!drag;
    cs.forEach(function (b) {
      var t = b.t;
      t.vx = b.vx; t.vy = b.vy; t.va = b.w * 180 / Math.PI;
      if (b.tocado) {
        t.x = b.x / s.w; t.y = b.y / s.h; t.rot = b.a * 180 / Math.PI;
        place(t);
        if (!b.agarrado) fisica.movidos[t.p.id] = t;
      }
      if (b.activo) sigue = true;
    });

    if (sigue) fisica.raf = window.requestAnimationFrame(tick);
    else terminarFisica();
  }

  /* Separa a los que quedaron encimados sin que nadie los moviera: al cargar
     (según el tamaño de pantalla pueden pisarse), al cambiar el tamaño de la
     ventana, al reordenar. Sin animación: aparecen ya separados. No se guarda:
     depende de la pantalla y se vuelve a calcular cada vez.
     Los que siguen en su lugar de entrada quedan a AIRE_INICIAL uno de otro;
     en el juego, en cambio, chocan y se tocan. */
  var AIRE_INICIAL = 7;   // px

  function separarEncimados() {
    if (drag) return;
    var s = stageSize();
    var cs = tokens.filter(juega).map(function (t) { return cuerpo(t, s); });
    var movio = false;
    for (var it = 0; it < 200; it++) {
      var hubo = false;
      cs.forEach(function (b) { b.fijo = false; });
      for (var i = 0; i < cs.length; i++) {
        for (var j = i + 1; j < cs.length; j++) {
          // dos que están donde van de entrada guardan aire entre sí; si el
          // visitante movió alguno, alcanza con que no se encimen
          var inicial = !saved[cs[i].t.p.id] && !saved[cs[j].t.p.id];
          var k = choque(cs[i], cs[j], inicial ? AIRE_INICIAL + 0.3 : 0);   // resolver deja 0,3 de más
          if (!k) continue;
          hubo = true;
          resolver(cs[i], cs[j], k, false);
        }
      }
      cs.forEach(function (b) { borde(b, s); });
      if (!hubo) break;
      movio = true;
    }
    if (!movio) return;
    cs.forEach(function (b) {
      if (!b.tocado) return;
      b.t.x = b.x / s.w; b.t.y = b.y / s.h;
      place(b.t);
    });
  }

  var separarPendiente = 0;
  function separarPronto() {
    window.clearTimeout(separarPendiente);
    separarPendiente = window.setTimeout(separarEncimados, 60);
  }

  function correrFisica() {
    if (fisica.raf) return;
    fisica.last = 0;
    fisica.raf = window.requestAnimationFrame(tick);
  }

  /* Cuando todo quedó quieto se guardan las posiciones de todo lo que se movió,
     no sólo del token que se tiró. */
  function terminarFisica() {
    var ids = Object.keys(fisica.movidos);
    ids.forEach(function (id) {
      var t = fisica.movidos[id];
      saved[id] = { x: t.x, y: t.y, rotation: Math.round(t.rot * 10) / 10 };
    });
    fisica.movidos = {};
    if (ids.length) writeStore();
  }

  function frenar(t) {
    t.vx = 0; t.vy = 0; t.va = 0;
    t.despierto = false;
  }

  /* ---------------- hover ----------------
     Un solo lugar decide qué token está bajo el cursor, a partir de dónde
     está el puntero de verdad, y los efectos se prenden y apagan una sola
     vez por cambio. Antes cada token escuchaba su pointerenter/pointerleave:
     con el baile (o cualquier cosa que se anime bajo un cursor quieto) el
     navegador repetía pointerenter en cada cuadro y a veces nunca mandaba el
     pointerleave, y el token quedaba "seleccionado" (líneas, baile, tinta). */
  var bajoCursor = null;

  function tokenDe(nodo) {
    var el = nodo && nodo.closest ? nodo.closest(".token") : null;
    return (el && el._token) || null;
  }

  function hoverA(t) {
    if (t === bajoCursor) return;
    // el que se está arrastrando no suelta el hover hasta soltarlo
    if (drag && bajoCursor && drag.t === bajoCursor) return;
    var antes = bajoCursor;
    bajoCursor = t;
    if (antes) salirHover(antes);
    if (t) entrarHover(t);
  }

  document.addEventListener("pointerover", function (e) { hoverA(tokenDe(e.target)); });
  document.addEventListener("pointermove", function (e) { hoverA(tokenDe(e.target)); }, { passive: true });
  // el puntero se fue de la ventana (o se levantó el dedo)
  document.addEventListener("pointerout", function (e) { if (!e.relatedTarget) hoverA(null); });

  function entrarHover(t) {
    var el = t.el;
    el.classList.add("is-hover");
    if (t.lottie) lottieEntrar(t);
      if (t.baile && !el.classList.contains("is-active")) bailar(t, 1);
      if (t.trazos) trazar(t, 1);
      if (t.video) {
        try { t.video.currentTime = 0; var pr = t.video.play(); if (pr) pr.catch(function () {}); }
        catch (e) {}
      }
      reiniciarAnimada(t);
      // ni se empiezan si el token ya está agarrado
      if (t.scribble && !el.classList.contains("is-active")) dibujarRayones(t);
      if (t.wc && !el.classList.contains("is-active")) pintarAcuarela(t);
  }

  function salirHover(t) {
    var el = t.el;
    el.classList.remove("is-hover");
      if (t.wc) secarAcuarela(t);   // se retira por donde vino
      if (t.scribble) borrarRayones(t);   // se des-dibujan al revés
      if (t.lottie) lottieSalir(t);
      if (t.baile) bailar(t, 0);
      if (t.trazos) trazar(t, 0);
      if (t.video) { try { t.video.pause(); t.video.currentTime = 0; } catch (e) {} }
  }

  function bind(t) {
    var el = t.el;
    el._token = t;

    // Un clic abre el proyecto (lo resuelve onUp: soltarlo sin haberlo movido).
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openProject(t.p.id);
      }
    });
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      if (window.ProjectView.recienCerrado()) return;
      hoverA(t);   // agarrado es, además, el token bajo el cursor
      // Es un efecto de hover: en cuanto se agarra el token, se cortan.
      if (t.scribble) cortarRayones(t);
      if (t.baile) bailar(t, 0);          // agarrarlo lo baja
      if (t.wc) borrarAcuarela(t);
      toFront(t);
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add("is-active", "is-hover");

      var r = rect(t);
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var rotating = inRotateZone(t, e.clientX, e.clientY) || e.shiftKey || e.altKey;

      drag = {
        t: t,
        id: e.pointerId,
        mode: rotating ? "rotate" : "move",
        startX: e.clientX,
        startY: e.clientY,
        inicio: performance.now(),
        offX: e.clientX - cx,
        offY: e.clientY - cy,
        startRot: t.rot,
        startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
        moved: false,
        muestras: [],
        // adónde lo quiere llevar la mano; la física lo acerca de a poco
        objX: t.x,
        objY: t.y,
        objRot: t.rot
      };

      frenar(t);   // agarrarlo lo frena
      correrFisica();

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();

      if (!drag.moved) {
        var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) drag.moved = true;
      }

      var s = stageSize();
      var sr = stage.getBoundingClientRect();

      if (drag.mode === "move") {
        var cx = e.clientX - drag.offX - sr.left;
        var cy = e.clientY - drag.offY - sr.top;
        var r = rect(t);
        var mx = Math.min(r.width, r.height) * 0.35;
        drag.objX = clamp(cx, mx, s.w - mx) / s.w;
        drag.objY = clamp(cy, mx, s.piso - mx) / s.h;
      } else {
        var rr = rect(t);
        var ccx = rr.left + rr.width / 2;
        var ccy = rr.top + rr.height / 2;
        var ang = Math.atan2(e.clientY - ccy, e.clientX - ccx) * 180 / Math.PI;
        var next = drag.startRot + (ang - drag.startAngle);
        if (e.shiftKey) next = Math.round(next / 15) * 15;      // imán cada 15°
        drag.objRot = Math.round(next * 10) / 10;
      }
      // no se dibuja acá: la física lo lleva hacia la mano sin atravesar a nadie
      correrFisica();
      drag.muestras.push({ x: drag.objX * s.w, y: drag.objY * s.h, r: drag.objRot, t: performance.now() });
      if (drag.muestras.length > 12) drag.muestras.shift();
    }

    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture(drag.id); } catch (err) {}

      if (drag.moved) {
        saved[t.p.id] = { x: t.x, y: t.y, rotation: t.rot };
        writeStore();
        // soltarlo con velocidad lo deja deslizando. Si estaba frenado contra
        // algo (lejos de la mano), se suelta con lo que de verdad se movía.
        if (!reducido()) {
          // Sale con la velocidad de la mano, salvo que el token avanzara menos
          // (frenado contra algo): entonces con lo que de verdad avanzaba.
          var v = velArrastre();
          var mano = Math.sqrt(v.x * v.x + v.y * v.y);
          var real = Math.sqrt((t.vx || 0) * (t.vx || 0) + (t.vy || 0) * (t.vy || 0));
          if (real < mano) { v.x *= real / mano; v.y *= real / mano; }
          t.vx = v.x; t.vy = v.y;
          t.va = drag.mode === "rotate" ? v.r : 0;
          t.despierto = true;
          correrFisica();
        }
      }

      // Clic: se soltó sin moverlo, enseguida, y el gesto no lo canceló el
      // navegador (pointercancel también llega acá). Mouse, dedo y lápiz igual.
      var esClic = !drag.moved && e.type === "pointerup" &&
                   performance.now() - drag.inicio < CLICK_MAX_MS;

      drag = null;
      // Sólo lo deja agarrado si en este tiempo lo volvieron a agarrar a ÉL.
      // Antes miraba si había algún arrastre, de cualquier token: agarrar otro
      // dentro de los 400 ms dejaba a este marcado para siempre, arriba de
      // todo y sin efectos de hover.
      window.setTimeout(function () {
        if (!drag || drag.t !== t) el.classList.remove("is-active");
      }, 400);
      // si al soltarlo el cursor ya no está sobre él (quedó atrás, frenado
      // contra otro), el hover pasa a lo que haya de verdad bajo el cursor,
      // apagando sus efectos como corresponde
      hoverA(tokenDe(document.elementFromPoint(e.clientX, e.clientY)));

      // se abre al final, con el arrastre ya cerrado del todo
      if (esClic) openProject(t.p.id);
    }
  }

  /* ---------------- ruteo ---------------- */

  /* Busca por id y, si no, por los nombres que tuvo antes (aliases): cuando
     se renombra un proyecto desde el panel, los links viejos siguen andando. */
  function findProject(id) {
    if (!data) return null;
    var i, p;
    for (i = 0; i < data.projects.length; i++) {
      if (data.projects[i].id === id) return data.projects[i];
    }
    for (i = 0; i < data.projects.length; i++) {
      p = data.projects[i];
      if (Array.isArray(p.aliases) && p.aliases.indexOf(id) >= 0) return p;
    }
    return null;
  }

  var lastOrigin = null;   // rectángulo del token desde el que se maximiza

  function tokenRect(id) {
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].p.id !== id) continue;
      var r = tokens[i].el.getBoundingClientRect();
      // si quedó fuera de la pantalla no sirve como origen
      if (r.bottom < 0 || r.top > (window.innerHeight || 0)) return null;
      return r;
    }
    return null;
  }

  function openProject(id, skipHash) {
    var p = findProject(id);
    if (!p) return;
    lastOrigin = tokenRect(id);
    if (!skipHash) {
      if (location.hash !== "#/p/" + id) location.hash = "#/p/" + id;
      else window.ProjectView.open(p);
    } else {
      window.ProjectView.open(p);
    }
  }

  function closeProject() {
    // una ventana apilada: se cierra sólo esa. Se entró con un link (una
    // entrada nueva en el historial), así que se sale con "atrás".
    if (window.ProjectView.nivel() > 0) {
      history.back();
      return;
    }
    var id = window.ProjectView.currentId();
    if (location.hash) {
      // vuelve al estado anterior si vinimos de la superficie
      history.replaceState(null, "", location.pathname + location.search);
    }
    window.ProjectView.close(id ? tokenRect(id) : null);
  }

  /* ---------------- pasar de un proyecto a otro ----------------
     Se navega sobre lo que se está viendo: si hay filtros puestos, se pasa
     entre los proyectos que los pasan. Si el filtro deja uno solo, se navega
     sobre todos, que es lo único que tiene sentido. */

  /* Sólo las piezas de portfolio entran en el paso de proyectos: una
     subpágina o una página HTML no es destino ni punto de partida. */
  function listaNavegable() {
    if (!data || !Array.isArray(data.projects)) return [];
    return data.projects.filter(function (p) {
      return esPortfolio(p) && passes(p);
    });
  }

  /* La lista y en qué lugar de ella está lo que se está mirando. Fuera de la
     lista —un boletín, o algo que el filtro dejó afuera— el índice es -1 y los
     botones no tienen a dónde llevar. */
  function ubicacion() {
    var lista = listaNavegable();
    var id = window.ProjectView.currentId();
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) return { lista: lista, i: i };
    }
    return { lista: lista, i: -1 };
  }

  function vecino(paso) {
    var u = ubicacion();
    if (u.i < 0 || u.lista.length < 2) return null;
    return u.lista[(u.i + paso + u.lista.length) % u.lista.length];   // da la vuelta
  }

  function irAProyecto(paso) {
    var p = vecino(paso);
    if (!p) return;
    lastOrigin = tokenRect(p.id);
    // Se corrige la dirección sin disparar hashchange: la publicación ya está
    // abierta y no hay que volver a maximizarla desde el token.
    history.replaceState(null, "",
      location.pathname + location.search + "#/p/" + p.id);
    window.ProjectView.swap(p);
    actualizarNav();
  }

  /* Con un solo proyecto a la vista los botones no tienen a dónde llevar. */
  function actualizarNav() {
    var u = ubicacion();
    var hay = u.i >= 0 && u.lista.length > 1;
    var prev = document.getElementById("btnPrev");
    var next = document.getElementById("btnNext");
    if (prev) prev.hidden = !hay;
    if (next) next.hidden = !hay;
    // en celular las flechas viven en una franja al pie: sin flechas, no ocupa lugar
    document.getElementById("projectView").classList.toggle("tiene-nav", hay);
  }

  /* De página en página: un link a "#/p/…" desde una publicación abierta
     abre esa página en otra ventana flotante encima, que se agranda desde el
     link. La cruz, Esc o el "atrás" del navegador cierran sólo la de arriba. */
  var origenEnlace = null;
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href^="#/p/"]');
    if (a) origenEnlace = a.getBoundingClientRect();
  }, true);

  function syncFromHash() {
    var m = /^#\/p\/([A-Za-z0-9_-]+)$/.exec(location.hash || "");
    if (m) {
      var p = findProject(m[1]);
      if (p) {
        // entró por un nombre viejo: la dirección pasa a decir el actual
        if (p.id !== m[1]) {
          history.replaceState(null, "", location.pathname + location.search + "#/p/" + p.id);
        }
        var abierto = window.ProjectView.currentId();
        if (!abierto) {
          window.ProjectView.open(p, false, lastOrigin);
        } else if (abierto !== p.id) {
          // ya estaba más abajo en la pila: se volvió con "atrás"
          if (window.ProjectView.pila().indexOf(p.id) >= 0) window.ProjectView.cerrarHasta(p.id);
          else window.ProjectView.abrirCapa(p, origenEnlace || window.ProjectView.tomarOrigen());
        }
        origenEnlace = null;
        actualizarNav();
        return;
      }
    }
    window.ProjectView.close(lastOrigin);
  }

  /* ---------------- arranque ---------------- */

  /* El fondo general del sitio sale del panel. Lo que no esté cargado queda
     como está en el CSS, así el sitio nunca se queda sin fondo. */
  function applyBackground(bg) {
    if (!bg) return;
    var s = document.body.style;

    if (bg.color) s.backgroundColor = bg.color;

    if (typeof bg.image === "string") {
      var ruta = bg.image.trim();
      if (!ruta) s.backgroundImage = "none";
      // comillas y paréntesis fuera: romperían el url(...)
      else s.backgroundImage = 'url("' + ruta.replace(/["'()\\]/g, "") + '")';
    }

    if (bg.repeat) s.backgroundRepeat = bg.repeat;

    var medida = bg.size === "custom" ? (bg.sizeCustom || "") : bg.size;
    if (medida) s.backgroundSize = medida;

    var lugar = bg.position === "custom" ? (bg.positionCustom || "") : bg.position;
    if (lugar) s.backgroundPosition = lugar;

    if (bg.attachment) s.backgroundAttachment = bg.attachment;
  }

  /* Tema de los elementos que van sobre el fondo. Un solo atributo en <html>
     cambia el juego de colores entero; los valores viven en el CSS. */
  function applyUi(modo) {
    var tema = modo === "clear" ? "clear" : "dark";
    document.documentElement.setAttribute("data-ui", tema);
  }

  /* Sitio en mantenimiento (site.maintenance.on, desde el panel): en lugar
     de la superficie, un aviso centrado en el idioma del visitante. Quedan el
     fondo, la firma y el cambio de idioma; no se arma ningún token. Las
     páginas HTML de las carpetas (términos, etc.) siguen andando: no pasan
     por acá. */
  var MANT_TEXTO = {
    en: "Website under maintenance, check back soon! Sorry for the inconvenience.",
    es: "Sitio en mantenimiento, ¡volvé pronto! Disculpá las molestias."
  };

  function enMantenimiento(site) {
    return !!(site && site.maintenance && site.maintenance.on);
  }

  function mostrarMantenimiento(site) {
    var m = site.maintenance;
    var aviso = document.createElement("p");
    aviso.className = "mantenimiento";
    aviso.setAttribute("role", "status");
    document.body.appendChild(aviso);
    document.body.classList.add("en-mantenimiento");
    function pintar() {
      var lang = I18N.get();
      aviso.textContent = I18N.tx(m.message) || MANT_TEXTO[lang] || MANT_TEXTO.en;
      aviso.lang = lang;
      Array.prototype.forEach.call(
        document.querySelectorAll("#langSwitch [data-lang]"),
        function (b) { b.setAttribute("aria-pressed", String(b.dataset.lang === lang)); }
      );
    }
    I18N.onChange(pintar);
    pintar();
  }

  function applySite(site) {
    if (!site) return;
    applyBackground(site.background);
    applyUi(site.ui);
    if (site.title) document.title = site.title;
    var nameEl = document.getElementById("siteName");
    if (nameEl) {
      nameEl.textContent = site.title || "";
      if (site.showLabel === false) stageUi.style.display = "none";
    }
  }

  function render() {
    layer.innerHTML = "";
    tokens = conToken().map(buildToken);
    if (Object.keys(saved).length) stageUi.classList.add("is-dirty");
  }

  /* ---------------- filtros por hashtag ---------------- */

  var TAG_GROUPS = ["category", "industry"];
  var active = { category: [], industry: [] };

  function siteTags(group) {
    var t = (data && data.site && data.site.tags) || {};
    return Array.isArray(t[group]) ? t[group] : [];
  }

  function projectTags(p, group) {
    var t = p.tags || {};
    return Array.isArray(t[group]) ? t[group] : [];
  }

  /* Un proyecto pasa el filtro si coincide en cada grupo que tenga algo elegido.
     Dentro de un grupo alcanza con una coincidencia; entre grupos se suman. */
  function passes(p) {
    if (!esPortfolio(p)) return true;   // las páginas no se filtran: siempre a la vista
    return TAG_GROUPS.every(function (g) {
      if (!active[g].length) return true;
      var mine = projectTags(p, g);
      return active[g].some(function (id) { return mine.indexOf(id) >= 0; });
    });
  }

  function applyFilters() {
    tokens.forEach(function (t) {
      var fuera = !passes(t.p);
      t.el.classList.toggle("is-filtered-out", fuera);
      if (fuera) frenar(t);   // los filtrados no juegan
    });
    separarPronto();          // el que vuelve a jugar no puede quedar encimado
    actualizarNav();
    var any = TAG_GROUPS.some(function (g) { return active[g].length > 0; });
    var clear = document.getElementById("btnClearFilters");
    clear.hidden = !any;
    Array.prototype.forEach.call(
      document.querySelectorAll("#filters [data-tag]"),
      function (b) {
        b.setAttribute("aria-pressed",
          active[b.dataset.group].indexOf(b.dataset.tag) >= 0 ? "true" : "false");
      }
    );
  }

  function toggleTag(group, id) {
    var i = active[group].indexOf(id);
    if (i >= 0) active[group].splice(i, 1);
    else active[group].push(id);
    applyFilters();
  }

  /* Dibuja la barra: sólo aparecen los hashtags que algún proyecto usa. */
  function buildFilters() {
    var box = document.getElementById("filters");
    var shown = false;

    TAG_GROUPS.forEach(function (g) {
      var groupEl = box.querySelector('[data-group="' + g + '"]');
      var tagsEl = groupEl.querySelector(".filters__tags");
      tagsEl.innerHTML = "";

      var used = siteTags(g).filter(function (tag) {
        return data.projects.some(function (p) {
          return projectTags(p, g).indexOf(tag.id) >= 0;
        });
      });

      used.forEach(function (tag) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "stage-ui__btn";
        b.dataset.group = g;
        b.dataset.tag = tag.id;
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () { toggleTag(g, tag.id); });
        tagsEl.appendChild(b);
      });

      groupEl.hidden = used.length === 0;
      if (used.length) shown = true;

      // si un hashtag dejó de existir, se cae del filtro activo
      active[g] = active[g].filter(function (id) {
        return used.some(function (tag) { return tag.id === id; });
      });
    });

    box.hidden = !shown;
    labelFilters();
    applyFilters();
  }

  /* Nombres de los hashtags en el idioma actual. */
  function labelFilters() {
    TAG_GROUPS.forEach(function (g) {
      var groupEl = document.querySelector('#filters [data-group="' + g + '"]');
      if (!groupEl) return;
      var visibles = 0;
      Array.prototype.forEach.call(groupEl.querySelectorAll("[data-tag]"), function (b) {
        var tag = siteTags(g).filter(function (x) { return x.id === b.dataset.tag; })[0];
        var nombre = I18N.tx(tag);
        // sin nombre en este idioma el hashtag no aparece: nunca se muestra el
        // de otro idioma, ni el identificador interno
        b.hidden = !nombre;
        if (nombre) { b.textContent = "#" + nombre; visibles++; }
      });
      groupEl.hidden = visibles === 0;
    });
    document.getElementById("btnClearFilters").textContent = I18N.t("allTags");
  }

  /* ---------------- rayones de lapicera ----------------
     El token es un mapa de bits: no hay trazo que recorrer. Así que los trazos
     se inventan acá, como vectores, y por eso sí se pueden dibujar solos: se
     usa el truco clásico de la línea punteada, con la raya y el hueco del
     largo del trazo entero, corriendo el hueco hasta descubrirla.

     Cinco familias de garabato y un sorteo entre ellas. Cada hover trae tres a
     cinco trazos, escalonados, para que parezca que alguien está jugando
     arriba del dibujo. */

  var SVG_NS = "http://www.w3.org/2000/svg";

  function az(a, b) { return a + Math.random() * (b - a); }
  function elegir(lista) { return lista[Math.floor(Math.random() * lista.length)]; }
  function n1(v) { return Math.round(v * 10) / 10; }

  /* zigzag que cruza el dibujo de lado a lado */
  function gZigzag(w, h) {
    var pasos = Math.round(az(4, 8));
    var m = Math.min(w, h) * az(.02, .10);
    var amp = az(h * .22, h * .55);
    var y0 = az(m + amp * .5, h - m - amp * .5);
    var paso = (w - m * 2) / pasos;
    var x = m;
    var d = "M" + n1(x) + " " + n1(y0 + az(-amp, amp) * .4);
    for (var i = 0; i < pasos; i++) {
      var cx = x + paso * .5 + az(-paso * .25, paso * .25);
      var cy = y0 + (i % 2 ? -amp : amp) * az(.8, 1.25);
      x += paso;
      d += " Q" + n1(cx) + " " + n1(cy) + " " + n1(x) + " " + n1(y0 + az(-amp, amp) * .35);
    }
    return d;
  }

  /* cadena de bucles, como la "e" de la letra cursiva */
  function gBucles(w, h) {
    var n = Math.round(az(3, 6));
    var largo = w * az(.55, .9);
    var paso = largo / n;
    var r = paso * az(.55, .85);
    var x = az(w * .04, w - largo - w * .04);
    var y = az(h * .22, h * .78);
    var giro = Math.random() < .5 ? 1 : 0;
    var d = "M" + n1(x) + " " + n1(y);
    for (var i = 0; i < n; i++) {
      d += " a" + n1(r) + " " + n1(r * az(.8, 1.25)) + " 0 1 " + giro + " " + n1(paso) + " " + n1(az(-h * .05, h * .05));
    }
    return d;
  }

  /* una recta, con el pulso de una mano */
  function gRecta(w, h) {
    var x1 = az(0, w * .3), y1 = az(0, h);
    var x2 = az(w * .7, w),  y2 = az(0, h);
    var cx = (x1 + x2) / 2 + az(-w * .06, w * .06);
    var cy = (y1 + y2) / 2 + az(-h * .10, h * .10);
    return "M" + n1(x1) + " " + n1(y1) + " Q" + n1(cx) + " " + n1(cy) + " " + n1(x2) + " " + n1(y2);
  }

  /* un círculo dado a mano, que se pasa de largo al cerrar */
  function gCirculo(w, h) {
    var rx = az(w * .20, w * .42), ry = az(h * .20, h * .42);
    var cx = az(rx, w - rx), cy = az(ry, h - ry);
    var giro = Math.random() < .5 ? 1 : 0;
    var d = "M" + n1(cx - rx) + " " + n1(cy) +
            " a" + n1(rx) + " " + n1(ry) + " 0 1 " + giro + " " + n1(rx * 2) + " 0" +
            " a" + n1(rx) + " " + n1(ry) + " 0 1 " + giro + " " + n1(-rx * 2) + " 0";
    // el remate se pasa: nadie cierra un círculo justo donde lo empezó
    d += " q" + n1(rx * az(.1, .35)) + " " + n1(ry * az(-.4, -.1)) + " " +
         n1(rx * az(.3, .7)) + " " + n1(ry * az(-.25, .25));
    return d;
  }

  /* espiral de dos o tres vueltas */
  function gEspiral(w, h) {
    var cx = az(w * .25, w * .75), cy = az(h * .25, h * .75);
    var vueltas = az(1.8, 3.2);
    var rMax = Math.min(w, h) * az(.22, .42);
    var pasos = Math.round(vueltas * 14);
    var d = "M" + n1(cx) + " " + n1(cy);
    for (var i = 1; i <= pasos; i++) {
      var k = i / pasos;
      var ang = k * vueltas * Math.PI * 2;
      var r = rMax * k;
      d += " L" + n1(cx + Math.cos(ang) * r) + " " + n1(cy + Math.sin(ang) * r * az(.85, 1.15));
    }
    return d;
  }

  var GARABATOS = [gZigzag, gBucles, gRecta, gCirculo, gEspiral];

  /* ---------------- mancha de acuarela ----------------
     Se pinta en un canvas, como una acuarela de verdad y no como un círculo
     húmedo:
     - Cada mancha es una pila de decenas de capas casi transparentes del mismo
       polígono, deformado distinto en cada capa. El borde queda blando e
       irregular, con más pigmento de un lado que del otro. Las tintas se
       cruzan multiplicando, como pigmento.
     - En tramos del filo se junta más color (el agua lo arrastra al secarse).
     - Burbujas de sal que levantan el pigmento y lo empujan a su borde,
       floraciones, granulado del papel y alguna salpicadura suelta.
     - A veces, una pincelada que rodea al token, cargada al empezar, que se
       extingue en cerdas secas.
     Todo al azar en cada hover, pero siempre alrededor del token.
     Después se "moja" el papel: cada píxel tiene un momento de llegada (la
     distancia a su origen, torcida con ruido, como papel que absorbe) y la
     mancha aparece siguiendo ese mapa. Al salir el cursor corre al revés.
     watercolor.layer: "over" mancha el dibujo; "under" va por detrás. */

  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 2; }

  /* ruido de valor 2D, suave; uno nuevo por mancha */
  function nuevoRuido() {
    var perm = [], i;
    for (i = 0; i < 256; i++) perm[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), tmp = perm[i];
      perm[i] = perm[j]; perm[j] = tmp;
    }
    function h(x, y) { return perm[(perm[x & 255] + y) & 255] / 255; }
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }

  /* Parte cada lado en dos y corre el punto medio al azar. Cada vértice trae
     su propia "rebeldía" (p[2]): así hay tramos del borde lisos y otros
     deshilachados, que es lo que hace el papel. */
  function deformar(pts, pasadas, fuerza) {
    for (var d = 0; d < pasadas; d++) {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        var dx = b[0] - a[0], dy = b[1] - a[1];
        var len = Math.sqrt(dx * dx + dy * dy);
        var v = (a[2] + b[2]) / 2;
        out.push(a);
        out.push([
          (a[0] + b[0]) / 2 + gauss() * len * fuerza * v,
          (a[1] + b[1]) / 2 + gauss() * len * fuerza * v,
          Math.min(1.4, Math.max(.1, v * az(.7, 1.3)))
        ]);
      }
      pts = out;
    }
    return pts;
  }

  function contornoMancha(cx, cy, rx, ry) {
    var n = Math.round(az(7, 11)), rot = az(0, Math.PI), pts = [];
    for (var i = 0; i < n; i++) {
      var ang = i / n * Math.PI * 2, r = az(.72, 1.18);
      var x = Math.cos(ang) * rx * r, y = Math.sin(ang) * ry * r;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot),
                cy + x * Math.sin(rot) + y * Math.cos(rot), az(.35, 1.4)]);
    }
    return deformar(pts, 2, .3);
  }

  function camino(g, pts, cerrar) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (cerrar) g.closePath();
  }

  /* la pila de capas + el filo cargado en algunos tramos */
  /* Capas superpuestas del MISMO color: con "multiply" cada capa oscurecía
     y saturaba a la anterior (un #ff5221 terminaba en #ff2416). Encimadas
     normalmente, se junta densidad sin cambiar el tono: el color es el
     elegido y lo único que varía es cuánto pigmento hay. */
  function lavado(g, base, color, capas, alfa) {
    g.globalCompositeOperation = "source-over";
    g.fillStyle = color;
    for (var i = 0; i < capas; i++) {
      g.globalAlpha = alfa * az(.6, 1.4);
      camino(g, deformar(base, 3, .22), true);
      g.fill();
    }
    g.strokeStyle = color;
    for (var k = 0; k < 3; k++) {
      var borde = deformar(base, 3, .15);
      var desde = Math.floor(az(0, borde.length));
      var largo = Math.floor(borde.length * az(.2, .6));
      var tramo = [];
      for (var j = 0; j < largo; j++) tramo.push(borde[(desde + j) % borde.length]);
      g.globalAlpha = az(.07, .16);
      g.lineWidth = az(.5, 1.6);
      camino(g, tramo, false);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /* Pincelada alrededor del token: cuerpo húmedo al principio y cerdas secas
     que se van cortando hacia el final. */
  function pincelada(g, cx, cy, rx, ry, color) {
    var a0 = az(0, Math.PI * 2);
    var barrido = az(1.0, 2.4) * (Math.random() < .5 ? -1 : 1);
    var amp = az(-.1, .1), fase = az(0, Math.PI * 2);
    var ancho0 = Math.min(rx, ry) * az(.28, .5);
    var N = 64, eje = [];
    for (var i = 0; i <= N; i++) {
      var u = i / N, ang = a0 + barrido * u;
      var k = 1 + amp * Math.sin(u * Math.PI * 2 + fase);
      eje.push([cx + Math.cos(ang) * rx * k, cy + Math.sin(ang) * ry * k]);
    }
    function normal(i) {
      var a = eje[Math.max(0, i - 1)], b = eje[Math.min(N, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.sqrt(dx * dx + dy * dy) || 1;
      return [-dy / l, dx / l];
    }
    function ancho(u) { return ancho0 * (1 - .55 * u) * (1 + .15 * Math.sin(u * 9 + fase)); }

    // cuerpo: una cinta que se afina, lavada como una mancha más
    var fin = Math.round(N * az(.5, .68)), izq = [], der = [];
    for (i = 0; i <= fin; i++) {
      var n = normal(i), w = ancho(i / N) / 2;
      izq.push([eje[i][0] + n[0] * w, eje[i][1] + n[1] * w, az(.3, 1.2)]);
      der.push([eje[i][0] - n[0] * w, eje[i][1] - n[1] * w, az(.3, 1.2)]);
    }
    lavado(g, izq.concat(der.reverse()), color, 22, .05);

    // cerdas: arrancan dentro del cuerpo y se secan antes de llegar al final
    // (encimadas normalmente, como el lavado: el tono queda fiel)
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = color;
    g.lineCap = "round";
    var cerdas = Math.round(az(12, 22));
    for (var c = 0; c < cerdas; c++) {
      var o = az(-.5, .5);
      var i0 = Math.round(fin * az(.55, .9));
      var i1 = Math.round(Math.min(N, fin + (N - fin) * az(.35, 1) * (1 - Math.abs(o) * .8)));
      g.lineWidth = az(.5, 1.5);
      for (i = i0; i < i1; i++) {
        var p = (i - i0) / Math.max(1, i1 - i0);
        if (Math.random() < p * p * .7) continue;   // el pincel se seca: huecos
        var n1v = normal(i), n2v = normal(i + 1);
        var w1 = ancho(i / N) * o, w2 = ancho((i + 1) / N) * o;
        g.globalAlpha = .38 * (1 - p) + .03;
        g.beginPath();
        g.moveTo(eje[i][0] + n1v[0] * w1, eje[i][1] + n1v[1] * w1);
        g.lineTo(eje[i + 1][0] + n2v[0] * w2, eje[i + 1][1] + n2v[1] * w2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return eje[0];
  }

  /* burbujas de sal: levantan el pigmento y lo empujan a su borde */
  function sal(g, focos, color) {
    focos.forEach(function (f) {
      var n = Math.round(az(10, 36));
      for (var i = 0; i < n; i++) {
        var ang = az(0, Math.PI * 2), d = Math.sqrt(Math.random()) * f.r;
        var x = f.x + Math.cos(ang) * d, y = f.y + Math.sin(ang) * d, r = az(.6, 3.2);
        g.globalCompositeOperation = "destination-out";
        var grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, "rgba(0,0,0," + az(.45, .95).toFixed(2) + ")");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = "source-atop";
        g.globalAlpha = az(.08, .22);
        g.strokeStyle = color;
        g.lineWidth = .6;
        g.beginPath(); g.arc(x, y, r * .95, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
    });
    g.globalCompositeOperation = "source-over";
  }

  /* floración: el agua que vuelve levanta un claro de borde ondulado y oscuro */
  function floracion(g, x, y, r, color) {
    var base = contornoMancha(x, y, r, r * az(.7, 1.3));
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "#000";
    for (var i = 0; i < 8; i++) {
      g.globalAlpha = az(.04, .08);
      camino(g, deformar(base, 3, .22), true);
      g.fill();
    }
    g.globalCompositeOperation = "source-atop";
    g.strokeStyle = color;
    g.globalAlpha = az(.12, .25);
    g.lineWidth = az(.6, 1.4);
    camino(g, deformar(base, 3, .2), true);
    g.stroke();
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  function coloresTinta(cfg) {
    var lista = (cfg && cfg.colors) || [];
    lista = lista.filter(function (c) { return /^#[0-9a-fA-F]{6}$/.test(c || ""); });
    return lista.length ? lista : ["#ff5221"];   // por defecto
  }

  var WC_PIXELES = 260000;   // tope de píxeles del canvas: la acuarela es blanda, no pide más
  var WC_SUAVE   = .12;      // ancho del frente húmedo, en unidades del mapa de llegada
  var WC_AMPLIO  = 1.15;     // cuánto se extiende la mancha alrededor del token (1 = lo de antes)
  var WC_EXPANDE = 2400;     // ms en mojarse entera

  function pintarAcuarela(t) {
    var cv = t.wc;
    if (!cv) return;
    borrarAcuarela(t);
    var cfg = t.wcDef || {};
    var debajo = !!t.wcDebajo;
    var colores = coloresTinta(cfg);

    var w = t.el.offsetWidth  || t.w || 200;
    var h = t.el.offsetHeight || (w / (t.aspect || 1.6));
    // margen alrededor del token: la tinta lo rodea y desborda
    var M = Math.round(Math.max(w, h) * .75 * WC_AMPLIO);
    var W = w + 2 * M, H = h + 2 * M;
    var res = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(WC_PIXELES / (W * H)));
    cv.style.left = -M + "px";
    cv.style.top = -M + "px";
    cv.style.transformOrigin = (M + w / 2) + "px " + (M + h / 2) + "px";
    cv.style.transform = t.el.style.transform;
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    cv.width = Math.max(1, Math.round(W * res));
    cv.height = Math.max(1, Math.round(H * res));
    var g = cv.getContext("2d");
    g.setTransform(res, 0, 0, res, 0, 0);
    cv.classList.add("is-on");

    var cx = M + w / 2, cy = M + h / 2, R = Math.min(w, h) / 2 * WC_AMPLIO;
    var origenes = [];   // desde dónde se moja cada parte: {x, y, r, demora}
    var focos = [];

    // Encima: manchas sobre el dibujo que se le escapan un poco.
    // Debajo: un halo que lo rodea y manchas que asoman por sus bordes.
    if (debajo) {
      var halo = contornoMancha(cx, cy, w / 2 * az(1.02, 1.25) * WC_AMPLIO, h / 2 * az(1.02, 1.25) * WC_AMPLIO);
      lavado(g, halo, colores[0], 30, .035);
      origenes.push({ x: cx, y: cy, r: Math.max(w, h) * .75 * WC_AMPLIO, demora: 0 });
    }
    var cuantas = colores.length + Math.round(az(1, 3));
    for (var i = 0; i < cuantas; i++) {
      var mx, my, rx;
      if (debajo) {
        var ang = az(0, Math.PI * 2), k = az(.45, .95) * WC_AMPLIO;
        mx = cx + Math.cos(ang) * w / 2 * k;
        my = cy + Math.sin(ang) * h / 2 * k;
        rx = R * az(.55, 1.0);
      } else {
        mx = cx + az(-.3, .3) * w * WC_AMPLIO;
        my = cy + az(-.3, .3) * h * WC_AMPLIO;
        rx = R * az(.5, .95);
      }
      var ry = rx * az(.65, 1.35);
      lavado(g, contornoMancha(mx, my, rx, ry), colores[i % colores.length], 36, .045);
      origenes.push({ x: mx, y: my, r: Math.max(rx, ry) * 1.25, demora: az(0, .25) });
      if (Math.random() < .6) focos.push({ x: mx + az(-.4, .4) * rx, y: my + az(-.4, .4) * ry, r: rx * az(.25, .5) });
      if (Math.random() < .3) floracion(g, mx + az(-.3, .3) * rx, my + az(-.3, .3) * ry, rx * az(.2, .4), colores[i % colores.length]);
    }

    // a veces una pincelada que lo rodea (o dos)
    var pinceladas = Math.random() < .7 ? (Math.random() < .3 ? 2 : 1) : 0;
    for (i = 0; i < pinceladas; i++) {
      var kk = (debajo ? az(.95, 1.3) : az(.6, 1.05)) * WC_AMPLIO;
      var ini = pincelada(g, cx, cy, w / 2 * kk, h / 2 * kk, colores[Math.floor(az(0, colores.length))]);
      origenes.push({ x: ini[0], y: ini[1], r: Math.max(w, h) * 1.1 * WC_AMPLIO, demora: az(.05, .3) });
    }

    sal(g, focos, colores[0]);

    // salpicaduras sueltas cerca de las manchas (nunca lejos: a lo sumo a
    // poco más de medio token de la mancha que las suelta)
    var gotas = Math.round(az(3, 14));
    for (i = 0; i < gotas; i++) {
      var o = origenes[Math.floor(az(0, origenes.length))];
      var a = az(0, Math.PI * 2), d = Math.min(o.r, Math.max(w, h) * .6) * az(.8, 1.3);
      g.globalAlpha = az(.25, .6);
      g.fillStyle = colores[Math.floor(az(0, colores.length))];
      g.beginPath();
      g.arc(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, az(.4, 1.8), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    /* Desde dónde se moja: siempre desde debajo del token. Cada mancha o
       pincelada deja su fuente dentro del token (a lo sumo al 60 % de su
       radio), en la dirección en que está; el frente sale de ahí hacia
       afuera y llega a ella, aunque esté lejos. Cada fuente avanza a su
       propia velocidad y con su pequeña demora: las lenguas de tinta siguen
       saliendo desparejas. */
    var alcance = Math.max(w, h) * 1.1 * WC_AMPLIO;
    var fuentes = [{ x: cx, y: cy, r: alcance, demora: 0 }];
    origenes.forEach(function (o) {
      var dx = o.x - cx, dy = o.y - cy;
      var e = Math.sqrt((dx * dx) / (w * w / 4) + (dy * dy) / (h * h / 4));
      var s = e > .6 ? .6 / e : 1;
      fuentes.push({ x: cx + dx * s, y: cy + dy * s, r: alcance * az(.75, 1.25), demora: Math.min(o.demora, .12) });
    });

    var mascaraDatos = null;
    if ((cfg.freeExpansion === false || cfg.freeExpansion === "false") && t.wcMaskLoading) {
      cv.classList.remove("is-on");
      return;
    }
    if ((cfg.freeExpansion === false || cfg.freeExpansion === "false") && t.wcMask && t.wcMask.complete && t.wcMask.naturalWidth) {
      var mc = document.createElement("canvas");
      mc.width = cv.width;
      mc.height = cv.height;
      var mg = mc.getContext("2d");
      if (t.wcMaskNamed) {
        // La máscara nombrada ocupa el viewBox completo del SVG original.
        mg.drawImage(t.wcMask, M * res, M * res, w * res, h * res);
      } else {
        var maskX = t.wcMask.offsetLeft || 0;
        var maskY = t.wcMask.offsetTop || 0;
        var maskW = t.wcMask.offsetWidth || w;
        var maskH = t.wcMask.offsetHeight || h;
        mg.drawImage(t.wcMask, (M + maskX) * res, (M + maskY) * res, maskW * res, maskH * res);
      }
      mascaraDatos = mg.getImageData(0, 0, mc.width, mc.height);

      // La máscara nombrada ya representa directamente la zona permitida.
      // Sólo el método antiguo necesita rellenar las áreas cerradas del contorno.
      var md = mascaraDatos.data, mw = mc.width, mh = mc.height;
      if (!t.wcMaskNamed) {
      var exterior = new Uint8Array(mw * mh);
      var pila = new Int32Array(mw * mh), tope = 0;
      function agregarExterior(px, py) {
        var pi = py * mw + px;
        if (exterior[pi] || md[pi * 4 + 3] > 0) return;
        exterior[pi] = 1;
        pila[tope++] = pi;
      }
      for (var mx = 0; mx < mw; mx++) {
        agregarExterior(mx, 0);
        agregarExterior(mx, mh - 1);
      }
      for (var my = 1; my < mh - 1; my++) {
        agregarExterior(0, my);
        agregarExterior(mw - 1, my);
      }
      while (tope) {
        var pi = pila[--tope], px = pi % mw, py = (pi / mw) | 0;
        if (px > 0) agregarExterior(px - 1, py);
        if (px + 1 < mw) agregarExterior(px + 1, py);
        if (py > 0) agregarExterior(px, py - 1);
        if (py + 1 < mh) agregarExterior(px, py + 1);
      }
      for (var mi = 0; mi < mw * mh; mi++) {
        var ai = mi * 4 + 3;
        if (md[ai] === 0 && !exterior[mi]) md[ai] = 255;
      }
      }
    }
    prepararMojado(t, g, cv.width, cv.height, res, fuentes, mascaraDatos);
    t.wcSt.T = 0;
    // en el mismo instante: si no, se llega a ver un cuadro con la mancha entera
    mojar(t.wcSt);
    llevarAcuarela(t, 1 + WC_SUAVE, WC_EXPANDE);
  }

  /* Mapa de llegada: cuándo alcanza el agua a cada píxel pintado. Además, el
     grano del papel: el pigmento se asienta distinto en cada poro. */
  function prepararMojado(t, g, cw, ch, res, origenes, mascaraDatos) {
    var img = g.getImageData(0, 0, cw, ch);
    var d = img.data;
    var ruido = nuevoRuido(), grano = nuevoRuido();
    var idx = [], llegada = [], alfa = [];
    for (var y = 0; y < ch; y++) {
      for (var x = 0; x < cw; x++) {
        var p = (y * cw + x) * 4;
        if (mascaraDatos) d[p + 3] = Math.round(d[p + 3] * mascaraDatos.data[p + 3] / 255);
        if (d[p + 3] < 3) { d[p + 3] = 0; continue; }
        var px = x / res, py = y / res;
        var l = Infinity;
        for (var i = 0; i < origenes.length; i++) {
          var o = origenes[i], dx = px - o.x, dy = py - o.y;
          var v = o.demora + Math.sqrt(dx * dx + dy * dy) / o.r;
          if (v < l) l = v;
        }
        l += (ruido(px / 14, py / 14) - .5) * .5 + (ruido(px / 4, py / 4) - .5) * .12;
        // red de seguridad: contra el borde del canvas la tinta se desvanece,
        // nunca queda un corte recto
        var bx = Math.min(x, cw - 1 - x) / (cw * .08), by = Math.min(y, ch - 1 - y) / (ch * .08);
        var borde = Math.min(1, bx, by);
        idx.push(p + 3);
        llegada.push(l);
        alfa.push(d[p + 3] * (.72 + .28 * grano(px / 1.6, py / 1.6)) * borde * borde * (3 - 2 * borde));
        d[p + 3] = 0;
      }
    }
    var n = idx.length;
    /* Donde más pigmento se juntó, el color tiene que ser el elegido, no una
       versión lavada: las capas translúcidas casi nunca llegaban a cubrir del
       todo y sobre el papel claro el tono se veía más pálido. Se escala la
       densidad para que el 5 % más cargado llegue a cubrir entero (con tope,
       así los bordes y las transparencias siguen siendo acuarela). */
    if (n) {
      var muestra = alfa.slice().sort(function (a, b) { return a - b; });
      var p95 = muestra[Math.floor(n * .95)] || 255;
      var escala = Math.min(1.45, 255 / Math.max(1, p95));
      for (var q = 0; q < n; q++) alfa[q] = Math.min(255, alfa[q] * escala);
    }
    var st = {
      g: g, img: img, T: 0, raf: 0,
      idx: new Int32Array(idx), alfa: new Float32Array(alfa), llegada: new Float32Array(n)
    };
    // El orden de llegada sale de la distancia y el ruido (la forma del
    // frente). Pero el tiempo se reparte según la tinta: cada tramo de la
    // animación descubre o retira la misma cantidad de pigmento. Si no, casi
    // todo el pigmento (que está cerca de los orígenes) aparecía o se iba en
    // un instante, y al salir parecía un pestañeo.
    var orden = new Uint32Array(n), total = 0, j;
    for (j = 0; j < n; j++) { orden[j] = j; total += alfa[j]; }
    orden.sort(function (a, b) { return llegada[a] - llegada[b]; });
    var acum = 0;
    for (j = 0; j < n; j++) {
      acum += alfa[orden[j]];
      st.llegada[orden[j]] = acum / (total || 1);
    }
    t.wcSt = st;
  }

  function mojar(st) {
    var d = st.img.data, idx = st.idx, alfa = st.alfa, lleg = st.llegada, T = st.T;
    for (var i = 0, n = idx.length; i < n; i++) {
      var k = (T - lleg[i]) / WC_SUAVE;
      d[idx[i]] = k <= 0 ? 0 : (k >= 1 ? alfa[i] : alfa[i] * k);
    }
    st.g.setTransform(1, 0, 0, 1, 0, 0);
    st.g.putImageData(st.img, 0, 0);
  }

  /* Anima el frente húmedo hasta `hacia`. Al crecer arranca rápido y el
     papel lo va frenando. Al retirarse, parejo (el mapa de llegada ya está
     repartido por cantidad de tinta, así que la curva es lo que se ve). */
  function llevarAcuarela(t, hacia, dur, alFinal) {
    var st = t.wcSt;
    if (!st) return;
    window.cancelAnimationFrame(st.raf);
    var T0 = st.T, t0 = performance.now(), crece = hacia > T0;
    function cuadro(now) {
      if (t.wcSt !== st) return;
      var p = Math.min(1, (now - t0) / dur);
      var e = crece ? 1 - Math.pow(1 - p, 2.2) : p * p * (3 - 2 * p);
      st.T = T0 + (hacia - T0) * e;
      mojar(st);
      if (p < 1) st.raf = window.requestAnimationFrame(cuadro);
      else if (alFinal) alFinal();
    }
    st.raf = window.requestAnimationFrame(cuadro);
  }

  function secarAcuarela(t) {
    var st = t.wcSt;
    if (!st) return;
    var dur = 1600 * Math.max(.2, (st.T + WC_SUAVE) / (1 + 2 * WC_SUAVE));
    llevarAcuarela(t, -WC_SUAVE, dur, function () {
      if (!t.el.classList.contains("is-hover")) borrarAcuarela(t);
    });
  }

  function borrarAcuarela(t) {
    if (t.wcSt) window.cancelAnimationFrame(t.wcSt.raf);
    t.wcSt = null;
    if (t.wc) t.wc.classList.remove("is-on");
    if (t.wc && t.wc.width) {
      var g = t.wc.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, t.wc.width, t.wc.height);
    }
  }

  function dibujarRayones(t) {
    var svg = t.scribble;
    if (!svg) return;
    // offsetWidth/Height ignoran el giro y la escala del token: dan la caja
    // de dibujo tal cual, que es justo lo que tiene que medir el viewBox para
    // que los trazos caigan encima sin deformarse ni quedar con franjas.
    var w = t.el.offsetWidth  || t.w || 200;
    var h = t.el.offsetHeight || (w / (t.aspect || 1.6));

    svg.setAttribute("viewBox", "0 0 " + n1(w) + " " + n1(h));
    svg.innerHTML = "";
    svg.classList.remove("is-borrando");
    window.clearTimeout(t.rayonesFin);

    var grosor = Math.max(1.3, Math.min(w, h) * az(.012, .022));
    var cuantos = Math.round(az(3, 5));
    for (var i = 0; i < cuantos; i++) {
      (function (i) {
        var p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", elegir(GARABATOS)(w, h));
        p.setAttribute("stroke-width", n1(grosor * az(.75, 1.3)));
        p.setAttribute("opacity", az(.55, .95).toFixed(2));
        svg.appendChild(p);

        var largo = 0;
        try { largo = p.getTotalLength(); } catch (e) { largo = 0; }
        if (!largo) return;
        p.dataset.largo = largo;
        p.style.strokeDasharray = largo;
        p.style.strokeDashoffset = largo;
        // un cuadro de margen para que el navegador tome el punto de partida
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            // si el cursor ya se fue, no se arranca: se estaría dibujando al salir
            if (svg.classList.contains("is-borrando")) return;
            p.style.transition = "stroke-dashoffset " + az(.32, .55).toFixed(2) +
                                 "s cubic-bezier(.25,.6,.3,1) " + (i * az(.07, .13)).toFixed(2) + "s";
            p.style.strokeDashoffset = "0";
          });
        });
      })(i);
    }
  }

  /* Al salir el cursor, el dibujo al revés: cada trazo se recoge desde su
     punta hacia donde empezó, y el último que apareció es el primero en irse.
     La capa se queda visible mientras tanto (is-borrando). */
  function borrarRayones(t) {
    var svg = t.scribble;
    var trazos = Array.prototype.slice.call(svg.querySelectorAll("path")).reverse();
    if (!trazos.length) return;
    svg.classList.add("is-borrando");
    var total = 0;
    trazos.forEach(function (p, i) {
      var largo = Number(p.dataset.largo);
      if (!largo) return;
      var dur = az(.24, .4), demora = i * az(.05, .09);
      total = Math.max(total, dur + demora);
      p.style.transition = "stroke-dashoffset " + dur.toFixed(2) +
                           "s cubic-bezier(.5,0,.75,.4) " + demora.toFixed(2) + "s";
      p.style.strokeDashoffset = largo;
    });
    window.clearTimeout(t.rayonesFin);
    t.rayonesFin = window.setTimeout(function () {
      if (t.el.classList.contains("is-hover")) return;
      svg.classList.remove("is-borrando");
      svg.innerHTML = "";
    }, total * 1000 + 60);
  }

  /* ---------------- baile 3D (token.float) ----------------
     Con el cursor encima, el ícono entero se acerca un poco (crece apenas,
     con perspectiva) y "baila": gira en 3D hacia un lado y hacia el otro,
     como mirando alrededor, en bucle. Al salir vuelve a su lugar. Se mueve
     con un resorte: entra y sale con un leve rebote y nunca salta, aunque el
     cursor salga a mitad de camino. Se aplica a la imagen del token; el token
     en sí (posición, giro, choques) no se entera. */
  var BAILE = {
    CERCA: 0.14,       // cuánto se acerca (translateZ), en proporción del ancho del token
    PERSPECTIVA: 3,    // distancia de la cámara, en anchos del token
    LADO: 26,          // grados que gira hacia cada lado (rotateY)
    CABECEO: 6,        // grados que cabecea arriba y abajo (rotateX)
    VUELTA: 1.8,       // segundos de una ida y vuelta de lado a lado
    RESORTE: 14,       // rigidez del resorte (rad/s): más alto, más rápido
    AMORT: 0.55        // amortiguación: más bajo, más rebote
  };
  // Todo lo que se ve del token baila junto: la imagen (o el Lottie del
  // token), la de hover (imagen, video o Lottie), la copia de los trazos y
  // los rayones. Si alguna capa quedaba afuera, al taparse unas a otras se
  // veía una quieta y otra bailando debajo (un duplicado).
  var CAPAS_BAILE = ".token__img, .token__lottie, .token__trazos, .token__scribble";
  var bailando = [];
  var baileRaf = 0;
  var baileAntes = 0;

  function bailar(t, meta) {
    var b = t.baile;
    if (!b) return;
    if (meta && !b.meta) {
      b.reloj = 0;       // el vaivén arranca desde el frente, sin saltar
      t.el.style.perspective = Math.round((t.el.offsetWidth || 60) * BAILE.PERSPECTIVA) + "px";
    }
    b.meta = meta;
    if (bailando.indexOf(t) < 0) bailando.push(t);
    if (!baileRaf) { baileAntes = 0; baileRaf = window.requestAnimationFrame(pasoBaile); }
  }

  function pasoBaile(ahora) {
    var dt = baileAntes ? Math.min(0.033, (ahora - baileAntes) / 1000) : 0.016;
    baileAntes = ahora;
    var quieto = reducido();
    var w0 = BAILE.RESORTE, z0 = BAILE.AMORT;
    bailando = bailando.filter(function (t) {
      var b = t.baile;
      var capas = t.el.querySelectorAll(CAPAS_BAILE);
      b.reloj += dt;
      b.vel += (w0 * w0 * (b.meta - b.x) - 2 * z0 * w0 * b.vel) * dt;
      b.x += b.vel * dt;
      var k = b.x;
      var fase = b.reloj * 2 * Math.PI / BAILE.VUELTA;
      var ry = quieto ? 0 : BAILE.LADO * Math.sin(fase) * Math.max(0, k);
      var rx = quieto ? 0 : BAILE.CABECEO * Math.sin(fase * 2) * Math.max(0, k);
      var z = BAILE.CERCA * (t.el.offsetWidth || 60) * k;
      var mueve = "translateZ(" + z.toFixed(2) + "px) rotateY(" + ry.toFixed(2) + "deg) rotateX(" + rx.toFixed(2) + "deg)";
      Array.prototype.forEach.call(capas, function (c) { c.style.transform = mueve; });
      var sigue = b.meta || Math.abs(b.x) > 0.002 || Math.abs(b.vel) > 0.02;
      if (!sigue) {
        b.x = 0; b.vel = 0;
        Array.prototype.forEach.call(capas, function (c) { c.style.transform = ""; });
        t.el.style.perspective = "";
        return false;
      }
      return true;
    });
    baileRaf = bailando.length ? window.requestAnimationFrame(pasoBaile) : 0;
  }

  /* ---------------- trazos animados (token.strokes) ----------------
     El estilo de los Lottie del portfolio: el dibujo relleno queda quieto y
     sólo se animan las líneas (trazos sin relleno) con un "trim". En reposo
     no se ven; en su turno, la punta dibuja la línea desde su principio y la
     cola la va borrando detrás con un retraso (el offset entre inicio y fin
     de After Effects): se ve un tramo que viaja por el recorrido. Ease suave
     de entrada y salida, escalonadas, con una pausa entre vueltas. En los
     trazos cerrados (un aro) el tramo además gira. Al salir el cursor
     termina la vuelta. Se trabaja sobre una copia en línea del SVG
     (.token__trazos). */
  var TRAZO = {
    DIBUJA: 0.8,       // segundos que tarda la punta (y la cola) en recorrer la línea
    RETRASO: 0.32,     // cuánto después sale la cola: el largo del tramo que viaja
    PASO: 0.16,        // escalonado entre una línea y la siguiente
    PAUSA: 0.35,       // respiro al final de cada vuelta
    GIRO: 0.25,        // cuánto gira el tramo en una línea cerrada (en vueltas)
    PRISA: 2.4,        // al salir el cursor, las líneas en camino terminan así de rápido
    VUELTA: 1.3        // velocidad de reversa al salir del hover sin loop
  };
  var trazando = [];
  var trazoRaf = 0, trazoAntes = 0, trazoUid = 0;

  function svgEnLinea(texto, prefijo) {
    var doc = new DOMParser().parseFromString(texto, "image/svg+xml");
    var svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;
    Array.prototype.forEach.call(svg.querySelectorAll("script, foreignObject"), function (n) { n.remove(); });
    var todos = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll("*")));
    // ids y clases con prefijo: un SVG en línea comparte el documento, y los
    // ".st0" o "SVGID_1_" de Illustrator chocarían con los de otro token
    var ids = {};
    todos.forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) { if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
      if (n.id) { ids[n.id] = prefijo + n.id; n.id = prefijo + n.id; }
    });
    function url(v) { return v.replace(/url\(\s*#([^)\s]+)\s*\)/g, function (m, id) { return ids[id] ? "url(#" + ids[id] + ")" : m; }); }
    todos.forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (a.name === "id") return;
        if ((a.name === "href" || a.name === "xlink:href") && a.value.charAt(0) === "#" && ids[a.value.slice(1)]) n.setAttribute(a.name, "#" + ids[a.value.slice(1)]);
        else if (a.value.indexOf("url(") >= 0) n.setAttribute(a.name, url(a.value));
      });
      var cls = n.getAttribute("class");
      if (cls) n.setAttribute("class", cls.split(/\s+/).filter(Boolean).map(function (c) { return prefijo + c; }).join(" "));
    });
    Array.prototype.forEach.call(svg.querySelectorAll("style"), function (st) {
      st.textContent = url(st.textContent.replace(/\.(-?[_a-zA-Z][\w-]*)/g, "." + prefijo + "$1"));
    });
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return svg;
  }

  function prepararTrazos(t, el, src) {
    var defToken = (t.p && t.p.token) || {};
    var loop = defToken.strokeLoop !== false;
    fetch(src).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (texto) {
      var svg = svgEnLinea(texto, "tz" + (++trazoUid) + "-");
      if (!svg) throw 0;
      svg.setAttribute("class", "token__trazos");
      // token.strokeFree: el trazo puede salirse de los bordes del SVG (sin la
      // casilla, se recorta en ellos: ver .token__trazos en styles.css)
      if (defToken.strokeFree === true) el.classList.add("trazos-libre");
      el.appendChild(svg);
      // las líneas: formas con trazo y sin relleno (se mira el estilo real)
      var FORMAS = "path, circle, ellipse, rect, polygon, polyline, line";
      var lineas = Array.prototype.filter.call(svg.querySelectorAll(FORMAS), function (n) {
        if (n.closest("defs, clipPath, mask, pattern, marker, symbol")) return false;
        var cs = window.getComputedStyle(n);
        return cs.stroke && cs.stroke !== "none" && (cs.fill === "none" || cs.fillOpacity === "0");
      });
      if (!lineas.length) { svg.remove(); el.classList.remove("trazos-espera"); return; }   // nada que animar: el token queda quieto
      t.trazos = {
        svg: svg, t: 0, activo: false, sale: false, loop: loop,
        lineas: lineas.map(function (n, i) {
          n.setAttribute("pathLength", "1");
          var cerrada = /^(circle|ellipse|rect|polygon)$/i.test(n.tagName) || /z\s*$/i.test(n.getAttribute("d") || "");
          return { n: n, demora: (i * TRAZO.PASO) % (4 * TRAZO.PASO), cerrada: cerrada };
        })
      };
      var ultima = Math.max.apply(null, t.trazos.lineas.map(function (l) { return l.demora; }));
      t.trazos.ciclo = ultima + TRAZO.DIBUJA + TRAZO.RETRASO + TRAZO.PAUSA;
      t.trazos.tFin = ultima + TRAZO.DIBUJA;
      // En reposo, como el primer cuadro de un Lottie: el dibujo sin sus
      // líneas. Desde ya se ve la copia en línea (con las líneas ocultas) en
      // lugar de la imagen, que sí las tiene.
      t.trazos.lineas.forEach(ocultarLinea);
      el.classList.add("trazos-on");
      el.classList.remove("trazos-espera");
    }).catch(function () { el.classList.remove("trazos-espera"); });   // falló: queda la imagen
  }

  function ocultarLinea(l) {
    l.n.style.visibility = "hidden";
    l.n.style.strokeDasharray = "";
    l.n.style.strokeDashoffset = "";
  }

  function trazar(t, entra) {
    var z = t.trazos;
    if (z.loop) {
      if (entra) {
        z.sale = false;
        if (!z.activo) { z.activo = true; z.t = 0; }
      } else if (z.activo && !z.sale) {
        // Al salir no se termina la vuelta entera (con un roce del cursor las
        // líneas se dibujaban recién después, y el token parecía quedar
        // seleccionado): no empieza ninguna línea nueva y las que iban por la
        // mitad terminan su recorrido, apuradas.
        z.sale = true;
        var dura = TRAZO.DIBUJA + TRAZO.RETRASO;
        // sigue sólo la que ya se ve de verdad (la punta pasó el primer tramo);
        // una que apenas asomaba se va sin terminar
        z.lineas.forEach(function (l) { var u = z.t - l.demora; l.sigue = u > TRAZO.DIBUJA * 0.3 && u < dura; });
      }
      if (trazando.indexOf(t) < 0) trazando.push(t);
    } else {
      // Sin loop: al entrar avanza hacia tFin hasta completarse y se detiene;
      // al salir regresa en reversa hacia 0.
      if (entra) {
        z.sale = false;
        if (z.t < z.tFin) {
          z.activo = true;
          if (trazando.indexOf(t) < 0) trazando.push(t);
        }
      } else {
        if (z.t > 0) {
          z.sale = true;
          z.activo = true;
          if (trazando.indexOf(t) < 0) trazando.push(t);
        }
      }
    }
    if (trazando.length && !trazoRaf) { trazoAntes = 0; trazoRaf = window.requestAnimationFrame(pasoTrazos); }
  }

  // ease de entrada y salida (cúbico): arranca despacio, acelera y se posa
  function sedoso(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function pasoTrazos(ahora) {
    var dt = trazoAntes ? Math.min(0.05, (ahora - trazoAntes) / 1000) : 0.016;
    trazoAntes = ahora;
    trazando = trazando.filter(function (t) {
      var z = t.trazos;
      if (!z.activo) return false;

      // Modo sin loop: avance hasta completarse al 100%, reversa al salir
      if (!z.loop) {
        z.t += z.sale ? -dt * TRAZO.VUELTA : dt;
        if (z.sale && z.t <= 0) {
          z.t = 0;
          z.activo = false;
          z.sale = false;
          z.lineas.forEach(ocultarLinea);
          return false;
        }
        if (!z.sale && z.t >= z.tFin) {
          z.t = z.tFin;
          // Completado al 100%: queda visible quieto hasta que salga el cursor
          z.lineas.forEach(function (l) {
            l.n.style.visibility = "visible";
            l.n.style.strokeDasharray = "1 1";
            l.n.style.strokeDashoffset = "0";
          });
          return false;
        }
        z.lineas.forEach(function (l) {
          var u = z.t - l.demora;
          if (u <= 0) {
            ocultarLinea(l);
            return;
          }
          var p = sedoso(u / TRAZO.DIBUJA);
          l.n.style.visibility = p > 0.001 ? "visible" : "hidden";
          l.n.style.strokeDasharray = Math.max(0, Math.min(1, p)).toFixed(4) + " 1";
          l.n.style.strokeDashoffset = "0";
        });
        return true;
      }

      // Modo loop (comportamiento original):
      var dura = TRAZO.DIBUJA + TRAZO.RETRASO;
      z.t += z.sale ? dt * TRAZO.PRISA : dt;
      var fin = z.sale
        ? !z.lineas.some(function (l) { return l.sigue && z.t - l.demora < dura; })
        : z.t >= z.ciclo && reducido();
      if (fin) {
        z.activo = false; z.sale = false;
        z.lineas.forEach(ocultarLinea);        // vuelve al reposo: sin líneas
        return false;
      }
      if (z.t >= z.ciclo) z.t -= z.ciclo;
      z.lineas.forEach(function (l) {
        if (z.sale && !l.sigue) { ocultarLinea(l); return; }
        var u = z.t - l.demora;
        // fuera de su turno la línea no se ve (como en los Lottie)
        if (u < 0 || u >= dura) { ocultarLinea(l); return; }
        var punta = sedoso(u / TRAZO.DIBUJA);                     // dibuja desde el principio
        var cola = sedoso((u - TRAZO.RETRASO) / TRAZO.DIBUJA);    // y borra detrás, con retraso
        var desde = cola, largo = punta - cola;
        // en una línea cerrada el tramo además gira mientras viaja
        var giro = l.cerrada ? TRAZO.GIRO * sedoso(u / dura) : 0;
        l.n.style.visibility = largo > 0.001 ? "visible" : "hidden";
        l.n.style.strokeDasharray = Math.max(0, largo).toFixed(4) + " 1";
        l.n.style.strokeDashoffset = (-(desde + giro)).toFixed(4);
      });
      return true;
    });
    trazoRaf = trazando.length ? window.requestAnimationFrame(pasoTrazos) : 0;
  }

  function cortarRayones(t) {
    window.clearTimeout(t.rayonesFin);
    t.scribble.classList.remove("is-borrando");
    t.scribble.innerHTML = "";
  }

  /* ---------------- idioma ---------------- */

  /* Reescribe todo el texto de interfaz y de los tokens al idioma actual. */
  function applyLang() {
    if (data && enMantenimiento(data.site)) return;
    var lang = I18N.get();

    // reset va al final de la barra: su ancho cambia con el idioma sin correr nada
    var reset = document.getElementById("btnReset");
    reset.textContent = I18N.t("reset");
    reset.title = I18N.t("resetTitle");

    document.getElementById("btnClose").setAttribute("aria-label", I18N.t("closeProject"));
    [["btnPrev", "prevProject"], ["btnNext", "nextProject"]].forEach(function (par) {
      var b = document.getElementById(par[0]);
      if (b) { b.setAttribute("aria-label", I18N.t(par[1])); b.title = I18N.t(par[1]); }
    });
    var back = document.getElementById("btnBack");
    if (back) back.textContent = I18N.t("back");

    stage.setAttribute("aria-label",
      lang === "es" ? "Superficie con los proyectos" : "Surface with the projects");

    Array.prototype.forEach.call(
      document.querySelectorAll("#langSwitch [data-lang]"),
      function (b) { b.setAttribute("aria-pressed", b.dataset.lang === lang ? "true" : "false"); }
    );

    tokens.forEach(function (t) {
      var name = I18N.tx(t.p.title);
      t.el.setAttribute("aria-label", I18N.t("openProject") + " " + (name || t.p.id));
      var img = t.el.querySelector(".token__img--base");
      if (img) img.alt = name;
      var fb = t.el.querySelector(".token__fallback");
      if (fb) fb.textContent = name;
    });

    labelFilters();
    window.ProjectView.refresh();
    reacomodar();   // en celular la barra de hashtags cambia de alto con el idioma
  }

  /* El idioma del país del visitante. El navegador no sabe en qué país está:
     lo sabe Netlify por la IP. En _redirects, geo/pais.json se reescribe a
     geo/es.json para los países hispanohablantes y a geo/en.json para el
     resto. Sin respuesta en PAIS_ESPERA (o en local, donde no existe), null:
     entra en inglés. Nunca frena la carga. */
  var PAIS_URL    = "geo/pais.json";
  var PAIS_ESPERA = 1500;

  function idiomaPorPais() {
    var pedido = fetch(PAIS_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.lang; })
      .catch(function () { return null; });
    var espera = new Promise(function (listo) {
      window.setTimeout(function () { listo(null); }, PAIS_ESPERA);
    });
    return Promise.race([pedido, espera]);
  }

  function boot() {
    window.ProjectView.init(closeProject);

    I18N.onChange(applyLang);

    Array.prototype.forEach.call(
      document.querySelectorAll("#langSwitch [data-lang]"),
      function (b) {
        b.addEventListener("click", function () { I18N.set(b.dataset.lang); });
      }
    );

    var bPrev = document.getElementById("btnPrev");
    var bNext = document.getElementById("btnNext");
    window.ProjectView.alPulsar(bPrev, function () { irAProyecto(-1); });
    window.ProjectView.alPulsar(bNext, function () { irAProyecto(1); });

    document.getElementById("btnClearFilters").addEventListener("click", function () {
      TAG_GROUPS.forEach(function (g) { active[g] = []; });
      applyFilters();
    });

    document.getElementById("btnReset").addEventListener("click", function () {
      clearStore();
      fisica.movidos = {};
      tokens.forEach(function (t) {
        frenar(t);
        var base = posicionBase(t.p, t.i);   // en celular, la grilla
        t.x = base.x;
        t.y = base.y;
        t.rot = base.rotation;
        t.el.style.transition = "transform .45s cubic-bezier(.22,.9,.28,1)";
        window.setTimeout(function () { t.el.style.transition = ""; }, 480);
      });
      // se acomodan ya separados: la transición lleva a cada uno a su lugar final
      placeAll();
      separarEncimados();
    });

    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(reacomodar, 80);
    });
    window.addEventListener("orientationchange", function () {
      setTimeout(reacomodar, 250);
    });
    window.addEventListener("hashchange", syncFromHash);

    // El idioma y los datos se piden a la vez; se arranca con los dos.
    var idioma = I18N.elegido() ? Promise.resolve(null) : idiomaPorPais();
    var datos = fetch(DATA_URL, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
    idioma.then(function (lang) { I18N.init(lang); });

    Promise.all([idioma, datos])
      .then(function (res) {
        data = res[1];
        if (!Array.isArray(data.projects)) data.projects = [];
        applySite(data.site);
        if (enMantenimiento(data.site)) { mostrarMantenimiento(data.site); return; }
        sizeSurface();
        render();
        buildFilters();
        applyLang();
        actualizarNav();
        syncFromHash();
      })
      .catch(function (err) {
        console.error("No se pudo cargar " + DATA_URL, err);
        layer.innerHTML =
          '<p style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
          'background:#fff;padding:18px 22px;font-size:13px;max-width:80vw;text-align:center">' +
          I18N.t("loadError") + "</p>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
