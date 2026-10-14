/* =========================================================
   project.js — render de la página de proyecto (overlay)
   Expone window.ProjectView
   ========================================================= */
(function () {
  "use strict";

  var LOTTIE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie_light.min.js";

  var el = {
    view: null,
    veil: null,
    scroll: null,
    body: null,
    close: null,
    prev: null,
    next: null
  };

  var current = null;
  var players = [];      // instancias lottie activas
  var lottieLoading = null;

  /* ---------------- utilidades ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function extOf(src) {
    var s = String(src || "").split("?")[0].split("#")[0];
    var i = s.lastIndexOf(".");
    return i < 0 ? "" : s.slice(i + 1).toLowerCase();
  }

  /* Deduce el tipo de bloque a partir de la extensión del archivo. */
  function guessType(src) {
    var e = extOf(src);
    if (["mp4", "webm", "ogv", "mov", "m4v"].indexOf(e) >= 0) return "video";
    if (e === "json" || e === "lottie") return "lottie";
    if (["jpg", "jpeg", "png", "webp", "gif", "avif", "svg"].indexOf(e) >= 0) return "image";
    return "image";
  }

  function loadLottie() {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (lottieLoading) return lottieLoading;
    lottieLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = LOTTIE_CDN;
      s.async = true;
      s.onload = function () { resolve(window.lottie); };
      s.onerror = function () { reject(new Error("No se pudo cargar lottie-web")); };
      document.head.appendChild(s);
    });
    return lottieLoading;
  }

  /* ---------------- embeds ---------------- */

  /* Ancho y alto originales del embed: primero lo que se cargó a mano en el
     panel, si no, los atributos que venían en el código pegado (width/height,
     o el style en px). Un valor en % no sirve: no es una medida. */
  function medidaAtributo(code, nombre) {
    var m = code.match(new RegExp("\\b" + nombre + "\\s*=\\s*[\"']?([^\"'\\s>]+)", "i"));
    if (m && /^[0-9]+(\.[0-9]+)?$/.test(m[1])) return Math.round(parseFloat(m[1]));
    m = code.match(new RegExp(nombre + "\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*px", "i"));
    return m ? Math.round(parseFloat(m[1])) : 0;
  }

  function medidasDe(block, code) {
    var w = parseInt(block.width, 10) || 0;
    var h = parseInt(block.height, 10) || 0;
    if (code) {
      if (!w) w = medidaAtributo(code, "width");
      if (!h) h = medidaAtributo(code, "height");
    }
    return { w: w > 0 ? w : 0, h: h > 0 ? h : 0 };
  }

  /* Proveedores permitidos: SoundCloud, Bandcamp, YouTube, Vimeo y cualquier
     iframe pegado a mano (provider "raw"). */
  function embedSrcFrom(block) {
    var url = String(block.url || "").trim();
    var code = String(block.code || "").trim();

    if (code) {
      var m = code.match(/src\s*=\s*["']([^"']+)["']/i);
      if (m) url = m[1];
    }
    if (!url) return null;
    if (url.indexOf("//") === 0) url = "https:" + url;

    var provider = (block.provider || "").toLowerCase();

    // Medidas originales y la proporción que sale de ellas.
    var nat = medidasDe(block, code);
    var prop = (nat.w && nat.h) ? (nat.w + " / " + nat.h) : "";

    if (!provider) {
      if (/soundcloud\.com/i.test(url)) provider = "soundcloud";
      else if (/bandcamp\.com/i.test(url)) provider = "bandcamp";
      else if (/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(url)) provider = "youtube";
      else if (/vimeo\.com/i.test(url)) provider = "vimeo";
      else provider = "raw";
    }

    // Los proveedores de video devuelven proporción en vez de alto fijo,
    // así el reproductor queda responsive.
    if (provider === "youtube") {
      var ym = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/)
            || url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)
            || url.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/);
      if (!ym) return null;
      var start = url.match(/[?&](?:t|start)=(\d+)/);
      return {
        src: "https://www.youtube-nocookie.com/embed/" + ym[1] +
             "?rel=0&modestbranding=1&playsinline=1" + (start ? "&start=" + start[1] : ""),
        ratio: block.ratio || prop || "16 / 9",
        maxW: nat.w
      };
    }

    if (provider === "vimeo") {
      // vimeo.com/123456789 · vimeo.com/123456789/hash (privados) · player.vimeo.com/video/123456789
      var vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([A-Za-z0-9]+))?/);
      if (!vm) return null;
      var hm = url.match(/[?&]h=([A-Za-z0-9]+)/);
      var h = vm[2] || (hm ? hm[1] : "");
      return {
        src: "https://player.vimeo.com/video/" + vm[1] + (h ? "?h=" + h : ""),
        ratio: block.ratio || prop || "16 / 9",
        maxW: nat.w
      };
    }

    if (provider === "soundcloud") {
      // Si es un link normal de SoundCloud, lo convierte en URL de player.
      if (url.indexOf("w.soundcloud.com/player") < 0) {
        url = "https://w.soundcloud.com/player/?url=" + encodeURIComponent(url) +
              "&color=%23273338&auto_play=false&hide_related=true&show_comments=false" +
              "&show_user=true&show_reposts=false&show_teaser=false&visual=" +
              (block.visual === false ? "false" : "true");
      }
      return { src: url, height: block.height || (block.visual === false ? 166 : 420) };
    }

    if (provider === "bandcamp") {
      if (!/bandcamp\.com\/EmbeddedPlayer/i.test(url)) return null; // necesita el embed oficial
      return { src: url, height: block.height || 442 };
    }

    if (provider === "raw") {
      if (!/^https?:\/\//i.test(url)) return null;   // nada de javascript: ni data:
      // Con alto pero sin ancho se comporta como un reproductor de audio:
      // alto fijo y todo el ancho disponible.
      if (nat.h && !nat.w) return { src: url, height: nat.h };
      return { src: url, ratio: block.ratio || prop || "16 / 9", maxW: nat.w };
    }

    return null;
  }

  /* ---------------- render de bloques ---------------- */

  function renderText(b) {
    var variant = b.variant || "body";
    var text = I18N.tx(b.content);
    // Sin texto en este idioma no se dibuja nada: un panel vacío es peor que
    // el hueco, y mostrar el otro idioma está descartado.
    if (!text.trim()) return null;
    var node;
    if (variant === "title") {
      node = document.createElement("h1");
      node.className = "block block--text block-title";
      node.textContent = text;
      return node;
    }
    if (variant === "subtitle") {
      node = document.createElement("h2");
      node.className = "block block--text block-subtitle";
      node.textContent = text;
      return node;
    }
    if (variant === "quote") {
      node = document.createElement("blockquote");
      node.className = "block block--text block-quote";
      node.textContent = text;
      return node;
    }
    node = document.createElement("div");
    node.className = "block block--text block-body";
    var paras = String(text).split(/\n{2,}/);
    paras.forEach(function (p) {
      var el2 = document.createElement("p");
      el2.innerHTML = esc(p).replace(/\n/g, "<br>");
      node.appendChild(el2);
    });
    return node;
  }

  function withCaption(wrap, b) {
    var caption = I18N.tx(b.caption);
    if (caption) {
      var c = document.createElement("figcaption");
      c.className = "block-caption";
      c.textContent = caption;
      wrap.appendChild(c);
    }
    return wrap;
  }

  function renderImage(b) {
    var fig = document.createElement("figure");
    fig.className = "block block--media block--image";
    // Lado por el que se descubre. Sin dato, entra desde la izquierda; "none"
    // la deja quieta y visible desde el principio. La marca va en la figura,
    // no en la imagen: ver el comentario del CSS.
    var lado = b.reveal || "left";
    if (["left", "right", "top", "bottom"].indexOf(lado) >= 0) {
      fig.setAttribute("data-reveal", lado);
    }

    var img = document.createElement("img");
    // Su tamaño y su posición exacta los decide afinarImagenes().
    img.addEventListener("load", function () {
      if (!img.naturalWidth) return;
      // el archivo original: su tamaño y su dirección (después puede mostrarse
      // una copia achicada, ver afinarImagenes)
      if (!img.dataset.w) {
        img.dataset.w = img.naturalWidth;
        img.dataset.src = img.currentSrc || img.src;
      }
      // el gris de espera se va: en un PNG/WEBP con transparencia se veía detrás
      img.classList.add("is-loaded");
      afinarPronto();
    });
    img.src = b.src;
    img.alt = I18N.tx(b.alt) || I18N.tx(b.caption) || "";
    img.loading = "lazy";
    img.decoding = "async";
    fig.appendChild(img);
    return withCaption(fig, b);
  }

  function renderVideo(b) {
    var fig = document.createElement("figure");
    fig.className = "block block--media";
    var v = document.createElement("video");
    v.src = b.src;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    if (b.poster) v.poster = b.poster;
    if (b.autoplay !== false) {
      v.autoplay = true; v.muted = true; v.loop = b.loop !== false;
      v.setAttribute("muted", "");
    }
    v.controls = b.controls !== false;
    v.preload = "metadata";
    // Un archivo de video recién dice cuánto mide cuando cargan sus metadatos.
    v.addEventListener("loadedmetadata", function () {
      if (!v.videoWidth || !v.videoHeight) return;
      v.setAttribute("data-prop", v.videoWidth / v.videoHeight);
      v.setAttribute("data-nat-w", v.videoWidth);
      ajustarMedidas();
    });
    fig.appendChild(v);
    return withCaption(fig, b);
  }

  function renderLottie(b) {
    var fig = document.createElement("figure");
    fig.className = "block block--lottie";
    var holder = document.createElement("div");
    holder.className = "lottie-holder";
    if (b.maxWidth) holder.style.maxWidth = b.maxWidth + "px";
    holder.style.margin = "0 auto";
    fig.appendChild(holder);
    withCaption(fig, b);

    loadLottie().then(function (lottie) {
      if (!lottie || !holder.isConnected) return;
      var anim = lottie.loadAnimation({
        container: holder,
        renderer: "svg",
        loop: b.loop !== false,
        autoplay: b.autoplay !== false,
        path: b.src
      });
      players.push(anim);
    }).catch(function () { /* silencio: si falla el CDN el bloque queda vacío */ });

    return fig;
  }

  function renderEmbed(b) {
    var info = embedSrcFrom(b);
    if (!info) return null;
    var isVideo = !!info.ratio;

    var fig = document.createElement("figure");
    fig.className = "block block--embed" + (isVideo ? " block--embed-video" : "");

    var f = document.createElement("iframe");
    f.src = info.src;
    f.setAttribute("scrolling", "no");
    f.setAttribute("frameborder", "no");
    f.setAttribute("loading", "lazy");
    f.setAttribute("allowfullscreen", "");
    f.setAttribute("allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen");
    f.title = I18N.tx(b.caption) || I18N.t(isVideo ? "video" : "audioPlayer");

    if (isVideo) {
      var holder = document.createElement("div");
      holder.className = "embed-frame";
      holder.style.aspectRatio = info.ratio;
      // Tamaño original: no se estira más allá de sus píxeles reales, y si no
      // entra —de ancho o de alto— se achica manteniendo la proporción.
      // ajustarMedidas() lee estos dos datos.
      holder.setAttribute("data-prop", proporcionDe(info.ratio));
      if (info.maxW) holder.setAttribute("data-nat-w", info.maxW);
      holder.appendChild(f);
      fig.appendChild(holder);
    } else {
      f.height = info.height;
      f.style.height = info.height + "px";
      fig.appendChild(f);
    }
    return withCaption(fig, b);
  }

  /* Sólo se aceptan destinos razonables: nada de javascript: ni data:. */
  function urlSegura(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^(\/|\.|#)/.test(u)) return u;          // relativa o ancla del propio sitio
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return "https://" + u;   // dominio pelado
    return "";
  }

  function renderButton(b) {
    var texto = I18N.tx(b.label);
    var destino = urlSegura(I18N.tx(b.url));   // un link por idioma (o uno solo, si es viejo)
    if (!texto && !b.icon) return null;

    var wrap = document.createElement("div");
    wrap.className = "block block--button";

    var el2 = document.createElement(destino ? "a" : "button");
    el2.className = "project__btn";
    if (destino) {
      el2.href = destino;
      // los links externos abren aparte; los internos, en la misma pestaña
      // (un "/…" es otro documento del sitio, como una dirección corta: también)
      if (b.newTab !== false && /^(https?:|mailto:|tel:|\/(?!\/))/i.test(destino)) {
        el2.target = "_blank";
        el2.rel = "noopener noreferrer";
      }
    } else {
      el2.type = "button";
    }

    if (b.icon) {
      var ic = document.createElement("img");
      ic.className = "project__btn__icon";
      // los de la biblioteca son negros: en un post oscuro se invierten (ver CSS)
      if (/^img\/button-icons\//.test(b.icon)) ic.className += " project__btn__icon--biblioteca";
      ic.src = b.icon;
      ic.alt = "";
      ic.setAttribute("aria-hidden", "true");
      ic.addEventListener("error", function () { ic.remove(); });
      el2.appendChild(ic);
    }
    if (texto) {
      var sp = document.createElement("span");
      sp.textContent = texto;
      el2.appendChild(sp);
    }

    wrap.appendChild(el2);
    return wrap;
  }

  /* Fila de 1 a 6 columnas. Cada celda es un bloque común, así que se dibuja
     con el mismo renderBlock de siempre: no hay tipos especiales. */
  function renderRow(b) {
    var n = parseInt(b.columns, 10) || 1;
    if (n < 1) n = 1;
    if (n > 6) n = 6;

    var celdas = Array.isArray(b.cells) ? b.cells : [];
    var wrap = document.createElement("div");
    wrap.className = "block block--row";
    wrap.style.setProperty("--cols", n);

    var dibujadas = 0;
    for (var i = 0; i < n; i++) {
      var celda = document.createElement("div");
      celda.className = "row__cell";
      var node = celdas[i] ? renderBlock(celdas[i]) : null;
      if (node) {
        celda.appendChild(node);
        dibujadas++;
      }
      wrap.appendChild(celda);
    }
    // si en este idioma no quedó nada, la fila entera no se dibuja
    return dibujadas ? wrap : null;
  }

  function renderDivider() {
    var d = document.createElement("div");
    d.className = "block block--divider";
    return d;
  }

  function renderBlock(b) {
    if (!b) return null;
    var type = b.type || (b.src ? guessType(b.src) : "text");
    switch (type) {
      case "text":    return renderText(b);
      case "image":
      case "gif":     return renderImage(b);
      case "video":   return renderVideo(b);
      case "lottie":  return renderLottie(b);
      case "embed":
      case "soundcloud":
      case "bandcamp":
      case "youtube":
      case "vimeo":
        if (!b.provider && type !== "embed") b = Object.assign({}, b, { provider: type });
        return renderEmbed(b);
      case "button":  return renderButton(b);
      case "row":     return renderRow(b);
      case "divider": return renderDivider();
      default:        return null;
    }
  }

  /* ---------- cortina de aparición ----------
     Cada imagen se descubre cuando entra en pantalla. El observador mira
     dentro del scroll de la publicación, que es lo que se mueve, y suelta la
     imagen apenas asoma. Se descubre una sola vez: nada vuelve a taparse. */

  var observador = null;

  function observarCortinas() {
    var cortinas = el.body.querySelectorAll("[data-reveal]:not(.is-shown)");
    if (!cortinas.length) return;

    if (!("IntersectionObserver" in window)) {
      // Sin soporte no se esconde nada: primero que se vea, después el efecto.
      Array.prototype.forEach.call(cortinas, function (n) { n.classList.add("is-shown"); });
      return;
    }

    if (!observador) {
      observador = new window.IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("is-shown");
          observador.unobserve(e.target);
        });
      }, { root: el.scroll, rootMargin: "0px 0px -8% 0px", threshold: 0.1 });
    }

    // unobserve + observe fuerza una medición nueva: durante la maximización
    // el contenido está achicado y una medición vieja diría que no se ve.
    Array.prototype.forEach.call(cortinas, function (n) {
      observador.unobserve(n);
      observador.observe(n);
    });
  }

  /* Invariante: con la publicación abierta, su contenido tiene que verse.
     Si pasado el tiempo de la animación sigue tapado, lo que lo tapa es un
     residuo —el fotograma congelado de un cierre que no se canceló— y se
     descarta. Queda el rastro en la consola para poder matarlo de raíz. */
  function verificarVisible() {
    if (!el.view.classList.contains("is-open") || cerrando) return;
    var residuos = el.scroll.getAnimations().filter(function (a) {
      var t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
      return t.fill === "forwards" || t.fill === "both";
    });
    if (!residuos.length) return;
    if (window.console && console.warn) {
      console.warn("[rp] quedó un fotograma congelado sobre la publicación abierta:",
        residuos.map(function (a) {
          var t = a.effect.getTiming();
          return { estado: a.playState, relleno: t.fill, tiempo: a.currentTime };
        }));
    }
    soltarAnimaciones();
  }

  /* ---------- el video se adapta a la pantalla ----------
     Un video más alto que la pantalla queda cortado por el borde de abajo. Acá
     se le pone un techo de alto —lo que queda de pantalla desde donde empieza,
     menos un respiro— y se traduce a un ancho máximo, que es lo único que hace
     falta tocar: la proporción ya la fija aspect-ratio, así que el alto sale
     solo y el video nunca se deforma. */

  var AIRE_ABAJO = 40;     // respiro entre el video y el borde inferior
  var ALTO_MINIMO = 220;   // por debajo de esto no tiene sentido seguir achicando

  function proporcionDe(ratio) {
    var m = String(ratio).split("/");
    var w = parseFloat(m[0]);
    var h = parseFloat(m[1]);
    return (w > 0 && h > 0) ? (w / h) : 0;
  }

  function ajustarMedidas() {
    var vh = window.innerHeight || 0;
    if (!vh || !el.body) return;
    Array.prototype.forEach.call(el.body.querySelectorAll("[data-prop]"), function (caja) {
      var prop = parseFloat(caja.getAttribute("data-prop"));
      if (!(prop > 0)) return;
      // Lo que hay por encima sólo cuenta mientras el video esté cerca del
      // principio: más abajo se lo mira con scroll y el techo es la pantalla.
      var arriba = Math.min(caja.offsetTop, Math.round(vh * 0.5));
      var alto = Math.max(ALTO_MINIMO, vh - arriba - AIRE_ABAJO);
      var ancho = Math.round(alto * prop);
      var nat = parseInt(caja.getAttribute("data-nat-w"), 10) || 0;
      if (nat) ancho = Math.min(ancho, nat);
      caja.style.maxWidth = "min(100%, " + ancho + "px)";
    });
  }

  /* ---------- nitidez de las imágenes ----------
     Una imagen se ve igual que en el visor de fotos sólo si se dibuja 1:1: a
     su ancho real y en píxeles enteros de la pantalla. Dos cosas lo impedían,
     y las dos la hacían re-muestrear entera (se veía apenas borrosa):
     - un archivo apenas más ancho que su celda (522 px en una de 521) se
       achicaba ese píxel;
     - la posición caía en decimales (y = 357,33, por los textos de arriba).
     Si al archivo le sobran hasta SOBRA_MAX px, se muestra a su tamaño real
     (desborda medio píxel por lado: no se nota). Más angosta, queda a su
     tamaño, centrada. Y cada imagen se corre la fracción de píxel que la separa
     de la grilla de la pantalla.
     Más ancha (un archivo de 865 px en una celda de 521): el navegador la
     achicaba con un filtro rápido que ablanda los bordes. Se achica acá, una
     sola vez y bien (pasos de a la mitad, suavizado alto), exactamente a los
     píxeles de pantalla que ocupa, y se muestra esa copia 1:1. Las animadas
     (GIF, WebP o PNG animados) no: se congelarían. Las de otro dominio
     tampoco: el navegador no deja leerlas.
     Con la publicación animándose (escalada) las medidas mienten: se espera. */
  var SOBRA_MAX = 2;
  var afinarPendiente = 0;
  var copias = [];   // URLs de las copias achicadas, para liberarlas al cambiar de post

  /* Corre también mientras la publicación se está abriendo: así, cuando
     termina de abrirse, cada imagen ya tiene su medida, su lugar y su copia
     definitivos, y no cambia nada a la vista. Durante la animación la ventana
     está achicada y corrida (translate + scale uniforme): las medidas se
     llevan a las de la ventana quieta deshaciendo esa transformación. */
  function afinarImagenes() {
    afinarPendiente = 0;
    if (!el.body || !el.view.classList.contains("is-open") || cerrando) return;
    var dpr = window.devicePixelRatio || 1;
    var sr = el.scroll.getBoundingClientRect();
    var esc = el.scroll.offsetWidth ? sr.width / el.scroll.offsetWidth : 1;
    if (!(esc > 0.2)) { afinarPronto(40); return; }   // demasiado chica todavía para medir fino
    function quieto(r) {
      return {
        left: el.scroll.offsetLeft + (r.left - sr.left) / esc,
        top: el.scroll.offsetTop + (r.top - sr.top) / esc,
        width: r.width / esc,
        height: r.height / esc
      };
    }
    var imgs = Array.prototype.slice.call(el.body.querySelectorAll(".block--image img"))
      .filter(function (img) { return img.naturalWidth > 0 && img.dataset.w; });

    // primero los tamaños (mueven lo que está abajo), después las posiciones.
    // Se mide con el archivo original: la copia achicada tiene otro tamaño.
    imgs.forEach(function (img) {
      var anchoArchivo = Number(img.dataset.w);
      // el ancho de maquetación, que no lo toca ninguna transformación
      var celda = parseFloat(getComputedStyle(img.parentNode).width) || 0;
      var sobra = anchoArchivo - celda;
      var ancho;
      if (sobra <= SOBRA_MAX) {
        ancho = anchoArchivo;   // a su tamaño real (si sobra un poco, desborda)
        img.style.marginLeft = img.style.marginRight = sobra > 0 ? (-sobra / 2) + "px" : "";
      } else {
        // la celda entera, pero en píxeles de pantalla enteros (341,33 → 341):
        // la copia achicada se hace a esa medida exacta y se ve 1:1
        ancho = Math.floor(celda * dpr) / dpr;
        img.style.marginLeft = img.style.marginRight = "";
      }
      img.style.width = ancho + "px";
      img.style.maxWidth = "none";
      img.style.translate = "";
    });
    var pedidos = [];
    imgs.forEach(function (img) {
      var r = quieto(img.getBoundingClientRect());
      var dx = (redondear(r.left * dpr) - r.left * dpr) / dpr;
      var dy = (redondear(r.top * dpr) - r.top * dpr) / dpr;
      if (dx || dy) img.style.translate = dx.toFixed(3) + "px " + dy.toFixed(3) + "px";
      // píxeles de pantalla que ocupa; si el archivo tiene más, se achica acá
      var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (Number(img.dataset.w) > w + 1) pedidos.push({ img: img, w: w, h: h, top: r.top });
      else if (img.dataset.copia) {
        // la ventana creció: la copia quedó chica, vuelve el original
        img.dataset.copia = "";
        img.src = img.dataset.src;
      }
    });
    // primero las que están a la vista: tienen que estar listas antes de que
    // termine de abrirse la publicación
    var alto = window.innerHeight || 800;
    pedidos.sort(function (a, b) {
      var va = a.top < alto ? 0 : 1, vb = b.top < alto ? 0 : 1;
      return va - vb || a.top - b.top;
    }).forEach(function (p) { achicarImagen(p.img, p.w, p.h); });
  }

  /* Redondeo a píxel de pantalla que no duda en los medios: una posición en
     x,5 exacto a veces se mide x,4999 y a veces x,5001, y la imagen saltaba
     un píxel de un lado al otro. Todo lo que está a menos de 0,02 del medio
     va siempre hacia arriba. */
  function redondear(v) { return Math.floor(v + 0.52); }

  /* Las copias se hacen de a una y en el orden en que se pidieron (las
     visibles primero): en paralelo, la última de la pantalla podía terminar
     después que una de más abajo. */
  var cola = Promise.resolve();

  function achicarImagen(img, w, h) {
    var clave = w + "x" + h;
    if (img.dataset.copia === clave || img.dataset.animada === "1") return;
    img.dataset.copia = clave;
    cola = cola.then(function () { return hacerCopia(img, w, h, clave); });
  }

  function hacerCopia(img, w, h, clave) {
    if (img.dataset.copia !== clave || !img.isConnected) return;
    return esAnimada(img.dataset.src).then(function (animada) {
      if (animada) { img.dataset.animada = "1"; return; }
      return new Promise(function (listo) {
        var fuente = new Image();
        fuente.onerror = listo;
        fuente.onload = function () {
          if (img.dataset.copia !== clave) return listo();   // mientras tanto cambió el tamaño
          try {
            remuestrear(fuente, w, h).toBlob(function (b) {
              if (!b || img.dataset.copia !== clave) return listo();
              var url = URL.createObjectURL(b);
              copias.push(url);
              // se decodifica aparte y recién entonces se cambia: el cambio de
              // src no deja ni un cuadro vacío
              var lista = new Image();
              lista.src = url;
              (lista.decode ? lista.decode() : Promise.resolve()).catch(function () {})
                .then(function () { if (img.dataset.copia === clave) img.src = url; listo(); });
            }, "image/png");
          } catch (e) { listo(); /* imagen de otro dominio: queda la original */ }
        };
        fuente.src = img.dataset.src;
      });
    }).catch(function () {});
  }

  /* Achica con un filtro Lanczos (el de los editores de imágenes): conserva
     los bordes que el filtro del navegador ablanda (medido: el suavizado
     "alto" del canvas da lo mismo que el del navegador). Si el archivo es
     enorme, antes se lo lleva a unas dos veces la medida final con el canvas,
     que es rápido; el tramo final, que es el que se ve, es Lanczos. */
  function remuestrear(fuente, w, h) {
    var c = document.createElement("canvas");
    c.width = fuente.naturalWidth; c.height = fuente.naturalHeight;
    c.getContext("2d").drawImage(fuente, 0, 0);
    while (c.width / 2 >= w * 2) {
      var m = document.createElement("canvas");
      m.width = Math.round(c.width / 2); m.height = Math.round(c.height / 2);
      m.getContext("2d").drawImage(c, 0, 0, m.width, m.height);
      c = m;
    }
    var src = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    var fin = document.createElement("canvas");
    fin.width = w; fin.height = h;
    fin.getContext("2d").putImageData(lanczos(src, w, h), 0, 0);
    return fin;
  }

  /* Lanczos de 3 lóbulos, separable (primero a lo ancho, después a lo alto).
     Trabaja con el color premultiplicado por el alfa: si no, en los bordes de
     una imagen con transparencia se colaría el color de los píxeles invisibles. */
  function lanczos(src, w, h) {
    var A = 3;
    function k(x) {
      if (x === 0) return 1;
      if (x <= -A || x >= A) return 0;
      var px = Math.PI * x;
      return A * Math.sin(px) * Math.sin(px / A) / (px * px);
    }
    // para cada píxel de salida: desde qué píxel de entrada y con qué pesos
    function pesos(entrada, salida) {
      var escala = entrada / salida, soporte = A * Math.max(1, escala);
      var tabla = [];
      for (var i = 0; i < salida; i++) {
        var centro = (i + 0.5) * escala - 0.5;
        var desde = Math.max(0, Math.ceil(centro - soporte));
        var hasta = Math.min(entrada - 1, Math.floor(centro + soporte));
        var ws = [], suma = 0;
        for (var j = desde; j <= hasta; j++) {
          var v = k((j - centro) / Math.max(1, escala));
          ws.push(v); suma += v;
        }
        for (var q = 0; q < ws.length; q++) ws[q] /= suma;
        tabla.push({ desde: desde, ws: ws });
      }
      return tabla;
    }
    var sw = src.width, sh = src.height, d = src.data;
    // premultiplicado, en flotantes
    var p = new Float32Array(sw * sh * 4);
    for (var i = 0; i < sw * sh; i++) {
      var a = d[i * 4 + 3] / 255;
      p[i * 4] = d[i * 4] * a; p[i * 4 + 1] = d[i * 4 + 1] * a;
      p[i * 4 + 2] = d[i * 4 + 2] * a; p[i * 4 + 3] = d[i * 4 + 3];
    }
    // a lo ancho: sw × sh → w × sh
    var px = pesos(sw, w), t = new Float32Array(w * sh * 4);
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < w; x++) {
        var e = px[x], r = 0, g = 0, b = 0, al = 0;
        for (var n = 0; n < e.ws.length; n++) {
          var o = (y * sw + e.desde + n) * 4, f = e.ws[n];
          r += p[o] * f; g += p[o + 1] * f; b += p[o + 2] * f; al += p[o + 3] * f;
        }
        var s = (y * w + x) * 4;
        t[s] = r; t[s + 1] = g; t[s + 2] = b; t[s + 3] = al;
      }
    }
    // a lo alto: w × sh → w × h, y de vuelta a color sin premultiplicar
    var py = pesos(sh, h), out = new ImageData(w, h), od = out.data;
    for (var yy = 0; yy < h; yy++) {
      var ev = py[yy];
      for (var xx = 0; xx < w; xx++) {
        var R = 0, G = 0, B = 0, AL = 0;
        for (var m = 0; m < ev.ws.length; m++) {
          var oo = ((ev.desde + m) * w + xx) * 4, fv = ev.ws[m];
          R += t[oo] * fv; G += t[oo + 1] * fv; B += t[oo + 2] * fv; AL += t[oo + 3] * fv;
        }
        var ss = (yy * w + xx) * 4, alfa = AL > 0 ? AL / 255 : 0;
        od[ss] = alfa ? R / alfa : 0;       // ImageData recorta solo a 0–255
        od[ss + 1] = alfa ? G / alfa : 0;
        od[ss + 2] = alfa ? B / alfa : 0;
        od[ss + 3] = AL;
      }
    }
    return out;
  }

  /* ¿GIF, o WebP/PNG con animación? Se mira la cabecera del archivo (ya está
     en la caché del navegador): WebP animado trae "ANIM", PNG animado "acTL". */
  function esAnimada(src) {
    if (/\.gif($|\?)/i.test(src)) return Promise.resolve(true);
    return fetch(src).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var cabecera = String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 256)));
      return cabecera.indexOf("ANIM") >= 0 || cabecera.indexOf("acTL") >= 0;
    }).catch(function () { return true; });   // ante la duda, no se toca
  }

  function liberarCopias() {
    copias.forEach(function (u) { URL.revokeObjectURL(u); });
    copias = [];
  }

  /* setTimeout y no requestAnimationFrame: en una pestaña en segundo plano no
     hay cuadros, y el ajuste quedaba esperando hasta volver a ella. */
  function afinarPronto(ms) {
    if (!afinarPendiente) afinarPendiente = window.setTimeout(afinarImagenes, typeof ms === "number" ? ms : 0);
  }

  /* ---------------- API pública ---------------- */

  function destroyPlayers() {
    players.forEach(function (p) { try { p.destroy(); } catch (e) {} });
    players = [];
  }

  /* ---------- maximización tipo escritorio ----------
     La publicación crece desde el token hasta su tamaño final, con escala
     UNIFORME para que el contenido no se deforme por el camino. El velo
     (el desenfoque sobre la superficie) entra aparte, con su propio ritmo. */

  var EASE_OPEN  = "cubic-bezier(.32,.72,0,1)";   // arranque vivo, frenada larga
  var EASE_CLOSE = "cubic-bezier(.5,0,.75,.2)";   // se va rápido al final
  var DUR_OPEN   = 480;
  var DUR_CLOSE  = 340;

  function canAnimate() {
    return typeof el.view.animate === "function" &&
           !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* Transform que deja la ventana del tamaño y en el lugar del token.
     El origen es el centro, así que se traslada centro contra centro. */
  function fromRect(rect) {
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var s = Math.max(0.05, Math.min(rect.width / vw, rect.height / vh));
    return "translate(" + (cx - vw / 2) + "px," + (cy - vh / 2) + "px) scale(" + s + ")";
  }

  /* El cierre congela su último fotograma (fill:forwards) para que no se vea
     un parpadeo entre el fin de la animación y el cambio de clase. El precio es
     que un fotograma congelado que sobreviva deja la publicación invisible para
     siempre: el contenido está dibujado, pero en opacidad 0. Se nota porque al
     cerrar reaparece —la animación de salida arranca con opacity:1 y lo pisa—.

     Antes se cancelaban anotando cada animación en una lista propia. Ahora se
     le preguntan al propio elemento: así el barrido no depende de que hayamos
     anotado bien cada una, y ninguna puede quedar colgada. */

  var seq = 0;
  var cerrando = false;   // hay una animación de salida en curso

  /* .is-anim levanta la invariante de visibilidad mientras algo se está
     animando. Se saca siempre con un temporizador sin condiciones: si algo
     sale mal, lo peor que pasa es que la publicación se muestre entera. */
  function marcarAnim(ms) {
    el.view.classList.add("is-anim");
    window.setTimeout(function () { el.view.classList.remove("is-anim"); }, ms);
  }

  /* Los botones que flotan sobre la publicación: cerrar y pasar de proyecto.
     Entran y salen juntos, y se limpian juntos. */
  function botones() {
    return [el.close, el.prev, el.next].filter(function (b) { return !!b; });
  }

  /* Los laterales están centrados con translateY dentro de su propio
     transform, así que las animaciones tienen que arrastrar ese centrado.
     En celular no: ahí van en la franja del pie, sin centrado (mismo corte
     que el CSS). */
  function baseDe(b) {
    if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) return "";
    return b.getAttribute("data-centrar") || "";
  }

  function soltarAnimaciones() {
    [el.scroll, el.veil].concat(botones()).forEach(function (nodo) {
      if (!nodo || !nodo.getAnimations) return;
      nodo.getAnimations().forEach(function (a) {
        // las transiciones CSS (el hover de la cruz) no son nuestras
        if (window.CSSTransition && a instanceof window.CSSTransition) return;
        // soltar los handlers primero: cancelar dispara oncancel, y ese
        // oncancel pertenece a una animación que ya no manda
        try { a.onfinish = null; a.oncancel = null; } catch (e) {}
        try { a.cancel(); } catch (e) {}
      });
    });
  }

  function animateOpen(rect) {
    seq++;
    cerrando = false;
    soltarAnimaciones();
    if (!rect || !canAnimate()) return;
    marcarAnim(DUR_OPEN + 60);
    try {
      el.scroll.animate(
        [{ transform: fromRect(rect), opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: DUR_OPEN, easing: EASE_OPEN }
      );
      el.veil.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: Math.round(DUR_OPEN * 0.75), easing: "ease-out" }
      );
      botones().forEach(function (b) {
        var base = baseDe(b);
        b.animate(
          [{ opacity: 0, transform: (base + " scale(.6)").trim() },
           { opacity: 1, transform: base || "none" }],
          { duration: 300, delay: 170, easing: EASE_OPEN, fill: "backwards" }
        );
      });
    } catch (e) { soltarAnimaciones(); }
  }

  function animateClose(rect, done) {
    var mine = ++seq;
    cerrando = true;
    soltarAnimaciones();
    if (!rect || !canAnimate()) { done(); return; }
    marcarAnim(DUR_CLOSE + 300);

    var called = false;
    function finish() {
      // si entre medio se volvió a abrir, este cierre ya no manda
      if (called || mine !== seq) return;
      called = true;
      cerrando = false;
      // primero se oculta por CSS y recién después se sueltan los fotogramas
      // congelados: al revés se cuela un cuadro con la ventana entera
      done();
      soltarAnimaciones();
    }

    var main;
    try {
      main = el.scroll.animate(
        [{ transform: "none", opacity: 1 }, { transform: fromRect(rect), opacity: 0 }],
        { duration: DUR_CLOSE, easing: EASE_CLOSE, fill: "forwards" }
      );
      el.veil.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: DUR_CLOSE, easing: "ease-in", fill: "forwards" }
      );
      botones().forEach(function (b) {
        b.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 160, easing: "ease-in", fill: "forwards" }
        );
      });
      main.onfinish = finish;
      main.oncancel = finish;
    } catch (e) { finish(); return; }

    // red de seguridad: el proyecto se cierra aunque la animación no corra
    window.setTimeout(finish, DUR_CLOSE + 250);
  }

  function open(project, keepScroll, originRect) {
    if (!project) return;
    soltarAnimaciones();
    current = project;
    destroyPlayers();
    liberarCopias();
    el.body.innerHTML = "";
    el.view.setAttribute("data-theme", project.theme === "light" ? "light" : "dark");

    // Página HTML de la carpeta: se muestra entera dentro de la ventana, con
    // la cruz encima. Nada de encabezado ni bloques: la página es suya.
    var esHtml = project.kind === "html" && !!project.html;
    el.view.classList.toggle("es-html", esHtml);
    var blocks = esHtml ? [] : (Array.isArray(project.blocks) ? project.blocks.slice() : []);
    if (esHtml) {
      var fr = document.createElement("iframe");
      fr.className = "project__html";
      fr.src = project.html;
      fr.title = I18N.tx(project.title) || project.id;
      fr.addEventListener("load", function () { enlacesDeLaPagina(fr); });
      el.body.appendChild(fr);
    }

    // El encabezado sale de los datos del proyecto. Si el contenido arranca con
    // un bloque de título, sólo se descarta cuando dice exactamente lo mismo
    // que el encabezado: si es otro texto, es un título propio y se muestra.
    var title = I18N.tx(project.title);
    var tituloPestana = title;
    if (esHtml) title = "";   // el título va sólo a la pestaña
    if (blocks.length && blocks[0].type === "text" && blocks[0].variant === "title") {
      var primero = I18N.tx(blocks[0].content);
      if (!title) {
        title = primero;
        blocks.shift();
      } else if (primero.trim().toLowerCase() === title.trim().toLowerCase()) {
        blocks.shift();
      }
    }
    if (title) {
      var h = document.createElement("h1");
      h.className = "block block--text block-title";
      h.textContent = title;
      el.body.appendChild(h);
    }
    var subtitle = I18N.tx(project.subtitle);
    if (subtitle) {
      var s = document.createElement("h2");
      s.className = "block block--text block-subtitle";
      s.textContent = subtitle;
      el.body.appendChild(s);
    }
    var meta = esHtml ? [] : [project.year, I18N.tx(project.role), I18N.tx(project.client)]
                 .filter(function (t) { return !!t; });
    if (meta.length) {
      var metaEl = document.createElement("div");
      metaEl.className = "block project__meta";
      meta.forEach(function (t) {
        var sp = document.createElement("span");
        sp.textContent = t;
        metaEl.appendChild(sp);
      });
      el.body.appendChild(metaEl);
    }

    blocks.forEach(function (b) {
      var node = renderBlock(b);
      if (node) el.body.appendChild(node);
    });

    ajustarMedidas();

    cerrando = false;
    el.view.classList.remove("is-anim");
    document.body.classList.add("is-project-open");
    document.body.classList.add("is-desenfocado");   // la superficie, desenfocada detrás
    el.view.classList.add("is-open");
    el.view.setAttribute("aria-hidden", "false");
    var pestana = tituloPestana || title;
    document.title = (pestana ? pestana + " — " : "") + "Ramiro Piedrabuena";
    if (!keepScroll) {
      el.scroll.scrollTop = 0;
      animateOpen(originRect);
      window.setTimeout(function () { el.close.focus(); }, DUR_OPEN);
    }
    observarCortinas();
    window.setTimeout(observarCortinas, DUR_OPEN + 40);
    window.setTimeout(verificarVisible, DUR_OPEN + 140);
    afinarPronto();
    window.setTimeout(afinarPronto, DUR_OPEN + 140);   // cuando terminó de abrirse
  }

  /* Pasa de un proyecto a otro con la publicación ya abierta: cambia el
     contenido y vuelve arriba, sin repetir la maximización desde el token. */
  function swap(project) {
    if (!project) return;
    open(project, true);
    el.scroll.scrollTop = 0;
  }

  /* Vuelve a dibujar el proyecto abierto en el idioma actual, sin perder
     la posición del scroll. */
  function refresh() {
    if (!current || !el.view.classList.contains("is-open")) return;
    var top = el.scroll.scrollTop;
    open(current, true);
    el.scroll.scrollTop = top;
  }

  var cerradoEn = -1e9;
  /* Recién cerrada, la publicación deja al descubierto la superficie: un clic
     repetido sobre la cruz no tiene que agarrar ni abrir el token de abajo. */
  function recienCerrado() { return performance.now() - cerradoEn < 600; }

  /* Los botones de la publicación (cerrar, pasar de proyecto) se disparan
     al apretar, y se reconocen por DÓNDE se aprieta, no por qué elemento
     recibe el evento. Un solo oyente en la ventana, en fase de captura, mira
     si el puntero cayó dentro del rectángulo de un botón visible: así nada
     puede quedarse con el clic —ni el achique del botón al apretarlo, que
     hacía soltar afuera y perder el "click", ni una capa encima puesta por
     el navegador o una extensión—.
     Con el dedo se espera al toque completo (apoyarlo para desplazar no debe
     dispararlo) y el teclado entra por "click" con detail 0. */
  var pulsables = [];
  var MARGEN_TOQUE = 4;   // px de tolerancia alrededor de cada botón

  function alPulsar(b, fn) {
    if (!b) return;
    pulsables.push({ b: b, fn: fn });
    b.addEventListener("click", function (e) {
      if (!e.detail || ultimoPuntero === "touch") fn();
    });
  }

  var ultimoPuntero = "mouse";
  function botonEn(x, y) {
    for (var i = 0; i < pulsables.length; i++) {
      var b = pulsables[i].b;
      if (b.hidden || !b.getClientRects().length || !el.view.contains(b)) continue;
      var r = b.getBoundingClientRect();
      if (x >= r.left - MARGEN_TOQUE && x <= r.right + MARGEN_TOQUE &&
          y >= r.top - MARGEN_TOQUE && y <= r.bottom + MARGEN_TOQUE) return pulsables[i];
    }
    return null;
  }

  window.addEventListener("pointerdown", function (e) {
    ultimoPuntero = e.pointerType || "mouse";
    if (ultimoPuntero === "touch" || (e.button != null && e.button !== 0)) return;
    if (!el.view || !el.view.classList.contains("is-open") || cerrando) return;
    var p = botonEn(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    p.fn();
  }, true);

  function close(originRect) {
    // volver a la superficie cierra todo: las ventanas apiladas se van de una
    if (capas.length) cerrarCapasYa();
    // un segundo clic mientras se cierra no la reinicia
    if (!el.view.classList.contains("is-open") || cerrando) return;
    cerradoEn = performance.now();
    var mia = el;
    document.title = "Ramiro Piedrabuena";
    // Detiene audio/video antes de encogerse
    el.body.querySelectorAll("video").forEach(function (v) { try { v.pause(); } catch (e) {} });
    // el desenfoque se va junto con el velo, no cuando ya terminó de cerrar
    document.body.classList.remove("is-desenfocado");

    animateClose(originRect, function () {
      mia.view.classList.remove("is-open");
      mia.view.setAttribute("aria-hidden", "true");
      document.body.classList.remove("is-project-open");
      window.setTimeout(function () {
        if (mia.view.classList.contains("is-open") || el !== mia) return;
        destroyPlayers();
        liberarCopias();
        mia.body.innerHTML = "";
      }, 320);
    });
    current = null;
  }

  /* Dentro de una página HTML, un link a "#/p/nombre" abre esa página del
     sitio en una ventana encima (y se agranda desde el link), igual que un
     botón. La página es del mismo sitio, así que se le pueden escuchar los
     clics; si algo lo impide, el link queda como está. */
  var origenPendiente = null;

  function enlacesDeLaPagina(fr) {
    var doc;
    try { doc = fr.contentDocument; } catch (e) { return; }
    if (!doc) return;
    doc.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var m = /#\/p\/([A-Za-z0-9_-]+)$/.exec(a.getAttribute("href") || "");
      if (!m) return;
      e.preventDefault();
      var r = a.getBoundingClientRect(), f = fr.getBoundingClientRect();
      origenPendiente = { left: f.left + r.left, top: f.top + r.top, width: r.width, height: r.height };
      window.location.hash = "#/p/" + m[1];
    });
  }

  function tomarOrigen() {
    var o = origenPendiente;
    origenPendiente = null;
    return o;
  }

  /* ---------------- ventanas apiladas ----------------
     Un link a otra página desde una publicación abierta la abre en otra
     ventana encima, igual a la primera (se agranda desde el link). Todo el
     código de la ventana trabaja sobre "la de arriba" (el, current, players,
     copias…): al apilar se guarda ese estado y se arma uno nuevo; al cerrar
     la de arriba se recupera el de abajo tal como había quedado. */
  var capas = [];          // estados de las ventanas de abajo, de la base hacia arriba
  var elBase = null;       // la ventana original (#projectView)
  var pedirCierre = null;  // lo que hace la cruz (lo decide app.js)

  function estadoActual() {
    return { el: el, current: current, players: players, copias: copias,
             observador: observador, seq: seq, cerrando: cerrando, idioma: I18N.get() };
  }
  function ponerEstado(c) {
    el = c.el; current = c.current; players = c.players; copias = c.copias;
    observador = c.observador; seq = c.seq; cerrando = c.cerrando;
  }

  function nuevaVentana() {
    var v = elBase.view.cloneNode(true);
    Array.prototype.forEach.call(v.querySelectorAll("[id]"), function (n) { n.removeAttribute("id"); });
    v.removeAttribute("id");
    // pasar de proyecto y "volver a la superficie" son cosa de la primera ventana
    Array.prototype.forEach.call(v.querySelectorAll(".project__nav, .project__foot"), function (n) { n.remove(); });
    v.classList.remove("is-open", "is-anim", "tiene-nav", "es-html");
    v.classList.add("project--capa");
    v.setAttribute("aria-hidden", "true");
    v.style.zIndex = String(200 + 10 * (capas.length + 1));
    var nel = {
      view: v,
      veil: v.querySelector(".project__veil"),
      scroll: v.querySelector(".project__scroll"),
      body: v.querySelector(".project__body"),
      close: v.querySelector(".project__close"),
      prev: null,
      next: null
    };
    nel.body.innerHTML = "";
    alPulsar(nel.close, function () { if (pedirCierre) pedirCierre(); });
    Array.prototype.forEach.call(v.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", function () { if (pedirCierre) pedirCierre(); });
    });
    if (window.ResizeObserver) {
      nel.ro = new ResizeObserver(afinarPronto);
      nel.ro.observe(nel.body);
    }
    document.body.appendChild(v);
    return nel;
  }

  function abrirCapa(project, origen) {
    if (!project) return;
    if (!el.view.classList.contains("is-open")) { open(project, false, origen); return; }
    capas.push(estadoActual());
    var nel = nuevaVentana();
    nel.origen = origen || null;
    ponerEstado({ el: nel, current: null, players: [], copias: [], observador: null,
                  seq: 0, cerrando: false });
    open(project, false, origen);
  }

  function soltarVentana(nel) {
    destroyPlayers();
    liberarCopias();
    if (observador) { try { observador.disconnect(); } catch (e) {} }
    if (nel.ro) { try { nel.ro.disconnect(); } catch (e) {} }
    pulsables = pulsables.filter(function (p) { return !nel.view.contains(p.b); });
    nel.view.remove();
  }

  function volverAbajo() {
    var c = capas.pop();
    ponerEstado(c);
    var t = current ? I18N.tx(current.title) : "";
    document.title = (t ? t + " — " : "") + "Ramiro Piedrabuena";
    if (c.idioma !== I18N.get()) refresh();   // se cambió el idioma estando arriba
    else { ajustarMedidas(); afinarPronto(); }
  }

  /* Cierra la ventana de arriba: se achica hacia el link del que salió. */
  function cerrarCapa() {
    if (!capas.length || cerrando) return;
    cerradoEn = performance.now();
    var nel = el;
    el.body.querySelectorAll("video").forEach(function (v) { try { v.pause(); } catch (e) {} });
    animateClose(nel.origen, function () {
      soltarVentana(nel);
      volverAbajo();
    });
  }

  /* Cierra ventanas hasta que la de arriba sea la de ese id ("atrás" del
     navegador puede saltar varias). Las del medio se van sin animación. */
  function cerrarHasta(id) {
    var ids = pilaIds();
    var i = ids.indexOf(id);
    if (i < 0 || i === ids.length - 1) return;
    while (capas.length > i + 1) { soltarVentana(el); volverAbajo(); }
    cerrarCapa();
  }

  function cerrarCapasYa() {
    while (capas.length) { soltarVentana(el); volverAbajo(); }
  }

  function pilaIds() {
    return capas.map(function (c) { return c.current ? c.current.id : null; })
                .concat(current ? [current.id] : []);
  }

  function init(onClose) {
    el.view = document.getElementById("projectView");
    el.veil = document.getElementById("projectVeil");
    el.scroll = document.getElementById("projectScroll");
    el.body = document.getElementById("projectBody");
    el.close = document.getElementById("btnClose");
    el.prev = document.getElementById("btnPrev");
    el.next = document.getElementById("btnNext");

    function requestClose() { (onClose || close)(); }
    pedirCierre = requestClose;
    elBase = el;

    alPulsar(el.close, requestClose);
    el.view.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", requestClose);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && el.view.classList.contains("is-open")) requestClose();
    });

    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = window.setTimeout(function () { ajustarMedidas(); afinarPronto(); }, 80);
    });
    // cualquier cambio de alto del post (una imagen o un embed que terminó de
    // cargar, una fuente) corre lo que está debajo: se vuelve a afinar
    if (window.ResizeObserver) new ResizeObserver(afinarPronto).observe(el.body);
  }

  window.ProjectView = {
    init: init,
    open: open,
    swap: swap,
    close: close,
    abrirCapa: abrirCapa,
    cerrarCapa: cerrarCapa,
    cerrarHasta: cerrarHasta,
    pila: function () { return pilaIds(); },
    tomarOrigen: tomarOrigen,
    nivel: function () { return capas.length; },
    alPulsar: alPulsar,
    recienCerrado: recienCerrado,
    refresh: refresh,
    loadLottie: loadLottie,
    isOpen: function () { return !!el.view && el.view.classList.contains("is-open"); },
    currentId: function () { return current ? current.id : null; },
    guessType: guessType
  };
})();
