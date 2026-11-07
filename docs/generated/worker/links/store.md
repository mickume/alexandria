# worker/links/store

## Interfaces

### LinkRow

A link as stored.

#### Properties

##### added\_at

> **added\_at**: `string`

##### host

> **host**: `string`

##### id

> **id**: `string`

##### last\_used\_at

> **last\_used\_at**: `string`

##### original\_url

> **original\_url**: `string`

##### pin\_position

> **pin\_position**: `number` \| `null`

##### state

> **state**: `string`

##### title

> **title**: `string`

##### url

> **url**: `string`

##### use\_count

> **use\_count**: `number`

##### user\_id

> **user\_id**: `string`

***

### LinkView

A link as the API shows it.

#### Properties

##### added\_at

> **added\_at**: `string`

##### host

> **host**: `string`

##### id

> **id**: `string`

##### last\_used\_at

> **last\_used\_at**: `string`

##### original\_url

> **original\_url**: `string`

##### pin\_position

> **pin\_position**: `number` \| `null`

##### pinned

> **pinned**: `boolean`

##### state

> **state**: `string`

##### title

> **title**: `string`

##### url

> **url**: `string`

##### use\_count

> **use\_count**: `number`

***

### NewLink

One URL to add: its normalised form and the input it came from.

#### Properties

##### original

> **original**: `string`

##### url

> **url**: `string`

## Type Aliases

### AddOutcome

> **AddOutcome** = \{ `link`: [`LinkView`](#linkview); `status`: `"added"`; \} \| \{ `link`: [`LinkView`](#linkview); `status`: `"boosted"`; \} \| \{ `status`: `"library_full"`; \}

What adding one URL did.

## Variables

### LIBRARY\_LIMIT

> `const` **LIBRARY\_LIMIT**: `20000` = `20_000`

The most links one library holds, in any state.

## Functions

### addLink()

> **addLink**(`db`, `userId`, `link`): `Promise`\<[`AddOutcome`](#addoutcome)\>

Adds one link, or boosts the user's existing link for the same normalised URL.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### link

[`NewLink`](#newlink)

#### Returns

`Promise`\<[`AddOutcome`](#addoutcome)\>

***

### addLinks()

> **addLinks**(`db`, `userId`, `links`): `Promise`\<[`AddOutcome`](#addoutcome)[]\>

Adds or boosts several links in one transaction. The first link gets the
current time as its last use and each later one a millisecond less, so that
the first of the batch ends highest in the stream.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### links

[`NewLink`](#newlink)[]

#### Returns

`Promise`\<[`AddOutcome`](#addoutcome)[]\>

***

### getLink()

> **getLink**(`db`, `userId`, `id`): `Promise`\<[`LinkRow`](#linkrow) \| `null`\>

One of the user's links, or null when the user has no link with this id.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`Promise`\<[`LinkRow`](#linkrow) \| `null`\>

***

### toView()

> **toView**(`row`): [`LinkView`](#linkview)

The API's view of a stored link.

#### Parameters

##### row

[`LinkRow`](#linkrow)

#### Returns

[`LinkView`](#linkview)
