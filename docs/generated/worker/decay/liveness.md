# worker/decay/liveness

## Interfaces

### CheckOutcome

What one liveness check found.

#### Properties

##### passed

> **passed**: `boolean`

##### result

> **result**: `string`

'HTTP <status>' for an answer, or why there was none.

## Variables

### CHECK\_INTERVAL\_MS

> `const` **CHECK\_INTERVAL\_MS**: `number`

A link is checked every this many days.

***

### CHECK\_TIMEOUT\_MS

> `const` **CHECK\_TIMEOUT\_MS**: `10000` = `10_000`

How long one liveness request may take.

***

### checkRoutes

> `const` **checkRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

Checking one link on demand, under /api/v1/links.

***

### DEAD\_AFTER

> `const` **DEAD\_AFTER**: `3` = `3`

Consecutive failed weekly checks that make a link dead.

***

### ENQUEUE\_WINDOW\_MS

> `const` **ENQUEUE\_WINDOW\_MS**: `number`

A link enqueued less than this long ago is not enqueued again.

***

### MANUAL\_CHECK\_INTERVAL\_MS

> `const` **MANUAL\_CHECK\_INTERVAL\_MS**: `number`

The least time between two on-demand checks of one link.

## Functions

### checkDue()

> **checkDue**(`l`, `checkedBefore`, `enqueuedBefore`): `string`

The SQL condition that the link `l` is due a weekly check: neither expired nor
archived, active or pinned, last checked (or, never checked, added) at or
before `checkedBefore`, and not enqueued after `enqueuedBefore`; both are SQL
expressions of stored times, such as bound parameters.

#### Parameters

##### l

`string`

##### checkedBefore

`string`

##### enqueuedBefore

`string`

#### Returns

`string`

***

### checkDueTimes()

> **checkDueTimes**(`t`): \[`string`, `string`\]

The stored times checkDue compares with at `t`: the check interval and the enqueue window before it.

#### Parameters

##### t

`number`

#### Returns

\[`string`, `string`\]

***

### checkLink()

> **checkLink**(`env`, `url`, `__namedParameters?`): `Promise`\<[`CheckOutcome`](#checkoutcome)\>

Checks that a link's address still answers: HEAD through the fetcher's
request path (blocked addresses refused, at most 5 redirects, the host
gate), and when the HEAD fails in any way a GET that reads only the
headers. It passes on a final 2xx. A failure of Alexandria's own (the host
gate unavailable) is thrown, so that it never counts against the link.

#### Parameters

##### env

[`Env`](../env.md#env)

##### url

`string`

##### \_\_namedParameters?

###### timeoutMs?

`number` = `CHECK_TIMEOUT_MS`

#### Returns

`Promise`\<[`CheckOutcome`](#checkoutcome)\>

***

### enqueueDueChecks()

> **enqueueDueChecks**(`env`): `Promise`\<`void`\>

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### handleLivenessBatch()

> **handleLivenessBatch**(`batch`, `env`): `Promise`\<`void`\>

The LIVENESS_QUEUE consumer. A message for a link deleted, expired or no
longer due is dropped. Anything that fails for Alexandria's own reasons
hands the message back to the queue and changes nothing.

#### Parameters

##### batch

`MessageBatch`\<[`LivenessMessage`](../env.md#livenessmessage)\>

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### isCheckable()

> **isCheckable**(`link`): `boolean`

Whether a link is one the weekly checks cover: neither expired nor archived, and active or pinned.

#### Parameters

##### link

`Pick`\<[`LinkRow`](../links/store.md#linkrow), `"state"` \| `"pin_position"`\>

#### Returns

`boolean`
