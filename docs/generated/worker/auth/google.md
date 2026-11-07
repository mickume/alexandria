# worker/auth/google

## Interfaces

### GoogleIdentity

What a sign-in keeps from Google: the email and the display name, nothing else.

#### Properties

##### email

> **email**: `string`

##### name

> **name**: `string`

## Functions

### finishSignIn()

> **finishSignIn**(`env`, `code`, `verifier`): `Promise`\<[`GoogleIdentity`](#googleidentity) \| `null`\>

Exchanges an authorization code for the signed-in identity. The ID token
comes straight from Google's token endpoint over TLS, so its claims are read
without verifying its signature. Every token Google returns is dropped here.
Returns null when the exchange is refused or the identity is unusable.

#### Parameters

##### env

[`Env`](../env.md#env)

##### code

`string`

##### verifier

`string`

#### Returns

`Promise`\<[`GoogleIdentity`](#googleidentity) \| `null`\>

***

### startSignIn()

> **startSignIn**(`env`): `object`

Starts the authorization-code flow with PKCE: the URL to send the browser to, with its state and verifier.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`object`

##### state

> **state**: `string`

##### url

> **url**: `URL`

##### verifier

> **verifier**: `string`
