# worker/api/ratelimit

## Variables

### rateLimit

> `const` **rateLimit**: `MiddlewareHandler`\<[`AppEnv`](../env.md#appenv), `string`, \{ \}, `Response`\>

Counts the authenticated user's requests per clock minute and refuses those
past the limit with 429 and Retry-After, before the route runs. Runs after
authentication, so each user has a budget of their own.

***

### REQUESTS\_PER\_MINUTE

> `const` **REQUESTS\_PER\_MINUTE**: `600` = `600`

Requests a user may make to /api/v1/ in one minute, across sessions and tokens.
