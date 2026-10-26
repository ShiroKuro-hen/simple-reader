<div align="center">

<img src="docs/logo.svg" alt="simple-reader logo" width="96" height="96">

# simple-reader

**A local-first reader for EPUB, PDF and comics, with instant word lookup for language learners.**

[![CI](https://github.com/ShiroKuro-hen/simple-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/ShiroKuro-hen/simple-reader/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/bundled%20with-Vite-646cff.svg?logo=vite&logoColor=white)](https://vitejs.dev/)

[Live demo](https://shirokuro-hen.github.io/simple-reader/) · [Releases](https://github.com/ShiroKuro-hen/simple-reader/releases) · [Report an issue](https://github.com/ShiroKuro-hen/simple-reader/issues)

<img src="docs/screenshot.png" alt="simple-reader showing an EPUB with a word lookup popup" width="800">

</div>

## Overview

simple-reader keeps your books as plain files on your own device. There is no account, no server and no tracking. Select a word while reading to get its definition and a Spanish translation, and for Japanese its reading, romaji and optional furigana.

It runs in the browser as an installable, offline-capable PWA, and as a Windows and Android app built from the same code with Tauri v2.

## Contents

- [Features](#features)
- [Platforms](#platforms)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Optional cloud sync (Cloudflare R2)](#optional-cloud-sync-cloudflare-r2)
- [Word lookup](#word-lookup)
- [Architecture](#architecture)
- [Security and privacy](#security-and-privacy)
- [Development](#development)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Features

**Reading**
- EPUB (rendered with foliate-js), PDF (PDF.js) and CBZ/CBR comics. The container of a comic is detected from the file's bytes, and the RAR decoder loads only when a RAR is opened.
- Paginated reading with light, dark and sepia themes, adjustable font size, and one or two pages on wide windows.
- Vertical and right-to-left EPUBs keep their direction. Page-turn keys follow the book; Settings > Text direction can force horizontal.
- Comics read right to left by default, in one or two pages, with zoom and a vertical (webtoon) mode.
- In-book search with `Ctrl+F` for EPUB and PDF.

**Language learning**
- Select a word or phrase to see its definition and Spanish translation.
- Japanese: whole-word selection through a morphological analyser, hiragana reading, romaji, and a furigana-over-kanji mode. Definitions come from a bundled, trimmed JMdict.

**Library**
- Search by title, author, series or category (accent-insensitive and safe for Japanese), plus search inside the text of every book.
- Categories, favorites, a "Continue reading" shelf, sorting, and series shown as one card with their volumes in order.
- Import single files, whole folders (the folder becomes a series) or folders of images (packed into CBZ volumes).

**Notes**
- Four highlight colours, notes and bookmarks on EPUB and PDF, a side panel to browse them, and Markdown export.

**Sync and offline**
- Optional backup and sync to your own Cloudflare R2 bucket. Nothing is ever deleted; the newest reading position wins and highlights merge one by one.
- With a bucket configured, opening and leaving a book syncs its position and notes automatically.
- Books that exist only in the bucket can be listed and downloaded on demand.
- Works offline once installed.

## Platforms

| Platform | Status |
|---|---|
| Web app / PWA | Available, installable and offline-capable |
| Windows (Tauri v2) | Released through GitHub Releases; updates itself from a signed installer |
| Android (Tauri v2) | Released through GitHub Releases as an APK signed with the project key |
| macOS, Linux, iOS | Not planned |

The native apps register `.epub`, `.pdf`, `.cbz` and `.cbr` so books can be opened from the file manager ("Open with" and, on Android, "Share"). The Windows installer is not Authenticode-signed, so SmartScreen may warn. Android installs updates through the APK download shown in the app.

## Getting started

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev        # development server
npm run build      # typecheck and production build into dist/
npm run preview    # serve the production build
```

Native builds require [Rust](https://rustup.rs). For Windows, also the MSVC build tools and the WebView2 runtime:

```bash
npm run tauri dev
npm run tauri build
```

Android additionally needs JDK 17, the Android SDK (platform 36, build-tools 35) and NDK 27. The release builds are produced by `.github/workflows/tauri.yml`, which also applies the "Open with" and "Share" patch (`src-tauri/android-patches/`) and signs the APK.

## Usage

Open a book from the library screen with the file picker or by dragging a file in. Theme, font size, page layout and furigana mode are in Settings. The bookmark button and the annotations panel are in the reader's top bar, and the magnifier (or `Ctrl+F`) searches the whole book.

| Action | Keys |
|---|---|
| Next page | `→`, `PageDown`, `Space`, or click the right edge |
| Previous page | `←`, `PageUp`, `Shift+Space`, or click the left edge |
| Close the popup / show or hide the toolbars | `Esc` |
| Show the toolbars | `Tab` (on touch: tap the middle of the page) |

In vertical books the keys and edges follow the book, so the left edge goes forward. In Japanese text a click selects the whole word and furigana readings are never part of a selection; dragging still selects any phrase.

## Optional cloud sync (Cloudflare R2)

Sync copies books, metadata, reading progress, notes and settings to a bucket you own. R2's free tier is enough for a personal library.

1. In the Cloudflare dashboard open **R2**, create a bucket (for example `simple-reader`) and note your **Account ID**.
2. Create an **API token** (R2 > Manage API tokens) with **Object Read & Write** on that bucket. Keep the Access Key ID and Secret Access Key.
3. Add a **CORS rule** to the bucket (Settings > CORS policy), replacing the origin with the address where you run the app (`https://shirokuro-hen.github.io` for the hosted version). The rule is generated by `describeCors()` in `src/sync/r2.ts`, and network errors in the app repeat it.

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. In the app, open **Settings** and enter the account ID, bucket name, access key ID and secret access key.
5. Press **Back up now** to upload, or **Restore** on another device to bring everything over.

Neither button deletes anything on either side. Your keys are stored in your browser only and are used solely to sign requests to Cloudflare.

## Word lookup

Japanese text is analysed in the browser with [kuromoji](https://github.com/takuyaa/kuromoji.js) and [kuroshiro](https://github.com/hexenq/kuroshiro). The dictionary is large, so it is downloaded the first time you look up Japanese and cached afterwards. Reading and romaji then work offline.

Translations and definitions come from public services called straight from your browser, in this order: Chrome's built-in Translator when its model is installed, Google Translate's unofficial `translate.googleapis.com` endpoint, MyMemory, and es.wiktionary for Spanish definitions. Only the selected text is sent. The Google endpoint is not an official API and may change or be rate limited. To check that the providers still respond, run `LIVE=1 npx vitest run src/lookup`.

## Architecture

- **TypeScript and Vite**, no UI framework.
- **One `Storage` interface** for files: the browser's origin-private file system (OPFS) on the web and in the native webviews, and an in-memory implementation for tests.
- **Pure rules, thin I/O.** Decisions such as what to sync, which books are series, or what the service worker caches live in pure modules tested with real data. Network, DOM and storage code only moves bytes.
- **Tauri shell.** The Rust side is small: it hands the page the books the system asked to open and runs the signed desktop updater.
- **Bundle budget.** `npm run budget` fails the build when the shipped JavaScript grows past its limit.

## Security and privacy

- Books and notes stay on your device unless you configure R2.
- The page sets a Content-Security-Policy so scripts inside a book cannot run in the app's origin. Network access is limited to the lookup services, GitHub's release API and Cloudflare R2.
- The desktop updater accepts only installers signed with the project's key, and Android only installs an APK signed with the same key.
- The native app can read only the book files the operating system handed to it.

## Development

```bash
npm run typecheck   # TypeScript
npm test            # unit tests (vitest) and real-browser tests (Playwright)
npm run e2e         # end-to-end suites in Chromium
npm run budget      # bundle size check, after a build
```

Tests avoid mocks: domain rules are pure functions tested with real data, the sync layer runs against a real S3-compatible server in CI, and browser behaviour is checked in real Chromium. To try the reader on a real book of your own, set `REAL_EPUB` to its path for the opt-in specs; never commit books.

## Contributing

Issues and pull requests are welcome. Open an issue first for anything large so the approach can be agreed. Before sending a pull request, run `npm run typecheck`, `npm test` and, after a build, `npm run budget`.

Out of scope on purpose: local API, CLI, plugins, TTS, OCR, OPDS, and additional sync backends.

## Acknowledgements

- [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT) renders EPUB.
- [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0) renders PDF.
- [kuromoji](https://github.com/takuyaa/kuromoji.js) and [kuroshiro](https://github.com/hexenq/kuroshiro) provide Japanese readings.
- [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) decodes RAR comics.
- [aws4fetch](https://github.com/mhart/aws4fetch) signs S3 requests.
- [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) © the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/), used under [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html), converted with [jmdict-simplified](https://github.com/scriptin/jmdict-simplified).
- [Wiktionary](https://es.wiktionary.org) definitions, CC BY-SA, fetched at lookup time.
- Translations through Google Translate (unofficial endpoint), MyMemory and the Chrome built-in Translator when available.

## License

[MIT](LICENSE) © 2026 ShiroKuro-hen
