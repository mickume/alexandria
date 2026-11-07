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
  /** The site's own origin, such as https://alexandria.example.com. */
  PUBLIC_ORIGIN: string;
  /** The queue of fetch messages, one per link to fetch. */
  FETCH_QUEUE: Queue<FetchMessage>;
  /** The per-host rate limit: one Durable Object per host. */
  HOST_GATE: DurableObjectNamespace<import('./fetcher/hostgate').HostGate>;
  /** Snapshots and reader views. */
  SNAPSHOTS: R2Bucket;
  /** End-to-end tests only: every fetch goes to this URL with the target in X-Alexandria-Target. */
  ORIGIN_PROXY_URL?: string;
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
