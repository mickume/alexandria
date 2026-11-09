# worker/meaning/indexing

## Variables

### IS\_STALE

> `const` **IS\_STALE**: "NOT EXISTS (\\n  SELECT 1 FROM link\_passages p WHERE p.link\_id = l.id AND p.version = COALESCE(s.text\_version, 0))"

The condition, on a link `l` left-joined with its `link_index_state` row
`s`, that the link is stale: no passage of it was made from its current
text version.

## Functions

### handleIndexBatch()

> **handleIndexBatch**(`batch`, `env`): `Promise`\<`void`\>

The INDEX_QUEUE consumer: one link per message, handed back for retry when it fails.

#### Parameters

##### batch

`MessageBatch`\<[`IndexMessage`](../env.md#indexmessage)\>

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### indexLink()

> **indexLink**(`env`, `message`): `Promise`\<`void`\>

Indexes one link: cuts its text into passages, embeds them, stores their
vectors in its owner's namespace and the passages in D1, replacing those of
older text. Nothing is written when the account is being deleted, the link
is gone or its passages are current. When the link is deleted or its text
changes while the job runs, the vectors it stored are queued for deletion
and the passages are left as they were. A failing Workers AI or Vectorize
throws, before anything is written to D1.

#### Parameters

##### env

[`Env`](../env.md#env)

##### message

[`IndexMessage`](../env.md#indexmessage)

#### Returns

`Promise`\<`void`\>

***

### queueIndexing()

> **queueIndexing**(`env`, `userId`, `linkIds`): `Promise`\<`void`\>

Queues the stale ones among the user's links for indexing, after a write
that may have changed their text. A failure is logged and never fails the
write: the links stay stale and the backfill picks them up.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkIds

`string`[]

#### Returns

`Promise`\<`void`\>

***

### sendIndexMessages()

> **sendIndexMessages**(`env`, `userId`, `linkIds`): `Promise`\<`void`\>

Sends one index message for each of the user's links and records when they
were queued, so that the backfill leaves them alone for a while. The links
must exist.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkIds

`string`[]

#### Returns

`Promise`\<`void`\>
