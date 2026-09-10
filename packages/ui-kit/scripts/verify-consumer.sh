#!/usr/bin/env bash
# Acceptance check #1: the packed @gears-frontx/ui-kit installs into a clean
# Vite project and the project builds a page that uses the kit's components
# and CSS. Run from anywhere; requires npm and node. `npm pack` works on a
# private package — only `publish` is blocked.
#
# Since the per-entry repackaging (see design-notes.md's Architecture
# section), this is also the tree-shaking proof: every consumer page below
# imports only `Button`. A bundle that pulled in every component regardless
# of what's imported (the old single dist/index.js + dist/index.css defect)
# would still pass a presence-only check, so this script asserts BOTH
# directions — Button's hashed class/CSS present, and a hashed class/CSS
# from a component the page never imported (Table, Dialog — both have large,
# distinctive CSS) absent.
#
# FOUR bundler-facing legs, not one, plus a types leg. This is not
# belt-and-braces — each guards something the others provably do not:
#
#   - [vite]: the ecosystem's own tooling; primary consumer check.
#   - [esbuild-barrel]: importing the barrel (`@gears-frontx/ui-kit`)
#     through raw esbuild. Measured directly: Vite's production build goes
#     through Rollup, whose tree-shaking already cascades "this ui-kit
#     wrapper export is unused" through to "therefore the Base UI submodule
#     it exclusively imported is unused too" — true even against the
#     *pre-repackaging* single dist/index.js (grepped the old build's Vite
#     consumer output for Select/Menu/Toast/FloatingFocusManager identifiers:
#     absent). Raw esbuild's bundler does not cascade that elimination: a
#     Button-only page bundled with esbuild against the pre-repackaging
#     tarball retained ~614KB unminified / 233KB minified of unreached Base
#     UI internals (SelectRoot, MenuRoot, ToastRoot, FloatingFocusManager,
#     @floating-ui/dom — none reachable from Button), solely because they
#     were all unconditionally imported somewhere in the one bundled
#     dist/index.js. So a Vite-only gate would prove the CSS fix but
#     silently miss this JS regression. `/* @__PURE__ */` on the kit's
#     cva() calls does not fix it either (verified: byte-identical esbuild
#     output with and without the annotation on button/card/tabs/select/
#     switch/dropdown-menu/badge) — the retention is Base UI's own
#     submodules, unrelated to the kit's variant-styling calls. This leg
#     guards a real, previously-invisible consumer-facing regression; it is
#     not redundant with [vite] and should not be deleted as such. (The
#     numbers above are from that investigation, built with --minify; this
#     leg itself deliberately builds unminified — see the comment at its
#     esbuild invocation for why minifying would break its own probes.)
#   - [esbuild-subpath]: importing a component's own subpath
#     (`@gears-frontx/ui-kit/button`) through raw esbuild. Exists because of
#     a second, independent esbuild finding: esbuild does not tree-shake CSS
#     the way it tree-shakes JS. A BARREL import bundled with esbuild
#     correctly drops unreached components' JS (proven by [esbuild-barrel]
#     above) but still ships every component's CSS regardless — swept
#     `sideEffects` as `["**/*.css"]`, `["*.css"]`, and `false` and got the
#     same full-CSS result every time, so this is not a `sideEffects` bug to
#     fix; esbuild collects CSS from the whole reachable module graph
#     independently of which JS bindings survive tree-shaking. Importing a
#     component's SUBPATH instead resolves straight to that component's own
#     chunk, whose module graph never reaches the other 18 components' CSS
#     in the first place — which is why this leg, uniquely, asserts CSS
#     presence/absence rather than JS. Do not fold this into
#     [esbuild-barrel]'s assertions: a barrel entry cannot pass a CSS-absence
#     check under esbuild today, and asserting it there would either be a
#     permanently-red check or a silently-weakened one.
#   - [webpack]: the barrel import through webpack 5 in production mode.
#     Exists because webpack is the one bundler here that actually READS
#     `sideEffects` from package.json — and the one bundler none of the
#     other legs run. Mutation-tested: with `sideEffects` flipped to
#     `false` (a plausible-looking future "simplification"), webpack
#     silently drops every component's CSS import as dead code — Button's
#     own styles included — while [vite], both [esbuild-*] legs and
#     [types] all stay green (Vite re-marks CSS side-effectful in its own
#     CSS plugin; esbuild ignores the field for CSS entirely). So the exact
#     regression that would blank out every webpack consumer — and
#     insight-front, the kit's first declared consumer, builds with
#     webpack — was invisible to the whole gate. This leg's CSS-presence
#     assertion is the guard; its absence assertions also prove webpack's
#     sideEffects-driven pruning keeps working in the wanted direction
#     (unused components' CSS *should* drop out of a barrel build).
#   - [types]: `tsc` under both `moduleResolution: "nodenext"` and
#     `"bundler"`, for the barrel and three subpaths. Exists because the
#     per-entry repackaging's relative `.d.ts` specifiers are a types-only
#     surface no test above exercises — a nodenext consumer rejecting every
#     symbol in the package is invisible to unit tests, `tsc --noEmit` on
#     the kit's own source (which uses `bundler` resolution), and every
#     bundler leg above (runtime resolution was never broken, only the
#     types). This regressed once already; this leg exists so it cannot
#     regress silently a second time.
set -euo pipefail

UIKIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Pinned to the versions the monorepo itself resolves, so this acceptance check
# reports on the kit and never reddens because Vite or React shipped a release.
# Keep in step with the root package.json / template-shell pins.
REACT_VERSION="19.2.8"
VITE_VERSION="6.4.3"
PLUGIN_REACT_VERSION="4.3.4"
TYPESCRIPT_VERSION="5.4.2"
# Matches the root package.json `overrides.esbuild` pin (a CVE fix), so this
# script never resolves a different esbuild than the rest of the monorepo.
ESBUILD_VERSION="0.25.12"
# The webpack toolchain has no in-monorepo counterpart to stay in step with
# (nothing here builds with webpack — that's exactly why the [webpack] leg
# exists); pinned so the leg reports on the kit, not on a webpack release.
WEBPACK_VERSION="5.109.2"
WEBPACK_CLI_VERSION="7.2.2"
CSS_LOADER_VERSION="7.1.4"
MINI_CSS_EXTRACT_VERSION="2.10.2"

echo "==> Building and packing @gears-frontx/ui-kit"
cd "$UIKIT_DIR"
npm run build >/dev/null
npm pack --pack-destination "$WORKDIR" >/dev/null
TARBALL="$(ls "$WORKDIR"/gears-frontx-ui-kit-*.tgz)"

# Hashed CSS-module class names are the only reliable tree-shaking probe: a
# minifier renames or inlines source-level identifiers, but a hashed class
# literal (used identically as a JS string and a CSS selector) survives
# minification verbatim. Pulled from the just-built dist/, not hardcoded,
# so this script never drifts out of sync with a real CSS content change.
#
# The `|| true` matters: under `set -e`, a bare `grep | head` whose grep
# finds nothing makes the *assignment itself* exit non-zero (pipefail
# propagates grep's failure through head's success), which kills the script
# at the assignment — before the explicit empty-value check below ever
# runs, so its diagnostic message never prints. `|| true` neutralizes that,
# so an empty extraction is caught (and named) by the check that follows,
# not by an unexplained script death.
extract_hashed_class() {
  # $1: dist chunk file, $2: local class name to find a hashed literal for
  grep -oE "_$2_[A-Za-z0-9]+_[0-9]+" "$1" 2>/dev/null | head -1 || true
}

BUTTON_CLASS="$(extract_hashed_class "$UIKIT_DIR/dist/button.js" 'variantOutline')"
TABLE_CLASS="$(extract_hashed_class "$UIKIT_DIR/dist/table.js" 'tableCaption')"
DIALOG_CLASS="$(extract_hashed_class "$UIKIT_DIR/dist/dialog.js" 'backdrop')"
for probe_name in BUTTON_CLASS TABLE_CLASS DIALOG_CLASS; do
  if [ -z "${!probe_name}" ]; then
    echo "FAIL: could not extract a hashed class probe ($probe_name) from dist/ — did a component's local class names change?"
    exit 1
  fi
