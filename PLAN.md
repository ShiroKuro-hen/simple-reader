# simple-reader — plan de desarrollo

Lector de PDF y EPUB, **muy automatizable y muy personalizable**. Idea central: el lector es una app pequeña encima de un *núcleo sin interfaz* que se puede manejar por CLI, API local, reglas y scripts. Todo lo que se puede hacer con un clic se puede hacer sin abrir la ventana.

## 1. Qué hay ya (y qué robar)

| Herramienta | Lo bueno | Qué tomamos |
|---|---|---|
| [Readest](https://github.com/readest/readest) (Tauri v2 + Next.js, AGPL-3.0) | Paginado/scroll, resaltados y notas, búsqueda en toda la biblioteca, diccionarios propios, traducción (DeepL), TTS, OPDS/Calibre, sync con KOReader, teclado y lectores de pantalla | Plan de funciones y el motor de render |
| [foliate-js](https://github.com/johnfactotum/foliate-js) | Renderiza EPUB, MOBI/AZW3, FB2, CBZ y PDF (experimental, vía PDF.js) sin cargar todo el archivo. **No** admite scripts por seguridad; su lector de ejemplo está muy incompleto | **Motor de render** (no escribir uno propio) |
| [KOReader](https://github.com/koreader/koreader) | Reflujo de PDF escaneados (K2pdfopt), CSS y tipografías propias, OPDS, RSS, Wallabag, plugins | Reflujo de PDF y estilos por libro |
| Obsidian + Readwise / Zotero | Exportan resaltados con plantillas (Jinja2), sin duplicados al repetir, con enlace a la posición exacta. En Zotero esa exportación sale desordenada y pierde el enlace al PDF | **El diferencial**: exportar bien y automático |
| Calibre / Calibre-Web | Gestión de biblioteca, conversión, metadatos | No competir: hablar OPDS/Calibre |

**Hueco que aprovechamos:** los lectores buenos son cerrados (no se programan) y las herramientas programables (Calibre, scripts de Obsidian) no son lectores. Nosotros: lector + automatización de primera clase.

## 2. Decisiones (cambiables)

- **TypeScript en todo.** Núcleo (`core/`) sin DOM, reutilizable en CLI y app.
- **Render:** foliate-js (EPUB) + PDF.js (PDF). No se escribe motor propio.
- **Una sola base de código (web app, Vite) para las tres plataformas:** navegador/PWA, escritorio y APK con **Tauri v2** (Windows/macOS/Linux y Android desde el mismo proyecto; Readest hace igual). Se empaqueta en la fase 5, pero desde la fase 1 todo el código de archivos pasa por una sola interfaz `Storage` para no reescribir después.
- **Sin servidor y sin base de datos remota (local-first):**
  - **Libros = archivos.** Web: OPFS (disponible en Chrome/Edge 86, Firefox 111, Safari 15.2). Escritorio/Android: carpeta de la app o una carpeta que elijas.
  - **Metadatos, progreso y anotaciones = un JSON por libro** (`<hash-del-libro>.json`), más un índice `library.json`. Son pocos KB; se pueden abrir, copiar y versionar a mano. Sin SQLite al inicio; búsqueda en toda la biblioteca con un índice en memoria (MiniSearch/FlexSearch) reconstruible.
  - El libro se identifica por **hash del contenido**, no por nombre, así el mismo EPUB en tres dispositivos comparte anotaciones.
- **Sincronización opcional, sin servidor propio** (fase 5), de menos a más esfuerzo:
  1. Carpeta compartida (Syncthing / Drive / Dropbox sincronizando la carpeta de la biblioteca) — escritorio y Android.
  2. **WebDAV** (Nextcloud, Synology, Koofr…): funciona también desde la web y es lo que usan lectores como KOReader.
  3. Almacenamiento S3 propio (p. ej. Cloudflare R2) con tus claves.
  Solo se sincronizan los JSON pequeños por defecto; los libros, si lo activas. Fusión por marca de tiempo de cada anotación (no se pierde nada al editar en dos dispositivos).
- **GitHub no sirve para los EPUB** (archivos grandes, 100 MB por archivo). Sí sirve como respaldo opcional de **anotaciones** en texto.
- **Limitación de la web:** el navegador puede borrar datos si falta espacio. Pedir `navigator.storage.persist()` y ofrecer **exportar/importar la biblioteca** como ZIP. El selector de carpetas del navegador (File System Access API) solo existe en Chromium (dato de mi conocimiento, no lo verifiqué ahora), así que en Firefox/Safari se importa por archivo y se respalda por ZIP.
- **Licencia:** si reutilizamos código de Readest (AGPL-3.0) el proyecto debe ser AGPL. Mirar foliate-js (MIT) antes de copiar nada de Readest.
- **Seguridad de scripts:** foliate-js prohíbe scripts dentro del libro. Los scripts del usuario corren **fuera** del iframe del libro y solo hablan con la API del núcleo.

## 3. Fases

Cada fase termina con algo usable y una prueba de humo.

### Fase 0 — Esqueleto (1–2 días)
- Repo, `README`, `PLAN.md`, Vite + TS, lint/format, CI mínima (typecheck + test).
- Interfaz `Storage` (leer/escribir archivo, listar) con la implementación web (OPFS) ya; la de Tauri entra en la fase 5.
- **Hecho cuando:** `npm run dev` abre una página vacía, el CI pasa y un APK de prueba de Tauri abre esa misma página en un teléfono.

### Fase 1 — Lector mínimo (1 semana)
- Abrir EPUB y PDF por arrastrar/soltar o desde archivo.
- Paginado y scroll, tabla de contenidos, ir a página, recordar la última posición.
- Tema claro/oscuro/sepia, tamaño de letra, fuente, márgenes. Teclado completo.
- **Hecho cuando:** se lee un EPUB y un PDF de 500 páginas sin lag y se reabre donde se dejó.

### Fase 2 — Biblioteca y anotaciones (1–2 semanas)
- Importar carpeta (varios libros a la vez), portadas y metadatos, etiquetas y estantes, búsqueda.
- Resaltados (colores), notas, marcadores. Búsqueda dentro del libro y en toda la biblioteca.
- Anotaciones guardadas como datos propios con anclaje estable (CFI en EPUB, página+rectángulo en PDF).
- **Hecho cuando:** 200 libros indexados y se busca una frase en todos.

### Fase 3 — Núcleo automatizable (el corazón, 2 semanas)
- **CLI** `sr`: `sr import <carpeta>`, `sr list --tag x`, `sr highlights <libro> --format md`, `sr open <libro>`.
- **API local** (HTTP en `127.0.0.1`, con token) con los mismos comandos; eventos (`book.opened`, `highlight.created`, `progress.changed`).
- **Exportación con plantillas** (Markdown/JSON/CSV; plantilla tipo Jinja/Handlebars) que **no duplica al repetir** y deja enlace a la posición exacta. Destino: carpeta de Obsidian, archivo, URL (webhook).
- **Reglas** en un archivo (`rules.yml`): «cuando termine un libro → etiqueta `leído` y exporta resaltados»; «al importar de `~/Descargas` → completa metadatos y mueve a estante».
- **Hecho cuando:** un resaltado hecho en la app aparece solo, bien formateado, en una nota Markdown.

### Fase 4 — Personalización profunda (2 semanas)
- CSS propio por libro y global; perfiles de lectura (diurno, nocturno, escaneo rápido) que se cambian por atajo, hora o regla.
- Atajos y gestos redefinibles (archivo `keymap`), paleta de comandos.
- Scripts de usuario (JS) con acceso a la API del núcleo; lista de plugins con permisos declarados.
- Diccionarios propios (StarDict/Yomitan) y consulta a Wikipedia.
- **Hecho cuando:** se cambia un atajo y un perfil editando un archivo, sin tocar el código.

### Fase 5 — Escritorio, APK y sincronización (3 semanas)
- Tauri v2: instalador de Windows primero, luego **APK de Android** (misma base de código). Carpeta vigilada (`watch`) en escritorio, asociación con `.epub`/`.pdf` (Tauri ya soporta asociación de archivos en Android e iOS desde `tauri-build` 2.6).
- Web: PWA instalable y funcionando sin conexión (service worker).
- UI adaptable (táctil: gestos de pasar página, barras grandes) — probar pantalla de 360 px desde la fase 1.
- Sync opcional: carpeta compartida → WebDAV → S3, solo JSON por defecto.
- OPDS (leer catálogos de Calibre/Calibre-Web), importación de biblioteca de Calibre.
- **Hecho cuando:** se instala en Windows y en un teléfono, se lee el mismo libro y el resaltado hecho en uno aparece en el otro.

### Fase 6 — Extras (a pedido, por valor)
- TTS (voz del sistema; luego Piper local), traducción (DeepL / modelo local), resumen con IA de un capítulo, preguntas al libro.
- Reflujo de PDF escaneado y OCR (ocrmypdf/Tesseract como paso externo), MOBI/AZW3/FB2/CBZ.
- Modo lectura en paralelo (dos libros), regla de lectura / párrafo a párrafo, lectura rápida.
- Móvil (Tauri mobile o PWA).

## 4. Qué NO hacer (por ahora)
- Motor de render propio, conversión de formatos (Calibre ya lo hace), servidor de sincronización propio, DRM, tienda.
- IA y OCR antes de la fase 6: son opcionales y caros de mantener.

## 5. Riesgos
- **PDF en foliate-js es experimental:** si falla, PDF.js directo con una capa de anotaciones propia (más trabajo en fase 1–2).
- **Anclaje de anotaciones** si cambia el archivo (reedición de un EPUB): guardar también el texto citado y re-anclar por búsqueda difusa.
- **Licencia AGPL** si se toma código de Readest.
- **Tauri en Android:** sigue recibiendo correcciones (p. ej. un crash en `requestPermission` corregido en mayo de 2026), así que se prueba el APK en un teléfono real desde la fase 0 con una pantalla en blanco, no al final. Si da problemas, la capa `Storage` permite cambiar a **Capacitor** para Android sin tocar el resto (no comparé ambos a fondo).
- **Acceso a archivos en Android** (almacenamiento con alcance): no asumir rutas; importar por selector y copiar a la carpeta de la app.

## 6. Preguntas abiertas
1. ~~Plataforma~~ → resuelto: escritorio + web + APK, una sola base de código.
2. ¿«Automatizable» incluye integración con Obsidian/Notion/Anki, o solo archivos y webhooks?
3. ¿Uso personal o se publicará (decide licencia y cuánto pulir)?
4. ¿Alguna función de otros lectores que sí o sí quieras desde el día uno?
