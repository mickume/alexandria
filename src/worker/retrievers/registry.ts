/**
 * The retrievers, and which one claims an address. A retriever for another
 * site is added by writing its module and listing it here; the fetcher, the
 * one-time retrieval and the website take it from this list.
 */
import type { Env } from '../env';
import { github } from './github';
import type { Retriever, RetrieveResult } from './retriever';
import { youtube } from './youtube';

/** Every retriever, in the order they are asked. */
export const RETRIEVERS: Retriever[] = [github as Retriever, youtube as Retriever];

/** A retriever's claim on an address, ready to retrieve. */
export interface Found {
  retriever: Retriever;
  claim: unknown;
}

/** The retriever that claims `url`, with its claim; null when none does. */
export function findRetriever(
  env: Env,
  url: string,
  retrievers: Retriever[] = RETRIEVERS,
): Found | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  for (const retriever of retrievers) {
    if (!retriever.hosts.includes(host) || !retriever.enabled(env)) continue;
    const claim = retriever.claim(parsed);
    if (claim !== null) return { retriever, claim };
  }
  return null;
}

/** Retrieves what `found` claims. */
export function retrieve(env: Env, found: Found): Promise<RetrieveResult> {
  return found.retriever.retrieve(env, found.claim);
}

/** The note a retrieved link carries. */
export function retrievedNote(retriever: Retriever): string {
  return `retrieved through the ${retriever.site} API`;
}
