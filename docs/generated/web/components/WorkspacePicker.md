# web/components/WorkspacePicker

## Functions

### WorkspacePicker()

> **WorkspacePicker**(`__namedParameters`): `Element`

'Add to workspace' on a card or a link's detail page: the owner's workspaces by name, those already
holding the link marked; choosing another adds the link at its bottom.

#### Parameters

##### \_\_namedParameters

###### className?

`string` = `'q-btn-link'`

The button's class: a link-like button unless an action list asks for its own.

###### icon?

`ReactNode`

An icon before the label.

###### linkId

`string`

###### memberOf

`string`[]

###### onAdded

(`workspace`) => `void`

#### Returns

`Element`
