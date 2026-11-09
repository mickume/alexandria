# worker/decay/note

## Variables

### DEFAULT\_START\_POINTS

> `const` **DEFAULT\_START\_POINTS**: `60` = `60`

The start points of a user who never changed them.

## Functions

### decayFields()

> **decayFields**(`row`): `object`

The decay fields of a link as the API shows them: points, expiry and liveness dates, and why.

#### Parameters

##### row

[`LinkRow`](../links/store.md#linkrow)

#### Returns

`object`

##### dead\_since

> **dead\_since**: `string` \| `null`

##### decay\_note

> **decay\_note**: `string`

##### expired\_at

> **expired\_at**: `string` \| `null` = `expiredAt`

##### last\_check\_result

> **last\_check\_result**: `string` \| `null`

##### last\_checked\_at

> **last\_checked\_at**: `string` \| `null`

##### points

> **points**: `number`

##### removal\_at

> **removal\_at**: `string` \| `null` = `removalAt`

***

### pointsAt()

> **pointsAt**(`startPoints`, `useCount`, `lastUsedAt`, `at`): `number`

A link's points at time `at`: its user's start points plus its use count,
minus the whole 24-hour periods since its last use or boost (none for a last
use after `at`). They can be negative.

#### Parameters

##### startPoints

`number`

##### useCount

`number`

##### lastUsedAt

`string`

##### at

`number`

#### Returns

`number`
