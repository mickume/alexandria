# worker/retrievers/facts

## Variables

### DESCRIPTION\_LIMIT

> `const` **DESCRIPTION\_LIMIT**: `300` = `300`

The longest description a retrieved link stores.

## Functions

### clockDuration()

> **clockDuration**(`iso`): `string` \| `null`

An ISO 8601 duration (`PT12M34S`, `P1DT2H`) as it is shown: "m:ss", or
"h:mm:ss" from an hour; null for a zero duration (a live stream's `P0D`) or
anything else.

#### Parameters

##### iso

`unknown`

#### Returns

`string` \| `null`

***

### compactCount()

> **compactCount**(`n`): `string`

A count as it is shown: 999, then 1.2k, 12.3k, then 1.2M.

#### Parameters

##### n

`number`

#### Returns

`string`

***

### dateOf()

> **dateOf**(`iso`): `string` \| `null`

The date of an ISO 8601 time, `YYYY-MM-DD`; null when it is not one.

#### Parameters

##### iso

`unknown`

#### Returns

`string` \| `null`

***

### describe()

> **describe**(`text`): `string` \| `null`

`text` as a description: whitespace collapsed, and when longer than 300
characters cut at the last word boundary before it, with "…"; null for
empty text.

#### Parameters

##### text

`string` \| `null` \| `undefined`

#### Returns

`string` \| `null`

***

### facts()

> **facts**(`entries`): [`Fact`](retriever.md#fact)[]

The facts of a link from `[key, label, value, card]` entries, in order,
leaving out every entry whose value is missing or empty.

#### Parameters

##### entries

\[`key`: `string`, `label`: `string`, `value`: `string` \| `null`, `card?`: `boolean`\][]

#### Returns

[`Fact`](retriever.md#fact)[]
