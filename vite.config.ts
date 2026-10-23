import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildPrecache } from './src/pwa/policy';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

/** After the app is built, lists its files, derives the precache manifest and builds src/pwa/sw.ts next to them as sw.js. */
function serviceWorker(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'simple-reader-service-worker',
    apply: 'build',
    configResolved(c) {
      root = c.root;
      outDir = resolve(c.root, c.build.outDir);
    },
    async closeBundle() {
      const files = walk(outDir).map((f) => ({
        path: relative(outDir, f).split('\\').join('/'),
        digest: createHash('sha256').update(readFileSync(f)).digest('hex'),
      }));
      await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: 'warn',
        define: { __PRECACHE__: JSON.stringify(JSON.stringify(buildPrecache(files))) },
        build: {
          outDir,
          emptyOutDir: false,
          target: 'es2022',
          lib: { entry: resolve(root, 'src/pwa/sw.ts'), formats: ['iife'], name: 'sw', fileName: () => 'sw.js' },
        },
      });
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { environment: 'node' },
});
