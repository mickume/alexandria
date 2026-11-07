# worker/auth/middleware

## Variables

### internalRequests

> `const` **internalRequests**: `WeakMap`\<`Request`\<`unknown`, `CfProperties`\<`unknown`\>\>, [`AuthUser`](../env.md#authuser)\>

The requests the Worker makes to its own API on behalf of an
authenticated user (the MCP server's tools), with that user. Only code in
the Worker holds these Request objects, so no client can pass as one.

***

### requireAuth

> `const` **requireAuth**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv)\>

Authenticates every request under /api/v1/: a bearer token (a personal
access token) or the session cookie. Anything else is answered 401 before the route runs. A change
authenticated by the cookie must come from PUBLIC_ORIGIN. The Worker's own
internal requests carry their user already.

***

### requireSameOrigin

> `const` **requireSameOrigin**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv)\>

Refuses a cookie-authenticated change from another origin; used by routes outside /api/v1/.

***

### requireToken

> `const` **requireToken**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv)\>

Authenticates the MCP endpoint: a personal access token as a bearer token,
and nothing else (a session cookie alone is refused). A missing, unknown or
revoked token is answered 401 with 'WWW-Authenticate: Bearer'.

***

### servePage

> `const` **servePage**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv)\>

Serves the website's pages: the sign-in page and /about/ to anyone, every
other page only with a valid session, redirecting to /signin otherwise.
