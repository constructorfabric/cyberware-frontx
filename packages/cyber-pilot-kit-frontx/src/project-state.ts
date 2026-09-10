// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-template-ai-extensions-contract-conformance:p1
//
// Structural mirror of the project's SINGLE state document
// (`packages/cli/src/project-state/types.ts`'s `ProjectStateDocument`,
// `cpt-frontx-contract-project-provenance`) — mirrored, not imported,
// because this kit has no dependency on `@gears-frontx/cli` (root DESIGN
// §3.4; ADR-0027). A repository holds ONE document, keyed by registered
// template NAME, with exactly one `TemplateEntry` per name — never a single
// whole-repository origin and never a per-target origin/version.
//
// TWO features in this kit read this document — F17's AI-driven upgrade
// orchestration (`upgrade-orchestration/`) and F16's template AI-extension
// trust gate (`extensions/`) — so this shape lives in exactly ONE place
// (this module) rather than being mirrored twice and risking the two
// mirrors drifting apart. Both features import it from here; neither
// re-declares it.
export interface PreviousOrigin {
  origin: string;
  version: string;
}

export interface TemplateEntry {
  origin: string;
  version: string;
  targets: string[];
  previous?: PreviousOrigin;
}

export interface ProjectStateDocument {
  formatVersion: 1;
  templates: Record<string, TemplateEntry>;
  projectOwnedRoots: string[];
}

// Looks up the `TemplateEntry` for the NAMED template in the project's
// single state document — `undefined` when the document's `templates` map
// holds no matching entry. A lookup, not a search: `templates` is already
// keyed by name.
export function selectTemplateEntry(document: ProjectStateDocument, templateName: string): TemplateEntry | undefined {
  return document.templates[templateName];
}
