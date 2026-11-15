# worker/account/export

## Functions

### exportLinkBase()

> **exportLinkBase**(`origin`, `id`): `string`

The address of a link under the export, the base of its content routes.

#### Parameters

##### origin

`string`

##### id

`string`

#### Returns

`string`

***

### exportResponse()

> **exportResponse**(`env`, `user`, `origin`): `Response`

The export as a download: the user's email and name, every link (its API
representation with its content URLs), workspaces, topics and tags, and
finally "complete": true. It is sent as it is read; a failure part-way
errors the stream, so a cut-off download never ends as a complete export.
Nothing else of the user is in it: no settings, key, token, session or import.

#### Parameters

##### env

[`Env`](../env.md#env)

##### user

[`AuthUser`](../env.md#authuser)

##### origin

`string`

#### Returns

`Response`

***

### hasText()

> **hasText**(`row`): `boolean`

Whether a link has article text stored: a web page with an article, or a PDF with text.

#### Parameters

##### row

[`LinkRow`](../links/store.md#linkrow)

#### Returns

`boolean`
