import type { Storage } from '../types';

type Dir = FileSystemDirectoryHandle;

const isNotFound = (e: unknown) => (e as DOMException)?.name === 'NotFoundError';

/** Walks `parts` down from the OPFS root; null if a folder is missing and `create` is false. */
async function dirAt(parts: string[], create: boolean): Promise<Dir | null> {
  let dir = await navigator.storage.getDirectory();
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create });
    } catch (e) {
      if (!create && isNotFound(e)) return null;
      throw e;
    }
  }
  return dir;
}

const split = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  return { dirs: parts.slice(0, -1), name: parts.at(-1) ?? '' };
};

async function walk(dir: Dir, base: string, out: string[]): Promise<void> {
  // entries() is async-iterable at runtime; the DOM lib in use does not type it.
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === 'directory') await walk(handle as Dir, `${base}${name}/`, out);
    else out.push(base + name);
  }
}

export function opfsStorage(): Storage {
  return {
    async read(path) {
      const { dirs, name } = split(path);
      try {
        const dir = await dirAt(dirs, false);
        if (!dir) return null;
        const file = await (await dir.getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async write(path, data) {
      const { dirs, name } = split(path);
      const dir = (await dirAt(dirs, true))!;
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(data as FileSystemWriteChunkType);
      await w.close();
    },

    async remove(path) {
      const { dirs, name } = split(path);
      try {
        await (await dirAt(dirs, false))?.removeEntry(name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },

    async list(prefix) {
      // Start at the deepest folder the prefix names, then filter by the full prefix.
      const parts = prefix.split('/');
      parts.pop();
      const dir = await dirAt(parts.filter(Boolean), false);
      if (!dir) return [];
      const out: string[] = [];
      await walk(dir, parts.length ? parts.join('/') + '/' : '', out);
      return out.filter((p) => p.startsWith(prefix)).sort();
    },
  };
}

/** For tests (and anything else without a browser). */
export function memoryStorage(): Storage {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, data) {
      files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
    },
    async remove(path) {
      files.delete(path);
    },
    async list(prefix) {
      return [...files.keys()].filter((p) => p.startsWith(prefix)).sort();
    },
  };
}
