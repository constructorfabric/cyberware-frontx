# Domain-Model Mapping: The Workspace Template Split

<!-- toc -->

- [Scope and status](#scope-and-status)
- [Territory recap](#territory-recap)
- [Per-template mapping](#per-template-mapping)
  - [template-workspace (shell)](#template-workspace-shell)
  - [template-workspace-contacts](#template-workspace-contacts)
  - [template-workspace-dashboard](#template-workspace-dashboard)
  - [template-workspace-chat](#template-workspace-chat)
  - [template-workspace-mail](#template-workspace-mail)
- [Shared-asset placement](#shared-asset-placement)
- [New GTS surface](#new-gts-surface)
- [Risks and de-risked items](#risks-and-de-risked-items)
- [Non-goals](#non-goals)
- [Open questions for the maintainer](#open-questions-for-the-maintainer)

<!-- /toc -->

Date: 2026-09-02

## Scope and status

This is a decision-support document, not an SDLC artifact. Its subject - what a single top-level template directory contains - is template territory, which the ecosystem artifact tree does not specify (the territory-traceability decision). It exists so the maintainer can author the PRD and DESIGN for the workspace split without re-deriving the file-level mapping from the source tree. It produces no DECOMPOSITION and no FEATURE, per the maintainer's explicit instruction, and it introduces no template-kind taxonomy: every statement below is "this content moves to this territory," never "this territory is a kind of template."

It reads as consistent with the four commits already on this branch: the source-spec decision's per-sibling versioning, the manifest-contract decision's recorded absence of a cross-template compatibility field, the territory-traceability decision's obligation to keep the artifact-registry exclusion equal to the set of manifest-carrying directories, and the scaffolding feature's rule that a unit a distinct installed template's own description claims is planned as an application of that template, not as skill-driven work inside someone else's ground.

This mapping inherits its migration shape from prior team decisions rather than re-deriving it from source, and states those decisions here as its own premises: a family of five templates (one shell, `template-workspace`, plus four screens); the naming scheme carried throughout this document (`template-workspace-contacts`, `-dashboard`, `-chat`, `-mail`); a contacts-first build and split order; the `mfe_packages/` project-root layout for each screen's own MFE package (see "Territory recap" below); and each screen carried forward as a screen-domain MFE registered against the runtime's existing screen extension domain, not as a new domain of its own. Source of the file-level numbers cited throughout: a verified read-only sweep of `demo/uikit-inbox@d5046303`, `fix/post-uikit-merge-followups@feb342d1`, and `develop`, treated as ground truth. Two places below go one level past that sweep with a direct read against `d5046303:template-inbox/src/styles/workspace.module.css` and against `demo-mfe/mfe.json` and `demo-mfe/package.json` on `feb342d1`, because the placement decision they feed needed the rule bodies rather than the class-name inventory; both are called out where they matter.

## Territory recap

Five top-level directories, each carrying its own `frontx-template.json`, none nested inside another's claim:

```text
template-workspace/                 shell: app shell, api core, shared, styles, i18n
template-workspace-contacts/        mfe_packages/contacts/
template-workspace-dashboard/       mfe_packages/dashboard/
template-workspace-chat/            mfe_packages/chat/
template-workspace-mail/            mfe_packages/mail/
```

`mfe_packages/` sits at the project root, not under the shell's `src/`, because the shell claims `src/` and a screen claiming a path nested inside that claim collides with it under the assembly conflict check. This has a consequence worth stating precisely, because it looks at first glance like the same shape `template-mfe` already uses and is not: `template-mfe` claims `src-app/mfe_packages/` **wholesale** (confirmed against this branch's own manifest), which is correct there because `template-mfe` is the sole template that ever writes under that path - every MFE package inside it belongs to the one template. Here, four different templates write into the same `mfe_packages/` parent, each owning exactly one child directory. A wholesale claim of the parent by any one of them would collide with the other three the moment a second screen template is applied. Each screen template's exclusive subtree is therefore its own child directory only, never the parent - the ownership-boundary decision's own principle ("claim what you ship, not the whole parent dir") applies here in its child-directory form, not in `template-mfe`'s wholesale form. Every screen manifest below reflects that.

## Per-template mapping

### template-workspace (shell)

**Source that moves in** (paths as they sit in `template-inbox` today, per the migration table):

- `src/main.tsx` - the kit `theme.css` to `brand-themes.css` to `app.css` import order is load-bearing and moves verbatim.
- `src/app/{App,IconRail,routing,theme,i18n}.{ts,tsx}` plus `theme.test.ts` - `App.tsx`'s route-name ternary is replaced by extension-domain mounting; `IconRail.tsx`'s four literal rail items are replaced by the registered-extension list, with the brand-picker block carried as-is; `routing.ts`'s closed `Route` union is replaced by a parser over registered `presentation.route` values; `theme.ts`'s storage key moves from `frontx.inbox.*` to `frontx.workspace.*`.
- `src/styles/app.css` (20 lines, global reset) and `src/styles/brand-themes.css` (503 lines, uncommitted today, four `[data-theme][data-brand]` blocks, token-only, no `!important`).
- The shell-exclusive slice of `src/styles/workspace.module.css`: 8 classes not shared with any screen (rail and shell-chrome rules - `.app`, `.rail`, `.railMark`, `.railNav`, `.railIdentity`, `.railIdentityCard` and its `svg` rule, `.identityLines`/`.identityName`/`.identityMeta` group as counted). None of the pane-frame classes (`paneHeader`, `paneTitle`, `emptyPane`) are shell-exclusive - the verified count places those in the group shared by all four screens, not in the shell's own 8; the shell does not itself render a pane.
- `src/api/RestMockPlugin.ts`, `queries.ts`, `registry.ts` - domain-neutral API core (see "Shared-asset placement").
- The `agent` (lines 37-50) and `contacts` (lines 817-end) slices of `src/api/dataset.ts`, `mocks.ts`, and `types.ts`, and the `getAgent`/`getContacts` slice of `InboxApiService.ts`, backing two REST endpoints the screens read: `/api/workspace/me` and `/api/workspace/contacts`.
- The shell-exclusive slice of `src/i18n/en.json`: 10 keys, of which 4 section-name keys are each shared with exactly one screen (see i18n split below).
- The `.frontx/ai/@gears-frontx/frontx-template-workspace/` bundle, replacing the retired `add-inbox-screen` skill with nothing (adding a screen is `frontx add`, not a skill run, per the scaffolding feature as already amended on this branch).

**Ecosystem dependencies present, by layer:**

- Presentation: `@gears-frontx/ui-kit` - `theme.css` side-effect import plus 10 components in `IconRail` (`Button`, `Item`, `ItemContent`, `ItemGroup`, `ItemMedia`, `ItemTitle`, `Popover`, `PopoverContent`, `PopoverTrigger`, `Separator`) and, through `PresenceAvatar`, `Avatar`/`AvatarBadge`/`AvatarFallback`.
- Data: `@gears-frontx/api` - `apiRegistry`, `BaseApiService`, `RestProtocol`, `RestEndpointProtocol`, `MockMap`, `JsonValue`, `MOCK_PLUGIN`, `RestPluginWithConfig`.
- Third-party: `react`, `react-dom`, `lucide-react` (10 icons feeding the rail and its avatar chain).

**Dependencies that must appear and do not exist in `template-inbox` today** - this is the one place the mapping is not a file move: `template-inbox` has zero Module Federation surface by design (its own `vite.config.ts` says so). The shell must additionally take on the MF-host runtime: `@gears-frontx/mfes`, `@gears-frontx/gts-plugin`, and the build-time MF/GTS plugin and framework packages that today are published only from `template-shell`'s own territory rather than from `packages/` (Open Question 1 in the split plan, carried into this mapping's own open questions below rather than resolved here).

**Dependencies deliberately absent:** `axios` (imported by nothing in `template-inbox` today; do not carry it forward), `recharts` (dashboard's, not the shell's).

**Draft `ownershipBoundaries`:**

```json
{
  "exclusiveSubtrees": [
    "src/main.tsx",
    "src/app/",
    "src/api/",
    "src/i18n/",
    "src/styles/app.css",
    "src/styles/brand-themes.css",
    "src/styles/workspace.module.css",
    "src/__test-utils__/",
    "public/",
    "scripts/",
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "vitest.config.ts",
    "vitest.setup.ts",
    "eslint.config.js",
    ".gitignore",
    "README.md",
    ".frontx/ai/@gears-frontx/frontx-template-workspace/"
  ],
  "sharedFiles": []
}
```

`src/i18n/` and `src/styles/workspace.module.css` are claimed wholesale because, after the split, each is the shell's **own copy** carrying only the shell's slice - not the merged 176-key dictionary or the merged 1010-line stylesheet. See "Shared-asset placement" for why this is a real split of content, not a rename.

### template-workspace-contacts

**Source that moves in:** `src/screens/contacts/` (8 files, 755 lines) into `mfe_packages/contacts/src/`, plus its own `mfe.json`, `vite.config.ts`, `package.json`, `tsconfig.json`, following the `demo-mfe` package shape.

**ui-kit surface:** 19 components - `Badge`, `Button`, the `Card` family, `DataTable` with its sort helper, `columnHelper`, and `selectionColumn`, `Input`, the `Item` family, `Skeleton`, `Textarea`. No sole-user family; every one of these is also used elsewhere in the workspace.

**Dependencies present:**

- `@gears-frontx/ui-kit` (the surface above).
- `lucide-react` (9 icons, screen-internal; the menu-rail icon is a separate Iconify string, see "New GTS surface").
- MF-host-contract layer, mirrored from `demo-mfe`'s own production `package.json` on `feb342d1`: `@gears-frontx/react`, `@tanstack/react-query`, and either `@gears-frontx/frontx-template-shell`'s build export or a `packages/`-published equivalent per Open Question 1.
- `@gears-frontx/api`, to build its **own** thin REST client against `/api/workspace/contacts` - see the API-core boundary note below; contacts does not get this by importing the shell's `registry.ts`, because nothing crosses the MF module-graph boundary that way.

**Dependencies deliberately absent:** no direct import of the shell's `api/queries.ts`/`registry.ts` (cannot cross the boundary - see below); today's `template-inbox/package.json` carries `axios`, imported by nothing anywhere in the codebase - do not carry it into any of the five templates.

**A gap the migration table does not surface, worth flagging here because it changes the dependency list above.** In `template-inbox` today, `ContactsScreen` reaches data by importing `getInboxApi()` from the shell's own `src/api/registry.ts` and calling `useApiQuery` from the shell's own `src/api/queries.ts` - both are app-local glue code built on top of the `@gears-frontx/api` package, not the package itself. Once contacts is its own Module-Federation bundle, it cannot import either file: they live in a different template's module graph. `@gears-frontx/api` is an ordinary npm dependency every template can take independently, but the **glue** - registering an endpoint, exposing a query hook - is not; each screen must author its own small equivalent of `registry.ts`/`queries.ts` against `@gears-frontx/api`, pointed at the shell's REST surface. This is not visible from the migration table, which lists `queries.ts`/`registry.ts` as "moves to shell" without noting that every consuming screen needs its own copy of the pattern, not a shared import of the file. Confidence: substantiated for the boundary fact (Module Federation does not share a module graph across remotes by default), conjecture for "small equivalent" being the right shape rather than something `@gears-frontx/react` should standardize - see open questions.

**Draft `ownershipBoundaries`:**

```json
{
  "exclusiveSubtrees": [
    "mfe_packages/contacts/",
    ".frontx/ai/@gears-frontx/frontx-template-workspace-contacts/"
  ],
  "sharedFiles": []
}
```

### template-workspace-dashboard

**Source that moves in:** `src/screens/dashboard/` (18 files, 1872 lines), `src/api/{dashboardTypes,dashboardDataset,dashboardMocks,DashboardApiService}.ts`, and `src/styles/dashboard.module.css` (638 lines, wholly owned, no split needed).

**ui-kit surface:** 28 components - sole user of the `Chart*` family and `Progress`. This is the family to call out in the manifest description: no other template in the workspace family renders a chart.

**Dependencies present:**

- `@gears-frontx/ui-kit` (28 components, `Chart*`/`Progress` as sole user).
- `recharts` - **must become a declared, direct dependency of this template's own `package.json`.** Today it resolves only because `@gears-frontx/ui-kit` 0.4.x lists `recharts` 3.10.1 as its own direct dependency and npm hoists it; `template-inbox/package.json` does not declare it at all. A template that relies on a transitive resolution through a dependency it does not control breaks the moment ui-kit's own `recharts` version moves, or the resolver's hoisting behaviour changes. Declare it explicitly, pinned.
- `lucide-react` (13 icons).
- `@gears-frontx/api`, for the screen's own `DashboardApiService` against `/api/workspace/dashboard/*`.
- MF-host-contract layer, same baseline as contacts.

**Dependencies deliberately absent:** `axios`; no chart library other than `recharts` - do not add a second one.

**The one piece of source that cannot move as-is:** `dashboardDataset.ts` line 16 imports `{ contacts }` from `./dataset` at module scope, used at line 243 to synthesize activity-table `contactIds`. This is the only module-level data dependency crossing a future template boundary in the whole codebase. It cannot survive the split as an import - `dataset.ts`'s `contacts` slice moves to the shell - so the activity table's contact lookups become a runtime call to `/api/workspace/contacts`, the same endpoint contacts itself reads. This turns an implicit build-time coupling into an explicit, versioned runtime contract, which is exactly the shape the shell-screen contract already commits to for cross-screen data.

**Draft `ownershipBoundaries`:**

```json
{
  "exclusiveSubtrees": [
    "mfe_packages/dashboard/",
    ".frontx/ai/@gears-frontx/frontx-template-workspace-dashboard/"
  ],
  "sharedFiles": []
}
```

### template-workspace-chat

**Source that moves in:** `src/screens/inbox/` (11 files, 2310 lines) into `mfe_packages/chat/`, with every identifier renamed `inbox` to `chat` (the directory, code, and route names diverge from the URL today - `chat` in the URL, `inbox` in the code - and the rename closes that); the chat slice of `api/{dataset,mocks,types}.ts` and `InboxApiService.ts` (channels, conversations, messages); and `public/message-assets/{preview-chart,preview-diagram}.svg`, moved into chat's own `public/` and referenced from its own publicPath rather than the document root.

**ui-kit surface:** 73 components, the largest of the four - sole user of `Attachment*`, `Bubble*`, `Collapsible*`, `Combobox*`, `DropdownMenu*`, `Marker*`, the `Message*`/`MessageAvatar`/`MessageContent`/`MessageHeader` group, and `useMessageScroller*` (shared with mail only).

**Dependencies present:**

- `@gears-frontx/ui-kit` (73 components, the families above as sole or near-sole user).
- `lucide-react` (26 icons, the largest icon surface of the five templates).
- `@gears-frontx/api`, for its own service against `/api/workspace/{channels,conversations,messages}` (including the one POST mutation in the whole application - `useApiMutation` is used nowhere else) plus reads of `/api/workspace/contacts` and `/api/workspace/me`.
- MF-host-contract layer, same baseline as contacts.

**Dependencies deliberately absent:** `axios`; `recharts` (chat renders no chart).

**A residue to close during the move, not carry forward:** `ConversationThread.tsx` references `styles.fileBubbleContent`, a class `workspace.module.css` does not define. This is a dangling reference in the source today; the split is the moment to either define it or remove the reference, not to migrate a broken reference into a new file.

**Draft `ownershipBoundaries`:**

```json
{
  "exclusiveSubtrees": [
    "mfe_packages/chat/",
    ".frontx/ai/@gears-frontx/frontx-template-workspace-chat/"
  ],
  "sharedFiles": []
}
```

### template-workspace-mail

**Source that moves in:** `src/screens/mail/` (8 files, 1209 lines), `src/api/{mailTypes,mailDataset,mailMocks,MailApiService}.ts`, and `src/styles/mail.module.css` (119 lines, wholly owned).

**ui-kit surface:** 36 components - `FieldGroup` is mail-only; `MessageScroller*` is shared with chat only, nothing else.

**Dependencies present:**

- `@gears-frontx/ui-kit` (36 components, `FieldGroup` as sole user).
- `lucide-react` (11 icons).
- `@gears-frontx/api`, for its own `MailApiService` against `/api/workspace/mail/*`.
- MF-host-contract layer, same baseline as contacts.

**Dependencies deliberately absent, and worth stating explicitly because a maintainer reviewing a future PR might otherwise expect one:** no editor, rich-text, or markdown library. A full import sweep of the mail screen shows the composer is a plain `Textarea` from the kit - mail's data boundary is already the cleanest of the four (it touches neither `api/types.ts` nor `api/dataset.ts` at all), and introducing an editor library here would be new scope, not a migration. `axios` and `recharts` are likewise absent.

**Draft `ownershipBoundaries`:**

```json
{
  "exclusiveSubtrees": [
    "mfe_packages/mail/",
    ".frontx/ai/@gears-frontx/frontx-template-workspace-mail/"
  ],
  "sharedFiles": []
}
```

## Shared-asset placement

**API core (`registry.ts`, `queries.ts`, `RestMockPlugin.ts`).** Stays in the shell as domain-neutral glue over `@gears-frontx/api`. Each screen authors its own equivalent glue against the same package rather than importing the shell's files - see the gap called out under contacts above. This is a real per-screen authoring cost the split creates that the migration table does not price in.

**`api/types.ts` and the `Contact` split.** `Contact` today carries `tickets[]` and `conversations[]` - fields shaped by chat and dashboard, not by the type's own identity. Split it: a lean `Contact` (identity, presence, contact fields) is what `/api/workspace/contacts` returns and what the shell's type declares; `tickets`/`conversations` move out into chat's and dashboard's own types, keyed by `contactId`, populated from each screen's own endpoint. This is the same shape the `dashboardDataset` fix above already forces - a wire type should not carry another screen's enrichment.

**Dataset decomposition.** `dataset.ts`'s `agent` and `contacts` slices move to the shell, backing `/api/workspace/me` and `/api/workspace/contacts`. `channels`, `conversations`, and `messages` move to chat. `mocks.ts` splits along the identical boundary, one mock-handler group per endpoint owner. `dashboardDataset.ts`'s `contacts` import becomes a call to `/api/workspace/contacts`, per the point above - not a duplicated fixture, because a duplicated fixture reintroduces exactly the drift the endpoint is meant to prevent (dashboard's copy of "what a contact looks like" silently diverging from the shell's). `mailDataset.ts`/`mailMocks.ts`/`mailTypes.ts` move to mail untouched - the cleanest boundary of the four, touching neither shared file.

**`workspace.module.css` split.** Verified counts: shell 8 exclusive, contacts 24 exclusive, chat 29 exclusive, mail 0 exclusive, plus four shared groups - 3 classes used by all four screens (`emptyPane`, `paneHeader`, `paneTitle`), 22 shared by chat and mail, 8 shared by chat, contacts, and mail, 5 shared by chat, contacts, and the shell, 3 shared by chat and contacts.

This is a current-state observation about the source tree read for this mapping, not a resolution that duplication is permanently safe: it reads the rule bodies directly (`d5046303:template-inbox/src/styles/workspace.module.css`, 1010 lines, read in full) rather than only the class-name inventory, for the 22-class shared group. Three findings support duplication being safe **today**, for that group:

1. Every declared value is a kit token (`var(--font-sans)`, `var(--foreground)`, and so on) or a structural layout value; the file's own header comment states this as a rule ("never picks a colour or a size of its own"). Duplicating a token-only rule into two independently-versioned files does not create two things that can drift in appearance - both still resolve against whichever `data-theme` the shell sets, because CSS custom properties inherit across the Shadow DOM boundary regardless of which file's copy of a rule reads them.
2. Every multi-class selector nests within one component's own markup (`.listBody .conversationRow`, `.rowLine .lineTitle`, `.thread .transcript [data-align='end'] .bubbleText`) - never across a shell selector and a screen selector in the same rule. There is no rule in the file that only makes sense if a shell-owned stylesheet and a screen's stylesheet are the same file.
3. The one locally-scoped custom-property block in the file (`--button-bg`/`--button-bg-hover`/`--button-fg` on `.closeButton`, used by both chat's and mail's thread header) is confined entirely to that one class's own rule - nothing outside it reads those three properties, so duplicating the rule duplicates a self-contained unit, not a shared definition site.

The 5-class and 3-class chat/contacts groups were not read rule-by-rule with the same care as the 22-class group above - they were extended to this same duplication treatment by analogy, on the strength of sitting in the same file under the same header-comment discipline the 22-class group's rules follow, not on their own independently-verified rule bodies. This is a weaker basis than the 22-class finding and is named here as such, not folded into the same confidence level.

Recommendation: each of the four screen templates ships its own module CSS file carrying its exclusive classes plus a verbatim duplicate of every shared-group class it uses (confirmed by grep against `MailComposer.tsx`, `MailList.tsx`, `MailReadingPane.tsx`, `MailScreen.tsx`, and `MailboxSidebar.tsx` on `d5046303` - mail's own file reuses the chat-authored rule text for `listPane`, `conversationRow`, `thread*`, `composer*`, and the sidebar group verbatim). The shell keeps only its 8 exclusive classes; it holds no shared pane-framework file for the screens to depend on, because no cross-template import of it is available to them anyway.

**Future-drift guard.** Duplicating a rule body across four independently-versioned files is safe only for as long as the four copies stay identical; nothing prevents one screen template's own future edit from silently diverging from another's copy of the same shared-group rule. The mitigation named here, to be picked up when the shared CSS is actually authored rather than only mapped: a parity check comparing each duplicated rule body's declared value set across the four screen templates' own module CSS files, failing when a shared-group class's rule text diverges between two siblings that both carry it. This mapping does not implement that check; it names it as the expectation the split's authors carry forward.

**i18n key split.** Take both precedents, for two different strings. The screen's own internal UI copy follows the `useScreenTranslations` precedent already working in `_blank-mfe` (`import.meta.glob('./i18n/*.json')`, driven purely by the `language` shared property, no upward registration) - this is a self-contained namespace inside the screen's own bundle and needs nothing from the shell beyond the shared property it already receives. The one string that cannot follow that precedent is the menu label the shell itself renders as chrome (`presentation.label`) - the shell cannot read a key out of a bundle it does not import, so that string needs the chrome-action registration path the split plan already sketches: a screen hands the shell a namespace-and-dictionary pair through a new chrome action, symmetric to `set_theme`, dispatched no later than the screen's own extension being admitted into the screen extension domain and retained by the shell for as long as that extension stays admitted - not tied to whichever screen's content happens to be routed at the moment. Prop-drilling `t` through that dispatch is not a substitute for either: it ties every screen's internal strings to the exact shape of a function value crossing the Module Federation boundary, and gives a screen's own namespace nowhere to register independently of the shell's dictionary. Confidence: substantiated for the internal-copy half (working precedent exists); conjecture for the exact chrome-action shape, which is new authoring, not migration.

**`shared/` utilities.** `PresenceAvatar`, `IdentityAvatar`, and `format.ts` are presentation-shaped and each consumed by three or more of the five future templates; duplicating them risks visual drift across screens that version independently, which is the strongest argument for closing them as a `@gears-frontx/ui-kit` extension rather than copying them. `cx.ts` and `useMediaQuery.ts` are small, generic, non-visual utilities; duplicating either costs less than the alternative of adding to ui-kit's public barrel, which is a contract addition per the kit's own barrel-discipline convention, not a free move. This is the split plan's own leaning (its open question 3) and this mapping does not resolve it further - it is a decision about ui-kit's scope, not about template territory, and belongs to whoever owns that package's DESIGN.

**`__test-utils__/apiMocks.ts`.** The one file spanning two future boundaries today (imports both `dataset` and `mailDataset`). Splits the same way the migration table already states for `__test-utils__/*` generally - a copy per screen, each importing only its own screen's dataset module. No new decision: chat's copy imports the chat dataset slice, mail's copy imports `mailDataset`, and each screen's copy of the harness scaffolding (mock-plugin registration, `MockMap` wiring) is independently maintained, matching every other file already called out as "copied, not shared."

**`public/message-assets/`.** Moves to chat's own `public/`, served from chat's own MF publicPath rather than the document root - already decided in the split plan, restated here because it is the one asset in the tree addressed by an absolute document-root path today (`dataset.ts` references `/message-assets/preview-chart.svg` and its sibling), which is exactly the kind of reference that silently breaks once the document root is the shell's and the asset is chat's.

## New GTS surface

**Each screen template authors one extension entry against the shell's existing screen domain** (`gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1`, the same identifier `demo-mfe`'s Hello World extension already targets - no new domain is declared by any screen). The concrete shape, following `demo-mfe/mfe.json`'s working pattern:

```json
{
  "manifest": { "id": "...", "remoteEntry": "http://localhost:<port>/assets/remoteEntry.js" },
  "entries": [
    {
      "id": "gts.frontx.mfes.mfe.entry.v1~...~frontx.workspace.mfe.contacts.v1",
      "requiredProperties": [
        "gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.theme.v1~",
        "gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.language.v1~"
      ],
      "actions": [],
      "domainActions": [],
      "manifest": "...",
      "exposedModule": "./lifecycle-contacts"
    }
  ],
  "extensions": [
    {
      "id": "gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.workspace.screens.contacts.v1",
      "domain": "gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1",
      "entry": "gts.frontx.mfes.mfe.entry.v1~...~frontx.workspace.mfe.contacts.v1",
      "presentation": {
        "label": "workspace.contacts.menu.label",
        "icon": "lucide:users",
        "route": "/contacts",
        "order": 100
      }
    }
  ]
}
```

Four points on this shape carry over from the split plan as already-settled, not re-opened here: `label` is an i18n key the shell resolves against the registering screen's own namespace (not a raw string, so the menu localizes); `route` is now consumed by the shell for hash parsing and deep-link dispatch (`#/contacts/{id}` needs this - `template-shell` today declares `route` as schema-required but never reads it), and the family's own route set must stay prefix-free across siblings, the same way `/mail` and `/mailbox` applied together would not; `order` is banded per screen in inclusive, 100-wide ranges - contacts 100-199, dashboard 200-299, chat 300-399, mail 400-499 - with the 500-599 band left for a future fifth screen; `entries[].actions` is empty in this shape because the i18n-namespace registration action (see below) has no published ID yet - once it exists, each screen manifest's `actions` array includes it, alongside `requiredProperties` and `domainActions`, per `entry.v1.json`'s own required field set. The Iconify-string convention (`icon: "lucide:users"`) is the shell's existing consumption contract (`@iconify/react` resolves the string), which diverges from how every screen renders its own internal icons today (`lucide-react` components imported directly) - the menu icon and a screen's internal icons are two different conventions living side by side by design, not an inconsistency to fix.

**What no screen manifest can yet express:** a screen's runtime dependency on a shell-provided endpoint (contacts needs `/api/workspace/contacts` to exist; chat needs `/api/workspace/{channels,conversations,messages}`, `/api/workspace/contacts`, and `/api/workspace/me`). The split plan's own shell-screen-contract item 5 proposes expressing this as a required domain capability the runtime's existing subset-admission check can enforce, so an incompatible shell-screen pairing fails at mount rather than at the first 404. That mechanism does not exist in the schemas read for this mapping (`extension_screen.v1.json` carries only `presentation`); this mapping treats it as unresolved and carries it into the open questions below rather than inventing a field.

**What the shell template must add, beyond wiring the two chrome actions (`set_theme`, `set_menu_collapsed`) that already exist:**

- Hash-based routing. `template-shell` has none today (no `location.hash`/`pushState`/router anywhere in it) - this is net-new code for the workspace shell, not a migration, driven by `presentation.route` prefix matching against the registered extension set.
- One new chrome action for i18n namespace registration (screen hands the shell a namespace-and-dictionary pair no later than that screen's own extension admission, retained by the shell for the extension's admitted lifetime), authored as its own JSON schema file under the shell's own `gts/` tree, following the same pattern `set_theme`/`set_menu_collapsed` already established and the GTS-schemas-are-JSON-files convention.
- The order-band and route-prefix conventions as documented shell-side policy, since `order` is a flat number across the whole domain and the five templates release independently - nothing in the runtime arbitrates a collision between two screens claiming the same band.

## Risks and de-risked items

**De-risked, with evidence already in the tree.** Kit CSS reaching a Shadow DOM root is a solved problem on `fix/post-uikit-merge-followups@feb342d1`, not an open one: `anchorKitThemeOnShadowHost.ts` rewrites `:root` selectors to `:host`/`:host(<tail>)`, `theme.css?inline` is imported and appended during style initialization, and a working `UIKit Elements` screen extension renders kit components inside a shadow root in `demo-mfe` today. The token path is proven.

**Not fully de-risked - two residues remain inside the solved area.** `injectBaseResets` paints the shadow host with `hsl(var(--foreground))`/`hsl(var(--background))`, which collides with the kit's complete-colour tokens of the same name; both currently resolve to transparent (measured `rgba(0,0,0,0)`), with the documented consequence that a screen leaving part of the host uncovered must paint the host itself - a workspace screen author needs to know this going in, since a `paneHeader`/`emptyPane`-shaped empty area is exactly the kind of partially-covered host this affects. Separately, whether **component** CSS (as opposed to token CSS) reaches a shadow root through an actual Module-Federation build, rather than through the in-repo `demo-mfe` fixture, has not been traced - this is the one genuinely open technical question in the CSS story, and it is the one to close before contacts (the first screen in build order) is split, not after, per the split plan's own risk framing.

**Organizational, evidenced by a precedent that already occurred once.** `.cf-studio/config/artifacts.toml` excludes template territory by an enumerated pattern list (`template-shell/**`, `template-mfe/**`, `template-design-guardrails/**` today), while `scripts/template-discovery.mjs` finds territory by manifest presence - the two are kept equal only by an authoring obligation the territory-traceability decision now states explicitly (as amended on this branch). `template-inbox` itself is the precedent for the failure mode this obligation exists to prevent: it is missing from the exclusion list on `feb342d1` even though it carries a manifest. Creating five new template directories at once is exactly the scenario that turns one missed pattern into five, so each of the five directory-creation changes must carry its own `artifacts.toml` addition in the same commit, not a follow-up.

**Version-surface risk.** `lucide-react` sits at two different major lines across the workspace's own dependency graph - `@gears-frontx/ui-kit` pins `1.33.0`, `template-shell` pins `0.563.0` - which is a fact about the tree as it stands today, not something this split causes, but a screen template importing `lucide-react` directly for its own internal icons inherits whichever line its own `package.json` pins, independent of which line the kit or the shell pin, and a future kit-icon change is not guaranteed to be observed by a screen that pins its own copy. Pin discipline itself is already multiplied by five: every ecosystem-package bump now touches five `package.json` files instead of two, and the pin-drift guard catches an inconsistency but does not reduce the number of files a bump touches.

**A pin-discipline gap Option A of the split plan's open question 1 would introduce, worth surfacing here rather than only in that question.** If `template-workspace` depends on `@gears-frontx/frontx-template-shell`'s published build export for its MF-host layer - the shape `demo-mfe` already uses in production - that dependency is a template consuming a package published from another template's own territory, not from `packages/`. The pin-drift guard as described walks every directory carrying a manifest and compares its ecosystem-package pins against `packages/*`; a dependency on a template-published package sits outside that comparison entirely, so a drift here would not be caught by the same mechanism that catches every other pin.

## Non-goals

This mapping does not produce a DECOMPOSITION or a FEATURE for the workspace split - the maintainer authors the PRD and DESIGN from it directly, per instruction. It implements nothing: every code path, config file, and manifest field shown above is illustrative of the target shape, not a change made in this branch. It introduces no template-kind taxonomy - nothing here classifies a template as a "screen template" or a "shell template" in any manifest-readable sense; the distinction lives entirely in each template's own prose description, exactly as the manifest-contract decision requires.

## Open questions for the maintainer

1. **Where does the shell's MF-host build layer come from - `template-shell`'s published build export, or a `packages/`-promoted framework?** The split plan leans toward the former for the first iteration (already proven in production by `demo-mfe`) and flags the pin-drift-guard gap that choice creates (see Risks). Needs a go/no-go, and if "go," an owner for closing the guard gap.
2. **Does a screen manifest get a way to declare "I need endpoint X from the shell," enforced by the existing subset-admission check?** No schema read for this mapping carries that field today. Without it, a shell-screen version mismatch surfaces as a runtime 404 rather than a refused mount.
3. **Resolved for v1 by the PRD: per-screen API-glue duplication, standardization deferred.** Each screen authors its own `registry.ts`/`queries.ts`-equivalent against `@gears-frontx/api`, per the PRD's own requirement for the first split release (PRD §11). Whether `@gears-frontx/react` should later standardize that pattern so five templates stop independently reinventing it - this mapping's own framing of the question - is not decided here and stays open.
4. **Deferred to a future ui-kit DESIGN; eventual placement unresolved.** `PresenceAvatar`, `IdentityAvatar`, and `format.ts` are the strongest kit-extension candidates; `cx` and `useMediaQuery` are marginal either way. Ownership of the decision sits with whoever authors the kit's own DESIGN, not with this mapping or the PRD (PRD §11).
5. **Confirm the component-CSS-through-Module-Federation-Shadow-DOM path before contacts is split**, per the split plan's own sequencing risk - this mapping did not re-verify it and treats it as still open.
