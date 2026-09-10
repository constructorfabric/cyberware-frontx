---
summary: Information order, labels and copy rules, type hierarchy, and iconography.
tier: conditional
loadWhen:
  - form screens
  - authentication screens
  - content-heavy or copy-sensitive surfaces
---

# Standard: Typography, content and iconography

## Information order

Write in this order:

1. entity or result;
2. state or consequence;
3. evidence or scope;
4. next action.

Do not begin with system implementation details when the user needs a decision.

## Headings and labels

- Use one page title.
- Section headings name content, not layout: `Source health`, not `Widget 3`.
- Control labels name the value being selected: `Status`, not `Choose an option`.
- Button labels describe the effect: `Reconnect source`, `Invite member`, `Save policy`.
- Use sentence case unless the installed product specifies another convention.
- Avoid redundant eyebrow, title and subtitle stacks. Use an eyebrow only when it contributes scope unavailable elsewhere.

## Supporting text

- Supporting text explains consequence, provenance or recovery.
- Remove text that restates a heading, count, selected tab or obvious control behavior.
- Keep instructions near the action they explain.
- Use progressive disclosure for model provenance, raw metrics and diagnostic detail.
- Do not use marketing adjectives in operational UI.

## Errors and confirmations

- Name the affected object.
- Explain the consequence.
- Give the next safe action.
- Preserve trustworthy context and entered data.

Better: `The product repository could not be refreshed. The previous snapshot is still available. Reconnect the source.`

Worse: `Something went wrong. Try again.`

## Numbers, dates and machine data

- Use tabular numerals in comparable columns and KPI sets.
- Always expose units and comparison basis.
- Use locale-aware formatting for dates and numbers.
- Relative time **SHOULD** expose an exact timestamp on hover/focus when precision matters.
- IDs, commits, paths and code use the installed monospace role; ordinary labels do not.
- Do not break a number from its unit across lines.

## Truncation

- Never truncate the only primary action or state.
- Prefer wrapping titles before shrinking type.
- Paths and hashes may use middle truncation when the beginning and end both matter.
- A truncated value **MUST** have a keyboard-accessible way to reveal or copy the full value.

## Iconography

- Icons reinforce, not replace, unfamiliar text.
- Status tables **SHOULD** use a simple dot plus label rather than a unique decorative icon per row.
- Sort indicators follow the installed table pattern: use the same indicator the kit's sortable table header uses, on every sortable column, and set `aria-sort` on the sorted header. Do not invent a second sort glyph, and do not reuse the sort indicator for disclosure.
- External-link icons are small secondary affordances next to the relevant link, not oversized standalone actions.
- The same action **MUST** use the same icon and label across screens.

## Content rejection examples

Reject:

- `Learn more`, `Click here`, `Open`, `Next` when a specific result is known;
- three lines of helper copy under every title;
- status labels that wrap because columns are too narrow;
- unexplained acronyms in primary UI;
- `V` or text glyphs standing in for chevrons;
- decorative icons in tables that convey no additional meaning.

