// kuromoji's browser loader downloads each *.dat.gz with XMLHttpRequest and gunzips it itself. Some servers
// (Vite's dev and preview servers among them) add `Content-Encoding: gzip` to .gz files, so the browser has
// already unzipped the bytes and kuromoji dies with "invalid file signature". This hands kuromoji gzip
// bytes whichever way the server behaves. Only requests under `base` are touched.

async function gzipBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url); // fetch undoes any Content-Encoding for us
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return bytes.buffer as ArrayBuffer;
  return new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

/** Runs `job` with XMLHttpRequest patched, then puts the original back. */
export async function withGzipTolerantXhr<T>(base: string, job: () => Promise<T>): Promise<T> {
  const Native = globalThis.XMLHttpRequest;
  class DictXhr extends Native {
    private dictUrl?: string;
    override open(method: string, url: string | URL, ...rest: any[]): void {
      // kuromoji builds URLs with path.join, which turns "http://host/" into "http:/host/"; resolving repairs it
      const resolved = new URL(String(url), location.href).href;
      this.dictUrl = resolved.startsWith(base) ? resolved : undefined;
      (super.open as any)(method, url, ...rest);
    }
    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      const url = this.dictUrl;
      if (!url) return super.send(body);
      gzipBytes(url).then(
        (response) => {
          Object.defineProperty(this, 'status', { value: 200 });
          Object.defineProperty(this, 'response', { value: response });
          this.onload?.(new ProgressEvent('load') as ProgressEvent<EventTarget>);
        },
        (err) => this.onerror?.(err),
      );
    }
  }
  globalThis.XMLHttpRequest = DictXhr;
  try {
    return await job();
  } finally {
    globalThis.XMLHttpRequest = Native;
  }
}
