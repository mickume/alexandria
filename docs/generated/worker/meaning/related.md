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

### relatedRoutes

> `const` **relatedRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

GET /api/v1/links/{id}/related.

## Functions

### findRelated()

> **findRelated**(`env`, `userId`, `linkId`): `Promise`\<[`RelatedLink`](#relatedlink)[]\>

The user's links nearest in meaning to the link, best first: at most
RELATED_LINKS, each scoring at least the similarity threshold, expired
links left out. The link is matched by its first passage, which holds its
title, summary, topic, tags and note; a link not yet indexed has none, and
no related links. Throws MeaningUnavailable.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkId

`string`

#### Returns

`Promise`\<[`RelatedLink`](#relatedlink)[]\>
