# worker/clock

## Functions

### advance()

> **advance**(`ms`): `void`

Moves a fixed clock forward by `ms` milliseconds.

#### Parameters

##### ms

`number`

#### Returns

`void`

***

### now()

> **now**(): `Date`

The current time, or the time a test fixed with setNow().

#### Returns

`Date`

***

### setNow()

> **setNow**(`t`): `void`

Fixes the clock at `t`, or lets it run again when `t` is null.

#### Parameters

##### t

`number` \| `Date` \| `null`

#### Returns

`void`
