/** HTML pages the fetcher's tests serve and extract. */

const lorem = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `Sentence ${i + 1} of the article explains one more idea about keeping links worth reading.`,
  ).join(' ');

/** A blog article surrounded by the site's chrome. */
export const blogArticle = `<!doctype html>
<html lang="en">
<head>
  <title>  Why We Keep Links
     Forever </title>
  <meta property="og:title" content="Why We Keep Links">
  <meta property="og:description" content="An essay on keeping links.">
  <meta name="description" content="Meta description.">
  <link rel="shortcut icon" href="/static/icon.png">
</head>
<body>
  <nav class="site-nav"><a href="/">Home</a> <a href="/about">NAVIGATION-ONLY-TEXT</a></nav>
  <aside class="sidebar">SIDEBAR-ONLY-TEXT: popular posts, tag cloud.</aside>
  <article>
    <h1>Why We Keep Links</h1>
    <p class="byline">By <span class="author">Ada Writer</span></p>
    <p>${lorem(8)}</p>
    <h2>The first reason</h2>
    <p>${lorem(6)}</p>
    <ul><li>First point to remember</li><li>Second point to remember</li></ul>
    <p>${lorem(6)}</p>
  </article>
  <section id="comments" class="comments">COMMENTS-ONLY-TEXT: great post!</section>
  <footer class="site-footer">FOOTER-ONLY-TEXT © 2026</footer>
</body>
</html>`;

/** A documentation page with code blocks and nested lists. */
export const docsPage = `<!doctype html>
<html><head><title>Install the tool</title></head>
<body>
  <main>
    <article>
      <h1>Install the tool</h1>
      <p>${lorem(5)}</p>
      <h2>Steps</h2>
      <ol>
        <li>Download it
          <ul><li>on Linux</li><li>on macOS</li></ul>
        </li>
        <li>Run it</li>
      </ol>
      <pre><code>npm install --global the-tool
the-tool --version</code></pre>
      <p>${lorem(5)}</p>
    </article>
  </main>
</body></html>`;

/** An article whose images and links are relative. */
export const relativeArticle = `<!doctype html>
<html><head><title>Relative things</title></head>
<body>
  <article>
    <h1>Relative things</h1>
    <p>${lorem(6)} <a href="/b">a related page</a>.</p>
    <p><img src="img/a.png" alt="A picture"></p>
    <p>${lorem(6)}</p>
  </article>
</body></html>`;

/** A page whose article text has exactly `chars` characters. */
export function articleWithText(chars: number): string {
  const text = 'x'.repeat(chars);
  return `<!doctype html><html><head><title>Short</title></head><body><article><p>${text}</p></article></body></html>`;
}

/** A page of nothing but images. */
export const imagesOnly = `<!doctype html><html><head><title>Gallery</title></head>
<body><article><img src="/1.jpg"><img src="/2.jpg"><img src="/3.jpg"></article></body></html>`;

/** An article whose text is about `chars` characters long. */
export function longArticle(chars: number): string {
  const sentence = 'This sentence fills the long article with plain words. ';
  const paragraphs: string[] = [];
  let length = 0;
  while (length < chars) {
    const p = sentence.repeat(20);
    paragraphs.push(`<p>${p}</p>`);
    length += p.length;
  }
  return `<!doctype html><html><head><title>Long</title></head><body><article><h1>Long</h1>${paragraphs.join('')}</article></body></html>`;
}
