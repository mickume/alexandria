# worker/decay/note

## Variables

### DEFAULT\_START\_POINTS

> `const` **DEFAULT\_START\_POINTS**: `60` = `60`

The start points of a user who never changed them.

## Functions

### decayFields()

> **decayFields**(`row`): \{ `archived_at`: `string`; `dead_since`: `string` \| `null`; `decay_note`: `string`; `expired_at`: `null`; `last_check_result`: `string` \| `null`; `last_checked_at`: `string` \| `null`; `points`: `null`; `removal_at`: `null`; \} \| \{ `archived_at`: `null`; `dead_since`: `string` \| `null`; `decay_note`: `string`; `expired_at`: `string` \| `null`; `last_check_result`: `string` \| `null`; `last_checked_at`: `string` \| `null`; `points`: `number`; `removal_at`: `string` \| `null`; \}

The decay fields of a link as the API shows them: points, expiry and
liveness dates, and why. An archived link is kept outside decay: it has no
points and no removal date.

#### Parameters

##### row

[`LinkRow`](../links/store.md#linkrow)

#### Returns

\{ `archived_at`: `string`; `dead_since`: `string` \| `null`; `decay_note`: `string`; `expired_at`: `null`; `last_check_result`: `string` \| `null`; `last_checked_at`: `string` \| `null`; `points`: `null`; `removal_at`: `null`; \} \| \{ `archived_at`: `null`; `dead_since`: `string` \| `null`; `decay_note`: `string`; `expired_at`: `string` \| `null`; `last_check_result`: `string` \| `null`; `last_checked_at`: `string` \| `null`; `points`: `number`; `removal_at`: `string` \| `null`; \}

***

### pointsAt()

> **pointsAt**(`startPoints`, `useCount`, `decayFrom`, `at`): `number`

A link's points at time `at`: its user's start points plus its use count,
minus the whole 24-hour periods since its decay start (none for a decay start
after `at`). They can be negative.

#### Parameters

##### startPoints

`number`

##### useCount

`number`

##### decayFrom

`string`

##### at

`number`

#### Returns

`number`
