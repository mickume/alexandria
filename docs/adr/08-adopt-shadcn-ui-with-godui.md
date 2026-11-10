# 08. Adopt shadcn/ui with GodUI's components

## Status

Accepted (2026-11-10). Supersedes
[ADR 03](03-adopt-a-reusable-design-language.md).

## Context

The website's look came from Quire, a design language of its own kept in
`src/design/` as plain CSS (ADR 03): dependency-free, reusable by other
sites, and modelled on GitHub's interface. The owner wants the look of
shadcn/ui instead, with the motion of [GodUI](https://godui.design/), a
collection that publishes shadcn/ui's components with animation added.

GodUI is not a design language of its own. It is a shadcn registry: each
component is a source file copied into the project, built on Tailwind CSS v4,
Radix and shadcn/ui's theme variables. Its own registry item holds only motion
(durations, easings, keyframes). At the time of this decision it has one
maintainer, no tagged releases and calls itself a work in progress; because
its files are copied, not depended on, that affects updates, not the build.

## Decision

Quire is removed, and the website is built on Tailwind CSS v4 with shadcn/ui's
neutral theme:

- `src/web/theme.css` loads Tailwind and defines shadcn/ui's variables
  (`--background`, `--primary`, `--border`, …), in light and in dark. Dark
  follows `prefers-color-scheme`, as before, not a `.dark` class.
- `src/web/motion.css` holds GodUI's motion tokens.
- `src/web/components/ui/` holds the components, as the registries publish
  them: Button, Input and Textarea from GodUI; Card, Badge, Alert, Label,
  NativeSelect and Spinner from shadcn/ui, which GodUI has no version of.
  `components.json` names both registries, so `npx shadcn add` brings more.
- `src/web/styles.css` keeps Alexandria's own layout and parts, written with
  the theme's variables inside Tailwind's layers, so a utility on an element
  always wins. It also restores the defaults of plain elements that
  Tailwind's reset removes.
- `@/` names `src/web` in imports, as the components expect.

Three parts keep their own markup and take only the look:

- The card's "More actions" menu and the workspace picker stay disclosures.
  They show what an action did inside the open menu (a refresh's status, the
  picker's list), which a Radix menu, closing on every choice, does not.
- Toasts stay rendered from the page's state, since a delete's Undo is tied
  to it.
- Confirmations stay the browser's own `confirm`.

## Consequences

- The reusable design language is gone: another project can no longer copy
  one folder. What is reusable now is shadcn/ui itself.
- The website depends on `radix-ui`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react` and `tw-animate-css`, and builds with
  `@tailwindcss/vite`. The script grew from 393 kB to about 435 kB.
- The theme has no link colour, no success colour and no warning colour.
  Links are the text's colour, underlined in running text and on hover; the
  main action of a screen is the dark primary button, not a green one; one
  variable, `--warning`, was added for what is still under way.
- The files under `components/ui/` are vendored: they are formatted and
  linted with the rest, and updated by adding them again, not by a package
  upgrade.
- Moving the menus, the toasts and the confirmations to GodUI's Dropdown
  Menu, Sonner and Alert Dialog would change how they behave, and is left for
  a change of its own.
