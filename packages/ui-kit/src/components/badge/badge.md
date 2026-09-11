# Badge

A compact inline label — a faithful port of [shadcn/ui's base
Badge](https://ui.shadcn.com/docs/components/base/badge). Badge has no
Base UI primitive — it's a styled `span`, plus a `render` prop (via Base
UI's `useRender`/`mergeProps` utilities) for the one case that needs it:
rendering as a link.

Badge's variant axis is **paint only**, in two groups on one axis:

- **Upstream paint** — `default`, `secondary`, `destructive`, `outline`,
  `ghost`, `link`: the same six names and the same meaning as
  [Button](button.md)'s.
- **Tone** — `success`, `warning`, `danger`, `info`, `accent`: a soft
  tinted fill with the tone's own color as the label, matching the Studio
  design's Badge row. Its sixth specimen, Neutral, is `secondary` — that
  variant already paints the drawn pair exactly, so there is no separate
  `neutral` name.

Note that `destructive` and `danger` are both present on purpose: solid
red with a white label, and a soft red fill with a red label — two
emphasis levels of the same red.

A tone is still paint, not state: it colors a label, it does not track
one. Badge's five tones (`success`, `warning`, `danger`, `info`, `accent`)
are the semantic-ish colors available — pick the one that best matches the
status, but keep the label text itself explicit; color alone is not a
substitute for a state machine.

> **Accessibility caveat on tones.** At Badge's 12px/500 label, WCAG 1.4.3
> asks 4.5:1. Four of the drawn tone pairs currently fall short — light
> `success` 3.43:1, `warning` 2.90:1, `danger` 4.28:1, `info` 3.73:1, and
> dark `danger` 3.80:1 — because the shortfall is in the theme's status
> token pairs, not in this component. Until those pairs are re-pinned, do
> not let a tone's color be the only thing carrying the meaning: keep the
> label text itself explicit. `accent` and `secondary` clear AA in both
> themes, as do `success`, `warning` and `info` in dark.

## When to use

- A short, static inline label: a count, a category tag, a plan name, a
  version number.
- A status label that benefits from color (running/failed/pending/beta) —
  pick the tone variant (`success`/`warning`/`danger`/`info`/`accent`)
  that matches the meaning, and still spell the status out in the label
  text; a tone is paint, not a live indicator.
- A clickable tag — pass `render={<a href="..." />}`. The kit's focus
  ring appears once the anchor receives keyboard focus, and hover
  feedback (background/underline) only applies once actually rendered as
  a link. Give it discernible text — a badge with no accessible name is
  unusable via keyboard or screen reader.

## When not to use

- A clickable action with its own visual weight — use `button`.
- Long or wrapping text — Badge is single-line (`white-space: nowrap`) and
  clips overflow.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `variant` | `default` \| `secondary` \| `destructive` \| `outline` \| `ghost` \| `link` \| `success` \| `warning` \| `danger` \| `info` \| `accent` | `default` |
| `render` | `ReactElement` — replaces the root `span`, e.g. with an `<a>` | — |
| `className` | `string` — merged after the variant class | — |

All other props are native `<span>` props (or the target element's props
when using `render`) and are forwarded as-is, including `aria-invalid`
(shows a destructive-tinted border and ring, independent of `variant`).

`badgeVariants` (the underlying `cva` recipe) is also exported, for a
consumer that needs the class string without the component — e.g. styling
a link that must stay a real `<a>` outside of `render`.

## Examples

```tsx
import { Badge } from '@gears-frontx/ui-kit';

// Upstream paint
<Badge>default</Badge>
<Badge variant="secondary">secondary</Badge>
<Badge variant="destructive">destructive</Badge>
<Badge variant="outline">outline</Badge>
<Badge variant="ghost">ghost</Badge>
<Badge variant="link">link</Badge>

// Tone — soft fill, tone-colored label ("secondary" is this row's Neutral)
<Badge variant="success">success</Badge>
<Badge variant="warning">warning</Badge>
<Badge variant="danger">danger</Badge>
<Badge variant="info">info</Badge>
<Badge variant="accent">accent</Badge>

// A badge that is actually a link — hover feedback only applies here
<Badge variant="outline" render={<a href="/plans/pro" />}>
  Pro plan
</Badge>
```

## Anti-patterns

- Do not let a tone carry meaning on its own — a tone paints, it does not
  announce. Always spell out the meaning in the label text itself.
- Do not nest interactive controls inside a Badge — it is a label, not a
  container.
- Do not expect hover feedback from a plain (non-`render`) badge — it only
  appears when the badge actually renders as a link via `render`.
