# worker/app

## Variables

### app

> `const` **app**: `Hono`\<[`AppEnv`](env.md#appenv), `BlankSchema`, `"/"`\>

The application the Worker serves.

## Functions

### createApp()

> **createApp**(): `Hono`\<[`AppEnv`](env.md#appenv)\>

Builds the application: the API under /api/v1/, the sign-in routes and the website's pages.

#### Returns

`Hono`\<[`AppEnv`](env.md#appenv)\>
