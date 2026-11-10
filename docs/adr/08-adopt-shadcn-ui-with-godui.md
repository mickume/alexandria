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
  them: Button, Input, Textarea, Dropdown Menu, Alert Dialog and Sonner from
  GodUI; Card, Badge, Alert, Label,
  NativeSelect and Spinner from shadcn/ui, which GodUI has no version of.
  `components.json` names both registries, so `npx shadcn add` brings more.
- `src/web/styles.css` keeps Alexandria's own layout and parts, written with
  the theme's variables inside Tailwind's layers, so a utility on an element
  always wins. It also restores the defaults of plain elements that
  Tailwind's reset removes.
- `@/` names `src/web` in imports, as the components expect.

The menus, the toasts and the confirmations are GodUI's too:

- The card's "More actions" menu is a Dropdown Menu, with the workspace
  picker as its submenu; on a link's page the picker is a menu of its own.
  A menu closes on every choice, so what an action in it did (a refresh
  accepted or refused, a workspace that could not be loaded) is said in a
  toast, not inside the menu. Refresh and Check now on a link's page say
  their outcome in a toast as well.
- Toasts are Sonner's: `<Toaster>` is mounted once, in `App.tsx`. A delete's
  toast carries Undo and stays for the whole undo window, which the page's
  own timer ends, not the toast's.
- Confirmations are an Alert Dialog, asked through `useConfirm`
  (`src/web/confirm.tsx`), whose provider shows the one dialog.

GodUI's Sonner reads the theme from `next-themes`; the vendored file asks for
the system's theme instead, since the website has no theme switch.

## Consequences

- The reusable design language is gone: another project can no longer copy
  one folder. What is reusable now is shadcn/ui itself.
- The website depends on `radix-ui`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react`, `sonner` and `tw-animate-css`, and builds with
  `@tailwindcss/vite`. The script grew from 393 kB to about 570 kB, most of it the menus, the dialog and the toaster.
- The theme has no link colour, no success colour and no warning colour.
  Links are the text's colour, underlined in running text and on hover; the
  main action of a screen is the dark primary button, not a green one; one
  variable, `--warning`, was added for what is still under way.
- The files under `components/ui/` are vendored: they are formatted and
  linted with the rest, and updated by adding them again, not by a package
  upgrade.
- A card's menu is modal, as Radix makes it: while it is open the page
  behind it is inert, and its items are rendered outside the card.
- The tests open a menu with a pointer-down (`openMenu` in
  `src/web/test/helpers.tsx`), and `src/web/test/setup.ts` stands in for the
  browser APIs the menus and the toaster need that jsdom lacks.
