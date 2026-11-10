# worker/stats/daily

## Interfaces

### Count

What one count statement adds, and when.

#### Properties

##### amount?

> `optional` **amount?**: `string`

An SQL expression of how many to add; 1 by default.

##### at

> **at**: `string` \| `number` \| `Date`

When the event happened: its UTC day is the day counted.

##### binds?

> `optional` **binds?**: `unknown`[]

The values of `amount` and `when`'s parameters, numbered from ?3.

##### counter

> **counter**: `"added"` \| `"used"` \| `"expired"` \| `"removed"` \| `"deleted"` \| `"archived"` \| `"unarchived"` \| `"restored"` \| `"fetch_ok"` \| `"fetch_failed"` \| `"enriched"` \| `"enrichment_failed"` \| `"asks"`

##### userId

> **userId**: `string`

##### when?

> `optional` **when?**: `string`

An SQL condition the count is made on; the change's own result, read in the same batch.

***

### HistoryDay

One day of the record as GET /api/v1/stats/history answers it.

#### Indexable

> \[`counter`: `string`\]: `unknown`

#### Properties

##### day

> **day**: `string`

***

### UsageRecord

One provider call to record: when it ended, and the tokens its answer reported, if any.

#### Properties

##### at

> **at**: `Date`

##### model

> **model**: `string`

##### purpose

> **purpose**: [`Purpose`](#purpose-1)

##### tokens

> **tokens**: \{ `input`: `number`; `output`: `number`; \} \| `null`

##### userId

> **userId**: `string`

## Type Aliases

### Counter

> **Counter** = *typeof* [`COUNTERS`](#counters)\[`number`\]

***

### Purpose

> **Purpose** = `"enrich"` \| `"split"` \| `"ask"` \| `"key_test"`

Why a call to the owner's AI provider was made.

## Variables

### COUNTERS

> `const` **COUNTERS**: readonly \[`"added"`, `"used"`, `"expired"`, `"removed"`, `"deleted"`, `"archived"`, `"unarchived"`, `"restored"`, `"fetch_ok"`, `"fetch_failed"`, `"enriched"`, `"enrichment_failed"`, `"asks"`\]

The events the daily record counts, one column each.

***

### SIZE\_STATES

> `const` **SIZE\_STATES**: readonly \[`"pending"`, `"active"`, `"unreachable"`, `"expired"`, `"archived"`\]

The size columns of the daily record, in the order the answer gives them.

***

### usageHooks

> `const` **usageHooks**: `object` = `{}`

Test seams of the usage recorder, as the clock is one.

#### Type Declaration

##### beforeRecord?

> `optional` **beforeRecord?**: () => `void`

###### Returns

`void`

## Functions

### countStatement()

> **countStatement**(`db`, `c`): `D1PreparedStatement`

The statement that adds to one counter of the user's day, to put in the
same batch as the change it counts. Nothing is added when `when` is false
or the amount is 0.

#### Parameters

##### db

`D1Database`

##### c

[`Count`](#count)

#### Returns

`D1PreparedStatement`

***

### dayOf()

> **dayOf**(`at`): `string`

The UTC day of a stored time or an instant, as 'YYYY-MM-DD'.

#### Parameters

##### at

`string` \| `number` \| `Date`

#### Returns

`string`

***

### readHistory()

> **readHistory**(`db`, `userId`, `days`): `Promise`\<\{ `days`: [`HistoryDay`](#historyday)[]; `recorded_since`: `string` \| `null`; \}\>

The user's record for `days` (UTC days, oldest first): every day present,
days before the first recorded day with null counters, recorded days with 0
for an event that did not happen, size null until it is recorded.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### days

`string`[]

#### Returns

`Promise`\<\{ `days`: [`HistoryDay`](#historyday)[]; `recorded_since`: `string` \| `null`; \}\>

***

### recordDaySizes()

> **recordDaySizes**(`db`, `t`): `Promise`\<`void`\>

Records, at an hourly run starting between 00:00 and 01:00 UTC, every
owner's library size under the UTC day that just ended: the total and the
count in each state, for every owner not being deleted. A day's size is
written once and never filled in later; a run outside that hour records
nothing.

#### Parameters

##### db

`D1Database`

##### t

`Date`

#### Returns

`Promise`\<`void`\>

***

### recordUsage()

> **recordUsage**(`db`, `u`): `Promise`\<`void`\>

Records one provider call under its UTC day, purpose and model: one more
call, and its tokens added, or one more call without usage when its answer
reported none (a failure, a timeout).

#### Parameters

##### db

`D1Database`

##### u

[`UsageRecord`](#usagerecord)

#### Returns

`Promise`\<`void`\>
