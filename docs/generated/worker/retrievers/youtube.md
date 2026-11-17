# worker/retrievers/youtube

## Interfaces

### YouTubeClaim

A video, by its id.

#### Properties

##### id

> **id**: `string`

## Variables

### youtube

> `const` **youtube**: [`Retriever`](retriever.md#retriever)\<[`YouTubeClaim`](#youtubeclaim)\>

## Functions

### claimYouTube()

> **claimYouTube**(`url`): [`YouTubeClaim`](#youtubeclaim) \| `null`

The video an address names, whatever form it takes; null for any other address.

#### Parameters

##### url

`URL`

#### Returns

[`YouTubeClaim`](#youtubeclaim) \| `null`
