import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

const alarms = makeLink({ id: 'l1', title: 'Durable Object alarms', host: 'example.com' });
const queues = makeLink({ id: 'l2', title: 'Cloudflare Queues explained', host: 'docs.example' });

/** A whole answer: its sources, its text in one piece, and done. */
const answered = (sources: { n: number; link: typeof alarms }[], text: string) => ({
  status: 200,
  headers: sseHeaders,
  text: event('sources', { sources }) + event('delta', { text }) + event('done', {}),
});

const encoder = new TextEncoder();

/** One server-sent event. */
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** An event stream the test feeds piece by piece. */
function feed() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    send: (...events: string[]) => controller.enqueue(encoder.encode(events.join(''))),
    end: () => controller.close(),
  };
}

const sseHeaders = { 'Content-Type': 'text/event-stream' };

/** A fake API that answers what the pages load on their own, and POST /api/v1/ask with `answer`. */
function api(answer?: {
  status: number;
  headers?: Record<string, string>;
  stream?: ReadableStream<Uint8Array>;
}): FakeApi {
  const fake = new FakeApi().on('GET', '/api/v1/links', {
    status: 200,
    body: { items: [alarms], next_cursor: null },
  });
  return answer ? fake.on('POST', '/api/v1/ask', answer) : fake;
}

const question = () => screen.getByRole('textbox', { name: 'Question' }) as HTMLInputElement;
const askButton = () => screen.getByRole('button', { name: 'Ask' });

/** Types the question and presses the Ask button. */
async function ask(text: string) {
  const user = userEvent.setup();
  await user.clear(question());
  await user.type(question(), text);
  await user.click(askButton());
}

