# worker/mcp/server

## Variables

### INSTRUCTIONS

> `const` **INSTRUCTIONS**: `string`

What the server tells an agent about itself.

## Functions

### mcpRoutes()

> **mcpRoutes**(`api`): `Hono`\<[`AppEnv`](../env.md#appenv)\>

The /mcp routes: POST answers MCP messages, as the bearer token's user and
counted once against the rate limit; GET and DELETE answer 405, since no
session or server-to-client stream exists.

#### Parameters

##### api

`Hono`\<[`AppEnv`](../env.md#appenv)\>

#### Returns

`Hono`\<[`AppEnv`](../env.md#appenv)\>
