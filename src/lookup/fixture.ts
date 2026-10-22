// Test helper: payloads recorded once from the live APIs by fixtures/capture.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function fixture(name: string): { url: string; captured: string; status: number; body: any } {
  return JSON.parse(new TextDecoder().decode(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)))));
}
