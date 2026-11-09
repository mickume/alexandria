# worker/account/deletion

## Variables

### DELETION\_BATCH

> `const` **DELETION\_BATCH**: `1000` = `1_000`

The most rows one statement, or objects one R2 call, of the deletion job removes.

***

### deletionHooks

> `const` **deletionHooks**: `object`

Test hooks of the deletion job: told the size of every batch it deletes.

#### Type Declaration

##### onBatch

> **onBatch**: (`_size`) => `void`

###### Parameters

###### \_size

`number`

###### Returns

`void`

## Functions

### accountActive()

> **accountActive**(`db`, `userId`): `Promise`\<`boolean`\>

Whether background work may run for this account: it exists and is not
marked for deletion. Fetch, enrichment, import, liveness and decay work
for any other account writes nothing and calls no one.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<`boolean`\>

***

### beingDeleted()

> **beingDeleted**(`db`, `email`): `Promise`\<`boolean`\>

Whether the account with this email is marked for deletion: a sign-in for
it is refused until the deletion job has removed it.

#### Parameters

##### db

`D1Database`

##### email

`string`

#### Returns

`Promise`\<`boolean`\>

***

### continueDeletion()

> **continueDeletion**(`env`, `userId`): `Promise`\<`void`\>

Runs the deletion job once for the account and queues the next run when one is needed.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### handleAccountBatch()

> **handleAccountBatch**(`batch`, `env`): `Promise`\<`void`\>

The ACCOUNT_QUEUE consumer: one run of the job per message. A failed run is
retried and continues with what remains; what it removed stays removed.

#### Parameters

##### batch

`MessageBatch`\<[`AccountMessage`](../env.md#accountmessage)\>

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### requestDeletion()

> **requestDeletion**(`c`): `Promise`\<`Response`\>

DELETE /api/v1/me: the owner, signed in with a session, deletes the account
by typing its email (compared ignoring case and surrounding whitespace).
Every session and token and the AI key go at once, the account is marked
and its deletion job queued; the session cookie is cleared.

#### Parameters

##### c

`Context`\<[`AppEnv`](../env.md#appenv)\>

#### Returns

`Promise`\<`Response`\>

***

### runDeletion()

> **runDeletion**(`env`, `userId`): `Promise`\<`"skipped"` \| `"done"` \| `"more"`\>

One run of an account's deletion job: one batch of its stored objects, then
one batch from each table holding its rows (rows referencing its links
first, then its links, then the rest), and, when nothing is left, the user
row. 'more' when the run should be followed by another; 'done' when the
account is gone; 'skipped' when there is no account marked for deletion
with this id (already removed, or never marked).

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

#### Returns

`Promise`\<`"skipped"` \| `"done"` \| `"more"`\>
