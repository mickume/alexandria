# 03. Adopt a reusable design language

## Status

Accepted (2026-11-08).

## Context

The website's look lived in one stylesheet (`src/web/styles.css`) where colours,
radii and component styles were mixed with the page layout. The owner wants a
visual language that looks and feels like GitHub's interface (neutral surfaces,
hairline borders, small radii, a blue accent, a green main action, an app header
with underlined tabs) and that other sites and apps can reuse, not only
Alexandria.

## Decision

The design language, **Quire**, lives in `src/design/` as plain CSS that does
not depend on the website:

- `tokens.css` holds every value as a `--q-` custom property. Colours are
  role tokens (`--q-fg-muted`, `--q-accent-emphasis`, …), each written once
  with `light-dark()`. The page follows the system theme, and `data-theme` on
  `<html>` pins one.
- `base.css` holds a reset and the defaults of plain elements, all inside
  `:where()`.
- `components.css` holds the components as `q-` classes (`q-btn`, `q-box`,
  `q-header`, `q-underline-nav`, `q-side-nav`, `q-flash`, `q-menu`, …). Their
  states come from ARIA attributes.
- `quire.css` imports the three into the cascade layers `quire.tokens`,
  `quire.base` and `quire.components`.
- `README.md` documents the language, and `showcase.html` shows every part of
  it.

The website imports `quire.css` before `styles.css`. `styles.css` keeps only
Alexandria's own layout and parts, written with Quire's tokens. Because
Alexandria's rules are outside any layer, they always win over Quire's without
any fight over specificity.

## Consequences

- Another project can copy `src/design/` and load one file. It needs no build
  step and no dependencies.
- Alexandria's markup uses Quire's classes for generic controls (buttons,
  labels, tags, boxes, menus, the header and tabs). Its own classes remain for
  what only it has (link rows, facts, the add box).
- `light-dark()` needs a 2024-or-later browser. Vite's CSS minifier
  (Lightning CSS) rewrites it into custom-property fallbacks for older
  browsers, so the built website does not depend on it.
- Changing the brand (for example the accent colour) means overriding role
  tokens. No component needs editing.
