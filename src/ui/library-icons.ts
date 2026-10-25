// Icons only the library screen uses (the shared set lives in dom.ts). Same look as icon() there.
const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  tag: 'M3 12V3h9l9 9-9 9-9-9zM7.5 7.5h.01',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  check: 'M5 13l4 4L19 7',
  device: 'M3 5h18v11H3zM8 20h8M12 16v4',
  cloud: 'M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5 4.25 4.25 0 0 1 17.5 18z',
  star: 'M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.53L12 17.5l-5.87 3.09 1.12-6.53-4.75-4.63 6.56-.95z',
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
