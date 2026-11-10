import { useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { navigate } from '../App';
import { ApiError, ask, type AskEvent, type AskSource } from '../api';
import { SiteLink } from '../components/LinkCard';
import { renderAnswer } from '../components/Markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

/** The longest question, in characters. */
const QUESTION_MAX = 500;

/** The whole answer when the passages answer nothing; the model wrote no answer then. */
const NOTHING_ANSWERS = 'Nothing in your library answers this.';

/** Whether the model wrote an answer: some text that is not the answer for nothing found. */
const answered = (answer: string) => answer.trim() !== '' && answer.trim() !== NOTHING_ANSWERS;

/** One source as plain text: its title and URL, after its number when it has one. */
const sourceLine = (s: AskSource, numbered: boolean) =>
  `${numbered ? `[${s.n}] ` : ''}${s.link.title} - ${s.link.url}`;

/**
 * What Copy puts on the clipboard, as plain text for pasting into another
 * agent: the model's answer, then its detailed answer when there is one, then
 * the sources, each [n] with its title and URL; with no answer from the model,
 * only the links that were found. Empty when there is neither.
 */
function copyText(answer: string, detail: string, sources: AskSource[]): string {
  if (answered(answer)) {
    const parts = [answer.trim()];
    if (answered(detail)) parts.push(`More detail:\n\n${detail.trim()}`);
    if (sources.length)
      parts.push(`Sources:\n${sources.map((s) => sourceLine(s, true)).join('\n')}`);
    return `${parts.join('\n\n')}\n`;
  }
  if (sources.length === 0) return '';
  return `${sources.map((s) => sourceLine(s, false)).join('\n')}\n`;
}

/** An answer, each [n] that names a source a link to that source's page. */
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

/** A spinner and what is being written, under the part of an answer that has arrived. */
function Writing({ children }: { children: string }) {
  return (
    <p className="ask-progress muted" role="status">
      <Spinner className="inline" aria-hidden="true" /> {children}
    </p>
  );
}

/**
 * The Ask page: a question to the library, answered by the owner's own AI
 * provider from passages of their links. The answer streams in, with a spinner
 * until it is done and each [n] a link to its source, the sources listed under it, and a refusal or a failure
 * of the stream shown under whatever part of the answer arrived. Once it has
 * arrived, Tell me more asks the same question again for a detailed answer,
 * which streams in under the first with a spinner until it is done and adds
 * the sources it read, and Copy puts the answers and their sources on the
 * clipboard. Nothing is kept: asking again, or leaving the page, loses the
 * answer.
 */
export function Ask() {
  const [question, setQuestion] = useState('');
  /** The first answer and the sources it cites. */
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<AskSource[]>([]);
  /** The detailed answer and the sources it cites, which start with the first answer's. */
  const [detail, setDetail] = useState('');
  const [detailSources, setDetailSources] = useState<AskSource[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The question the answers shown answer, and whether the detailed answer was asked for. */
  const [asked, setAsked] = useState<{ question: string; detailed: boolean } | null>(null);
  /** What the Copy button says after a copy: Copied, or that it failed. */
  const [copied, setCopied] = useState<string | null>(null);
  /** The ask the page is showing: an earlier one that is still streaming is ignored. */
  const current = useRef(0);

  const listed = detailSources ?? sources;
  const text = copyText(answer, detail, listed);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (question.trim()) void run(question, false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied');
    } catch {
      setCopied('Could not copy');
    }
  }

  async function run(question: string, detailed: boolean) {
    const mine = ++current.current;
    if (!detailed) {
      setAnswer('');
      setSources([]);
    }
    setDetail('');
    setDetailSources(null);
    setFailure(null);
    setCopied(null);
    setAsked({ question, detailed });
    setAsking(true);
    const onEvent = (e: AskEvent) => {
      if (mine !== current.current) return;
      if (e.event === 'sources') (detailed ? setDetailSources : setSources)(e.data.sources);
      else if (e.event === 'delta') (detailed ? setDetail : setAnswer)((t) => t + e.data.text);
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

  /** Which answer is still arriving. */
  const writingAnswer = asking && asked?.detailed === false;
  const writingDetail = asking && asked?.detailed === true;
  const moreable = answered(answer) && !failure && asked !== null && !asked.detailed;

  return (
    <section className="ask">
      <h1>Ask</h1>
      <p className="muted">
        Ask your library a question. It is answered by your own AI provider from passages of your
        links, and each statement cites the links it came from.
      </p>
      <form className="ask-form" onSubmit={(e) => void submit(e)}>
        <Input
          type="text"
          aria-label="Question"
          maxLength={QUESTION_MAX}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" disabled={asking}>
          Ask
        </Button>
      </form>
      {(answer || writingAnswer) && (
        <section className="ask-answer" aria-label="Answer" aria-busy={writingAnswer}>
          {answer && <Answer text={answer} sources={sources} />}
          {writingAnswer && <Writing>Writing an answer…</Writing>}
        </section>
      )}
      {(detail || writingDetail) && (
        <section className="ask-answer" aria-label="Detailed answer" aria-busy={writingDetail}>
          {detail && <Answer text={detail} sources={detailSources ?? sources} />}
          {writingDetail && <Writing>Writing a detailed answer…</Writing>}
        </section>
      )}
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}
      {listed.length > 0 && (
        <ol className="ask-sources" aria-label="Sources">
          {listed.map((s) => (
            <li key={s.n} className={s.link.state === 'archived' ? 'archived' : undefined}>
              <span className="muted">[{s.n}]</span>{' '}
              <SiteLink link={s.link}>{s.link.title}</SiteLink>{' '}
              <span className="muted">{s.link.host}</span>
            </li>
          ))}
        </ol>
      )}
      {!asking && (text !== '' || moreable) && (
        <div className="ask-actions">
          {text !== '' && (
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ?? 'Copy'}
            </Button>
          )}
          {moreable && (
            <Button type="button" variant="outline" onClick={() => void run(asked!.question, true)}>
              Tell me more
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
