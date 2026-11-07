# worker/enrich/vocabulary

## Variables

### PROMPT\_TAGS

> `const` **PROMPT\_TAGS**: `300` = `300`

***

### PROMPT\_TOPICS

> `const` **PROMPT\_TOPICS**: `100` = `100`

How many of the user's topics and tags the provider is shown.

## Functions

### listVocabulary()

> **listVocabulary**(`db`, `userId`): `Promise`\<\{ `tags`: `string`[]; `topics`: `string`[]; \}\>

The user's most used topic and tag names, for the provider to reuse.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<\{ `tags`: `string`[]; `topics`: `string`[]; \}\>

***

### resolveTags()

> **resolveTags**(`db`, `userId`, `names`): `Promise`\<`string`[]\>

The ids of the user's tags named `names`, in order, created where there are none.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### names

`string`[]

#### Returns

`Promise`\<`string`[]\>

***

### resolveTopic()

> **resolveTopic**(`db`, `userId`, `name`): `Promise`\<`string`\>

The id of the user's topic named `name`, created when there is none.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### name

`string`

#### Returns

`Promise`\<`string`\>
