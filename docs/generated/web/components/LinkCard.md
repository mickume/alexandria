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
