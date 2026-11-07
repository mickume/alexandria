# worker/enrich/enrich

## Interfaces

### Aliases

The user's aliases: each former name's key (nameKey) with the name of its survivor.

#### Properties

##### tags

> **tags**: `Map`\<`string`, `string`\>

##### topics

> **topics**: `Map`\<`string`, `string`\>

***

### Enrichment

An enrichment, normalised: what is stored on a link.

#### Properties

##### summary

> **summary**: `string`

##### tags

> **tags**: `string`[]

##### topic

> **topic**: `string`

***

### PromptInput

What the request about one link is built from.

#### Properties

##### description

> **description**: `string` \| `null`

##### host

> **host**: `string`

##### tags

> **tags**: `string`[]

##### text

> **text**: `string`

The reader-view text, or '' when the reader view is empty.

##### title

> **title**: `string`

##### topics

> **topics**: `string`[]

## Variables

### MAX\_PROMPT\_TEXT

> `const` **MAX\_PROMPT\_TEXT**: `20000` = `20_000`

The most page text sent to the provider, in characters.

***

### MAX\_SUMMARY\_WORDS

> `const` **MAX\_SUMMARY\_WORDS**: `60` = `60`

The most words a summary keeps.

***

### MAX\_TAGS

> `const` **MAX\_TAGS**: `8` = `8`

***

### MIN\_TAGS

> `const` **MIN\_TAGS**: `3` = `3`

The fewest and the most tags an enrichment keeps.

## Functions

### applyAliases()

> **applyAliases**(`result`, `aliases`): [`Enrichment`](#enrichment)

An enrichment result with every topic or tag that is an alias replaced by
its survivor, compared ignoring case; tags that become repeats are dropped.

#### Parameters

##### result

[`Enrichment`](#enrichment)

##### aliases

[`Aliases`](#aliases)

#### Returns

[`Enrichment`](#enrichment)

***

### buildPrompt()

> **buildPrompt**(`input`): `string`

The request sent to the provider: instructions, the link's title and host,
the user's topic and tag names, and the first 20,000 characters of the page
text, or its title and description when it has none. Nothing else of the
page or of the user.

#### Parameters

##### input

[`PromptInput`](#promptinput)

#### Returns

`string`

***

### nameKey()

> **nameKey**(`name`): `string`

The key two names are compared by: case ignored, spaces read as hyphens.

#### Parameters

##### name

`string`

#### Returns

`string`

***

### normalizeResult()

> **normalizeResult**(`raw`): [`Enrichment`](#enrichment) \| `null`

Normalises a provider's raw result: tags as normalizeTags makes them, the
first 8 kept; the summary cut to its first 60 words. Returns null for a
result that is unusable: not the right shape, fewer than 3 tags, or an
empty summary or topic.

#### Parameters

##### raw

`unknown`

#### Returns

[`Enrichment`](#enrichment) \| `null`

***

### normalizeTag()

> **normalizeTag**(`name`): `string`

A tag name as it is stored: lower-case, hyphens for spaces, only a-z, 0-9 and '-'.

#### Parameters

##### name

`string`

#### Returns

`string`

***

### normalizeTags()

> **normalizeTags**(`names`): `string`[]

Tags normalised, without empties or repeats, in their order.

#### Parameters

##### names

`string`[]

#### Returns

`string`[]
