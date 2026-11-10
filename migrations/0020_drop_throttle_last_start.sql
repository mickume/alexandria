-- The throttle no longer records when a background job actually started: the
-- slots reserved 3 seconds apart (throttle_next_at) are its only spacing, so
-- the column nothing reads or writes goes.

ALTER TABLE users DROP COLUMN throttle_last_start;
