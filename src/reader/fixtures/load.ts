// Node-side access to the fixture files (browser tests fetch them over HTTP instead).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixtureBytes = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(name, import.meta.url))));
export const fixtureFile = (name: string, as = name) => new File([fixtureBytes(name)], as);
