# worker/search/query

## Interfaces

### Conditions

Conditions on the links (aliased l) a search or list is restricted to, with their parameters.

#### Properties

##### params

> **params**: `unknown`[]

##### sql

> **sql**: `string`[]

## Type Aliases

### FilterName

> **FilterName** = *typeof* [`FILTER_NAMES`](#filter_names)\[`number`\]

***

### Filters

> **Filters** = `Partial`\<`Record`\<[`FilterName`](#filtername), `string`[]\>\>

The filters of a query, each with every value given for it, in order.

***

### ParsedQuery

> **ParsedQuery** = \{ `filters`: [`Filters`](#filters); `ok`: `true`; `words`: `string`[]; \} \| \{ `error`: `"query_too_long"` \| `"invalid_filter"`; `message`: `string`; `ok`: `false`; \}

A parsed query, or why it was refused.

## Variables

### FILTER\_NAMES

> `const` **FILTER\_NAMES**: readonly \[`"tag"`, `"topic"`, `"host"`, `"state"`, `"in"`, `"is"`\]

The prefix filters, by name.

***

### IS\_VALUES

> `const` **IS\_VALUES**: `string`[]

The values `is:` accepts.

***

### QUERY\_MAX

> `const` **QUERY\_MAX**: `200` = `200`

The longest query, in characters.

***

### STATE\_VALUES

> `const` **STATE\_VALUES**: `string`[]

The values `state:` accepts.

## Functions

### filterConditions()

> **filterConditions**(`filters`): [`Conditions`](#conditions)

The conditions that select the links satisfying every filter: a tag with
that name, a topic with that name or a topic beneath it, and the workspace
with that name, ignoring case; a
host equal to the value or ending in '.' and the value; pinned; dead.
Expired links are left out unless a `state:` filter is given: `expired`
selects only them, `any` every state, another value that state.

#### Parameters

##### filters

[`Filters`](#filters)

#### Returns

[`Conditions`](#conditions)

***

### filtersFromParams()

> **filtersFromParams**(`values`): \{ `filters`: [`Filters`](#filters); `ok`: `true`; \} \| \{ `field`: `"topic"` \| `"host"` \| `"state"` \| `"tag"` \| `"is"` \| `"in"`; `message`: `string`; `ok`: `false`; \}

The filters of the link list's query parameters, which have the meaning of
the prefix filters: `values(name)` gives every value of a parameter. Empty
tag, topic, host and in values are ignored; a refused state or is value is
named with its parameter.

#### Parameters

##### values

(`name`) => `string`[] \| `undefined`

#### Returns

\{ `filters`: [`Filters`](#filters); `ok`: `true`; \} \| \{ `field`: `"topic"` \| `"host"` \| `"state"` \| `"tag"` \| `"is"` \| `"in"`; `message`: `string`; `ok`: `false`; \}

***

### parseQuery()

> **parseQuery**(`q`, `max?`): [`ParsedQuery`](#parsedquery)

Splits a query into free words and prefix filters: `tag:`, `topic:`,
`host:`, `state:`, `in:` and `is:`, case-insensitive, each followed by one
word or a double-quoted phrase. Every other term, another `word:value` and
an unclosed quote included, is a free word. Refuses a query over `max`
characters (200 unless given), and a `state:` or `is:` value the filter does not take.

#### Parameters

##### q

`string`

##### max?

`number` = `QUERY_MAX`

#### Returns

[`ParsedQuery`](#parsedquery)

***

### refusal()

> **refusal**(`name`, `value`): `string` \| `null`

Why a filter's value is refused, or null when it is accepted: `state:` and
`is:` take only their own values.

#### Parameters

##### name

`"topic"` \| `"host"` \| `"state"` \| `"tag"` \| `"is"` \| `"in"`

##### value

`string`

#### Returns

`string` \| `null`
