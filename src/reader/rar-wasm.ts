// The RAR decoder's WebAssembly. Vite emits it as its own file, so it is downloaded only when a RAR is opened.
import unrarWasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url';

/** undefined outside the browser: under Node (the unit tests) the decoder reads its own wasm from node_modules. */
export async function loadUnrarWasm(): Promise<ArrayBuffer | undefined> {
  if (typeof window === 'undefined') return undefined;
  const res = await fetch(unrarWasmUrl);
  if (!res.ok) throw new Error(`the RAR decoder could not be downloaded (HTTP ${res.status})`);
  return res.arrayBuffer();
}
