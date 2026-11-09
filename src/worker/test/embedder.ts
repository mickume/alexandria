/**
 * A deterministic stand-in for Workers AI and Vectorize, shared by the Worker
 * tests (src/worker/test/meaning.ts) and the end-to-end tests'
 * fake (e2e/fake-meaning.ts), which must agree on what is near in meaning.
 *
 * A text embeds as the set of word groups it mentions, as one unit vector with
 * a dimension per group. Words of one group are near in meaning: two texts
 * that share a group score at least 0.5 against each other as long as neither
 * mentions more than three groups, and texts that share none score 0. A text
 * that mentions no group embeds as the zero vector, which scores 0 with
 * everything (a real model never answers that; a fake may).
 */

/** The word groups, as the word starts that belong to each. */
export const GROUPS: string[][] = [
  ['later', 'alarm', 'schedul', 'background', 'cron', 'timer', 'delay', 'task'],
  ['cloudflare', 'worker', 'durable', 'queue', 'object'],
  ['tomato', 'soil', 'garden', 'compost', 'plant', 'grow'],
  ['bread', 'recipe', 'flour', 'butter', 'bak'],
];

/** The size of every embedding. */
export const DIMENSIONS = GROUPS.length;

/** The embedding of `text`. */
export function embedText(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  const present: number[] = GROUPS.map((stems) =>
    words.some((word) => stems.some((stem) => word.startsWith(stem))) ? 1 : 0,
  );
  const size = Math.sqrt(present.reduce((sum, p) => sum + p, 0));
  return size === 0 ? present : present.map((p) => p / size);
}

/** The cosine similarity of two embeddings; 0 when either is the zero vector. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    sizeA += a[i]! * a[i]!;
    sizeB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return sizeA === 0 || sizeB === 0 ? 0 : dot / Math.sqrt(sizeA * sizeB);
}

/** A vector held by the fake index. */
export interface StoredVector {
  id: string;
  namespace: string;
  values: number[];
}

/** An in-memory vector index with namespaces. */
export class VectorIndex {
  private vectors = new Map<string, StoredVector>();

  /** Stores the vectors, replacing those with the same id. */
  upsert(vectors: StoredVector[]): void {
    for (const v of vectors) this.vectors.set(v.id, v);
  }

  /**
   * The `topK` vectors nearest to `vector`, nearest first, in `namespace` only
   * unless `anyNamespace` (to model an index that fails to keep users apart).
   */
  query(namespace: string, vector: number[], topK: number, anyNamespace = false) {
    return [...this.vectors.values()]
      .filter((v) => anyNamespace || v.namespace === namespace)
      .map((v) => ({ id: v.id, namespace: v.namespace, score: cosine(vector, v.values) }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, topK);
  }

  deleteByIds(ids: string[]): void {
    for (const id of ids) this.vectors.delete(id);
  }

  /** Every vector held, optionally of one namespace. */
  all(namespace?: string): StoredVector[] {
    return [...this.vectors.values()].filter(
      (v) => namespace === undefined || v.namespace === namespace,
    );
  }
}
