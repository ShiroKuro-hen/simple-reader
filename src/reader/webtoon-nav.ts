// Webtoon strip rules: which page the reader is on, where a page starts, what stays decoded. Pure: heights in px.
// Pages are 1-based, like the rest of the comic reader.

/** Height of an unseen page, as a multiple of the column width (a tall strip page). */
export const DEFAULT_RATIO = 2;

/** Heights in px of every page. A page seen before keeps its own ratio of height to width; an unseen one takes the average. */
export function pageHeights(ratios: (number | undefined)[], width: number): number[] {
  const known = ratios.filter((r): r is number => r !== undefined);
  const estimate = known.length ? known.reduce((a, b) => a + b, 0) / known.length : DEFAULT_RATIO;
  return ratios.map((r) => (r ?? estimate) * width);
}

/** Distance in px from the top of the strip to the top of `page`. */
export function pageTop(heights: number[], page: number): number {
  return heights.slice(0, Math.max(0, page - 1)).reduce((a, b) => a + b, 0);
}

/** The page crossing the top third of the view, which is the page the reader is on. With a view height of 0, the page at the top edge. */
export function currentPage(heights: number[], scrollTop: number, viewport: number): number {
  const line = scrollTop + viewport / 3;
  let bottom = 0;
  for (let i = 0; i < heights.length; i++) {
    bottom += heights[i]!;
    if (line < bottom) return i + 1;
  }
  return Math.max(1, heights.length);
}

/** The pages to keep decoded: those touching the view, and one view height above and below it. */
export function pagesToDecode(heights: number[], scrollTop: number, viewport: number): number[] {
  const from = scrollTop - viewport;
  const to = scrollTop + 2 * viewport;
  const pages: number[] = [];
  let top = 0;
  heights.forEach((h, i) => {
    if (top < to && top + h > from) pages.push(i + 1);
    top += h;
  });
  return pages;
}

/** The scroll offset after one step: about 90% of the view, never past the start or the end (`max`). */
export function scrollStep(scrollTop: number, viewport: number, max: number, dir: 1 | -1): number {
  return Math.min(max, Math.max(0, scrollTop + dir * viewport * 0.9));
}
