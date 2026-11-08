# worker/origin

## Functions

### publicOrigin()

> **publicOrigin**(`env`, `requestUrl`): `string`

The site's own origin: PUBLIC_ORIGIN when the deployment sets it, or else
the origin the request reached, such as the Worker's workers.dev address.

#### Parameters

##### env

`Pick`\<[`Env`](env.md#env), `"PUBLIC_ORIGIN"`\>

##### requestUrl

`string`

#### Returns

`string`
