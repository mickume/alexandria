# web/components/LinkCard

## Interfaces

### CardActions

What a card's actions do; the stream page supplies them.

#### Properties

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

One link in the stream: favicon, title, host, dates, state and actions.

#### Parameters

##### \_\_namedParameters

###### actions

[`CardActions`](#cardactions)

###### link

[`Link`](../api.md#link) & `object`

#### Returns

`Element`
