# worker/fetcher/titles

## Interfaces

### TitleRule

One rule, ready to apply.

#### Properties

##### hosts

> **hosts**: `string`[]

##### remove

> **remove**: `RegExp`[]

## Functions

### applyTitleRules()

> **applyTitleRules**(`env`, `file?`): `Promise`\<`number`\>

Cleans the titles already stored, once for each version of the rules: when
the hash of the rules file differs from the one recorded in
title_rules_state, every link's title is cleaned (except a title the owner
edited), the links whose title changes are marked as changed, and the new
hash is recorded. A run that fails records nothing, and the next one starts
again; cleaning a title twice changes nothing more. Returns how many titles
changed.

#### Parameters

##### env

[`Env`](../env.md#env)

##### file?

`unknown` = `rulesFile`

#### Returns

`Promise`\<`number`\>

***

### cleanTitle()

> **cleanTitle**(`title`, `url`, `rules?`): `string`

`title` cleaned by the rules whose hosts cover `url`'s host (the host
itself or a subdomain of it): every match of their patterns removed, in
order, then runs of whitespace made one space and the ends trimmed. A title
the rules would leave empty is kept as it is.

#### Parameters

##### title

`string`

##### url

`string`

##### rules?

[`TitleRule`](#titlerule)[] = `TITLE_RULES`

#### Returns

`string`

***

### compileTitleRules()

> **compileTitleRules**(`file`): [`TitleRule`](#titlerule)[]

The rules of a rules file's content, compiled. Throws on a file that does
not have the expected shape or holds an invalid regular expression, so that
a broken rules file fails the Worker's start, and with it the deploy, rather
than titles.

#### Parameters

##### file

`unknown`

#### Returns

[`TitleRule`](#titlerule)[]
