# worker/meaning/ask

## Variables

### ASK\_CONTEXT\_MAX

> `const` **ASK\_CONTEXT\_MAX**: `40000` = `40_000`

The most characters of passages an answer is written from.

***

### ASK\_PASSAGES

> `const` **ASK\_PASSAGES**: `8` = `8`

How many passages an answer is written from.

***

### askRoutes

> `const` **askRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

***

### DETAILED\_CONTEXT\_MAX

> `const` **DETAILED\_CONTEXT\_MAX**: `80000` = `80_000`

The most characters of passages a detailed answer is written from.

***

### DETAILED\_MAX\_TOKENS

> `const` **DETAILED\_MAX\_TOKENS**: `4096` = `4_096`

The most tokens a detailed answer may hold.

***

### DETAILED\_PASSAGES

> `const` **DETAILED\_PASSAGES**: `16` = `16`

How many passages a detailed answer is written from.

***

### NOTHING\_ANSWERS

> `const` **NOTHING\_ANSWERS**: `"Nothing in your library answers this."` = `'Nothing in your library answers this.'`

The whole answer when the passages answer nothing.

***

### PHRASING\_MAX

> `const` **PHRASING\_MAX**: `200` = `200`

The longest phrasing of a question, in characters.

***

### PHRASINGS\_MAX

> `const` **PHRASINGS\_MAX**: `3` = `3`

The most phrasings the owner's provider adds to a question.

***

### QUESTION\_MAX

> `const` **QUESTION\_MAX**: `500` = `500`

The longest question, in characters.

## Functions

### sourceTexts()

> **sourceTexts**(`excerpts`, `numbers`, `max`): `Map`\<`number`, `string`\>

The text of each source for the provider: its passages in the order of the
page, each with its neighbours, passages that touch or overlap joined so
that shared text appears once, and gaps marked. At most `max` characters in
all: over that, neighbours are dropped from the lowest-ranked source up.

#### Parameters

##### excerpts

`Excerpt`[]

##### numbers

`Map`\<`string`, `number`\>

##### max

`number`

#### Returns

`Map`\<`number`, `string`\>

***

### usablePhrasings()

> **usablePhrasings**(`value`, `question`): `string`[]

The phrasings of a provider's answer that can be used: strings of 1 to
PHRASING_MAX characters once their spaces are collapsed, the first
PHRASINGS_MAX of them, none twice and none the question itself.

#### Parameters

##### value

`unknown`

##### question

`string`

#### Returns

`string`[]
