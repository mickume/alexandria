/**
 * PDFs for the fetcher's tests, written in code: a minimal PDF with text
 * pages in Helvetica, an optional Title, or a page with a drawing and no text.
 */

/** The first sentence of the paper fixture. */
export const PAPER_FIRST_SENTENCE = 'Links are the threads that hold the web together.';

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A PDF whose pages hold `pages` (each a list of lines), or a drawing when a page is null. */
export function makePdf({
  title,
  pages,
}: {
  title?: string;
  pages: (string[] | null)[];
}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesId = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const lines of pages) {
    const content =
      lines === null
        ? '0.5 g 72 72 400 600 re f'
        : `BT /F1 10 Tf 12 TL 40 760 Td ${lines.map((l) => `(${escapePdf(l)}) Tj T*`).join(' ')} ET`;
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${stream} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = title ? add(`<< /Title (${escapePdf(title)}) >>`) : null;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** The paper fixture: two pages of text, optionally titled. */
export function paperPdf(title?: string): Uint8Array {
  return makePdf({
    title,
    pages: [
      [
        PAPER_FIRST_SENTENCE,
        'Each one leads from a page to another page.',
        'A library of links keeps them.',
      ],
      ['The second page says that kept links are read again.'],
    ],
  });
}

/** A PDF of one scanned page: a drawing and no text layer. */
export function scannedPdf(): Uint8Array {
  return makePdf({ title: 'Scan', pages: [null] });
}

/** A PDF cut off after its first 200 bytes. */
export function truncatedPdf(): Uint8Array {
  return paperPdf('Cut').subarray(0, 200);
}

/** A PDF whose text is at least `chars` characters long. */
export function longPdf(chars: number): Uint8Array {
  const line = 'Every line of this long document repeats the same plain words again. ';
  const linesPerPage = 60;
  const pages: string[][] = [];
  for (let total = 0; total < chars;) {
    pages.push(Array.from({ length: linesPerPage }, () => line));
    total += line.length * linesPerPage;
  }
  return makePdf({ title: 'Long', pages });
}
