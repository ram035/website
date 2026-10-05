// The blocks a page is made of: what each one is called in the panel, the
// properties it has, and what a new one starts with. Pure data, shared by the
// site generator (build.js renders each type) and the panel (which draws the
// property editor from these fields).
//
// Field types:
//   text, textarea  a text in English and Spanish ({en, es})
//   plain           one text for both languages (a number, a code)
//   image           a picture from src/img, one per language ({en, es})
//   file            a file from src/downloads, one per language ({en, es})
//   lottie          an animation (.json) from src/img
//   link            where a button or picture goes (see LINKS in build.js)
//   select          one of `options` ([value, label])
//   toggle          on / off
//   list            a list of items, each with its own `fields`
'use strict';

const L = (en, es) => ({ en, es });

const BUTTON_FIELDS = [
  { key: 'label', label: 'Texto', type: 'text' },
  { key: 'link', label: 'Lleva a', type: 'link' },
  { key: 'style', label: 'Estilo', type: 'select', options: [['red', 'Rojo (principal)'], ['ghost', 'Contorno (secundario)']] }
];

const BLOCKS = {
  hero: {
    label: 'Portada', icon: '★', group: 'Encabezados',
    desc: 'Título grande con texto, botones y una animación o imagen.',
    fields: [
      { key: 'layout', label: 'Diseño', type: 'select', options: [['split', 'Animación o imagen a la izquierda'], ['split-right', 'Animación o imagen a la derecha'], ['center', 'Centrado, imagen abajo']] },
      { key: 'eyebrow', label: 'Antetítulo (rojo, arriba)', type: 'text' },
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'buttons', label: 'Botones', type: 'list', itemLabel: 'Botón', fields: BUTTON_FIELDS },
      { key: 'note', label: 'Nota debajo de los botones', type: 'text' },
      { key: 'media', label: 'Acompañar con', type: 'select', options: [['lottie', 'Animación (Lottie)'], ['image', 'Imagen'], ['none', 'Nada']] },
      { key: 'lottie', label: 'Animación', type: 'lottie', showIf: ['media', 'lottie'] },
      { key: 'glow', label: 'Brillo blanco en la capa "galaxy" de la animación', type: 'toggle', showIf: ['media', 'lottie'] },
      { key: 'image', label: 'Imagen', type: 'image', showIf: ['media', 'image'] }
    ],
    defaults: {
      layout: 'center', eyebrow: L('Eyebrow', 'Antetítulo'), title: L('A big, clear title', 'Un título grande y claro'),
      text: L('One or two sentences that say what this is about.', 'Una o dos frases que digan de qué se trata.'),
      buttons: [{ label: L('Learn more', 'Conocer más'), link: '', style: 'red' }], note: L('', ''), media: 'none', lottie: '', glow: false, image: L('', '')
    }
  },

  heading: {
    label: 'Título', icon: 'H', group: 'Texto',
    desc: 'Un título de sección, con antetítulo y una línea de texto.',
    fields: [
      { key: 'eyebrow', label: 'Antetítulo (rojo, arriba)', type: 'text' },
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'size', label: 'Tamaño', type: 'select', options: [['l', 'Grande'], ['m', 'Mediano'], ['s', 'Chico']] },
      { key: 'text', label: 'Texto debajo', type: 'textarea' }
    ],
    defaults: { eyebrow: L('', ''), title: L('Section title', 'Título de la sección'), size: 'l', text: L('', '') }
  },

  text: {
    label: 'Texto', icon: '¶', group: 'Texto',
    desc: 'Título y párrafos. Admite **negrita** y [links](https://…).',
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'paragraphs', label: 'Párrafos', type: 'list', itemLabel: 'Párrafo', fields: [{ key: 'text', label: 'Párrafo', type: 'textarea' }] },
      { key: 'size', label: 'Tamaño del texto', type: 'select', options: [['l', 'Grande'], ['m', 'Normal']] },
      { key: 'highlight', label: 'Línea destacada al final (en rojo)', type: 'text' }
    ],
    defaults: {
      title: L('Title', 'Título'), paragraphs: [{ text: L('Write your text here.', 'Escribe tu texto aquí.') }], size: 'l', highlight: L('', '')
    }
  },

  image: {
    label: 'Imagen', icon: '▣', group: 'Medios',
    desc: 'Una imagen, con epígrafe y link opcionales.',
    fields: [
      { key: 'image', label: 'Imagen', type: 'image' },
      { key: 'alt', label: 'Descripción (para lectores de pantalla y Google)', type: 'text' },
      { key: 'caption', label: 'Epígrafe', type: 'text' },
      { key: 'link', label: 'Al hacer clic, lleva a', type: 'link' },
      { key: 'size', label: 'Ancho', type: 'select', options: [['m', 'Mediano'], ['l', 'Grande'], ['s', 'Chico']] },
      { key: 'frame', label: 'Marco con brillo rojo', type: 'toggle' }
    ],
    defaults: { image: L('', ''), alt: L('', ''), caption: L('', ''), link: '', size: 'l', frame: true }
  },

  feature: {
    label: 'Función con imagen', icon: '◧', group: 'Producto',
    desc: 'Texto con puntos a un lado e imagen al otro.',
    fields: [
      { key: 'side', label: 'Imagen a la', type: 'select', options: [['right', 'Derecha'], ['left', 'Izquierda']] },
      { key: 'kicker', label: 'Antetítulo (rojo)', type: 'text' },
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'bullets', label: 'Puntos', type: 'list', itemLabel: 'Punto', fields: [{ key: 'text', label: 'Punto', type: 'text' }] },
      { key: 'image', label: 'Imagen', type: 'image' },
      { key: 'zoom', label: 'Clic en la imagen la abre en grande', type: 'toggle' }
    ],
    defaults: {
      side: 'right', kicker: L('Feature', 'Función'), title: L('What it does', 'Qué hace'), text: L('Explain it in a couple of sentences.', 'Explícalo en un par de frases.'),
      bullets: [{ text: L('A short point', 'Un punto corto') }], image: L('', ''), zoom: true
    }
  },

  stats: {
    label: 'Cifras', icon: '#', group: 'Producto',
    desc: 'Números grandes con una descripción debajo.',
    fields: [
      { key: 'items', label: 'Cifras', type: 'list', itemLabel: 'Cifra', fields: [{ key: 'value', label: 'Número', type: 'plain' }, { key: 'label', label: 'Descripción', type: 'text' }] }
    ],
    defaults: { items: [{ value: '10', label: L('things', 'cosas') }, { value: '20', label: L('more things', 'cosas más') }] }
  },

  cards: {
    label: 'Tarjetas', icon: '▦', group: 'Producto',
    desc: 'Una grilla de tarjetas con título y texto.',
    fields: [
      { key: 'title', label: 'Título de la sección', type: 'text' },
      { key: 'columns', label: 'Columnas', type: 'select', options: [['3', '3'], ['2', '2'], ['4', '4']] },
      { key: 'items', label: 'Tarjetas', type: 'list', itemLabel: 'Tarjeta', fields: [{ key: 'title', label: 'Título', type: 'text' }, { key: 'text', label: 'Texto', type: 'textarea' }] }
    ],
    defaults: {
      title: L('', ''), columns: '3',
      items: [{ title: L('Card', 'Tarjeta'), text: L('A short text.', 'Un texto corto.') }, { title: L('Card', 'Tarjeta'), text: L('A short text.', 'Un texto corto.') }, { title: L('Card', 'Tarjeta'), text: L('A short text.', 'Un texto corto.') }]
    }
  },

  showcase: {
    label: 'Producto destacado', icon: '◆', group: 'Producto',
    desc: 'Logo del producto, texto, captura, tarjetas y un botón.',
    fields: [
      { key: 'eyebrow', label: 'Antetítulo (rojo)', type: 'text' },
      { key: 'name', label: 'Nombre del producto (lo leen Google y los lectores de pantalla)', type: 'plain' },
      { key: 'logo', label: 'Logo del producto', type: 'image' },
      { key: 'link', label: 'Logo y captura llevan a', type: 'link' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'image', label: 'Captura', type: 'image' },
      { key: 'cards', label: 'Tarjetas', type: 'list', itemLabel: 'Tarjeta', fields: [{ key: 'title', label: 'Título', type: 'text' }, { key: 'text', label: 'Texto', type: 'textarea' }] },
      { key: 'buttons', label: 'Botones', type: 'list', itemLabel: 'Botón', fields: BUTTON_FIELDS },
      { key: 'note', label: 'Nota al final', type: 'text' },
      { key: 'available', label: 'Agregar a la nota "Disponible en Microsoft Store" (cuando hay link de la Store)', type: 'toggle' }
    ],
    defaults: {
      eyebrow: L('Our products', 'Nuestros productos'), name: 'Gavna Music Composer', logo: L('img/music-composer-logo.svg', 'img/music-composer-logo.svg'), link: 'page:music-composer',
      text: L('What the product is, in one sentence.', 'Qué es el producto, en una frase.'), image: L('', ''), cards: [],
      buttons: [{ label: L('See more', 'Ver más'), link: 'page:music-composer', style: 'red' }], note: L('', ''), available: true
    }
  },

  pricing: {
    label: 'Precio', icon: '$', group: 'Producto',
    desc: 'Tarjeta con el precio, puntos, botones de compra o descarga, redes, requisitos y manual.',
    fields: [
      { key: 'name', label: 'Nombre del producto (lo leen Google y los lectores de pantalla)', type: 'plain' },
      { key: 'logo', label: 'Logo', type: 'image' },
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'per', label: 'Texto junto al precio', type: 'text' },
      { key: 'bullets', label: 'Puntos', type: 'list', itemLabel: 'Punto', fields: [{ key: 'text', label: 'Punto', type: 'text' }] },
      { key: 'follow', label: 'Texto sobre Instagram y Discord (vacío = sin redes)', type: 'text' },
      { key: 'specsTitle', label: 'Título de requisitos', type: 'text' },
      { key: 'specs', label: 'Requisitos', type: 'list', itemLabel: 'Requisito', fields: [{ key: 'text', label: 'Requisito', type: 'text' }] },
      { key: 'manualTitle', label: 'Título del manual', type: 'text' },
      { key: 'manualFile', label: 'Archivo del manual', type: 'file' },
      { key: 'manualLabel', label: 'Botón del manual', type: 'text' }
    ],
    defaults: {
      name: 'Gavna Music Composer', logo: L('img/music-composer-logo.svg', 'img/music-composer-logo.svg'), title: L('One price. Yours to keep.', 'Un precio. Para siempre.'), per: L('one-time payment', 'pago único'),
      bullets: [{ text: L('15-day free trial with every feature', '15 días de prueba gratis con todas las funciones') }], follow: L('', ''),
      specsTitle: L('', ''), specs: [], manualTitle: L('', ''), manualFile: L('', ''), manualLabel: L('', '')
    }
  },

  faq: {
    label: 'Preguntas frecuentes', icon: '?', group: 'Producto',
    desc: 'Preguntas que se abren al hacer clic, con un recuadro de soporte.',
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'items', label: 'Preguntas', type: 'list', itemLabel: 'Pregunta', fields: [{ key: 'q', label: 'Pregunta', type: 'text' }, { key: 'a', label: 'Respuesta', type: 'textarea' }] },
      { key: 'supportTitle', label: 'Título del recuadro de soporte (vacío = sin recuadro)', type: 'text' },
      { key: 'supportText', label: 'Texto del recuadro (el email va al final)', type: 'textarea' }
    ],
    defaults: {
      title: L('Questions', 'Preguntas'), items: [{ q: L('A question?', '¿Una pregunta?'), a: L('The answer.', 'La respuesta.') }], supportTitle: L('', ''), supportText: L('', '')
    }
  },

  buttons: {
    label: 'Botones', icon: '▭', group: 'Texto',
    desc: 'Una fila de botones.',
    fields: [{ key: 'buttons', label: 'Botones', type: 'list', itemLabel: 'Botón', fields: BUTTON_FIELDS }],
    defaults: { buttons: [{ label: L('Button', 'Botón'), link: '', style: 'red' }] }
  },

  social: {
    label: 'Redes sociales', icon: '@', group: 'Texto',
    desc: 'Un texto y los botones de Instagram y Discord.',
    fields: [{ key: 'text', label: 'Texto', type: 'text' }],
    defaults: { text: L('Follow Gavna for news and updates.', 'Sigue a Gavna para novedades.') }
  },

  contact: {
    label: 'Formulario de contacto', icon: '✉', group: 'Formularios',
    desc: 'El formulario de contacto (uno por página).',
    fields: [{ key: 'title', label: 'Título', type: 'text' }, { key: 'text', label: 'Texto', type: 'textarea' }],
    defaults: { title: L('Contact', 'Contacto'), text: L('Write to us.', 'Escríbenos.') }
  },

  productbar: {
    label: 'Barra del producto', icon: '≡', group: 'Encabezados',
    desc: 'Barra fija con el logo del producto, links a secciones y el botón de descargar o comprar.',
    fields: [
      { key: 'name', label: 'Nombre del producto (lo leen Google y los lectores de pantalla)', type: 'plain' },
      { key: 'logo', label: 'Logo', type: 'image' },
      { key: 'logoLink', label: 'El logo lleva a', type: 'link' },
      { key: 'links', label: 'Links', type: 'list', itemLabel: 'Link', fields: [{ key: 'label', label: 'Texto', type: 'text' }, { key: 'link', label: 'Lleva a', type: 'link' }] },
      { key: 'button', label: 'Botón (se muestra "Comprar" si hay link de compra; si no, "Descargar")', type: 'toggle' }
    ],
    defaults: { name: 'Gavna Music Composer', logo: L('img/music-composer-logo.svg', 'img/music-composer-logo.svg'), logoLink: '', links: [], button: true }
  },

  spacer: {
    label: 'Espacio', icon: '↕', group: 'Texto',
    desc: 'Espacio vacío, con o sin línea.',
    fields: [
      { key: 'size', label: 'Alto', type: 'select', options: [['m', 'Mediano'], ['s', 'Chico'], ['l', 'Grande']] },
      { key: 'line', label: 'Con una línea', type: 'toggle' }
    ],
    defaults: { size: 'm', line: false }
  }
};

