# web/components/BarChart

## Interfaces

### Bar

One bar: what it stands for (a day or a range) and its count.

#### Properties

##### count

> **count**: `number`

##### label

> **label**: `string`

***

### Series

One series of a trend chart: its name and one value per day, null where there is none.

#### Properties

##### name

> **name**: `string`

##### values

> **values**: (`number` \| `null`)[]

## Functions

### BarChart()

> **BarChart**(`__namedParameters`): `Element`

A bar chart drawn as inline SVG, one bar per entry, each with a tooltip of
its label and count; beside it, a table of the same numbers for screen
readers, and an optional caption below.

#### Parameters

##### \_\_namedParameters

###### bars

[`Bar`](#bar)[]

###### caption?

`string`

###### title

`string`

#### Returns

`Element`

***

### TrendChart()

> **TrendChart**(`__namedParameters`): `Element`

A chart of daily series drawn as inline SVG: one group per day (bars side by
side, stacked bars, or a point of each line), its tooltip naming the day and
every series' value; the days before the record began (`unrecorded`, the
first days) shaded and titled "not recorded yet". A table of the same numbers
for screen readers is beside it.

#### Parameters

##### \_\_namedParameters

###### days

`string`[]

###### kind?

`"bars"` \| `"stacked"` \| `"lines"` = `'bars'`

###### series

[`Series`](#series)[]

###### title

`string`

###### unit?

`string` = `''`

Written after each value in the tooltips and the table, such as '%'.

###### unrecorded?

`number` = `0`

#### Returns

`Element`
