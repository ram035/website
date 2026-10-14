# Portfolio — Ramiro Piedrabuena

Sitio: **https://ramiropiedrabuena.website**

## Cómo trabajar

Doble clic en `start.bat` (o en una terminal, dentro de esta carpeta):

```bash
node server.js
```

Y abrí:

- Sitio: http://127.0.0.1:4321/
- Panel de administración: http://127.0.0.1:4321/admin/

> El sitio **tiene** que verse a través del servidor (o de cualquier servidor web).
> Si abrís `index.html` con doble clic, el navegador bloquea la lectura de
> `data/projects.json` y no aparecen los tokens.

## Estructura

```
index.html             página principal (la superficie con los tokens)
css/styles.css         todos los estilos del sitio público
js/app.js              superficie: tokens, física, filtros, idioma, abrir proyectos
js/project.js          render de la página de proyecto
js/i18n.js             textos de interfaz en español e inglés
data/projects.json     TODO el contenido del sitio (lo escribe el panel)
img/background-1.webp  fondo repetido
projects/projXXXX/     archivos de cada proyecto (token + medios)
admin/                 panel de administración (no se sube al hosting)
server.js              servidor local + API del panel (no se sube al hosting)
```

## Cómo se usa el panel

1. **Agregar nuevo proyecto** (botón siempre visible arriba a la izquierda).
   Crea la carpeta `projects/projXXXX/` automáticamente.
2. **Token en la superficie**: soltás la imagen del token y arranca con el tamaño
   real del archivo en píxeles. El slider lo cambia y el botón *Volver al tamaño
   real del archivo* lo devuelve a su medida original. Después
   arrastrás el token dentro del mini-mapa para definir en qué sector del canvas
   aparece. La rotación inicial se ajusta con el control o con la rueda del mouse
   sobre el token del mini-mapa.
3. **Al pasar el cursor** (opcional): un segundo archivo que reemplaza al dibujo
   del token mientras el mouse está encima. Acepta tres cosas:
   - **PNG / WEBP / AVIF / JPG**: la de hover se funde encima de la base, que
     espera quieta y se apaga recién cuando la de arriba ya la tapó. Nunca hay
     un instante con las dos traslúcidas, que es lo que hacía parpadear al token.
     Conviene que las dos imágenes midan lo mismo.
   - **Animados (GIF, AVIF, WebP o APNG)**: el sitio mira los primeros bytes del
     archivo para saber si de verdad trae animación; si la trae, lo guarda en
     memoria y en cada hover arranca desde el primer cuadro, sin volver a
     pedirlo al servidor. El bucle lo decide el archivo, no se puede controlar
     desde el sitio.
   - **WebM** y **Lottie `.json`**: son los dos que dan control completo. Se ven
     siempre, quietos en el primer fotograma, y se reproducen al pasar el cursor;
     al salir vuelven al principio. La casilla **Repetir en bucle** elige entre
     repetir mientras el cursor está encima o reproducirse una sola vez y
     detenerse. El WebM además pesa poco y admite transparencia.

     **Trazos animados:** en los SVG con líneas, el trazo se recorta por defecto
     en el borde del SVG. La casilla **Extender trazo libre** deja que se salga
     de esos bordes.

     **Sobre Safari y iPhone:** WebKit reproduce WebM pero ignora el canal alfa,
     así que un token recortado se vería como un rectángulo negro. Para que eso
     no pase nunca, el sitio detecta WebKit y directamente no crea el video: el
     token queda estático y el archivo ni siquiera se descarga. Ojo que esto
     incluye a Chrome y Firefox en iPhone, que por dentro también son WebKit.
     Si querés la animación también ahí, hay que sumar un segundo archivo
     (AVIF animado o Lottie) como alternativa; avisá y se agrega.

   El tamaño del token lo sigue fijando la imagen principal: el archivo de hover
   se dibuja dentro de esa misma caja, así que conviene que midan lo mismo.
