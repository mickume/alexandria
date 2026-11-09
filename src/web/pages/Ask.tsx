import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link as PageLink } from '../App';
import { ask, type AskEvent, type AskSource } from '../api';

/** The longest question, in characters. */
const QUESTION_MAX = 500;

/** The answer's text with each [n] that names a source made a link to that source. */
function Cited({ text, sources }: { text: string; sources: AskSource[] }) {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const source = sources.find((s) => s.n === Number(match[1]));
    if (!source) continue;
    parts.push(text.slice(from, match.index));
    parts.push(
      <PageLink key={match.index} to={`/links/${source.link.id}`}>
        {match[0]}
      </PageLink>,
    );
    from = match.index + match[0].length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/**
 * The Ask page: a question to the library, answered by the owner's own AI
 * provider from passages of their links. The answer streams in with each [n] a
 * link to its source, the sources listed under it. Nothing is kept: asking
 * again, or leaving the page, loses the answer.
 */
export function Ask() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<AskSource[]>([]);
  const [asking, setAsking] = useState(false);
  /** The ask the page is showing: an earlier one that is still streaming is ignored. */
  const current = useRef(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    const mine = ++current.current;
    setAnswer('');
    setSources([]);
    setAsking(true);
    const onEvent = (e: AskEvent) => {
      if (mine !== current.current) return;
      if (e.event === 'sources') setSources(e.data.sources);
      else if (e.event === 'delta') setAnswer((text) => (text ?? '') + e.data.text);
    };
    try {
      await ask(question, onEvent);
    } catch {
      // A refusal is shown by the next task.
    } finally {
      if (mine === current.current) setAsking(false);
    }
  }

  return (
    <section className="ask">
      <h1>Ask</h1>
      <p className="muted">
        Ask your library a question. It is answered by your own AI provider from passages of your
        links, and each statement cites the links it came from.
      </p>
      <form className="ask-form" onSubmit={(e) => void submit(e)}>
        <input
          type="text"
          aria-label="Question"
          maxLength={QUESTION_MAX}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="q-btn q-btn--primary" disabled={asking}>
          Ask
        </button>
      </form>
      {answer !== null && (
        <section className="ask-answer" aria-label="Answer">
          <p>
            <Cited text={answer} sources={sources} />
          </p>
        </section>
      )}
      {sources.length > 0 && (
        <ol className="ask-sources" aria-label="Sources">
          {sources.map((s) => (
            <li key={s.n}>
              <span className="muted">[{s.n}]</span>{' '}
              <PageLink to={`/links/${s.link.id}`}>{s.link.title}</PageLink>{' '}
              <span className="muted">{s.link.host}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
