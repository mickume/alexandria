# worker/enrich/providers

## Interfaces

### AnswerRequest

What a streamed answer is asked: the instruction, and the passages and question.

#### Properties

##### maxTokens?

> `optional` **maxTokens?**: `number`

The most tokens the answer may hold; ANSWER_MAX_TOKENS when not given.

##### prompt

> **prompt**: `string`

##### system

> **system**: `string`

***

### ProviderCall

The provider and credentials one call runs with: always the user's own.

#### Properties

##### apiKey

> **apiKey**: `string`

##### model

> **model**: `string`

##### provider

> **provider**: [`Provider`](keys.md#provider-1)

##### userId?

> `optional` **userId?**: `string`

The owner the call is made for: with it, the call's token usage is recorded.

## Type Aliases

### ProviderOutcome

> **ProviderOutcome**\<`T`\> = \{ `ok`: `true`; `value`: `T`; \} \| \{ `kind`: `"rejected"`; `message`: `string`; `ok`: `false`; `status`: `number`; \} \| \{ `kind`: `"unavailable"`; `message`: `string`; `ok`: `false`; \} \| \{ `kind`: `"failed"`; `message`: `string`; `ok`: `false`; \}

What a provider call came to.

#### Type Parameters

##### T

`T`

#### Union Members

##### Type Literal

\{ `ok`: `true`; `value`: `T`; \}

***

##### Type Literal

\{ `kind`: `"rejected"`; `message`: `string`; `ok`: `false`; `status`: `number`; \}

The key was refused: HTTP 401, 402 or 403, with the provider's message.

***

##### Type Literal

\{ `kind`: `"unavailable"`; `message`: `string`; `ok`: `false`; \}

The provider could not be reached, answered 5xx, or did not answer in time.

***

##### Type Literal

\{ `kind`: `"failed"`; `message`: `string`; `ok`: `false`; \}

Any other failure: a 4xx, a rate limit, a refusal, an unusable answer.

## Variables

### ANSWER\_MAX\_TOKENS

> `const` **ANSWER\_MAX\_TOKENS**: `1024` = `1_024`

The most tokens an answer to a question may hold, unless its request says otherwise.

***

### PROVIDER\_TIMEOUT\_MS

> `const` **PROVIDER\_TIMEOUT\_MS**: `60000` = `60_000`

How long a provider call may take before it is abandoned.

***

### RESULT\_SCHEMA

> `const` **RESULT\_SCHEMA**: `object`

The structured result asked of the model.

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.summary

> `readonly` **summary**: `object`

###### properties.summary.description

> `readonly` **description**: `"What the page is about, in at most 60 words."` = `'What the page is about, in at most 60 words.'`

###### properties.summary.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.tags

> `readonly` **tags**: `object`

###### properties.tags.description

> `readonly` **description**: `"1 to 5 lower-case tags: single words or hyphenated phrases."` = `'1 to 5 lower-case tags: single words or hyphenated phrases.'`

###### properties.tags.items

> `readonly` **items**: `object`

###### properties.tags.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.tags.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.topic

> `readonly` **topic**: `object`

###### properties.topic.description

> `readonly` **description**: "The path of the one topic the page belongs to: one to three names from the most general to the most specific, separated by \\" \> \\"." = `'The path of the one topic the page belongs to: one to three names from the most general to the most specific, separated by " > ".'`

###### properties.topic.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"summary"`, `"tags"`, `"topic"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### SPLIT\_SCHEMA

> `const` **SPLIT\_SCHEMA**: `object`

The structured result asked of the model for a topic's split: each
sub-topic with the numbers of its links in the request. Links are named by
short numbers rather than ids, and a link left out stays where it is, so
that the answer for 500 links stays a few thousand tokens.

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.subtopics

> `readonly` **subtopics**: `object`

###### properties.subtopics.description

> `readonly` **description**: `"The 2 to 10 sub-topics, each with the numbers of the links it holds."` = `'The 2 to 10 sub-topics, each with the numbers of the links it holds.'`

###### properties.subtopics.items

> `readonly` **items**: `object`

###### properties.subtopics.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.subtopics.items.properties

> `readonly` **properties**: `object`

###### properties.subtopics.items.properties.links

> `readonly` **links**: `object`

###### properties.subtopics.items.properties.links.description

> `readonly` **description**: `"The numbers of the links that belong under it."` = `'The numbers of the links that belong under it.'`

###### properties.subtopics.items.properties.links.items

> `readonly` **items**: `object`

###### properties.subtopics.items.properties.links.items.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.subtopics.items.properties.links.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.subtopics.items.properties.name

> `readonly` **name**: `object`

###### properties.subtopics.items.properties.name.description

> `readonly` **description**: `"The sub-topic’s name."` = `'The sub-topic’s name.'`

###### properties.subtopics.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.subtopics.items.required

> `readonly` **required**: readonly \[`"name"`, `"links"`\]

###### properties.subtopics.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.subtopics.type

> `readonly` **type**: `"array"` = `'array'`

##### required

> `readonly` **required**: readonly \[`"subtopics"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

## Functions

### enrichWith()

> **enrichWith**(`env`, `call`, `prompt`): `Promise`\<[`ProviderOutcome`](#provideroutcome)\<`unknown`\>\>

Asks the user's provider for a structured {summary, tags, topic} (RESULT_SCHEMA).

#### Parameters

##### env

[`Env`](../env.md#env)

##### call

[`ProviderCall`](#providercall)

##### prompt

`string`

#### Returns

`Promise`\<[`ProviderOutcome`](#provideroutcome)\<`unknown`\>\>

***

### setProviderTimeout()

> **setProviderTimeout**(`ms`): `void`

Shortens the provider timeout, for tests; null restores the 60 seconds.

#### Parameters

##### ms

`number` \| `null`

#### Returns

`void`

***

### splitWith()

> **splitWith**(`env`, `call`, `prompt`): `Promise`\<[`ProviderOutcome`](#provideroutcome)\<`unknown`\>\>

Asks the user's provider for a topic's split: {subtopics: [{name, links}]} (SPLIT_SCHEMA).

#### Parameters

##### env

[`Env`](../env.md#env)

##### call

[`ProviderCall`](#providercall)

##### prompt

`string`

#### Returns

`Promise`\<[`ProviderOutcome`](#provideroutcome)\<`unknown`\>\>

***

### streamAnswer()

> **streamAnswer**(`env`, `call`, `request`, `onText`): `Promise`\<[`ProviderOutcome`](#provideroutcome)\<`void`\>\>

Streams the user's provider's answer to a question, handing each piece of
text to `onText` as it arrives: through `messages.stream` of Anthropic's SDK,
and through OpenRouter's chat completions with `stream: true`. The whole
answer has the provider timeout, and a failure is sorted as enrichment's is.

#### Parameters

##### env

[`Env`](../env.md#env)

##### call

[`ProviderCall`](#providercall)

##### request

[`AnswerRequest`](#answerrequest)

##### onText

(`text`) => `void` \| `Promise`\<`void`\>

#### Returns

`Promise`\<[`ProviderOutcome`](#provideroutcome)\<`void`\>\>

***

### testKey()

> **testKey**(`env`, `call`): `Promise`\<[`ProviderOutcome`](#provideroutcome)\<`void`\>\>

Sends one minimal completion with the user's key and model, to see whether the provider accepts them.

#### Parameters

##### env

[`Env`](../env.md#env)

##### call

[`ProviderCall`](#providercall)

#### Returns

`Promise`\<[`ProviderOutcome`](#provideroutcome)\<`void`\>\>
