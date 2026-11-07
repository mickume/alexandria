# Erratum 04: workspaces and notes

Where the implementation of spec `04_workspaces_and_notes` differs from what
the spec says, and why.

1. **Links carry their workspaces through `link_views`**: migration 0004
   recreates the view with a `workspaces_json` column, so every link read
   (the stream, the change feed, a workspace's links, a single link) carries
   `workspaces` without a query per route.
2. **`PATCH /api/v1/links/{id}` already existed** (spec 03), so it was
   extended with `note`. A note is not recorded in `edited_fields`: it is
   never written by automatic work.
3. **Raw HTML in a note becomes its text.** The Markdown renderer reduces
   every raw HTML element of the note to its text (dropping the content of
   scripts and styles), and the result is sanitised once more with a DOMPurify
   instance of its own that keeps only the tags Markdown produces and only
   http, https and mailto URLs. Its own instance keeps that URL rule away
   from the Read page's sanitising, where reader images may be `data:`.
4. **The workspace page drags whole members**: its member wrappers, not the
   cards, are draggable, and dropping a member on another sends the target's
   position.
