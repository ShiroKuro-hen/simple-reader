// Renders public/icon.svg into the PNG icons the web app manifest needs, using the Chromium Playwright already has
// (no image library to install). Output is committed; rerun only when icon.svg changes:
//   node tools/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchChromium, loadPlaywright } from '../e2e/support.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const svg = readFileSync(`${root}public/icon.svg`, 'utf8');
// "any" icons keep the rounded square. Maskable ones are full-bleed (the OS crops them) and the glyph already sits inside the 80% safe zone.
const maskable = svg.replace(' rx="112"', '');

const outputs = [
  ['icon-192.png', 192, svg, true],
  ['icon-512.png', 512, svg, true],
  ['maskable-512.png', 512, maskable, false],
  ['apple-touch-icon.png', 180, maskable, false], // iOS rounds the corners itself and fills transparency with black
];

const pw = await loadPlaywright();
if (!pw) throw new Error('Playwright not found: set PLAYWRIGHT_DIR');
const browser = await launchChromium(pw);
mkdirSync(`${root}public/icons`, { recursive: true });
for (const [name, size, source, transparent] of outputs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  writeFileSync(`${root}public/icons/${name}`, await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } }));
  await page.close();
}
await browser.close();
console.log(outputs.map(([n]) => n).join(', '));
