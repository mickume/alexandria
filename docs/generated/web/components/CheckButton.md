# web/components/CheckButton

## Interfaces

### ButtonLook

How a status button looks: an item of a dropdown menu, or of an action list.

#### Properties

##### icon?

> `optional` **icon?**: `ReactNode`

An icon before the label.

##### look?

> `optional` **look?**: `"menu"` \| `"action"`

## Functions

### CheckButton()

> **CheckButton**(`__namedParameters`): `Element`

'Check now' on a link's detail page: says whether its address answers, and when it was checked.

#### Parameters

##### \_\_namedParameters

[`ButtonLook`](#buttonlook) & `object`

#### Returns

`Element`

***

### StatusButton()

> **StatusButton**(`__namedParameters`): `Element`

A button that runs a request and says in a toast how that went: what `run`
answers, the API's own message when it refuses, or `failure`.

#### Parameters

##### \_\_namedParameters

[`ButtonLook`](#buttonlook) & `object`

#### Returns

`Element`
