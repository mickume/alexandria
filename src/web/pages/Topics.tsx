import { VocabularyList } from '../components/VocabularyList';

/** The Topics page: every topic with its number of links, newest first. */
export function Topics() {
  return <VocabularyList kind="topics" title="Topics" />;
}
