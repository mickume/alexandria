# web/components/ByMeaning

## Functions

### ByMeaning()

> **ByMeaning**(): `Element`

The mark on a search result that was found by what it means, not by the words of the query.

#### Returns

`Element`

***

### MeaningNotice()

> **MeaningNotice**(`__namedParameters`): `Element` \| `null`

The line above the results of a search by meaning that could not use
meaning, or could not order its results by relevance, with a button that
searches again; nothing when meaning was used.

#### Parameters

##### \_\_namedParameters

###### meaning?

[`Meaning`](../api.md#meaning-1)

###### onRetry

() => `void`

#### Returns

`Element` \| `null`
