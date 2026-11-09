# Quire

Quire is a design language for tools: a quiet, dense look, made for reading
lists, settings and forms all day. It is framework-free CSS, with no build step
and no dependencies, so any site or app can use it. Alexandria is its first
user.

Open [`showcase.html`](showcase.html) in a browser to see every part of it in
light and dark (the button at the top right switches themes).

## Principles

1. **Content first, chrome second.** Surfaces are white or near-white (in dark,
   near-black). Structure comes from 1px hairlines, not from shadows or colour.
2. **Dense, but with room to breathe.** The body text is 14px on a 4px grid.
   Controls are 32px tall and lists are compact, with 16px of padding inside
   boxes.
3. **One accent, used for meaning.** Blue marks links, focus and selection.
   Green is only for the main action on a screen, and red only for actions that
   destroy something. The coral underline under the current tab is the only
   colour that is just decoration.
4. **Small radii.** Controls and boxes have 6px corners. Cards and overlays have
   12px. Pills are only for labels, tags and counters.
5. **System type.** It uses the platform's UI typeface. Monospace is only for
   code.
6. **Accessible by construction.** States come from ARIA attributes
   (`aria-current`, `aria-checked`, `aria-expanded`, `:disabled`), so markup
   that is accessible is also styled correctly. Every colour pair is legible in
   both themes.

## Use it

Copy the `src/design/` folder into the project, then load one file:

```html
<link rel="stylesheet" href="design/quire.css" />
```

or, with a bundler, `import './design/quire.css'`.

Quire's rules sit in cascade layers (`quire.tokens`, `quire.base`,
`quire.components`). Any CSS you write **outside a layer always wins** over
them, whatever its specificity. So an app can override a component with one
plain class and never needs `!important`. Write the app's own CSS with the
tokens (`var(--q-…)`), never with raw colours, and the app follows the theme
automatically.

### Theming

The page follows the system's light or dark setting. To pin one scheme, set
`data-theme="light"` or `data-theme="dark"` on `<html>`. Each colour token is
defined once with `light-dark()`. A brand can change the accent by overriding
the role tokens on `:root`, outside a layer:

```css
:root {
  --q-accent-fg: light-dark(#8250df, #ab7df8);
  --q-accent-emphasis: light-dark(#8250df, #8957e5);
}
```

## Tokens

All tokens live in [`tokens.css`](tokens.css) and are prefixed `--q-`. Use the
role tokens rather than memorising values.

| Group      | Tokens                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Text       | `fg-default`, `fg-muted`, `fg-disabled`, `fg-on-emphasis`                                                                 |
| Surfaces   | `bg-default` (page), `bg-subtle` (headers, hovered rows), `bg-inset`, `bg-emphasis` (toasts), `bg-overlay`, `bg-neutral-muted` (counters, hovered items), `bg-disabled` |
| Lines      | `border-default` (boxes, controls), `border-muted` (row dividers), `border-emphasis`                                      |
| Roles      | `accent-*`, `success-*`, `attention-*`, `danger-*`, `done-*`: each has `-fg`, `-emphasis` (fill), `-muted` (border) and `-subtle` (tint) |
| Controls   | `control-bg`, `control-bg-hover`, `control-bg-active`, `control-border`, `input-bg`, `primary-bg`, `primary-bg-hover`, `focus-color` |
| Type       | `font-sans`, `font-mono`; `text-xs` 12, `text-sm` 14, `text-md` 16, `text-lg` 20, `text-xl` 24, `text-2xl` 32; `weight-normal`, `-medium`, `-semibold` |
| Space      | `space-1` 4px, `space-2` 8, `space-3` 12, `space-4` 16, `space-5` 24, `space-6` 32, `space-7` 40, `space-8` 48             |
| Shape      | `radius-sm` 4px, `radius-md` 6, `radius-lg` 12, `radius-full`; `control-sm` 28px, `control-md` 32, `control-lg` 40         |
| Layout     | `container-sm` 768px (reading), `container-md` 1012 (lists), `container-lg` 1280 (wide)                                    |
| Depth      | `shadow-resting`, `shadow-small`, `shadow-overlay`; `z-dropdown`, `z-sticky`, `z-overlay`, `z-toast`                       |
| Motion     | `duration-fast` 80ms, `duration` 160ms, `ease`                                                                             |

## Base

[`base.css`](base.css) resets the box model and styles plain elements: body
text, headings (h1 24px, h2 20px, h3 16px, all semibold), links (blue,
underlined on hover), `code`, `pre`, `kbd`, `mark`, `hr`, and text fields,
selects and text areas (32px tall, a blue ring on focus). Every selector is
wrapped in `:where()`, so it has no specificity and any class overrides it.

## Components

Class names follow one pattern: a block (`.q-box`), its parts (`.q-box-header`)
and its variants (`.q-box--danger`).

### Buttons

```html
<button class="q-btn q-btn--primary">Create</button>
<button class="q-btn">Cancel</button>
<button class="q-btn q-btn--danger">Delete</button>
<button class="q-btn q-btn--invisible">More</button>
<button class="q-btn q-btn--icon" aria-label="Sign out"><svg class="q-icon">…</svg></button>
<button class="q-btn-link">Edit</button>
```

