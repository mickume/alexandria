# web/stateList

## Functions

### useStateList()

> **useStateList**(`state`, `query`, `mode?`): `object`

The links of the Expired or the Archive page: every link in `state`, most
recent first, or with a query (from the search box) those matching it.
`failed` says that the last load failed; a later load that works clears it.

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

##### keywordOnly

> **keywordOnly**: `boolean`

##### loaded

> **loaded**: `boolean`

##### setItems

> **setItems**: `Dispatch`\<`SetStateAction`\<[`Link`](api.md#link-1)[]\>\>
