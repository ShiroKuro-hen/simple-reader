// Browser-only metadata helpers (canvas, pdf.js). The EPUB reading lives in epub-info.ts.
const COVER_WIDTH = 240;

/** Shrinks a cover image to a small JPEG data: URL so the library index stays light. */
export async function coverDataUrl(image: Blob): Promise<string> {
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  canvas.width = COVER_WIDTH;
  canvas.height = Math.round((bitmap.height * COVER_WIDTH) / bitmap.width);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}

/** Title, author and a first-page thumbnail. Rejects if pdf.js cannot open the file. */
export async function readPdfInfo(file: Blob): Promise<{ title?: string; author?: string; cover?: string }> {
  const { pdfjs } = await import('../reader/pdfjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const info = ((await pdf.getMetadata()).info ?? {}) as { Title?: string; Author?: string };
    let cover: string | undefined;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: COVER_WIDTH / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      cover = canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      /* a book without a renderable first page just has no cover */
    }
    return { title: info.Title?.trim() || undefined, author: info.Author?.trim() || undefined, cover };
  } finally {
    void task.destroy();
  }
}
