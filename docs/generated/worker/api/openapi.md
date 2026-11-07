# worker/api/openapi

## Interfaces

### Operation

One documented operation.

#### Properties

##### body?

> `optional` **body?**: `ZodType`\<`unknown`, `unknown`, `$ZodTypeInternals`\<`unknown`, `unknown`\>\>

##### method

> **method**: `Method`

##### operationId

> **operationId**: `string`

##### path

> **path**: `string`

The path under /api/v1, as an OpenAPI template such as /links/{id}.

##### query?

> `optional` **query?**: `Record`\<`string`, \{ `description`: `string`; `schema`: `ZodType`; \}\>

##### responses

> **responses**: `Record`\<`number`, [`ResponseSpec`](#responsespec)\>

##### summary

> **summary**: `string`

***

### ResponseSpec

One documented response of an operation.

#### Properties

##### description

> **description**: `string`

##### headers?

> `optional` **headers?**: `Record`\<`string`, \{ `description`: `string`; `schema`: \{ `type`: `string`; \}; \}\>

##### schema?

> `optional` **schema?**: `ZodType`\<`unknown`, `unknown`, `$ZodTypeInternals`\<`unknown`, `unknown`\>\>

The body's schema; absent for a response without a body.

## Variables

### ErrorBody

> `const` **ErrorBody**: `ZodObject`\<\{ `error`: `ZodString`; `field`: `ZodOptional`\<`ZodNullable`\<`ZodString`\>\>; `message`: `ZodOptional`\<`ZodString`\>; \}, `$loose`\>

The body of every error answer.

***

### Link

> `const` **Link**: `ZodObject`\<\{ `added_at`: `ZodString`; `host`: `ZodString`; `id`: `ZodString`; `last_used_at`: `ZodString`; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `state`: `ZodString`; `title`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; \}, `$strict`\>

A link in the user's library.

***

### Me

> `const` **Me**: `ZodObject`\<\{ `email`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>

The current user.

***

### operations

> `const` **operations**: [`Operation`](#operation)[]

Every documented operation. Routes add theirs as they are implemented.

***

### Token

> `const` **Token**: `ZodObject`\<\{ `created_at`: `ZodString`; `id`: `ZodString`; `last_used_at`: `ZodNullable`\<`ZodString`\>; `name`: `ZodString`; \}, `$strict`\>

A personal access token, as listed.

## Functions

### findOperation()

> **findOperation**(`method`, `pathname`): [`Operation`](#operation) \| `undefined`

The operation a request to `pathname` (under /api/v1/) with `method` reaches, if documented.

#### Parameters

##### method

`string`

##### pathname

`string`

#### Returns

[`Operation`](#operation) \| `undefined`

***

### openApiDocument()

> **openApiDocument**(): `object`

The OpenAPI 3.1 document.

#### Returns

`object`

***

### responseMismatch()

> **responseMismatch**(`op`, `status`, `body`): `string` \| `null`

Why a response does not match the document, or null when it does: its status
must be declared for the operation and its body must match that status's schema.

#### Parameters

##### op

[`Operation`](#operation)

##### status

`number`

##### body

`unknown`

#### Returns

`string` \| `null`
