# web/components/CheckButton

## Interfaces

### ButtonLook

How a status button looks: its class and an icon before its label.

#### Properties

##### className?

> `optional` **className?**: `string`

The button's class: a link-like button unless an action list asks for its own.

##### icon?

> `optional` **icon?**: `ReactNode`

An icon before the label.

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
