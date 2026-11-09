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

### renderNote()

> **renderNote**(`source`): `string`

A note as HTML: Markdown rendered, raw HTML removed, only http, https and mailto URLs kept.

#### Parameters

##### source

`string`

#### Returns

`string`
