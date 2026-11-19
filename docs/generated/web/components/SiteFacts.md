# web/components/SiteFacts

## Functions

### CardFacts()

> **CardFacts**(`__namedParameters`): `Element`

The facts a link's card shows, at most 3, each as one item of the card's facts line.

#### Parameters

##### \_\_namedParameters

###### link

[`Link`](../api.md#link-1)

#### Returns

`Element`

***

### siteName()

> **siteName**(`site`): `string`

The name of the site a link was retrieved from, such as "GitHub".

#### Parameters

##### site

[`SiteView`](../../worker/retrievers/retriever.md#siteview)

#### Returns

`string`

***

### SiteSection()

> **SiteSection**(`__namedParameters`): `Element`

The detail page's section of what a retriever stored: the site's
description of the link, every fact by its label, the thumbnail as an
image, and when the link was retrieved.

#### Parameters

##### \_\_namedParameters

###### description

`string` \| `null`

###### site

[`SiteView`](../../worker/retrievers/retriever.md#siteview)

#### Returns

`Element`
