# web/format

## Functions

### byName()

> **byName**(`a`, `b`): `number`

Orders things by name, alphabetically and ignoring case.

#### Parameters

##### a

###### name

`string`

##### b

###### name

`string`

#### Returns

`number`

***

### formatDate()

> **formatDate**(`iso`): `string`

A stored time as a short date, such as "15 Jan 2026".

#### Parameters

##### iso

`string`

#### Returns

`string`

***

### formatWhen()

> **formatWhen**(`iso`, `now?`): `string`

A recent time relative to now ("just now", "5 minutes ago", "3 hours ago"),
and an older one as a short date.

#### Parameters

##### iso

`string`

##### now?

`number` = `...`

#### Returns

`string`
