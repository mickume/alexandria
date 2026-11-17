# worker/retrievers/github

## Type Aliases

### GitHubClaim

> **GitHubClaim** = \{ `kind`: `"repository"`; `owner`: `string`; `repo`: `string`; \} \| \{ `kind`: `"issue"`; `number`: `number`; `owner`: `string`; `repo`: `string`; \}

What the GitHub retriever retrieves for an address.

## Variables

### github

> `const` **github**: [`Retriever`](retriever.md#retriever)\<[`GitHubClaim`](#githubclaim)\>

## Functions

### claimGitHub()

> **claimGitHub**(`url`): [`GitHubClaim`](#githubclaim) \| `null`

The address of an owner's repository, an issue or a pull request; null for any other.

#### Parameters

##### url

`URL`

#### Returns

[`GitHubClaim`](#githubclaim) \| `null`