4. **Contenido de la página**: los botones `+` de arriba agregan un bloque de
   cada tipo — título, subtítulo, texto, cita, **imagen o archivo**, botón,
   YouTube, Vimeo, SoundCloud, Bandcamp y separador. Los bloques se reordenan
   arrastrando el manijero `⋮⋮`. Todos los bloques ocupan el ancho entero de
   la columna del post (1060 px útiles en escritorio) y comparten el mismo
   borde izquierdo; una imagen con menos píxeles queda a su tamaño, centrada.

   **Esa misma lista de tipos está disponible en cada columna**, con los mismos
   campos: un bloque se edita igual esté suelto o dentro de una columna. Las
   imágenes, videos y Lottie se suben desde la propia tarjeta, donde estén.

   **Cualquier bloque se puede dividir en columnas.** No es un tipo aparte: cada
   tarjeta tiene arriba un selector de 1 a 6. Al pasar de 1 a N, lo que ya había
   queda en la primera columna y las demás arrancan vacías; al volver a 1 se
   recupera tal cual. Cada columna puede llevar un texto (con su estilo), un
   archivo —imagen de cualquier formato, video o Lottie: el tipo sale de la
   extensión— o un botón. En celulares las columnas se apilan.

   El bloque **Botón** lleva texto (traducible), un link y un ícono opcional que
   subís como imagen o SVG. Usa el mismo lenguaje visual que *reordenar* y los
   botones de idioma de la home, pero más grande. Los links externos abren en
   otra pestaña salvo que destildes la opción.

   Ojo con el bloque de **Título**: si el primero del contenido dice exactamente
   lo mismo que el título del proyecto, no se muestra dos veces. Si dice otra
   cosa, se muestra.
5. **Hashtags**: hay dos tipos, *Categoría* e *Industria*. Los chips de cada
   grupo se tildan para asignarlos al proyecto. El campo de abajo crea uno nuevo
   (y lo asigna); *Editar nombres y traducciones* despliega la lista completa
   para renombrarlos en los dos idiomas o borrarlos. Borrar un hashtag lo saca
   de todos los proyectos que lo tuvieran.
6. **Guardar cambios** (o `Ctrl+S`). Escribe `data/projects.json`
   (deja una copia de seguridad en `data/projects.json.bak`).

## Qué ve el visitante

- Los tokens se dibujan 1:1, al tamaño en píxeles que tienen definido. Sólo se
  achican si no entrarían en la pantalla (más del 86% del ancho o el 72% del alto).
- En escritorio aparecen en la posición y rotación que definiste; en celular,
  en una grilla ordenada (ver abajo). No tienen sombra.
- Son fichas sólidas: se arrastran desde el centro, se rotan desde los bordes,
  se lanzan (deslizan y frenan como discos sobre una mesa) y chocan entre sí,
  nunca se enciman. El cursor es siempre la manito. Su disposición queda
  guardada en el navegador del visitante (`localStorage`); el botón
  **reordenar**, que aparece al final de la barra de abajo a la izquierda
  cuando movió algo, vuelve a la disposición original.
- Un clic (o un toque) abre el proyecto: soltarlo sin haberlo movido, antes de
  medio segundo. Si se lo arrastra o se lo mantiene apretado, no se abre. La
  ventana se maximiza desde el token, como un ícono de escritorio, y al
  cerrarla se encoge de vuelta hacia él. La cruz blanca de arriba a la derecha
  lo cierra. Si el sistema tiene activado *reducir movimiento*, aparece sin
  animación.
- **La publicación flota por encima de la superficie**, no es una sección
  aparte: el fondo es la misma mesa, desenfocada, detrás de un velo. Todo vive
  en una columna de 1140 px (1060 útiles) con un solo ancho: título, año y
  cliente, textos, imágenes y filas comparten el mismo borde izquierdo.
- **Idioma**: entra en español si el país del visitante es hispanohablante y en
  inglés en cualquier otro caso (lo resuelve Netlify por país, ver
  `_redirects`). Si el visitante eligió ENG o ESP, o el link trae `?lang=`,
  manda eso.
- **En celulares** los tokens van en una grilla de columnas alineadas que entra
  en una pantalla, y las flechas de pasar de proyecto van en una franja fija
  al pie del post. Arrastrar un token nunca scrollea la página.
- Cada proyecto tiene su propia dirección: `https://ramiropiedrabuena.website/#/p/proj0001`
- Abajo a la derecha están los hashtags, en dos filas: **Categoría** e
  **Industria**. Al clickear uno quedan a la vista sólo los tokens que lo tienen;
  el resto se apaga en el lugar, sin moverse. Se pueden combinar: dentro de una
  fila suman (categoría A **o** B), entre filas restringen (categoría A **y**
  industria C). Volver a clickear un hashtag lo saca, y **ver todos** limpia todo.
  Sólo aparecen los hashtags que algún proyecto está usando.

## Si un AVIF animado parpadea