describe('the Ask page', () => {
  it('has an Ask tab between Tags and Expired that opens a question box and an Ask button', async () => {
    const user = userEvent.setup();
    renderPage('/', api());
    await screen.findByRole('article', { name: 'Durable Object alarms' });

    const tabs = within(screen.getByRole('navigation', { name: 'Sections' }));
    expect(tabs.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Stream',
      'Workspaces',
      'Topics',
      'Tags',
      'Ask',
      'Expired',
      'Settings',
      'Import',
    ]);
    await user.click(tabs.getByRole('link', { name: 'Ask' }));

    expect(window.location.pathname).toBe('/ask');
    expect(question().maxLength).toBe(500);
    expect(askButton()).toBeTruthy();
  });

  it('shows the answer as it streams in with a spinner, each [n] a link to its source, and lists the sources', async () => {
    const body = feed();
    const fake = api({ status: 200, headers: sseHeaders, stream: body.stream });
    renderPage('/ask', fake);

    await ask('how do I schedule background work?');

    expect(fake.sent('POST', '/api/v1/ask').map((r) => r.body)).toEqual([
      { question: 'how do I schedule background work?' },
    ]);
    const writing = await screen.findByRole('region', { name: 'Answer' });
    expect(within(writing).getByRole('status').textContent).toContain('Writing an answer');
    expect(writing.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      body.send(
        event('sources', { sources: [{ n: 1, link: alarms }] }),
        event('delta', { text: 'Use an alarm ' }),
      );
    });
    const answer = await screen.findByRole('region', { name: 'Answer' });
    await within(answer).findByText(/Use an alarm/);
    expect(within(answer).queryByRole('link')).toBeNull();
    expect(within(answer).getByRole('status')).toBeTruthy();

    await act(async () => {
      body.send(event('delta', { text: '[1].' }), event('done', {}));
      body.end();
    });
    const cited = await within(answer).findByRole('link', { name: '[1]' });
    expect(cited.getAttribute('href')).toBe('/links/l1');
    expect(within(answer).queryByRole('status')).toBeNull();
    expect(answer.getAttribute('aria-busy')).toBe('false');
    expect(answer.textContent?.trim()).toBe('Use an alarm [1].');
    const sources = within(screen.getByRole('list', { name: 'Sources' }));
    const site = sources.getByRole('link', { name: 'Durable Object alarms' });
    expect(site.getAttribute('href')).toBe('/api/v1/links/l1/open');
    expect(site.getAttribute('target')).toBe('_blank');
    expect(site.getAttribute('rel')).toContain('noopener');
    expect(sources.getByText('example.com')).toBeTruthy();
  });

  it('replaces the answer and the sources when asked again, and keeps nothing when left', async () => {
    const answers = [
      event('sources', { sources: [{ n: 1, link: alarms }] }) +
        event('delta', { text: 'First answer [1].' }) +
        event('done', {}),
      event('sources', { sources: [{ n: 1, link: queues }] }) +
        event('delta', { text: 'Second answer [1].' }) +
        event('done', {}),
    ];
    const fake = api();
    fake.on('POST', '/api/v1/ask', () => ({
      status: 200,
      headers: sseHeaders,
      text: answers.shift()!,
    }));
    renderPage('/ask', fake);

    await ask('first question');
    expect(await screen.findByText(/First answer/)).toBeTruthy();
    await ask('second question');
    expect(await screen.findByText(/Second answer/)).toBeTruthy();

    expect(screen.queryByText(/First answer/)).toBeNull();
    const sources = within(screen.getByRole('list', { name: 'Sources' }));
    expect(sources.queryByText('Durable Object alarms')).toBeNull();
    expect(sources.getByText('Cloudflare Queues explained')).toBeTruthy();

    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('link', {
        name: 'Stream',
      }),
    );
    await screen.findByRole('article', { name: 'Durable Object alarms' });
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('link', {
        name: 'Ask',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(screen.queryByText(/Second answer/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Sources' })).toBeNull();
  });

  it.each([
    { status: 409, error: 'no_ai_key', message: 'add an AI key in settings' },
    { status: 409, error: 'ai_key_rejected', message: 'invalid x-api-key' },
    {
      status: 503,
      error: 'search_unavailable',
      message: 'search by meaning is unavailable, try again',
    },
    { status: 400, error: 'invalid_question', message: 'ask with at least one word' },
  ])('shows the message of a $error refusal in an alert', async ({ status, error, message }) => {
    const fake = api();
    fake.on('POST', '/api/v1/ask', { status, body: { error, message } });
    renderPage('/ask', fake);

    await ask('how do I schedule background work?');

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByRole('region', { name: 'Answer' })).toBeNull();
  });

  it('shows the error that ends a stream under the part of the answer that arrived', async () => {
    const fake = api({
      status: 200,
      headers: sseHeaders,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              event('sources', { sources: [{ n: 1, link: alarms }] }) +
                event('delta', { text: 'Use an ' }) +
                event('error', { error: 'provider_unavailable', message: 'timed out' }),
            ),
          );
          controller.close();
        },
      }),
    });
    renderPage('/ask', fake);

    await ask('how do I schedule background work?');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('timed out');
    const answer = screen.getByRole('region', { name: 'Answer' });
    expect(answer.textContent?.trim()).toBe('Use an');
    expect(answer.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clears an earlier error when the owner asks again', async () => {
    const refusals = [
      { status: 409, body: { error: 'no_ai_key', message: 'add an AI key in settings' } },
      {
        status: 200,
        headers: sseHeaders,
        text:
          event('sources', { sources: [] }) + event('delta', { text: 'Fine.' }) + event('done', {}),
      },
    ];
    const fake = api();
    fake.on('POST', '/api/v1/ask', () => refusals.shift()!);
    renderPage('/ask', fake);

    await ask('first');
    await screen.findByRole('alert');
    await ask('second');

    expect(await screen.findByText('Fine.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the answer’s Markdown, keeping each [n] a link to its source', async () => {
    renderPage(
      '/ask',
      api(answered([{ n: 1, link: alarms }], '## Alarms\n\nUse **an alarm** [1].')),
    );

    await ask('alarms');

    const answer = await screen.findByRole('region', { name: 'Answer' });
    expect(within(answer).getByRole('heading', { name: 'Alarms' })).toBeTruthy();
    expect(answer.querySelector('strong')?.textContent).toBe('an alarm');
    const cited = within(answer).getByRole('link', { name: '[1]' });
    fireEvent.click(cited);
    expect(window.location.pathname).toBe('/links/l1');
  });

  it.each([
    {
      name: 'the answer as Markdown and its sources with their URLs',
      sources: [
        { n: 1, link: alarms },
        { n: 2, link: queues },
      ],
      text: 'Use an alarm [1] or a queue [2].',
      copied:
        'Use an alarm [1] or a queue [2].\n\nSources:\n' +
        '[1] Durable Object alarms - https://example.com/l1\n' +
        '[2] Cloudflare Queues explained - https://example.com/l2\n',
    },
    {
      name: 'only the links found when the model wrote no answer',
      sources: [{ n: 1, link: alarms }],
      text: 'Nothing in your library answers this.',
      copied: 'Durable Object alarms - https://example.com/l1\n',
    },
  ])('copies $name', async ({ sources, text, copied }) => {
    const user = userEvent.setup();
    const links = sources.map((s) => ({
      ...s,
      link: { ...s.link, url: `https://example.com/${s.link.id}` },
    }));
    renderPage('/ask', api(answered(links, text)));

    await ask('background work');
    await user.click(await screen.findByRole('button', { name: 'Copy' }));

    expect(await navigator.clipboard.readText()).toBe(copied);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('offers neither Copy nor Tell me more when nothing was found', async () => {
    renderPage('/ask', api(answered([], 'Nothing in your library answers this.')));

    await ask('quarterly tax return');

    await screen.findByText('Nothing in your library answers this.');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tell me more' })).toBeNull();
  });

  it('shows a detailed answer of the same question under the first on Tell me more, and copies both', async () => {
    const user = userEvent.setup();
    const at = (link: typeof alarms) => ({ ...link, url: `https://example.com/${link.id}` });
    const answers = [
      answered([{ n: 1, link: at(alarms) }], 'Use an alarm [1].'),
      answered(
        [
          { n: 1, link: at(alarms) },
          { n: 2, link: at(queues) },
        ],
        'In detail: an alarm [1], or a queue [2].',
      ),
    ];
    const fake = api();
    fake.on('POST', '/api/v1/ask', () => answers.shift()!);
    renderPage('/ask', fake);

    await ask('background work');
    await screen.findByText(/Use an alarm/);
    await user.type(question(), ' changed');
    await user.click(screen.getByRole('button', { name: 'Tell me more' }));

    const detail = await screen.findByRole('region', { name: 'Detailed answer' });
    await within(detail).findByText(/In detail/);
    const first = screen.getByRole('region', { name: 'Answer' });
    expect(first.textContent?.trim()).toBe('Use an alarm [1].');
    expect(first.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(detail).getByRole('link', { name: '[2]' }).getAttribute('href')).toBe(
      '/links/l2',
    );
    expect(fake.sent('POST', '/api/v1/ask').map((r) => r.body)).toEqual([
      { question: 'background work' },
      { question: 'background work', detailed: true },
    ]);
    expect(
      within(screen.getByRole('list', { name: 'Sources' }))
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Durable Object alarms', 'Cloudflare Queues explained']);
    expect(screen.queryByRole('button', { name: 'Tell me more' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(
      'Use an alarm [1].\n\nMore detail:\n\nIn detail: an alarm [1], or a queue [2].\n\n' +
        'Sources:\n[1] Durable Object alarms - https://example.com/l1\n' +
        '[2] Cloudflare Queues explained - https://example.com/l2\n',
    );
  });

  it('shows the detailed answer as it streams in, with a spinner until it is done', async () => {
    const user = userEvent.setup();
    const body = feed();
    const answers = [
      answered([{ n: 1, link: alarms }], 'Use an alarm [1].'),
      { status: 200, headers: sseHeaders, stream: body.stream },
    ];
    const fake = api();
    fake.on('POST', '/api/v1/ask', () => answers.shift()!);
    renderPage('/ask', fake);

    await ask('background work');
    await user.click(await screen.findByRole('button', { name: 'Tell me more' }));

    const detail = await screen.findByRole('region', { name: 'Detailed answer' });
    expect(within(detail).getByRole('status').textContent).toContain('Writing a detailed answer');
    expect(detail.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      body.send(
        event('sources', { sources: [{ n: 1, link: alarms }] }),
        event('delta', { text: 'In detail' }),
      );
    });
    await within(detail).findByText(/In detail/);
    expect(within(detail).getByRole('status')).toBeTruthy();

    await act(async () => {
      body.send(event('delta', { text: ', an alarm [1].' }), event('done', {}));
      body.end();
    });
    await within(detail).findByRole('link', { name: '[1]' });
    expect(within(detail).queryByRole('status')).toBeNull();
    expect(detail.getAttribute('aria-busy')).toBe('false');
    expect(detail.textContent?.trim()).toBe('In detail, an alarm [1].');
  });

  it('keeps the first answer when the detailed one fails, showing why', async () => {
    const user = userEvent.setup();
    const answers = [
      answered([{ n: 1, link: alarms }], 'Use an alarm [1].'),
      { status: 409, body: { error: 'ai_key_rejected', message: 'invalid x-api-key' } },
    ];
    const fake = api();
    fake.on('POST', '/api/v1/ask', () => answers.shift()!);
    renderPage('/ask', fake);

    await ask('background work');
    await user.click(await screen.findByRole('button', { name: 'Tell me more' }));

    expect((await screen.findByRole('alert')).textContent).toBe('invalid x-api-key');
    expect(screen.getByRole('region', { name: 'Answer' }).textContent?.trim()).toBe(
      'Use an alarm [1].',
    );
    expect(screen.queryByRole('region', { name: 'Detailed answer' })).toBeNull();
  });
});
