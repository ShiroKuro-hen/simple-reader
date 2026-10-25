// A page that is only a picture (a cover, a colour plate): the book's own CSS often leaves it in a corner of the page,
// which reads as off-centre next to the text pages. Centre it both ways.

const NOT_TEXT = /^(style|script)$/i;

function hasText(body: HTMLElement): boolean {
  const words = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = words.nextNode(); node; node = words.nextNode()) {
    if (node.nodeValue?.trim() && !NOT_TEXT.test(node.parentElement?.localName ?? '')) return true;
  }
  return false;
}

export function centerImagePage(doc: Document): void {
  const body = doc.body;
  if (!body || hasText(body) || !body.querySelector('img, svg')) return;
  const style: Record<string, string> = {
    display: 'flex',
    'flex-direction': 'column',
    'justify-content': 'center',
    'align-items': 'center',
    'min-height': '100%',
  };
  for (const [name, value] of Object.entries(style)) body.style.setProperty(name, value, 'important');
}
