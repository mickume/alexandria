# worker/fetcher/sweep

## Variables

### LEGACY\_SWEEP

> `const` **LEGACY\_SWEEP**: `"legacy_snapshots"` = `'legacy_snapshots'`

The name of the one-time job that removes the copies fetches stored before snapshots.

## Functions

### sweepLegacySnapshots()

> **sweepLegacySnapshots**(`env`): `Promise`\<`number`\>

Removes the raw HTML and the reader views fetches stored before snapshots,
a few pages of SNAPSHOTS per run, from where the last run stopped, until it
has been through the whole bucket once. A run that fails part-way leaves
the cursor of the last page it finished, and the next run goes on from
there. Returns how many objects it removed.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`number`\>