Es un bug conocido de los decodificadores AV1 de Chromium (Chrome, Opera, Brave,
Edge): al decodificar secuencias AVIF pesadas aparece un destello blanco o negro
justo antes de que la imagen se pinte, y se manifiesta de forma distinta en cada
navegador y con cada placa de video. No es algo que el sitio pueda arreglar.

Lo que sí hace el sitio para no empeorarlo:

- El archivo de hover se decodifica cuando carga la página, no cuando pasás el
  cursor.
- A los AVIF **no** se les cambia el `src` para rebobinarlos (sí a los GIF), porque
  cambiarlo obliga a decodificar todo de nuevo en el peor momento.
- Las dos capas del token están promovidas a su propia capa de composición, así
  prender y apagar la opacidad no obliga a re-rasterizar.
- `server.js` cachea cinco minutos lo que está en `projects/` e `img/`, para que
  recargar no vuelva a pedir y redecodificar los medios. El código y los datos
  siguen sin cachearse.

Si aun así parpadea, las dos salidas reales son:

1. **Usar WebM** para esa animación. El video va por el decodificador de video,
   que es otro camino, está pensado para reproducir muchos cuadros seguidos y no
   tiene este problema. Además el sitio lo controla de verdad (arranca en el
   primer cuadro, bucle opcional).
2. **Reencodear el AVIF** en varios *tiles* en vez de uno solo. Si el archivo
   tiene un único `mdat` enorme, el decodificador tiene que tragárselo entero.

## Qué se recuerda entre visitas

No hacen falta cookies: el sitio usa `localStorage`, que es del mismo navegador
del visitante, no se envía al servidor y no caduca. Cuando alguien vuelve,
encuentra igual que como lo dejó:

- **La disposición de los tokens** (`rp-layout-v1`): posición y rotación de cada
  uno. Se borra únicamente con el botón **reordenar**.
- **El idioma elegido** (`rp-lang`), que *no* se borra al reordenar.

Los filtros por hashtag, en cambio, arrancan siempre limpios: si alguien vuelve
y encuentra la mitad de los proyectos apagados sin acordarse de por qué, es peor
que empezar de cero. Si preferís que también se recuerden, se cambia en un rato.

## Sitio bilingüe (español / inglés)

Abajo a la izquierda, junto a **reordenar**, están los botones **ENG** y **ESP**.
El idioma se elige en este orden: `?lang=es|en` en la URL → el último que eligió
el visitante → el idioma de su navegador → español.
Queda guardado en su navegador y también en la URL, así que
`https://ramiropiedrabuena.website/?lang=en#/p/proj0001` abre ese proyecto
directamente en inglés.

En el panel, arriba a la izquierda, hay un selector **Editando ES / EN**.
Los campos traducibles (título, subtítulo, rol, textos y epígrafes) muestran una
etiqueta con el idioma y cambian de contenido al pasar de uno a otro. Las
imágenes, videos, links y la posición del token son compartidos: se cargan una
sola vez.

En `data/projects.json` esos campos se guardan así:

```json
"title": { "es": "Proyecto uno", "en": "Project one" }
```

Los hashtags viven una sola vez en `site.tags`, y cada proyecto guarda nada más
los identificadores. Así un nombre se corrige en un solo lugar:

```json
"site":  { "tags": { "category": [ { "id": "diseno-sonoro", "es": "Diseño sonoro", "en": "Sound design" } ] } }
"tags":  { "category": ["diseno-sonoro"], "industry": ["musica"] }
```

**Los idiomas no se cruzan nunca.** Si un texto no está escrito en el idioma que
el visitante está viendo, no se muestra: ni el del otro idioma, ni el
identificador interno. Un bloque de texto sin traducir directamente no se dibuja
(un panel vacío es peor que el hueco), un token sin nombre traducido no muestra
su cartel, y un hashtag sin nombre en ese idioma no aparece en los filtros.

La contracara es que un proyecto a medio traducir se ve incompleto en el idioma
que falta. Eso es a propósito: así se nota qué queda por traducir, en vez de
quedar disimulado con texto del otro idioma.

## Publicar

Subí al hosting, en la raíz del dominio:

```
index.html  css/  js/  data/  img/  projects/
```

No hace falta subir `admin/`, `server.js`, `README.md` ni `start.bat`
(si los subís, el panel no va a funcionar online porque necesita Node —
el flujo es: editás en local, guardás, y subís `data/projects.json`
junto con los archivos nuevos de `projects/`).

Todas las rutas internas son relativas, así que funciona igual en la raíz del
dominio o dentro de un subdirectorio.
