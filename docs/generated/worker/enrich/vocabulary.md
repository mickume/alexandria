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

### dropIfEmptyStatement()

> **dropIfEmptyStatement**(`db`, `topicId`): `D1PreparedStatement`

The statement that deletes a topic with no link and no topic beneath it.

#### Parameters

##### db

`D1Database`

##### topicId

`string`

#### Returns

`D1PreparedStatement`

***

### listAliases()

> **listAliases**(`db`, `userId`): `Promise`\<[`Aliases`](enrich.md#aliases)\>

The user's tag aliases, by nameKey, each with its survivor's name. An alias
that is also a current name is left out: a current name wins. (Topic
aliases are matched name by name as a topic path is resolved.)

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<[`Aliases`](enrich.md#aliases)\>

***

### listVocabulary()

> **listVocabulary**(`db`, `userId`): `Promise`\<\{ `tags`: [`VocabularyEntry`](enrich.md#vocabularyentry)[]; `topics`: `string`[]; \}\>

What the provider is shown of the user's vocabulary, for it to reuse: the
paths of the 100 topics whose newest link, filed under the topic or under a
topic beneath it, was added most recently, each as its names from the top
level down joined with ' > ', without counts; and the 300 most used tags,
each with its number of links.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<\{ `tags`: [`VocabularyEntry`](enrich.md#vocabularyentry)[]; `topics`: `string`[]; \}\>

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

> **setTagsStatements**(`db`, `userId`, `linkId`, `tagIds`, `__namedParameters?`): `D1PreparedStatement`[]

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

##### \_\_namedParameters?

###### unlessEdited?

`boolean` = `false`

#### Returns

`D1PreparedStatement`[]
