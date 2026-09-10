# Typeset

A prose stylesheet for rendered markdown or HTML the app does not author
itself — chat messages, docs pages, CMS content. Not a component: it is a
global stylesheet of plain class names, ported from shadcn/ui's Typeset
(MIT) with its `--color-*` references retargeted to this kit's own tokens.

## When to use

- Any block of HTML that arrives as a string and gets rendered as-is —
  a markdown renderer's output, an API-supplied description, a message
  body. Typeset gives it headings, lists, tables, code and quote styling
  without the app writing a rule per element.
- Not for application UI. Kit components style themselves; wrapping them
  in `.typeset` would put prose rhythm on a form.

## Setup

```ts
// once, in the consumer entry module
import '@gears-frontx/ui-kit/theme.css';   // required — Typeset reads its tokens from here
import '@gears-frontx/ui-kit/typeset.css';
```

Typeset paints nothing on its own without `theme.css`: every color, radius
and font it uses is a `var(--token, fallback)` read from there. The
fallbacks keep it legible if the tokens are missing, not branded.

```html
<div class="typeset typeset-docs">
  <!-- rendered markdown goes here -->
</div>
```

## Classes

| Class | Effect |
|-------|--------|
| `typeset` | The wrapper. Everything below is scoped to its descendants. |
| `typeset-chat` | Tighter rhythm for chat bubbles — less vertical space per message. |
| `typeset-docs` | Roomier long-form rhythm, at a fixed base size independent of the surrounding UI. |
| `typeset-reading` | Reading mode: larger type, generous leading and flow. |
| `typeset-compact` | Smaller type and tighter rhythm for dense UI surfaces. |
| `typeset-large` | An accessibility preset — larger type, more room. Expose it as a user setting, not a default. |
| `not-typeset` (or `data-not-typeset`) | Opts a nested subtree back out — e.g. a kit component embedded inside otherwise-typeset content. |
| `typeset-scroll` | Wraps one wide block (usually a `<table>`) so it scrolls horizontally instead of compressing. |

A preset is used ALONGSIDE `typeset`, never instead of it: each one only
overrides the rhythm variables it cares about.

## Variables

The presets are nothing but overrides of these three, so a project-specific
rhythm needs no new class — set them on your own wrapper.

| Variable | Meaning | Default |
|----------|---------|---------|
| `--typeset-size` | Base font size the whole scale derives from | `1em` |
| `--typeset-leading` | Body line-height | `1.75` |
| `--typeset-flow` | Vertical space between blocks | `1.25em` |

`--typeset-font-body` / `--typeset-font-heading` / `--typeset-font-mono`
select the families; body inherits from the page by default.

## Notes

- `@layer components` (a native cascade layer, not a Tailwind construct)
  is upstream's own device for staying overridable without `!important`:
  any un-layered rule you write — including a CSS Modules class from this
  same kit — wins over anything Typeset declares.
- The kit ships one type family for every role, so `--font-heading` maps to
  `--font-sans`. `typeset-reading` therefore changes rhythm and scale, not
  the typeface, where upstream's own version also switches to a serif.
- Dark mode needs nothing: the tokens Typeset reads already flip with
  `theme.css`.
