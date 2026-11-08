-- An import can add its file's links to one of the owner's workspaces.

-- The workspace the import added its links to, or NULL. Not a foreign key: a
-- deleted workspace leaves the import's report without one.
ALTER TABLE imports ADD COLUMN workspace_id TEXT;
-- How many of the file's links became members of that workspace (the others
-- were members already).
ALTER TABLE imports ADD COLUMN workspace_added INTEGER;
