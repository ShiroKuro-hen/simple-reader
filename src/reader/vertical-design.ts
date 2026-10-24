// A book designed for vertical text (Japanese novels) sets its spacing on physical sides as seen in vertical-rl: the
// top is where a line starts and the right is where the text starts. Read horizontally, those values must turn a
// quarter, or a heading's indent becomes a gap above it and its hanging first line is cut off at the column edge.

const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, td, section, article';
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
/** The horizontal side that plays the same role as each vertical-rl side (line start, text start, line end, text end). */
const TURNED = { top: 'left', right: 'top', bottom: 'right', left: 'bottom' } as const;

type Spacing = Record<'margin' | 'padding', string[]>;

/** The book was written to be read vertically: right-to-left pages in Japanese, Chinese or Korean. */
export function designedVertical(book: { dir?: string; metadata?: { language?: string | string[] } }): boolean {
  const lang = [book.metadata?.language ?? []].flat()[0] ?? '';
  return book.dir === 'rtl' && /^(ja|zh|ko)\b/i.test(lang);
}

export function turnVerticalSpacing(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  const blocks = [...(doc.body?.querySelectorAll<HTMLElement>(BLOCKS) ?? [])];
  // Read every block before writing any: the computed style is live.
  const spacing = blocks.map((el) => readSpacing(view.getComputedStyle(el)));
  blocks.forEach((el, i) => writeTurned(el, spacing[i]!));
  clearHangingPastTheEdge(view, blocks);
  underlineOverlinedLinks(view, doc);
}

/** A vertical book overlines its links: beside vertical text that line is the underline. */
function underlineOverlinedLinks(view: Window, doc: Document): void {
  for (const link of doc.body?.querySelectorAll<HTMLElement>('a') ?? [])
    if (view.getComputedStyle(link).textDecorationLine.includes('overline')) link.style.setProperty('text-decoration-line', 'underline', 'important');
}

function readSpacing(style: CSSStyleDeclaration): Spacing {
  const read = (box: 'margin' | 'padding') => SIDES.map((side) => style.getPropertyValue(`${box}-${side}`));
  return { margin: read('margin'), padding: read('padding') };
}

/** Moves each margin and padding to the side with the same role in horizontal text. */
function writeTurned(el: HTMLElement, spacing: Spacing): void {
  for (const box of ['margin', 'padding'] as const) {
    const values = spacing[box];
    if (values.every((v) => parseFloat(v) === 0)) continue;
    SIDES.forEach((side, i) => el.style.setProperty(`${box}-${TURNED[side]}`, values[i]!, 'important'));
  }
}

/**
 * A hanging first line (negative indent) is fine while the blocks around it leave room on the left: a paragraph
 * inherits its indent from a div that owns the padding. Where nothing does, the line would start outside the column.
 */
function clearHangingPastTheEdge(view: Window, blocks: HTMLElement[]): void {
  const hanging = blocks.map((el) => ({ el, indent: parseFloat(view.getComputedStyle(el).textIndent) })).filter((b) => b.indent < 0);
  const rooms = hanging.map(({ el }) => roomOnTheLeft(view, el));
  hanging.forEach(({ el, indent }, i) => {
    if (rooms[i]! < -indent) el.style.setProperty('text-indent', '0', 'important');
  });
}

/** Margin and padding to the left of the block, its ancestors included (the body itself is the column edge). */
function roomOnTheLeft(view: Window, el: HTMLElement): number {
  let room = 0;
  for (let node: HTMLElement | null = el; node && node !== node.ownerDocument.body; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    room += parseFloat(style.paddingLeft) + parseFloat(style.marginLeft);
  }
  return room;
}
