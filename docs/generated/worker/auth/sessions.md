# worker/auth/sessions

## Variables

### SESSION\_COOKIE

> `const` **SESSION\_COOKIE**: `"alexandria_session"` = `'alexandria_session'`

The cookie that carries the website's session.

***

### SESSION\_TTL\_SECONDS

> `const` **SESSION\_TTL\_SECONDS**: `number`

A session lasts this long after its last use.

## Functions

### createSession()

> **createSession**(`db`, `userId`): `Promise`\<`string`\>

Creates a session for `userId` and returns its identifier, which is stored only as a hash.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<`string`\>

***

### upsertUser()

> **upsertUser**(`db`, `email`, `name`): `Promise`\<`string`\>

Creates the user on first sign-in, or updates the stored display name, and returns the user's id.

#### Parameters

##### db

`D1Database`

##### email

`string`

##### name

`string`

#### Returns

`Promise`\<`string`\>
