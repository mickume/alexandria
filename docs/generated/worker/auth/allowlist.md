# worker/auth/allowlist

## Functions

### isAllowed()

> **isAllowed**(`env`, `email`): `boolean`

Whether `email` is on the deployment's allow-list. ALLOWED_EMAILS is read on
every call, so a change to it takes effect at the next request; entries are
trimmed and compared case-insensitively.

#### Parameters

##### env

`Pick`\<[`Env`](../env.md#env), `"ALLOWED_EMAILS"`\>

##### email

`string`

#### Returns

`boolean`
