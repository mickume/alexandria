import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('a rendered note', () => {
  it('renders Markdown with its links', () => {
    const { container } = render(<Markdown source="**bold** and [x](https://a.example)" />);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://a.example');
  });

  it('opens a note’s web links in a new tab', () => {
    const { container } = render(<Markdown source="[x](https://a.example) <mailto:a@b.example>" />);
    const [web, mail] = container.querySelectorAll('a');
    expect(web?.getAttribute('target')).toBe('_blank');
    expect(web?.getAttribute('rel')).toContain('noopener');
    expect(mail?.getAttribute('target')).toBeNull();
  });

  it.each([
    {
      label: 'a script',
      note: '<script>alert(1)</script>after',
      check: (c: HTMLElement) => {
        expect(c.querySelector('script')).toBeNull();
        expect(c.textContent).toContain('after');
      },
    },
    {
      label: 'an image with an event handler',
      note: '<img src=x onerror=alert(1)>',
      check: (c: HTMLElement) => {
        expect(c.querySelector('img')).toBeNull();
        expect(c.innerHTML).not.toContain('onerror');
      },
    },
    {
      label: 'a javascript: link',
      note: '[x](javascript:alert(1))',
      check: (c: HTMLElement) => {
        for (const a of c.querySelectorAll('a'))
          expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
      },
    },
    {
      label: 'raw HTML',
      note: '<div style="color:red">raw</div>',
      check: (c: HTMLElement) => {
        expect(c.querySelector('div div')).toBeNull();
        expect(c.querySelector('[style]')).toBeNull();
      },
    },
    {
      label: 'a data: image',
      note: '![i](data:image/png;base64,AA)',
      check: (c: HTMLElement) => {
        for (const img of c.querySelectorAll('img'))
          expect(img.getAttribute('src') ?? '').not.toMatch(/^data:/i);
      },
    },
  ])('keeps out $label', ({ note, check }) => {
    const { container } = render(<Markdown source={note} />);
    check(container.firstElementChild as HTMLElement);
  });
});
