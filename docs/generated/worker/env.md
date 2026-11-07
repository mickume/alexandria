# worker/env

## Interfaces

### AppEnv

The Hono environment of the application: its bindings and per-request variables.

#### Properties

##### Bindings

> **Bindings**: [`Env`](#env)

***

### Env

The bindings and variables of the Worker, as wrangler.jsonc declares them.

#### Properties

##### ALLOWED\_EMAILS

> **ALLOWED\_EMAILS**: `string`

Comma-separated email addresses that may sign in, compared case-insensitively.

##### ASSETS

> **ASSETS**: `object`

The website's built static files.

###### connect()

> **connect**(`address`, `options?`): `Socket`

###### Parameters

###### address

`string` \| `SocketAddress`

###### options?

`SocketOptions`

###### Returns

`Socket`

###### fetch()

> **fetch**(`input`, `init?`): `Promise`\<`Response`\>

###### Parameters

###### input

`URL` \| `RequestInfo`

###### init?

`RequestInit`\<`CfProperties`\<`unknown`\>\>

###### Returns

`Promise`\<`Response`\>

##### DB

> **DB**: `D1Database`

The D1 database holding every user's data.

##### GOOGLE\_AUTH\_URL

> **GOOGLE\_AUTH\_URL**: `string`

Google's authorization endpoint; configurable so tests can run a local fake.

##### GOOGLE\_CLIENT\_ID

> **GOOGLE\_CLIENT\_ID**: `string`

The OAuth client id of the Google project.

##### GOOGLE\_CLIENT\_SECRET

> **GOOGLE\_CLIENT\_SECRET**: `string`

The OAuth client secret of the Google project.

##### GOOGLE\_TOKEN\_URL

> **GOOGLE\_TOKEN\_URL**: `string`

Google's token endpoint; configurable so tests can run a local fake.

##### PUBLIC\_ORIGIN

> **PUBLIC\_ORIGIN**: `string`

The site's own origin, such as https://alexandria.example.com.
