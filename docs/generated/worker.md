# worker

## Variables

### default

> **default**: `object`

#### Type Declaration

##### fetch()

> **fetch**(`request`, `env`, `ctx`): `Response` \| `Promise`\<`Response`\>

###### Parameters

###### request

`Request`\<`unknown`, `IncomingRequestCfProperties`\<`unknown`\>\>

###### env

[`Env`](worker/env.md#env)

###### ctx

`ExecutionContext`\<`unknown`\>

###### Returns

`Response` \| `Promise`\<`Response`\>

##### queue()

> **queue**(`batch`, `env`, `ctx`): `Promise`\<`void`\>

###### Parameters

###### batch

`MessageBatch`\<[`FetchMessage`](worker/env.md#fetchmessage) \| [`EnrichMessage`](worker/env.md#enrichmessage) \| [`LivenessMessage`](worker/env.md#livenessmessage)\>

###### env

[`Env`](worker/env.md#env)

###### ctx

`ExecutionContext`\<`unknown`\>

###### Returns

`Promise`\<`void`\>

##### scheduled()

> **scheduled**(`controller`, `env`, `ctx`): `void`

###### Parameters

###### controller

`ScheduledController`

###### env

[`Env`](worker/env.md#env)

###### ctx

`ExecutionContext`\<`unknown`\>

###### Returns

`void`

## References

### HostGate

Re-exports [HostGate](worker/fetcher/hostgate.md#hostgate)
