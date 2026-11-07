# worker/auth/crypto

## Functions

### randomToken()

> **randomToken**(`bytes?`): `string`

`bytes` random bytes, base64url-encoded without padding.

#### Parameters

##### bytes?

`number` = `32`

#### Returns

`string`

***

### sha256Hex()

> **sha256Hex**(`value`): `Promise`\<`string`\>

The SHA-256 hash of `value`, hex-encoded: how session ids and token secrets are stored.

#### Parameters

##### value

`string`

#### Returns

`Promise`\<`string`\>
