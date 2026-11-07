# worker/account/sweep

## Variables

### SWEEP\_CRON

> `const` **SWEEP\_CRON**: `"*/5 * * * *"` = `'*/5 * * * *'`

The cron trigger of the sweep (wrangler.jsonc).

## Functions

### sweepDeletions()

> **sweepDeletions**(`env`): `Promise`\<`void`\>

Runs the deletion job of every account marked more than 5 minutes ago, one
account at a time; each run queues the next until nothing remains.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>
