# worker/search/vocabulary

## Interfaces

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

A topic or tag as listed.

#### Properties

##### count

> **count**: `number`

##### id

> **id**: `string`

##### name

> **name**: `string`

##### newest\_added\_at

> **newest\_added\_at**: `string`

## Type Aliases

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

> **carrierIds**(`db`, `userId`, `kind`, `id`): `Promise`\<`string`[]\>

The ids of the user's links carrying one of their topics or tags.

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
newest first, the id breaking ties.

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

> **mergeEntry**(`db`, `userId`, `kind`, `sourceId`, `targetId`): `Promise`\<[`VocabularyEntry`](#vocabularyentry) \| `null`\>

Merges one of the user's topics or tags into another in one batch: every
link of the source gets the target (a link never carries a tag twice),
the source's name and aliases become aliases of the target, and the source
is deleted. Null when either is not the user's.

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

`Promise`\<[`VocabularyEntry`](#vocabularyentry) \| `null`\>

***

### parseName()

> **parseName**(`kind`, `value`): `string` \| `null`

A new name as it is stored, or null when it is not acceptable: a tag name
lower-cased, 1 to 50 characters of letters and digits in hyphen-joined
words; a topic name trimmed, its spaces collapsed, 1 to 100 characters.

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
