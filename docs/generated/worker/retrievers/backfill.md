# worker/retrievers/backfill

## Variables

### RETRIEVAL\_PAUSE\_MS

> `const` **RETRIEVAL\_PAUSE\_MS**: `number`

How long a retriever's one-time retrieval waits after its API's limit or quota was spent.

***

### RETRIEVAL\_PER\_MINUTE

> `const` **RETRIEVAL\_PER\_MINUTE**: `20` = `20`

The most links the one-time retrieval sends to the fetch worker in a minute.

## Functions

### pauseRetrieval()

> **pauseRetrieval**(`env`, `retriever`, `userId`, `linkId`): `Promise`\<`void`\>

Hands `linkId` back to `retriever`'s one-time retrieval and pauses that
retrieval for an hour: its API answered that its rate limit or quota is
spent, and the link is to be retried, not fetched as a page.

#### Parameters

##### env

[`Env`](../env.md#env)

##### retriever

[`RetrieverName`](retriever.md#retrievername-1)

##### userId

`string`

##### linkId

`string`

#### Returns

`Promise`\<`void`\>

***

### retrieveStoredLinks()

> **retrieveStoredLinks**(`env`, `retrievers?`): `Promise`\<`number`\>

The every-minute run of the one-time retrieval: while no import has links
waiting, sends up to 20 links, each enabled retriever in turn, skipping a
retriever whose API's limit was spent in the last hour. Returns how many
links were sent.

#### Parameters

##### env

[`Env`](../env.md#env)

##### retrievers?

[`Retriever`](retriever.md#retriever)\<`unknown`\>[] = `RETRIEVERS`

#### Returns

`Promise`\<`number`\>
