import { useState, type KeyboardEvent } from 'react';
import { urlLines } from '../../worker/imports/parse';
import { ApiError, links, type Link } from '../api';

/** The messages a batch's outcome shows the owner. */
function messagesFor(result: Awaited<ReturnType<typeof links.addBatch>>): string[] {
  const messages: string[] = [];
  if (result.boosted.length > 0) messages.push('already in your library, moved to top');
  for (const item of result.invalid) {
    if (item.error === 'invalid_url') messages.push(`${item.url}: not a valid web address`);
  }
  if (result.invalid.some((item) => item.error === 'library_full')) {
    messages.push('library full (20,000 links)');
  }
  return messages;
}

/**
 * The add input at the top of the stream. When the owner presses Enter, the
 * paste is read as an import file is (`urlLines`): line by line, lines
 * starting with # skipped, and the first http or https address of each other
 * line kept. Those addresses go as one batch; `onAdded` receives the added and
 * boosted links. A paste without one sends nothing and stays in the box.
 */
export function AddLinks({ onAdded }: { onAdded: (links: Link[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  async function submit() {
    if (busy || !text.trim()) return;
    const urls = urlLines(text).map((l) => l.url);
    if (urls.length === 0) {
      setMessages(['no http:// or https:// address found']);
      return;
    }
    setBusy(true);
    try {
      const result = await links.addBatch(urls);
      onAdded([...result.added, ...result.boosted]);
      setMessages(messagesFor(result));
      setText('');
    } catch (err) {
      setMessages([err instanceof ApiError ? err.message : 'could not add, try again']);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="add-links">
      <textarea
        aria-label="Add links"
        placeholder="Paste links and press Enter"
        rows={1}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {messages.length > 0 && (
        <ul className="add-messages" role="status">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
