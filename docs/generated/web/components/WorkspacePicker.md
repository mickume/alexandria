# web/components/WorkspacePicker

## Functions

### WorkspacePicker()

> **WorkspacePicker**(`__namedParameters`): `Element`

'Add to workspace' on a card or a link's detail page: the owner's workspaces by name, those already
holding the link marked; choosing another adds the link at its bottom.

#### Parameters

##### \_\_namedParameters

###### icon?

`ReactNode`

An icon before the label.

###### linkId

`string`

###### memberOf

`string`[]

###### menuItem?

`boolean` = `false`

Whether the button is an item of a menu or an action list, not a link-like button.

###### onAdded

(`workspace`) => `void`

#### Returns

`Element`
