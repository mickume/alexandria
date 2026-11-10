# worker/decay/cron

## Variables

### DECAY\_INTERVAL\_MS

> `const` **DECAY\_INTERVAL\_MS**: `number`

A user is evaluated again once this long has passed since their last completed evaluation.

## Functions

### runScheduled()

> **runScheduled**(`env`): `Promise`\<`void`\>

The hourly scheduled run: evaluates decay, removal included, for every user
whose last completed evaluation started 20 hours or more ago (or never), one
user at a time, so that one user's failure leaves their links as they were
and does not stop the others; they are evaluated again at the next run.
Then it enqueues the liveness checks that are due. A run in the hour after
midnight UTC first records every owner's size for the day that ended.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>
