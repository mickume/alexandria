import { VocabularyList } from '../components/VocabularyList';

/** The Tags page: every tag with its number of links, newest first. */
export function Tags() {
  return <VocabularyList kind="tags" title="Tags" />;
}
