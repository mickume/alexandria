/**
 * The deployment's keys: the AI provider every owner's enrichment, Ask and
 * topic splits run with (AI_PROVIDER, AI_MODEL, AI_API_KEY), and the Firecrawl
 * key of the bot-check fallback (FIRECRAWL_API_KEY). Both are settings of the
 * deployment, never of an owner. When a service refuses its key, the refusal
 * is remembered by the key's SHA-256, until the key changes or an hour passes.
 */
import { sha256Hex } from '../auth/crypto';
import { now } from '../clock';
import type { Env } from '../env';

/** The AI providers a deployment can use. */
export type Provider = 'anthropic' | 'openrouter';

/** The model used with Anthropic when AI_MODEL names none. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** The message of the refusal of an AI request when the deployment has no AI key. */
export const NO_AI_KEY_MESSAGE = 'this deployment has no AI key';

/** The services whose key the deployment holds. */
export type KeyService = 'ai' | 'firecrawl';

/** How long a refused key is left alone before it is tried again. */
export const REJECTION_RETRY_MS = 60 * 60 * 1000;

/** The deployment's AI provider, model and key. */
export interface AiConfig {
  provider: Provider;
  model: string;
  apiKey: string;
}

/**
 * The deployment's AI configuration: AI_API_KEY with AI_PROVIDER (Anthropic
 * when unset) and AI_MODEL (DEFAULT_ANTHROPIC_MODEL with Anthropic when
 * unset). Null without a key, with a provider that is neither 'anthropic' nor
 * 'openrouter', or with OpenRouter and no model, as then nothing can be asked.
 */
export function aiConfig(env: Env): AiConfig | null {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || 'anthropic';
  if (provider !== 'anthropic' && provider !== 'openrouter') return null;
  const model = env.AI_MODEL?.trim() || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : null);
  if (!model) return null;
  return { provider, model, apiKey };
}

/** The deployment's Firecrawl key, or null without one. */
export function firecrawlKey(env: Env): string | null {
  return env.FIRECRAWL_API_KEY?.trim() || null;
}

/**
 * The message `service` refused `key` with, while the refusal holds: the key
 * is the one refused and the refusal is under an hour old. Null otherwise.
 */
export async function keyRejection(
  db: D1Database,
  service: KeyService,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT fingerprint, message, rejected_at FROM key_rejections WHERE service = ?')
    .bind(service)
    .first<{ fingerprint: string; message: string; rejected_at: string }>();
  if (!row || row.fingerprint !== (await sha256Hex(key))) return null;
  const age = now().getTime() - Date.parse(row.rejected_at);
  return age < REJECTION_RETRY_MS ? row.message : null;
}

/** Records that `service` refused `key`, with its message, replacing any earlier refusal. */
export async function markKeyRejected(
  db: D1Database,
  service: KeyService,
  key: string,
  message: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO key_rejections (service, fingerprint, message, rejected_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (service) DO UPDATE SET fingerprint = excluded.fingerprint,
         message = excluded.message, rejected_at = excluded.rejected_at`,
    )
    .bind(service, await sha256Hex(key), message, now().toISOString())
    .run();
}

/** The deployment's AI key as owners meet it: none, usable, or refused with the provider's message. */
export type AiState =
  | { status: 'none' }
  | { status: 'verified'; config: AiConfig }
  | { status: 'rejected'; config: AiConfig; message: string };

/** The deployment's AI configuration and whether the provider refused its key. */
export async function aiState(env: Env): Promise<AiState> {
  const config = aiConfig(env);
  if (!config) return { status: 'none' };
  const message = await keyRejection(env.DB, 'ai', config.apiKey);
  return message === null
    ? { status: 'verified', config }
    : { status: 'rejected', config, message };
}

/** Records that the AI provider refused the deployment's key, pausing enrichment. */
export function markAiKeyRejected(env: Env, config: AiConfig, message: string): Promise<void> {
  return markKeyRejected(env.DB, 'ai', config.apiKey, message);
}
