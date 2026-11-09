import { useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { navigate } from '../App';
import { ApiError, ask, type AskEvent, type AskSource } from '../api';
import { SiteLink } from '../components/LinkCard';
import { renderAnswer } from '../components/Markdown';

/** The longest question, in characters. */
const QUESTION_MAX = 500;

/** The whole answer when the passages answer nothing; the model wrote no answer then. */
const NOTHING_ANSWERS = 'Nothing in your library answers this.';

/** Whether the model wrote an answer: some text that is not the answer for nothing found. */
const answered = (answer: string) => answer.trim() !== '' && answer.trim() !== NOTHING_ANSWERS;

/** A link title with the brackets that would end a Markdown link escaped. */
const linkText = (title: string) => title.replace(/[[\]\\]/g, '\\$&');

/**
 * What Copy puts on the clipboard, as Markdown: the model's answer followed by
 * its sources, each [n] with its title and URL; with no answer from the model,
 * only the links that were found. Empty when there is neither.
 */
function copyText(answer: string, sources: AskSource[]): string {
  if (answered(answer)) {
    const cited = sources.map((s) => `- [${s.n}] [${linkText(s.link.title)}](${s.link.url})`);
    return cited.length
      ? `${answer.trim()}\n\nSources:\n\n${cited.join('\n')}\n`
      : `${answer.trim()}\n`;
  }
  if (sources.length === 0) return '';
  return `${sources.map((s) => `- [${linkText(s.link.title)}](${s.link.url})`).join('\n')}\n`;
}

/** The answer's Markdown, each [n] that names a source a link to that source's page. */
function Answer({ text, sources }: { text: string; sources: AskSource[] }) {
  const html = renderAnswer(text, (n) => {
    const source = sources.find((s) => s.n === n);
    return source && `/links/${source.link.id}`;
  });
  // A citation is a page of the website, followed without a reload.
  const follow = (e: MouseEvent) => {
    const anchor = (e.target as Element).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href?.startsWith('/') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
  return <div className="markdown" onClick={follow} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The Ask page: a question to the library, answered by the owner's own AI
 * provider from passages of their links. The answer streams in as Markdown
 * with each [n] a link to its source, the sources listed under it, and a
 * refusal or a failure of the stream shown under whatever part of the answer
 * arrived. Once it has arrived, Copy puts the answer and its sources on the
 * clipboard, and Tell me more asks the same question again for a detailed
 * answer, which replaces it. Nothing is kept: asking again, or leaving the
 * page, loses the answer.
 */
export function Ask() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<AskSource[]>([]);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The question the answer shown answers, and whether that answer is the detailed one. */
  const [asked, setAsked] = useState<{ question: string; detailed: boolean } | null>(null);
  /** What the Copy button says after a copy: Copied, or that it failed. */
  const [copied, setCopied] = useState<string | null>(null);
  /** The ask the page is showing: an earlier one that is still streaming is ignored. */
  const current = useRef(0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (question.trim()) void run(question, false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(answer, sources));
      setCopied('Copied');
    } catch {
      setCopied('Could not copy');
    }
  }

  async function run(question: string, detailed: boolean) {
    const mine = ++current.current;
    setAnswer('');
    setSources([]);
    setFailure(null);
    setCopied(null);
    setAsked({ question, detailed });
    setAsking(true);
    const onEvent = (e: AskEvent) => {
      if (mine !== current.current) return;
      if (e.event === 'sources') setSources(e.data.sources);
      else if (e.event === 'delta') setAnswer((text) => text + e.data.text);
      else if (e.event === 'error') setFailure(e.data.message);
    };
    try {
      await ask(question, onEvent, { detailed });
    } catch (err) {
      if (mine === current.current) {
        setFailure(err instanceof ApiError ? err.message : 'could not ask, try again');
      }
    } finally {
      if (mine === current.current) setAsking(false);
    }
  }

  const copyable = copyText(answer, sources) !== '';
  const moreable = answered(answer) && !failure && asked !== null && !asked.detailed;

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
      {answer && (
        <section className="ask-answer" aria-label="Answer">
          <Answer text={answer} sources={sources} />
        </section>
      )}
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}
      {sources.length > 0 && (
        <ol className="ask-sources" aria-label="Sources">
          {sources.map((s) => (
            <li key={s.n}>
              <span className="muted">[{s.n}]</span>{' '}
              <SiteLink link={s.link}>{s.link.title}</SiteLink>{' '}
              <span className="muted">{s.link.host}</span>
            </li>
          ))}
        </ol>
      )}
      {!asking && (copyable || moreable) && (
        <div className="ask-actions">
          {copyable && (
            <button type="button" className="q-btn" onClick={() => void copy()}>
              {copied ?? 'Copy'}
            </button>
          )}
          {moreable && (
            <button type="button" className="q-btn" onClick={() => void run(asked!.question, true)}>
              Tell me more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
