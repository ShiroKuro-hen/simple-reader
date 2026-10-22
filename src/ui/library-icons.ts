// Icons only the library screen uses (the shared set lives in dom.ts). Same look as icon() there.
const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  tag: 'M3 12V3h9l9 9-9 9-9-9zM7.5 7.5h.01',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
} as const;

export function libIcon(name: keyof typeof PATHS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', PATHS[name]);
  svg.append(p);
  return svg;
}
