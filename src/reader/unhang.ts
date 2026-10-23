// Japanese books often hang a chapter heading out of its column: `text-indent: -3em` is a hanging indent in vertical
// text. Forced horizontal, the same rule pushes the first characters left of the column, where foliate clips them.

const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, td, section, article';

/** Removes negative first-line indents from the section's blocks (positive ones are ordinary paragraph indents and stay). */
export function unhangIndents(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  for (const el of doc.body?.querySelectorAll<HTMLElement>(BLOCKS) ?? [])
    if (parseFloat(view.getComputedStyle(el).textIndent) < 0) el.style.setProperty('text-indent', '0', 'important');
}
