/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string;

// Vite's `?url` import of a wasm file gives its emitted URL.
declare module '*.wasm?url' {
  const url: string;
  export default url;
}
