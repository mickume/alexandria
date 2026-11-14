import type { Meaning } from '../api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** The mark on a search result that was found by what it means, not by the words of the query. */
export function ByMeaning() {
  return (
    <Badge variant="secondary" className="by-meaning">
      by meaning
    </Badge>
  );
}

/** What each shortfall of a search by meaning says above its results. */
const NOTICES: Partial<Record<Meaning, string>> = {
  unavailable: 'Showing keyword matches only.',
  unranked: 'Results are not ordered by relevance.',
};

/**
 * The line above the results of a search by meaning that could not use
 * meaning, or could not order its results by relevance, with a button that
 * searches again; nothing when meaning was used.
 */
export function MeaningNotice({ meaning, onRetry }: { meaning?: Meaning; onRetry: () => void }) {
  const notice = meaning && NOTICES[meaning];
  if (!notice) return null;
  return (
    <p className="notice" role="status">
      {notice}{' '}
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </p>
  );
}
