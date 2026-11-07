import { Hono, type Context } from 'hono';
import { notFound, refusal, validationError } from '../api/errors';
import type { AppEnv } from '../env';
import { dispatchImports } from './dispatch';
import { getImport, importLines, importProgress, reportText } from './imports';
import { MAX_IMPORT_BYTES, parseImportFile } from './parse';

/** The import routes, under /api/v1/imports. */
export const importRoutes = new Hono<AppEnv>();

const UNSUPPORTED_MESSAGE = 'only plain-text files with one URL per line are accepted';
const TOO_LARGE_MESSAGE = 'too large: at most 5,000 URLs / 2 MB per import';
const NO_URLS_MESSAGE = 'the file holds no URL: one URL per line is expected';

/**
 * The uploaded file's bytes and declared type: the body of a text/plain (or
 * untyped) request, or the part 'file' of a multipart form. 'missing' for a
 * form without that part; 'too_large' when the body is over the limit.
 */
async function readUpload(
  c: Context<AppEnv>,
): Promise<{ bytes: Uint8Array; type: string | null } | 'missing' | 'too_large'> {
  const declared = c.req.header('Content-Type') ?? null;
  const length = Number(c.req.header('Content-Length') ?? 0);
  // A form carries a little more than its file; anything far over the limit is refused unread.
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return 'too_large';
  if (declared?.toLowerCase().startsWith('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return 'missing';
    return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type || null };
  }
  return { bytes: new Uint8Array(await c.req.arrayBuffer()), type: declared };
}

importRoutes.post('/', async (c) => {
  const upload = await readUpload(c);
  if (upload === 'too_large') return refusal(c, 409, 'import_too_large', TOO_LARGE_MESSAGE);
  if (upload === 'missing') return validationError(c, 'no_urls', 'file', NO_URLS_MESSAGE);
  const parsed = parseImportFile(upload.bytes, upload.type);
  if (!parsed.ok) {
    if (parsed.error === 'import_too_large') {
      return refusal(c, 409, 'import_too_large', TOO_LARGE_MESSAGE);
    }
    if (parsed.error === 'no_urls') return validationError(c, 'no_urls', 'file', NO_URLS_MESSAGE);
    return validationError(c, 'unsupported_file', 'file', UNSUPPORTED_MESSAGE);
  }
  const userId = c.get('user').id;
  const report = await importLines(c.env.DB, userId, parsed.lines);
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
