# web/components/WorkspacePicker

## Functions

### WorkspacePicker()

> **WorkspacePicker**(`__namedParameters`): `Element`

'Add to workspace' on a card or a link's detail page: the owner's
workspaces by name, those already holding the link checked; choosing
another adds the link at its bottom. In a card's menu (`submenu`) it is a
submenu of that menu; on its own it is a menu under a button of an action
list.

#### Parameters

##### \_\_namedParameters

###### icon?

`ReactNode`

An icon before the label.

###### linkId

`string`

###### memberOf

`string`[]

###### onAdded

(`workspace`) => `void`

###### submenu?

`boolean` = `false`

Whether the picker is a submenu of the dropdown menu it is in.

#### Returns

`Element`
