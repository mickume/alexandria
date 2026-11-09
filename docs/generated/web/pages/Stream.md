# web/pages/Stream

## Functions

### Stream()

> **Stream**(): `Element`

The stream: the home page. Pinned links first, then the rest by last use.

#### Returns

`Element`

***

### useUndoableDelete()

> **useUndoableDelete**(`items`, `setItems`): `object`

Deleting with a 10-second undo window: the card goes at once, the request
only when the window passes, at once with keepalive when the page is hidden
or left, and a failed delete puts the card back.

#### Parameters

##### items

[`Link`](../api.md#link-1)[]

##### setItems

`SetItems`

#### Returns

`object`

##### failure

> **failure**: `string` \| `null`

##### remove

> **remove**: (`link`) => `void`

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

##### undo

> **undo**: (`id`) => `void`

###### Parameters

###### id

`string`

###### Returns

`void`

##### undoable

> **undoable**: [`Link`](../api.md#link-1)[]
