# Bubble

Framed conversational content — a port of [shadcn/ui's base
Bubble](https://ui.shadcn.com/docs/components/base/bubble), faithful except
for the speaker-side corner notch described under
[Variants](#variants). Use it for
chat text, short structured output, quoted replies, suggestions, and
reactions. Bubble has no Base UI primitive, but `BubbleContent` gets
`render`-prop polymorphism (via Base UI's `useRender`/`mergeProps`
utilities) for the one case that needs it: rendering as a link or button.

For full-featured chat rows — avatar, sender name, timestamps,
message-level actions — use [`Message`](message.md). Bubble is
intentionally scoped to the bubble surface alone; place everything else on
Message.

## When to use

- The visible surface of a chat message: plain text, a quoted reply, a
  suggestion chip, or short structured output.
- Inside [`Message`](message.md)'s `MessageContent`, as the message's
  actual content.

## When not to use

- Avatars, sender names, timestamps, or message-level action buttons —
  those belong on `Message`, not Bubble.
- A full message row — compose `Message` + `Bubble` together instead of
  reaching for Bubble alone in a conversation UI.

## Composition

```text
Bubble
├── BubbleContent
└── BubbleReactions
```

```text
BubbleGroup
├── Bubble
│   └── BubbleContent
└── Bubble
    └── BubbleContent
```

## Variants

Use `variant` on `Bubble` to change the visual treatment:

| Variant       | Description                                            |
| ------------- | ------------------------------------------------------- |
| `default`     | A strong primary bubble, usually for the current user. |
| `secondary`   | The standard neutral bubble for conversation content.  |
| `muted`       | A lower-emphasis bubble for quiet supporting content.  |
| `tinted`      | A subtle primary-tinted bubble.                        |
| `outline`     | A bordered bubble for secondary or rich content.       |
| `ghost`       | Unframed content for assistant text or rich content.   |
| `destructive` | A destructive bubble for error or failed actions.      |

A bubble sizes to its content, up to 80% of the container width. The
`ghost` variant removes the max-width so assistant text and rich content
can span the full row.

Use `align` on `Bubble` to align it to the start or end of the
conversation:

| `align` | Description                                        |
| ------- | --------------------------------------------------- |
| `start` | Align the bubble to the start of the conversation. |
| `end`   | Align the bubble to the end of the conversation.   |

`align` is not only a position: the bubble notches its speaker-side top
corner flat, so a `start` bubble is squared off at the top start edge and
an `end` bubble at the top end edge. That is the shape cue that separates a
message from a button, and it carries the sender independently of the
variant fill. It follows the writing direction, so an RTL conversation
notches the mirrored corner. `ghost` has no frame and so no notch.

**Note:** When building a chat interface, set alignment on
[`Message`](message.md) instead — the individual `Bubble`'s own `align`
matters mainly when using Bubble standalone, outside a `Message` row.

`BubbleReactions` has two axes of its own:

| `side`   | Description                                  |
| -------- | --------------------------------------------- |
| `top`    | Anchors the reactions to the bubble's top edge. |
| `bottom` | Anchors the reactions to the bubble's bottom edge (default). |

| `align` (reactions) | Description                                |
| -------------------- | ------------------------------------------- |
| `start`              | Anchors the reactions near the start edge. |
| `end`                | Anchors the reactions near the end edge (default). |

## Props

### Bubble

| Prop        | Type                                                                                        | Default     | Description                          |
| ----------- | -------------------------------------------------------------------------------------------- | ----------- | -------------------------------------- |
| `variant`   | `'default' \| 'secondary' \| 'muted' \| 'tinted' \| 'outline' \| 'ghost' \| 'destructive'`  | `'default'` | The bubble visual treatment.         |
| `align`     | `'start' \| 'end'`                                                                           | `'start'`   | The inline alignment of the bubble.  |
| `className` | `string`                                                                                      | —           | Merged after the variant class.      |

All other props are native `<div>` props and are forwarded as-is.

### BubbleContent

| Prop        | Type                                      | Default | Description                                              |
| ----------- | ------------------------------------------ | ------- | ---------------------------------------------------------- |
| `render`    | `ReactElement` — replaces the root `div`  | —       | Render the content as a different element, e.g. a link. |
| `className` | `string`                                   | —       | Merged after the content class.                          |

### BubbleReactions

| Prop        | Type                | Default    | Description                              |
| ----------- | ------------------- | ---------- | ------------------------------------------ |
| `side`      | `'top' \| 'bottom'` | `'bottom'` | The bubble edge the reactions anchor to. |
| `align`     | `'start' \| 'end'`  | `'end'`    | The inline alignment of the reactions.   |
| `className` | `string`            | —          | Merged after the variant classes.        |

### BubbleGroup

Accepts only `className` (merged after the group class) plus native
`<div>` props.

`bubbleVariants`/`bubbleReactionsVariants` (the underlying `cva` recipes)
are also exported, for a consumer composing the bubble styles into a
custom component.

## Examples

```tsx
import { Bubble, BubbleContent, BubbleReactions } from '@gears-frontx/ui-kit';

<Bubble>
  <BubbleContent>I checked the registry output and removed the stale route.</BubbleContent>
  <BubbleReactions>
    <span>👍</span>
  </BubbleReactions>
</Bubble>;
```

### Links and buttons

```tsx
<Bubble variant="muted">
  <BubbleContent render={<button type="button" onClick={onReply} />}>Click here</BubbleContent>
</Bubble>
```

### Group

Use `BubbleGroup` to group consecutive bubbles from the same sender —
`align` still lives on each `Bubble`, not on the group.

```tsx
<BubbleGroup>
  <Bubble>
    <BubbleContent>First message.</BubbleContent>
  </Bubble>
  <Bubble>
    <BubbleContent>Second message.</BubbleContent>
  </Bubble>
</BubbleGroup>
```

### Reactions

Reactions overlap the bubble edge, so leave extra vertical space between
rows when reactions are present (e.g. a larger `gap` on the surrounding
`BubbleGroup`/`MessageGroup`).

```tsx
<Bubble variant="secondary">
  <BubbleContent>Ship it.</BubbleContent>
  <BubbleReactions side="top" align="start">
    <span>🔥</span>
  </BubbleReactions>
</Bubble>
```

### Show more / collapsible, tooltip, popover

Bubble is intentionally standalone — it does not compose
Collapsible/Tooltip/Popover itself. Wrap long bubble content in
[`Collapsible`](../collapsible/collapsible.md) for a show-more
interaction, or wrap a `Bubble` in [`Tooltip`](../tooltip/tooltip.md) or
[`Popover`](../popover/popover.md) to surface metadata on hover or demand
— see each of those components' own docs for the composition pattern; none
of it lives inside bubble.tsx/bubble.module.css.

## Accessibility

Bubble renders the presentational message surface. Keep conversation-level
semantics on the surrounding container.

- **Labeling reactions.** A screen reader reads each emoji glyph with no
  context, and a counter like `+8` is announced as "plus eight". Group the
  row as a single image with a descriptive `aria-label` so it announces
  once — `role="img"` also hides the individual emoji from assistive tech,
  so no `aria-hidden` is needed:

  ```tsx
  <BubbleReactions role="img" aria-label="Reactions: thumbs up, fire, and 8 more">
    <span>👍</span>
    <span>🔥</span>
    <span>+8</span>
  </BubbleReactions>
  ```

  When reactions are interactive, render real buttons instead and give
  icon-only ones an `aria-label`.

- **Interactive bubbles.** When a bubble is clickable, render it as a real
  `<button>` or `<a>` via `render` so it is focusable and exposes the
  correct role. `BubbleContent` ships a visible focus ring for interactive
  elements, and the accessible name comes from the bubble text — no extra
  label is needed.

- **Meaning beyond color.** Bubble variants signal role and tone with
  color alone. Pair them with text, alignment, or icons — for a
  `destructive` bubble, keep the error context in the message text rather
  than relying on the color treatment.

## Anti-patterns

- Do not put an avatar, sender name, or message-level actions inside
  Bubble — those belong on `Message`.
- Do not rely on bubble color alone to convey status — see Accessibility
  above.
- Do not set `align` on `BubbleGroup` — it belongs on each `Bubble`.
