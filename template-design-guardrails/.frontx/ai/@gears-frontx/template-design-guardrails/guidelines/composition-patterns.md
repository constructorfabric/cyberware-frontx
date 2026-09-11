---
summary: Fallback screen compositions per archetype; read the section matching the screen archetype.
tier: conditional
loadWhen:
  - authentication or form screens
  - table or list screens
  - dashboard or timeline screens
  - overlay, inspector, or master-detail screens
  - navigation or empty-state screens
  - new screen with no comparable existing composition
---

# Standard: Screen composition patterns

Select the nearest existing product composition first. Use these fallbacks only when the host has no approved equivalent.

## Authentication

Order:

1. product identity;
2. task heading;
3. persistent field labels;
4. primary submit action;
5. necessary recovery routes;
6. service or security context only when required.

Requirements:

- One focused card or bounded region; do not split attention with a decorative marketing panel unless requested.
- Meet the accessibility guideline's authentication rules (password managers, autocomplete, paste, error recovery) and support keyboard submission.
- Model initial, invalid field, invalid credentials, unavailable service, submitting and recovered states.
- Do not invent social login, passwordless login, registration, testimonial or product claim.

## Form or settings page

Order fields by user decision, not storage schema.

- Group related fields under a concise section heading.
- Keep one primary save action and a stable unsaved/saving/saved/failed model.
- Put destructive settings in a separate low-emphasis region.
- Use a review step only when consequence warrants it.
- Do not use disabled fields as ordinary read-only presentation.

## Table/list workbench

Order:

1. page title and primary action;
2. search and filters;
3. result count when useful;
4. table/list;
5. pagination;
6. optional persistent inspector.

Requirements:

- Sorting and column controls follow the anatomy guideline's table rules (column header, directional icon, `aria-sort`).
- Selected-row treatment is shared across screens and does not alter row size.
- Inspector content reflects the selected row; selection addressability follows the anatomy guideline's inspector rule.
- Different rows open different relevant mock content.
- Browser Back restores list context when the host supports routing.
- On narrow widths preserve the primary entity, state and main action before secondary metadata.

## Dashboard

Order by decision:

1. status/goal only if it changes interpretation;
2. highest-priority action;
3. comparable KPI or health widgets;
4. trends or distributions;
5. needs-attention list;
6. evidence/activity route.

Requirements:

- Widget widths follow the data-display guideline's dashboard grid (half and full by default; thirds only for parallel KPI cards with identical anatomy).
- Every chart names timeframe, unit and basis.
- Widgets in a family share anatomy and alignment.
- A metric without evidence or action is not a widget.
- Editing mode is explicit; editing instructions disappear outside editing mode.
- Decorative filler is banned by the foundations hierarchy rule; empty widget space means reducing the span or improving the information (data-display guideline), never decoration.

## Master-detail or inspector

- The list remains the navigation context; the inspector displays the selected object.
- Inspector header contains entity, state and close/overflow controls.
- Put the most consequential action before provenance and diagnostics.
- Use progressive disclosure for raw analysis, model provenance or verbose evidence.
- The inspector's wide/medium/narrow transformation follows the layout guideline's width rules (persistent, then overlay, then full-height layer or route).
- Closing returns focus to the selected row.

## Repository/artifact browser

- Use three regions only when each is needed: project navigation, repository tree, artifact content/details.
- Tree uses the WAI-ARIA Authoring Practices (APG) tree pattern and compact repeated rows.
- Selected node uses a quiet full-width surface; do not use detached accent bars that conflict with other navigation levels.
- Artifact title, path/URL, classification and source revision appear once each.
- Review issues and next actions lead; raw metrics and model details remain collapsed.

## Activity/audit log

- Use a table when comparison across actor, source, type, result and time matters.
- Use a simple semantic dot and explicit result text; type is secondary and should not become a heavy chip.
- Sort direction belongs in the time column header.
- Detail inspector shows result, input, provenance and run timeline without repeating the row.
- Include pagination when not all events are shown.

## Timeline/roadmap

- Expose a time scale, today marker, milestones and state legend.
- Use rows for workstreams/entities and bars for duration.
- Use milestone markers for point events; do not represent everything as a rounded bar.
- Blocked work names blocker and owner.
- Drag interactions require keyboard/button alternatives.
- Provide a list/table view when precise dates and ownership matter more than spatial comparison.

## Empty/error/restricted

State behavior is defined in the accessibility guideline's state rules: name scope, give the next valid action, preserve trustworthy content and active filters, and distinguish no data, no matching data, missing permission and failed loading. Pattern additions:

- Explain what is absent or failed before offering the action.
- Illustration is optional and subordinate; never replace recovery information.

