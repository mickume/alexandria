# web/components/CheckButton

## Interfaces

### ButtonLook

How a status button looks: a link-like button, or an item of a menu or an action list.

#### Properties

##### icon?

> `optional` **icon?**: `ReactNode`

An icon before the label.

##### menuItem?

> `optional` **menuItem?**: `boolean`

Whether the button is an item of a menu or an action list.

## Functions

### CheckButton()

> **CheckButton**(`__namedParameters`): `Element`

'Check now' on a link's detail page: whether its address answers, and when it was checked.

#### Parameters

##### \_\_namedParameters

[`ButtonLook`](#buttonlook) & `object`

#### Returns

`Element`

***

### StatusButton()

> **StatusButton**(`__namedParameters`): `Element`

A button that runs a request and says beside it how that went: what `run`
answers, the API's own message when it refuses, or `failure`.

#### Parameters

##### \_\_namedParameters

[`ButtonLook`](#buttonlook) & `object`

#### Returns

`Element`
