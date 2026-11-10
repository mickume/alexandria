# worker/search/vocabulary

## Interfaces

### TopicEntry

A topic with its place in the tree and its links, as a move answers it.

#### Properties

##### count

> **count**: `number`

##### id

> **id**: `string`

##### name

> **name**: `string`

##### parent\_id

> **parent\_id**: `string` \| `null`

##### subtree\_count

> **subtree\_count**: `number`

***

### VocabularyCursor

Where a page of a vocabulary list ends: at the newest-link date and id of its last item.

#### Properties

##### i

> **i**: `string`

##### n

> **n**: `string`

##### v

> **v**: `"n"`

***

### VocabularyEntry

A topic or tag with its number of links.

#### Properties

##### count

> **count**: `number`

##### id

> **id**: `string`

##### name

> **name**: `string`

***

### VocabularyItem

A topic or tag as listed; a topic also with its parent_id and subtree_count.

#### Properties

##### count

> **count**: `number`

##### id

> **id**: `string`

##### name

> **name**: `string`

##### newest\_added\_at

> **newest\_added\_at**: `string`

##### parent\_id?

> `optional` **parent\_id?**: `string` \| `null`

##### subtree\_count?

> `optional` **subtree\_count?**: `number`

## Type Aliases

### MergeRefusal

> **MergeRefusal** = `"invalid_merge"` \| `"too_deep"`

Why a merge of topics was refused.

***

### MoveRefusal

> **MoveRefusal** = `"not_found"` \| `"invalid_move"` \| `"too_deep"`

Why a move was refused.

***

### VocabularyKind

> **VocabularyKind** = `"topics"` \| `"tags"`

Topics or tags: which vocabulary a route is about.

## Variables

### TAG\_NAME\_MAX

> `const` **TAG\_NAME\_MAX**: `50` = `50`

The longest tag and topic names.

***

### TOPIC\_NAME\_MAX

> `const` **TOPIC\_NAME\_MAX**: `100` = `100`

## Functions

### carrierIds()

> **carrierIds**(`db`, `userId`, `kind`, `id`, `__namedParameters?`): `Promise`\<`string`[]\>

The ids of the user's links carrying one of their topics or tags, or filed under a topic or beneath it.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### kind

[`VocabularyKind`](#vocabularykind)

##### id

`string`

##### \_\_namedParameters?

###### subtree?

`boolean` = `false`

#### Returns

`Promise`\<`string`[]\>

***

### getEntry()

> **getEntry**(`db`, `userId`, `kind`, `id`): `Promise`\<[`VocabularyEntry`](#vocabularyentry) \| `null`\>

One of the user's topics or tags with its number of links, or null when the user has none such.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### kind

[`VocabularyKind`](#vocabularykind)

##### id

`string`

#### Returns

`Promise`\<[`VocabularyEntry`](#vocabularyentry) \| `null`\>

***

### isVocabularyCursor()

> **isVocabularyCursor**(`value`): `value is VocabularyCursor`

#### Parameters

##### value

`unknown`

#### Returns

`value is VocabularyCursor`

***

### listVocabularyItems()

> **listVocabularyItems**(`db`, `userId`, `kind`, `limit`, `after`): `Promise`\<\{ `items`: [`VocabularyItem`](#vocabularyitem)[]; `next`: [`VocabularyCursor`](#vocabularycursor) \| `null`; \}\>

One page of the user's topics or tags that have a link: each with the
number of its links in any state and the added date of its newest link,
newest first, the id breaking ties. A topic is listed with its parent and
counted over the links beneath it too (subtree_count, newest_added_at); its
own count is of the links filed directly under it, which may be none.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### kind

[`VocabularyKind`](#vocabularykind)

##### limit

`number`

##### after

[`VocabularyCursor`](#vocabularycursor) \| `null`

#### Returns

`Promise`\<\{ `items`: [`VocabularyItem`](#vocabularyitem)[]; `next`: [`VocabularyCursor`](#vocabularycursor) \| `null`; \}\>

***

### mergeEntry()

> **mergeEntry**(`db`, `userId`, `kind`, `sourceId`, `targetId`): `Promise`\<[`VocabularyEntry`](#vocabularyentry) \| [`MergeRefusal`](#mergerefusal) \| `null`\>

Merges one of the user's topics or tags into another in one batch: every
link of the source gets the target (a link never carries a tag twice),
the source's name and aliases become aliases of the target, and the source
is deleted. A topic's children become the target's first, and every link
beneath the source is marked changed; a target beneath the source, or a
child that would end up below the third level, refuses the merge. Null
when either is not the user's.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### kind

[`VocabularyKind`](#vocabularykind)

##### sourceId

`string`

##### targetId

`string`

#### Returns

`Promise`\<[`VocabularyEntry`](#vocabularyentry) \| [`MergeRefusal`](#mergerefusal) \| `null`\>

***

### moveTopic()

> **moveTopic**(`db`, `userId`, `id`, `parent`): `Promise`\<[`TopicEntry`](#topicentry) \| [`MoveRefusal`](#moverefusal)\>

Moves one of the user's topics, with every topic beneath it, under another
of their topics, or to the top level for null. Refused when either is not
the user's, when the parent is the topic or beneath it, and when anything
would end up below the third level. Under the parent it already has,
nothing changes. Otherwise every link beneath the topic is marked changed,
and the former parent and its parent are deleted when left empty.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

##### parent

`string` \| `null`

#### Returns

`Promise`\<[`TopicEntry`](#topicentry) \| [`MoveRefusal`](#moverefusal)\>

***

### parseName()

> **parseName**(`kind`, `value`): `string` \| `null`

A new name as it is stored, or null when it is not acceptable: a tag name
lower-cased, 1 to 50 characters of letters and digits in hyphen-joined
words; a topic name trimmed, its spaces collapsed, 1 to 100 characters
without `>`.

#### Parameters

##### kind

[`VocabularyKind`](#vocabularykind)

##### value

`unknown`

#### Returns

`string` \| `null`

***

### renameEntry()

> **renameEntry**(`db`, `userId`, `kind`, `id`, `name`): `Promise`\<[`VocabularyEntry`](#vocabularyentry) \| `"taken"` \| `null`\>

Renames one of the user's topics or tags, keeping the old name as an alias
of it; a name that is now current is no longer an alias. 'taken' when
another topic (or tag) has the name; null when the user has no such item.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### kind

[`VocabularyKind`](#vocabularykind)

##### id

`string`

##### name

`string`

#### Returns

`Promise`\<[`VocabularyEntry`](#vocabularyentry) \| `"taken"` \| `null`\>
