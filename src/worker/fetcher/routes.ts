import { Hono } from 'hono';
import type { AppEnv } from '../env';

/** The public page the fetcher's User-Agent points site operators at. */
export const aboutRoutes = new Hono<AppEnv>();

aboutRoutes.get('/fetcher', (c) =>
  c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alexandria's fetcher</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.6}</style>
</head>
<body>
<h1>Alexandria's fetcher</h1>
<p>Alexandria is a private library of web links. When one of its users adds a link,
Alexandria fetches that one page once, on the user's behalf, to show its title and keep a
copy the user can read later. It identifies itself as <code>Alexandria/1.0</code>.</p>
<ul>
<li>It fetches only the pages its users add, and pages they ask to refresh. It does not
crawl, follow links, or fetch images, feeds or other resources the page refers to.</li>
<li>It sends at most 1 request per second to any one host.</li>
<li>It acts as its user's browser would and does not read <code>robots.txt</code>.</li>
</ul>
</body>
</html>`),
);
