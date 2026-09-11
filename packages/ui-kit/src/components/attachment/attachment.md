# Attachment

A file or image attachment card — a faithful port of [shadcn/ui's base
Attachment](https://ui.shadcn.com/docs/components/base/attachment). No
primitive to lean on — the upload state machine is hand-written, plain
data-attribute-driven CSS. Use it for files and images in chat composers,
message threads, and upload lists.

## Utility dependencies

Attachment uses two utility classes shipped in this package's global
stylesheet: `import '@gears-frontx/ui-kit/utilities.css';` once at the app
entry, alongside `theme.css`.

- **`shimmer`** — `AttachmentTitle` adds it automatically while the
  ancestor `Attachment`'s `state` is `'uploading'` or `'processing'`. This
  is read from React context, not a prop: unlike upstream's pure-CSS
  ancestor selector, attaching an unrelated *global* class conditionally
  needs JavaScript, so `Attachment` provides its `state` via context and
  `AttachmentTitle` consumes it internally — the consumer never re-passes
  `state` to `AttachmentTitle` itself, matching upstream's prop-free API
  exactly.
- **`scroll-fade-x`** and **`no-scrollbar`** — applied directly by
  `AttachmentGroup` to its own scroll track, for the edge fade and hidden
  scrollbar on its horizontally scrolling row.

Both utilities are inert if `utilities.css` isn't imported — import it
once alongside `theme.css` for these effects to render.

## When to use

- A file or image attachment in a chat composer, message thread, or upload
  list, with optional actions and upload state.

## When not to use

- The visible bubble/surface of a text message — use [`Bubble`](bubble.md).
- A generic card — use `Card` (no upload-state axis, no media/actions
  parts).

## Composition

```text
Attachment
├── AttachmentMedia
├── AttachmentContent
│   ├── AttachmentTitle
│   └── AttachmentDescription
├── AttachmentActions
│   └── AttachmentAction
└── AttachmentTrigger
```

```text
AttachmentGroup
├── Attachment
└── Attachment
```

## Variants

### Attachment

| `state`       | Description                                                         |
| ------------- | --------------------------------------------------------------------- |
| `idle`        | Not yet started — dashed border, awaiting a drop or selection.      |
| `uploading`   | In progress — `AttachmentTitle` shimmers.                           |
| `processing`  | Post-upload processing — `AttachmentTitle` shimmers.                |
| `error`       | Failed — destructive-tinted border, media, and description.         |
| `done`        | Complete (default) — the plain resting state.                       |

| `size`      | Description                                    |
| ----------- | ------------------------------------------------ |
| `default`   | The standard attachment size.                  |
| `sm`        | A smaller, denser attachment.                  |
| `xs`        | The smallest attachment, tighter radius/icons. |

| `orientation`  | Description                            |
| -------------- | ----------------------------------------- |
| `horizontal`   | Media beside the content (default).    |
| `vertical`     | Media above the content, image-card style. |

### AttachmentMedia

| `variant` | Description                              |
| --------- | ------------------------------------------- |
| `icon`    | Holds a decorative file-type icon (default). |
| `image`   | Holds an `<img>` preview.                  |

## Props

### Attachment

| Prop          | Type                                                          | Default        | Description                                       |
| ------------- | -------------------------------------------------------------- | -------------- | ---------------------------------------------------- |
| `state`       | `'idle' \| 'uploading' \| 'processing' \| 'error' \| 'done'`  | `'done'`       | The upload state. Drives styling and the shimmer. |
| `size`        | `'default' \| 'sm' \| 'xs'`                                   | `'default'`    | The attachment size.                              |
| `orientation` | `'horizontal' \| 'vertical'`                                  | `'horizontal'` | Lay the media beside or above the content.        |
| `className`   | `string`                                                       | —              | Merged after the variant classes.                 |

All other props are native `<div>` props and are forwarded as-is.

### AttachmentMedia

| Prop        | Type                | Default  | Description                          |
| ----------- | ------------------- | -------- | --------------------------------------- |
| `variant`   | `'icon' \| 'image'` | `'icon'` | Whether the media holds an icon or an `<img>`. |
| `className` | `string`            | —        | Merged after the variant class.      |

### AttachmentTitle / AttachmentDescription / AttachmentContent / AttachmentActions

Each accepts only `className` (merged after its base class) plus native
props for its element (`<span>` for Title/Description, `<div>` for
Content/Actions) — no `state` prop of their own; see "Utility
dependencies" above for how `AttachmentTitle` still reacts to the
ancestor's upload state.

### AttachmentAction

| Prop       | Type                                   | Default  | Description                             |
| ---------- | --------------------------------------- | -------- | ------------------------------------------ |
| `size`     | Kit `Button`'s `size` (`'default' \| 'sm' \| 'lg'`) | `'sm'`   | The button size — see the drift note below. |
| `...props` | `ComponentProps<typeof Button>`        | —        | Props spread to the underlying kit `Button`. |

**Drift from upstream:** shadcn's `AttachmentAction` defaults to
`size="icon-xs"` — a dedicated micro icon-only step this kit's `Button`
does not have.
`size="sm"` is the smallest step available; icon-only squaring already
works at any size via `Button`'s own `[data-icon-only]` rule, so the
visual result is a slightly larger action button (32px) than upstream's
(24px), not a broken one.

### AttachmentTrigger

| Prop       | Type                              | Default | Description                                    |
| ---------- | ---------------------------------- | ------- | ------------------------------------------------- |
| `render`   | `ReactElement` — replaces the root `button` | —       | Render as a different element, such as a link. |
| `...props` | native `<button>` props            | —       | Forwarded as-is.                                |

### AttachmentGroup

Accepts only `className` (merged after the layout class, alongside the
`scroll-fade-x`/`no-scrollbar` utility classes) plus native `<div>` props.

`attachmentVariants`/`attachmentMediaVariants` (the underlying `cva`
recipes) are also exported.

## Examples

```tsx
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@gears-frontx/ui-kit';

<Attachment>
  <AttachmentMedia>
    <FileTextIcon />
  </AttachmentMedia>
  <AttachmentContent>
    <AttachmentTitle>sales-dashboard.pdf</AttachmentTitle>
    <AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
  </AttachmentContent>
  <AttachmentActions>
    <AttachmentAction aria-label="Remove sales-dashboard.pdf">
      <XIcon />
    </AttachmentAction>
  </AttachmentActions>
</Attachment>;
```

### Image

```tsx
<Attachment orientation="vertical">
  <AttachmentMedia variant="image">
    <img src="/preview.png" alt="" />
  </AttachmentMedia>
  <AttachmentContent>
    <AttachmentTitle>workspace.png</AttachmentTitle>
    <AttachmentDescription>PNG · 1.1 MB</AttachmentDescription>
  </AttachmentContent>
</Attachment>
```

### Upload states

```tsx
<Attachment state="uploading">
  <AttachmentMedia>
    <FileIcon />
  </AttachmentMedia>
  <AttachmentContent>
    <AttachmentTitle>large-export.csv</AttachmentTitle>
    <AttachmentDescription>Uploading…</AttachmentDescription>
  </AttachmentContent>
</Attachment>
```

### Group

```tsx
<AttachmentGroup>
  <Attachment size="sm">{/* … */}</Attachment>
  <Attachment size="sm">{/* … */}</Attachment>
</AttachmentGroup>
```

### Trigger

```tsx
<Dialog>
  <Attachment>
    {/* media, content, actions */}
    <DialogTrigger render={<AttachmentTrigger aria-label="Preview research-summary.pdf" />} />
  </Attachment>
  <DialogContent>{/* … */}</DialogContent>
</Dialog>
```

## Accessibility

`AttachmentAction` renders a `Button`, and `AttachmentTrigger` renders a
real `<button>` (or your element via `render`).

- **Label icon-only actions.** `AttachmentAction` is usually icon-only —
  give each one an `aria-label` describing the action and its target.
- **Label the trigger.** `AttachmentTrigger` covers the card with no text
  of its own — give it an `aria-label` for what activating it does. It
  sits behind the actions in the stacking order, so an `AttachmentAction`
  and the `AttachmentTrigger` never trap each other — both remain
  separately focusable and clickable.
- **Keyboard scrolling.** `AttachmentGroup` scrolls horizontally. When its
  attachments are interactive (a trigger or actions), keyboard users reach
  off-screen items by tabbing to them. For a row of presentational
  attachments, make the group itself focusable and scrollable by adding
  `tabIndex={0}`, `role="group"`, and an `aria-label`.
- **Meaning beyond color.** The `error` state uses a destructive color —
  keep the failure reason in `AttachmentDescription` so the state is not
  conveyed by color alone.

## Anti-patterns

- Do not rely on `error` styling alone to communicate failure — pair it
  with text in `AttachmentDescription`.
- Do not nest another full `Attachment` inside `AttachmentActions` — that
  slot is for action buttons, not attachments.
- Do not forget `utilities.css` — without it, `AttachmentTitle`'s shimmer
  and `AttachmentGroup`'s edge fade/hidden scrollbar silently do nothing.
