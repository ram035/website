# Estado del proyecto — para retomarlo en otra conversación

Portfolio personal de Ramiro Piedrabuena.
Local: `H:\ramiropiedrabuena\website` · En vivo: https://ramiropiedrabuena.website

Para publicar, ver **DEPLOY.md**.

---

## Cómo correrlo

```
node server.js
```

- Sitio: http://127.0.0.1:4321/
- Panel: http://127.0.0.1:4321/admin/

Sin dependencias, sin build. Escucha sólo en `127.0.0.1`.

**Después de tocar `server.js` hay que reiniciarlo a mano.** Después de tocar
`css/` o `js/`, hay que subir el `?v=` en `index.html` (y en `admin/index.html`
para el panel), si no el navegador sirve la versión vieja.

---

## Arquitectura

Todo es vanilla, estilo ES5, sin frameworks.

| archivo | qué hace |
|---|---|
| `index.html` | superficie + overlay de proyecto. Todo el CSS/JS entra con `?v=` |
| `css/styles.css` | estilos del sitio |
| `js/app.js` | superficie: tokens, arrastre, rotación, filtros, idioma, efectos de hover |
| `js/project.js` | publicación: render de bloques, animación de apertura/cierre |
| `js/i18n.js` | idioma. `tx()` es **estricta**: sin traducción devuelve `""` |
| `admin/` | el CMS. No se publica |
| `server.js` | servidor local + API del CMS. No se publica |
| `data/projects.json` | todo el contenido |

### Modelo de datos

```
site: { title, ui: "dark"|"clear", background: {...}, tags: { category: [], industry: [] } }
projects: [{
  id, kind: "project"|"bulletin", theme, tags,
  title/subtitle/role: { es, en, esAuto },
  token: { image, hover, width, x, y, rotation, hoverFx, inkColor, watercolor },
  blocks: [...]
}]
```

- `x`, `y` son proporciones 0–1 del tamaño de la superficie: por eso el sitio
  es responsive sin media queries para los tokens.
- Los tipos de bloque: `text` (title/subtitle/body/quote), `image`, `video`,
  `lottie`, `embed` (youtube/vimeo/soundcloud/bandcamp/raw), `button`, `row`
  (1 a 6 columnas, cada celda es un bloque común), `divider`.

---

## Reglas que puso el usuario y que no se negocian

1. **Cero cruce entre idiomas en el sitio.** Si un texto no tiene versión en el
   idioma que se está viendo, no se muestra: ni traducido, ni en el otro
   idioma, ni el identificador interno. `I18N.tx()` es estricta a propósito.
2. **Nada de efectos que no pidió.** Nada de parpadeos, lifts, transiciones ni
   sombras agregadas "de yapa". Si se agrega algo visual, se dice.
3. **Alineación a la izquierda en un solo eje.** Los textos, títulos y botones
   comparten el borde izquierdo del bloque. Las imágenes y videos van
   **centrados**; los textos no. **Todo el post usa un solo ancho** (la
   columna entera, 1060 px útiles): el texto va del borde izquierdo de la
   primera imagen al derecho de la última. Antes el texto iba en 860 px
   centrados y arrancaba 100 px más adentro que las imágenes. Ya no existe el
   interruptor "Ancho completo" del panel; filas con separación fija de 18 px.
4. **No hay sombras.** Las sacó todas (tokens, textos del post, imágenes,
   video). El cálculo de la "luz virtual" que había quedado corriendo en cada
   cuadro sin usarse se eliminó en la auditoría (2026-09-24); si alguna vez
   quiere sombras, hay que rehacerlo.
5. **Verificar midiendo, no afirmando.** Espera números: contrastes, píxeles,
   proporciones. Decir "quedó bien" sin medirlo no le sirve.
6. **No editar `data/projects.json` por fuera del panel** mientras lo tiene
   abierto — su copia en memoria lo pisa al guardar. Ya perdió datos así.

---

## Traducción: inglés raíz, español rama

Modelo actual, pedido por él:

- **El inglés manda.** El panel abre en EN.
- Lo que escribe en inglés **baja solo al campo español**.
- En el área española, todo campo que todavía repite el inglés se muestra
  apagado y en cursiva **con un lápiz al lado**. Toca el lápiz, escribe, y ese
  campo queda suyo: el inglés no lo vuelve a pisar.
- **Vaciar el campo español suelta el candado** y vuelve a seguir al inglés.
- El candado es `esAuto` dentro de cada `{ es, en, esAuto }`.

El cruce ocurre **una sola vez, en el panel, y queda guardado en el dato**. El
sitio sigue leyendo sólo lo que tiene guardado. Por eso esto no contradice la
regla 1.

**Hashtags: crear y borrar viven sólo en inglés.** En español no hay campo de
alta ni cruz de borrar, sólo el lápiz. Permitir crear desde español fue lo que
le generó ocho hashtags donde debían ser cuatro, y costó una discusión entera.

**Hashtags en el sitio: sin títulos.** Se quitaron CATEGORY / INDUSTRY (la
etiqueta dejaba un hueco feo al partirse la fila). Todos los hashtags fluyen
en un solo bloque alineado a la derecha: primero los de categoría, después los
de industria. La índole es un dato del panel; en el sitio sólo cambia el
fondo: industria = el oscuro de ENG activo (`--ui-fill-on` + borde
`--surface-fg`). Elegido = relleno sólido `--surface-fg` con
`--ui-fg-invertido` (15,2:1), igual para los dos, porque con el oscuro de antes
una categoría elegida se veía igual que una industria sin elegir.

---

### Idioma con el que entra el visitante (2026-09-24)

