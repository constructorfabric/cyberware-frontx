// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-constraint:cpt-frontx-constraint-cli-template-independence:p1
//
// SCOPE DECISION (checkpoint 3, made by the developer, not the architect):
// `seed`'s own FEATURE text ("Seed a New or Empty Repository") assumes a
// concept — "the CLI's built-in official default origins" — that no module
// in this codebase declared anywhere before this checkpoint. `seed` accepts
// ONLY these defaults (nothing else can be registered against yet, by the
// flow's own error scenario), so SOME concrete list has to exist for `seed`
// to be implementable at all.
//
// That list is NOT authored here. It is generated into
// `../generated/official-defaults.ts` at build time by
// `scripts/generate-cli-official-defaults.mjs`, from this repo's own
// templates discovered by manifest presence (ADR-0018) — because
// `cpt-frontx-constraint-cli-template-independence` (CLI-1) forbids a
// hardcoded template package name anywhere in `packages/cli/src`, and
// `arch:check` fails on one. A hand-written map naming this repo's two
// templates is exactly the compile-time dependency that boundary exists to
// prevent; see the generator's own header for the full reasoning and for the
// known limitation a generated `path:` origin carries for a published CLI.
//
// Still a scope decision rather than a product one, and the product half is a
// recorded deferral rather than an open question: the root DECOMPOSITION's
// conversion work item (`cpt-frontx-feature-template-territory-conversion`)
// carries it. Until that move happens every generated origin stays a local
// `path:` form resolvable against this checkout alone, so `seed` does not
// work outside it — the consequence CLI DESIGN states as the third of its
// architectural facts. Nothing here is shaped in anticipation of the move;
// when it lands, the generator emits origins naming wherever the templates
// then live and this module is unchanged.
//
// Keyed by each template's OWN manifest-declared `name` (the identity
// `register`/`apply`/`uniformApply` key every other lookup in this feature
// by) — never by a short alias or a directory name — so a batch entry
// resolves unambiguously to the same identity `list`/`register` would report
// for it once installed.
import { OFFICIAL_DEFAULT_TEMPLATES } from '../generated/official-defaults';

export { OFFICIAL_DEFAULT_TEMPLATES };

/**
 * The registered origin for `name`, when `name` is one of the CLI's official
 * default templates (see this file's own header for what that list is, is
 * not, and where it comes from) — `undefined` otherwise, which
 * `seedRepository` (`./seed-repository.ts`) treats as "not an official
 * default" and refuses with `TEMPLATE_NOT_REGISTERED`.
 */
export function officialDefaultOrigin(name: string): string | undefined {
  return OFFICIAL_DEFAULT_TEMPLATES[name];
}
