# worker/api/openapi

## Interfaces

### Operation

One documented operation.

#### Properties

##### body?

> `optional` **body?**: `ZodType`\<`unknown`, `unknown`, `$ZodTypeInternals`\<`unknown`, `unknown`\>\>

##### bodyOptional?

> `optional` **bodyOptional?**: `boolean`

Whether the body may be left out.

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

##### upload?

> `optional` **upload?**: `Record`\<`string`, `object`\>

A body that is not JSON: its media types, each with its JSON Schema.

***

### ResponseSpec

One documented response of an operation.

#### Properties

##### description

> **description**: `string`

##### headers?

> `optional` **headers?**: `Record`\<`string`, \{ `description`: `string`; `schema`: \{ `type`: `string`; \}; \}\>

##### mediaType?

> `optional` **mediaType?**: `string`

The media type of a body that is not JSON, such as text/html.

##### schema?

> `optional` **schema?**: `ZodType`\<`unknown`, `unknown`, `$ZodTypeInternals`\<`unknown`, `unknown`\>\>

The body's schema; absent for a response without a JSON body.

## Variables

### ErrorBody

> `const` **ErrorBody**: `ZodObject`\<\{ `error`: `ZodString`; `field`: `ZodOptional`\<`ZodNullable`\<`ZodString`\>\>; `message`: `ZodOptional`\<`ZodString`\>; \}, `$loose`\>

The body of every error answer.

***

### HybridResults

> `const` **HybridResults**: `ZodObject`\<\{ `items`: `ZodArray`\<`ZodObject`\<\{ `link`: `ZodObject`\<\{ `added_at`: `ZodString`; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNumber`; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>; `match`: `ZodOptional`\<`ZodEnum`\<\{ `both`: `"both"`; `keyword`: `"keyword"`; `meaning`: `"meaning"`; \}\>\>; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; `meaning`: `ZodEnum`\<\{ `unavailable`: `"unavailable"`; `used`: `"used"`; \}\>; `next_cursor`: `ZodNullable`\<`ZodString`\>; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; \}, `$strict`\>

The answer of a search with mode=hybrid: SearchResults, each item saying how it matched, and whether meaning was added.

***

### Link

> `const` **Link**: `ZodObject`\<\{ `added_at`: `ZodString`; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNumber`; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>

A link in the user's library.

***

### LinkWithNote

> `const` **LinkWithNote**: `ZodObject`\<\{ `added_at`: `ZodString`; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNumber`; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>

A link read on its own, with its whole note.

***

### Me

> `const` **Me**: `ZodObject`\<\{ `email`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>

The current user.

***

### operations

> `const` **operations**: [`Operation`](#operation)[]

Every documented operation. Routes add theirs as they are implemented.

***

### PassageResults

> `const` **PassageResults**: `ZodObject`\<\{ `items`: `ZodArray`\<`ZodObject`\<\{ `link_id`: `ZodString`; `passage`: `ZodString`; `score`: `ZodNumber`; `title`: `ZodString`; `url`: `ZodString`; \}, `$strict`\>\>; `meaning`: `ZodLiteral`\<`"used"`\>; \}, `$strict`\>

The answer of a request for passages.

***

### SearchResults

> `const` **SearchResults**: `ZodObject`\<\{ `items`: `ZodArray`\<`ZodObject`\<\{ `link`: `ZodObject`\<\{ `added_at`: `ZodString`; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNumber`; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; `next_cursor`: `ZodNullable`\<`ZodString`\>; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; \}, `$strict`\>

The answer of a search.

***

### Token

> `const` **Token**: `ZodObject`\<\{ `created_at`: `ZodString`; `id`: `ZodString`; `last_used_at`: `ZodNullable`\<`ZodString`\>; `name`: `ZodString`; \}, `$strict`\>

A personal access token, as listed.

***

### Workspace

> `const` **Workspace**: `ZodObject`\<\{ `created_at`: `ZodString`; `description`: `ZodString`; `id`: `ZodString`; `link_count`: `ZodNumber`; `name`: `ZodString`; `note`: `ZodString`; \}, `$strict`\>

A workspace on its own, with its note.

***

### WorkspaceSummary

> `const` **WorkspaceSummary**: `ZodObject`\<\{ `created_at`: `ZodString`; `description`: `ZodString`; `id`: `ZodString`; `link_count`: `ZodNumber`; `name`: `ZodString`; \}, `$strict`\>

A workspace in a list.

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
