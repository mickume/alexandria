# web/components/SearchBox

## Variables

### QUERY\_MAX

> `const` **QUERY\_MAX**: `200` = `200`

The longest query.

***

### SEARCH\_DELAY\_MS

> `const` **SEARCH\_DELAY\_MS**: `200` = `200`

How long the box waits after the last keystroke before it searches.

## Functions

### SearchBox()

> **SearchBox**(`__namedParameters`): `Element`

The search box in the header of every page. It searches by keyword 200 ms
after the last keystroke, at /search?q= (on the Archive page, within the
archive); Enter searches the same query by meaning as well, at
/search?q=&mode=hybrid; an emptied box returns to the stream. '/' typed outside a text field
focuses it; Escape in it clears it, returns to the page the search started
from and focuses the page's main region. No other key is a shortcut.

#### Parameters

##### \_\_namedParameters

###### location

[`Location`](../App.md#location)

#### Returns

`Element`
