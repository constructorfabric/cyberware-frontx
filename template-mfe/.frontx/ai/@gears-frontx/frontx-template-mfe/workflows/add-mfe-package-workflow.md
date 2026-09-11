# Workflow: Add an MFE Package (template-mfe)

Ordered execution procedure for the `add-mfe-package` skill in this same bundle. Use
this workflow when actually performing the addition (not just reasoning about it);
each step names the concrete command or file template-mfe ships.

## Preconditions

- An applied `template-shell` is already in the project (root `package.json`,
  `src-app/app/`, build/test/manifest pipeline) — `template-mfe` adds MFE packages
  into that shell and does not scaffold a repository on its own.
- The screenset/screen the new MFE will contribute to is already decided.

## Steps

1. **Choose a name and port**
   - Name: `{screenset}-mfe` (kebab-case), placed at `src-app/mfe_packages/{screenset}-mfe/`.
   - Port: next free `30N0` slot after the reserved `3001` (`demo-mfe`).

2. **Copy the scaffold and strip its example flag** — together, so the flag cannot
   outlive the copy. A copy that keeps it registers nothing, and nothing fails to
   say so.
   ```bash
   NEW=src-app/mfe_packages/{screenset}-mfe
   cp -r src-app/mfe_packages/_blank-mfe "$NEW"
   node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f,"utf8"));delete m.templateExample;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$NEW/mfe.json"
   grep -q templateExample "$NEW/mfe.json" && echo "FLAG STILL PRESENT - remove it" || echo "flag stripped"
   ```
   `"templateExample": true` is what keeps the scaffold out of the running
   application: a package carrying it is left out by manifest generation, by
   `dev:all`, and by `type-check:mfe`, and its screen never reaches the menu.

3. **Edit package metadata**
   - `src-app/mfe_packages/{screenset}-mfe/package.json`:
     - `name`: `@gears-frontx/{screenset}-mfe`
     - `dev`: `vite --port {port}`
     - `preview`: `vite preview --port {port}`
   - `src-app/mfe_packages/{screenset}-mfe/vite.config.ts`:
     - Module Federation `name`: `{screenset}Mfe` (camelCase)

4. **Rewrite `mfe.json`**
   - Replace the manifest ID, every entry ID, and every extension ID using
     template-mfe's ID taxonomy (`gts-id-conventions` guideline; worked examples in
     `gts-id-patterns-reference`).
   - Update `remoteEntry` to `http://localhost:{port}/assets/remoteEntry.js`.

5. **Implement the screen**
   - Rename/replace `src/screens/home/HomeScreen.tsx` with the real screen.
   - Build the UI from `@gears-frontx/ui-kit` components and semantic tokens —
     the kit is the only component source: no other component library, and no
     shadcn components or APIs (the kit follows shadcn conventions, so shadcn
     patterns may guide which kit component maps to a UI pattern, nothing more).
     Confirm the package declares `@gears-frontx/ui-kit` in its dependencies (add
     it if the scaffold copy predates the kit migration and lacks it) and read the
     installed kit's `llms.txt` for the component inventory before writing markup.
     Plan before markup: map every visible UI pattern to a concrete kit
     component or approved composition from that inventory, and record the
     screen's grid columns, alignment anchors, and responsive breakpoints; a
     pattern with no kit mapping is reported as a gap, never guessed at.
     Hand-rolling a look-alike of an existing kit component is a defect.
   - If a design-contract bundle is installed — any AI bundle that ships a
     `generate-interface` skill (check for
     `.frontx/ai/*/*/skills/generate-interface/`) — that skill and its design
     contract govern the screen's generation — follow them. If none is
     installed, state in the plan that the screen is generated without a
     design contract.
   - Update `src/screens/home/i18n/*.json` (or rename the directory) with real copy
     for every locale the template ships.
   - Keep `src/lifecycle.tsx` extending `ThemeAwareReactLifecycle`; keep `init.ts`'s
     plugin chain (`effects()`, `queryCacheShared()`, `mock()`) unless the new MFE has
     a documented reason to diverge.

6. **Regenerate manifests**
   ```bash
   npm run build:mfes
   npm run generate:mfe-manifests
   ```
   While iterating after this first full pass, rebuild only the changed MFE
   (`npm run build --workspace=<package-name>`) before regenerating manifests;
   `build:mfes` rebuilds every MFE and belongs in the final gate.

7. **Validate**
   While iterating, scope to the MFE's workspace:
   ```bash
   npm run type-check --workspace=<package-name>
   npm run test:unit --workspace=<package-name>
   ```
   Once the MFE is complete, run the full gate exactly once:
   ```bash
   npm run type-check
   npm run test:unit
   npm run arch:deps
   ```

8. **Run and confirm**
   ```bash
   npm run dev:all
   ```
   - Open the app, confirm the new screen mounts, and confirm zero console errors.
   - When the installed design-contract bundle ships a `verify-interface`
     skill (check for `.frontx/ai/*/*/skills/verify-interface/`), run its
     `verify-interface` flow against the new screen's route and review the
     screenshots it produces — the same closing pass `add-mfe-packages-parallel.md`
     requires. When no such bundle is installed, complete a manual visual
     review instead — look at the rendered screen at its target widths and
     themes and check layout alignment, overflow, and each visual state —
     and state in the hand-off that the screen was reviewed by eye because
     no design contract exists.

## Rollback

If the addition is abandoned before being committed: delete
`src-app/mfe_packages/{screenset}-mfe/`, re-run `npm run generate:mfe-manifests` to
drop it from `public/generated-mfe-manifests.json`, and revert any workspace/script
edits made in step 3.
