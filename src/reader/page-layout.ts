/**
 * How foliate-js lays out an EPUB page for a window. Lines are kept to a comfortable length that grows with the font
 * size; wide windows get more columns instead of longer lines. foliate picks how many of `maxColumns` fit.
 */
export interface PageGeometry {
  /** foliate's `max-inline-size`: the longest a line may be. */
  maxInline: number;
  /** foliate's `max-block-size`: the tallest a horizontal page (the widest a vertical one) may be. */
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
  /** The reader's font size setting, in percent. */
  fontSize: number;
  /** The section on screen is written top to bottom (vertical Japanese). */
  vertical: boolean;
  /** Heights in px of the toolbars that are drawn over the page. */
  topBar: number;
  bottomBar: number;
}

const DEFAULT_INLINE = 720;
const DEFAULT_BLOCK = 1440;
const FOLIATE_MARGIN = 48;
const BASE_FONT_PX = 16;
/** About 80 Latin letters or 40 Japanese characters: longer lines are hard to follow. */
const LINE_EM = 40;
/** Narrower columns than this read badly, so a window only gets as many columns as fit. */
const MIN_COLUMN_EM = 30;
const MAX_COLUMNS = 3;
/** A vertical page is at least this wide (about 25 text columns) and at least as wide as it is tall. */
const VERTICAL_PAGE_EM = 48;
/** Below this height the toolbars overlay the page: a landscape phone cannot spare the rows. */
const CLEARANCE_MIN_HEIGHT = 560;
const CLEARANCE_GAP = 8;
/** Narrower than this ratio of the height reads as one column. */
const PORTRAIT_RATIO = 1.1;

export function pageLayout({ width, height, layout, fontSize, vertical, topBar, bottomBar }: PageLayoutInput): PageGeometry {
  if (!(isPositive(width) && isPositive(height))) {
    return { maxInline: DEFAULT_INLINE, maxBlock: DEFAULT_BLOCK, maxColumns: layout === 'single' ? 1 : 2, margin: FOLIATE_MARGIN };
  }
  const bars = Math.max(positiveOr0(topBar), positiveOr0(bottomBar));
  const margin = height >= CLEARANCE_MIN_HEIGHT ? Math.max(FOLIATE_MARGIN, Math.ceil(bars) + CLEARANCE_GAP) : FOLIATE_MARGIN;
  const em = (BASE_FONT_PX * (isPositive(fontSize) ? fontSize : 100)) / 100;
  // A vertical line runs down the whole page; its columns already flow across the width, so no bands. The page is a
  // block of its own, centred: at full width the text would hug the right edge of a wide window.
  if (vertical) {
    const page = Math.min(width, Math.max(height, VERTICAL_PAGE_EM * em));
    return { maxInline: Math.floor(height), maxBlock: Math.floor(page), maxColumns: 1, margin };
  }

  const oneColumn = layout === 'single' || width < PORTRAIT_RATIO * height;
  const fit = Math.floor(width / (MIN_COLUMN_EM * em));
  return {
    maxInline: Math.round(LINE_EM * em),
    maxBlock: Math.max(DEFAULT_BLOCK, Math.floor(height)),
    maxColumns: oneColumn ? 1 : Math.min(MAX_COLUMNS, Math.max(1, fit)),
    margin,
  };
}

const isPositive = (n: number) => Number.isFinite(n) && n > 0;
const positiveOr0 = (n: number) => (isPositive(n) ? n : 0);
