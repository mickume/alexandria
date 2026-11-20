# worker/enrich/resume

## Variables

### RESUME\_PER\_MINUTE

> `const` **RESUME\_PER\_MINUTE**: `20` = `20`

The most waiting links queued again a minute, across every owner.

***

### WAITING\_STATES

> `const` **WAITING\_STATES**: `string`[]

The enrichment states of links that wait for a usable AI key.

## Functions

### resumeEnrichment()

> **resumeEnrichment**(`env`): `Promise`\<`number`\>

The every-minute resumption of enrichment: once the deployment has an AI
key its provider has not refused (a new key, or a refusal an hour old), the
links that waited for one ('no_key', 'waiting_for_key') are queued again,
20 a minute across the owners whose accounts are not being deleted, the
longest waiting first, each through its owner's throttle. Returns how many
were queued.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`number`\>
