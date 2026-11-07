# web/components/NoteEditor

## Functions

### NoteEditor()

> **NoteEditor**(`__namedParameters`): `Element`

A note shown rendered, with in-place editing: Save sends the text, and a
refusal (such as 'note too long (20,000 characters)') is shown while the
editor keeps the text.

#### Parameters

##### \_\_namedParameters

###### note

`string`

###### onSave

(`note`) => `Promise`\<`void`\>

#### Returns

`Element`
