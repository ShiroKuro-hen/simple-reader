/**
 * How foliate-js lays out an EPUB page for a given window. foliate's own defaults (720 px measure, 1440 px
 * block, at most two columns, 48 px margin) leave big empty bands on large windows, and its 48 px top and
 * bottom margin is shorter than the toolbars that overlay the page.
 */
export interface PageGeometry {
  /** foliate's `max-inline-size`: the width of one column, before its own gap. */
  maxInline: number;
  /** foliate's `max-block-size`: the tallest the page may be. */
  maxBlock: number;
  /** foliate's `max-column-count`. */
  maxColumns: number;
  /** foliate's `margin`: the rows above and below the text, one value for both. */
  margin: number;
}

export interface PageLayoutInput {
  /** Stage size in px. */
  width: number;
  height: number;
  layout: 'auto' | 'single';
  /** Heights in px of the toolbars that are drawn over the page. */
  topBar: number;
  bottomBar: number;
}

const DEFAULT_INLINE = 720;
/** The widest a column gets: longer lines are hard to follow, and illustrations scale to the column. */
const MAX_INLINE = 900;
/** Wide windows get more columns instead of longer lines, up to this many. */
const MAX_COLUMNS = 3;
const DEFAULT_BLOCK = 1440;
const FOLIATE_MARGIN = 48;
/** Below this height the toolbars overlay the page: a landscape phone cannot spare the rows. */
const CLEARANCE_MIN_HEIGHT = 560;
const CLEARANCE_GAP = 8;
/** Narrower than this ratio of the height reads as one column; a wide window reads as two. */
const PORTRAIT_RATIO = 1.1;

export function pageLayout({ width, height, layout, topBar, bottomBar }: PageLayoutInput): PageGeometry {
  const usable = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  if (!usable) {
    return { maxInline: DEFAULT_INLINE, maxBlock: DEFAULT_BLOCK, maxColumns: layout === 'single' ? 1 : 2, margin: FOLIATE_MARGIN };
  }
  const oneColumn = layout === 'single' || width < PORTRAIT_RATIO * height;
  const maxColumns = oneColumn ? 1 : Math.min(MAX_COLUMNS, Math.max(2, Math.round(width / MAX_INLINE)));
  const bars = Math.max(finiteOr0(topBar), finiteOr0(bottomBar));
  const margin = height >= CLEARANCE_MIN_HEIGHT ? Math.max(FOLIATE_MARGIN, Math.ceil(bars) + CLEARANCE_GAP) : FOLIATE_MARGIN;
  return {
    maxInline: Math.max(DEFAULT_INLINE, Math.min(MAX_INLINE, Math.floor(width / maxColumns))),
    maxBlock: Math.max(DEFAULT_BLOCK, Math.floor(height)),
    maxColumns,
    margin,
  };
}

const finiteOr0 = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
