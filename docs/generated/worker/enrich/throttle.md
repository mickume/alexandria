# worker/enrich/throttle

## Variables

### MAX\_DELAY\_SECONDS

> `const` **MAX\_DELAY\_SECONDS**: `number`

The longest delay a queue message can be sent with.

***

### THROTTLE\_SPACING\_MS

> `const` **THROTTLE\_SPACING\_MS**: `3000` = `3_000`

The time between two of a user's background jobs: at most 20 a minute.

## Functions

### deferIfEarly()

> **deferIfEarly**(`env`, `body`): `Promise`\<`boolean`\>

Whether a throttled message arrived before its slot; if so it has been sent
again for the time left, and the caller must not process it.

#### Parameters

##### env

[`Env`](../env.md#env)

##### body

[`EnrichMessage`](../env.md#enrichmessage)

#### Returns

`Promise`\<`boolean`\>

***

### delayUntil()

> **delayUntil**(`slot`): `number`

The delay to send a message for `slot` with: the time left, at most 12 hours.

#### Parameters

##### slot

`number`

#### Returns

`number`

***

### scheduleThrottled()

> **scheduleThrottled**(`db`, `userId`, `count`): `Promise`\<`number`[]\>

Reserves `count` background slots for a user: the first at the user's next
free slot, or now when that has passed, and each later one 3 seconds after
the one before. One statement moves the user's next free slot, so
concurrent calls never share a slot. Returns the slots, in milliseconds
since the epoch.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### count

`number`

#### Returns

`Promise`\<`number`[]\>

***

### sendThrottled()

> **sendThrottled**(`env`, `userId`, `linkIds`): `Promise`\<`void`\>

Schedules enrichment of `linkIds` through the user's throttle: each message
carries its slot and is sent with the delay to it, at most 12 hours; one that
arrives early is sent again for the time left (see deferIfEarly).

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkIds

`string`[]

#### Returns

`Promise`\<`void`\>
