# worker/enrich/edits

## Interfaces

### Edit

A valid edit: the given fields, normalised.

#### Properties

##### summary?

> `optional` **summary?**: `string`

##### tags?

> `optional` **tags?**: `string`[]

##### title?

> `optional` **title?**: `string`

##### topic?

> `optional` **topic?**: `string`

***

### EditError

Why an edit was refused: its error code, field and message.

#### Properties

##### error

> **error**: `string`

##### field

> **field**: `"title"` \| `"summary"` \| `"tags"` \| `"topic"`

##### message

> **message**: `string`

## Type Aliases

### EditableField

> **EditableField** = *typeof* [`EDITABLE`](#editable)\[`number`\]

## Variables

### EDITABLE

> `const` **EDITABLE**: readonly \[`"title"`, `"summary"`, `"tags"`, `"topic"`\]

The fields the owner can edit, in the order edited_fields records them.

***

### SUMMARY\_MAX

> `const` **SUMMARY\_MAX**: `2000` = `2_000`

***

### TAGS\_MAX

> `const` **TAGS\_MAX**: `20` = `20`

***

### TITLE\_MAX

> `const` **TITLE\_MAX**: `500` = `500`

***

### TOPIC\_MAX

> `const` **TOPIC\_MAX**: `100` = `100`

## Functions

### applyEdit()

> **applyEdit**(`db`, `userId`, `id`, `edit`): `Promise`\<[`LinkRow`](../links/store.md#linkrow) \| `null`\>

Applies a valid edit to one of the user's links: the given fields are
stored, tag and topic names resolved against the user's vocabulary, and
each given field is recorded as edited for good. Null when there is no such link.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

##### edit

[`Edit`](#edit)

#### Returns

`Promise`\<[`LinkRow`](../links/store.md#linkrow) \| `null`\>

***

### parseEdit()

> **parseEdit**(`body`): [`Edit`](#edit) \| [`EditError`](#editerror)

Validates every given field of an edit, refusing the whole edit on the first
invalid one: a title of 1 to 500 characters, a summary of at most 2,000, at
most 20 tags each non-empty once normalised, a topic of 1 to 100 characters.

#### Parameters

##### body

`Record`\<`string`, `unknown`\>

#### Returns

[`Edit`](#edit) \| [`EditError`](#editerror)
