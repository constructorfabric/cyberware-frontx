// The CLI's reserved temporary-file naming convention: a single formulation
// shared by its two consumers so they can never drift apart into two
// different ideas of "the reserved name."
//
// Consumer 1 - the upgrade change-set engine's own commit algorithm
// (`cpt-frontx-feature-upgrade-changeset`, `inst-com-materialize-temp`):
// for every ADD/REPLACE operation, it materializes new content into a
// temporary file beside its destination path, named by appending this
// suffix to the destination's own filename, so a crash mid-write leaves
// litter that is never mistaken for a developer's own file.
//
// Consumer 2 - the template-manifest content self-containment check
// (`cpt-frontx-algo-template-manifest-validate-content-self-containment`,
// `inst-csc-if-reserved-name`): a published template's payload must never
// carry a path that already collides with this convention, since an
// upgrade's write phase excludes any such path from every comparison - a
// payload path shaped like the engine's own scratch file would never be
// classified, written, or reported once applied, so it is not admissible
// payload in the first place.
//
// One rule, defined once, so neither consumer can independently redefine
// what "reserved" means.
export const RESERVED_TEMP_SUFFIX = '.frontx-upgrade-tmp';

// Whether `pathValue` (a full or relative path) carries the reserved
// temporary-file suffix on ANY of its path segments - not only its final
// filename - compared case-insensitively.
//
// Consumer 1 appends the suffix to a destination FILENAME, so every path it
// ever creates carries the suffix on its own last segment. This predicate is
// deliberately WIDER than that, and the widening belongs entirely to
// consumer 2's side of the contract: what a published payload is allowed to
// carry, not what the engine writes.
//
// A payload DIRECTORY named `evil.frontx-upgrade-tmp/` is refused for the
// same reason a file with that name is: every path beneath it carries the
// reserved suffix in an ancestor segment, and nothing downstream that
// reasons about the convention can then tell that ground apart from the
// engine's own scratch space. Case-insensitively, because APFS (the macOS
// default) and NTFS are both case-insensitive: a payload file spelled
// `FOO.FRONTX-UPGRADE-TMP` is the SAME on-disk file as the engine's temp for
// a destination named `FOO`, even though a case-sensitive string comparison
// would call them different names.
//
// A published template loses nothing by this: it may not carry the reserved
// name in any spelling or at any depth, which is one rule, stated once, in
// one place both consumers read.
export function isReservedTempName(pathValue: string): boolean {
  const suffixLower = RESERVED_TEMP_SUFFIX.toLowerCase();
  return pathValue
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment.toLowerCase().endsWith(suffixLower));
}