// The typefaces a block can use are the files in src/fonts: server.js adds one
// option per family when it sends this list to the panel, and build.js writes
// their @font-face rules (css/fonts.css). Fonts are always served from this
// site, so a page never asks another server for one.
const FONT_OPTIONS = [['', 'La del bloque']];

// The "Estilo" tab, the same for every block
const STYLE_FIELDS = [
  { key: 'bg', label: 'Fondo', type: 'select', options: [['', 'El del bloque'], ['none', 'Sin fondo'], ['alt', 'Franja gris'], ['dark', 'Más oscuro'], ['glow', 'Brillo rojo']] },
  { key: 'padTop', label: 'Espacio arriba', type: 'select', options: [['', 'El del bloque'], ['0', 'Nada'], ['s', 'Chico'], ['m', 'Mediano'], ['l', 'Grande'], ['xl', 'Muy grande']] },
  { key: 'padBottom', label: 'Espacio abajo', type: 'select', options: [['', 'El del bloque'], ['0', 'Nada'], ['s', 'Chico'], ['m', 'Mediano'], ['l', 'Grande'], ['xl', 'Muy grande']] },
  { key: 'width', label: 'Ancho del contenido', type: 'select', options: [['', 'El del bloque'], ['narrow', 'Angosto'], ['normal', 'Normal']] },
  { key: 'align', label: 'Alineación', type: 'select', options: [['', 'La del bloque'], ['left', 'Izquierda'], ['center', 'Centrada']] },
  { key: 'fontTitle', label: 'Fuente de los títulos y cifras', type: 'select', options: FONT_OPTIONS },
  { key: 'fontText', label: 'Fuente del texto', type: 'select', options: FONT_OPTIONS },
  { key: 'fontWeight', label: 'Grosor de la letra', type: 'select', options: [['', 'El del bloque'], ['400', 'Normal'], ['500', 'Medio'], ['600', 'Seminegrita'], ['700', 'Negrita']] },
  { key: 'italic', label: 'Letra cursiva', type: 'toggle' },
  { key: 'fontSize', label: 'Tamaño de la letra', type: 'select', options: [['', 'El del bloque'], ['xs', 'Mucho más chica'], ['s', 'Más chica'], ['l', 'Más grande'], ['xl', 'Mucho más grande'], ['xxl', 'Enorme']] },
  { key: 'border', label: 'Línea arriba', type: 'toggle' },
  { key: 'show', label: 'Mostrar en', type: 'select', options: [['', 'Computadora y celular'], ['desktop', 'Solo computadora'], ['mobile', 'Solo celular']] },
  { key: 'anchor', label: 'Ancla (para links como #precio; letras, números y guiones)', type: 'plain' }
];

// a page's own settings (title for Google, menu…)
const PAGE_FIELDS = [
  { key: 'title', label: 'Título de la pestaña y de Google', type: 'text' },
  { key: 'description', label: 'Descripción para Google y redes', type: 'textarea' },
  { key: 'image', label: 'Imagen al compartir en redes', type: 'image' }
];

module.exports = { BLOCKS, STYLE_FIELDS, PAGE_FIELDS };
