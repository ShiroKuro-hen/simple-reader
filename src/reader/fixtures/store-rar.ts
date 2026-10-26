// A store-only (uncompressed) RAR 5 archive built in memory, so tests can make real .cbr archives.
// No rar tool exists on the dev machine. The layout follows the RAR 5 format notes: every block is
// CRC32, vint header size, vint type, vint flags, then type fields; file data follows its header.
import { crc32 } from '../../storage/store-zip';

const SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
const BLOCK_MAIN = 1;
const BLOCK_FILE = 2;
const BLOCK_END = 5;
const FLAG_DATA = 0x02;
const FILE_DIRECTORY = 0x01;
const FILE_CRC = 0x04;
const HOST_UNIX = 1;

/** Variable-length integer: 7 bits per byte, little-endian groups, high bit = more bytes follow. */
function vint(value: number): number[] {
  const out: number[] = [];
  let n = value;
  do {
    const low = n % 128;
    n = Math.floor(n / 128);
    out.push(n > 0 ? low | 0x80 : low);
  } while (n > 0);
  return out;
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** CRC, size, then the body; `data` (if any) is appended after the header and counted by the header. */
function block(type: number, body: number[], data?: Uint8Array): Uint8Array {
  const flags = data ? FLAG_DATA : 0;
  const rest = [...vint(type), ...vint(flags), ...(data ? vint(data.length) : []), ...body];
  const sized = [...vint(rest.length), ...rest];
  const header = [...u32le(crc32(Uint8Array.from(sized))), ...sized];
  return Uint8Array.from(data ? [...header, ...data] : header);
}

/** A file header is directory-or-file; directories carry no data and no CRC. `files` maps names to bytes; a name ending in '/' is a directory. */
export function storeRar5(files: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [Uint8Array.from(SIGNATURE), block(BLOCK_MAIN, vint(0))];
  for (const [name, data] of Object.entries(files)) {
    const dir = name.endsWith('/');
    const body = dir
      ? [...vint(FILE_DIRECTORY), ...vint(0), ...vint(0o40755)]
      : [...vint(FILE_CRC), ...vint(data.length), ...vint(0o100644), ...u32le(crc32(data))];
    const nameBytes = enc.encode(name);
    body.push(...vint(0), ...vint(HOST_UNIX), ...vint(nameBytes.length), ...nameBytes); // compression: store, version 0
    parts.push(block(BLOCK_FILE, body, dir ? undefined : data));
  }
  parts.push(block(BLOCK_END, vint(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
