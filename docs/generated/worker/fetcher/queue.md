# worker/fetcher/queue

## Functions

### handleFetchBatch()

> **handleFetchBatch**(`batch`, `env`, `_ctx?`): `Promise`\<`void`\>

The FETCH_QUEUE consumer. The messages of a batch are processed
concurrently, so that a wait at one host's gate does not hold up the others.

#### Parameters

##### batch

`MessageBatch`\<[`FetchMessage`](../env.md#fetchmessage)\>

##### env

[`Env`](../env.md#env)

##### \_ctx?

`ExecutionContext`\<`unknown`\>

#### Returns

`Promise`\<`void`\>

***

### lastSegmentOrHost()

> **lastSegmentOrHost**(`url`): `string`

The last path segment of `url`, decoded, or its host when the path has none.

#### Parameters

##### url

`string`

#### Returns

`string`
