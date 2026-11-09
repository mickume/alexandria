# worker/search/search

## Interfaces

### KeywordMatch

A link matching a keyword search, with what orders it among the others.

#### Properties

##### id

> **id**: `string`

##### last\_used\_at

> **last\_used\_at**: `string`

##### pin\_position

> **pin\_position**: `number` \| `null`

##### score

> **score**: `number`

The relevance (bm25, lower is more relevant); links with the same score tie.

***

### RankedLink

One link of a search's results, by id, with its snippet.

#### Properties

##### id

> **id**: `string`

##### snippet

> **snippet**: [`Segment`](#segment)[]

***

### Segment

A piece of a snippet: text, and whether it is a matched word.

#### Properties

##### match

> **match**: `boolean`

##### text

> **text**: `string`

***

### WorkspaceResult

A workspace among a search's results.

#### Properties

##### id

> **id**: `string`

##### name

> **name**: `string`

##### snippet

> **snippet**: [`Segment`](#segment)[]

## Variables

### INDEXED\_TEXT\_MAX

> `const` **INDEXED\_TEXT\_MAX**: `500000` = `500_000`

The most reader-view text the index holds for a link, in characters.

***

### SNIPPET\_WORDS

> `const` **SNIPPET\_WORDS**: `32` = `32`

The longest snippet, in words.

## Functions

### indexReaderText()

> **indexReaderText**(`env`, `linkId`, `text`): `Promise`\<`void`\>

Indexes `text` as the link's reader-view text, at most its first 500,000 characters.

#### Parameters

##### env

[`Env`](../env.md#env)

##### linkId

`string`

##### text

`string` \| `null`

#### Returns

`Promise`\<`void`\>

***

### indexReaderTextStatement()

> **indexReaderTextStatement**(`db`, `linkId`, `text`): `D1PreparedStatement`

The statement that makes `text` (or none, for null) the reader-view text
indexed for a link, replacing what was indexed before. The fetch worker
runs it in the batch that stores the text.

#### Parameters

##### db

`D1Database`

##### linkId

`string`

##### text

`string` \| `null`

#### Returns

`D1PreparedStatement`

***

### keywordMatches()

> **keywordMatches**(`db`, `userId`, `match`, `where`): `Promise`\<[`KeywordMatch`](#keywordmatch)[]\>

Every one of the user's links matching `match`, in the order `rankedLinks`
pages them, each with its relevance, pin position and last use.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### match

`string`

##### where

[`Conditions`](query.md#conditions)

#### Returns

`Promise`\<[`KeywordMatch`](#keywordmatch)[]\>

***

### linkMatch()

> **linkMatch**(`userId`, `words`): `string` \| `null`

The match expression of a link search for the user's free words.

#### Parameters

##### userId

`string`

##### words

`string`[]

#### Returns

`string` \| `null`

***

### matchExpression()

> **matchExpression**(`userId`, `words`, `columns`): `string` \| `null`

The FTS5 match expression that finds the user's rows holding every free
word as the prefix of a word, or null when no word has anything to match.
Each word is a quoted string, so the engine's operators and punctuation are
text, never syntax.

#### Parameters

##### userId

`string`

##### words

`string`[]

##### columns

`string`

#### Returns

`string` \| `null`

***

### matchingWorkspaces()

> **matchingWorkspaces**(`db`, `userId`, `words`): `Promise`\<[`WorkspaceResult`](#workspaceresult)[]\>

The user's workspaces whose name, description or note holds every free word, best first.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### words

`string`[]

#### Returns

`Promise`\<[`WorkspaceResult`](#workspaceresult)[]\>

***

### ownerTerm()

> **ownerTerm**(`userId`): `string`

The term every index row of a user carries: 'u' and the user's id without hyphens.

#### Parameters

##### userId

`string`

#### Returns

`string`

***

### rankedLinks()

> **rankedLinks**(`db`, `userId`, `match`, `where`, `limit`, `offset`): `Promise`\<[`RankedLink`](#rankedlink)[]\>

One page of the user's links matching `match`, most relevant first (bm25,
title 10, tags and topic 5, summary 3, host, original URL and note 2,
reader text 1), then pinned by position, then the more recently used, then
by id; each with its snippet. Fetches one more than `limit`, so the caller
knows whether a next page exists.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### match

`string`

##### where

[`Conditions`](query.md#conditions)

##### limit

`number`

##### offset

`number`

#### Returns

`Promise`\<[`RankedLink`](#rankedlink)[]\>

***

### segments()

> **segments**(`marked`): [`Segment`](#segment)[]

Splits a snippet marked with OPEN and CLOSE into segments; never HTML.

#### Parameters

##### marked

`string`

#### Returns

[`Segment`](#segment)[]

***

### snippetsFor()

> **snippetsFor**(`db`, `match`, `ids`): `Promise`\<`Map`\<`string`, [`Segment`](#segment)[]\>\>

The snippets of the links `ids` for the search `match`, by link id.

#### Parameters

##### db

`D1Database`

##### match

`string`

##### ids

`string`[]

#### Returns

`Promise`\<`Map`\<`string`, [`Segment`](#segment)[]\>\>

***

### strongMatchIds()

> **strongMatchIds**(`db`, `userId`, `words`, `where`): `Promise`\<`Set`\<`string`\>\>

The ids of the user's links whose title, tags and topic together hold every
free word as the start of a word: the keyword matches that are not left to
the note, the summary, the address or the page's text alone.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### words

`string`[]

##### where

[`Conditions`](query.md#conditions)

#### Returns

`Promise`\<`Set`\<`string`\>\>
