// Reading annotations/<bookId>.json for sync. The merge itself is mergeAnnotationFiles in ../annotations/model.
import type { Annotation, AnnotationFile } from '../types';

/** The file when `text` is a readable AnnotationFile (items without a string id and numeric updatedAt are dropped), else undefined. */
export function parseAnnotationFile(text: string): AnnotationFile | undefined {
  try {
    const v = JSON.parse(text) as { bookId?: unknown; items?: unknown } | null;
    if (!v || typeof v.bookId !== 'string' || !Array.isArray(v.items)) return undefined;
    const items = v.items.filter(
      (i): i is Annotation => !!i && typeof i.id === 'string' && typeof i.updatedAt === 'number',
    );
    return { bookId: v.bookId, items };
  } catch {
    return undefined;
  }
}
