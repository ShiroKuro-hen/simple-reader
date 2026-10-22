// Stand-ins for @types/node (not installed), covering only what the fixture-reading tests use.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}
