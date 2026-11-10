import { now } from '../clock';
import { getLink, parseStrings, type LinkRow } from '../links/store';
import { normalizeTags } from './enrich';
import { resolveTags, resolveTopicPath, setTagsStatements, TOPIC_LEVELS } from './vocabulary';

/** The fields the owner can edit, in the order edited_fields records them. */
export const EDITABLE = ['title', 'summary', 'tags', 'topic'] as const;
export type EditableField = (typeof EDITABLE)[number];

export const TITLE_MAX = 500;
export const SUMMARY_MAX = 2_000;
export const TAGS_MAX = 20;
export const TOPIC_MAX = 100;

/** A valid edit: the given fields, normalised. */
export interface Edit {
  title?: string;
  summary?: string;
  tags?: string[];
  /** The names of the topic path, from the top level down: one to three. */
  topic?: string[];
}

/** Why an edit was refused: its error code, field and message. */
export interface EditError {
  error: string;
  field: EditableField;
  message: string;
}

/**
 * Validates every given field of an edit, refusing the whole edit on the first
 * invalid one: a title of 1 to 500 characters, a summary of at most 2,000, at
 * most 20 tags each non-empty once normalised, a topic or a path of up to
 * three topics separated by >, each name 1 to 100 characters.
 */
export function parseEdit(body: Record<string, unknown>): Edit | EditError {
  const edit: Edit = {};
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > TITLE_MAX) {
      return {
        error: 'invalid_title',
        field: 'title',
        message: `a title of 1 to ${TITLE_MAX} characters`,
      };
    }
    edit.title = title;
  }
  if ('summary' in body) {
    if (typeof body.summary !== 'string' || body.summary.length > SUMMARY_MAX) {
      return {
        error: 'invalid_summary',
        field: 'summary',
        message: `a summary of at most ${SUMMARY_MAX} characters`,
      };
    }
    edit.summary = body.summary.trim();
  }
  if ('tags' in body) {
    const tags = body.tags;
    const valid =
      Array.isArray(tags) &&
      tags.length <= TAGS_MAX &&
      tags.every((t) => typeof t === 'string' && normalizeTags([t]).length === 1);
    if (!valid) {
      return {
        error: 'invalid_tags',
        field: 'tags',
        message: `a list of at most ${TAGS_MAX} tag names`,
      };
    }
    edit.tags = normalizeTags(tags as string[]);
  }
  if ('topic' in body) {
    const names =
      typeof body.topic === 'string'
        ? body.topic.split('>').map((n) => n.replace(/\s+/g, ' ').trim())
        : [];
    if (
      names.length === 0 ||
      names.length > TOPIC_LEVELS ||
      names.some((n) => !n || n.length > TOPIC_MAX)
    ) {
      return {
        error: 'invalid_topic',
        field: 'topic',
        message: `a topic or a path of up to three topics separated by >, each 1 to ${TOPIC_MAX} characters`,
      };
    }
    edit.topic = names;
  }
  return edit;
}

/**
 * Applies a valid edit to one of the user's links: the given fields are
 * stored, tag names and the topic path resolved against the user's
 * vocabulary (names and aliases as typed, never near names), and
 * each given field is recorded as edited for good. Null when there is no such link.
 */
export async function applyEdit(
  db: D1Database,
  userId: string,
  id: string,
  edit: Edit,
): Promise<LinkRow | null> {
  const link = await getLink(db, userId, id);
  if (!link) return null;
  const before = parseStrings(link.edited_fields);
  const editedFields = [
    ...before,
    ...EDITABLE.filter((f) => edit[f] !== undefined && !before.includes(f)),
  ];
  const topicId =
    edit.topic !== undefined ? await resolveTopicPath(db, userId, edit.topic) : link.topic_id;
  const tagIds = edit.tags !== undefined ? await resolveTags(db, userId, edit.tags) : null;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE links SET title = ?, summary = ?, topic_id = ?, edited_fields = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        edit.title ?? link.title,
        edit.summary !== undefined ? edit.summary : link.summary,
        topicId,
        JSON.stringify(editedFields),
        now().toISOString(),
        id,
        userId,
      ),
  ];
  if (tagIds) statements.push(...setTagsStatements(db, userId, id, tagIds));
  await db.batch(statements);
  return getLink(db, userId, id);
}
