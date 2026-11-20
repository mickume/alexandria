# 13. Hold the AI and Firecrawl keys in the deployment

## Status

Accepted (2026-11-20). Supersedes the "bring your own key" part of
[ADR 04](04-fetch-pages-behind-a-bot-check-through-firecrawl.md) and of the
AI enrichment spec: the keys are no longer the owners'.

## Context

Each owner saved their own AI provider, model and key, and their own
Firecrawl key, on the settings page. The keys were tested on saving, stored
encrypted under `KEY_ENCRYPTION_KEY` and bound to the owner's id. The other
keys Alexandria calls services with (`GITHUB_TOKEN`, `YOUTUBE_API_KEY`, the
Google OAuth client) were already settings of the deployment.

A deployment is run by one person for a few people they let in
(`ALLOWED_EMAILS`), and that person pays for the AI and for Firecrawl anyway.
Keeping a key per owner meant a settings section per service, an encryption
secret to keep, a key test on every save, and a library that silently stopped
being enriched when one owner's key was revoked, until that owner noticed and
saved another. That happened: a key refused overnight left newly added links
without tags or a topic.

## Decision

The AI provider and the Firecrawl key are settings of the deployment, like
the GitHub and YouTube keys:

- `AI_PROVIDER` (`anthropic`, the default, or `openrouter`), `AI_MODEL`
  (Anthropic's default model when unset; OpenRouter needs one), and the
  secrets `AI_API_KEY` and `FIRECRAWL_API_KEY`, set with `npm run configure`
  or `wrangler secret put`. They are read on every use. Every owner's
  enrichment, Ask and topic splits use the AI key, and every owner's pages
  behind a bot check use the Firecrawl key.
- The settings page loses its AI provider and Firecrawl sections, and with
  them the "enrich all unenriched links" button. The stream loses its banner
  asking for a key. `GET`, `PUT` and `DELETE /api/v1/settings/ai` and
  `/api/v1/settings/firecrawl` are removed. Migration 0026 drops the owners'
  encrypted keys; `KEY_ENCRYPTION_KEY` is no longer read.
- A key is not tested when it is set. When a service refuses it (HTTP 401,
  402 or 403), the refusal is recorded in `key_rejections` by the key's
  SHA-256, never the key, with the service's message. It holds for that key
  for an hour. A different key lifts it at once; after the hour the key is
  tried again, so a key whose account was topped up comes back on its own,
  at the cost of one refused call an hour while it stays refused.
- While the AI key is missing or refused, links reaching enrichment wait
  (`no_key`, `waiting_for_key`), as before. The every-minute run queues them
  again, 20 a minute across owners, once the key is usable, so nobody has to
  ask for it.
- Each provider call is still recorded under the owner it was made for, with
  its tokens, in the daily AI usage.

## Consequences

- Setting or replacing a key is a deployment change made by its operator,
  not something an owner can do from the site. An owner sees only the
  statistics page's "AI key: not set / verified / rejected".
- One key serves every owner, and its bill and rate limits are shared.
  Per-owner throttling (20 background jobs a minute) still applies.
- A deployment without `AI_API_KEY` enriches nothing and has no Ask or topic
  splits; links fetched meanwhile are enriched once a key is set.
- No owner key is stored anywhere any more, so an export or a database copy
  holds none; the operator's keys live only in the Worker's secrets.
- The keys the owners had saved are gone after migration 0026: the operator
  sets the deployment's keys before or right after deploying.
