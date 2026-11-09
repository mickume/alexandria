# worker/search/hybrid

## Interfaces

### HybridEntry

A link of the ranking, with how it matched and, for a meaning match, its best passage.

#### Properties

##### id

> **id**: `string`

##### match

> **match**: [`MatchKind`](#matchkind)

##### passage?

> `optional` **passage?**: `string`

The text of the best passage; set when the link matched by meaning.

***

### HybridRanking

The whole ranking of a hybrid search, and whether meaning could be added to it.

#### Properties

##### entries

> **entries**: [`HybridEntry`](#hybridentry)[]

##### meaning

> **meaning**: `"used"` \| `"unavailable"`

## Type Aliases

### MatchKind

> **MatchKind** = `"keyword"` \| `"meaning"` \| `"both"`

How a link matched a hybrid search.

## Variables

### FUSION\_KEYWORD\_MAX

> `const` **FUSION\_KEYWORD\_MAX**: `1000` = `1_000`

How many keyword matches, best first, take part in the fusion; the rest follow in keyword order.

***

### MEANING\_CANDIDATES

> `const` **MEANING\_CANDIDATES**: `100` = `100`

How many links meaning adds at most, each with its best passage.

***

### MEANING\_DEADLINE\_MS

> `const` **MEANING\_DEADLINE\_MS**: `600` = `600`

How long the embedding and the query may take, in milliseconds, before meaning is given up.

***

### SNIPPET\_WORDS

> `const` **SNIPPET\_WORDS**: `32` = `32`

The most words of a passage a meaning match's snippet holds.

## Functions

### hybridRanking()

> **hybridRanking**(`env`, `userId`, `words`, `filters`): `Promise`\<[`HybridRanking`](#hybridranking)\>

The ranking of a search with at least one free word: the keyword matches
(all of them), and the links whose best passage reaches the similarity
threshold, in one order. When Workers AI or Vectorize fails or is too slow
the ranking is the keyword matches alone, each `keyword`, `unavailable`.

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

### passageSnippet()

> **passageSnippet**(`passage`): `string`

The first `SNIPPET_WORDS` words of a passage, as one unmarked segment's text.

#### Parameters

##### passage

`string`

#### Returns

`string`
