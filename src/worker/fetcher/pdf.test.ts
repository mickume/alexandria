import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import { addAndFetch, api, deliverFetches, env, signIn, type TestUser } from '../test/helpers';
import { longPdf, PAPER_FIRST_SENTENCE, paperPdf, scannedPdf, truncatedPdf } from './fixtures/pdfs';

/** Adds and fetches a PDF, and returns what was stored for it. */
async function fetchPdf(user: TestUser, url: string) {
  const { id, prefix } = await addAndFetch(user, url);
  const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
  const text = await env.DB.prepare('SELECT text FROM link_texts WHERE link_id = ?')
    .bind(id)
    .first<{ text: string }>();
  const file = await api('GET', `/api/v1/links/${id}/snapshot/file`, { as: user.session });
  return {
    id,
    link,
    text: text?.text ?? null,
    snapshot: file.status === 200 ? new Uint8Array(await file.response.arrayBuffer()) : null,
    objects: (await env.SNAPSHOTS.list({ prefix })).objects,
  };
}

/** The stored PDF of a link as it is now. */
async function fetchPdfAgain(user: TestUser, id: string) {
  const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
  const file = await api('GET', `/api/v1/links/${id}/snapshot/file`, { as: user.session });
  return { link, snapshot: new Uint8Array(await file.response.arrayBuffer()) };
}

describe('storing a PDF', () => {
  it.each([
    {
      label: 'a titled PDF served as application/pdf',
      url: 'https://papers.example/on-links.pdf',
      pdf: paperPdf('On Links'),
      type: 'application/pdf',
      title: 'On Links',
    },
    {
      label: 'an untitled PDF served as octet-stream at a .pdf path',
      url: 'https://papers.example/docs/manual.pdf',
      pdf: paperPdf(),
      type: 'application/octet-stream',
      title: 'manual.pdf',
    },
  ])('keeps the whole file and its text for $label', async ({ url, pdf, type, title }) => {
    new FakeOrigin().page(url, pdf, type);
    const r = await fetchPdf(await signIn(), url);
    expect(r.link).toMatchObject({
      state: 'active',
      content_kind: 'pdf',
      title,
      has_snapshot: true,
      snapshot_kind: 'pdf',
      snapshot_at: r.link.fetched_at,
    });
    expect(r.snapshot).toEqual(pdf);
    expect(r.text?.startsWith(PAPER_FIRST_SENTENCE)).toBe(true);
  });

  it.each([
    { label: 'a scanned PDF without text', pdf: scannedPdf() },
    { label: 'a PDF that cannot be parsed', pdf: truncatedPdf() },
  ])('keeps $label and notes it has no text', async ({ pdf }) => {
    const url = 'https://papers.example/scan.pdf';
    new FakeOrigin().page(url, pdf, 'application/pdf');
    const r = await fetchPdf(await signIn(), url);
    expect(r.link.state).toBe('active');
    expect(r.link.notes).toContain('no text in this PDF');
    expect(r.snapshot).toEqual(pdf);
    expect(r.text).toBeNull();
  });

  it.each([
    { label: 'by its Content-Length', contentLength: true },
    { label: 'by the bytes read', contentLength: false },
  ])(
    'stores nothing of a PDF over 50 MB, noticed $label',
    async ({ contentLength }) => {
      const url = 'https://papers.example/huge.pdf';
      const origin = new FakeOrigin().stream(url, 60 * 1024 * 1024, 'application/pdf', {
        contentLength,
        prefix: '%PDF-1.4\n',
      });
      const r = await fetchPdf(await signIn(), url);
      expect(r.link).toMatchObject({
        state: 'active',
        content_kind: 'pdf',
        title: 'huge.pdf',
        has_snapshot: false,
      });
      expect(r.link.notes).toContain('PDF too large to store (50 MB limit)');
      expect(r.objects).toEqual([]);
      expect(origin.bytesSent).toBeLessThanOrEqual(50 * 1024 * 1024 + 64 * 1024);
    },
    30_000,
  );

  it('keeps the stored PDF through a refresh that finds a new one', async () => {
    const url = 'https://papers.example/kept.pdf';
    const first = paperPdf('First');
    const origin = new FakeOrigin().page(url, first, 'application/pdf');
    const user = await signIn();
    const { id } = await fetchPdf(user, url);
    origin.page(url, paperPdf('Second'), 'application/pdf');
    await deliverFetches([{ user_id: user.id, link_id: id, refresh: true }]);
    const r = await fetchPdfAgain(user, id);
    expect(r.link.title).toBe('Second');
    expect(r.snapshot).toEqual(first);
  });

  it('keeps at most 500,000 characters of a PDF’s text', async () => {
    const url = 'https://papers.example/long.pdf';
    new FakeOrigin().page(url, longPdf(700_000), 'application/pdf');
    const r = await fetchPdf(await signIn(), url);
    expect(r.text?.length).toBe(500_000);
  }, 30_000);
});
