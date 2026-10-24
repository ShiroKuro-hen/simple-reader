import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// In the browser the worker is its own file. Node (the tests) cannot load that URL, so pdf.js runs its own worker there.
if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** A pdf.js loading task for `data`. Needs node_modules/pdfjs-dist/cmaps copied to public/pdfjs/cmaps; without it only CJK-encoded PDFs degrade. */
export const loadPdf = (data: Uint8Array) =>
  pdfjs.getDocument({ data, cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`, cMapPacked: true });

export { pdfjs };
