// A book designed for vertical text (Japanese novels) sets its spacing on physical sides as seen in vertical-rl: the
// top is where a line starts and the right is where the text starts. Read horizontally, those values must turn a
// quarter, or a heading's indent becomes a gap above it and its hanging first line is cut off at the column edge.

const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, td, section, article';
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
/** The horizontal side that plays the same role as each vertical-rl side (line start, text start, line end, text end). */
const TURNED = { top: 'left', right: 'top', bottom: 'right', left: 'bottom' } as const;

/** The book was written to be read vertically: right-to-left pages in Japanese, Chinese or Korean. */
export function designedVertical(book: { dir?: string; metadata?: { language?: string | string[] } }): boolean {
  const lang = [book.metadata?.language ?? []].flat()[0] ?? '';
  return book.dir === 'rtl' && /^(ja|zh|ko)\b/i.test(lang);
}

/** Moves each block's margins and paddings to the side with the same role in horizontal text. */
export function turnVerticalSpacing(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  for (const el of doc.body?.querySelectorAll<HTMLElement>(BLOCKS) ?? []) {
    const style = view.getComputedStyle(el); // live: read every side before writing any
    for (const box of ['margin', 'padding'] as const) {
      const values = SIDES.map((side) => style.getPropertyValue(`${box}-${side}`));
      if (values.every((v) => parseFloat(v) === 0)) continue;
      SIDES.forEach((side, i) => el.style.setProperty(`${box}-${TURNED[side]}`, values[i]!, 'important'));
    }
    // A hanging first line deeper than the room now on its left would still be cut off.
    const indent = parseFloat(style.textIndent);
    if (indent < 0 && parseFloat(style.paddingLeft) + parseFloat(style.marginLeft) < -indent)
      el.style.setProperty('text-indent', '0', 'important');
  }
}