done
echo "==> Probes: Button=$BUTTON_CLASS Table=$TABLE_CLASS Dialog=$DIALOG_CLASS"

# 'use client' regression guard (#568): asserted against the kit's OWN
# dist/, not a consumer bundle — an RSC framework like Next.js reads the
# directive straight off the installed package's chunks, before any of this
# script's bundler legs run, so none of them would catch it drifting. Split
# by hook usage, not by any other property: badge/breadcrumb/button-group/
# dropdown-menu/toast call a hook directly in their own render body
# (useRender/useContext/useToastManager — see buildPlugin.ts's
# preserveUseClientPlugin comment); everything else only composes Base UI
# primitives as JSX, which already carry their own directive in Base UI's
# dist, so marking them here would take server-renderability away for no
# reason. input-group/native-select/pagination compose Button/Input/
# Textarea/Separator as plain JSX (no hook of their own), same as card/
# table/tabs above.
CLIENT_COMPONENTS=(attachment badge breadcrumb bubble button-group carousel chart combobox context-menu data-table drawer dropdown-menu marker sidebar toast)
SERVER_COMPONENTS=(accordion alert alert-dialog aspect-ratio avatar button calendar card checkbox collapsible command date-picker dialog direction empty field hover-card input input-group input-otp item kbd label menubar message message-scroller native-select navigation-menu pagination popover progress questionnaire radio-group resizable scroll-area select separator sheet skeleton slider spinner switch table tabs textarea toggle toggle-group tooltip)

