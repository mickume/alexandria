# worker/auth/middleware

## Variables

### requireAuth

> `const` **requireAuth**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv)\>

Authenticates every request under /api/v1/: a bearer token (a personal
access token) or the session cookie. Anything else is answered 401 before the route runs. A change
authenticated by the cookie must come from PUBLIC_ORIGIN.

***

### requireSameOrigin

> `const` **requireSameOrigin**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv)\>

Refuses a cookie-authenticated change from another origin; used by routes outside /api/v1/.

***

### servePage

> `const` **servePage**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv)\>

Serves the website's pages: the sign-in page and /about/ to anyone, every
other page only with a valid session, redirecting to /signin otherwise.
