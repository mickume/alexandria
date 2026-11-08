-- The owner's Firecrawl key, used to fetch a page through Firecrawl when its
-- site answers Alexandria with a bot check.

-- AES-GCM ciphertext and IV of the key, both base64; never the key itself.
ALTER TABLE users ADD COLUMN firecrawl_key_ciphertext TEXT;
ALTER TABLE users ADD COLUMN firecrawl_key_iv TEXT;
ALTER TABLE users ADD COLUMN firecrawl_key_last4 TEXT;
-- 'verified' or 'rejected'.
ALTER TABLE users ADD COLUMN firecrawl_key_status TEXT;
ALTER TABLE users ADD COLUMN firecrawl_key_rejected_message TEXT;
