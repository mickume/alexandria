# worker/meaning/cut

## Interfaces

### LinkText

The text of a link that is indexed besides its reader text.

#### Properties

##### note

> **note**: `string`

##### summary

> **summary**: `string` \| `null`

##### tags

> **tags**: `string`[]

##### title

> **title**: `string`

##### topic

> **topic**: `string` \| `null`

## Variables

### PASSAGE\_MAX

> `const` **PASSAGE\_MAX**: `1500` = `1_500`

The longest passage, in characters.

***

### READER\_TEXT\_MAX

> `const` **READER\_TEXT\_MAX**: `50000` = `50_000`

How much of a link's reader text is cut into passages, in characters.

## Functions

### cutPassages()

> **cutPassages**(`link`, `readerText`): `string`[]

The passages of a link: first its title, summary, topic, tags and note, then
the first READER_TEXT_MAX characters of its reader text.

#### Parameters

##### link

[`LinkText`](#linktext)

##### readerText

`string` \| `null`

#### Returns

`string`[]

***

### cutText()

> **cutText**(`text`): `string`[]

Cuts `text` into passages of at most PASSAGE_MAX characters, none of them blank.

#### Parameters

##### text

`string`

#### Returns

`string`[]
