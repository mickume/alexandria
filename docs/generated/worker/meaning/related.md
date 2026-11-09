# worker/meaning/related

## Interfaces

### RelatedLink

A link near in meaning to another, with the similarity of its best passage.

#### Properties

##### id

> **id**: `string`

##### score

> **score**: `number`

## Variables

### RELATED\_LINKS

> `const` **RELATED\_LINKS**: `5` = `5`

The most related links returned.

***

### RELATED\_SIMILARITY\_THRESHOLD

> `const` **RELATED\_SIMILARITY\_THRESHOLD**: `0.65` = `0.65`

The similarity (cosine) a link's metadata must reach against the link's own
metadata for the link to count as related: stricter than the threshold of
search, because bge-m3 scores two unrelated texts of one language at up to
about 0.6. Provisional (ADR 06).

***

### relatedRoutes

> `const` **relatedRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

GET /api/v1/links/{id}/related.

## Functions

### findRelated()

> **findRelated**(`env`, `userId`, `linkId`): `Promise`\<[`RelatedLink`](#relatedlink)[]\>

The user's links nearest in meaning to the link, best first: at most
RELATED_LINKS, each scoring at least RELATED_SIMILARITY_THRESHOLD, expired
links left out. The link's first passage, which holds its title, summary,
topic, tags and note, is matched against the passages cut from the other
links' metadata only, never their reader text (ADR 06); a link not yet
indexed has no first passage, and no related links. Throws MeaningUnavailable.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkId

`string`

#### Returns

`Promise`\<[`RelatedLink`](#relatedlink)[]\>
