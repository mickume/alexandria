# worker/decay/decay

## Variables

### decayHooks

> `const` **decayHooks**: `object` = `{}`

Test seams of the evaluation, as the clock is one.

#### Type Declaration

##### afterSelect?

> `optional` **afterSelect?**: (`userId`) => `Promise`\<`void`\>

###### Parameters

###### userId

`string`

###### Returns

`Promise`\<`void`\>

## Functions

### evaluateDecay()

> **evaluateDecay**(`env`, `userId`): `Promise`\<`void`\>

Evaluates decay for one user at the current time: expiry, removal and the
user's last_decay_at, all in one transaction, so that an evaluation that
fails changes nothing. The stored objects of the removed links are deleted
after the transaction.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### expiryStatement()

> **expiryStatement**(`db`, `userId`, `t`): `D1PreparedStatement`

The statement that expires, at time `t`, every link of the user whose
points are 0 or below, that is active, pending or unreachable, not pinned
and in no workspace. Points reach 0 once the whole days since the decay
start reach the start points plus the use count. The statement carries its own
conditions, so a link used or re-pasted meanwhile is left as the use left it.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### t

`Date`

#### Returns

`D1PreparedStatement`
