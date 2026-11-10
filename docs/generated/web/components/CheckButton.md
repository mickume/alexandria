# web/components/CheckButton

## Interfaces

### ButtonLook

How a status button looks and says how its request went: a link-like button
or an item of an action list, each with the outcome beside it, or an item
of a dropdown menu, which closes and says it in a toast.

#### Properties

##### icon?

> `optional` **icon?**: `ReactNode`

An icon before the label.

##### look?

> `optional` **look?**: `"link"` \| `"menu"` \| `"action"`

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

A button that runs a request and says how that went: what `run` answers,
the API's own message when it refuses, or `failure`.

#### Parameters

##### \_\_namedParameters

[`ButtonLook`](#buttonlook) & `object`

#### Returns

`Element`
