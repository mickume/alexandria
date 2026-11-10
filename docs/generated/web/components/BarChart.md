# web/components/BarChart

## Interfaces

### Bar

One bar: what it stands for (a day or a range) and its count.

#### Properties

##### count

> **count**: `number`

##### label

> **label**: `string`

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
