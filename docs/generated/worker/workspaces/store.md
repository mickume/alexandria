# worker/workspaces/store

## Interfaces

### MemberCursor

Where a page of a workspace's links ends.

#### Properties

##### p

> **p**: `number`

***

### WorkspaceCursor

Where a page of the workspace list ends.

#### Properties

##### i

> **i**: `string`

##### k

> **k**: `string`

***

### WorkspaceRow

A workspace as stored, with its member count.

#### Properties

##### created\_at

> **created\_at**: `string`

##### description

> **description**: `string`

##### id

> **id**: `string`

##### link\_count

> **link\_count**: `number`

##### name

> **name**: `string`

##### name\_key

> **name\_key**: `string`

##### note

> **note**: `string`

##### user\_id

> **user\_id**: `string`

***

### WorkspaceSummary

A workspace as the API shows it in a list: without its note.

#### Properties

##### created\_at

> **created\_at**: `string`

##### description

> **description**: `string`

##### id

> **id**: `string`

##### link\_count

> **link\_count**: `number`

##### name

> **name**: `string`

## Type Aliases

### AddMemberOutcome

> **AddMemberOutcome** = \{ `position`: `number`; `status`: `"added"` \| `"moved"` \| `"unchanged"`; \} \| \{ `status`: `"no_link"`; \}

What adding a link to a workspace did.

***

### SaveOutcome

> **SaveOutcome** = \{ `ok`: `true`; `row`: [`WorkspaceRow`](#workspacerow); \} \| \{ `error`: `"name_taken"` \| `"workspace_limit"` \| `"not_found"`; `ok`: `false`; \}

What creating or renaming a workspace did.

***

### WorkspaceView

> **WorkspaceView** = [`WorkspaceSummary`](#workspacesummary) & `object`

A workspace as the API shows it on its own: with its note.

#### Type Declaration

##### note

> **note**: `string`

## Variables

### DESCRIPTION\_MAX

> `const` **DESCRIPTION\_MAX**: `1000` = `1_000`

***

### NAME\_MAX

> `const` **NAME\_MAX**: `100` = `100`

***

### WORKSPACE\_LIMIT

> `const` **WORKSPACE\_LIMIT**: `200` = `200`

The most workspaces one user may hold.

## Functions

### addMember()

> **addMember**(`db`, `userId`, `workspaceId`, `linkId`, `position?`): `Promise`\<[`AddMemberOutcome`](#addmemberoutcome)\>

Adds one of the user's links to one of their workspaces, or moves it there:
without a position a new member goes to the bottom and an existing one
stays; with a position (1-based, past the end meaning the end) the link is
placed there and the others keep their order. Positions stay 1..n in one
transaction. The workspace must be the user's.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### workspaceId

`string`

##### linkId

`string`

##### position?

`number`

#### Returns

`Promise`\<[`AddMemberOutcome`](#addmemberoutcome)\>

***

### createWorkspace()

> **createWorkspace**(`db`, `userId`, `name`, `description`): `Promise`\<[`SaveOutcome`](#saveoutcome)\>

Creates a workspace with an empty note and no members, within the user's limit.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### name

`string`

##### description

`string`

#### Returns

`Promise`\<[`SaveOutcome`](#saveoutcome)\>

***

### deleteWorkspace()

> **deleteWorkspace**(`db`, `userId`, `id`): `Promise`\<`boolean`\>

Deletes a workspace and its memberships, never its links. False when there is no such workspace.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

***

### getWorkspace()

> **getWorkspace**(`db`, `userId`, `id`): `Promise`\<[`WorkspaceRow`](#workspacerow) \| `null`\>

One of the user's workspaces, or null.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`Promise`\<[`WorkspaceRow`](#workspacerow) \| `null`\>

***

### isMemberCursor()

> **isMemberCursor**(`value`): `value is MemberCursor`

#### Parameters

##### value

`unknown`

#### Returns

`value is MemberCursor`

***

### isWorkspaceCursor()

> **isWorkspaceCursor**(`value`): `value is WorkspaceCursor`

#### Parameters

##### value

`unknown`

#### Returns

`value is WorkspaceCursor`

***

### leaveAllWorkspaces()

> **leaveAllWorkspaces**(`db`, `linkId`): `D1PreparedStatement`[]

The statements that take a link out of every workspace it is in, closing
each gap; part of deleting the link.

#### Parameters

##### db

`D1Database`

##### linkId

`string`

#### Returns

`D1PreparedStatement`[]

***

### listWorkspaces()

> **listWorkspaces**(`db`, `userId`, `limit`, `after`): `Promise`\<\{ `items`: [`WorkspaceRow`](#workspacerow)[]; `next`: [`WorkspaceCursor`](#workspacecursor) \| `null`; \}\>

One page of the user's workspaces by name ignoring case, and the cursor of the next.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### limit

`number`

##### after

[`WorkspaceCursor`](#workspacecursor) \| `null`

#### Returns

`Promise`\<\{ `items`: [`WorkspaceRow`](#workspacerow)[]; `next`: [`WorkspaceCursor`](#workspacecursor) \| `null`; \}\>

***

### nameKey()

> **nameKey**(`name`): `string`

The key names are compared by: trimmed and lower-cased.

#### Parameters

##### name

`string`

#### Returns

`string`

***

### removeMember()

> **removeMember**(`db`, `workspaceId`, `linkId`): `Promise`\<`boolean`\>

Removes a link from one workspace, closing the gap; false when it was not a member.

#### Parameters

##### db

`D1Database`

##### workspaceId

`string`

##### linkId

`string`

#### Returns

`Promise`\<`boolean`\>

***

### toSummary()

> **toSummary**(`row`): [`WorkspaceSummary`](#workspacesummary)

#### Parameters

##### row

[`WorkspaceRow`](#workspacerow)

#### Returns

[`WorkspaceSummary`](#workspacesummary)

***

### toWorkspaceView()

> **toWorkspaceView**(`row`): [`WorkspaceView`](#workspaceview)

#### Parameters

##### row

[`WorkspaceRow`](#workspacerow)

#### Returns

[`WorkspaceView`](#workspaceview)

***

### updateWorkspace()

> **updateWorkspace**(`db`, `userId`, `id`, `changes`): `Promise`\<[`SaveOutcome`](#saveoutcome)\>

Changes a workspace's name, description or note; the members stay as they are.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

##### changes

###### description?

`string`

###### name?

`string`

###### note?

`string`

#### Returns

`Promise`\<[`SaveOutcome`](#saveoutcome)\>
