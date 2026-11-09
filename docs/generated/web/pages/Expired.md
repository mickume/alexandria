# web/pages/Expired

## Interfaces

### Listed

Links as the Expired or Archive page lists them, and how a search by meaning found them.

#### Properties

##### byMeaning

> **byMeaning**: `Set`\<`string`\>

The ids of the links found by meaning alone.

##### keywordOnly

> **keywordOnly**: `boolean`

Whether a search by meaning could not use meaning.

##### list

> **list**: [`Link`](../api.md#link-1)[]

## Functions

### Expired()

> **Expired**(`__namedParameters`): `Element`

The Expired page: expired links, most recently expired first, each with the
day it will be removed, to restore or delete; with a query (from the search
box), the expired links matching it.

#### Parameters

##### \_\_namedParameters

###### mode?

`"hybrid"`

###### query?

`string` = `''`

#### Returns

`Element`

***

### searchInState()

> **searchInState**(`state`, `query`, `mode?`): `Promise`\<[`Listed`](#listed)\>

The links in `state` matching `query`: the search, limited to that state.

#### Parameters

##### state

`"expired"` \| `"archived"`

##### query

`string`

##### mode?

`"hybrid"`

#### Returns

`Promise`\<[`Listed`](#listed)\>
