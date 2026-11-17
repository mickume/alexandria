/**
 * What every retriever has in common: the shape of a retriever, of what it
 * answers, and of the facts it stores. A retriever asks a site's API what
 * the thing behind one of its addresses is, instead of fetching the page.
 */
import type { Env } from '../env';

/** The retrievers there are, by name. */
export type RetrieverName = 'github' | 'youtube';

/** What a retrieved link is. */
export type SiteKind = 'repository' | 'issue' | 'pull_request' | 'video';

/** One site-specific detail of a link, as it is shown. */
export interface Fact {
  key: string;
  label: string;
  value: string;
  /** Shown on the link's card (at most 3 per link). */
  card: boolean;
}

/** What a retriever stores about a link: the `site` field of the link. */
export interface SiteView {
  retriever: RetrieverName;
  kind: SiteKind;
  /** When the link was last retrieved successfully. */
  retrieved_at: string;
  facts: Fact[];
}

/** Why a retriever could not answer, as the link's history names it. */
export type RetrieverFailure =
  'unreachable' | 'timed out' | 'rate limited' | 'key refused' | 'not found' | 'unusable answer';

/** What a retriever answered for a link. */
export interface Retrieved {
  title: string;
  description: string | null;
  /** The canonical address of the thing. */
  finalUrl: string;
  faviconUrl: string;
  language: string | null;
  /** The text search, Ask, enrichment and the meaning index read; null for none. */
  text: string | null;
  kind: SiteKind;
  facts: Fact[];
  /** Something that went wrong without failing the retrieval, recorded as the fetch's reason. */
  warning?: string;
}

export type RetrieveResult =
  { ok: true; value: Retrieved } | { ok: false; failure: RetrieverFailure };

/** A retriever: the addresses of one site it claims, and how it retrieves one. */
export interface Retriever<Claim = unknown> {
  name: RetrieverName;
  /** The site's name, as notes and reasons say it: "GitHub". */
  site: string;
  /** The hosts whose addresses it may claim, exactly (a subdomain is not one of them). */
  hosts: string[];
  /** Whether the retriever is in use in this deployment (it may need a key it does not have). */
  enabled(env: Env): boolean;
  /** What the retriever needs to retrieve `url`, or null when it does not claim it. */
  claim(url: URL): Claim | null;
  retrieve(env: Env, claim: Claim): Promise<RetrieveResult>;
}

/** A stored `site` column read back; null for none or for anything unreadable. */
export function parseSite(json: string | null | undefined): SiteView | null {
  if (!json) return null;
  try {
    const site = JSON.parse(json) as SiteView | null;
    return site && typeof site.retriever === 'string' && Array.isArray(site.facts) ? site : null;
  } catch {
    return null;
  }
}
