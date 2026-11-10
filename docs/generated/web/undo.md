# web/undo

## Functions

### UndoToasts()

> **UndoToasts**(`__namedParameters`): `Element`

The toasts of the deletes in their undo window, each with Undo, and of a failed delete.

#### Parameters

##### \_\_namedParameters

###### deletes

`Pick`\<`ReturnType`\<*typeof* [`useUndoableDelete`](#useundoabledelete)\>, `"undo"` \| `"undoable"` \| `"failure"`\>

#### Returns

`Element`

***

### useUndoableDelete()

> **useUndoableDelete**\<`T`\>(`items`, `setItems`): `object`

Deleting with a 10-second undo window: the card is hidden at once and the
request sent only when the window passes, at once with keepalive when the
page is hidden or left. The link stays in `items` until it is deleted, so
`shown`, the list to render, leaves it out however often `items` is loaded
again meanwhile; an undo or a failed delete shows it where it was.

#### Type Parameters

##### T

`T` *extends* [`Link`](api.md#link-1)

#### Parameters

##### items

`T`[]

##### setItems

`Dispatch`\<`SetStateAction`\<`T`[]\>\>

#### Returns

`object`

##### failure

> **failure**: `string` \| `null`

##### remove

> **remove**: (`link`) => `void`

###### Parameters

###### link

[`Link`](api.md#link-1)

###### Returns

`void`

##### shown

> **shown**: `T`[]

##### undo

> **undo**: (`id`) => `void`

###### Parameters

###### id

`string`

###### Returns

`void`

##### undoable

> **undoable**: [`Link`](api.md#link-1)[]
