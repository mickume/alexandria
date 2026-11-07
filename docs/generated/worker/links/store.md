# worker/links/store

## Interfaces

### LinkRow

A link as stored.

#### Properties

##### added\_at

> **added\_at**: `string`

##### content\_kind

> **content\_kind**: `string` \| `null`

##### description

> **description**: `string` \| `null`

##### favicon\_url

> **favicon\_url**: `string` \| `null`

##### fetch\_attempts

> **fetch\_attempts**: `number`

##### fetched\_at

> **fetched\_at**: `string` \| `null`

##### final\_url

> **final\_url**: `string` \| `null`

##### has\_snapshot

> **has\_snapshot**: `number`

##### host

> **host**: `string`

##### http\_status

> **http\_status**: `number` \| `null`

##### id

> **id**: `string`

##### language

> **language**: `string` \| `null`

##### last\_used\_at

> **last\_used\_at**: `string`

##### notes

> **notes**: `string`

A JSON array of notes.

##### original\_url

> **original\_url**: `string`

##### pin\_position

> **pin\_position**: `number` \| `null`

##### reader\_empty

> **reader\_empty**: `number`

##### refresh\_requested\_at

> **refresh\_requested\_at**: `string` \| `null`

##### state

> **state**: `string`

##### state\_reason

> **state\_reason**: `string` \| `null`

##### title

> **title**: `string`

##### updated\_at

> **updated\_at**: `string`

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

##### content\_kind

> **content\_kind**: `string` \| `null`

What the fetched resource is: 'html', 'pdf' or 'other'; null before the first fetch.

##### description

> **description**: `string` \| `null`

##### favicon\_url

> **favicon\_url**: `string` \| `null`

##### fetched\_at

> **fetched\_at**: `string` \| `null`

##### final\_url

> **final\_url**: `string` \| `null`

The URL of the last response of the latest successful fetch.

##### has\_snapshot

> **has\_snapshot**: `boolean`

Whether a snapshot is stored, so that Read and Snapshot can be offered.

##### host

> **host**: `string`

##### http\_status

> **http\_status**: `number` \| `null`

##### id

> **id**: `string`

##### language

> **language**: `string` \| `null`

##### last\_used\_at

> **last\_used\_at**: `string`

##### notes

> **notes**: `string`[]

Short notes such as "truncated" or "not a web page (image/png)".

##### original\_url

> **original\_url**: `string`

##### pin\_position

> **pin\_position**: `number` \| `null`

##### pinned

> **pinned**: `boolean`

##### state

> **state**: `string`

##### state\_reason

> **state\_reason**: `string` \| `null`

Why the link is in its state, such as "HTTP 503" for a pending or unreachable link.

##### title

> **title**: `string`

##### updated\_at

> **updated\_at**: `string`

When the link last changed in any way.

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

***

### PinOutcome

> **PinOutcome** = \{ `link`: [`LinkView`](#linkview); `status`: `"pinned"`; \} \| \{ `status`: `"not_found"`; \} \| \{ `status`: `"pin_limit"`; \}

What pinning a link did.

## Variables

### LIBRARY\_LIMIT

> `const` **LIBRARY\_LIMIT**: `20000` = `20_000`

The most links one library holds, in any state.

***

### PIN\_LIMIT

> `const` **PIN\_LIMIT**: `30` = `30`

The most links one user may pin.

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

### deleteLink()

> **deleteLink**(`db`, `userId`, `id`): `Promise`\<`boolean`\>

Deletes one of the user's links, its use and fetch events and its text at once and for good,
closing the gap in the pinned section if it was pinned. Returns false when
the user has no such link.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

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

### parseNotes()

> **parseNotes**(`notes`): `string`[]

A link's notes, parsed from their stored JSON.

#### Parameters

##### notes

`string` \| `null` \| `undefined`

#### Returns

`string`[]

***

### pinLink()

> **pinLink**(`db`, `userId`, `id`, `position?`): `Promise`\<[`PinOutcome`](#pinoutcome)\>

Pins one of the user's links at `position` (1-based; past the end means the
end), or at the end of the pinned section when no position is given, keeping
the other pinned links in order. A link already pinned and given no position
stays where it is. The positions stay 1..n in one transaction; a new pin
past PIN_LIMIT changes nothing.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

##### position?

`number`

#### Returns

`Promise`\<[`PinOutcome`](#pinoutcome)\>

***

### toView()

> **toView**(`row`): [`LinkView`](#linkview)

The API's view of a stored link.

#### Parameters

##### row

[`LinkRow`](#linkrow)

#### Returns

[`LinkView`](#linkview)

***

### unpinLink()

> **unpinLink**(`db`, `userId`, `id`): `Promise`\<[`LinkView`](#linkview) \| `null`\>

Unpins one of the user's links, closing the gap in the pinned section. Null when there is no such link.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`Promise`\<[`LinkView`](#linkview) \| `null`\>
