// Runs e2e/app.e2e.js, e2e/annotations.e2e.js (and, with REAL_EPUB=<path>, e2e/real-annotations.e2e.js) in a real Chromium against
// the dev server. Playwright is not a repo dependency: see e2e/support.mjs for how it is found.
//   node e2e/run-annotations.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { launchChromium, loadPlaywright, repoRoot } from './support.mjs';

const pw = await loadPlaywright();
if (!pw) throw new Error('Playwright not found: set PLAYWRIGHT_DIR');
const { createServer } = await import(pathToFileURL(join(repoRoot, 'node_modules/vite/dist/node/index.js')).href);
const server = await createServer({ root: repoRoot, logLevel: 'error', optimizeDeps: { include: ['pdfjs-dist'] } });
await server.listen();
const BASE = server.resolvedUrls.local[0];
const browser = await launchChromium(pw);
const specs = ['app.e2e.js', 'annotations.e2e.js', ...(process.env.REAL_EPUB ? ['real-annotations.e2e.js'] : [])];
let failed = 0;
for (const spec of specs) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const run = (0, eval)(readFileSync(fileURLToPath(new URL(spec, import.meta.url)), 'utf8'));
  const out = await run(page, { BASE, ROOT: repoRoot, REAL_EPUB: process.env.REAL_EPUB });
  console.log(`\n== ${spec}: ${out.passed ?? 0} passed, ${out.failed ?? 0} failed`);
  for (const r of out.results ?? out.checks ?? []) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.note ? ' - ' + r.note : ''}`);
  if (out.skipped) console.log(out.skipped);
  if (errors.length) { console.log('uncaught page errors:', errors); failed++; }
  failed += out.failed ?? 0;
  await context.close();
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
