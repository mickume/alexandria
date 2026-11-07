-- Account deletion: when the owner confirmed it. A marked account is being
-- removed by the deletion job; its user row goes last.
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
CREATE INDEX users_deletion ON users (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;
