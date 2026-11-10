# web/confirm

## Interfaces

### Confirmation

What the owner is asked before something that cannot be undone.

#### Properties

##### action

> **action**: `string`

The button that goes ahead, such as 'Delete'.

##### description

> **description**: `string`

What goes with it.

##### title

> **title**: `string`

The question.

## Functions

### ConfirmProvider()

> **ConfirmProvider**(`__namedParameters`): `Element`

Shows the one dialog `useConfirm` asks with, over whatever page is under it.

#### Parameters

##### \_\_namedParameters

###### children

`ReactNode`

#### Returns

`Element`

***

### useConfirm()

> **useConfirm**(): `Ask`

Asks the owner to confirm; resolves true when they go ahead, false when they cancel or leave.

#### Returns

`Ask`
