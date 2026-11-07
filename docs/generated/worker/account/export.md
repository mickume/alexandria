# worker/account/export

## Functions

### exportResponse()

> **exportResponse**(`env`, `user`): `Response`

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

#### Returns

`Response`

***

### hasReader()

> **hasReader**(`row`): `boolean`

Whether a link has a reader view to serve: a PDF's text, or a page's non-empty reader view.

#### Parameters

##### row

[`LinkRow`](../links/store.md#linkrow)

#### Returns

`boolean`
