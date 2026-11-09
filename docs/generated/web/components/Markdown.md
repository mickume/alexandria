# web/components/Markdown

## Functions

### Markdown()

> **Markdown**(`__namedParameters`): `Element`

A rendered note.

#### Parameters

##### \_\_namedParameters

###### source

`string`

#### Returns

`Element`

***

### openWebLinksInNewTab()

> **openWebLinksInNewTab**(`sanitiser`): `void`

Makes every http or https link a sanitiser keeps open in a new tab, as a card's links do.

#### Parameters

##### sanitiser

`DOMPurify`

#### Returns

`void`

***

### renderAnswer()

> **renderAnswer**(`source`, `citation`): `string`

An answer as HTML, rendered as a note is, with each citation [n] that
`citation` gives a link page for made a link to that page.

#### Parameters

##### source

`string`

##### citation

(`n`) => `string` \| `undefined`

#### Returns

`string`

***

### renderNote()

> **renderNote**(`source`): `string`

A note as HTML: Markdown rendered, raw HTML removed, only http, https and mailto URLs kept.

#### Parameters

##### source

`string`

#### Returns

`string`
