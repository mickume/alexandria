# worker/retrievers/registry

## Interfaces

### Found

A retriever's claim on an address, ready to retrieve.

#### Properties

##### claim

> **claim**: `unknown`

##### retriever

> **retriever**: [`Retriever`](retriever.md#retriever)

## Variables

### RETRIEVERS

> `const` **RETRIEVERS**: [`Retriever`](retriever.md#retriever)[]

Every retriever, in the order they are asked.

## Functions

### findRetriever()

> **findRetriever**(`env`, `url`, `retrievers?`): [`Found`](#found) \| `null`

The retriever that claims `url`, with its claim; null when none does.

#### Parameters

##### env

[`Env`](../env.md#env)

##### url

`string`

##### retrievers?

[`Retriever`](retriever.md#retriever)\<`unknown`\>[] = `RETRIEVERS`

#### Returns

[`Found`](#found) \| `null`

***

### retrieve()

> **retrieve**(`env`, `found`): `Promise`\<[`RetrieveResult`](retriever.md#retrieveresult)\>

Retrieves what `found` claims.

#### Parameters

##### env

[`Env`](../env.md#env)

##### found

[`Found`](#found)

#### Returns

`Promise`\<[`RetrieveResult`](retriever.md#retrieveresult)\>

***

### retrievedNote()

> **retrievedNote**(`retriever`): `string`

The note a retrieved link carries.

#### Parameters

##### retriever

[`Retriever`](retriever.md#retriever)

#### Returns

`string`
