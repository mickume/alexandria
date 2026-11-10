# Dampen the boost a use gives a link

## Intent

A use of a link today gives back every point the link has lost, so a link one day from expiring jumps to the top of the stream as if it were new. One use says the link still matters, but less than a link used steadily. This change makes a use win back a share of the points a link has lost instead of all of them. A link that has lost few points returns close to the top, and a link close to expiry gets a reprieve and a place in the middle of the stream. Each further use moves it higher.

## Goals

- A use of a link wins back `use_boost` percent of the days the link has decayed (default 50), not all of them. With `start_points` 60 and `use_boost` 50, a link used 5 times that has decayed 62 days has 3 points. After one more use it has 60 + 6 − 31 = 35 points, where today it would have 66.
- Points stay computed from values the API returns: `start_points + use_count − whole days since decay_from`. The new link field `decay_from` is the time decay counts from. `last_used_at` keeps meaning the time of the last use or boost.
- Only the first use of a link on a UTC day wins points back. Later uses that day add 1 to `use_count` and nothing else.
- A re-paste, a restore and an unarchive still give back every lost point, as they do today.
- The owner can set `use_boost` from 10 to 100 on the Settings page. At 100, a use behaves exactly as it does today.
- On deploy, no link's points change.

## Non-goals

- Storing points, or recomputing them on a schedule. Points stay computed when read, as package 13 decided.
- Making a use's boost depend on the link's age since it was added, on the kind of use (open, read, snapshot view, MCP open), or on the link's use count.
- Changing how the stream orders links (pinned, then points descending, then `last_used_at` descending, then id descending), or how searches with free words are ranked.
- Changing expiry, removal or the `decay_note` sentences. They follow the new points with no change of their own.
- Showing `decay_from` on the link card. The card keeps "Used <when>" from `last_used_at`.
- Changing the statistics page (packages 18 and 19). It reads points through `pointsAt`, so it follows the new points without a change of its own.

## Background

Points come from package 13 (`13_points_and_expiry`, sealed), and package 14 (`14_keep_links_in_archive`, active) added the archive. Points are never stored. `pointsAt` in `src/worker/decay/note.ts` computes them as `start_points + use_count − whole 24-hour periods since last_used_at`, and two SQL expressions compute them the same way: `POINTS_AT` in `src/worker/links/stream.ts`, which orders the stream, and `expiryStatement` in `src/worker/decay/decay.ts`, which expires links at 0 points or below. Package 18 (`18_show_library_statistics`) counts links by points through `pointsAt`.

Every use (an open, a read, a snapshot view, an MCP open) goes through `recordUse` in `src/worker/links/use.ts`. It adds 1 to `use_count`, sets `last_used_at` to now, makes an expired link `active` and writes a `link_uses` row. So every use gives back every lost point, and the link's points become `start_points + use_count`. Three boosts set `last_used_at` to now without a use: the re-paste (`addStatement` in `src/worker/links/store.ts`), restore (`POST /api/v1/links/{id}/restore`) and unarchive (`POST /api/v1/links/{id}/unarchive`), both in `src/worker/decay/archive.ts`. A new link, whether added or imported (`src/worker/imports/imports.ts`), starts with `last_used_at` set to the time it was added or imported.

`last_used_at` has other readers besides points. The link card shows "Used <when>" from it, the stream breaks ties between equal points with it, searches order by it, and packages 18 and 19 describe it as the last use. So decay cannot simply move `last_used_at` back.

The decay settings are `start_points` (default 60) and `remove_days` (default 180). `GET` and `PUT /api/v1/settings/decay` serve them (`src/worker/decay/routes.ts`), and the Settings page edits them in `DecaySection` (`src/web/pages/DecaySection.tsx`). Today the help text of "Start points" reads "Points a link starts with and goes back to when used, plus one per use; it loses one a day".

## Requirements

### Decay start and points

- Every link has `decay_from`, a timestamp the API returns on every link (in the same form as `last_used_at`; for an archived link too).
- A link's points at time t are `start_points + use_count − max(0, whole 24-hour periods from decay_from to t)`. `pointsAt`, the stream's order, the expiry run and every place that shows points use this one formula. An archived link still has `points: null`.
- A new link, added or imported, has `decay_from` equal to its `last_used_at`.

### A use

- When a use of a link is recorded at time t, and the link's `last_used_at` before the use falls on an earlier UTC day than t:
  - `use_count` goes up by 1 and `last_used_at` becomes t, as today;
  - `decay_from` moves forward by `use_boost` percent of the time from `decay_from` to t: `decay_from' = decay_from + (t − decay_from) × use_boost / 100`, rounded down to the millisecond. At `use_boost` 100, `decay_from` becomes t.
- When the link's `last_used_at` before the use falls on the same UTC day as t, `use_count` goes up by 1 and `last_used_at` becomes t, but `decay_from` does not change. The link's points go up by exactly 1.
- A use of an expired link makes it `active` at once, as today. It also sets `decay_from` to t, whatever `use_boost` is and whatever day the link was last used. Its points become `start_points + use_count`, as a restore makes them.
- A use of an archived link follows the same rule. Its points stay null while it is archived, and an unarchive resets `decay_from` anyway.
- A pinned link and a link in a workspace follow the same rule as any other link.
- Example (start_points 60, use_boost 50): link A has 5 uses and `decay_from` 6 days ago, so 59 points. After a use it has 6 uses and `decay_from` 3 days ago: 63 points. Link B has 5 uses and `decay_from` 62 days ago, so 3 points. After a use it has 6 uses and `decay_from` 31 days ago: 35 points. Opened again a minute later, the same UTC day, B has 36 points.

