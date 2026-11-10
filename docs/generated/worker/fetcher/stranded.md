# worker/fetcher/stranded

## Variables

### ENRICHMENT\_LOST\_REASON

> `const` **ENRICHMENT\_LOST\_REASON**: `"the enrichment did not complete"` = `'the enrichment did not complete'`

Why a link whose enrichment never came back failed.

***

### FETCH\_LOST\_REASON

> `const` **FETCH\_LOST\_REASON**: `"the fetch did not complete"` = `'the fetch did not complete'`

Why a link whose fetch never came back is unreachable.

***

### RECOVERY\_BATCH

> `const` **RECOVERY\_BATCH**: `500` = `500`

The most links one run sends to the fetch worker again.

***

### STRANDED\_AFTER\_MS

> `const` **STRANDED\_AFTER\_MS**: `number`

How long a link may wait, untouched, before the work it waits for is taken
as lost: longer than the longest wait a first fetch has between attempts
(2 hours).

## Functions

### recoverStranded()

> **recoverStranded**(`env`): `Promise`\<`number`\>

Recovers the links whose queue message was lost: a send that failed after
the link was stored, or a message dropped after its last retry. A link left
pending and untouched for STRANDED_AFTER_MS counts one more attempt and is
sent to the fetch worker again, or, at its last attempt, becomes unreachable
with a reason, so that it can be refreshed by hand. A link left queued for
enrichment that long, with none of its user's throttled slots still ahead,
is marked failed, which 'enrich all' picks up. Returns how many links were
sent again.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`number`\>
