# web/components/SearchBox

## Variables

### QUERY\_MAX

> `const` **QUERY\_MAX**: `200` = `200`

The longest query.

## Functions

### SearchBox()

> **SearchBox**(`__namedParameters`): `Element`

The search box in the header of every page. Typing searches nothing: Enter
searches the query by words and by meaning, at /search?q=&mode=hybrid (on
the Expired and Archive pages, within their links). '/' typed outside a
text field focuses it; Escape in it clears it, returns from a search to the
page it started from and focuses the page's main region. No other key is a
shortcut.

#### Parameters

##### \_\_namedParameters

###### location

[`Location`](../App.md#location)

#### Returns

`Element`
