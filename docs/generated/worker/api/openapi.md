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

> `const` **HybridResults**: `ZodObject`\<\{ `items`: `ZodArray`\<`ZodObject`\<\{ `link`: `ZodObject`\<\{ `added_at`: `ZodString`; `archived_at`: `ZodNullable`\<`ZodString`\>; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNullable`\<`ZodNumber`\>; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `topic_path`: `ZodArray`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>; `match`: `ZodOptional`\<`ZodEnum`\<\{ `both`: `"both"`; `keyword`: `"keyword"`; `meaning`: `"meaning"`; \}\>\>; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; `meaning`: `ZodEnum`\<\{ `unavailable`: `"unavailable"`; `used`: `"used"`; \}\>; `next_cursor`: `ZodNullable`\<`ZodString`\>; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; \}, `$strict`\>

The answer of a search with mode=hybrid: SearchResults, each item saying how it matched, and whether meaning was added.

***

### Link

> `const` **Link**: `ZodObject`\<\{ `added_at`: `ZodString`; `archived_at`: `ZodNullable`\<`ZodString`\>; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNullable`\<`ZodNumber`\>; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `topic_path`: `ZodArray`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>

A link in the user's library.

***

### LinkWithNote

> `const` **LinkWithNote**: `ZodObject`\<\{ `added_at`: `ZodString`; `archived_at`: `ZodNullable`\<`ZodString`\>; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNullable`\<`ZodNumber`\>; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `topic_path`: `ZodArray`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>

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

> `const` **SearchResults**: `ZodObject`\<\{ `items`: `ZodArray`\<`ZodObject`\<\{ `link`: `ZodObject`\<\{ `added_at`: `ZodString`; `archived_at`: `ZodNullable`\<`ZodString`\>; `content_kind`: `ZodNullable`\<`ZodEnum`\<\{ `html`: `"html"`; `other`: `"other"`; `pdf`: `"pdf"`; \}\>\>; `dead_since`: `ZodNullable`\<`ZodString`\>; `decay_note`: `ZodString`; `description`: `ZodNullable`\<`ZodString`\>; `edited_fields`: `ZodArray`\<`ZodString`\>; `enrichment_reason`: `ZodNullable`\<`ZodString`\>; `enrichment_status`: `ZodNullable`\<`ZodEnum`\<\{ `enriched`: `"enriched"`; `failed`: `"failed"`; `no_key`: `"no_key"`; `queued`: `"queued"`; `skipped`: `"skipped"`; `waiting_for_key`: `"waiting_for_key"`; \}\>\>; `expired_at`: `ZodNullable`\<`ZodString`\>; `favicon_url`: `ZodNullable`\<`ZodString`\>; `fetched_at`: `ZodNullable`\<`ZodString`\>; `final_url`: `ZodNullable`\<`ZodString`\>; `has_snapshot`: `ZodBoolean`; `host`: `ZodString`; `http_status`: `ZodNullable`\<`ZodNumber`\>; `id`: `ZodString`; `language`: `ZodNullable`\<`ZodString`\>; `last_check_result`: `ZodNullable`\<`ZodString`\>; `last_checked_at`: `ZodNullable`\<`ZodString`\>; `last_used_at`: `ZodString`; `note_preview`: `ZodNullable`\<`ZodString`\>; `notes`: `ZodArray`\<`ZodString`\>; `original_url`: `ZodString`; `pin_position`: `ZodNullable`\<`ZodNumber`\>; `pinned`: `ZodBoolean`; `points`: `ZodNullable`\<`ZodNumber`\>; `removal_at`: `ZodNullable`\<`ZodString`\>; `state`: `ZodString`; `state_reason`: `ZodNullable`\<`ZodString`\>; `summary`: `ZodNullable`\<`ZodString`\>; `tags`: `ZodArray`\<`ZodString`\>; `title`: `ZodString`; `topic`: `ZodNullable`\<`ZodString`\>; `topic_path`: `ZodArray`\<`ZodString`\>; `updated_at`: `ZodString`; `url`: `ZodString`; `use_count`: `ZodNumber`; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; `next_cursor`: `ZodNullable`\<`ZodString`\>; `workspaces`: `ZodArray`\<`ZodObject`\<\{ `id`: `ZodString`; `name`: `ZodString`; `snippet`: `ZodArray`\<`ZodObject`\<\{ `match`: `ZodBoolean`; `text`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>\>; \}, `$strict`\>

The answer of a search.

***

### Stats

> `const` **Stats**: `ZodObject`\<\{ `activity`: `ZodObject`\<\{ `added_last_30_days`: `ZodNumber`; `added_last_7_days`: `ZodNumber`; `added_per_day`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `day`: `ZodString`; \}, `$strict`\>\>; `fetches`: `ZodObject`\<\{ `failed`: `ZodNumber`; `failed_by_reason`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `reason`: `ZodString`; \}, `$strict`\>\>; `ok`: `ZodNumber`; \}, `$strict`\>; `imports`: `ZodArray`\<`ZodObject`\<\{ `added`: `ZodNumber`; `created_at`: `ZodString`; `duplicates`: `ZodNumber`; `id`: `ZodString`; `invalid`: `ZodNumber`; `not_imported`: `ZodNumber`; `url_lines`: `ZodNumber`; \}, `$strict`\>\>; `most_used`: `ZodArray`\<`ZodObject`\<\{ `host`: `ZodString`; `id`: `ZodString`; `title`: `ZodString`; `uses`: `ZodNumber`; \}, `$strict`\>\>; `never_used`: `ZodNumber`; `uses_per_day`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `day`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>; `backlog`: `ZodObject`\<\{ `enrichment_queued`: `ZodNumber`; `fetch_pending`: `ZodNumber`; `fetch_retrying`: `ZodNumber`; `imports`: `ZodArray`\<`ZodObject`\<\{ `added`: `ZodNumber`; `created_at`: `ZodString`; `done`: `ZodNumber`; `id`: `ZodString`; `in_progress`: `ZodNumber`; `waiting`: `ZodNumber`; \}, `$strict`\>\>; `index_stale`: `ZodNumber`; `liveness_due`: `ZodNumber`; `throttle_clear_at`: `ZodNullable`\<`ZodString`\>; `vector_deletions`: `ZodNumber`; \}, `$strict`\>; `content`: `ZodObject`\<\{ `by_kind`: `ZodObject`\<\{ `html`: `ZodNumber`; `other`: `ZodNumber`; `pdf`: `ZodNumber`; `unfetched`: `ZodNumber`; \}, `$strict`\>; `reader_empty`: `ZodNumber`; `with_snapshot`: `ZodNumber`; \}, `$strict`\>; `expiry`: `ZodObject`\<\{ `awaiting_removal`: `ZodObject`\<\{ `total`: `ZodNumber`; `within_30_days`: `ZodNumber`; `within_7_days`: `ZodNumber`; \}, `$strict`\>; `expiring`: `ZodObject`\<\{ `today`: `ZodNumber`; `within_30_days`: `ZodNumber`; `within_7_days`: `ZodNumber`; \}, `$strict`\>; `points_histogram`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `range`: `ZodString`; \}, `$strict`\>\>; `protected_at_risk`: `ZodNumber`; `settings`: `ZodObject`\<\{ `remove_days`: `ZodNumber`; `start_points`: `ZodNumber`; \}, `$strict`\>; \}, `$strict`\>; `health`: `ZodObject`\<\{ `ai_key`: `ZodEnum`\<\{ `none`: `"none"`; `rejected`: `"rejected"`; `verified`: `"verified"`; \}\>; `dead`: `ZodObject`\<\{ `count`: `ZodNumber`; `dead_over_30_days`: `ZodNumber`; \}, `$strict`\>; `enrichment`: `ZodObject`\<\{ `enriched`: `ZodNumber`; `failed`: `ZodNumber`; `failed_by_reason`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `reason`: `ZodString`; \}, `$strict`\>\>; `no_key`: `ZodNumber`; `none`: `ZodNumber`; `queued`: `ZodNumber`; `skipped`: `ZodNumber`; `waiting_for_key`: `ZodNumber`; \}, `$strict`\>; `unreachable`: `ZodObject`\<\{ `by_reason`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `reason`: `ZodString`; \}, `$strict`\>\>; `count`: `ZodNumber`; \}, `$strict`\>; \}, `$strict`\>; `hosts`: `ZodObject`\<\{ `distinct`: `ZodNumber`; `top`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `host`: `ZodString`; \}, `$strict`\>\>; \}, `$strict`\>; `library`: `ZodObject`\<\{ `by_state`: `ZodObject`\<\{ `active`: `ZodNumber`; `archived`: `ZodNumber`; `expired`: `ZodNumber`; `pending`: `ZodNumber`; `unreachable`: `ZodNumber`; \}, `$strict`\>; `in_workspace`: `ZodNumber`; `limit`: `ZodNumber`; `pinned`: `ZodNumber`; `total`: `ZodNumber`; \}, `$strict`\>; `tags`: `ZodObject`\<\{ `links_without_tags`: `ZodNumber`; `top`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; `total`: `ZodNumber`; `used_once`: `ZodNumber`; \}, `$strict`\>; `topics`: `ZodObject`\<\{ `by_level`: `ZodObject`\<\{ `1`: `ZodNumber`; `2`: `ZodNumber`; `3`: `ZodNumber`; \}, `$strict`\>; `largest`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `id`: `ZodString`; `name`: `ZodString`; `path`: `ZodArray`\<`ZodString`\>; \}, `$strict`\>\>; `links_without_topic`: `ZodNumber`; `total`: `ZodNumber`; \}, `$strict`\>; `workspaces`: `ZodObject`\<\{ `largest`: `ZodArray`\<`ZodObject`\<\{ `count`: `ZodNumber`; `id`: `ZodString`; `name`: `ZodString`; \}, `$strict`\>\>; `total`: `ZodNumber`; \}, `$strict`\>; \}, `$strict`\>

The owner's library statistics, computed at the time of the request.

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
