// The shipped manifest and icon files must meet Chromium's installability criteria. Reads the real files in public/.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pub = (p: string) => fileURLToPath(new URL(`../../public/${p}`, import.meta.url));
const manifest = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8'));
const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

type Icon = { src: string; sizes: string; type: string; purpose?: string };
const icons: Icon[] = manifest.icons;

/** PNG width and height from the IHDR chunk, so a wrongly sized icon file is caught. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString(), `${path} is not a PNG`).toBe('PNG');
  const v = new DataView(b.buffer, b.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
}

describe('web app manifest', () => {
  it('names the app and opens it standalone at the scope root, whatever base path it is hosted under', () => {
    expect(manifest).toMatchObject({ name: 'simple-reader', short_name: 'simple-reader', display: 'standalone', start_url: './', scope: './' });
  });

  it('uses the light theme colours, like the <meta name="theme-color"> in index.html', () => {
    expect(manifest.theme_color).toBe('#f6f5f1');
    expect(manifest.background_color).toBe('#f6f5f1');
    expect(html).toContain('<meta name="theme-color" content="#f6f5f1"');
  });

  it('uses only relative URLs (the site is served from /simple-reader/ as well as from the root)', () => {
    for (const url of [manifest.start_url, manifest.scope, manifest.id, ...icons.map((i) => i.src)]) expect(url, url).not.toMatch(/^\/|^[a-z]+:/);
  });

  it('has real icon files of the declared size and type', () => {
    for (const icon of icons) {
      expect(existsSync(pub(icon.src)), icon.src).toBe(true);
      if (icon.type === 'image/png') {
        const [w, h] = icon.sizes.split('x').map(Number);
        expect(pngSize(pub(icon.src)), icon.src).toEqual([w, h]);
      }
    }
  });

  it('has the PNG sizes Chromium requires to offer installation, and a maskable one', () => {
    const png = (size: string, purpose: string) => icons.some((i) => i.type === 'image/png' && i.sizes === size && (i.purpose ?? 'any').split(' ').includes(purpose));
    expect(png('192x192', 'any')).toBe(true);
    expect(png('512x512', 'any')).toBe(true);
    expect(png('512x512', 'maskable')).toBe(true);
  });

  it('is linked from index.html together with an iOS icon', () => {
    expect(html).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png"/);
    expect(existsSync(pub('icons/apple-touch-icon.png'))).toBe(true);
  });
});
