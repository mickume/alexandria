# worker/decay/points

## Variables

### DAY\_MS

> `const` **DAY\_MS**: `86400000` = `86_400_000`

One day, in milliseconds.

***

### DEFAULT\_THRESHOLDS

> `const` **DEFAULT\_THRESHOLDS**: `object`

The decay settings of a user who never changed them.

#### Type Declaration

##### remove\_days

> `readonly` **remove\_days**: `180` = `180`

##### start\_points

> `readonly` **start\_points**: `60` = `60`

##### use\_boost

> `readonly` **use\_boost**: `50` = `50`

***

### IN\_WORKSPACE

> `const` **IN\_WORKSPACE**: `"EXISTS (SELECT 1 FROM workspace_links wl WHERE wl.link_id = l.id)"` = `'EXISTS (SELECT 1 FROM workspace_links wl WHERE wl.link_id = l.id)'`

The SQL condition that a link `l` is in at least one workspace.

## Functions

### epochMs()

> **epochMs**(`column`): `string`

The SQL expression of a stored timestamp `column` as milliseconds since the
epoch, in integers, so that whole days are counted exactly as pointsAt counts
them.

#### Parameters

##### column

`string`

#### Returns

`string`

***

### isoFromMs()

> **isoFromMs**(`ms`): `string`

The SQL expression of the integer milliseconds `ms` since the epoch as a
stored timestamp, to the millisecond: the inverse of epochMs.

#### Parameters

##### ms

`string`

#### Returns

`string`

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

***

### pointsSql()

> **pointsSql**(`l`, `startPoints`, `at`): `string`

The SQL expression of the points of the link aliased `l`, counted as pointsAt
counts them: `startPoints` is the SQL of its user's start points and `at` the
SQL of the instant, in integer milliseconds.

#### Parameters

##### l

`string`

##### startPoints

`string`

##### at

`string`

#### Returns

`string`
