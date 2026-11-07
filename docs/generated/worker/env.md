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

### EnrichMessage

A request to enrich one link.

#### Properties

##### attempt?

> `optional` **attempt?**: `number`

1 for the first automatic attempt, 2 for its retry.

##### link\_id

> **link\_id**: `string`

##### manual?

> `optional` **manual?**: `boolean`

Set when the owner asked for it: a failure is not retried.

##### slot?

> `optional` **slot?**: `number`

Milliseconds since the epoch before which a throttled job must not run.

##### user\_id

> **user\_id**: `string`

***

### Env

The bindings and variables of the Worker, as wrangler.jsonc declares them.

#### Properties

##### ALLOWED\_EMAILS

> **ALLOWED\_EMAILS**: `string`

Comma-separated email addresses that may sign in, compared case-insensitively.

##### ANTHROPIC\_BASE\_URL

> **ANTHROPIC\_BASE\_URL**: `string`

The Anthropic API's base URL; configurable so tests can run a local fake.

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

##### ENRICH\_QUEUE

> **ENRICH\_QUEUE**: `Queue`\<[`EnrichMessage`](#enrichmessage)\>

The queue of enrichment messages, one per link to summarise, tag and file.

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

##### KEY\_ENCRYPTION\_KEY

> **KEY\_ENCRYPTION\_KEY**: `string`

The secret the owners' AI keys are encrypted under.

##### LIVENESS\_QUEUE

> **LIVENESS\_QUEUE**: `Queue`\<[`LivenessMessage`](#livenessmessage)\>

The queue of weekly liveness checks, one per link due.

##### OPENROUTER\_BASE\_URL

> **OPENROUTER\_BASE\_URL**: `string`

OpenRouter's API base URL; configurable so tests can run a local fake.

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

***

### LivenessMessage

A request to check that one link's address still answers.

#### Properties

##### link\_id

> **link\_id**: `string`

##### user\_id

> **user\_id**: `string`
