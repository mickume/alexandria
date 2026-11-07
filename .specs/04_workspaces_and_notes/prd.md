---
spec_id: "04"
spec_name: "workspaces_and_notes"
title: "Gather links into ordered workspaces with Markdown notes"
status: "active"
created_at: "2026-11-07T14:22:15Z"
intent_hash: "7d75e19cd70996120d400cbd3edf5fa0449a12a6e05181113c5ed9b9945992da"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Gather links into ordered workspaces with Markdown notes

## Intent

Alexandria's stream holds everything; project work needs a smaller, deliberate set. This package lets the owner gather any links of their library into named, manually ordered workspaces, each carrying a Markdown note, and lets every link carry a Markdown note of its own, so that a project's links, their order and the owner's thinking about them live together. A link may be in any number of workspaces, and a workspace never owns the links it holds: deleting it keeps every link.

## Goals

- Links are grouped manually into workspaces; a link can be in any number of workspaces.
- A workspace page shows its links in the owner's order: a newly added link goes to the bottom, and the owner reorders by drag on the website or with an explicit `position` on the API.
- A workspace carries one Markdown note shown above its links, and every link carries one Markdown note shown on its detail view and, as a first line, on its card; each is up to 20,000 characters and is rendered with scripts and raw HTML stripped.
- The stream card shows the workspaces a link is in.
- Every workspace capability of the website is available through the HTTP API with a personal access token, with the same per-user isolation as the rest of the library.

## Non-goals

- Including notes in search, and the `in:workspace-name` search filter: package 06 (`search_and_browse`).
- Exempting workspace members from decay archiving: package 05 (`decay_and_liveness`) applies the exemption by reading this package's membership.
- The MCP tools `list_workspaces` and `add_to_workspace`: package 08 (`mcp_server`).
- Workspaces in the export and their removal on account deletion: package 09 (`export_and_account_deletion`).
- Sharing a workspace, public workspace pages, or any cross-user feature.
- Nested workspaces, workspace ordering by the owner, or workspace icons and colours.

## Background

Package 01 (`accounts_links_and_stream`) creates the project: the Hono Worker in `src/worker/` with its D1 database (`users`, `sessions`, `tokens`, `links`, `link_uses`), the authentication middleware, the error envelope and cursor pagination in `src/worker/api/`, the OpenAPI document kept in step with the routes by a test, the link store and routes in `src/worker/links/` (stream order, pin positions 1..n, `DELETE /api/v1/links/{id}`), and the React website in `src/web/` with the Stream, LinkDetail and Settings pages, the `LinkCard` component, and the shared test helpers `src/worker/test/helpers.ts` and `src/web/test/helpers.tsx`. There is no workspace and no note anywhere yet; every component this package names under `src/worker/workspaces/` and the Workspaces, Workspace and Markdown website files are new.

## Requirements

### Workspaces

- A user can create workspaces (name, up to 100 characters, unique per user, optional one-paragraph description), rename and delete them, and add or remove any link to or from any number of workspaces. Deleting a workspace never deletes its links. At most 200 workspaces per user.
- A workspace page shows its links in manual order: a newly added link goes to the bottom, and the user reorders by drag on the website or with an explicit `position` on the API.
- Notes: a workspace carries one Markdown note (shown above its links) and every link carries one Markdown note (shown on its detail view and, as a first line, on its card); each is up to 20,000 characters, rendered as Markdown with scripts and raw HTML stripped, editable in place. A note over the limit is refused with "note too long (20,000 characters)" / 400 `note_too_long`.
- The stream card shows the workspaces a link is in.
- Deleting a link removes it from every workspace it was in.
- Every one of these is an authenticated JSON route under `/api/v1/`, a request for another user's workspace or link gets 404, and list endpoints return at most 100 items per page with an opaque cursor.
- End-to-end flows the system must support unbroken:
  1. The owner creates the workspace "Trip to Lisbon", adds two links to it from their cards in the stream, drags the second above the first on the workspace page, writes a Markdown note that appears rendered above the links, and sees the workspace on both cards in the stream.
  2. A script with a personal access token creates a workspace, adds a link at position 1 and sets the link's note to Markdown that contains a `<script>` element; the owner sees the note's first line on the card and the note rendered without the script on the link's detail view; the owner deletes the workspace and the link is still in the stream.

## Design Decisions

1. **Workspaces are manually ordered and carry Markdown notes**, one per workspace and one per link. Owner's decision (source PRD decision 12).
2. **Workspace names are unique per user ignoring case and surrounding whitespace**, so that "Lisbon" and "lisbon " cannot both exist; a clash is 409 `name_taken`. Decided in this run: the source PRD says "unique" without saying how names compare.
3. **"One paragraph" of description means at most 1,000 characters and no line break**; otherwise 400 `invalid_description`. Decided in this run, to make the source PRD's limit testable.
4. **Note length is counted in Unicode code points**, so a note of 20,000 characters in any script fits; an empty note clears it. Decided in this run.
5. **Notes are stored as the Markdown the owner wrote and sanitised when rendered**: the website renders them with `marked` and removes every raw HTML element and attribute with `DOMPurify`, so no script, event handler, `javascript:` URL or raw HTML reaches the page. Decided in this run: storing the source keeps the owner's text intact for editing and for the export.
6. **Lists carry a note preview, not the note**: link lists (the stream, a workspace's links) carry `note_preview`, the note's first non-empty line as plain text (Markdown heading and list markers and raw HTML removed) cut to 200 characters, and `workspaces` ([{id, name}]); only `GET /api/v1/links/{id}` carries the whole note. Decided in this run, so a page of 50 cards never carries 1 MB of notes.
7. **A workspace's member list includes every member link whatever its state**, archived ones included and labelled by their state, because membership is the owner's deliberate choice. Decided in this run.
8. **Adding a link that is already a member is not an error**: without a position it changes nothing (200), with a position it moves the link there. Positions are 1-based and a position past the end means the end, as for pins in package 01. Decided in this run.
9. **The workspace list is ordered by name**, ignoring case. Decided in this run: the source PRD orders the links inside a workspace, not the workspaces.
10. **`PATCH /api/v1/links/{id}` takes `note`**: this package creates the route if package 03 has not, and extends it otherwise. Decided in this run, so the two packages can be built in either order.

## Dependencies

- Package 01 (`accounts_links_and_stream`): the project, authentication, error envelope, cursors, OpenAPI document, link store and routes, the Stream, LinkDetail and Settings pages, `LinkCard`, and the shared test helpers.

## Verified External API

Read from the published packages on 2026-11-07:

- `hono` 4.13.17: `class Hono<E, S, BasePath>`.
- Published and current, used for rendering notes on the website: `marked` 18.1.3 and `dompurify` 3.4.17 (no symbol signatures read; `af-impl` confirms `marked.parse(src: string): string` and `DOMPurify.sanitize(dirty: string, config?): string` before use).

## Glossary

- **workspace**: a user-created, manually ordered collection of links for a project.
- **member**: a link that belongs to a workspace; a link may be a member of any number of workspaces.
- **note**: the Markdown text the owner keeps on a workspace or a link, up to 20,000 characters.
- **note preview**: a note's first non-empty line, cut to 200 characters, shown on a card.
