# worker/env

## Interfaces

### AppEnv

The Hono environment of the application: its bindings and per-request variables.

#### Properties

##### Bindings

> **Bindings**: [`Env`](#env)

##### Variables

> **Variables**: `object`

###### user

> **user**: [`AuthUser`](#authuser)

The authenticated user, set by the authentication middleware.

###### via

> **via**: `"token"` \| `"session"`

How the request was authenticated.

***

### AuthUser

The user a request is authenticated as.

#### Properties

##### email

> **email**: `string`

##### id

> **id**: `string`

##### name

> **name**: `string`

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

##### FETCH\_QUEUE

> **FETCH\_QUEUE**: `Queue`\<[`FetchMessage`](#fetchmessage)\>

The queue of fetch messages, one per link to fetch.

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

##### HOST\_GATE

> **HOST\_GATE**: `DurableObjectNamespace`\<[`HostGate`](fetcher/hostgate.md#hostgate)\>

The per-host rate limit: one Durable Object per host.

##### ORIGIN\_PROXY\_URL?

> `optional` **ORIGIN\_PROXY\_URL?**: `string`

End-to-end tests only: every fetch goes to this URL with the target in X-Alexandria-Target.

##### PUBLIC\_ORIGIN

> **PUBLIC\_ORIGIN**: `string`

The site's own origin, such as https://alexandria.example.com.

##### SNAPSHOTS

> **SNAPSHOTS**: `R2Bucket`

Snapshots and reader views.

***

### FetchMessage

A request to fetch one link's page.

#### Properties

##### link\_id

> **link\_id**: `string`

##### refresh?

> `optional` **refresh?**: `boolean`

Set for a refresh the owner asked for; a failed refresh is not retried.

##### user\_id

> **user\_id**: `string`
