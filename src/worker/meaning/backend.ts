/**
 * What search by meaning needs from outside the Worker: embeddings from
 * Workers AI and a vector index in Vectorize, behind one interface. The
 * end-to-end tests cannot reach either, so with MEANING_FAKE_URL set the same
 * interface speaks HTTP to a local fake instead.
 */
import type { Env } from '../env';
import type { PassageKind } from './cut';

/** The embedding model: multilingual, with a window that holds a whole passage. */
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';

/**
 * The similarity (cosine) a passage must reach to be returned. One constant for
 * every use of the index, provisional until it is tuned against a real library.
 */
export const SIMILARITY_THRESHOLD = 0.5;

/** The most vectors a query asks the index for. */
export const QUERY_TOP_K = 100;

/** The most texts one Workers AI call embeds. */
const EMBED_BATCH = 100;
/** The most vectors, or ids, one Vectorize mutation carries. */
export const MUTATION_BATCH = 1_000;

/** A vector to store: the passage's vector id, its embedding and what it was cut from. */
export interface PassageVector {
  id: string;
  values: number[];
  metadata: { kind: PassageKind };
}

/**
 * A filter on the vectors a query may return, by their metadata. A property
 * is filtered on only once the index has a metadata index on it
 * (scripts/provision.sh creates the one on `kind`).
 */
export interface VectorFilter {
  kind?: PassageKind;
}

/** A vector the index found, with its similarity to the query. */
export interface VectorMatch {
  id: string;
  score: number;
}

/** Embeddings and the vector index. Every method throws when the service fails. */
export interface MeaningBackend {
  /** The embedding of each text, in order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Stores the vectors in the namespace, replacing those with the same id. */
  upsert(namespace: string, vectors: PassageVector[]): Promise<void>;
  /**
   * The `topK` vectors of the namespace nearest to `vector`, nearest first,
   * among those matching `filter`.
   */
  query(
    namespace: string,
    vector: number[],
    topK: number,
    filter?: VectorFilter,
  ): Promise<VectorMatch[]>;
  /** Removes the vectors with these ids, in whatever namespace. */
  deleteByIds(ids: string[]): Promise<void>;
}

/** Calls `fn` with `items` in slices of at most `size`. */
async function inSlices<T>(items: T[], size: number, fn: (slice: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** The backend over the Workers AI and Vectorize bindings. */
function bindingBackend(env: Env): MeaningBackend {
  return {
    async embed(texts) {
      const out: number[][] = [];
      await inSlices(texts, EMBED_BATCH, async (slice) => {
        const answer = (await env.AI.run(EMBEDDING_MODEL, {
          text: slice,
          truncate_inputs: true,
        })) as { data?: number[][] };
        if (!Array.isArray(answer.data) || answer.data.length !== slice.length) {
          throw new Error('Workers AI answered without the embeddings asked for');
        }
        out.push(...answer.data);
      });
      return out;
    },
    async upsert(namespace, vectors) {
      await inSlices(vectors, MUTATION_BATCH, async (slice) => {
        await env.VECTORIZE.upsert(slice.map((v) => ({ ...v, namespace })));
      });
    },
    async query(namespace, vector, topK, filter = {}) {
      const answer = await env.VECTORIZE.query(vector, {
        topK,
        namespace,
        returnValues: false,
        returnMetadata: 'none',
        ...(Object.keys(filter).length > 0 && { filter: { ...filter } }),
      });
      return answer.matches.map((m) => ({ id: m.id, score: m.score }));
    },
    async deleteByIds(ids) {
      await inSlices(ids, MUTATION_BATCH, async (slice) => {
        await env.VECTORIZE.deleteByIds(slice);
      });
    },
  };
}

/** The backend over HTTP to the end-to-end tests' fake (e2e/fake-meaning.ts). */
function httpBackend(base: string): MeaningBackend {
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`the fake of search by meaning answered ${response.status}`);
    return (await response.json()) as T;
  };
  return {
    async embed(texts) {
      return (await post<{ vectors: number[][] }>('/embed', { texts })).vectors;
    },
    async upsert(namespace, vectors) {
      await post('/upsert', { namespace, vectors });
    },
    async query(namespace, vector, topK, filter = {}) {
      return (await post<{ matches: VectorMatch[] }>('/query', { namespace, vector, topK, filter }))
        .matches;
    },
    async deleteByIds(ids) {
      await post('/delete', { ids });
    },
  };
}

/** The backend the Worker runs with. */
export function meaningBackend(env: Env): MeaningBackend {
  return env.MEANING_FAKE_URL ? httpBackend(env.MEANING_FAKE_URL) : bindingBackend(env);
}
