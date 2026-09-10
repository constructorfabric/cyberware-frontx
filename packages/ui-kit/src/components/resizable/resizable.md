# Resizable

A react-resizable-panels wrapper — a group of panels a user can drag to
resize, split by one or more draggable handles. No Base UI primitive
exists for this (confirmed against Base UI v1.7.0), so the kit forwards
straight to the vendor
primitive with only class-name/icon translation on top.

## When to use

- A split-pane layout the user controls directly — a file explorer beside
  an editor, a preview pane beside a form, a chat list beside a
  conversation.
- Nesting a vertical split inside one side of a horizontal split (or vice
  versa) for an IDE-style multi-pane layout.

## When not to use

- A fixed-proportion layout with no user-driven resizing — plain flex/grid
  is simpler and needs no dependency.
- A collapsible sidebar with a binary open/closed state (no drag) — that's
  a different interaction; a resizable `Panel`'s `collapsible`/
  `collapsedSize` props solve a related but distinct problem (snap-to-zero
  on drag, not a toggle button).

## Parts

| Part | Renders | Notes |
|------|---------|-------|
| `ResizablePanelGroup` | `react-resizable-panels`' `Group` | Owns layout orientation; always renders `data-group` |
| `ResizablePanel` | `react-resizable-panels`' `Panel` | Bare pass-through — no kit styling of its own, matching upstream |
| `ResizableHandle` | `react-resizable-panels`' `Separator` | The draggable divider; `role="separator"`, keyboard-resizable |

## Props (kit level)

`ResizablePanelGroup` and `ResizablePanel` forward every prop of their
underlying `react-resizable-panels` primitive verbatim (`orientation`,
`defaultLayout`, `disabled`, `onLayoutChanged`, `defaultSize`, `minSize`,
`maxSize`, `collapsible`, `collapsedSize`, ...) — see the library's own
`GroupProps`/`PanelProps` for the full list, re-exported here as
`ResizablePanelGroupProps`/`ResizablePanelProps`.

`ResizableHandle` forwards every `Separator` prop plus one addition:

| Prop | Type | Default |
|------|------|---------|
| `withHandle` | `boolean` | `false` — renders a small grip glyph centered on the handle |

`Group.orientation` defaults to `'horizontal'` (panels side by side,
resized left/right); a `ResizableHandle`'s own `aria-orientation` (set by
the vendor, not the kit) describes the DIVIDER's drawn orientation, which
is the opposite: a `horizontal` group's divider is drawn as a vertical
line, and a `vertical` group's divider is drawn as a horizontal one — same
"opposite" relationship `Separator`/`ButtonGroupSeparator` already
document for their own orientation.

## Examples

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@gears-frontx/ui-kit';

// Two-panel horizontal split
<ResizablePanelGroup style={{ height: 300 }}>
  <ResizablePanel defaultSize={30} minSize={20}>Sidebar</ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel>Content</ResizablePanel>
</ResizablePanelGroup>

// Vertical split nested inside one side of a horizontal split
<ResizablePanelGroup style={{ height: 300 }}>
  <ResizablePanel defaultSize={30}>Sidebar</ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel>
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel>Editor</ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={25}>Console</ResizablePanel>
    </ResizablePanelGroup>
  </ResizablePanel>
</ResizablePanelGroup>
```

## Anti-patterns

- Do not expect `ResizablePanel` to carry any visual styling of its own
  (border, background, padding) — it is a bare pass-through by design
  (faithful to upstream); style the content you put inside it, or pass
  your own `className`.
- Do not pass a `data-testid` prop to any of these three parts expecting it
  to stick — `react-resizable-panels` claims that attribute for its own
  id-based test-id convention and overwrites it; pass `id` and query by
  that (or by role) instead.
- Do not read a handle's own `aria-orientation` as "the group's
  orientation" — it is the opposite (see Props above); read the `Group`'s
  own `orientation` prop for that instead.
