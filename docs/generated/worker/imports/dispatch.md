# worker/imports/dispatch

## Variables

### DISPATCH\_CRON

> `const` **DISPATCH\_CRON**: `"* * * * *"` = `'* * * * *'`

The cron trigger of the every-minute dispatch run (wrangler.jsonc).

***

### DISPATCH\_PER\_MINUTE

> `const` **DISPATCH\_PER\_MINUTE**: `20` = `20`

The most links a user's imports send to the fetch worker in any 60 seconds.

## Functions

### dispatchAllImports()

> **dispatchAllImports**(`env`): `Promise`\<`void`\>

The every-minute scheduled run: dispatches the waiting imported links of
every user, one user at a time, so that one user's failure does not stop
the others.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### dispatchImports()

> **dispatchImports**(`env`, `userId`): `Promise`\<`number`\>

Sends the user's waiting imported links to the fetch worker, earlier
imports first and each in line order, as many as the budget allows: 20 in
any 60 seconds, less the 'enrich all' jobs near now. A link deleted
meanwhile is gone from the import; one already sent by another action is
marked skipped and uses no budget. Each sent link records its time, and the
user's 'enrich all' starts no job within the next minute.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

#### Returns

`Promise`\<`number`\>
