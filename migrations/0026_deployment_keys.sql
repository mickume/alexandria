-- The AI provider and the Firecrawl key belong to the deployment (AI_PROVIDER,
-- AI_MODEL, AI_API_KEY and FIRECRAWL_API_KEY), no longer to each owner: the
-- owners' encrypted keys are dropped.

ALTER TABLE users DROP COLUMN ai_provider;
ALTER TABLE users DROP COLUMN ai_model;
ALTER TABLE users DROP COLUMN ai_key_ciphertext;
ALTER TABLE users DROP COLUMN ai_key_iv;
ALTER TABLE users DROP COLUMN ai_key_last4;
ALTER TABLE users DROP COLUMN ai_key_status;
ALTER TABLE users DROP COLUMN ai_key_rejected_message;
ALTER TABLE users DROP COLUMN firecrawl_key_ciphertext;
ALTER TABLE users DROP COLUMN firecrawl_key_iv;
ALTER TABLE users DROP COLUMN firecrawl_key_last4;
ALTER TABLE users DROP COLUMN firecrawl_key_status;
ALTER TABLE users DROP COLUMN firecrawl_key_rejected_message;

-- Per service ('ai' or 'firecrawl'): the deployment's key its service last
-- refused, by the SHA-256 of the key (never the key itself), with the
-- service's message. A different key, or an hour gone by, lifts it.
CREATE TABLE key_rejections (
  service TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  message TEXT NOT NULL,
  rejected_at TEXT NOT NULL
);
