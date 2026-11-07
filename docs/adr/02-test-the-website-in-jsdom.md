# 02. Test the website in jsdom

## Status

Accepted (2026-11-07). Amends the website test environment of
[ADR 01](01-build-on-a-cloudflare-worker-with-d1.md).

## Context

The first spec package ran the website's tests in happy-dom. The Read page
(spec 02) sanitises the stored reader view a second time in the browser with
DOMPurify before showing it. Under happy-dom 21, DOMPurify's sanitize drops
allowed elements (`<h2>`) and keeps event-handler attributes (`onerror`), so
no test of that page could tell whether the sanitising works; in real
browsers, and in jsdom, which DOMPurify supports, it behaves correctly.

## Decision

The website's Vitest project runs in jsdom. happy-dom is no longer a
dependency.

## Consequences

The website tests exercise DOMPurify as browsers do. jsdom is slower to start
than happy-dom; the website suite is small enough for that not to matter.
