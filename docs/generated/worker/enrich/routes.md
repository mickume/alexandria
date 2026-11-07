# worker/enrich/routes

## Variables

### MODEL\_MAX

> `const` **MODEL\_MAX**: `200` = `200`

The longest model identifier accepted.

***

### settingsRoutes

> `const` **settingsRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The owner's AI provider and key, under /api/v1/settings.

***

### UNENRICHED\_STATES

> `const` **UNENRICHED\_STATES**: `string`[]

Enrichment states that count as waiting to be enriched.
