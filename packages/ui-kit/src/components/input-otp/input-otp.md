# InputOtp

A one-time-passcode entry: one input slot per character, with paste,
auto-advance, and completion handling built in. Built on Base UI's
`OTPField` primitive (Root/Input/Separator).

## When to use

- Verification codes: SMS/email OTP, 2FA, magic-link fallback codes.

## When not to use

- Free-form short text (a promo code, a postal code) — use `input`.
- A single numeric field — use `input` with `inputMode="numeric"`.

## Props (kit level)

`InputOtp` (the root):

| Prop | Type | Default |
|------|------|---------|
| `length` | number of character slots — **required** | — |
| `value` / `defaultValue` | controlled / uncontrolled OTP string | — |
| `onValueChange` | `(value: string, eventDetails) => void` | — |
| `onValueComplete` | `(value: string, eventDetails) => void`, fires once every slot is filled | — |
| `validationType` | `'numeric'` \| `'alphanumeric'` \| ... — filters typed/pasted characters | `'numeric'` |
| `mask` | mask entered characters (password-style) | `false` |
| `autoSubmit` | submit the owning form once complete | `false` |
| `disabled` / `readOnly` / `required` | `boolean` | `false` |
| `className` | `string` — merged after the kit class | — |

`InputOtpGroup`: a plain `<div>` — purely visual, groups a run of
`InputOtpSlot`s so an `InputOtpSeparator` can sit between groups (e.g.
`123` `456`).

`InputOtpSlot`: one character input. No `index` prop to pass — Base UI
derives each slot's position from render order automatically. Other props
follow Base UI `OTPField.Input`.

`InputOtpSeparator`: a decorative divider between groups; defaults to a
dash, override via children.

## Examples

```tsx
import { InputOtp, InputOtpGroup, InputOtpSeparator, InputOtpSlot } from '@gears-frontx/ui-kit';

// Six digits in two groups of three
<label htmlFor="otp">Verification code</label>
<InputOtp id="otp" length={6} onValueComplete={verify}>
  <InputOtpGroup>
    <InputOtpSlot />
    <InputOtpSlot />
    <InputOtpSlot />
  </InputOtpGroup>
  <InputOtpSeparator />
  <InputOtpGroup>
    <InputOtpSlot />
    <InputOtpSlot />
    <InputOtpSlot />
  </InputOtpGroup>
</InputOtp>

// Controlled
<InputOtp length={4} value={code} onValueChange={setCode}>
  <InputOtpGroup>
    <InputOtpSlot />
    <InputOtpSlot />
    <InputOtpSlot />
    <InputOtpSlot />
  </InputOtpGroup>
</InputOtp>
```

## Anti-patterns

- Do not put `aria-label` on the first slot expecting it to label the
  whole field — Base UI ignores `aria-label` on slot index 0 (it warns in
  development) because a single-slot label doesn't describe a multi-slot
  control; label the field with a `<label htmlFor={rootId}>` (or
  `Field.Label`) pointing at the root's `id` instead, as in the example
  above.
- Do not render fewer/more `InputOtpSlot`s than `length` — completion
  detection and paste handling both key off that count matching exactly.

## Deviation from upstream

Upstream (`registry/bases/base/ui/input-otp.tsx`) wraps the third-party
`input-otp` npm package: its `OTPInput` renders ONE shared, visually
hidden native `<input>`, and every visible "slot" is a plain decorative
`<div>` that reads its character, active, and fake-caret state from React
context (`OTPInputContext`).

This kit instead builds on Base UI's `OTPField` primitive (stable since
our pinned `@base-ui/react` 1.6.0), which takes a structurally different
approach: it renders one REAL `<input>` PER SLOT, and derives each
input's position from render order via an internal composite list rather
than an explicit index prop or a shared context read. Consequences:

- `InputOtpSlot` IS the character input, not a context-driven display
  div — no `index` prop to pass, no `OTPInputContext` to read from.
- The caret-blink effect (kept, as requested, as a CSS Modules keyframe —
  see `input-otp.module.css`'s `input-otp-caret-blink`) is plain CSS on
  the slot itself (`:focus:not([data-filled])::after`), not a JS-computed
  `hasFakeCaret` flag threaded through context: with a real per-slot
  input, "is this the active, still-empty slot" is exactly what
  `:focus:not([data-filled])` already answers natively.
- `InputOtpSeparator` wraps Base UI's own `OTPField.Separator` part
  (`@base-ui/react/otp-field` re-exports `@base-ui/react/separator`)
  rather than a plain decorative div — it already carries
  `role="separator"`.

The exported part names mirror upstream's (`InputOtp`/`InputOtpGroup`/
`InputOtpSlot`/`InputOtpSeparator` for upstream's `InputOTP`/
`InputOTPGroup`/`InputOTPSlot`/`InputOTPSeparator`) as closely as the
different primitive underneath allows.
