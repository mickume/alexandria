# web/components/LinkCard

## Interfaces

### CardActions

What a card's actions do; the stream page supplies them.

#### Properties

##### onDelete

> **onDelete**: (`link`) => `void`

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

##### onDragStart?

> `optional` **onDragStart?**: (`link`) => `void`

A pinned card is being dragged.

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

##### onDropOn?

> `optional` **onDropOn?**: (`link`) => `void`

A dragged card was dropped on this pinned card.

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

##### onPin

> **onPin**: (`link`) => `void`

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

##### onRefreshing?

> `optional` **onRefreshing?**: (`link`) => `void`

A refresh of the card's link was accepted.

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

##### onRemoveFromWorkspace?

> `optional` **onRemoveFromWorkspace?**: (`link`) => `void`

On a workspace's page: take the link out of the workspace.

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

##### onUnpin

> **onUnpin**: (`link`) => `void`

###### Parameters

###### link

[`Link`](../api.md#link-1)

###### Returns

`void`

## Functions

### LinkCard()

> **LinkCard**(`__namedParameters`): `Element`

One link in the stream, as a row of a list: title and actions, then host,
dates and state, the summary, and the labels. A pinned card shows a pin
where the site's icon would be.

#### Parameters

##### \_\_namedParameters

###### actions

[`CardActions`](#cardactions)

###### link

[`Link`](../api.md#link-1)

#### Returns

`Element`

***

### RefreshButton()

> **RefreshButton**(`__namedParameters`): `Element`

Refresh: asks the API to fetch the link again and shows that it is
refreshing, or why it was refused. `onRefreshing` hears of an accepted refresh.

#### Parameters

##### \_\_namedParameters

###### className?

`string` = `'q-btn-link'`

The button's class: a link-like button unless an action list asks for its own.

###### icon?

`ReactNode`

An icon before the label.

###### link

[`Link`](../api.md#link-1)

###### onRefreshing?

(`link`) => `void`

#### Returns

`Element`

***

### SiteLink()

> **SiteLink**(`__namedParameters`): `Element`

A link to the site itself, through the open route so the visit counts as a use, in a new tab.

#### Parameters

##### \_\_namedParameters

###### children

`ReactNode`

###### className?

`string`

###### link

[`Link`](../api.md#link-1)

###### style?

`CSSProperties`

#### Returns

`Element`

***

### TagChips()

> **TagChips**(`__namedParameters`): `Element`

One chip per tag, each opening the search for the tag's links, as on the Tags page.

#### Parameters

##### \_\_namedParameters

###### tags

`string`[]

#### Returns

`Element`

***

### TopicChip()

> **TopicChip**(`__namedParameters`): `Element`

A link's topic as a chip that opens the search for the topic's links, as on the Topics page.

#### Parameters

##### \_\_namedParameters

###### topic

`string`

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
