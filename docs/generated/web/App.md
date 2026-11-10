# web/App

## Interfaces

### Location

Where the website is: the path and the query string of the page.

#### Properties

##### path

> **path**: `string`

##### search

> **search**: `string`

The query string, with its leading '?' when it has one.

## Functions

### App()

> **App**(): `Element`

The website: one page per path.

#### Returns

`Element`

***

### Link()

> **Link**(`__namedParameters`): `Element`

A link within the website, followed without a reload. It takes an anchor's
other properties too, so that it can be an item of a menu.

#### Parameters

##### \_\_namedParameters

`Omit`\<`DetailedHTMLProps`\<`AnchorHTMLAttributes`\<`HTMLAnchorElement`\>, `HTMLAnchorElement`\>, `"href"`\> & `object`

#### Returns

`Element`

***

### modeOf()

> **modeOf**(`location`): `"hybrid"` \| `undefined`

The search mode a location carries in its mode parameter: 'hybrid', or none.

#### Parameters

##### location

[`Location`](#location)

#### Returns

`"hybrid"` \| `undefined`

***

### navigate()

> **navigate**(`path`, `__namedParameters?`): `void`

Moves to `path` (with its query string) within the website without a
reload; `replace` replaces the current history entry instead of adding one.

#### Parameters

##### path

`string`

##### \_\_namedParameters?

###### replace?

`boolean` = `false`

#### Returns

`void`

***

### queryOf()

> **queryOf**(`location`): `string`

The search query a location carries in its q parameter, or ''.

#### Parameters

##### location

[`Location`](#location)

#### Returns

`string`

***

### useLocation()

> **useLocation**(): [`Location`](#location)

The current location of the page, following history navigation.

#### Returns

[`Location`](#location)
