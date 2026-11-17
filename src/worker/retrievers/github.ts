/**
 * The GitHub retriever: a repository's, an issue's or a pull request's page
 * is retrieved through the GitHub REST API, with the deployment's
 * GITHUB_TOKEN when it is set.
 */
import type { Env } from '../env';
import { callApi, parseJson, type ApiRules } from './api';
import { compactCount, dateOf, describe, facts } from './facts';
import type { RetrieveResult, Retriever } from './retriever';

/** What the GitHub retriever retrieves for an address. */
export type GitHubClaim =
  | { kind: 'repository'; owner: string; repo: string }
  | { kind: 'issue'; owner: string; repo: string; number: number };

/** The first path segments GitHub uses for its own pages, not for an owner. */
const RESERVED = new Set([
  'about',
  'apps',
  'collections',
  'customer-stories',
  'enterprise',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'site',
  'sponsors',
  'topics',
  'trending',
]);

const NAME = /^[A-Za-z0-9._-]+$/;

/** The address of an owner's repository, an issue or a pull request; null for any other. */
export function claimGitHub(url: URL): GitHubClaim | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const [owner, repo, section, number] = segments;
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null;
  if (RESERVED.has(owner.toLowerCase())) return null;
  if (segments.length === 2) return { kind: 'repository', owner, repo };
  if ((section === 'issues' || section === 'pull') && number && /^\d+$/.test(number)) {
    return { kind: 'issue', owner, repo, number: Number(number) };
  }
  return null;
}

/** GitHub says a limit is spent with x-ratelimit-remaining: 0, or names a secondary rate limit. */
const RULES: ApiRules = {
  rateLimited: (_status, headers, body) =>
    headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(body),
};

function headers(env: Env, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(env.GITHUB_TOKEN && { Authorization: `Bearer ${env.GITHUB_TOKEN}` }),
  };
}

function base(env: Env): string {
  return env.GITHUB_API_URL.replace(/\/$/, '');
}

const FAVICON = 'https://github.com/favicon.ico';

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The text of a body: null for an empty one. */
function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

async function retrieveRepository(
  env: Env,
  claim: Extract<GitHubClaim, { kind: 'repository' }>,
): Promise<RetrieveResult> {
  const path = `/repos/${claim.owner}/${claim.repo}`;
  const answer = await callApi(env, `${base(env)}${path}`, headers(env), RULES);
  if (!answer.ok) return answer;
  const repo = parseJson(answer.answer.body);
  if (!isObject(repo)) return { ok: false, failure: 'unusable answer' };
  const name = str(repo.name);
  const htmlUrl = str(repo.html_url);
  if (!name || !htmlUrl) return { ok: false, failure: 'unusable answer' };
  const fullName = str(repo.full_name) ?? `${claim.owner}/${claim.repo}`;
  const description = str(repo.description);
  const owner = isObject(repo.owner) ? str(repo.owner.login) : null;
  const license = isObject(repo.license) ? str(repo.license.spdx_id) : null;
  const topics = Array.isArray(repo.topics)
    ? repo.topics.filter((t): t is string => typeof t === 'string')
    : [];
  const stars = typeof repo.stargazers_count === 'number' ? repo.stargazers_count : null;

  const readme = await callApi(
    env,
    `${base(env)}/repos/${fullName}/readme`,
    headers(env, 'application/vnd.github.raw+json'),
    RULES,
  );
  const text = readme.ok ? textOf(readme.answer.body) : null;
  const readmeFailed = !readme.ok && readme.failure !== 'not found';

  return {
    ok: true,
    value: {
      title: description ? `${name}: ${description}` : name,
      description: describe(description),
      finalUrl: htmlUrl,
      faviconUrl: FAVICON,
      language: null,
      text,
      kind: 'repository',
      facts: facts([
        ['stars', 'Stars', stars === null ? null : compactCount(stars), true],
        ['language', 'Language', str(repo.language), true],
        ['archived', 'Archived', repo.archived === true ? 'yes' : null, true],
        ['owner', 'Owner', owner],
        ['topics', 'Topics', topics.join(', ')],
        ['license', 'License', license],
        ['pushed', 'Last push', dateOf(repo.pushed_at)],
      ]),
      ...(readmeFailed && { warning: 'GitHub API: README could not be read' }),
    },
  };
}

/** `owner/repo` of an issue's or pull request's html_url, if it is one. */
function repoOf(htmlUrl: string): string | null {
  try {
    const [owner, repo] = new URL(htmlUrl).pathname.split('/').filter(Boolean);
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

async function retrieveIssue(
  env: Env,
  claim: Extract<GitHubClaim, { kind: 'issue' }>,
): Promise<RetrieveResult> {
  const url = `${base(env)}/repos/${claim.owner}/${claim.repo}/issues/${claim.number}`;
  const answer = await callApi(env, url, headers(env), RULES);
  if (!answer.ok) return answer;
  const issue = parseJson(answer.answer.body);
  if (!isObject(issue)) return { ok: false, failure: 'unusable answer' };
  const title = str(issue.title);
  const htmlUrl = str(issue.html_url);
  const state = str(issue.state);
  if (!title || !htmlUrl || !state) return { ok: false, failure: 'unusable answer' };
  const number = typeof issue.number === 'number' ? issue.number : claim.number;
  const repo = repoOf(htmlUrl) ?? `${claim.owner}/${claim.repo}`;
  const pull = isObject(issue.pull_request) ? issue.pull_request : null;
  const status = pull
    ? str(pull.merged_at)
      ? 'merged pull request'
      : `${state} pull request`
    : `${state} issue`;
  const comments = typeof issue.comments === 'number' ? issue.comments : null;
  const author = isObject(issue.user) ? str(issue.user.login) : null;
  return {
    ok: true,
    value: {
      title: `${title} · ${repo}#${number}`,
      description: describe(textOf(issue.body)),
      finalUrl: htmlUrl,
      faviconUrl: FAVICON,
      language: null,
      text: textOf(issue.body),
      kind: pull ? 'pull_request' : 'issue',
      facts: facts([
        ['state', 'State', status, true],
        [
          'comments',
          'Comments',
          comments === null ? null : `${comments} ${comments === 1 ? 'comment' : 'comments'}`,
          true,
        ],
        ['author', 'Author', author],
        ['opened', 'Opened', dateOf(issue.created_at)],
      ]),
    },
  };
}

export const github: Retriever<GitHubClaim> = {
  name: 'github',
  site: 'GitHub',
  hosts: ['github.com', 'www.github.com'],
  enabled: () => true,
  claim: claimGitHub,
  retrieve: (env, claim) =>
    claim.kind === 'repository' ? retrieveRepository(env, claim) : retrieveIssue(env, claim),
};