### Boosts

- A re-paste of an existing link, a restore of an expired link and an unarchive of an archived link set both `last_used_at` and `decay_from` to now. The link's points become `start_points + use_count`, as today.
- Archiving a link does not change `decay_from`.

### The setting

- `GET /api/v1/settings/decay` answers `200 {"start_points": 60, "remove_days": 180, "use_boost": 50}` with the owner's values (defaults shown).
- `PUT /api/v1/settings/decay` takes all three fields. `use_boost` must be a whole number from 10 to 100. `start_points` and `remove_days` keep their range of 7 to 3650.
  - A `use_boost` that is missing, not a whole number, or outside 10 to 100 is refused with `400 {"error": "invalid_threshold", "field": "use_boost", "message": "use_boost must be a whole number from 10 to 100"}`, and nothing is stored.
  - The other refusals are unchanged.
- A change to `use_boost` applies to uses recorded after the change. It does not move any link's `decay_from`, so no link's points change when it is saved.
- The Settings page shows a third field, "Use boost (%)", with the help text "Share of the points a link has lost that a use wins back, once a day. At 100, a use gives back all of them." A refusal is shown beside the field, as the other two show theirs. The help text of "Start points" becomes "Points a link starts with, plus one per use. It loses one a day."
- The account export (`src/worker/account/export.ts`) carries no settings today, and does not carry `use_boost`. Each exported link carries `decay_from`, as every link the API returns does.

### Changing existing data

- When the change is deployed, every link's `decay_from` is set to its `last_used_at`, and every owner's `use_boost` is set to 50. No link's points change on deploy, and no link expires because of the deploy.

### End-to-end flows

1. With `start_points` 60 and `use_boost` 50, the owner has link A (5 uses, `decay_from` 6 days ago) and link B (5 uses, `decay_from` 62 days ago, so 3 points, listed below A). The owner opens B from the stream. B's card shows "expires in 35 days", and the stream lists B below A, where today it would list B first. The owner opens B again the same day. Its card shows "expires in 36 days".
2. The owner sets "Use boost (%)" to 100 on the Settings page and saves. They open a link that has decayed 20 days. Its points become `start_points + use_count`, and the stream lists it at the top of the unpinned links.
3. The owner sets "Use boost (%)" to 5 and saves. The field shows "use_boost must be a whole number from 10 to 100", and `GET /api/v1/settings/decay` still answers the previous value.

## Design Decisions

1. **A use wins back a share of the decayed time, not all of it.** This is the owner's decision. A link close to expiry gets a reprieve without jumping above links in steady use, and repeated uses still bring it back to the top.
2. **The share comes from the time decayed, not from the link's age since it was added.** This is the owner's decision. Scaling by age would stop an old link in steady use from ever reaching the top, and "close to expiry" means time decayed.
3. **Decay counts from a new field, `decay_from`. `last_used_at` keeps its meaning.** The card, the stream's tie-break, the searches and the statistics packages read `last_used_at` as the time of the last use.
4. **Points stay computed, and `decay_from` is returned by the API.** This keeps package 13's decision: the owner can see why a link has its points, from `start_points`, `use_count` and `decay_from`.
5. **`use_boost` is an owner setting, from 10 to 100, default 50.** This is the owner's decision. At 100 the owner gets today's behaviour back, and 10 is the floor, because below it a use would barely count.
6. **Only the first use of a link on a UTC day wins points back. Later uses that day add 1 to the use count.** This is the owner's decision. An open followed by a read are two uses of one visit, and they must not compound to 75%. Package 05 already counted days in UTC.
7. **Re-paste, restore and unarchive keep the full reset.** This is the owner's decision. They are deliberate actions, and a restore of a link that expired long ago would otherwise bring it back at 0 points or below, to expire again at the next run.
8. **A use of an expired link resets its decay in full.** This is the owner's decision. It is a deliberate retrieval, like a restore. The dampened rule would leave it at 0 points or below, so it would expire again at the next run.
9. **A change to `use_boost` applies to later uses only.** Moving every link's `decay_from` when the setting changes would rewrite history the owner cannot see.

## Dependencies

- `13_points_and_expiry` (sealed): its points formula and its rule that a use resets points. This PRD supersedes that rule.
- `14_keep_links_in_archive` (active, all tasks done): unarchive resets `decay_from`.
- `05_decay_and_liveness` (active, all tasks done): the decay settings routes and `DecaySection`.
- `01_accounts_links_and_stream` (active, all tasks done): `recordUse` and the re-paste.
- `07_bulk_import` (active, all tasks done): imported links start with `decay_from`.
- `18_show_library_statistics` (active, 2 of 7 tasks done) and `19_record_daily_activity` (active, 0 of 8 done): they read points through `pointsAt` and are not changed. They do not block this work.

## Glossary

- **decay start** (`decay_from`): the time a link's decay counts from. Its points are `start_points + use_count` minus the whole days since then. A boost sets it to now, and so does a use of an expired link. Any other first use on a UTC day moves it forward by `use_boost` percent of the time since.
- **use boost** (`use_boost`): the owner's setting, from 10 to 100 (default 50), for the share of decayed time that the first use of a link on a UTC day wins back.
- **use**, **boost**, **points**, **start points**: as package 13 defines them, except that a use no longer resets points.
