/* =========================================================
   i18n.js — idioma del sitio (español / inglés)
   Expone window.I18N
   Orden de preferencia: ?lang= en la URL → lo último que eligió el
   visitante → el idioma de su país (lo averigua app.js) → inglés.
   ========================================================= */
(function () {
  "use strict";

  var LANGS = ["es", "en"];
  var KEY   = "rp-lang";

  var STRINGS = {
    es: {
      reset:       "reordenar",
      allTags:     "ver todos",
      resetTitle:  "Volver a la disposición original",
      openProject: "Abrir proyecto",
      closeProject:"Cerrar proyecto",
      prevProject: "Proyecto anterior",
      nextProject: "Proyecto siguiente",
      back:        "volver a la página de inicio",
      audioPlayer: "Reproductor de audio",
      video:       "Video",
      loadError:   "No se pudo cargar <code>data/projects.json</code>.<br>" +
                   "Abrí el sitio con <code>node server.js</code> (o desde un servidor web), " +
                   "no con doble clic en el archivo."
    },
    en: {
      reset:       "reset",
      allTags:     "show all",
      resetTitle:  "Back to the original layout",
      openProject: "Open project",
      closeProject:"Close project",
      prevProject: "Previous project",
      nextProject: "Next project",
      back:        "back to home page",
      audioPlayer: "Audio player",
      video:       "Video",
      loadError:   "Could not load <code>data/projects.json</code>.<br>" +
                   "Open the site through <code>node server.js</code> (or any web server), " +
                   "not by double-clicking the file."
    }
  };

  var lang = "en";
  var subs = [];

  function valid(l) { return LANGS.indexOf(l) >= 0 ? l : null; }

  function fromQuery() {
    var m = /[?&]lang=([a-zA-Z-]+)/.exec(location.search);
    return m ? valid(m[1].slice(0, 2).toLowerCase()) : null;
  }

  function fromStore() {
    try { return valid(localStorage.getItem(KEY)); } catch (e) { return null; }
  }

  function apply() {
    document.documentElement.setAttribute("lang", lang);
    subs.forEach(function (fn) { try { fn(lang); } catch (e) {} });
  }

  /* Texto de interfaz. */
  function t(key) {
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.es[key] || key;
  }

  /* Texto de contenido: acepta "hola" o {es:"hola", en:"hi"}.
     NO hay respaldo entre idiomas: si algo no está traducido, no se muestra.
     Mezclar idiomas en la misma pantalla es peor que dejar el hueco. */
  function tx(value) {
    if (value == null) return "";
    // string suelto = dato viejo sin idiomas, no es mezcla
    if (typeof value === "string") return value;
    if (typeof value === "object") return value[lang] || "";
    return "";
  }

  window.I18N = {
    langs: LANGS,

    /* ¿El idioma ya está decidido por el link o por el visitante? Si no,
       app.js pregunta por el país antes de arrancar. */
    elegido: function () { return !!(fromQuery() || fromStore()); },

    init: function (porPais) {
      lang = fromQuery() || fromStore() || valid(porPais) || "en";
      apply();
      return lang;
    },

    get: function () { return lang; },

    set: function (l) {
      l = valid(l);
      if (!l || l === lang) return;
      lang = l;
      try { localStorage.setItem(KEY, l); } catch (e) {}
      // deja el idioma en la URL para que el link sea compartible
      try {
        var u = new URL(location.href);
        u.searchParams.set("lang", l);
        history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch (e) {}
      apply();
    },

    t: t,
    tx: tx,
    onChange: function (fn) { subs.push(fn); }
  };
})();
