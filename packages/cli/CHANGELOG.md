# Changelog — `@gears-frontx/cli`

> **TARGET AUDIENCE:** Humans
> **PURPOSE:** Notable changes to the `frontx` command surface

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Only changes a caller can observe are recorded here — the accepted argument
shape, the `--json` envelope, error codes and exit codes. Internal
refactoring is not.

## [Unreleased]

### Changed

- **Breaking:** `--yes` is refused on `delete` and `upgrade` when `--json` is
  absent, exiting with the user-error code and naming `--json --yes`. Both
  confirmation gates define `--yes` as the second call of the `--json`
  protocol, so interactive mode asked for confirmation regardless — and with
  no terminal attached, the prompt read end-of-input, took its declared `No`
  default and exited successfully having done nothing. A script running
  `frontx delete <target> --yes` got a silent no-op reported as success;
  it now gets a refusal that names the form that works.
  `delete <target> --dry-run --yes` is still accepted: a dry run reaches no
  confirmation gate for `--yes` to suppress.

- **Breaking:** a `.frontx/project.json` a previous version accepted can now
  be `PROJECT_INVALID`. `templates[name].excludedSubtrees` is validated the
  way a manifest's own declaration is, and a malformed value — not an array,
  a non-string element, an empty string, one escaping the target — makes the
  whole document invalid for every command that reads it, `validate --project`
  included. Previously such a document was accepted: a number crashed `delete`
  with a raw error and exit 2, and `[""]` made it delete the payload and the
  developer's protected file under `ok:true`.

- **Breaking:** two spellings of one directory are one ground on a
  case-insensitive volume (APFS, NTFS). A batch naming `app` and `App` is
  refused with `TARGET_CONFLICT` instead of applying two templates onto one
  directory, `ownership` answers the same way for either spelling, and a path
  spelled in another case is no longer refused as `INVALID_PATH`. On a
  case-sensitive volume the two remain independent targets, as they genuinely
  are. Which rule applies is decided by probing the volume, never by the
  operating system name.

- **Breaking:** a target whose first segment is a literal `~` is refused. It
  reaches the CLI only when the shell did not expand it, and resolving it
  literally created a directory named `~` inside the project and reported
  success.

- `delete` resolves the owning template's declared exclusions as the UNION of
  the declaration recorded in `.frontx/project.json` and the one its current
  manifest declares, and reports `exclusionsDrift` when the two disagree.
  Narrowing a vendored manifest after applying no longer moves a
  previously protected file into `toDelete`; a vanished origin still cannot
  widen the plan. `apply`, `assemble` and `ownership` continue to use the
  current declaration alone — they materialise what the manifest says today,
  which is a different question.

- `register`/`register --replace` and `upgrade` landing on the origin already
  recorded now report `recorded` (register) or a `recordedExclusions` field
  (upgrade) when they write a declaration the entry was missing, instead of
  reporting a plain no-op after a write.

### Added

- `.frontx/project.json` entries carry the template's declared
  `excludedSubtrees`, and `list --json` reports the recorded value. A deletion
  plan no longer depends on a `path:` origin folder still being on disk —
  vendoring one into the project and removing it again is the ordinary
  lifecycle.

- `unregister` drops an entry whose origin can no longer be resolved and which
  carries no recorded declaration, even when its `targets[]` is non-empty,
  reporting `orphan-dropped` with the targets it orphaned and leaving every
  file on disk. Such an entry could not yield a deletion plan and could not be
  re-registered, so nothing could remove it. `TARGETS_EXIST` is unchanged for
  every other case, including an origin that is merely unreadable.

- `frontx help` documents `FRONTX_INVENTORY_ROOT` and `GITHUB_TOKEN`.

### Fixed

- `apply` no longer writes a payload read from outside the local inventory
  store when the installed content path is a symlink leading out of it.

- `upgrade` no longer aborts with an internal error and a raw `ENOTDIR` when a
  non-directory stands at a scope component of `.frontx/ai/`; it reclaims it
  exactly as `apply` already did, and a containment escape from that step is
  reported as `INVALID_PATH` by both commands rather than as an internal
  failure by one of them.

- The AI-extension bundle is no longer cleared through a symlinked scope
  component that leads out of `.frontx/ai/`, which removed a developer's own
  files under `ok:true`. Such a destination is refused; a link that resolves
  back inside `.frontx/ai/` is still followed.
