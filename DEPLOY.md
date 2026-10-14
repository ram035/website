# Publicar el sitio — procedimiento

Este documento es el guion del comando **`ejecuta pack for hosting`**.
Todo lo de acá está verificado sobre el sitio real, no supuesto.

---

## 1. Qué se sube y qué no

El sitio es **100% estático**. Verificado: no tiene ni una ruta absoluta, ni
una referencia a `localhost`, ni una llamada a ninguna API. Se sube por FTP y
anda.

### Va al servidor (~2,5 MB)

```
index.html
_headers      ← cabeceras de seguridad de Netlify (el original vive acá)
_redirects    ← reglas de Netlify: idioma por país (geo/pais.json)
geo/          ← es.json y en.json, lo que responde geo/pais.json según el país
css/
js/
img/
projects/
data/         ← sólo projects.json, no el .bak
```

### NO va al servidor

```
admin/        ← el CMS
server.js     ← el servidor local
start.bat
README.md
DEPLOY.md
.papelera/    ← si existe, es la basura de "limpiar archivos sin usar"
```

**`admin/` es el punto crítico.** El panel no tiene contraseña, y no la
necesita porque `server.js` escucha sólo en `127.0.0.1`. Si esa carpeta llega
al hosting, cualquiera que pruebe `tudominio.com/admin/` edita el sitio.
Subir `server.js` tampoco sirve de nada: en un hosting estático no corre.

---

## 2. Qué hace el comando `ejecuta pack for hosting`

1. **Armar la carpeta.** Crear `_subir/` en la raíz del sitio con exactamente
   los elementos de la lista de arriba (de `data/`, sólo `projects.json`;
   nunca un `geo/pais.json`: ese nombre lo resuelve Netlify por país). Y el zip
   `H:\ramiropiedrabuena\ramiropiedrabuena-netlify.zip` con eso adentro.
2. **Verificar antes de empaquetar:**
   - sintaxis de `js/app.js`, `js/project.js`, `js/i18n.js`;
   - que las versiones de caché (`?v=`) de `index.html` sean todas iguales;
   - que no haya rutas absolutas ni `localhost` en lo que se publica;
   - que `data/projects.json` sea JSON válido y que ningún hashtag asignado
     apunte a uno que no existe en el vocabulario;
   - que todos los archivos referenciados desde `projects.json`
     (`token.image`, `token.hover`, `src`, `icon`, el fondo) existan en disco;
   - que no queden archivos sin usar en `projects/` y `img/` (avisar, no
     borrar).
3. **Bumpear la versión de caché** de `index.html` si hubo cambios en
   `css/` o `js/` desde el último empaquetado. Sin esto, los visitantes que ya
   estuvieron siguen viendo la versión vieja.
4. **Informar el tamaño** de `_subir/` y la lista de lo que quedó afuera.

Nunca se sube nada automáticamente: el comando deja la carpeta lista y el
usuario la sube.

---

## 3. Seguridad

### Lo que ya está cubierto en el código (verificado)

- **Texto de los posts:** todo lo que se escribe en el CMS se escapa antes de
  dibujarse. No se puede inyectar HTML desde un post ni desde un epígrafe.
- **Embeds:** del código pegado sólo se extrae el `src`, y se descarta si no
  es `http`/`https`. Un `javascript:` no se dibuja.
- **Colores de tinta:** validados contra `#rrggbb` antes de entrar al SVG.
- **Servidor local:** las subidas sanean el nombre del archivo, los ids de
  proyecto están acotados a `[a-zA-Z0-9_-]{1,40}`, no se puede salir del
  directorio del sitio con `../`, y nada que empiece con punto se sirve.

### Lo que falta y es del hosting, no del código

1. **HTTPS obligatorio**, con redirección desde HTTP.
2. **Cabeceras de seguridad** — hoy no hay ninguna. Faltan:
   - `Content-Security-Policy`: scripts sólo propios; `frame-src` limitado a
     los proveedores que realmente se usan (Vimeo, YouTube, SoundCloud,
     Bandcamp); `img-src` propio más los CDN externos que se enlacen
     (Behance, por ejemplo).
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy` apagando lo que el sitio no usa (cámara, micrófono,
     geolocalización).
3. **Permisos de `data/projects.json`**: legible, no escribible.

**Hosting elegido: Netlify** (2026-09-24). Las cabeceras van en un archivo
`_headers` en la raíz de lo publicado; el empaquetado lo genera dentro de
`_subir/`. CSP: scripts propios + cdnjs (Lottie); `img-src`, `media-src`,
`connect-src` y `frame-src` abiertos a `https:` porque el panel permite
imágenes por URL externa y embeds de cualquier proveedor. Verificado sirviendo
`_subir/` con esas cabeceras: 7 tokens, 23 imágenes y 2 Vimeo, 0 bloqueos.
HTTPS lo pone Netlify solo (Let's Encrypt, con redirección).

### Trampas del empaquetado para Netlify (verificadas)

- **No usar `Compress-Archive` de PowerShell 5.1**: guarda las rutas con `\`
  y en Netlify (Linux) `css\styles.css` sería un archivo, no una carpeta. El
  zip se arma con Python `zipfile` y rutas con `/`.
- **No subir `data/projects.json.bak`**: el servidor local lo crea en cada
  guardado. Se copia sólo `data/projects.json`.
- El zip va con `index.html` en la raíz, no dentro de una carpeta.
- **Direcciones cortas** (Configuración → Direcciones cortas, en
  `data.site.atajos`): el empaquetado las agrega al final de `_redirects` de
  `_subir/`, primero la exacta (`/keysense/terms  /projects/keysense/terms.en.html  200`)
  y después una por carpeta corta (`/keysense/*  /projects/keysense/:splat  200`),
  para que los links relativos de esas páginas anden. Se saltean las que usan
  una carpeta del sitio (css, js, img, projects…) o apuntan a un archivo que no
  existe. El servidor local aplica las mismas reglas.
- **Páginas HTML de una carpeta** (tipo "Página HTML" en el panel): su carpeta
  va entera, aunque projects.json no nombre cada archivo (las imágenes las
  nombra el propio HTML). La CSP de `_headers` se aplica sólo a `/` e
  `/index.html`, para que esas páginas puedan traer sus propios scripts.

### Nota sobre `lottie`

`js/project.js` carga lottie-web desde `cdnjs.cloudflare.com` cuando un
proyecto tiene un bloque Lottie. Si se escribe una CSP, ese dominio tiene que
estar permitido en `script-src`, o los Lottie dejan de funcionar.

---

## 4. Trampa conocida: el panel abierto pisa los datos

`data/projects.json` no se edita nunca por fuera del CMS mientras el panel
está abierto. El panel tiene su propia copia en memoria, cargada al abrirlo, y
al guardar escribe esa copia entera encima del archivo. Cualquier cambio hecho
por afuera se pierde.

Ya pasó una vez: se perdió la configuración de los rayones de un token.

---

## 5. Si renombraste la carpeta de un proyecto

El botón **Renombrar** del panel cambia la carpeta en tu computadora
(`projects/proj0004` → `projects/surreal-sports-001`), el id y todas las rutas
de `data/projects.json`. En el hosting, en cambio, la carpeta vieja sigue ahí:

1. Subir la carpeta nueva y el `data/projects.json` nuevo.
2. Borrar del hosting la carpeta vieja (ya nadie la usa: los links viejos
   `#/p/proj0004` siguen andando porque el sitio guarda el nombre anterior como
   alias, no porque lean esa carpeta).

Si se sube sólo el JSON sin la carpeta nueva, el proyecto queda sin imágenes.
