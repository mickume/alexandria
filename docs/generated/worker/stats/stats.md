# worker/stats/stats

## Interfaces

### BuildContext

What a section is built from: the context and the links' own counts (linkCounts).

#### Extends

- [`StatsContext`](#statscontext)

#### Properties

##### at

> **at**: `Date`

The instant of the request.

###### Inherited from

[`StatsContext`](#statscontext).[`at`](#at-1)

##### db

> **db**: `D1Database`

###### Inherited from

[`StatsContext`](#statscontext).[`db`](#db-1)

##### links

> **links**: `Row`

##### userId

> **userId**: `string`

###### Inherited from

[`StatsContext`](#statscontext).[`userId`](#userid-1)

***

### Section

One section of the statistics: the statements it reads, bound to the user,
and how it turns their rows (one result per statement, in order) into its
part of the answer.

#### Properties

##### build

> **build**: (`results`, `ctx`) => `unknown`

###### Parameters

###### results

`Results`

###### ctx

[`BuildContext`](#buildcontext)

###### Returns

`unknown`

##### name

> **name**: `string`

##### statements

> **statements**: (`ctx`) => `D1PreparedStatement`[]

###### Parameters

###### ctx

[`StatsContext`](#statscontext)

###### Returns

`D1PreparedStatement`[]

***

### StatsContext

What a section knows when it is computed.

#### Extended by

- [`BuildContext`](#buildcontext)

#### Properties

##### at

> **at**: `Date`

The instant of the request.

##### db

> **db**: `D1Database`

##### userId

> **userId**: `string`

## Variables

### IN\_WORKSPACE

> `const` **IN\_WORKSPACE**: `"EXISTS (SELECT 1 FROM workspace_links wl WHERE wl.link_id = l.id)"` = `'EXISTS (SELECT 1 FROM workspace_links wl WHERE wl.link_id = l.id)'`

The SQL condition that a link `l` is in at least one workspace.

***

### SECTIONS

> `const` **SECTIONS**: [`Section`](#section)[]

Every section of the answer, in its order.

***

### statsHooks

> `const` **statsHooks**: `object` = `{}`

Test seams of the statistics, as the clock is one.

#### Type Declaration

##### beforeSection?

> `optional` **beforeSection?**: (`name`) => `void`

###### Parameters

###### name

`string`

###### Returns

`void`

## Functions

### computeStats()

> **computeStats**(`db`, `userId`, `at`): `Promise`\<`Record`\<`string`, `unknown`\>\>

The statistics of the user's library at `at`: every section's statements in
one batch, then each section built from its own results. Any failure is
thrown, so the caller answers with no partial result.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### at

`Date`

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>

***

### lastDays()

> **lastDays**(`at`, `count?`): `string`[]

The UTC days the activity covers: the last 30, today included, oldest first, as 'YYYY-MM-DD'.

#### Parameters

##### at

`Date`

##### count?

`number` = `30`

#### Returns

`string`[]

***

### n()

> **n**(`row`, `key`): `number`

A count from a row: SUM over no rows is null.

#### Parameters

##### row

`Row` \| `undefined`

##### key

`string`

#### Returns

`number`
