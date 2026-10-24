# Desktop (Windows) and Android builds

simple-reader ships as a [Tauri v2](https://v2.tauri.app) shell around the same Vite build that is deployed to GitHub Pages. The shell lives in `src-tauri/` and has no custom Rust code: it only opens the WebView on `dist/`.

- The Vite `base` is `./`, so the same `dist/` works on GitHub Pages and inside Tauri (`tauri.localhost`).
- Storage is OPFS (`src/storage/opfs.ts`), which WebView2 (Windows) and Android System WebView both provide, so no native file plugin is needed. Books and annotations live in the WebView's profile (per app, per user).
- Network lookups (translation, Wiktionary, optional S3/R2 sync) are plain `fetch` calls from the WebView and need the remote endpoints to allow the origin `http://tauri.localhost` (Windows/Android) via CORS, like any other web origin.

## CI (recommended)

`.github/workflows/tauri.yml` runs on `workflow_dispatch` and on pushes to the `tauri` branch.

| Job | Runner | Command | Artifact |
|---|---|---|---|
| `windows` | windows-latest | `npx tauri build` | `simple-reader-windows`: NSIS installer `simple-reader_<ver>_x64-setup.exe` and the portable `simple-reader.exe` |
| `android` | ubuntu-latest | `npx tauri android init --ci` then `npx tauri android build --apk --debug --target aarch64` | `simple-reader-android`: `app-universal-debug.apk` (arm64 only despite the name) |

`gen/android` is generated in CI and not committed. Cargo, Gradle and npm are cached. Download artifacts from the run page, or `gh run download <run-id>`.

## Building locally

Prerequisites: Node 22, [Rust](https://rustup.rs) stable, and for Windows the WebView2 runtime (preinstalled on Windows 11) plus the MSVC build tools.

```bash
npm ci
npm run tauri dev          # desktop window with the Vite dev server (http://localhost:5173)
npm run tauri build        # installer in src-tauri/target/release/bundle/nsis/
```

Android additionally needs JDK 17, the Android SDK (platform 36, build-tools 35) and NDK 27, with `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME` set, then:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android init
npm run tauri android build -- --apk --debug      # add --target aarch64 to build one ABI only
npm run tauri android dev                         # run on a connected device/emulator
```

Output: `src-tauri/gen/android/app/build/outputs/apk/`.

## Sideloading the APK

1. Copy `app-universal-debug.apk` to the phone (USB, cloud drive, `adb install app-universal-debug.apk`).
2. Open it from the file manager and allow "Install unknown apps" for that file manager when asked.
3. A phone with an arm64 CPU is required for the CI build (nearly every phone since 2017). For emulators (x86_64) build locally with `--target x86_64`.

The CI build is a debug build (R8 would strip the JavaScript bridge of the "Open with" patch) that is re-signed with our own key, so each release can update the previous one in place. Builds without the key (a fork, a run without secrets) stay debug-signed and need an uninstall before the next release, which deletes the library.

## The signing key

- The key is a PKCS12 file made with OpenSSL (no Java needed), valid for 10000 days, alias `simple-reader`. Its public SHA-256 is pinned in `.github/workflows/tauri.yml`: a build signed with anything else fails.
- Keep the keystore and its password somewhere safe (a password manager and an offline copy). **If they are lost the installed apps can never be updated**, only reinstalled.
- It reaches CI through two repository secrets, never the repository: `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.p12`) and `ANDROID_KEYSTORE_PASSWORD`.
- Make a new key with `openssl req -x509 -newkey rsa:2048 -sha256 -days 10000 -nodes -keyout key.pem -out cert.pem -subj "/CN=simple-reader"` and `openssl pkcs12 -export -inkey key.pem -in cert.pem -name simple-reader -out upload.p12`, update the secrets and the pinned SHA-256 (`openssl x509 -in cert.pem -noout -fingerprint -sha256`). Phones then need one uninstall.

Windows installers are unsigned too; SmartScreen will warn. Code signing needs a certificate (`bundle.windows.certificateThumbprint` or a signing command) stored as secrets in the same way.

## Opening books from the file manager (Windows)

The installer registers `.epub`, `.pdf`, `.cbz` and `.cbr` (`src-tauri/tauri.windows.conf.json`, so Android's manifest is untouched): "Open with" lists simple-reader, and it can be made the default there. A double-click starts the app with the path as an argument, or, if the app is already open, hands it over to that window (`tauri-plugin-single-instance`). The Rust side (`src-tauri/src/book_files.rs`) keeps the paths, and the page can read only those, through `take_opened_books` and `read_opened_book`. The page code is `src/native/desktop-open.ts`; Android keeps its own bridge (`incoming.ts`).

## Service worker note

A PWA service worker must not be registered inside Tauri. Register it only on `http(s):` origins and skip the Tauri ones:

```ts
const inTauri = '__TAURI_INTERNALS__' in window;
if ('serviceWorker' in navigator && !inTauri) navigator.serviceWorker.register('./sw.js');
```

Tauri already serves assets from the app bundle, and a service worker would cache stale versions across app updates.

## Known limits (v1)

- No `Cargo.lock` is committed yet; the first local `cargo` run creates one, commit it for reproducible builds.
- Only the arm64 APK is built in CI. File associations (`.epub`/`.pdf`) and a folder-watching feature are not wired up.
- App-level checks were run on CI only (builds); the APK has not been run on a device or emulator.

## The icon

The sources are `public/icon.svg` (the app icon) and `src-tauri/icons/source/foreground.svg` (the Android adaptive foreground; its background colour is in `src-tauri/icons/android/values/ic_launcher_background.xml`). To change the logo, edit them, render `icon.svg` to a 1024 px PNG and run `npx tauri icon <png>`, then render the foreground at 108/162/216/324/432 px into the `mipmap-*/ic_launcher_foreground.png` files and refresh `public/icons/`.
