# worker/enrich/enrich

## Interfaces

### Aliases

The user's tag aliases: each former name's key (nameKey) with the name of its survivor.

#### Properties

##### tags

> **tags**: `Map`\<`string`, `string`\>

***

### Enrichment

An enrichment, normalised: what is stored on a link.

#### Properties

##### summary

> **summary**: `string`

##### tags

> **tags**: `string`[]

##### topic

> **topic**: `string`[]

The topic path's names, from the most general to the most specific: one to three.

***

### PromptInput

What the request about one link is built from.

#### Properties

##### description

> **description**: `string` \| `null`

##### host

> **host**: `string`

##### tags

> **tags**: [`VocabularyEntry`](#vocabularyentry)[]

##### text

> **text**: `string`

The reader-view text, or '' when the reader view is empty.

##### title

> **title**: `string`

##### topics

> **topics**: `string`[]

The topics' paths, such as 'Software engineering > Testing'.

***

### VocabularyEntry

A tag name with the number of the user's links that carry it.

#### Properties

##### count

> **count**: `number`

##### name

> **name**: `string`

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

> `const` **MAX\_TAGS**: `5` = `5`

***

### MIN\_TAGS

> `const` **MIN\_TAGS**: `1` = `1`

The fewest and the most tags an enrichment keeps. A low floor lets a page
that fits one or two existing tags keep just those, rather than pushing the
model to invent more and scatter the vocabulary.

## Functions

### applyAliases()

> **applyAliases**(`result`, `aliases`): [`Enrichment`](#enrichment)

An enrichment result with every tag that is an alias replaced by its
survivor, compared ignoring case; tags that become repeats are dropped. The
topic path's names are matched against the topic aliases as they are
resolved (resolveTopicPath).

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
the user's topic paths, one per line, and tag names with how many links
carry each, and the first 20,000 characters of the page
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

### nearKeys()

> **nearKeys**(`name`): `string`[]

The keys a name is close enough to share a tag or topic with: its own key
first (nameKey with the hyphens dropped, so "web-dev" meets "webdev"), then
the same with its last word made singular or plural ("databases" meets
"database", "library" meets "libraries"). Two names are near when the own
key of one is among the keys of the other.

#### Parameters

##### name

`string`

#### Returns

`string`[]

***

### normalizeResult()

> **normalizeResult**(`raw`): [`Enrichment`](#enrichment) \| `null`

Normalises a provider's raw result: tags as normalizeTags makes them, the
first 5 kept; the summary cut to its first 60 words; the topic split on
every '>' into names, spaces collapsed, of which a path longer than three
keeps the first two and the last. Returns null for a result that is
unusable: not the right shape, no tags, an empty summary, or a topic with an
empty name or a name over 100 characters.

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
