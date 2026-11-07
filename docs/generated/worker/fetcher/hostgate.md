# worker/fetcher/hostgate

## Classes

### HostGate

The per-host rate limit: one instance per host name hands out request
slots at least HOST_INTERVAL_MS apart, across every user, link, refresh and
background job. A Durable Object handles one call at a time, so two callers
never get the same slot.

#### Extends

- `DurableObject`\<[`Env`](../env.md#env)\>

#### Constructors

##### Constructor

> **new HostGate**(`ctx`, `env`): [`HostGate`](#hostgate)

###### Parameters

###### ctx

`DurableObjectState`

###### env

[`Env`](../env.md#env)

###### Returns

[`HostGate`](#hostgate)

###### Inherited from

`DurableObject<Env>.constructor`

#### Properties

##### \_\_DURABLE\_OBJECT\_BRAND

> **\_\_DURABLE\_OBJECT\_BRAND**: `never`

###### Inherited from

`DurableObject.__DURABLE_OBJECT_BRAND`

##### ctx

> `protected` **ctx**: `DurableObjectState`\<\{ \}\>

###### Inherited from

`DurableObject.ctx`

##### env

> `protected` **env**: [`Env`](../env.md#env)

###### Inherited from

`DurableObject.env`

#### Methods

##### alarm()?

> `optional` **alarm**(`alarmInfo?`): `void` \| `Promise`\<`void`\>

###### Parameters

###### alarmInfo?

`AlarmInvocationInfo`

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

`DurableObject.alarm`

##### connect()?

> `optional` **connect**(`socket`): `void` \| `Promise`\<`void`\>

###### Parameters

###### socket

`Socket`

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

`DurableObject.connect`

##### fetch()?

> `optional` **fetch**(`request`): `Response` \| `Promise`\<`Response`\>

###### Parameters

###### request

`Request`

###### Returns

`Response` \| `Promise`\<`Response`\>

###### Inherited from

`DurableObject.fetch`

##### slot()

> **slot**(): `Promise`\<`number`\>

Reserves the next slot and returns its time, in milliseconds since the epoch.

###### Returns

`Promise`\<`number`\>

##### webSocketClose()?

> `optional` **webSocketClose**(`ws`, `code`, `reason`, `wasClean`): `void` \| `Promise`\<`void`\>

###### Parameters

###### ws

`WebSocket`

###### code

`number`

###### reason

`string`

###### wasClean

`boolean`

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

`DurableObject.webSocketClose`

##### webSocketError()?

> `optional` **webSocketError**(`ws`, `error`): `void` \| `Promise`\<`void`\>

###### Parameters

###### ws

`WebSocket`

###### error

`unknown`

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

`DurableObject.webSocketError`

##### webSocketMessage()?

> `optional` **webSocketMessage**(`ws`, `message`): `void` \| `Promise`\<`void`\>

###### Parameters

###### ws

`WebSocket`

###### message

`string` \| `ArrayBuffer`

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

`DurableObject.webSocketMessage`

## Variables

### HOST\_INTERVAL\_MS

> `const` **HOST\_INTERVAL\_MS**: `1000` = `1000`

The least time between two requests Alexandria sends to one host.

## Functions

### waitForHost()

> **waitForHost**(`env`, `host`): `Promise`\<`void`\>

Waits until a request to `host` may be sent.

#### Parameters

##### env

[`Env`](../env.md#env)

##### host

`string`

#### Returns

`Promise`\<`void`\>
