# web/components/LinkCard

## Interfaces

### CardActions

What a card's actions do; the stream page supplies them.

#### Properties

##### onArchive?

> `optional` **onArchive?**: (`link`) => `void`

Archive the link by hand.

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

##### onDelete

> **onDelete**: (`link`) => `void`

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

##### onDragStart?

> `optional` **onDragStart?**: (`link`) => `void`

A pinned card is being dragged.

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

##### onDropOn?

> `optional` **onDropOn?**: (`link`) => `void`

A dragged card was dropped on this pinned card.

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

##### onPin

> **onPin**: (`link`) => `void`

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

##### onRefreshing?

> `optional` **onRefreshing?**: (`link`) => `void`

A refresh of the card's link was accepted.

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

##### onRemoveFromWorkspace?

> `optional` **onRemoveFromWorkspace?**: (`link`) => `void`

On a workspace's page: take the link out of the workspace.

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

##### onUnpin

> **onUnpin**: (`link`) => `void`

###### Parameters

###### link

[`Link`](../api.md#link)

###### Returns

`void`

## Functions

### LinkCard()

> **LinkCard**(`__namedParameters`): `Element`

One link in the stream, as a row of a list: title and actions, then host,
dates and state, the summary, and the labels.

#### Parameters

##### \_\_namedParameters

###### actions

[`CardActions`](#cardactions)

###### link

[`Link`](../api.md#link)

#### Returns

`Element`

***

### RefreshButton()

> **RefreshButton**(`__namedParameters`): `Element`

Refresh: asks the API to fetch the link again and shows that it is
refreshing, or why it was refused. `onRefreshing` hears of an accepted refresh.

#### Parameters

##### \_\_namedParameters

###### link

[`Link`](../api.md#link)

###### onRefreshing?

(`link`) => `void`

#### Returns

`Element`

***

### WorkspaceChips()

> **WorkspaceChips**(`__namedParameters`): `Element` \| `null`

The workspaces a link is in, each a chip linking to the workspace's page.

#### Parameters

##### \_\_namedParameters

###### workspaces

`object`[]

#### Returns

`Element` \| `null`
