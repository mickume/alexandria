# worker/links/store

## Interfaces

### LinkRow

A link as stored.

#### Properties

##### added\_at

> **added\_at**: `string`

##### archived\_at

> **archived\_at**: `string` \| `null`

##### check\_enqueued\_at

> **check\_enqueued\_at**: `string` \| `null`

##### content\_kind

> **content\_kind**: `string` \| `null`

##### dead\_since

> **dead\_since**: `string` \| `null`

##### description

> **description**: `string` \| `null`

##### edited\_fields

> **edited\_fields**: `string`

A JSON array of the fields the owner has set by hand.

##### enriched\_at

> **enriched\_at**: `string` \| `null`

##### enrichment\_reason

> **enrichment\_reason**: `string` \| `null`

##### enrichment\_status

> **enrichment\_status**: `string` \| `null`

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

##### last\_check\_result

> **last\_check\_result**: `string` \| `null`

##### last\_checked\_at

> **last\_checked\_at**: `string` \| `null`

##### last\_manual\_check\_at

> **last\_manual\_check\_at**: `string` \| `null`

##### last\_used\_at

> **last\_used\_at**: `string`

##### liveness\_failures

> **liveness\_failures**: `number`

##### note

> **note**: `string`

The owner's Markdown note.

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

##### summary

> **summary**: `string` \| `null`

##### tags\_json?

> `optional` **tags\_json?**: `string`

A JSON array of the tag names in order, when read through link_views.

##### title

> **title**: `string`

##### topic?

> `optional` **topic?**: `string` \| `null`

The topic's name, when read through link_views.

##### topic\_id

> **topic\_id**: `string` \| `null`

##### updated\_at

> **updated\_at**: `string`

##### url

> **url**: `string`

##### use\_count

> **use\_count**: `number`

##### use\_days?

> `optional` **use\_days?**: `number`

##### use\_events?

> `optional` **use\_events?**: `number`

Read through link_views: the stored uses, and the UTC days they fall on.

##### user\_id

> **user\_id**: `string`

##### user\_remove\_days?

> `optional` **user\_remove\_days?**: `number`

Read through link_views: the link's user's removal threshold.

##### workspaces\_json?

> `optional` **workspaces\_json?**: `string`

A JSON array of {id, name} of the link's workspaces, when read through link_views.

***

### LinkView

A link as the API shows it.

#### Properties

##### added\_at

> **added\_at**: `string`

##### archived\_at

> **archived\_at**: `string` \| `null`

##### content\_kind

> **content\_kind**: `string` \| `null`

What the fetched resource is: 'html', 'pdf' or 'other'; null before the first fetch.

##### dead\_since

> **dead\_since**: `string` \| `null`

##### decay\_note

> **decay\_note**: `string`

One sentence: the link's decay state and why.

##### description

> **description**: `string` \| `null`

##### edited\_fields

> **edited\_fields**: `string`[]

The fields the owner has set by hand, which automatic work never overwrites.

##### enrichment\_reason

> **enrichment\_reason**: `string` \| `null`

##### enrichment\_status

> **enrichment\_status**: `string` \| `null`

no_key, queued, enriched, failed, skipped or waiting_for_key; null before the first fetch.

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

##### last\_check\_result

> **last\_check\_result**: `string` \| `null`

##### last\_checked\_at

> **last\_checked\_at**: `string` \| `null`

##### last\_used\_at

> **last\_used\_at**: `string`

##### note?

> `optional` **note?**: `string`

The whole note: only on the link read on its own.

##### note\_preview

> **note\_preview**: `string` \| `null`

The note's first line as plain text, or null without a note.

##### notes

> **notes**: `string`[]

Short notes such as "truncated" or "not a web page (image/png)".

##### original\_url

> **original\_url**: `string`

##### pin\_position

> **pin\_position**: `number` \| `null`

##### pinned

> **pinned**: `boolean`

##### removal\_at

> **removal\_at**: `string` \| `null`

When an archived link will be removed.

##### state

> **state**: `string`

##### state\_reason

> **state\_reason**: `string` \| `null`

Why the link is in its state, such as "HTTP 503" for a pending or unreachable link.

##### sticky

> **sticky**: `boolean`

At least 5 uses on at least 5 UTC days: never dormant or archived by decay.

##### summary

> **summary**: `string` \| `null`

##### tags

> **tags**: `string`[]

##### title

> **title**: `string`

##### topic

> **topic**: `string` \| `null`

##### updated\_at

> **updated\_at**: `string`

When the link last changed in any way.

##### url

> **url**: `string`

##### use\_count

> **use\_count**: `number`

##### workspaces

> **workspaces**: `object`[]

The workspaces the link is in, by name.

###### id

> **id**: `string`

###### name

> **name**: `string`

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

### parseStrings()

> **parseStrings**(`notes`): `string`[]

A stored JSON array of strings (notes, tags, edited fields), parsed; [] for anything else.

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

### setLinkNote()

> **setLinkNote**(`db`, `userId`, `id`, `note`): `Promise`\<`void`\>

Stores the owner's note on one of their links, as given; '' clears it.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

##### note

`string`

#### Returns

`Promise`\<`void`\>

***

### toFullView()

> **toFullView**(`row`): [`LinkView`](#linkview)

The API's view of a stored link, with its whole note when read on its own.

#### Parameters

##### row

[`LinkRow`](#linkrow)

#### Returns

[`LinkView`](#linkview)

***

### toView()

> **toView**(`row`): [`LinkView`](#linkview)

The API's view of a stored link, as lists show it: with a note preview, not the note.

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

***

### unpinStatements()

> **unpinStatements**(`db`, `userId`, `id`): `D1PreparedStatement`[]

Statements that take a pinned link out of the pinned section and close the gap it leaves.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`D1PreparedStatement`[]
