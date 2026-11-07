# worker/api/errors

## Functions

### limitReached()

> **limitReached**(`c`, `error`, `message`): `Response`

409: a limit of the user's library or account is reached.

#### Parameters

##### c

`Context`

##### error

`string`

##### message

`string`

#### Returns

`Response`

***

### notFound()

> **notFound**(`c`): `Response`

404: no such resource for this user, whether it exists for another or not at all.

#### Parameters

##### c

`Context`

#### Returns

`Response`

***

### readJson()

> **readJson**(`c`): `Promise`\<\{ `body`: `Record`\<`string`, `unknown`\>; `ok`: `true`; \} \| \{ `ok`: `false`; `response`: `Response`; \}\>

The parsed JSON body of a request, or the 400 invalid_json answer when it does not parse.

#### Parameters

##### c

`Context`

#### Returns

`Promise`\<\{ `body`: `Record`\<`string`, `unknown`\>; `ok`: `true`; \} \| \{ `ok`: `false`; `response`: `Response`; \}\>

***

### refusal()

> **refusal**(`c`, `status`, `error`, `message?`): `Response`

Any other refusal with a code and a message.

#### Parameters

##### c

`Context`

##### status

`ContentfulStatusCode`

##### error

`string`

##### message?

`string`

#### Returns

`Response`

***

### unauthorized()

> **unauthorized**(`c`): `Response`

401: no valid credentials.

#### Parameters

##### c

`Context`

#### Returns

`Response`

***

### validationError()

> **validationError**(`c`, `error`, `field`, `message`, `extra?`): `Response`

400: a request field is missing or not acceptable.

#### Parameters

##### c

`Context`

##### error

`string`

##### field

`string` \| `null`

##### message

`string`

##### extra?

`Record`\<`string`, `unknown`\> = `{}`

#### Returns

`Response`
