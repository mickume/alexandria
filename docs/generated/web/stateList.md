# web/stateList

## Functions

### useStateList()

> **useStateList**(`state`, `query`, `mode?`): `object`

The links of the Expired or the Archive page: every link in `state`, most
recent first, or with a query (from the search box) those matching it.
`failed` says that the last load failed; a later load that works clears it.
`retry` loads again, as Try again does after a search without meaning.

#### Parameters

##### state

`"expired"` \| `"archived"`

##### query

`string`

##### mode?

`"hybrid"`

#### Returns

`object`

##### byMeaning

> **byMeaning**: `Set`\<`string`\>

##### failed

> **failed**: `boolean`

##### items

> **items**: [`Link`](api.md#link-1)[]

##### loaded

> **loaded**: `boolean`

##### meaning

> **meaning**: [`Meaning`](api.md#meaning-1) \| `undefined`

##### retry

> **retry**: () => `void`

###### Returns

`void`

##### setItems

> **setItems**: `Dispatch`\<`SetStateAction`\<[`Link`](api.md#link-1)[]\>\>
