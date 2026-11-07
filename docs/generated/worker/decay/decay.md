# worker/decay/decay

## Variables

### STICKY

> `const` **STICKY**: "(\\n  (SELECT COUNT(\*) FROM link\_uses u WHERE u.link\_id = l.id) \>= 5\\n  AND (SELECT COUNT(DISTINCT substr(u.at, 1, 10)) FROM link\_uses u WHERE u.link\_id = l.id) \>= 5\\n)"

The SQL condition that a link `l` is sticky: at least 5 uses on at least 5 distinct UTC days.

## Functions

### decayStatements()

> **decayStatements**(`db`, `userId`, `t`): `Promise`\<`D1PreparedStatement`[]\>

The statements of one user's decay evaluation at time `t`, each carrying its
own conditions so that a link boosted meanwhile is left as the boost left
it: sticky dormant links become active again; active links unused for
dormant_days that are not sticky become dormant; links unused for
archive_days that are neither sticky, pinned nor in a workspace are
archived.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### t

`Date`

#### Returns

`Promise`\<`D1PreparedStatement`[]\>

***

### evaluateDecay()

> **evaluateDecay**(`env`, `userId`): `Promise`\<`void`\>

Evaluates decay for one user at the current time, in one transaction.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

#### Returns

`Promise`\<`void`\>
