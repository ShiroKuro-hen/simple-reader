// Test helper for the opt-in REAL_EPUB checks: pulls the largest chapter out of a user's own EPUB (a zip)
// in memory. The book is only ever read from where it lives; nothing is copied, stored or sent.
const node = (name: string): Promise<any> => import(/* @vite-ignore */ `node:${name}`);

export async function largestChapter(epubPath: string): Promise<string> {
  const { readFileSync } = await node('fs');
  const { inflateRawSync } = await node('zlib');
  const buf: Uint8Array = readFileSync(epubPath);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  let p = v.getUint32(eocd + 16, true);
  let best: { name: string; method: number; size: number; csize: number; offset: number } | undefined;
  for (let i = v.getUint16(eocd + 10, true); i > 0; i--) {
    const nameLen = v.getUint16(p + 28, true);
    const entry = {
      name: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)),
      method: v.getUint16(p + 10, true),
      csize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      offset: v.getUint32(p + 42, true),
    };
    if (/\.x?html?$/i.test(entry.name) && (!best || entry.size > best.size)) best = entry;
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  if (!best) throw new Error('no chapter in epub');
  const start = best.offset + 30 + v.getUint16(best.offset + 26, true) + v.getUint16(best.offset + 28, true);
  const data = buf.subarray(start, start + best.csize);
  return new TextDecoder().decode(best.method === 8 ? inflateRawSync(data) : data);
}
