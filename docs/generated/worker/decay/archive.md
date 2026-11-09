# worker/decay/archive

## Variables

### ARCHIVE\_REFRESH\_NOT\_QUEUED

> `const` **ARCHIVE\_REFRESH\_NOT\_QUEUED**: `"refresh before archiving could not be queued"` = `'refresh before archiving could not be queued'`

Why the history of an archived link holds a failed fetch it never made.

***

### archiveLinkRoutes

> `const` **archiveLinkRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

Archiving and unarchiving one link, under /api/v1/links.

***

### archiveRoutes

> `const` **archiveRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The archived links, under /api/v1/archive.

***

### expiredRoutes

> `const` **expiredRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The expired links, under /api/v1/expired.

***

### restoreRoutes

> `const` **restoreRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

Restoring one expired link, under /api/v1/links.