`?lang=` del link → lo último que eligió (localStorage `rp-lang`) → **el de su
país** → inglés. El país lo sabe Netlify, no el navegador: en `_redirects`,
`geo/pais.json` se reescribe a `geo/es.json` en los 21 países hispanohablantes
y a `geo/en.json` en el resto. `app.js` sólo lo consulta si no hay elección ni
`?lang=`, en paralelo con los datos, y a los 1,5 s se rinde (inglés). En local
no existe `geo/pais.json`: entra en inglés (ese 404 en la consola es normal).
Ya no se usa el idioma del navegador.

---

## Efectos de hover de los tokens

Dos, independientes, se pueden usar juntos o por separado. Los dos se cortan en
seco al agarrar el token para arrastrarlo.

- **Rayones de lapicera** (`token.hoverFx = "scribble"`, `token.inkColor`):
  3 a 5 garabatos vectoriales que se dibujan solos, sorteados entre cinco
  familias (zigzag, bucles, recta, círculo, espiral). Nuevos cada vez. Al
  salir el cursor **se des-dibujan al revés** (`borrarRayones`): cada trazo se
  recoge hacia donde empezó, el último en aparecer primero; la capa queda
  visible con `.is-borrando` hasta que terminan.
- **Mancha de acuarela** (`token.watercolor = { on, colors[3], blend, layer, opacity }`):
  pintada en un `<canvas>` más grande que el token (margen 75%). Cada mancha
  es una pila de ~36 capas casi transparentes de un polígono deformado
  (técnica de acuarela generativa); tintas mezcladas en `multiply`; filo
  cargado en tramos; burbujas de sal, floraciones, granulado, salpicaduras;
  a veces una pincelada que rodea al token y termina en cerdas secas.
  Aparece por un **mapa de llegada**: el orden sale de la distancia al origen
  + ruido (la forma del frente), pero el tiempo se reparte **por cantidad de
  tinta** (rango acumulado del alfa). Sin eso casi todo el pigmento aparecía
  o se iba en un instante, y al salir del hover se veía un **pestañeo**
  (medido: 60%→0% en 0,25 s). Ahora crece ~11% cada 0,2 s y se retira ~22%
  cada 0,2 s, parejo. Al salir **se retira por donde vino**. Al entrar se
  llama a `mojar()` en el mismo instante: si no, se veía un cuadro con la
  mancha entera. El canvas no tiene transición de opacidad y tiene capa
  propia (`will-change`): un elemento con mix-blend-mode que cambia de capa
  puede dibujarse un cuadro sin mezcla.
  **El canvas es hermano del token, no hijo**: el token es un grupo aislado
  (transform + will-change) y adentro la mezcla no llegaba al papel — por
  fuera del dibujo la tinta quedaba plana, en modo normal. Ahora va en la capa
  de tokens justo antes (`layer: "under"`, detrás del dibujo, sin mancharlo)
  o justo después (encima); `place()` le copia el transform y `toFront()` el
  z-index. Así `blend` (multiply, color-burn, soft-light, darken, screen,
  overlay, normal) actúa contra el papel real **en los dos modos**, y el
  grano del fondo se ve a través de la tinta. `opacity` = intensidad (0,2–1).
  Con la pestaña oculta las transiciones CSS no avanzan: para capturas,
  apagar `transition`. **Ojo** con la deformación: sin topes
  (`rebeldía` ≤ 1.4, pasadas .3/.22) los polígonos crecían hasta 16× su radio
  y llenaban el canvas entero.

Los tokens son mapas de bits, así que no hay trazo que recorrer: los garabatos
se generan como vectores y por eso se pueden animar con el truco de la línea
punteada.

---

## Física de tejo (bloque "física de tejo" en `app.js`)

Los tokens se comportan como fichas de tejo. Decisiones del usuario:

- **Soltar con velocidad → desliza** y frena como un disco (ver "Calibrado").
  Soltar quieto no lanza.
- **Choque con la forma real del dibujo**, calculada sola al cargar cada imagen
  (`formaDeImagen`): la transparencia se parte en una grilla de 6×6 y cada
  casillero con dibujo da un polígono convexo. Nadie mide nada a mano al
  agregar un token. Imagen de otro dominio (canvas bloqueado) o token sin
  imagen → choca como rectángulo. Medido: el choque ocurre a <1px de que los
  dibujos se toquen. (El rectángulo de antes chocaba mucho antes: los dibujos
  llenaban sólo 41–80% de su caja.)
- Impulso en el punto de contacto con roce: **un golpe descentrado hace
  girar**. El giro se frena según el tamaño (`FRENO_GIRO`).
