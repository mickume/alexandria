# worker/search/hybrid

## Interfaces

### HybridEntry

A link of the ranking, with how it matched and, for a meaning match, its best passage.

#### Properties

##### id

> **id**: `string`

##### match

> **match**: [`MatchKind`](../meaning/passages.md#matchkind)

##### passage?

> `optional` **passage?**: `string`

The text of the best passage; set when the link matched by meaning.

***

### HybridRanking

The whole ranking of a hybrid search, and whether meaning took part in it.

#### Properties

##### entries

> **entries**: [`HybridEntry`](#hybridentry)[]

##### meaning

> **meaning**: [`Meaning`](../meaning/passages.md#meaning-1)

## Variables

### FUSION\_KEYWORD\_MAX

> `const` **FUSION\_KEYWORD\_MAX**: `1000` = `1_000`

How many keyword matches, best first, take part in the fusion; the rest follow in keyword order.

***

### MEANING\_CANDIDATES

> `const` **MEANING\_CANDIDATES**: `50` = `50`

How many links their passages add at most, each with its best passage.

***

### MEANING\_DEADLINE\_MS

> `const` **MEANING\_DEADLINE\_MS**: `3000` = `3_000`

How long a search waits for meaning and reranking together, in milliseconds.

***

### SNIPPET\_DEADLINE\_MS

> `const` **SNIPPET\_DEADLINE\_MS**: `1500` = `1_500`

How long a page waits for the reranker to choose its snippets, in milliseconds.

## Functions

### hybridRanking()

> **hybridRanking**(`env`, `userId`, `words`, `filters`): `Promise`\<[`HybridRanking`](#hybridranking)\>

The ranking of a search with at least one free word: the keyword matches
(all of them), and the links one of whose passages answers the query, in
one order. The search waits MEANING_DEADLINE_MS for meaning and reranking:
without the reranker the passages are those the index vouches for
(`unranked`); without the index, the keyword matches alone (`unavailable`).

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### words

`string`[]

##### filters

[`Filters`](query.md#filters)

#### Returns

`Promise`\<[`HybridRanking`](#hybridranking)\>

***

### passageSnippets()

> **passageSnippets**(`env`, `words`, `passages`): `Promise`\<`Map`\<`string`, [`Segment`](search.md#segment)[]\>\>

The snippet of each meaning match: the run of at most SNIPPET_WORDS words
of its best passage that the reranker scores highest against the query,
with the query's words marked in it. When the reranker fails or is late,
the start of each passage, unmarked.

#### Parameters

##### env

[`Env`](../env.md#env)

##### words

`string`[]

##### passages

`object`[]

#### Returns

`Promise`\<`Map`\<`string`, [`Segment`](search.md#segment)[]\>\>

## References

### MatchKind

Re-exports [MatchKind](../meaning/passages.md#matchkind)
