import { SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env, seedLinks, signIn } from './test/helpers';

/** A deployment without PUBLIC_ORIGIN, reached at its workers.dev address. */
const SITE = 'https://alexandria.someone.workers.dev';
let configured: string | undefined;

beforeEach(() => {
  configured = env.PUBLIC_ORIGIN;
  delete (env as { PUBLIC_ORIGIN?: string }).PUBLIC_ORIGIN;
});

afterEach(() => {
  env.PUBLIC_ORIGIN = configured!;
});

describe('a deployment without PUBLIC_ORIGIN', () => {
  it('sends Google the callback on the address it was reached at', async () => {
    const r = await SELF.fetch(`${SITE}/auth/google`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const location = new URL(r.headers.get('Location') ?? '');
    expect(location.searchParams.get('redirect_uri')).toBe(`${SITE}/auth/google/callback`);
  });

  it('accepts a change with the session cookie from its own address, and refuses another', async () => {
    const user = await signIn();
    const send = (origin: string) =>
      SELF.fetch(`${SITE}/api/v1/links`, {
        method: 'POST',
        headers: {
          Cookie: `alexandria_session=${user.session}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://example.net/' }),
      });
    expect((await send(SITE)).status).toBe(201);
    expect((await send('https://evil.example')).status).toBe(403);
  });

  it('gives the export’s content URLs the address it was reached at', async () => {
    const user = await signIn();
    const [id] = await seedLinks(user, [{ url: 'https://stored.example' }]);
    await env.DB.prepare("UPDATE links SET has_snapshot = 1, content_kind = 'html' WHERE id = ?")
      .bind(id)
      .run();
    const r = await SELF.fetch(`${SITE}/api/v1/export`, {
      headers: { Cookie: `alexandria_session=${user.session}` },
    });
    const body = (await r.json()) as { links: { snapshot_url: string }[] };
    expect(body.links[0]!.snapshot_url).toBe(`${SITE}/api/v1/export/links/${id}/snapshot`);
  });
});
