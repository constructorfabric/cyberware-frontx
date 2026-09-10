# Progress

A bar communicating the completion of a task. Wraps the Base UI Progress
primitive (Root/Track/Indicator/Label/Value): reports `role="progressbar"`
with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` to screen readers.

## When to use

- A determinate, long-running task with a known percentage: upload,
  import, multi-step onboarding.
- An indeterminate task (unknown duration) — pass `value={null}`.

## When not to use

- A short async action with no meaningful percentage — a `Button`'s
  `loading` spinner reads better.
- Step-by-step navigation where the steps themselves are the UI — a
  dedicated stepper/wizard component fits better than a bar.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `value` | current value, or `null` for indeterminate — **required** | — |
| `min` / `max` | bounds of the scale | `0` / `100` |
| `className` | `string` — merged after the kit class | — |

`ProgressTrack`, `ProgressIndicator`, `ProgressLabel`, `ProgressValue` are
also exported standalone for composing a custom layout (e.g. a label row
above the bar) instead of the `Progress` convenience wrapper's default
Track+Indicator. All forward Base UI's own props for that part.

## Examples

```tsx
import { Progress, ProgressLabel, ProgressValue } from '@gears-frontx/ui-kit';

// Determinate
<Progress value={64} aria-label="Uploading" />

// Indeterminate
<Progress value={null} aria-label="Importing" />

// Composed: label + live percentage above the bar
<Progress value={progress}>
  <ProgressLabel>Uploading</ProgressLabel>
  <ProgressValue />
</Progress>
```

## Anti-patterns

- Do not render one without `aria-label`/`aria-labelledby`, or a
  `ProgressLabel` when composing manually — the bar reports a value but
  needs a name for what it's the progress *of*.
- Do not fake an indeterminate look with a stuck `value` — pass
  `value={null}`; the indicator otherwise reports a false, static
  percentage to assistive tech.
