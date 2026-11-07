import type { Env, FetchMessage } from '../env';
import { getLink } from '../links/store';
import { fetchPage } from './fetch';

/** Fetches one link's page. */
async function processFetch(env: Env, message: Message<FetchMessage>): Promise<void> {
  const { user_id, link_id } = message.body;
  const link = await getLink(env.DB, user_id, link_id);
  if (!link) {
    message.ack();
    return;
  }
  await fetchPage(env, link.url);
  message.ack();
}

/**
 * The FETCH_QUEUE consumer. The messages of a batch are processed
 * concurrently, so that a wait at one host's gate does not hold up the others.
 */
export async function handleFetchBatch(
  batch: MessageBatch<FetchMessage>,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<void> {
  await Promise.all(batch.messages.map((m) => processFetch(env, m)));
}
