# 09. Warm the theme and add one brand colour

## Status

Accepted (2026-11-12). Amends [ADR 08](08-adopt-shadcn-ui-with-godui.md).

## Context

With shadcn/ui's neutral theme (ADR 08) every page was pure grey on pure
white: the page and the boxes on it had the same colour, so nothing lifted off
the background, and nothing but the wording said that the site was Alexandria.
A link's card gave its title, its facts and its summary nearly the same weight,
and its hidden actions made the title's line taller than the title.

## Decision

The website keeps shadcn/ui, its components and its dark primary button. Three
things change in `src/web/theme.css` and `src/web/styles.css`:

- **Warm neutrals.** Every grey carries a trace of warmth (a chroma of at most
  0.01), in light and in dark.
- **Two levels of surface.** The page (`--background`) is a shade under the
  surfaces on it (`--card`): the header, the list of links, tables, boxes and
  the sign-in card. A surface has a hairline border and one faint shadow,
  `--shadow-surface`; there are no other shadows, gradients or blurs.
- **One brand colour.** `--brand`, a terracotta, is used for the mark, the line
  under the current tab, the pin of a pinned link, the words a search matched
  and the text selection, and nowhere else. Links, buttons and focus rings
  stay neutral.

The header stays at the top of the window while a page scrolls, on screens
wider than a phone. A card reads in three weights: the title, the facts in
small muted text, the summary between the two.

## Consequences

- The brand colour is one variable: changing or removing it (setting it to
  `var(--foreground)`) touches no component.
- `--brand` and `--shadow-surface` join `--warning` as variables that are not
  shadcn/ui's; a component added from a registry does not know them.
- The page's background is no longer white, so anything that must be white
  (a snapshot's frame) says so itself.
