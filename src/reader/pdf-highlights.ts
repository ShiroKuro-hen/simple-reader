// PDF highlights: where a selection sits on its page, as an Annotation.location: "<page>@x,y,w,h;x,y,w,h".
// Page is 1-based; every box is a fraction 0..1 of the page box, so highlights survive zoom and resize. Pure.

/** A box as fractions of the page: x and y from the top-left corner, w and h the size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A DOMRect-like box in viewport pixels. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EPS = 1e-9;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const contains = (outer: Box, inner: Box) =>
  outer.x <= inner.x + EPS && outer.y <= inner.y + EPS &&
  outer.x + outer.w >= inner.x + inner.w - EPS && outer.y + outer.h >= inner.y + inner.h - EPS;

export function encodeLocation(page: number, rects: Box[]): string {
  return `${page}@${rects.map((r) => [r.x, r.y, r.w, r.h].map((n) => n.toFixed(4)).join(',')).join(';')}`;
}

const NUMBER = /^\d+(\.\d+)?$/;

/** The page and boxes of a highlight location, or null for anything else (a bookmark's bare page, a CFI, damaged text). */
export function decodeLocation(location: string | undefined): { page: number; rects: Box[] } | null {
  const m = /^(\d+)@(.+)$/.exec(location ?? '');
  if (!m) return null;
  const page = Number(m[1]);
  if (page < 1) return null;
  const rects: Box[] = [];
  for (const part of m[2]!.split(';')) {
    const fields = part.split(',');
    if (fields.length !== 4 || !fields.every((f) => NUMBER.test(f))) return null;
    const [x, y, w, h] = fields.map(Number) as [number, number, number, number];
    if (x > 1 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) return null;
    rects.push({ x, y, w, h });
  }
  return { page, rects };
}

/** The page a location is on: a bookmark's page number or a highlight's page. */
export function pageOfLocation(location: string | undefined): number | undefined {
  if (location !== undefined && /^\d+$/.test(location)) return parseInt(location, 10);
  return decodeLocation(location)?.page;
}

/** Viewport boxes of a selection to fractions of the page. Drops what is off the page, and a box inside another one. */
export function normalizeRects(clientRects: ArrayLike<Rect>, page: Rect): Box[] {
  if (page.width <= 0 || page.height <= 0) return [];
  const boxes: Box[] = [];
  for (const r of Array.from(clientRects)) {
    const x0 = clamp01((r.x - page.x) / page.width);
    const x1 = clamp01((r.x + r.width - page.x) / page.width);
    const y0 = clamp01((r.y - page.y) / page.height);
    const y1 = clamp01((r.y + r.height - page.y) / page.height);
    const w = round4(x1 - x0);
    const h = round4(y1 - y0);
    if (w > 0 && h > 0) boxes.push({ x: round4(x0), y: round4(y0), w, h });
  }
  // A nested span's box lies in its parent's: keep the outer one, and of two equal boxes the first.
  return boxes.filter((b, i) => !boxes.some((o, j) => j !== i && contains(o, b) && (!contains(b, o) || j < i)));
}

/** The first box under the point (fractions of the page), if any. */
export function hit(rects: Box[], x: number, y: number): Box | undefined {
  return rects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}
