import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

const alarms = makeLink({ id: 'l1', title: 'Durable Object alarms', host: 'example.com' });
const queues = makeLink({ id: 'l2', title: 'Cloudflare Queues explained', host: 'docs.example' });

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
  it('has an Ask tab between Tags and Archive that opens a question box and an Ask button', async () => {
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
      'Archive',
      'Settings',
      'Import',
    ]);
    await user.click(tabs.getByRole('link', { name: 'Ask' }));

    expect(window.location.pathname).toBe('/ask');
    expect(question().maxLength).toBe(500);
    expect(askButton()).toBeTruthy();
  });

  it('shows the answer as it streams in, each [n] a link to its source, and lists the sources', async () => {
    const body = feed();
    const fake = api({ status: 200, headers: sseHeaders, stream: body.stream });
    renderPage('/ask', fake);

    await ask('how do I schedule background work?');

    expect(fake.sent('POST', '/api/v1/ask').map((r) => r.body)).toEqual([
      { question: 'how do I schedule background work?' },
    ]);
    await act(async () => {
      body.send(
        event('sources', { sources: [{ n: 1, link: alarms }] }),
        event('delta', { text: 'Use an alarm ' }),
      );
    });
    const answer = await screen.findByRole('region', { name: 'Answer' });
    await within(answer).findByText(/Use an alarm/);
    expect(within(answer).queryByRole('link')).toBeNull();

    await act(async () => {
      body.send(event('delta', { text: '[1].' }), event('done', {}));
      body.end();
    });
    const cited = await within(answer).findByRole('link', { name: '[1]' });
    expect(cited.getAttribute('href')).toBe('/links/l1');
    expect(answer.textContent).toBe('Use an alarm [1].');
    const sources = within(screen.getByRole('list', { name: 'Sources' }));
    expect(sources.getByRole('link', { name: 'Durable Object alarms' }).getAttribute('href')).toBe(
      '/links/l1',
    );
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
});
