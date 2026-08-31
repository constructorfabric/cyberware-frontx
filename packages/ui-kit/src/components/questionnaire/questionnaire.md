# Questionnaire

A single-item-at-a-time multi-step form: one question visible at a time,
with progress, required/skip/invalid state, and keyboard shortcuts handled
for you. Behavior comes from **`@shadcn/react/questionnaire`**, a headless,
zero-runtime-dep engine — a dependency deviation from the kit's usual Base
UI foundation, taken because Base UI ships no multi-step-form primitive. This file supplies CSS
Modules styling, composes the kit `Button` for navigation and the kit
`Input` for freeform answers (matching upstream's own composition), and
hand-rolls the choice indicator (see `QuestionnaireChoice`'s doc comment
in `questionnaire.tsx` for why that one piece can't literally reuse the
kit's `Checkbox`/`RadioGroupItem` components).

Composition:

```text
Questionnaire                     root <form>, owns items + current item
├── QuestionnaireProgress
├── QuestionnaireItem             one per question, a <fieldset>
│   ├── QuestionnaireTitle        <legend>, the item's accessible name
│   ├── QuestionnaireDescription
│   ├── QuestionnaireChoices
│   │   ├── QuestionnaireChoice   ...one per fixed answer
│   │   └── QuestionnaireInput    optional freeform answer, last cell
│   └── QuestionnaireError
└── QuestionnaireActions
    ├── QuestionnairePrevious
    ├── QuestionnaireSkip
    ├── QuestionnaireNext
    └── QuestionnaireSubmit
```

## When to use

- A short, focused form best answered one question at a time — onboarding,
  a survey, a setup wizard — where seeing every field at once would
  overwhelm rather than help.

## When not to use

- A form where the user benefits from seeing multiple related fields
  together (an address, a billing profile) — compose `Field`/`Input`/
  `Select` directly instead.
- A long form the user is expected to skim, save, and return to — this
  component has no persistence or free navigation between arbitrary steps
  beyond Previous/Next.

## How advancing actually works

This is the part that most often surprises people, so it is stated plainly:

- **Navigation buttons never disable themselves.** Activating `Next` or
  `Submit` is what *runs* validation and reveals the failure. A disabled
  Next would leave the reader stuck with no explanation.
- **A required item is valid once it has an answer.**
- **An optional item is valid once it has an answer _or_ has been
  explicitly skipped.** An untouched optional item fails validation exactly
  like a required one — `Skip` is its way past, not `Next`.
- **`Submit` re-validates every enabled item**, not just the last one. The
  first failing item becomes active again and gets focus.
- **Skipping clears the item's answer** and removes it from the submitted
  `FormData` entirely. That is what distinguishes "deliberately declined"
  from "not answered yet"; observe it with `QuestionnaireItem`'s
  `onStatusChange` (`'unanswered' | 'answered' | 'skipped'`).
- **Selecting an answer never auto-advances**, including via shortcut.

Because a blocked `Next` is otherwise completely silent, **render a
`QuestionnaireError` inside every item**, not just the required ones. Its
default copy already adapts: "Choose an answer to continue." for a required
item, "Choose an answer or skip this question." for an optional one.

## Keyboard

| Key | Behavior |
|-----|----------|
| `Tab` / `Shift+Tab` | Move between answer controls and visible actions |
| `ArrowUp` / `ArrowDown` | Move between answers within the item; native radios also select |
| `ArrowLeft` | Previous item (when focus is outside a radio or text field) |
| `ArrowRight` | Next item, only once the item is answered or skipped |
| `Space` | Select a radio, toggle a checkbox, activate a focused action |
| `Enter` | Continue from a selected choice or a filled freeform input |
| `Cmd/Ctrl+Enter` | Validate and continue from anywhere; submits on the last item |
| assigned letter/number | Select that choice (with `shortcuts` on); does not advance |

Shortcuts and arrow navigation pause while typing in a text field.

## Props (kit level)

`Questionnaire` (root, a native `<form>`):

| Prop | Type | Notes |
|------|------|-------|
| `items` | `{ name, choices?, required?, disabled? }[]` | The full question list — drives validation, ordering, and shortcut assignment independent of what's actually rendered |
| `item` / `defaultItem` | `string` | Controlled/uncontrolled current item name |
| `onItemChange` | `(item: string) => void` | |
| `shortcuts` | `'letters' \| 'numbers'` | Assigns `A`–`Z` / `1`–`9` to each enabled choice, in `items` order; disabled choices are skipped |
| `noValidate` | `boolean` | Defaults to `true` — suppresses native constraint bubbles while keeping questionnaire validation |

`QuestionnaireProgress`: renders `Question {current} of {total}` as text in
a `role="progressbar"` — it is **not** a bar by default. Pass `children` to
replace the copy, or `render={(props, state) => ...}` to draw a real bar
from `state.current`/`state.total` (see the demo's segmented example).

`QuestionnaireItem`: `name` (matches an `items` entry), `required`,
`multiple` (renders every child `QuestionnaireChoice` as a checkbox
instead of a radio), `invalid` (mark invalid from an external validator),
`disabled` (omit from progress and navigation), `onStatusChange`.

`QuestionnaireChoice`: `value`, `disabled`, `checked`/`defaultChecked`,
`onChange`. Renders the hidden native input, a checkbox-square or
radio-circle indicator (picked automatically from the parent item's
`multiple`), the label text (`children`), and its own shortcut cap.

`QuestionnaireChoiceDescription`: a second line under a choice's label.
Belongs among `QuestionnaireChoice`'s children.

`QuestionnaireInput`: any text `<input>` prop (`type`, `placeholder`,
`maxLength`, ...) plus `render` — defaults to composing the kit `Input`.
Belongs inside `QuestionnaireChoices` when an item offers both fixed
choices and a freeform answer, so the field sits on the choice grid.

Navigation (`QuestionnairePrevious`/`QuestionnaireSkip`/`QuestionnaireNext`/
`QuestionnaireSubmit`), each:

| Prop | Type | Default |
|------|------|---------|
| `variant` | kit `Button` variant | `'outline'` (Previous/Skip), `'default'` (Next/Submit) |
| `size` | kit `Button` size | `'default'` |
| `render` | element to render as | a kit `Button` |

Each is hidden (native `hidden`+`inert`, not just visually) when it
doesn't apply — `Previous` on the first item, `Skip` on a `required` item,
`Next` on the last item, `Submit` before it. `Next` and `Submit` share one
grid cell; exactly one is ever visible.

## Styling hooks

Every part carries data attributes you can key CSS off:

| Part | Attributes |
|------|-----------|
| `Progress` | `data-current`, `data-total`, `data-first`, `data-last` |
| `Item` | `data-active`, `data-status`, `data-required`, `data-multiple`, `data-disabled`, `data-invalid` |
| `Choices` | `data-shortcuts` |
| `Choice` | `data-type` (`radio`/`checkbox`), `data-checked`, `data-unchecked`, `data-disabled`, `data-invalid`, `data-shortcut` |
| `Input` | `data-filled`, `data-empty`, `data-disabled`, `data-invalid` |
| navigation | `data-visible`, `data-hidden`, `data-status`, `data-shortcut` |

> **If you add a `display` declaration to any part that the engine hides**
> (`Item`, `Error`, `ChoiceShortcut`, and the four navigation buttons),
> re-block it with a matching `[hidden] { display: none }` rule. The
> `hidden` attribute is enforced only by the UA stylesheet's
> non-`!important` rule, so any author `display` silently defeats it — and
> the entire questionnaire then paints every question at once.
> `questionnaire.module.css` carries that guard for the parts it styles.

## Deviations from upstream

- **Choice indicator is hand-rolled, not a `Checkbox`/`RadioGroupItem`
  composition.** Those kit components wrap Base UI's `Checkbox`/`Radio`
  primitives, which render as `<span role="checkbox"|"radio">` — never a
  real `<input>`. The questionnaire engine needs its `ChoiceInput` to BE a
  native input (constraint validation, `name`-based radio grouping), so
  this file instead re-implements the same visual language from
  `checkbox.module.css`/`radio-group.module.css` directly here, keyed off
  this element's own `data-type`/`data-checked`/`data-disabled`/
  `data-invalid` attributes.
- **`ChoiceInput`/`ChoiceLabel`/`ChoiceShortcut` are exported standalone.**
  Upstream only uses them internally inside its `QuestionnaireChoice`. This
  kit exports all three too, for a consumer building a fully custom choice
  layout without `QuestionnaireChoice`'s built-in indicator markup.
- **No manual default text.** Upstream's wrapper supplies `children ??
  'Previous'` (and similarly for Skip/Next/Submit/the progress text/the
  error message) because its underlying primitive renders nothing without
  it. The installed `@shadcn/react` version already supplies sensible
  default content for `QuestionnaireProgress`, `QuestionnaireError`, and
  each navigation button — this wrapper only forwards `children`/`render`
  when a consumer wants to override that default, it never hardcodes
  English strings that would need translating.
- **Token-scale spacing.** The kit's spacing scale has no 10px step, so
  upstream's `gap-2.5`/`py-2.5` inside a choice row land on `--space-2`
  (8px) here; the shortcut cap uses the kit's `--text-mono-size`, which
  the Studio blue rebrand moved to 10px — the same size upstream draws.
  Every other measurement (44px row, 8px radius, 16px indicator, 20px cap,
  8px choice gap, 16px item and root gaps) matches upstream exactly.
- **Focus is the kit's field ring.** Upstream draws a 3px translucent halo
  outside the row; the kit's field idiom (`input.module.css`) is a
  recolored border plus an inset ring, so the choice row wears that
  instead — and, per the same kit ruling, an invalid row keeps the
  destructive treatment while focused.

## Examples

```tsx
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@gears-frontx/ui-kit';

const items = [
  {
    name: 'direction',
    choices: [{ value: 'tool-calls' }, { value: 'approvals' }],
    required: true,
  },
  { name: 'signals', choices: [{ value: 'progress' }, { value: 'risks' }] },
];

function Onboarding() {
  return (
    <Questionnaire
      items={items}
      defaultItem="direction"
      shortcuts="letters"
      onSubmit={handleSubmit}
    >
      <QuestionnaireProgress />

      <QuestionnaireItem name="direction" required>
        <QuestionnaireTitle>What should the agent build next?</QuestionnaireTitle>
        <QuestionnaireDescription>Choose a direction or describe another task.</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="tool-calls">
            Tool call timeline
            <QuestionnaireChoiceDescription>
              Show what the agent ran and what came back.
            </QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
          <QuestionnaireChoice value="approvals">
            Approval checkpoints
            <QuestionnaireChoiceDescription>
              Ask before sensitive or destructive actions.
            </QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
          <QuestionnaireInput aria-label="Another feature" placeholder="Describe another feature…" />
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>

      {/* `multiple` turns the radios into checkboxes; read with getAll(). */}
      <QuestionnaireItem name="signals" multiple>
        <QuestionnaireTitle>What should every update include?</QuestionnaireTitle>
        <QuestionnaireDescription>Select all that apply, or skip this question.</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="progress">Progress</QuestionnaireChoice>
          <QuestionnaireChoice value="risks">Risks</QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>

      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit>Save plan</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}
```

Reading the result — a `multiple` item submits one entry per checked
choice, and a skipped item submits nothing:

```tsx
function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const answers = {
    direction: data.get('direction'),
    signals: data.getAll('signals'), // [] when skipped
  };
}
```

## Anti-patterns

- Do not omit `QuestionnaireError` from an item because it is optional — a
  failed `Next` on an untouched optional item is then completely silent.
- Do not nest a `QuestionnaireChoiceShortcut` inside a
  `QuestionnaireChoice`'s children. `QuestionnaireChoice` already renders
  one; a second produces two key caps on the same row. The standalone
  export is for choice layouts built without `QuestionnaireChoice`.
- Do not render a `QuestionnaireChoice` for a value missing from the
  parent `QuestionnaireItem`'s `choices` in `items` — the engine warns
  (console) and the choice won't participate in validation/shortcuts.
- Do not reach for `Checkbox`/`RadioGroupItem` to restyle
  `QuestionnaireChoice`'s indicator — see "Deviations" above for why that
  swap breaks native input semantics the engine depends on. Restyle via
  `questionnaire.module.css`'s own classes/tokens instead.
- Do not assume `QuestionnaireNext`/`QuestionnaireSubmit` are mutually
  exclusive by conditional rendering — both should always be mounted
  (matching the examples above); the primitive hides whichever doesn't
  apply, which is also what lets its transition-free `hidden` swap happen
  without a flash of the wrong button.
- Do not gate `Next` behind your own `disabled` unless you also surface why
  it is blocked; the built-in design deliberately keeps it enabled so the
  error can speak.
