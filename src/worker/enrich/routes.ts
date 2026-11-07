import { Hono, type Context } from 'hono';
import { readJson, refusal, validationError } from '../api/errors';
import type { AppEnv } from '../env';
import {
  clearAiSettings,
  DEFAULT_ANTHROPIC_MODEL,
  getAiSettings,
  saveAiSettings,
  type AiSettings,
  type Provider,
} from './keys';
import { testKey } from './providers';

/** The longest model identifier accepted. */
export const MODEL_MAX = 200;

/** Enrichment states that count as waiting to be enriched. */
export const UNENRICHED_STATES = ['no_key', 'waiting_for_key', 'failed'];

async function unenrichedCount(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM links WHERE user_id = ? AND enrichment_status IN (${UNENRICHED_STATES.map(() => '?').join(', ')})`,
    )
    .bind(userId, ...UNENRICHED_STATES)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The settings as the API shows them: never the key, only its last 4 characters. */
function settingsView(s: AiSettings) {
  return {
    configured: true as const,
    provider: s.provider,
    model: s.model,
    key_last4: s.last4,
    status: s.status,
    rejected_message: s.rejectedMessage,
  };
}

/** The owner's AI provider and key, under /api/v1/settings. */
export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.get('/ai', async (c) => {
  const userId = c.get('user').id;
  const settings = await getAiSettings(c.env.DB, userId);
  const unenriched_count = await unenrichedCount(c.env.DB, userId);
  return c.json(
    settings
      ? { ...settingsView(settings), unenriched_count }
      : { configured: false, unenriched_count },
  );
});

/** The validated settings of a PUT body, or the 400 answer that refuses it. */
function parseSettings(
  c: Context<AppEnv>,
  body: Record<string, unknown>,
): { provider: Provider; apiKey: string; model: string } | Response {
  const { provider, api_key: apiKey, model } = body;
  if (provider !== 'anthropic' && provider !== 'openrouter') {
    return validationError(
      c,
      'invalid_provider',
      'provider',
      "provider must be 'anthropic' or 'openrouter'",
    );
  }
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    return validationError(c, 'invalid_key', 'api_key', 'an API key is required');
  }
  if (
    model !== undefined &&
    model !== null &&
    (typeof model !== 'string' || model.length > MODEL_MAX)
  ) {
    return validationError(
      c,
      'invalid_model',
      'model',
      `a model identifier of at most ${MODEL_MAX} characters`,
    );
  }
  const named = typeof model === 'string' && model.trim() ? model.trim() : null;
  if (provider === 'openrouter' && !named) {
    return validationError(c, 'model_required', 'model', 'OpenRouter needs a model identifier');
  }
  return { provider, apiKey: apiKey.trim(), model: named ?? DEFAULT_ANTHROPIC_MODEL };
}

settingsRoutes.put('/ai', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const input = parseSettings(c, parsed.body);
  if (input instanceof Response) return input;
  const outcome = await testKey(c.env, input);
  if (!outcome.ok) {
    if (outcome.kind === 'unavailable') {
      return refusal(
        c,
        502,
        'provider_unavailable',
        `the provider could not be reached: ${outcome.message}`,
      );
    }
    return validationError(c, 'key_rejected', 'api_key', outcome.message);
  }
  const userId = c.get('user').id;
  await saveAiSettings(c.env, userId, input.provider, input.model, input.apiKey);
  const settings = await getAiSettings(c.env.DB, userId);
  return c.json(settingsView(settings!));
});

settingsRoutes.delete('/ai', async (c) => {
  await clearAiSettings(c.env.DB, c.get('user').id);
  return c.body(null, 204);
});
