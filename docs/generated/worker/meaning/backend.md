# worker/meaning/backend

## Interfaces

### MeaningBackend

Embeddings and the vector index. Every method throws when the service fails.

#### Methods

##### deleteByIds()

> **deleteByIds**(`ids`): `Promise`\<`void`\>

Removes the vectors with these ids, in whatever namespace.

###### Parameters

###### ids

`string`[]

###### Returns

`Promise`\<`void`\>

##### embed()

> **embed**(`texts`): `Promise`\<`number`[][]\>

The embedding of each text, in order.

###### Parameters

###### texts

`string`[]

###### Returns

`Promise`\<`number`[][]\>

##### query()

> **query**(`namespace`, `vector`, `topK`, `filter?`): `Promise`\<[`VectorMatch`](#vectormatch)[]\>

The `topK` vectors of the namespace nearest to `vector`, nearest first,
among those matching `filter`.

###### Parameters

###### namespace

`string`

###### vector

`number`[]

###### topK

`number`

###### filter?

[`VectorFilter`](#vectorfilter)

###### Returns

`Promise`\<[`VectorMatch`](#vectormatch)[]\>

##### upsert()

> **upsert**(`namespace`, `vectors`): `Promise`\<`void`\>

Stores the vectors in the namespace, replacing those with the same id.

###### Parameters

###### namespace

`string`

###### vectors

[`PassageVector`](#passagevector)[]

###### Returns

`Promise`\<`void`\>

***

### PassageVector

A vector to store: the passage's vector id, its embedding and what it was cut from.

#### Properties

##### id

> **id**: `string`

##### metadata

> **metadata**: `object`

###### kind

> **kind**: [`PassageKind`](cut.md#passagekind)

##### values

> **values**: `number`[]

***

### VectorFilter

A filter on the vectors a query may return, by their metadata. A property
is filtered on only once the index has a metadata index on it
(scripts/provision.sh creates the one on `kind`).

#### Properties

##### kind?

> `optional` **kind?**: [`PassageKind`](cut.md#passagekind)

***

### VectorMatch

A vector the index found, with its similarity to the query.

#### Properties

##### id

> **id**: `string`

##### score

> **score**: `number`

## Variables

### EMBEDDING\_MODEL

> `const` **EMBEDDING\_MODEL**: `"@cf/baai/bge-m3"` = `'@cf/baai/bge-m3'`

The embedding model: multilingual, with a window that holds a whole passage.

***

### MUTATION\_BATCH

> `const` **MUTATION\_BATCH**: `1000` = `1_000`

The most vectors, or ids, one Vectorize mutation carries.

***

### QUERY\_TOP\_K

> `const` **QUERY\_TOP\_K**: `100` = `100`

The most vectors a query asks the index for.

***

### SIMILARITY\_THRESHOLD

> `const` **SIMILARITY\_THRESHOLD**: `0.5` = `0.5`

The similarity (cosine) a passage must reach to be returned. One constant for
every use of the index, provisional until it is tuned against a real library.

## Functions

### meaningBackend()

> **meaningBackend**(`env`): [`MeaningBackend`](#meaningbackend)

The backend the Worker runs with.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

[`MeaningBackend`](#meaningbackend)