Sizes are `q-btn--sm` (28px), the default (32px) and `q-btn--lg` (40px).
`q-btn--block` fills its line. `q-btn-group` joins buttons into one control,
and `q-caret` draws a small ▾ after a label that opens something. Each screen
has at most one primary button.

### Forms

```html
<div class="q-form-control">
  <label class="q-form-label" for="name">Name</label>
  <input class="q-input" id="name" />
  <span class="q-form-caption">Shown on the project's page.</span>
  <span class="q-form-validation">Enter a name.</span>
</div>

<label class="q-input-group">
  <svg class="q-icon">…</svg>
  <input type="search" placeholder="Search" />
  <kbd>/</kbd>
</label>

<button class="q-toggle" role="switch" aria-checked="true" aria-label="Automations">
  <span class="q-toggle-knob"></span>
</button>
```

### Header and navigation

The app header is a light band with a bar (the logo, where you are, and
actions) over a row of tabs. The current tab gets the coral underline.

```html
<header class="q-header">
  <div class="q-header-bar">
    <a class="q-header-logo" href="/">…</a>
    <p class="q-breadcrumb q-header-context">
      <a class="q-breadcrumb-item" href="/">owner</a>
      <span class="q-breadcrumb-separator">/</span>
      <span class="q-breadcrumb-item is-current">project</span>
    </p>
    <div class="q-header-actions">…</div>
  </div>
  <nav class="q-underline-nav">
    <a class="q-underline-nav-item" href="/" aria-current="page">Overview</a>
    <a class="q-underline-nav-item" href="/issues">Issues <span class="q-counter">1</span></a>
  </nav>
</header>
```

On a phone, the header actions move to a line of their own and the tabs
scroll sideways.

For settings and other deep pages, use `q-side-nav` (items `q-side-nav-item`,
with `q-side-nav-heading`, `q-side-nav-divider` and `q-side-nav-sub`). The
current item is shaded and marked with a blue bar on its left. Put it in the
first column of `q-layout`, which stacks the columns on narrow screens.

### Page structure

- `q-container` (with `--md` or `--sm`) is a centred column with responsive
  side padding.
- `q-subhead` is a page heading over a hairline: `q-subhead-heading` (24px,
  regular weight), `q-subhead-description`, `q-subhead-actions`. Add
  `q-subhead--spacious` to start a new section, and use
  `q-subhead-heading--danger` for a danger zone.

### Boxes, cards and tables

- `q-box` is the main container: a 1px border with 6px corners. Inside it go
  `q-box-header` (grey, holding `q-box-title`), `q-box-body`, `q-box-row`
  (separated by hairlines; add `q-box-row--hover` to shade the row under the
  pointer) and `q-box-footer`. `q-box--condensed` tightens the padding, and
  `q-box--danger` gives a red border. Put `q-box` on a `<ul>` for a plain list
  of rows.
- `q-card` is a tile with 12px corners, for a choice or a shortcut.
- `q-table` is a table with a grey header row and hairline rows. Use
  `q-table-number` for right-aligned figures. Wrap it in a `q-box` to give it
  a border.

### Labels, tags and counters

- `q-label` is an outlined pill for a status or kind ("Public", "Preview").
  The variants are `--accent`, `--success`, `--attention`, `--danger` and
  `--done`.
- `q-topic` is a filled blue pill for a tag or topic. It turns solid when it
  is a link under the pointer.
- `q-counter` is a grey count beside a tab or inside a button.
  `q-counter--emphasis` is the strong version.
- `q-progress` is a bar with one or more coloured parts (`q-progress-item`),
  each with its own width.

### Messages

- `q-flash` is a tinted message box: accent by default, or `--success`,
  `--warning` or `--danger`. A leading `q-icon` takes the role's colour.
- `q-inline-message` is a line of coloured text with an icon, placed under the
  thing it is about.
- `q-toast` is a dark notice at the bottom of the screen, with an optional
  `q-btn-link` action.
- `q-spinner` is a small turning ring for work in progress, as big as the text
  around it; it turns slowly when the system asks for reduced motion. Pair it
  with text, or with `role="status"` and a label, so the progress is announced.
- `q-blankslate` is what an empty list shows: `q-blankslate-heading` and
  `q-blankslate-description`. `--spacious` gives it more room.

### Overlays

`q-overlay` is a floating panel (12px corners, overlay shadow). Inside it,
`q-menu` holds `q-menu-item`s (`aria-checked="true"` shows a check),
`q-menu-heading` and `q-menu-divider`. `q-menu-item--danger` is for
destructive actions. Positioning is the app's job.

### Utilities

`q-text-muted`, `q-text-small`, `q-text-danger`, `q-text-success`,
`q-text-mono`, `q-truncate`, `q-sr-only`, `q-icon`, `q-avatar` (and
`q-avatar--square`).

## Icons

Icons are 16px line drawings in the text colour (`stroke="currentColor"`,
round caps and joins, a 2-unit stroke on a 24-unit grid). Give the `<svg>` the
class `q-icon` and `aria-hidden="true"`, and put the accessible name on the
control. Inside buttons, tabs and menu items, icons are drawn muted, and the
label carries the colour.
