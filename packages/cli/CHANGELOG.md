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

### Added

- `.frontx/project.json` entries carry the template's declared
  `excludedSubtrees`, and `list --json` reports it. A deletion plan no longer
  depends on a `path:` origin folder still being on disk — vendoring one into
  the project and removing it again is the ordinary lifecycle. A malformed
  value makes the whole document `PROJECT_INVALID` for every command that
  reads it.
