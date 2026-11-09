/**
 * Fakes of Workers AI and Vectorize for the Worker tests: bindings installed on
 * env that embed with the deterministic embedder, keep vectors in memory by
 * namespace, record every call and fail or stall a call on request.
 */
import { env } from 'cloudflare:test';
import { DIMENSIONS, embedText, VectorIndex, type MetadataFilter } from './embedder';
import { api, seedLinks, type TestUser } from './helpers';

/** The calls the Worker makes to the index and the model. */
export type MeaningCall = 'embed' | 'query' | 'upsert' | 'deleteByIds';

/** One call the fakes received. */
export interface RecordedCall {
  call: MeaningCall;
  /** The namespace queried or written. */
  namespace?: string;
  /** The ids upserted or deleted. */
  ids?: string[];
  /** The texts embedded. */
  texts?: string[];
}

class FakeMeaning {
  index = new VectorIndex();
  calls: RecordedCall[] = [];
  /** Runs while texts are being embedded, so that a test can change the library mid-job. */
  onEmbed: (() => Promise<void>) | undefined;
  /** Makes every query answer with the vectors of all namespaces. */
  ignoreNamespaces = false;
  private failing = new Set<MeaningCall>();
  private stalling = new Set<MeaningCall>();
  private mutations = 0;

  /** Empties the index and the log, forgets every switch and installs the bindings on env. */
  reset(): void {
    this.index = new VectorIndex();
    this.calls = [];
    this.onEmbed = undefined;
    this.ignoreNamespaces = false;
    this.recover();
    env.AI = this.ai as unknown as Ai;
    env.VECTORIZE = this.vectorize as unknown as Vectorize;
  }

  /** Makes `call` throw, as the service does when it is down or refuses. */
  fail(call: MeaningCall): void {
    this.failing.add(call);
  }

  /** Makes `call` never answer. */
  stall(call: MeaningCall): void {
    this.stalling.add(call);
  }

  /** Lifts every fail and stall. */
  recover(): void {
    this.failing.clear();
    this.stalling.clear();
  }

  /** The calls of one kind received so far. */
  callsOf(call: MeaningCall): RecordedCall[] {
    return this.calls.filter((c) => c.call === call);
  }

  private async enter(call: RecordedCall): Promise<void> {
    this.calls.push(call);
    if (this.failing.has(call.call)) throw new Error(`the fake ${call.call} failed`);
    if (this.stalling.has(call.call)) await new Promise(() => undefined);
  }

  private mutation() {
    return { mutationId: `mutation-${++this.mutations}` };
  }

  private ai = {
    run: async (_model: string, inputs: { text: string | string[] }) => {
      const texts = Array.isArray(inputs.text) ? inputs.text : [inputs.text];
      await this.enter({ call: 'embed', texts });
      await this.onEmbed?.();
      return { shape: [texts.length, DIMENSIONS], data: texts.map(embedText), pooling: 'cls' };
    },
  };

  private vectorize = {
    query: async (
      vector: number[],
      options?: { topK?: number; namespace?: string; filter?: MetadataFilter },
    ) => {
      const namespace = options?.namespace ?? '';
      await this.enter({ call: 'query', namespace });
      const matches = this.index.query(
        namespace,
        vector,
        options?.topK ?? 10,
        this.ignoreNamespaces,
        options?.filter,
      );
      return { matches, count: matches.length };
    },
    upsert: async (
      vectors: {
        id: string;
        values: number[];
        namespace?: string;
        metadata?: Record<string, string>;
      }[],
    ) => {
      await this.enter({
        call: 'upsert',
        namespace: vectors[0]?.namespace,
        ids: vectors.map((v) => v.id),
      });
      this.index.upsert(
        vectors.map((v) => ({
          id: v.id,
          namespace: v.namespace ?? '',
          values: [...v.values],
          ...(v.metadata && { metadata: { ...v.metadata } }),
        })),
      );
      return this.mutation();
    },
    deleteByIds: async (ids: string[]) => {
      await this.enter({ call: 'deleteByIds', ids });
      this.index.deleteByIds(ids);
      return this.mutation();
    },
  };
}

/** The fakes of Workers AI and Vectorize every Worker test runs with; reset before each test. */
export const meaning = new FakeMeaning();

/** A link to seed for a test of search by meaning, with the text the fetch and enrichment would store. */
export interface Article {
  url: string;
  title: string;
  /** The reader text; none for a link that was not fetched as a page. */
  text?: string | null;
  summary?: string;
  note?: string;
  topic?: string;
  tags?: string[];
  state?: string;
}

/** Three articles that are near in meaning to different questions (see embedder.ts). */
export const ARTICLES = {
  alarms: {
    url: 'https://example.com/durable-object-alarms',
    title: 'Durable Object alarms',
    summary: 'How an object schedules work for itself.',
    text: 'An alarm lets a Durable Object schedule a task to run later, in the background, without a cron trigger. Set the alarm and the object wakes up at that time.',
  },
  queues: {
    url: 'https://example.com/cloudflare-queues',
    title: 'Cloudflare Queues explained',
    summary: 'Queues hand messages from one Worker to another.',
    text: 'Cloudflare Queues deliver messages between Workers in batches and retry them until a consumer accepts them.',
  },
  tomatoes: {
    url: 'https://example.com/growing-tomatoes',
    title: 'Growing tomatoes in pots',
    summary: 'Tomatoes on a balcony.',
    text: 'Tomatoes grow well in rich soil with compost, in a pot on a sunny balcony.',
  },
} satisfies Record<string, Article>;

/**
 * Stores a link for `user` as the fetch worker and enrichment leave it, directly
 * in the store, and returns its id. Tags and a topic go through the owner's edit.
 */
export async function seedArticle(user: TestUser, article: Article): Promise<string> {
  const [id] = await seedLinks(user, [{ url: article.url, state: article.state ?? 'active' }]);
  await env.DB.batch([
    env.DB.prepare('UPDATE links SET title = ?, summary = ?, note = ? WHERE id = ?').bind(
      article.title,
      article.summary ?? null,
      article.note ?? '',
      id!,
    ),
    ...(article.text
      ? [
          env.DB.prepare('INSERT INTO link_texts (link_id, user_id, text) VALUES (?, ?, ?)').bind(
            id!,
            user.id,
            article.text,
          ),
        ]
      : []),
  ]);
  if (article.tags || article.topic) {
    const body = {
      ...(article.tags && { tags: article.tags }),
      ...(article.topic && { topic: article.topic }),
    };
    await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body });
  }
  return id!;
}
