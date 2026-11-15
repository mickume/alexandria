# worker/fetcher/images

## Interfaces

### ImageTarget

Where a snapshot's images go and how the article refers to them.

#### Properties

##### addressPrefix

> **addressPrefix**: `string`

The address prefix the article's images are served under, ending in '/'.

##### folder

> **folder**: `string`

The R2 key prefix of the snapshot's folder, ending in '/'.

##### snapshotId

> **snapshotId**: `string`

The snapshot's id, which starts every image name.

***

### SavedImages

The article with its images stored: its HTML, the objects to write, and how many images were not saved.

#### Properties

##### html

> **html**: `string`

##### missing

> **missing**: `number`

##### objects

> **objects**: [`StoredObject`](#storedobject)[]

***

### StoredObject

An object a snapshot writes to SNAPSHOTS.

#### Properties

##### body

> **body**: `string` \| `Uint8Array`\<`ArrayBufferLike`\>

##### contentType

> **contentType**: `string`

##### key

> **key**: `string`

## Variables

### IMAGE\_LIMIT

> `const` **IMAGE\_LIMIT**: `number`

The largest image a snapshot stores.

***

### IMAGE\_TIMEOUT\_MS

> `const` **IMAGE\_TIMEOUT\_MS**: `15000` = `15_000`

How long one image's request may take, from sending it to the last byte of its body.

***

### IMAGES\_TOTAL\_LIMIT

> `const` **IMAGES\_TOTAL\_LIMIT**: `number`

The most bytes of images one snapshot stores in all.

***

### MAX\_IMAGE\_WIDTH

> `const` **MAX\_IMAGE\_WIDTH**: `2000` = `2000`

The widest srcset candidate a snapshot chooses, in pixels.

***

### MAX\_IMAGES

> `const` **MAX\_IMAGES**: `100` = `100`

The most images one snapshot stores.

***

### SRCSET\_SEPARATOR

> `const` **SRCSET\_SEPARATOR**: `RegExp`

Where a srcset separates its candidates: a comma followed by space, or one
right after a candidate's descriptor. A comma inside an address, as a data:
address has, is neither.

## Functions

### chooseImage()

> **chooseImage**(`src`, `srcset`): `string` \| `null`

The address a snapshot saves for an image: of its srcset (its <picture>
sources folded in), the largest candidate at most MAX_IMAGE_WIDTH wide;
without width descriptors, the highest density at most 2x; without either,
its src. When every width candidate is wider, the narrowest is taken.

#### Parameters

##### src

`string` \| `null`

##### srcset

`string` \| `null`

#### Returns

`string` \| `null`

***

### missingImagesNote()

> **missingImagesNote**(`missing`): `string`

The note on a snapshot some of whose images could not be saved.

#### Parameters

##### missing

`number`

#### Returns

`string`

***

### saveImages()

> **saveImages**(`env`, `html`, `target`): `Promise`\<[`SavedImages`](#savedimages)\>

Downloads the images of a sanitised article and stores them with the
snapshot, in the order they appear: each <img> gets the address of its
stored copy, and one that cannot be stored (a failed request, another
type, past a limit) becomes a placeholder. An image already inline (a
data: address) stays as it is. Nothing is written here: the objects are
returned for the caller to write.

#### Parameters

##### env

[`Env`](../env.md#env)

##### html

`string`

##### target

[`ImageTarget`](#imagetarget)

#### Returns

`Promise`\<[`SavedImages`](#savedimages)\>
