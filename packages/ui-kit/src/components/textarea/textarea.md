# Textarea

A multi-line text field. A styled native `<textarea>` — no primitive is
needed. Grows with its content in browsers that support `field-sizing`;
elsewhere it keeps the native resize handle.

## When to use

- Multi-line free text: descriptions, comments, messages.
- Inside a `Field` — wire `id`/`aria-describedby` to the surrounding
  `FieldLabel`/`FieldDescription`/`FieldError` by hand (see field.md);
  Textarea has no primitive to auto-register with, unlike `Input`.

## When not to use

- Single-line values — use `input`.
- Rich text — out of the kit's scope; bring an editor and style it with
  theme tokens.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `className` | `string` — merged after the kit class | — |

All other props are native `<textarea>` props (`value`, `onChange`,
`placeholder`, `disabled`, `rows`, `aria-invalid`, ...) and are forwarded
as-is. `aria-invalid` switches the border and ring to the destructive color.

`rows` also sets a starting-height floor via CSS (a `--rows` custom
property, the same private-per-instance idiom as AspectRatio's `--ratio`):
`field-sizing: content` below makes the box grow with its own content, but
per the CSS Sizing spec that mode drops the native `rows`/`cols` attribute's
sizing contribution outright rather than using it as a starting point, so
`rows` alone renders identically to the unset default in any browser that
supports `field-sizing` - measured, not assumed. The floor reconstructs
what the attribute would have done.

## Examples

```tsx
import { Textarea } from '@gears-frontx/ui-kit';

// Uncontrolled
<Textarea placeholder="Describe the issue…" />

// Controlled
<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />

// Fixed starting height via rows
<Textarea rows={6} defaultValue={draft} />

// Invalid state
<Textarea aria-invalid={true} defaultValue={tooLong} />

// Inside a Field — id/aria-describedby wired by hand (see field.md)
<Field>
  <FieldLabel htmlFor="notes">Notes</FieldLabel>
  <Textarea id="notes" aria-describedby="notes-desc" />
  <FieldDescription id="notes-desc">Optional context.</FieldDescription>
</Field>
```

## Anti-patterns

- Do not fix the height with inline styles — pass `rows` or set a
  `max-height` in the consumer layout; the field sizes itself to content.
- Do not use it for single-line values just to get a bigger hit target —
  use `input`; sizing belongs to layout.