in_list() {
  # $1: needle, $2+: haystack
  local needle="$1" item
  shift
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

count_matches() {
  # $1: needle, $2+: haystack — total occurrences, not just presence, so a
  # name duplicated within one list (or repeated across both) is caught
  # too, not just membership.
  local needle="$1" item count=0
  shift
  for item in "$@"; do
    [ "$item" = "$needle" ] && count=$((count + 1))
  done
  echo "$count"
}

# The two lists above are hand-maintained, so a component added to (or
# removed from) src/components/ without a matching edit here would
# otherwise go unchecked by both loops below, silently. Diff the lists
# against the build's own entry glob (getBuildConfig's source of truth in
# buildPlugin.ts) instead of trusting them: every real component must be
# classified exactly once, and every classified name must be real.
ALL_COMPONENTS=()
for entry in "$UIKIT_DIR"/src/components/*/public.ts; do
  ALL_COMPONENTS+=("$(basename "$(dirname "$entry")")")
done

for name in "${ALL_COMPONENTS[@]}"; do
  count="$(count_matches "$name" "${CLIENT_COMPONENTS[@]}" "${SERVER_COMPONENTS[@]}")"
  if [ "$count" -eq 0 ]; then
    echo "FAIL: '$name' ships under src/components/ but isn't classified in CLIENT_COMPONENTS or SERVER_COMPONENTS in this script — add it to the list matching whether it calls a hook directly in its own render body"
    exit 1
  fi
  if [ "$count" -gt 1 ]; then
    echo "FAIL: '$name' appears $count times across CLIENT_COMPONENTS/SERVER_COMPONENTS in this script (duplicate entry, or listed in both) — it must be classified exactly once"
    exit 1
  fi
done
for name in "${CLIENT_COMPONENTS[@]}" "${SERVER_COMPONENTS[@]}"; do
  if ! in_list "$name" "${ALL_COMPONENTS[@]}"; then
    echo "FAIL: '$name' is classified in this script but has no src/components/$name/public.ts — remove the stale entry"
    exit 1
  fi
done

# A flat `grep -qF "'use client';"` over the whole file would match a
# decoy — a comment or string anywhere else in the file that happens to
# contain that literal text — without the component actually having a real
# directive, since a directive is only a directive as the file's first
# statement. Reimplements buildPlugin.ts's `directiveRe` prologue-skipping
# for bash (that TS regex can't be imported here): find the first line that
# isn't blank, a `//` comment, or a self-contained `/* ... */` block
# comment, then test whether THAT line — not any other line — is the
# directive.
has_client_directive() {
  # $1: path to a .tsx source file
  awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*\/\// { next }
    /^[[:space:]]*\/\*.*\*\/[[:space:]]*$/ { next }
    { print; exit }
  ' "$1" | grep -Eq "^[[:space:]]*('use client'|\"use client\");?[[:space:]]*\$"
}

assert_source_exists() {
  # $1: component name. Without this, a missing source file (renamed, split,
  # or restructured out from under this script) reads as "no directive" to
  # has_client_directive (awk prints nothing, grep on empty input returns 1)
  # — which makes the SERVER_COMPONENTS loop below pass silently on a file
  # that was never checked at all, exactly the "no file reads as clean"
  # defect the dist loops further down already guard against with `[ -f ]`.
  if [ ! -f "$UIKIT_DIR/src/components/$1/$1.tsx" ]; then
    echo "FAIL: src/components/$1/$1.tsx does not exist — was it renamed, split, or restructured without updating this script?"
    exit 1
  fi
}

# The lists above are only checked against WHICH components exist (the
# exhaustiveness block) — this pins them to what each one's source actually
# declares: every CLIENT_COMPONENTS source has the directive, every
# SERVER_COMPONENTS source doesn't. That catches the two lists and the
# source drifting apart — e.g. the directive added to (or removed from) a
# component's .tsx without the matching list edit. It does NOT catch a hook
# added to (say) select.tsx with no directive added at all: that leaves
# SERVER_COMPONENTS unchanged, source correctly directiveless by this
# check's own definition, and dist/select.js correctly bannerless, so every
# check in this file — this one included — stays green despite the
# component now needing the directive. Closing that gap needs a lint rule
# that flags hook usage with no client directive in scope; out of scope
# here.
for name in "${CLIENT_COMPONENTS[@]}"; do
  assert_source_exists "$name"
  if ! has_client_directive "$UIKIT_DIR/src/components/$name/$name.tsx"; then
    echo "FAIL: src/components/$name/$name.tsx is classified as CLIENT_COMPONENTS but its source has no 'use client' directive as its first statement"
    exit 1
  fi
done
for name in "${SERVER_COMPONENTS[@]}"; do
  assert_source_exists "$name"
  if has_client_directive "$UIKIT_DIR/src/components/$name/$name.tsx"; then
    echo "FAIL: src/components/$name/$name.tsx has a 'use client' directive as its first statement but is classified as SERVER_COMPONENTS — move it to CLIENT_COMPONENTS"
    exit 1
  fi
done

for name in "${CLIENT_COMPONENTS[@]}"; do
  if [ ! -f "$UIKIT_DIR/dist/$name.js" ]; then
    echo "FAIL: dist/$name.js does not exist — did the build fail for this component?"
    exit 1
  fi
  if ! head -c 20 "$UIKIT_DIR/dist/$name.js" | grep -qF "use client"; then
    echo "FAIL: dist/$name.js is missing its 'use client' banner"
    exit 1
  fi
done
for name in "${SERVER_COMPONENTS[@]}" index; do
  if [ ! -f "$UIKIT_DIR/dist/$name.js" ]; then
    echo "FAIL: dist/$name.js does not exist — did the build fail for this component?"
    exit 1
  fi
  if head -c 20 "$UIKIT_DIR/dist/$name.js" | grep -qF "use client"; then
    echo "FAIL: dist/$name.js carries a 'use client' banner it doesn't need — this removes it from server rendering for RSC consumers"
    exit 1
  fi
done
echo "==> 'use client': present on ${CLIENT_COMPONENTS[*]}, absent elsewhere (${#ALL_COMPONENTS[@]} components accounted for)"

# Present/absent assertions against a glob, with the glob's own emptiness
# checked explicitly rather than left to grep's exit code. Without this, an
# absence check written as `grep … && { fail; }` passes *silently* when the
# glob matches no file at all (the shell passes the literal unexpanded glob
# string to grep, which exits 2 for "no such file", and 2 is still "not 0"
# so the `&&` block never runs) — indistinguishable from "checked, and
# genuinely absent, good". That's live risk here, not theoretical: it's
# exactly what happens the moment a leg's output shape changes (e.g. a
# different bundler's output directory/extension). Building the file list
# with `local -a files=( $glob )` (deliberately unquoted, for the glob
# expansion) and checking whether the first element exists on disk gives an
# explicit, named failure instead — "no output to check" is a different,
# louder problem than "checked and clean".
assert_present_in_glob() {
  # $1: label, $2: pattern, $3: glob expression (as a single string)
  local label="$1" pattern="$2" glob="$3"
  # shellcheck disable=SC2206
  local -a files=( $glob )
  if [ ! -e "${files[0]}" ]; then
    echo "FAIL: $label — no output files matched '$glob'"
    exit 1
  fi
  grep -qF "$pattern" "${files[@]}" 2>/dev/null || { echo "FAIL: $label missing from the bundle"; exit 1; }
}

assert_absent_from_glob() {
  # $1: label, $2: pattern (fixed string), $3: glob expression
  local label="$1" pattern="$2" glob="$3"
  # shellcheck disable=SC2206
  local -a files=( $glob )
  if [ ! -e "${files[0]}" ]; then
    echo "FAIL: $label — no output files matched '$glob'"
    exit 1
  fi
  if grep -qF "$pattern" "${files[@]}" 2>/dev/null; then
    echo "FAIL: $label leaked into the bundle despite never being imported"
    exit 1
  fi
}

assert_identifier_absent_from_glob() {
  # Like assert_absent_from_glob, but for a plain (non -F) grep pattern —
  # used for the Base UI submodule name probes, which are real identifiers
  # (SelectRoot, ToastRoot, …), not hashed CSS-module class literals.
  local label="$1" pattern="$2" glob="$3"
  # shellcheck disable=SC2206
  local -a files=( $glob )
  if [ ! -e "${files[0]}" ]; then
    echo "FAIL: $label — no output files matched '$glob'"
    exit 1
  fi
  if grep -q "$pattern" "${files[@]}" 2>/dev/null; then
    echo "FAIL: $label leaked into the bundle despite Button never reaching it"
    exit 1
  fi
}

echo
echo "==> [vite] Scaffolding a clean Vite consumer in $WORKDIR/vite-consumer"
CONSUMER="$WORKDIR/vite-consumer"
mkdir -p "$CONSUMER/src"
cd "$CONSUMER"

cat > package.json <<'EOF'
{
  "name": "ui-kit-vite-consumer-check",
  "private": true,
  "type": "module",
  "scripts": { "build": "vite build" }
}
EOF

cat > index.html <<'EOF'
<!doctype html>
<html lang="en">
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF

cat > src/main.jsx <<'EOF'
import '@gears-frontx/ui-kit/theme.css';

import { Button } from '@gears-frontx/ui-kit';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')).render(
  <Button variant="outline" size="sm">
    It works
  </Button>,
);
EOF

cat > vite.config.js <<'EOF'
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react()] });
EOF

echo "==> [vite] Installing tarball and deps"
npm install --no-audit --no-fund --silent \
  "$TARBALL" "react@$REACT_VERSION" "react-dom@$REACT_VERSION"
npm install --no-audit --no-fund --silent -D \
  "vite@$VITE_VERSION" "@vitejs/plugin-react@$PLUGIN_REACT_VERSION"

echo "==> [vite] Building the consumer (imports only Button from the barrel)"
npm run build

echo "==> [vite] Asserting kit CSS and Button made it into the bundle"
grep -rq -- '--primary' dist/assets/*.css || { echo 'FAIL: [vite] theme variables missing from bundle'; exit 1; }
assert_present_in_glob "[vite] Button styles"    "$BUTTON_CLASS" 'dist/assets/*.css'
assert_present_in_glob "[vite] Button class map" "$BUTTON_CLASS" 'dist/assets/*.js'

echo "==> [vite] Asserting components never imported (Table, Dialog) were tree-shaken out"
assert_absent_from_glob "[vite] Table styles"    "$TABLE_CLASS"  'dist/assets/*.css'
assert_absent_from_glob "[vite] Table JS"        "$TABLE_CLASS"  'dist/assets/*.js'
assert_absent_from_glob "[vite] Dialog styles"   "$DIALOG_CLASS" 'dist/assets/*.css'
assert_absent_from_glob "[vite] Dialog JS"       "$DIALOG_CLASS" 'dist/assets/*.js'

echo "==> [vite] Bundle report (Button-only consumer page)"
du -h dist/assets/*.js dist/assets/*.css

echo "==> Asserting the AI docs layer ships with the installed package"
KIT="$CONSUMER/node_modules/@gears-frontx/ui-kit"
[ -f "$KIT/llms.txt" ] || { echo 'FAIL: llms.txt missing from the package'; exit 1; }
[ -f "$KIT/dist/docs/button.md" ] || { echo 'FAIL: per-component docs missing from dist/docs'; exit 1; }

echo
echo "==> [esbuild-barrel] Scaffolding a raw-esbuild consumer (barrel import) in $WORKDIR/esbuild-barrel"
EB_BARREL="$WORKDIR/esbuild-barrel"
mkdir -p "$EB_BARREL/src"
cd "$EB_BARREL"

cat > package.json <<'EOF'
{ "name": "ui-kit-esbuild-barrel-check", "private": true, "type": "module" }
EOF

# No JSX rendering needed — this leg measures bundle *contents*, not runtime
# behavior (the [vite] leg already proves the component renders). The
# reference to Button keeps esbuild from eliminating the import itself as
# dead; react/react-dom are external so the measurement isolates the kit's
# own code (and its Base UI dependency) from React's fixed footprint, which
# would otherwise dwarf the comparison this leg exists to make.
cat > src/main.jsx <<'EOF'
import '@gears-frontx/ui-kit/theme.css';

import { Button } from '@gears-frontx/ui-kit';

console.log(Button);
EOF

echo "==> [esbuild-barrel] Installing tarball and deps"
npm install --no-audit --no-fund --silent \
  "$TARBALL" "react@$REACT_VERSION" "react-dom@$REACT_VERSION" "esbuild@$ESBUILD_VERSION"

echo "==> [esbuild-barrel] Bundling (imports only Button from the barrel)"
# Deliberately NOT --minify: the Base UI submodule probes below search for
# source-level identifiers (SelectRoot, MenuRoot, ...), and a minifier
# renames unexported local bindings — verified directly (built this same
# bundle with --minify and grepped for "SelectRoot": present 24 times
# unminified, 0 times minified, in the *same* underlying code). Minifying
# here would make those probes silently pass on a real regression, which is
# worse than not having them. The hashed CSS-module class probes elsewhere
# in this script are unaffected either way — those are string *literals*
# baked in at the kit's own build time, not consumer-side bindings a
# consumer's minifier could rename — so nothing is lost by leaving this leg
# unminified; [esbuild-subpath] below still exercises the minified case.
npx esbuild src/main.jsx --bundle --format=esm --platform=browser \
  --external:react --external:react-dom --external:react/jsx-runtime \
  --loader:.css=css --outfile=dist/out.js

echo "==> [esbuild-barrel] Asserting Button's JS made it into the bundle"
grep -q -- '--primary' dist/out.css || { echo 'FAIL: [esbuild-barrel] theme variables missing from bundle'; exit 1; }
assert_present_in_glob "[esbuild-barrel] Button class map" "$BUTTON_CLASS" 'dist/out.js'

echo "==> [esbuild-barrel] Asserting Table/Dialog JS were tree-shaken out"
# CSS is deliberately NOT asserted absent here — measured, esbuild bundles
# every component's CSS from a barrel import regardless of JS tree-shaking
# (see the file header's [esbuild-subpath] paragraph); asserting CSS
# absence on this leg would be permanently red, not a real check.
assert_absent_from_glob "[esbuild-barrel] Table JS"  "$TABLE_CLASS"  'dist/out.js'
assert_absent_from_glob "[esbuild-barrel] Dialog JS" "$DIALOG_CLASS" 'dist/out.js'

# The class-name probes above only catch leakage of the *kit's own* unused
# component code. They would miss the specific regression this leg exists
# for: an unreached Base UI primitive's internals surviving because
# esbuild's bundler doesn't cascade "kit wrapper unused" into "its exclusive
# Base UI import unused" the way Rollup does (see the file header). Probe
# for that directly, by name, against Base UI's own exported identifiers —
# none of these are reachable from Button.
echo "==> [esbuild-barrel] Asserting unreached Base UI submodules were not pulled in"
for probe in SelectRoot MenuRoot ToastRoot FloatingFocusManager; do
  assert_identifier_absent_from_glob "[esbuild-barrel] Base UI's $probe" "$probe" 'dist/out.js'
done
# 'floating-ui/dom' (not the bare substring 'floating-ui'): Button itself
# legitimately pulls in the small, shared @floating-ui/utils package (its
# unminified file-path comment reads ".../floating-ui/utils/dist/floating-ui.
# utils.dom.mjs"), which a broader pattern would false-positive on. The
# actual positioning *engine* used by popup/overlay components — the real
# leak indicator — ships as @floating-ui/dom, hence the narrower pattern.
assert_identifier_absent_from_glob "[esbuild-barrel] @floating-ui/dom" 'floating-ui/dom' 'dist/out.js'

echo "==> [esbuild-barrel] Bundle report (Button-only, react/react-dom external)"
wc -c dist/out.js dist/out.css

echo
echo "==> [esbuild-subpath] Scaffolding a raw-esbuild consumer (subpath import) in $WORKDIR/esbuild-subpath"
EB_SUBPATH="$WORKDIR/esbuild-subpath"
mkdir -p "$EB_SUBPATH/src"
cd "$EB_SUBPATH"

cat > package.json <<'EOF'
{ "name": "ui-kit-esbuild-subpath-check", "private": true, "type": "module" }
EOF

cat > src/main.jsx <<'EOF'
import '@gears-frontx/ui-kit/theme.css';

import { Button } from '@gears-frontx/ui-kit/button';

console.log(Button);
EOF

echo "==> [esbuild-subpath] Installing tarball and deps"
npm install --no-audit --no-fund --silent \
  "$TARBALL" "react@$REACT_VERSION" "react-dom@$REACT_VERSION" "esbuild@$ESBUILD_VERSION"

echo "==> [esbuild-subpath] Bundling (imports @gears-frontx/ui-kit/button directly)"
npx esbuild src/main.jsx --bundle --minify --format=esm --platform=browser \
  --external:react --external:react-dom --external:react/jsx-runtime \
  --loader:.css=css --outfile=dist/out.js

echo "==> [esbuild-subpath] Asserting Button's CSS made it into the bundle (subpath import gets per-component CSS even under esbuild)"
assert_present_in_glob "[esbuild-subpath] Button styles" "$BUTTON_CLASS" 'dist/out.css'

echo "==> [esbuild-subpath] Asserting Table/Dialog CSS were excluded"
assert_absent_from_glob "[esbuild-subpath] Table styles"  "$TABLE_CLASS"  'dist/out.css'
assert_absent_from_glob "[esbuild-subpath] Dialog styles" "$DIALOG_CLASS" 'dist/out.css'

echo "==> [esbuild-subpath] Bundle report (Button-only via subpath, react/react-dom external)"
wc -c dist/out.js dist/out.css

echo
echo "==> [webpack] Scaffolding a webpack consumer (barrel import) in $WORKDIR/webpack-consumer"
WP="$WORKDIR/webpack-consumer"
mkdir -p "$WP/src"
cd "$WP"

cat > package.json <<'EOF'
{ "name": "ui-kit-webpack-check", "private": true }
EOF

# Plain .js, no JSX — like the esbuild legs, this measures bundle contents,
# not runtime behavior, and skipping JSX means no babel/swc loader.
cat > src/main.js <<'EOF'
import '@gears-frontx/ui-kit/theme.css';

import { Button } from '@gears-frontx/ui-kit';

console.log(Button);
EOF

# mode: production is load-bearing: that's what turns on usedExports +
# sideEffects optimization — the exact machinery this leg exists to
# exercise. A development-mode build keeps every module and would pass the
# absence assertions never (and the presence ones vacuously).
cat > webpack.config.cjs <<'EOF'
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  mode: 'production',
  entry: './src/main.js',
  output: { filename: 'out.js', clean: true },
  externals: {
    react: 'react',
    'react-dom': 'react-dom',
    'react/jsx-runtime': 'react/jsx-runtime',
  },
  module: {
    rules: [{ test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] }],
  },
  plugins: [new MiniCssExtractPlugin({ filename: 'out.css' })],
};
EOF

echo "==> [webpack] Installing tarball and deps"
npm install --no-audit --no-fund --silent \
  "$TARBALL" "react@$REACT_VERSION" "react-dom@$REACT_VERSION" \
  "webpack@$WEBPACK_VERSION" "webpack-cli@$WEBPACK_CLI_VERSION" \
  "css-loader@$CSS_LOADER_VERSION" "mini-css-extract-plugin@$MINI_CSS_EXTRACT_VERSION"

echo "==> [webpack] Bundling (imports only Button from the barrel, production mode)"
npx webpack --config webpack.config.cjs >/dev/null

echo "==> [webpack] Asserting Button's CSS survived sideEffects handling (the guard: sideEffects:false silently drops ALL kit CSS here, and only here)"
grep -q -- '--primary' dist/out.css || { echo 'FAIL: [webpack] theme variables missing from bundle'; exit 1; }
assert_present_in_glob "[webpack] Button styles"    "$BUTTON_CLASS" 'dist/out.css'
assert_present_in_glob "[webpack] Button class map" "$BUTTON_CLASS" 'dist/out.js'

echo "==> [webpack] Asserting components never imported (Table, Dialog) were pruned, CSS included"
assert_absent_from_glob "[webpack] Table styles"    "$TABLE_CLASS"  'dist/out.css'
assert_absent_from_glob "[webpack] Table JS"        "$TABLE_CLASS"  'dist/out.js'
assert_absent_from_glob "[webpack] Dialog styles"   "$DIALOG_CLASS" 'dist/out.css'
assert_absent_from_glob "[webpack] Dialog JS"       "$DIALOG_CLASS" 'dist/out.js'

echo "==> [webpack] Bundle report (Button-only barrel consumer, react/react-dom external)"
wc -c dist/out.js dist/out.css

echo
echo "==> [types] Type-checking the barrel and three subpaths under both moduleResolution settings"
TYPES_CHECK="$WORKDIR/types-check"
mkdir -p "$TYPES_CHECK/src"
cd "$TYPES_CHECK"

# type: module matters here specifically for the nodenext leg below: nodenext
# resolution treats the *consuming* file as CJS or ESM based on the nearest
# package.json's "type" field, and a CJS file cannot statically import a
# pure-ESM package (TS1479) regardless of whether the package's own exports
# are otherwise correct — that would be a false failure of THIS check, not a
# real one, so the throwaway consumer has to be ESM for the test to mean
# anything.
cat > package.json <<'EOF'
{ "name": "ui-kit-types-check", "private": true, "type": "module" }
EOF

cat > src/main.ts <<'EOF'
import { Button, type ButtonProps } from '@gears-frontx/ui-kit';
import { Button as ButtonSubpath } from '@gears-frontx/ui-kit/button';
import { Table } from '@gears-frontx/ui-kit/table';
import { Dialog } from '@gears-frontx/ui-kit/dialog';

export { Button, ButtonSubpath, Table, Dialog };
export type { ButtonProps };
EOF

cat > tsconfig.nodenext.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
EOF

cat > tsconfig.bundler.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
EOF

echo "==> [types] Installing tarball and deps"
npm install --no-audit --no-fund --silent \
  "$TARBALL" "react@$REACT_VERSION" "react-dom@$REACT_VERSION" \
  "@types/react@19.2.17" "@types/react-dom@19.2.3" "typescript@$TYPESCRIPT_VERSION"

echo "==> [types] tsc --noEmit under moduleResolution: nodenext"
npx tsc -p tsconfig.nodenext.json || { echo 'FAIL: [types] nodenext type-check failed — see tsc output above (relative .d.ts specifiers likely lost their .js extension again)'; exit 1; }

echo "==> [types] tsc --noEmit under moduleResolution: bundler"
npx tsc -p tsconfig.bundler.json || { echo 'FAIL: [types] bundler type-check failed — see tsc output above'; exit 1; }

echo
echo "OK: consumer check passed (vite + esbuild-barrel + esbuild-subpath + webpack + types)"
