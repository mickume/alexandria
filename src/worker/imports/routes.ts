import { Hono, type Context } from 'hono';
import { notFound, refusal, validationError } from '../api/errors';
import type { AppEnv } from '../env';
import { getWorkspace } from '../workspaces/store';
import { dispatchImports } from './dispatch';
import { getImport, importLines, importProgress, reportText } from './imports';
import { MAX_IMPORT_BYTES, parseImportFile } from './parse';

/** The import routes, under /api/v1/imports. */
export const importRoutes = new Hono<AppEnv>();

const UNSUPPORTED_MESSAGE = 'only text or Markdown files (.txt, .md) are accepted';
const TOO_LARGE_MESSAGE = 'too large: at most 5,000 URLs / 2 MB per import';
const NO_URLS_MESSAGE = 'the file holds no URL: no line has an http:// or https:// address';

/** An upload as read: the file's bytes, declared type and name, and the workspace asked for. */
interface Upload {
  bytes: Uint8Array;
  type: string | null;
  /** The file name a form gave, or null for a bare body. */
  name: string | null;
  /** The id in the form's part 'workspace_id' or the query's workspace_id, or null. */
  workspaceId: string | null;
}

/**
 * The uploaded file's bytes, declared type and name: the body of a request,
 * or the part 'file' of a multipart form. 'missing' for a
 * form without that part; 'too_large' when the body is over the limit.
 */
async function readUpload(c: Context<AppEnv>): Promise<Upload | 'missing' | 'too_large'> {
  const fromQuery = c.req.query('workspace_id') || null;
  const declared = c.req.header('Content-Type') ?? null;
  const length = Number(c.req.header('Content-Length') ?? 0);
  // A form carries a little more than its file; anything far over the limit is refused unread.
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return 'too_large';
  if (declared?.toLowerCase().startsWith('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return 'missing';
    const part = form.get('workspace_id');
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      type: file.type || null,
      name: file.name || null,
      workspaceId: (typeof part === 'string' && part) || fromQuery,
    };
  }
  return {
    bytes: new Uint8Array(await c.req.arrayBuffer()),
    type: declared,
    name: null,
    workspaceId: fromQuery,
  };
}

importRoutes.post('/', async (c) => {
  const upload = await readUpload(c);
  if (upload === 'too_large') return refusal(c, 409, 'import_too_large', TOO_LARGE_MESSAGE);
  if (upload === 'missing') return validationError(c, 'no_urls', 'file', NO_URLS_MESSAGE);
  const parsed = parseImportFile(upload.bytes, upload.type, upload.name);
  if (!parsed.ok) {
    if (parsed.error === 'import_too_large') {
      return refusal(c, 409, 'import_too_large', TOO_LARGE_MESSAGE);
    }
    if (parsed.error === 'no_urls') return validationError(c, 'no_urls', 'file', NO_URLS_MESSAGE);
    return validationError(c, 'unsupported_file', 'file', UNSUPPORTED_MESSAGE);
  }
  const userId = c.get('user').id;
  let workspace: { id: string; name: string } | null = null;
  if (upload.workspaceId) {
    const row = await getWorkspace(c.env.DB, userId, upload.workspaceId);
    if (!row) {
      return validationError(c, 'unknown_workspace', 'workspace_id', 'no such workspace');
    }
    workspace = { id: row.id, name: row.name };
  }
  const report = await importLines(c.env.DB, userId, parsed.lines, workspace);
  // The first links go to the fetch worker at once; the minute's run sends the rest.
  await dispatchImports(c.env, userId);
  return c.json(report, 201);
});

importRoutes.get('/:id', async (c) => {
  const report = await getImport(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!report) return notFound(c);
  return c.json({ ...report, progress: await importProgress(c.env.DB, report.id) });
});

importRoutes.get('/:id/report', async (c) => {
  const report = await getImport(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!report) return notFound(c);
  const name = `alexandria-import-${report.created_at.slice(0, 10)}.txt`;
  return c.body(reportText(report), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"`,
  });
});
