# Workflow: Generate a FrontX interface

Use with `generate-interface`. Steps mirror the skill's Establish/Plan sections.

Escalation rule: see final step — stop and ask only for permissions/persistence/navigation/irreversible decisions.

1. Read installed template manifests and `@gears-frontx/ui-kit/llms.txt`. If these, or the routed guidelines, cannot be found or read, report **environment unavailable** — naming the missing file and how to supply it — and stop rather than proceeding on assumptions.
2. Load `design-contract.json`, `quality-gates.json`, `component-state-matrix.json`, `layout-contract.json`, and `guideline-index.json`; route the guideline load through the index (core tier always, conditional tiers by matched `loadWhen` trigger, everything on no confident match) and name the routing decision; list applicable quality-gate IDs. If any of these cannot be found or read, report **contract unavailable** — naming the missing file — and stop.
3. Define the user job, primary action, authoritative data, density and applicable states.
4. Select one composition from `composition-patterns.md` or document why a new pattern is necessary.
5. Produce a short implementation brief:
   - components;
   - semantic tokens;
   - grid/alignment;
   - wide-medium-narrow transformations;
   - states;
   - keyboard/focus;
   - motion;
   - non-goals.
6. Build semantic structure and interaction behavior before visual polish.
7. Apply tokens and the established composition layer. Do not restyle kit internals.
8. Implement applicable state behavior:
   - loading;
   - empty;
   - partial;
   - error;
   - restricted;
   - pending;
   - success.
9. Check the component-state matrix and relevant quality gates. While iterating, scope type-check/test runs to the owning workspace or config; run the full project gate exactly once, when the screen is complete.
10. When the app can run, hand the rendered result to `verify-interface` before returning; otherwise report composition as unverified.
11. Cross-check the return against every item promised in the step-5 brief; flag any dropped item.
12. Return changed files, applicable states, responsive behavior and unresolved/unverified gaps. Return shape: the skill's `## Output` section is the full contract — this step is its condensed form.

Stop and ask for product input when an unresolved decision changes permissions, persistence, navigation, or an action that deletes data, sends a communication, or cannot be undone. State the recommended conservative default and the alternative, and how to reply; the workflow resumes at the interrupted step once answered. On an ambiguous reply, ask one targeted follow-up, then apply the most conservative default and flag it. Make conservative visual assumptions explicit and continue (e.g., prefer hiding a feature over guessing its enabled state).
