# worker/decay/routes

## Interfaces

### Thresholds

A user's decay settings: the points a link starts from, the days from expiry
to removal, and the percent of the time decayed that the first use of a link
on a UTC day wins back.

#### Properties

##### remove\_days

> **remove\_days**: `number`

##### start\_points

> **start\_points**: `number`

##### use\_boost

> **use\_boost**: `number`

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

The bounds of the start points and the removal delay.

## Functions

### getThresholds()

> **getThresholds**(`db`, `userId`): `Promise`\<[`Thresholds`](#thresholds)\>

The user's decay settings.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<[`Thresholds`](#thresholds)\>
