# worker/decay/note

## Functions

### decayFields()

> **decayFields**(`row`): `object`

The decay fields of a link as the API shows them: stickiness, archive and liveness dates, and why.

#### Parameters

##### row

[`LinkRow`](../links/store.md#linkrow)

#### Returns

`object`

##### archived\_at

> **archived\_at**: `string` \| `null` = `archivedAt`

##### dead\_since

> **dead\_since**: `string` \| `null`

##### decay\_note

> **decay\_note**: `string`

##### last\_check\_result

> **last\_check\_result**: `string` \| `null`

##### last\_checked\_at

> **last\_checked\_at**: `string` \| `null`

##### removal\_at

> **removal\_at**: `string` \| `null` = `removalAt`

##### sticky

> **sticky**: `boolean`
