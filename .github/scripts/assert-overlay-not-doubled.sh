#!/usr/bin/env bash
# Fails when an overlay's declared composition target has been re-created a
# second time inside itself — the doubled-path defect PR #586 review found
# (`src-app/mfe_packages/src-app/mfe_packages/...`, the overlay's payload
# still carrying its own ownership-prefixed root instead of being rooted at
# the overlay's top level).
#
# Extracted into its own script, rather than left inline in the
# `template-validate` job's "Validate shell + overlay composition" step, so
# the workflow's own "Self-test composition guard against a doubled tree"
# step can call the IDENTICAL check a real composition run uses. A guard
# duplicated between the real step and its self-test would let a future edit
# that weakens the real check slip past unnoticed, since the copy would keep
# passing on its own; calling the one script from both places is what makes
# the self-test prove anything about the guard actually in effect.
#
# Usage: assert-overlay-not-doubled.sh <dest> <target> <overlay-name>
#   <dest>    the shell-relative directory the overlay was just copied into
#             (main.yml's own "$shell/$target")
#   <target>  the overlay's declared composition target, relative to <dest>'s
#             own parent (main.yml's own OVERLAY_TARGETS entry)
#   <overlay-name> the overlay's name, for the error message only
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "::error::assert-overlay-not-doubled.sh requires <dest> <target> <overlay-name>, got $#: $*" >&2
  exit 2
fi

dest="$1"
target="$2"
overlay="$3"

if [ -d "$dest/$target" ]; then
  echo "::error::$overlay composed a nested copy of its own target path at $dest/$target — the payload was not re-rooted at the overlay's own top level"
  exit 1
fi
