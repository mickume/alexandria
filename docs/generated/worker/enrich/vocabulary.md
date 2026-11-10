# worker/enrich/vocabulary

## Interfaces

### ResolveOptions

How names are matched to the user's vocabulary.

#### Properties

##### near?

> `optional` **near?**: `boolean`

Whether a name with no equal also reuses a near one (nearKeys: hyphens
dropped, singular or plural). Enrichment asks for it so that the model's
variants converge; an owner's own edit does not, so it is taken as typed.

## Variables

### PROMPT\_TAGS

> `const` **PROMPT\_TAGS**: `300` = `300`

***

### PROMPT\_TOPICS

> `const` **PROMPT\_TOPICS**: `100` = `100`

How many of the user's topics and tags the provider is shown.

***

### TOPIC\_LEVELS

> `const` **TOPIC\_LEVELS**: `3` = `3`

The deepest level of the topic tree: a top-level topic is level 1.

## Functions

### listAliases()

> **listAliases**(`db`, `userId`): `Promise`\<[`Aliases`](enrich.md#aliases)\>

The user's aliases of topics and tags, by nameKey, each with its survivor's
name. An alias that is also a current name is left out: a current name wins.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<[`Aliases`](enrich.md#aliases)\>

***

### listVocabulary()

> **listVocabulary**(`db`, `userId`): `Promise`\<\{ `tags`: [`VocabularyEntry`](enrich.md#vocabularyentry)[]; `topics`: [`VocabularyEntry`](enrich.md#vocabularyentry)[]; \}\>

The user's most used topic and tag names with their link counts, for the provider to reuse.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<\{ `tags`: [`VocabularyEntry`](enrich.md#vocabularyentry)[]; `topics`: [`VocabularyEntry`](enrich.md#vocabularyentry)[]; \}\>

***

### resolveTags()

> **resolveTags**(`db`, `userId`, `names`, `options?`): `Promise`\<`string`[]\>

The ids of the user's tags named `names` (or, with `near`, near names), in
order and without repeats, created where there are none.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### names

`string`[]

##### options?

[`ResolveOptions`](#resolveoptions) = `{}`

#### Returns

`Promise`\<`string`[]\>

***

### resolveTopic()

> **resolveTopic**(`db`, `userId`, `name`, `options?`): `Promise`\<`string`\>

The id of the user's topic named `name` (or, with `near`, a near name), created at the top level when there is none.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### name

`string`

##### options?

[`ResolveOptions`](#resolveoptions) = `{}`

#### Returns

`Promise`\<`string`\>

***

### resolveTopicPath()

> **resolveTopicPath**(`db`, `userId`, `names`, `__namedParameters?`): `Promise`\<`string`\>

The id of the topic a path of names leads to in the user's topic tree,
resolving the names from the first. A name equal to a topic's name or to an
alias (nameKey), or with `near` a near name, is that topic wherever it is
in the tree, and the next name belongs under it. Any other name is created
as given under the topic the name before it led to (at the top level for
the first), or, where that would be below the third level, beside it.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### names

`string`[]

##### \_\_namedParameters?

[`ResolveOptions`](#resolveoptions) = `{}`

#### Returns

`Promise`\<`string`\>

***

### setTagsStatements()

> **setTagsStatements**(`db`, `userId`, `linkId`, `tagIds`): `D1PreparedStatement`[]

The statements that give one of the user's links exactly the tags `tagIds`,
in that order. Tags the link keeps are never removed on the way, so that a
kept tag is not deleted as unused in between.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### linkId

`string`

##### tagIds

`string`[]

#### Returns

`D1PreparedStatement`[]
