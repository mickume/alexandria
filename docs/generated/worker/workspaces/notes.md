# worker/workspaces/notes

## Type Aliases

### NoteCheck

> **NoteCheck** = \{ `note`: `string`; `ok`: `true`; \} \| \{ `error`: `"note_too_long"` \| `"invalid_note"`; `message`: `string`; `ok`: `false`; \}

A valid note, or why the value is refused.

## Variables

### NOTE\_MAX

> `const` **NOTE\_MAX**: `20000` = `20_000`

The longest note, in Unicode code points.

***

### PREVIEW\_MAX

> `const` **PREVIEW\_MAX**: `200` = `200`

The longest note preview, in characters.

## Functions

### checkNote()

> **checkNote**(`value`): [`NoteCheck`](#notecheck)

Checks a note: a string of at most 20,000 code points; '' clears the note.

#### Parameters

##### value

`unknown`

#### Returns

[`NoteCheck`](#notecheck)

***

### notePreview()

> **notePreview**(`note`): `string` \| `null`

A note's first non-empty line as plain text: raw HTML elements removed
(with the content of script and style elements), then a leading Markdown
heading or list marker; trimmed and cut to 200 characters. Null for an
empty note.

#### Parameters

##### note

`string`

#### Returns

`string` \| `null`
