# worker/retrievers/retriever

## Interfaces

### Fact

One site-specific detail of a link, as it is shown.

#### Properties

##### card

> **card**: `boolean`

Shown on the link's card (at most 3 per link).

##### key

> **key**: `string`

##### label

> **label**: `string`

##### value

> **value**: `string`

***

### Retrieved

What a retriever answered for a link.

#### Properties

##### description

> **description**: `string` \| `null`

##### facts

> **facts**: [`Fact`](#fact)[]

##### faviconUrl

> **faviconUrl**: `string`

##### finalUrl

> **finalUrl**: `string`

The canonical address of the thing.

##### kind

> **kind**: [`SiteKind`](#sitekind)

##### language

> **language**: `string` \| `null`

##### text

> **text**: `string` \| `null`

The text search, Ask, enrichment and the meaning index read; null for none.

##### title

> **title**: `string`

##### warning?

> `optional` **warning?**: `string`

Something that went wrong without failing the retrieval, recorded as the fetch's reason.

***

### Retriever

A retriever: the addresses of one site it claims, and how it retrieves one.

#### Type Parameters

##### Claim

`Claim` = `unknown`

#### Properties

##### hosts

> **hosts**: `string`[]

The hosts whose addresses it may claim, exactly (a subdomain is not one of them).

##### name

> **name**: [`RetrieverName`](#retrievername-1)

##### site

> **site**: `string`

The site's name, as notes and reasons say it: "GitHub".

#### Methods

##### claim()

> **claim**(`url`): `Claim` \| `null`

What the retriever needs to retrieve `url`, or null when it does not claim it.

###### Parameters

###### url

`URL`

###### Returns

`Claim` \| `null`

##### enabled()

> **enabled**(`env`): `boolean`

Whether the retriever is in use in this deployment (it may need a key it does not have).

###### Parameters

###### env

[`Env`](../env.md#env)

###### Returns

`boolean`

##### retrieve()

> **retrieve**(`env`, `claim`): `Promise`\<[`RetrieveResult`](#retrieveresult)\>

###### Parameters

###### env

[`Env`](../env.md#env)

###### claim

`Claim`

###### Returns

`Promise`\<[`RetrieveResult`](#retrieveresult)\>

***

### SiteView

What a retriever stores about a link: the `site` field of the link.

#### Properties

##### facts

> **facts**: [`Fact`](#fact)[]

##### kind

> **kind**: [`SiteKind`](#sitekind)

##### retrieved\_at

> **retrieved\_at**: `string`

When the link was last retrieved successfully.

##### retriever

> **retriever**: [`RetrieverName`](#retrievername-1)

## Type Aliases

### RetrieveResult

> **RetrieveResult** = \{ `ok`: `true`; `value`: [`Retrieved`](#retrieved); \} \| \{ `failure`: [`RetrieverFailure`](#retrieverfailure); `ok`: `false`; \}

***

### RetrieverFailure

> **RetrieverFailure** = `"unreachable"` \| `"timed out"` \| `"rate limited"` \| `"key refused"` \| `"not found"` \| `"unusable answer"`

Why a retriever could not answer, as the link's history names it.

***

### RetrieverName

> **RetrieverName** = `"github"` \| `"youtube"`

The retrievers there are, by name.

***

### SiteKind

> **SiteKind** = `"repository"` \| `"issue"` \| `"pull_request"` \| `"video"`

What a retrieved link is.

## Functions

### parseSite()

> **parseSite**(`json`): [`SiteView`](#siteview) \| `null`

A stored `site` column read back; null for none or for anything unreadable.

#### Parameters

##### json

`string` \| `null` \| `undefined`

#### Returns

[`SiteView`](#siteview) \| `null`
