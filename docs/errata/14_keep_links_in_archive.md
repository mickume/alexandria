# Erratum 14: keep links in an archive

Where the implementation of spec `14_keep_links_in_archive` differs from what
the spec says, and why.

1. **The Archive page shows archived links on the stream's card.** The spec
   lists them dimmed, with their archiving date, Unarchive and Delete; the page
   first drew a reduced card of title, host and date. For consistency it now
   renders `LinkCard`, as the stream, search and workspaces do: favicon, title,
   Open, Read, the facts, the summary and the labels, dimmed, with the decay
   note "archived on …: kept until deleted" for the date. Unarchive is where
   other cards offer Pin, and Delete is in the card's ⋯ menu, as on every
   other card.
