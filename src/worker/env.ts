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
}

/** The Hono environment of the application: its bindings and per-request variables. */
export interface AppEnv {
  Bindings: Env;
}
