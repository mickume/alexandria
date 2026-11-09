# worker/meaning/backfill

## Variables

### BACKFILL\_PER\_MINUTE

> `const` **BACKFILL\_PER\_MINUTE**: `60` = `60`

The most links one user has queued for indexing by the backfill in a minute.

## Functions

### backfillIndex()

> **backfillIndex**(`env`): `Promise`\<`void`\>

Queues, for every account not marked for deletion, at most 60 of its stale
links that were not queued in the last 10 minutes, the most recently used
first. A user whose queueing fails does not hold back the others.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### drainVectorDeletions()

> **drainVectorDeletions**(`env`): `Promise`\<`void`\>

Deletes the vectors queued in vector_deletions from the index, a thousand to
a call, and removes each id from the queue once its call has succeeded. A
failing call throws with the ids still queued.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### maintainIndex()

> **maintainIndex**(`env`): `Promise`\<`void`\>

One minute of the index's upkeep: the deletions first, then the backfill, whatever the first does.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>
