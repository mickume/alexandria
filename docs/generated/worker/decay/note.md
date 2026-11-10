# worker/decay/note

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
