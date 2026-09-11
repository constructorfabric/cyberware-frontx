# Avatar

A user's profile picture, with a fallback for when it hasn't loaded (or
doesn't exist). Wraps the Base UI Avatar primitive for the image/fallback
timing; the badge and group parts have no Base UI primitive underneath —
they're plain markup positioned via CSS.

Composition: `Avatar` (root, sizes itself and clips its content to a
circle) → `AvatarImage` (shown once loaded) + `AvatarFallback` (shown
until then, or on error) + optional `AvatarBadge` (a status dot in the
corner). `AvatarGroup` wraps several `Avatar`s (and optionally one
`AvatarGroupCount`) to overlap them into a stack.

## When to use

- A user or account's profile picture next to their name, in a comment,
  a list row, or a header.
- A stack of participants (a thread, a call, a shared document) via
  `AvatarGroup` + `AvatarGroupCount` for "+N more".

## When not to use

- A generic icon with no identity behind it — a plain icon/button doesn't
  need the image-loading/fallback machinery this component provides.

## Props

`Avatar` (root):

| Prop | Type | Default |
|------|------|---------|
| `size` | `sm` \| `default` \| `lg` | `default` |
| `className` | `string` — merged after the kit class | — |

All other props are native `<span>` props, forwarded to Base UI's
`Avatar.Root`.

`AvatarImage`: all native `<img>` props plus `onLoadingStatusChange`
(fires with `'idle' | 'loading' | 'loaded' | 'error'`). Renders nothing
until the image has loaded — `AvatarFallback` is what's visible until
then.

`AvatarFallback`:

| Prop | Type | Default |
|------|------|---------|
| `tone` | `neutral` \| `accent` \| `info` \| `success` \| `warning` \| `danger` | `neutral` |
| `variant` | `solid` \| `soft` | `soft` |
| `delay` | `number` — ms to wait before showing the fallback | — |
| `className` | `string` — merged after the kit class | — |

`tone` × `variant` is the fill matrix: `solid` paints the tone at full
strength with an on-primary label, `soft` puts the tone's own label color
on its soft surface. The `neutral`/`soft` default is the plain
muted-on-muted fill, so a fallback given neither prop looks exactly as it
did before these axes existed.

**`tone` is identity styling, not status.** Derive it from *who* the
avatar stands for — a stable hash of a user id, a team's assigned color —
so the same person keeps the same circle everywhere. It must not encode a
live state (online, invited, suspended); that is `AvatarBadge`'s job.

`delay` is useful to skip a flash of fallback for fast-loading images —
omitted means "show immediately". The fallback renders whenever the image
hasn't finished loading (`idle`/`loading`/`error`), regardless of whether
an `AvatarImage` is even present.

`AvatarBadge`: all native `<span>` props. Positioned absolutely against
the `Avatar` root's bottom-right corner — mount it as a **direct child of
`Avatar`**, alongside `AvatarImage`/`AvatarFallback`; its own dot size
scales with the ancestor `Avatar`'s `size` (hidden entirely at `size="sm"`,
matching upstream — a status dot has no room to read at the smallest
size).

`AvatarGroup`: all native `<div>` props. Overlaps its children by half a
step and gives each one a 2px ring in the page background color, so the
circles read as separate discs where they overlap. The ring is drawn
outside each member's circle, so it cuts cleanly through the member behind
it whatever that member is filled with — a photo, a plain fallback, or any
`tone`/`variant` fill. Members paint in DOM order, so the last one in the
markup sits on top of the stack.

`AvatarGroupCount`:

| Prop | Type | Default |
|------|------|---------|
| `tone` | `neutral` \| `accent` \| `info` \| `success` \| `warning` \| `danger` | `neutral` |
| `variant` | `solid` \| `soft` | `soft` |
| `className` | `string` — merged after the kit class | — |

Plus all native `<div>` props. It takes the same fill matrix as
`AvatarFallback` so a "+3" chip can match the toned members it caps off.
It takes no `size` prop — it sizes itself off its sibling `Avatar`s' `size`
inside the same `AvatarGroup` (via a CSS `:has()` selector), because size
is a property of the group while tone is a choice about this one chip.

## Examples

```tsx
import { Avatar, AvatarFallback, AvatarImage } from '@gears-frontx/ui-kit';

<Avatar>
  <AvatarImage src="/jane.jpg" alt="Jane Doe" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>;

// Small, with a status badge
<Avatar size="sm">
  <AvatarImage src="/jane.jpg" alt="Jane Doe" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>;

<Avatar size="lg">
  <AvatarImage src="/jane.jpg" alt="Jane Doe" />
  <AvatarFallback>JD</AvatarFallback>
  <AvatarBadge />
</Avatar>;
```

```tsx
// Identity fills: a colored circle per person, tone picked from the user id
<Avatar>
  <AvatarFallback tone="accent" variant="solid">
    ML
  </AvatarFallback>
</Avatar>;

<Avatar>
  <AvatarFallback tone="success" variant="soft">
    JB
  </AvatarFallback>
</Avatar>;
```

```tsx
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@gears-frontx/ui-kit';

<AvatarGroup>
  <Avatar>
    <AvatarImage src="/jane.jpg" alt="Jane Doe" />
    <AvatarFallback>JD</AvatarFallback>
  </Avatar>
  <Avatar>
    <AvatarImage src="/sam.jpg" alt="Sam Lee" />
    <AvatarFallback>SL</AvatarFallback>
  </Avatar>
  <AvatarGroupCount>+3</AvatarGroupCount>
</AvatarGroup>;

// Toned members; the count chip can carry a fill of its own
<AvatarGroup>
  <Avatar>
    <AvatarFallback tone="accent" variant="solid">
      ML
    </AvatarFallback>
  </Avatar>
  <Avatar>
    <AvatarFallback tone="success" variant="solid">
      JB
    </AvatarFallback>
  </Avatar>
  <AvatarGroupCount tone="accent" variant="soft">
    +3
  </AvatarGroupCount>
</AvatarGroup>;
```

## Anti-patterns

- Do not mount `AvatarBadge` outside of an `Avatar` — its absolute
  positioning is anchored to the root's own `position: relative`, and
  its size reads the ancestor `Avatar`'s size class.
- Do not expect `AvatarFallback` to hide once `AvatarImage` starts
  loading — it stays visible until the image finishes loading
  successfully (or indefinitely on error/no `src`), by design (see
  upstream's own doc comment: "the image to be displayed" is a distinct
  concern from "what shows while it isn't").
- Do not give `AvatarGroupCount` a `size` prop expecting it to control its
  own dimensions — it has none; it sizes itself from its sibling
  `Avatar`s' `size` within the same `AvatarGroup`.
- Do not drive `AvatarFallback`'s `tone` from a status (`danger` for a
  suspended account, `success` for an online one) — a person's circle would
  change color as their state changes, breaking the recognition the fill
  exists to provide. Use `AvatarBadge` for state and keep `tone` tied to
  identity.