- **Calibrado** (primero "papel rugoso, no tan potente"; después "más
  realismo, como Soccer Stars"): frenado = roce constante `FRICCION` 900 +
  arrastre proporcional `ARRASTRE` 2,6/s (frena fuerte a toda velocidad y
  termina deslizándose suave, no se clava). REBOTE 0.55, REBOTE_BORDE 0.45,
  ROCE 0.12 (poco giro), VEL_MAX 2500 aplicado también después de cada
  choque. Medido: tiro a 1000 px/s recorre ~166 px (62→115→146→162→166 cada
  100 ms); choque de frente, la que golpea queda casi quieta (+15 px) y la
  golpeada sale y se desliza 173 px.
- **Velocidad del agarrado**: para golpear, la de su paso pero nunca más que
  la de la mano (`vMano`, suavizada). Al soltar, la de la mano, salvo que el
  token avanzara menos en el último cuadro (frenado contra algo). Antes el
  tiro usaba la velocidad del último micro-paso, que solía ser casi cero:
  los tiros salían débiles y desparejos (95 px en vez de ~200 a 1000 px/s).
  Ojo al medir desde el panel de Claude: los picos de muestras de 8 ms con
  rAF simulado exageran mucho la velocidad; medir recorridos o promedios.
- **Sólidos: NUNCA se enciman** (pedido explícito, después de probar dejar que
  se atravesaran: seguía habiendo atascos y vibración). Historia: primero el
  agarrado tenía masa infinita e iba pegado al cursor → se metía dentro de
  otros y, contra el borde, el de abajo vibraba (medido 9×14 px). Después se
  probó una regla de "atasco" que los dejaba atravesarse → también descartada.
- **El agarrado persigue a la mano** (`drag.objX/objY/objRot`, que escribe
  `onMove`; ya no posiciona él): avanza como mucho `PASO_MAX_PX` (6 px) por
  paso, con más pasos por cuadro si la mano va lejos (hasta `PASOS_MAX`), así
  nunca saltea a nadie. Pesa `MASA_AGARRADO` (2×) y no gira por choques.
  Empujón lento (< `GOLPE_MIN` 150 px/s) sólo desplaza; rápido, golpea.
- **Contacto sólido**: `ITERACIONES` (4) pasadas de choques por paso con
  corrección completa; lo que toca el borde queda `fijo` (masa infinita) en ese
  paso, así el que empuja se frena en el límite. Contra el borde, velocidades
  < 60 px/s se anulan en vez de rebotar (no tiemblan).
- **Encimados de entrada**: `separarEncimados()` los separa sin animación al
  cargar cada imagen, al cambiar el tamaño, al reordenar y al volver de un
  filtro. No se guarda: depende del tamaño de pantalla (los tokens miden px
  fijos y las posiciones son proporciones).
- Medido: apretado contra el borde, 0 px de vibración y 0 encimados; empujón
  lento arrastra 313 px; arrastre a 1500 px/s y tiro a 2500 px/s por el grupo,
  0 encimados.
- **Los filtrados por hashtag no juegan**: ni chocan ni se mueven.
- **Un clic abre el proyecto** (antes era doble clic / doble toque). Lo decide
  `onUp`: soltado sin moverlo más de `CLICK_SLOP` (5 px), antes de
  `CLICK_MAX_MS` (500 ms), y con `pointerup` (un `pointercancel` no abre).
  Mantenerlo apretado y soltarlo sin mover sigue sin abrir nada.
- **Movimiento reducido**: sin deslizamiento; el empujón directo sí.
- Al quedar todo quieto se guardan las posiciones de **todos** los que se
  movieron. "reordenar" frena todo.

Para probarlo desde el panel del navegador de Claude: si la pestaña está oculta,
`requestAnimationFrame` no corre y la física no avanza — no es un bug.

---

## Celular (hasta 720 px, mismo corte en CSS y JS: `CELULAR`)

- **Tokens en grilla** (elección del usuario sobre "estirar la composición" o
  "posiciones propias"; después pidió "más cerca y columnas más
  estructuradas"): 3 columnas alineadas (2 bajo 340 px), filas de 140 px,
  desorden mínimo (`GRILLA_JITTER` 8% de la celda) fijo por id, bloque
  centrado en el espacio libre y última fila incompleta centrada. El giro es
  el de escritorio. `posicionBase()` decide escritorio/celular;
  `reacomodar()` recalcula al girar, al cambiar de tamaño y de idioma, salvo
  lo que el visitante movió. Medido: 7 tokens en una sola pantalla sin scroll
  en 390×844 y 360×640.
- **Zona de firma + hashtags fuera de juego en celular**: `medirReserva()` la
  mide (cambia con idioma y cantidad de hashtags) y `stageSize().piso` es el
  límite para la grilla, la física y el arrastre.
- **z con techo** (`Z_TECHO` 45): el z de los tokens crecía en cada agarre y
  terminaba encima de la barra de abajo (80) y del post abierto (200). Al
  llegar al techo se renumeran conservando el orden.
- **Flechas de proyecto en una franja fija al pie** (48 px). La publicación
  termina arriba (`.project.tiene-nav .project__scroll{bottom}`), así nada
  queda tapado; sin flechas la franja no ocupa lugar. Antes: 67 px a media
  altura, encima del contenido. `baseDe()` en project.js no aplica el
  centrado vertical en celular.
- Con un post abierto se ocultan la firma, los idiomas y los hashtags: se
  leían dentro de la franja, a través del velo.

---

## Decisiones técnicas que costaron y conviene no repetir

- **La invariante de visibilidad de la publicación.** Con la publicación
  abierta y quieta, `.project__scroll` tiene `opacity:1 !important` y
  `transform:none !important`, y la regla se levanta sólo mientras corre una
  animación (clase `is-anim`). En la cascada, un `!important` del autor le gana
  a las animaciones. Esto existe porque un fotograma congelado
  (`fill: "forwards"`) de un cierre podía dejar el post invisible para siempre,
  con la cruz visible — el bug que él describió como "aparece sólo la cruz".
  **No quitar esta regla.**
- **Color detrás del fondo = promedio del papel (`#ebebeb`, medido).** Con
  `#0e0f0f` la página aparecía negra mientras cargaba la imagen y de golpe se
  ponía clara. Está en el CSS (`--surface-bg`), en los valores por defecto del
  panel y en `site.background.color` (ese lo cambia el usuario desde el
  panel). Si cambia la imagen, medir de nuevo.
- **El velo del post NO usa backdrop-filter.** Chrome a veces calculaba mal la
  zona a desenfocar al pasar de proyecto con las flechas (un iframe de Vimeo
  que se arma y se desarma) y aparecía un **rectángulo oscuro con sombra
  interior**. El desenfoque va ahora sobre `.stage` con la clase
  `body.is-desenfocado` (la pone `open()`, la saca `close()` al empezar).
  El papel del fondo ya no se desenfoca detrás del velo, sólo los tokens.
  Las capas de acuarela apagadas van con `display:none`.
- **El velo del post es opaco (80%) y no depende del tema.** Con 38% sobre
  fondo blanco el texto quedaba en 2,56:1, ilegible. Ahora da 11:1 sobre
  blanco y ~20:1 sobre oscuro.
- **La vista previa del panel copia la ventana real** (proporción y ancho), no
  una caja 16:9 de 1440px. Con la caja fija los tokens salían 32% más grandes
  y las distancias verticales 20% estiradas.
- **Las cortinas de aparición de las imágenes se vigilan desde la `<figure>`,
  no desde el `<img>`.** Un elemento totalmente recortado por `clip-path` tiene
  área de intersección cero y el observador nunca lo ve entrar en pantalla: se
  quedaba tapado para siempre.
- **Nitidez de las imágenes del post (`afinarImagenes` en project.js).** Se
  veían apenas borrosas comparadas con el visor de fotos: un archivo de 522 px
  en una celda de 521 se re-muestreaba entero, y las posiciones caían en
  decimales (y = 357,33, por los textos de arriba). Ahora: si al archivo le
  sobran ≤ 2 px se muestra a tamaño real (desborda medio píxel por lado), y
  cada imagen se corre con `translate` la fracción que la separa de la grilla
  de píxeles. Se recalcula al cargar cada imagen, al terminar de abrir, con un
  ResizeObserver del post y al cambiar el tamaño. Usa setTimeout (no rAF): en
  una pestaña de fondo no hay cuadros. Medido: 522×522 y 342×441 exactos, en
  enteros, también después de scrollear y de cambiar el tamaño.
  **Archivos más grandes que la celda** (ej. 865 px en 521): el navegador los
  achica blando. Se muestran a la celda redondeada a píxeles de pantalla
  enteros y el sitio genera una copia a esa medida exacta con **Lanczos-3**
  (premultiplicado por alfa; si el archivo es enorme, antes baja a ~2× con
  canvas), que se ve 1:1. Medido: bordes 14% más nítidos que el achique del
  navegador (2,24 vs 1,97). El suavizado "high" del canvas NO sirve: da lo
  mismo que el navegador. No toca animadas (GIF, WebP "ANIM", PNG "acTL") ni
  imágenes de otro dominio. Las copias (blob:) se liberan al cambiar de post.
- **Las imágenes del post tienen un gris de espera** (`rgba(127,127,127,.12)`)
  que se saca al cargar (`img.is-loaded`, lo pone `project.js`). Antes quedaba
  para siempre y se veía detrás de los PNG/WEBP con transparencia.
- **Los tokens se posicionan en píxeles enteros.** Con desplazamiento
  fraccionario el navegador interpola la capa y el dibujo se ve borroso.
- **AVIF animado en Chromium hace flashes** por el decodificador, no por el
  código. La mitigación fue exportar a 15fps y tener una imagen estática de
  base.

---

## Qué hay ahora

Tres proyectos: `proj0001` INFO (kind `bulletin`), `proj0002` TIME HARVEST,
`proj0003` Neosurrealism Study 001.

Los boletines son subpáginas de información: se ven como token en la superficie
pero **quedan fuera del paso anterior/siguiente**, que además respeta los
filtros de hashtag activos.

Vocabulario de hashtags: `illustration`, `graphic-design`, `sound-design`,
`animation` (categoría) y `personal` (industria). Los cinco bilingües.

Configuración actual: fondo `img/background-1.webp` repetido, tema de elementos
`dark`.

---

## Herramientas del panel que ya existen

- **Configuración** (barra lateral): fondo del sitio con todas las propiedades
  CSS y vista previa a escala real; tema de elementos claro/oscuro; y
  **archivos sin usar**, que lista lo que sobra en `projects/` y `img/` y lo
  mueve a `.papelera/` — nunca borra.
- **Reemplazos a la papelera, solos** (2026-09-25): al Guardar, el panel compara
  las rutas de lo último guardado + lo subido desde entonces con las de lo que
  guarda, y manda las que faltan a `POST /api/discard`. El servidor aparta a
  `.papelera/<fecha>/` sólo lo que existe y nada usa (ni projects.json ni
  index.html/css/js: por eso `img/background-1.webp` nunca se toca). Si no se
  guarda, no se mueve nada. Va en una llamada aparte para que guardar funcione
  aunque server.js sea viejo.
- **Hashtags en Configuración**: todo el vocabulario con inglés y español lado a
  lado y en cuántos proyectos está cada uno. Renombrar ahí lo cambia en todo el
  sitio (los proyectos guardan sólo el id). El español sigue al inglés hasta
  que se lo toca (`esAuto`). Cada fila tiene su cruz para borrar: saca el
  hashtag del vocabulario y de todos los proyectos, con aviso que lista cuáles.
  Hay un solo borrado en el panel (`borrarTag`), que usan las tres cruces (chip,
  "Editar nombres y traducciones", Configuración). Crear sigue viviendo en el
  proyecto, en inglés.
- **Los listeners de Configuración se registran UNA vez** (`iniciarFondo()`
  al arrancar, no dentro de `load()`). Antes `load()` —que corre de nuevo al
  crear, eliminar o renombrar— los duplicaba: el botón Configuración abría y
  cerraba en el mismo clic ("a veces no anda"), y subir fondo / mover a la
  papelera se ejecutaban repetidos. Además Configuración ya no es interruptor:
  siempre abre; para volver, se elige un proyecto.
- **El aviso de "sin guardar" no se pierde al cambiar de proyecto.** `saveAll`
  manda el archivo entero; antes, cambiar de proyecto preguntaba "¿cambiar
  igual?" y ponía `dirty = false` sin descartar nada, así que lo no guardado
  se perdía al recargar sin aviso. Crear y eliminar proyecto sí recargan del
  servidor: los dos avisan que lo no guardado se pierde.
- **Renombrar la carpeta de un proyecto** (botón junto a "Identificador"). Al
  crear, el nombre sigue siendo automático (`proj0008`); después se renombra
  libre. Lo hace el servidor (`POST /api/project/rename`) de una vez: carpeta,
  id y todas las rutas `projects/<viejo>/…` del JSON (también dentro de
  embeds). Si falla guardar, deshace el renombre. El nombre viejo queda en
  `project.aliases`: el sitio abre los links viejos (y corrige la dirección) y
  recupera la posición que el visitante le había dado al token. Antes de
  renombrar, el panel guarda lo pendiente (después relee el archivo). Al
  publicar: subir la carpeta nueva y borrar la vieja del hosting (DEPLOY.md §5).
- **Vista celular** (botón en la barra de arriba): el sitio real en un iframe de
  390 × 844 dentro de un marco de teléfono, así entra en su modo celular por
  las mismas reglas que un teléfono. Abre el post que se está editando (o la
  superficie), con Recargar; cierra con Escape o tocando afuera. Se achica
  si la ventana es baja (`--cel-escala`). Muestra lo **guardado**: si hay
  pendientes, guarda antes, igual que Previsualizar.
- Vista previa de posición de tokens con **siluetas de los demás proyectos**.
- Bloques divisibles en 1 a 6 columnas con la misma paleta de tipos en cada
  celda.
- Imágenes por URL externa (Behance, etc.), para no gastar hosting.

- **Cruz y flechas al apretar** (2026-09-26, v98): los botones de la publicación
  se reconocen por GEOMETRÍA. `alPulsar` los registra; un único `pointerdown` en
  la ventana (fase de captura) mira si el puntero cayó dentro del rectángulo de
  un botón visible (+4 px) y dispara ahí mismo. Nada puede quedarse con el clic:
  ni el achique de :active (soltar afuera perdía el `click`), ni una capa
  encima (navegador, extensión). Probado con un div transparente encima de la
  cruz que se traga los eventos: cierra igual. Dedo → `click` (toque completo);
  teclado → `click` detail 0. `close()` ignora pedidos mientras se cierra, y
  600 ms después de cerrar los tokens no se agarran (`recienCerrado`).
  El usuario navega con Opera (Claude in Chrome no llega a Opera).
- **Sin pestañeo al abrir un post** (2026-09-26, v101): `afinarImagenes` corre
  también DURANTE la animación de apertura (deshace el translate+scale de
  `.project__scroll` para medir; ancho de celda por `getComputedStyle`, que no
  lo toca la transformación), así que al terminar de abrirse cada imagen ya
  tiene medida, lugar y copia Lanczos definitivos. Las copias van en una cola
  (visibles primero), se decodifican aparte antes de cambiar el `src`, y el
  redondeo a píxel (`redondear`) no duda en x,5 (antes saltaba 1 px). Medido
  cuadro a cuadro en 6 posts, a 502 y 1905 px, dpr 1 y 1,25: 0 cambios
  visibles después de abrir.
- **Composición proporcional + aire inicial** (2026-09-26, v102, admin v55):
  `data.site.pantalla {w,h}` = pantalla en la que se armó la composición. El
  panel la anota al tocar cualquier geometría de token (`composicionTocada`) y,
  si falta, al cargar (marca cambios y avisa: hay que Guardar). El sitio
  (`escalaDiseno`) achica los tokens por min(1, ancho/ref.w, alto/ref.h): en
  pantallas más chicas la composición se ve igual, más chica; nunca agranda;
  en celular manda la grilla. `separarEncimados` deja AIRE_INICIAL = 7 px entre
  pares que siguen en su lugar de entrada (ninguno en `saved`); la física no
  cambia: en juego chocan y se tocan. Medido con píxeles reales: 1581×718 →
  escala 0,76, par más cercano 12,4 px; 1024×440 → 7,7 px.
- **Celular: hashtags nunca sobre tokens** (2026-09-26, v104): si la grilla no
  entra en una pantalla (superficie > alto de pantalla), `sizeSurface` pone
  `body.pagina-larga` y firma + hashtags pasan de `fixed` a `absolute` al final
  de la página (body `height:auto`, porque `html,body{height:100%}` los dejaba
  anclados a la primera pantalla). `medirReserva` mide alto + `bottom` de cada
  barra (vale en los dos modos), no su posición en pantalla. Medido en
  360×640, 411×700 (ES/EN) y 411×900 (entra: siguen fijas): 0 cruces.
- **Íconos de botón** (2026-09-26, sitio v105, admin v56/css v51): biblioteca en
  `img/button-icons/` (X, Instagram, web, YouTube, Facebook; negros). El
  servidor la lista en `GET /api/button-icons` y la excluye de "archivos sin
  usar" y de `/api/discard` (`archivosApartables`). La tarjeta de botón los
  ofrece en una fila (clic elige, otro clic quita) además de "Agregar ícono".
  En el sitio llevan `.project__btn__icon--biblioteca` y en posts oscuros
  (todo tema que no sea light) se invierten con `filter:invert(1)`.
  Para sumar un ícono: ponerlo en esa carpeta, aparece solo en el panel.
- **Tipos de página y ventanas apiladas** (2026-09-27, sitio v107, admin v58/css v52):
  - `kind`: `project` (portfolio), `page` (subpágina con bloques; el viejo
    `bulletin` se lee como `page` y el panel lo guarda así), `html` (archivo
    `.html` de la carpeta, en `p.html`, que se muestra en un iframe que llena
    la ventana: `.es-html`).
  - `token.show === false`: sin token en la superficie (app.js `conToken()`:
    grilla de celular y física cuentan sólo los que tienen). Las páginas no se
    filtran por hashtag ni entran en las flechas (`esPortfolio`).
  - Un link a `#/p/id` desde una ventana abierta abre esa página en OTRA
    ventana encima (project.js `abrirCapa`: clona #projectView, guarda el
    estado de la de abajo —el, current, players, copias, observador…— y lo
    recupera al cerrar). Se agranda desde el link (app.js `origenEnlace`; en
    una página HTML, project.js escucha los clics del iframe: `tomarOrigen`).
    Cruz/Esc en una ventana apilada = `history.back()`; "atrás" cierra hasta
    la página de la dirección (`cerrarHasta`). Volver a la superficie cierra
    todas. Velo de ventana apilada: .95.
  - Panel: tarjeta "Tipo de página" arriba (qué es + token sí/no, avisa desde
    dónde se llega o que nadie llega), oculta lo que no corresponde; editor
    HTML con vista previa en vivo (`<base>` a la carpeta), lista de archivos
    para insertar, subir, "Nueva página" (plantilla), Guardar HTML / Ctrl+S.
    Botón: selector "Página del sitio" → `#/p/id`.
  - Servidor: `GET /api/project/files`, `PUT /api/project/html`; los .html
    sin caché; la carpeta de una página `html` entera cuenta como en uso
    (no la toca "limpiar" ni el descarte automático; el zip la incluye).
  - `_headers`: la CSP va sólo a `/` e `/index.html`; las páginas HTML del
    autor pueden traer sus propios scripts.
- **Grilla de celular de 5** (2026-09-27, v109): 5 columnas (4 si < 340 px),
  celdas cuadradas (`celdaGrilla()` = ancho útil / columnas, también alto de
  fila; se fue GRILLA_FILA 140). Cada token se achica para que su lado mayor
  no pase de GRILLA_CUPO (0,84) de la celda (`escalaCelular`, sólo celular;
  nunca agranda). Si no entran en una pantalla, la página crece (pagina-larga).
  Medido con píxeles reales: 390×780 y 360×640 → 0 encimados (par más
  cercano 7,6 / 8 px), 0 cruces con firma y hashtags.
- **Direcciones cortas** (2026-09-27, sitio v110, admin v60/css v56): Configuración
  → "Direcciones cortas" (`data.site.atajos = [{desde, hacia}]`). server.js las
  resuelve (`resolverAtajo`: exacta, luego carpeta corta → carpeta real; un
  archivo real siempre gana; con o sin barra final) y lista archivos en
  `GET /api/site-files`. El empaquetado escribe las reglas 200 en `_redirects`
  (ver DEPLOY.md). El selector "Página del sitio" del botón las ofrece en su
  grupo. Los links "/…" de un botón respetan "Abrir en otra pestaña".
  MIME .pdf agregado al servidor local.
- **Sección "Páginas" del panel** (2026-09-27, admin v63/css v57): botón
  "Páginas" en el pie de la barra lateral. Lista todos los `.html` de
  `projects/*/` (por carpeta) y los edita visualmente: iframe con la página
  real (same-origin) en `designMode`, `styleWithCSS`. Barra: bloque
  (p/h1–h4/cita/pre), fuente (sistema, la del sitio, Georgia, mono y Google
  Fonts: Inter, Roboto, Montserrat, Space Grotesk, Lora, Merriweather,
  Playfair, IBM Plex Mono; el `<link>` se agrega a la página al usarla),
  tamaño en px (truco fontSize 7 → span con px), color y resaltado,
  B/I/U/S, alineación, listas, sangría, link (URL, archivos de la carpeta,
  direcciones cortas, páginas del sitio; otra pestaña), imagen de la carpeta o
  subida (ancho % y quitar al hacer clic en ella), separador, quitar formato,
  deshacer/rehacer. "Código" muestra/edita el HTML y al volver lo reescribe
  (doc.write; `marco.onload` corre una sola vez para no pisar el "sin
  guardar"). Guarda con "Guardar página" o Ctrl+S → PUT /api/project/html
  (serializa `<!doctype html>` + outerHTML; el formato del código fuente se
  reordena). "Nueva" crea desde plantilla en la carpeta de un proyecto. La
  tarjeta "Página HTML" de un proyecto tiene "Editar en Páginas".
- **Link del botón por idioma** (2026-09-27, sitio v111, admin v64): `url` de un
  botón (bloque o celda) es `{en, es, esAuto}` como el texto; uno viejo (string)
  se normaliza a los dos idiomas con `esAuto` (`urlML`). Campo "Link" con
  lápiz en ES. El selector "Página del sitio" escribe el del idioma que se
  edita. project.js lee `I18N.tx(b.url)` (acepta string viejo).
- **SVG sin tamaño + Lottie en reposo** (2026-09-27, sitio v112, admin v65):
  el panel lee el tamaño real de un .svg (`medidaSvg`: width/height, si no el
  viewBox; Illustrator exporta sin width/height y el navegador inventaba
  300×150 → 150 px). En el sitio, un token con Lottie de hover muestra en
  reposo su propio archivo; el Lottie aparece sólo con `.is-hover` (antes su
  fotograma 0 reemplazaba al dibujo y dejaba bordes desparejos).
- **Lottie de hover sin corte** (2026-09-27, v113): al salir el cursor la
  animación termina la vuelta en curso (`anim.loop = false` → evento
  `complete` → `lottieReposo`: cuadro 0 y se esconde). Si el cursor vuelve
  antes, sigue desde donde iba (`lottieEntrar`). La visibilidad la manda
  `.lottie-play` (no `.is-hover`). Funciones: lottieEntrar / lottieSalir /
  lottieReposo en app.js.
- **Piezas flotantes + trim** (2026-09-28, sitio v114, admin v66/css v58):
  `token.float = true` (panel: "Piezas flotantes al pasar el cursor"; avisa si
  el token no es .svg). app.js `prepararPiezas`: baja el SVG, lo limpia
  (sin script/foreignObject/on*), prefija ids y clases (Illustrator repite
  .st0/SVGID_1_) y lo pone en línea como `.token__piezas`, visible sólo con
  `.flota-on`. Piezas = formas sueltas (o grupos si hay > 40). `pasoFlotar`
  (rAF): avance propio por pieza (sube escalonada, baja pareja, sin saltos),
  elevación FLOTA.ALTO, falso 3D (scale por coseno + sesgo + torsión),
  vaivén. Trim: trazos sin relleno llevan pathLength=1 y dasharray/offset que
  los recortan desde las dos puntas y los estiran (FLOTA.TRIM). Con
  reducción de movimiento sólo se elevan. Agarrar el token lo baja.
- **Piezas flotantes v2: 3D real** (2026-09-28, v116): cada pieza va en su
  propia capa (`.token__pieza`: copia del SVG con las demás piezas
  `visibility=hidden`) dentro de `.token__piezas`, que lleva `perspective`
  (FLOTA.PERSPECTIVA × ancho del token) pero NO preserve-3d (así se respeta el
  orden del dibujo). Cada capa: translateZ (acercarse, "crece" leve),
  rotateX/rotateY/rotate, con origen en el centro de su pieza (getBBox +
  getCTM, `medirPiezas`). Movimiento con resorte por pieza (FLOTA.RESORTE,
  FLOTA.AMORT: rebote leve, sin saltos). Paralaje: las piezas de arriba del
  dibujo se acercan más. Trim ~3× más rápido y hasta 70 %.
- **Baile 3D (reemplaza a piezas flotantes y trim)** (2026-09-28, sitio v117,
  admin v67): `token.float` ahora mueve el ícono ENTERO (cualquier formato).
  app.js `bailar`/`pasoBaile`: resorte (BAILE.RESORTE/AMORT) que acerca la
  imagen (translateZ = BAILE.CERCA × ancho) y la hace girar rotateY ±LADO
  (26°) en bucle (BAILE.VUELTA 1,8 s) con cabeceo rotateX ±6°; perspectiva
  en el token (3 × ancho). Se aplica a `.token__img--base`; al terminar se
  limpia todo. Se quitaron capas por pieza y trim (CSS y JS). Panel: "Baile
  3D al pasar el cursor".
- **Física con tokens SVG macizos** (2026-09-28, v118): `formaDeImagen`
  primero mide cuánto llena el dibujo su contorno convexo; si ≥ MACIZO (0,78)
  la forma de choque es ese contorno único. La grilla 6×6 queda para dibujos
  con entrantes. Motivo: en formas macizas las celdas interiores son cuadrados
  que empujan sólo en horizontal/vertical y alternan de dirección → vibración
  y encimado. Medido con cuadros a 60 fps manejados a mano (el panel de
  prueba en segundo plano frena timers): Self Spreading → Burst 852 px
  encimados antes, 0 después; montón de 5 tokens: 0 movimiento tras
  asentarse, máx. 6 px de borde.
- **Token Lottie** (2026-09-28, sitio v119, admin v68): `token.image` puede ser
  un `.json` Lottie. app.js `cargarTokenLottie`: tamaño del archivo (w×h),
  `.token__anim` (div con clase token__img--base, así el baile 3D lo mueve),
  quieto en el cuadro 0; hover = lottieEntrar/lottieSalir (termina la vuelta
  y vuelve al cuadro 0; bucle según "Repetir en bucle" del hover). Forma de
  choque: el cuadro 0 serializado a imagen SVG (`formaDeLottie`). Si el token
  es Lottie, se ignora un Lottie de hover. Panel: el recuadro del token acepta
  .json; `ponerVista` muestra el cuadro 0 (lottie_light desde cdnjs en el
  panel) en tarjeta, mini-mapa, fantasmas y lista; readNatural lee w×h.
- **Botón "Armar zip para Netlify"** (2026-09-28, admin v69/css v59): en
  Configuración → "Publicar en Netlify". `POST /api/pack` (server.js
  `empaquetar`): chequea sintaxis (node --check), versiones ?v= y JSON; arma
  `_subir/` y `../ramiropiedrabuena-netlify.zip` (zip propio con zlib, rutas
  con "/"). Incluye lo que usan projects.json y el código, TODAS las páginas
  .html de projects/ y lo que ellas enlazan (links e imágenes, en cadena),
  y las carpetas de páginas tipo html. Agrega las direcciones cortas a
  `_subir/_redirects`. Informa tamaño, archivos, avisos (archivos que faltan,
  hashtags inexistentes) y lo que quedó afuera. Probado en copia: zip íntegro,
  74 archivos, sin admin/server.
- **Acuarela: nace debajo del token + colores fieles** (2026-09-28, v120–122):
  las fuentes del mapa de llegada están siempre dentro del token (al 60 % de
  su radio, en la dirección de cada mancha/pincelada; velocidades 0,75–1,25);
  salpicaduras a ≤ 0,6 × token de su mancha. Lavados y cerdas en source-over
  (con multiply el mismo color se oscurecía: #ff5221 salía #ff2416); la
  densidad se escala para que el 5 % más cargado cubra entero (tope ×1,45).
  Medido: tono pintado ≈ elegido; al 8 % de la animación la tinta está dentro
  del borde del token. (El último escalado no llegó a medirse.)
- **Trazos animados** (2026-09-28, sitio v123, admin v70): `token.strokes`
  (panel: "Trazos animados al pasar el cursor"; revisa el SVG y avisa si no
  tiene líneas). Estilo de los Lottie del portfolio: sólo las líneas (trazo
  sin relleno) se animan con trim: se borran hacia su final y vuelven desde
  su principio (ease exponencial ≈ curva 0,03 de AE), escalonadas (0,1 s),
  ciclo 1 s; las cerradas además giran. Al salir termina la vuelta. Copia en
  línea `.token__trazos` (svgEnLinea: limpia y prefija ids/clases), visible
  con `.trazos-on`; el baile 3D la mueve también. Los SVG actuales de los
  tokens NO tienen líneas (expandidas en Illustrator).
- **Trazos animados: en reposo sin líneas** (2026-09-28, v124): como el cuadro 0
  de los Lottie. Con el efecto activo se muestra siempre la copia en línea
  (`.trazos-on` desde que carga) con las líneas `visibility:hidden`
  (`ocultarLinea`). En su turno cada línea se dibuja desde su principio y se
  borra siguiendo su recorrido (antes era al revés); fuera de su turno,
  oculta. Verificado con la llave (Neosurrealism 002): reposo sin líneas,
  aparecen escalonadas con el cursor y vuelven a ocultarse.
- **Trazos animados más estilizados** (2026-09-28, v125): punta y cola del trim
  con ease cúbico de entrada y salida (`sedoso`); la cola sale TRAZO.RETRASO
  (0,32 s) después de la punta → un tramo viaja por la línea; cada recorrido
  TRAZO.DIBUJA (0,8 s); escalonado 0,16 s; pausa 0,35 s; ciclo por token =
  última demora + 0,8 + 0,32 + 0,35 (≈ 1,6 s con 2 líneas). Cerradas giran
  TRAZO.GIRO (¼ de vuelta). Medido con la llave: tramo máximo ≈ 78 % de la
  línea, segunda línea 0,16 s después, al salir quedan ocultas.
- **Acuarela por defecto: Debajo + Normal** (2026-09-28, sitio v127, admin v72):
  sin `layer` la tinta va debajo (`layer !== "over"`); sin `blend`, mezcla
  normal. El panel muestra esas opciones primero y las guarda al activar la
  acuarela. Tokens que ya tenían otra mezcla guardada la conservan.

- Token con Lottie de hover + trazos: mientras corre el Lottie se oculta también la copia en línea (.token__trazos); antes quedaba visible debajo y se veía un duplicado (flor de neosurrealism-study-001).

- Baile 3D mueve TODAS las capas visibles del token (CAPAS_BAILE: .token__img, .token__lottie, .token__trazos, .token__scribble). Antes sólo la base y la copia de trazos: con Lottie de hover, el Lottie quedaba quieto y la copia bailaba debajo (el "duplicado" de la flor de neosurrealism-study-001).
- Trazos al salir el cursor: ya no terminan la vuelta entera (con un roce, las líneas se dibujaban recién después y el token parecía quedar seleccionado). No empieza ninguna línea nueva y las que iban por la mitad terminan a TRAZO.PRISA (x2.4).
- Hover de tokens centralizado (hoverA/entrarHover/salirHover, listeners pointerover/pointermove/pointerout en document). Antes cada token usaba pointerenter/pointerleave: con el baile animando bajo el cursor, Chromium repetía pointerenter cada cuadro y a veces no mandaba pointerleave (medido: sí llegaba mouseleave), así que el token quedaba en hover con líneas/baile/tinta. Además onUp quitaba .is-hover sin apagar los efectos; ahora pasa el hover a lo que está de verdad bajo el cursor.
- Trazos animados PRENDIDOS POR DEFECTO en todo token SVG con líneas (en reposo sin líneas). Se apagan sólo con token.strokes === false (panel: "No"). "Sí" no se guarda (borra la clave). Motivo: Info (icons_1.svg) mostraba sus líneas blancas en reposo al estar guardado sin strokes.
- .trazos-espera: la imagen base de un SVG no se muestra hasta que se sabe si tiene líneas (evita el destello de líneas al cargar). Se quita si no hay líneas o si falla la carga.
- Acuarela: al PRENDERLA en el panel se fuerzan blend normal + layer under (antes conservaba la mezcla vieja guardada, p.ej. color-burn de Keysense). Con la acuarela apagada, el formulario muestra normal/debajo.
- Acuarela: color por defecto #ff5221 en las tres tintas (TINTA_DEFECTO en admin.js; fallback de coloresTinta en app.js). Al prenderla se ponen las tres en #ff5221; apagada, el formulario las muestra así.
- Al subir un archivo nuevo de token se borra token.strokes (vuelve a "Sí" por defecto): un "No" elegido para el archivo anterior dejaba las líneas del nuevo a la vista (human-genealogy quedó con strokes:false así). El aviso de SVG sin líneas ya no es alerta roja ni sugiere apagar.
- **Página de Keysense + legales para la Microsoft Store** (2026-09-29): `projects/keysense/` tiene `privacy-policy.{en,es}.html` y `terms.{en,es}.html` (copias de `H:\Keysense\App\store\legal\web\`; si cambian allá, copiar de nuevo). Direcciones cortas: `/keysense/privacy`, `/keysense/privacidad`, `/keysense/terms`, `/keysense/terminos` (la de privacidad en inglés es la URL que va en Partner Center). La página `keysense` (kind `page`) tiene título, texto y una fila de 3 botones (Soporte por mail, Privacidad, Términos) sin íconos: con ícono el botón mide 52 px y sin ícono 49 (medido). Se quitó `html: projects/keysense/test.html` (el archivo no existía). Falta: botón a la Store cuando la app esté publicada (https://apps.microsoft.com/detail/9PNNC3LF9ZQD).

- Sitio en mantenimiento: data.site.maintenance = { on, message: {en, es} }. Panel: tarjeta "Sitio en mantenimiento" en Configuración. Sitio: enMantenimiento()/mostrarMantenimiento() en app.js; con on, no se arma la superficie, sólo p.mantenimiento centrado (body.en-mantenimiento oculta stage, filtros, proyecto y reordenar); quedan fondo, firma y cambio de idioma. Textos por defecto en MANT_TEXTO (app.js y admin.js). Las páginas HTML de carpetas no se afectan.

- **Trazos animados: casilla "Extender trazo libre" + rotación movida** (2026-10-13, sitio v137, admin v79): `token.strokeFree` (true = libre; sin la casilla se borra la clave). Por defecto el trazo se recorta en el borde del SVG (`.token__trazos{overflow:hidden}`); con la casilla el token lleva `.trazos-libre` y vuelve `overflow:visible`. La casilla se muestra junto a "Repetir en bucle" sólo con trazos "Sí" y token SVG; al subir un archivo nuevo se reinicia. Medido: con los 13 SVG actuales ningún trazo sale del recuadro (0 px), así que el cambio casi no se nota en ellos. El control "Rotación inicial" pasó a ir justo debajo del selector "Al pasar el cursor" (y su casilla de bucle) y encima de "Rayones al pasar el cursor".
