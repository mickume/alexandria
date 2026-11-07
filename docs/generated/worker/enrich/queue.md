# worker/enrich/queue

## Functions

### afterFetch()

> **afterFetch**(`env`, `link`, `notes`): `Promise`\<`void`\>

Hands a freshly fetched link to enrichment: skipped when it has nothing to
read, 'no_key' without a key, 'waiting_for_key' while the key is rejected,
else 'queued' with an enrichment message sent at once.

#### Parameters

##### env

[`Env`](../env.md#env)

##### link

`Pick`\<[`LinkRow`](../links/store.md#linkrow), `"id"` \| `"user_id"`\>

##### notes

`string`[]

#### Returns

`Promise`\<`void`\>

***

### handleEnrichBatch()

> **handleEnrichBatch**(`batch`, `env`): `Promise`\<`void`\>

The ENRICH_QUEUE consumer.

#### Parameters

##### batch

`MessageBatch`\<[`EnrichMessage`](../env.md#enrichmessage)\>

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### hasNothingToEnrich()

> **hasNothingToEnrich**(`notes`): `boolean`

Whether a fetched link with these notes has nothing for enrichment to read.

#### Parameters

##### notes

`string`[]

#### Returns

`boolean`

***

### setEnrichmentStatus()

> **setEnrichmentStatus**(`db`, `link`, `status`, `reason?`): `Promise`\<`void`\>

Sets a link's enrichment status (and reason), touching its change time.

#### Parameters

##### db

`D1Database`

##### link

`Pick`\<[`LinkRow`](../links/store.md#linkrow), `"id"` \| `"user_id"`\>

##### status

`string`

##### reason?

`string` \| `null` = `null`

#### Returns

`Promise`\<`void`\>
