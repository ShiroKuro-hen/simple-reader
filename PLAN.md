# simple-reader — plan de desarrollo

Lector **simple y local** de PDF y EPUB, con el manga (conjuntos de imágenes) como tope. Sin servidor, sin API, sin cuenta. Los libros son archivos en tu dispositivo.

## 1. Alcance

**Dentro:** leer bien PDF, EPUB y manga (CBZ / carpeta de imágenes); biblioteca; resaltados y marcadores; consulta de palabras (ya existe); copia de seguridad opcional; web, Windows y Android desde una sola base de código.

**Fuera, de forma permanente:** API local, CLI, reglas, scripts y plugins, webhooks, Anki/vocabulario, TTS, OCR, IA, OPDS, conversión de formatos, DRM, tienda. Si algo de esto se pide de nuevo, se discute antes de añadirlo.

## 2. Decisiones

- **TypeScript + Vite, sin framework de UI.** Una interfaz `Storage` para archivos (OPFS en web; carpeta de la app en Tauri).
- **Render:** foliate-js (EPUB, y CBZ si lo admite sin trabajo extra) + PDF.js (PDF). Sin motor propio.
- **Local-first:** libros = archivos; metadatos, progreso y anotaciones = un JSON por libro, identificado por hash del contenido.
- **Sync opcional:** solo el R2 que ya existe. No se añaden más backends.
- **Plataformas:** web/PWA, Windows y APK con Tauri v2.

## 3. Estado

Hecho: CBZ (derecha a izquierda, doble página, zoom, precarga), aviso de versión nueva en la app nativa, EPUB y PDF paginados, temas, tamaño de letra, una o dos páginas, consulta de palabras (traducción, lectura japonesa, furigana), biblioteca con búsqueda, etiquetas y orden, resaltados/notas/marcadores en EPUB, marcadores en PDF, exportar a Markdown, backup a R2, PWA sin conexión, builds de Windows y Android en CI.

## 4. Lo que falta (en este orden)

### A. Manga (la prioridad) — CBZ hecho en v0.2.0; faltan carpeta de imágenes, scroll vertical y probar en teléfono real
- **Abrir CBZ** (zip de imágenes) y **carpeta de imágenes**, ordenadas por nombre natural (`2` antes de `10`). Portada = primera imagen.
- **Dirección de lectura derecha a izquierda** por libro (por defecto en manga) y teclas que la respetan.
- **Una página o doble página** con la primera suelta, **ajustar a ancho / alto / ventana**, **zoom** con pellizco y doble toque.
- **Modo scroll vertical continuo** (webtoon).
- **Precarga** de las páginas siguientes y liberación de las lejanas para no agotar memoria en tomos grandes.
- **Recordar posición, marcadores y tema** igual que en EPUB/PDF.
- **EPUB de manga** (maquetación fija): comprobar que el modo de dos páginas y RTL funcionan.
- Hecho cuando: un tomo de 200 páginas se lee en el teléfono sin lag, en RTL, y se reabre donde se dejó.

### B. Lectura de texto
- **RTL y escritura vertical** en EPUB: hecho. Las teclas y los bordes siguen la dirección del libro, y Ajustes > Dirección del texto permite forzar horizontal.
- **Resaltados en PDF** (hoy solo marcadores).
- **Búsqueda dentro del libro.**

### C. Biblioteca
- **Importar una carpeta entera** de libros.
- **Series / volúmenes** agrupados y ordenados (clave para manga).
- **Búsqueda de texto en toda la biblioteca**, solo si el rendimiento con ~200 libros lo permite sin índice pesado.

### D. Nativo (hay que cerrarlo)
- Probar instalador de Windows y APK en equipos reales.
- Asociar `.epub` / `.pdf` / `.cbz` (ya está «Abrir con» en Android).
- Firmar las versiones.
- Comprobar que las consultas de palabras funcionan con el origen nativo.

### E. Pulido barato (a pedido)
- CSS propio y atajos redefinibles en un archivo, solo si se echan de menos.
- Diccionario propio (StarDict) para la consulta.

## 5. Riesgos
- **Memoria en manga:** tomos de cientos de imágenes; decodificar bajo demanda, no cargar el zip entero.
- **CBR (RAR):** se lee con `node-unrar-js` (MIT), cargado solo al abrir un RAR (unos 14 KB de JS y 86 KB de wasm comprimidos). Queda sin cubrir: RAR con contraseña y 7z. El presupuesto total de JS quedó con solo ~4 KB de margen.
- **PDF en foliate-js es experimental:** se mantiene PDF.js directo.
- **Anclaje de anotaciones** si el EPUB cambia: guardar también el texto citado.
- **Android:** probar siempre en teléfono real; acceso a archivos por selector, no por rutas.
- **Datos del navegador:** pedir `navigator.storage.persist()` y mantener exportar/importar la biblioteca.

## 6. Preguntas abiertas
1. ¿Uso personal o se publicará (licencia y pulido)?
2. ¿Manga en carpeta de imágenes además de CBZ, o basta con CBZ?
