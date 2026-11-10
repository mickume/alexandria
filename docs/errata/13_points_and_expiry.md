# Erratum 13: points and expiry

Where the implementation of spec `13_points_and_expiry` differs from what the
spec says, and why.

1. **The points form of `decay_note` no longer states the points.** The spec
   writes "42 points: expires in 42 days" ("1 point: expires in 1 day") and
   "0 points: expires today" at 0 or below. A link that is neither pinned, in
   a workspace nor expired loses one point a day and expires when they run
   out, so its points and its days left are the same number: the note said it
   twice on every card. It is now "expires in 42 days" ("expires in 1 day"),
   or "expires today" at 0 points or below. The pinned and workspace forms
   keep their points, which there say something the rest of the note does not.
