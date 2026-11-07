# worker/decay/routes

## Interfaces

### Thresholds

A user's decay thresholds, in days.

#### Properties

##### archive\_days

> **archive\_days**: `number`

##### dormant\_days

> **dormant\_days**: `number`

##### remove\_days

> **remove\_days**: `number`

## Variables

### decaySettingsRoutes

> `const` **decaySettingsRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The decay settings, under /api/v1/settings.

***

### THRESHOLD\_MAX

> `const` **THRESHOLD\_MAX**: `3650` = `3650`

***

### THRESHOLD\_MIN

> `const` **THRESHOLD\_MIN**: `7` = `7`

The bounds of every decay threshold, in days.

## Functions

### getThresholds()

> **getThresholds**(`db`, `userId`): `Promise`\<[`Thresholds`](#thresholds)\>

The user's decay thresholds.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<[`Thresholds`](#thresholds)\>
