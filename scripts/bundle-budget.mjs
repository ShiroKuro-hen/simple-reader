// Fails the build when the shipped JavaScript grows past its budget (gzipped: that is what is sent).
// Limits sit just above today's numbers on purpose: a budget with room to spare never says anything.
// The dictionaries in public/dict are loaded on demand and are not counted here.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const limits = {
  entry: Number(process.env.BUDGET_ENTRY_KB ?? 36) * KB, // index-*.js: needed before the first screen
  chunk: Number(process.env.BUDGET_CHUNK_KB ?? 135) * KB, // any one lazily loaded chunk (pdf.js is the big one)
  total: Number(process.env.BUDGET_TOTAL_KB ?? 270) * KB,
};

const sizes = readdirSync('dist/assets')
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, gzipSync(readFileSync(`dist/assets/${f}`)).length]);
if (!sizes.length) throw new Error('dist/assets has no JavaScript: run `npm run build` first');

const entry = sizes.find(([f]) => f.startsWith('index-'))?.[1] ?? 0;
const biggest = sizes.reduce((a, b) => (b[1] > a[1] ? b : a));
const total = sizes.reduce((n, [, s]) => n + s, 0);
const kb = (n) => `${(n / KB).toFixed(1)} KB`;

const checks = [
  ['entry', entry, limits.entry, 'index-*.js'],
  ['biggest chunk', biggest[1], limits.chunk, biggest[0]],
  ['total JS', total, limits.total, `${sizes.length} files`],
];
let failed = false;
for (const [name, size, limit, what] of checks) {
  const over = size > limit;
  failed ||= over;
  console.log(`${over ? 'FAIL' : 'ok  '} ${name}: ${kb(size)} / ${kb(limit)} (${what})`);
}
if (failed) process.exit(1);
