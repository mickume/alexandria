import { Badge } from '@/components/ui/badge';
/** The mark on a search result that was found by what it means, not by the words of the query. */
export function ByMeaning() {
  return (
    <Badge variant="secondary" className="by-meaning">
      by meaning
    </Badge>
  );
}

/** The line above the results of a search by meaning that could not use meaning. */
export function KeywordOnlyNotice() {
  return (
    <p className="notice" role="status">
      Showing keyword matches only.
    </p>
  );
}
