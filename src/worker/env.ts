/** The bindings and variables of the Worker, as wrangler.jsonc declares them. */
export interface Env {
  /** The D1 database holding every user's data. */
  DB: D1Database;
  /** The website's built static files. */
  ASSETS: Fetcher;
  /** Comma-separated email addresses that may sign in, compared case-insensitively. */
  ALLOWED_EMAILS: string;
  /** The OAuth client id of the Google project. */
  GOOGLE_CLIENT_ID: string;
  /** The OAuth client secret of the Google project. */
  GOOGLE_CLIENT_SECRET: string;
  /** Google's authorization endpoint; configurable so tests can run a local fake. */
  GOOGLE_AUTH_URL: string;
  /** Google's token endpoint; configurable so tests can run a local fake. */
  GOOGLE_TOKEN_URL: string;
  /** The site's own origin, such as https://alexandria.example.com; unset, the origin requests reach. */
  PUBLIC_ORIGIN?: string;
  /** The queue of fetch messages, one per link to fetch. */
  FETCH_QUEUE: Queue<FetchMessage>;
  /** The queue of enrichment messages, one per link to summarise, tag and file. */
  ENRICH_QUEUE: Queue<EnrichMessage>;
  /** The queue of weekly liveness checks, one per link due. */
  LIVENESS_QUEUE: Queue<LivenessMessage>;
  /** The queue of account deletion jobs, one message per run. */
  ACCOUNT_QUEUE: Queue<AccountMessage>;
  /** The queue of indexing jobs, one message per link to index by meaning. */
  INDEX_QUEUE: Queue<IndexMessage>;
  /** Workers AI, which computes the embeddings. */
  AI: Ai;
  /** The Vectorize index holding the embeddings of every user's passages, one namespace per user. */
  VECTORIZE: Vectorize;
  /** End-to-end tests only: embeddings and the index are served by the fake at this URL. */
  MEANING_FAKE_URL?: string;
  /** The per-host rate limit: one Durable Object per host. */
  HOST_GATE: DurableObjectNamespace<import('./fetcher/hostgate').HostGate>;
  /** Snapshots and reader views. */
  SNAPSHOTS: R2Bucket;
  /** End-to-end tests only: every fetch goes to this URL with the target in X-Alexandria-Target. */
  ORIGIN_PROXY_URL?: string;
  /** The secret the owners' AI keys are encrypted under. */
  KEY_ENCRYPTION_KEY: string;
  /** The Anthropic API's base URL; configurable so tests can run a local fake. */
  ANTHROPIC_BASE_URL: string;
  /** OpenRouter's API base URL; configurable so tests can run a local fake. */
  OPENROUTER_BASE_URL: string;
  /** Firecrawl's API base URL; configurable so tests can run a local fake. */
  FIRECRAWL_API_URL: string;
}

/** A request to index one link by meaning. */
export interface IndexMessage {
  user_id: string;
  link_id: string;
}

/** A run of the deletion job of one account marked for deletion. */
export interface AccountMessage {
  user_id: string;
}

/** A request to check that one link's address still answers. */
export interface LivenessMessage {
  user_id: string;
  link_id: string;
}

/** A request to enrich one link. */
export interface EnrichMessage {
  user_id: string;
  link_id: string;
  /** 1 for the first automatic attempt, 2 for its retry. */
  attempt?: number;
  /** Set when the owner asked for it: a failure is not retried. */
  manual?: boolean;
  /** Milliseconds since the epoch before which a throttled job must not run. */
  slot?: number;
}

/** A request to fetch one link's page. */
export interface FetchMessage {
  user_id: string;
  link_id: string;
  /** Set for a refresh the owner asked for; a failed refresh is not retried. */
  refresh?: boolean;
}

/** The user a request is authenticated as. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** The Hono environment of the application: its bindings and per-request variables. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** The authenticated user, set by the authentication middleware. */
    user: AuthUser;
    /** How the request was authenticated. */
    via: 'session' | 'token';
  };
}
