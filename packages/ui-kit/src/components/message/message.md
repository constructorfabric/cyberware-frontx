# Message

A conversation row — a faithful port of [shadcn/ui's base
Message](https://ui.shadcn.com/docs/components/base/message). Message has
no Base UI primitive; it is plain `div`s wired together through a
`data-align` state attribute. Message owns the **row** layout — avatar,
alignment, header, and footer — around a message. Render the visible
message surface inside it with [`Bubble`](bubble.md). For the scroll
container around a whole conversation, reach for `MessageScroller` (not
ported in this wave).

## When to use

- A single message row in a conversation thread — assistant, user, or
  system — with an optional avatar and header/footer metadata.
- Stack consecutive messages from the same sender with `MessageGroup`.

## When not to use

- The visible bubble/surface itself — that is [`Bubble`](bubble.md)'s job,
  not Message's. Message is intentionally just the row wrapper.
- A one-off status line with no avatar/header/footer — use
  [`Marker`](marker.md) instead.

## Composition

```text
Message
├── MessageAvatar
└── MessageContent
    ├── MessageHeader
    ├── Bubble
    └── MessageFooter
```

```text
MessageGroup
├── Message
└── Message
```

## Props

### Message

| Prop        | Type                | Default   | Description                                                                                                |
| ----------- | ------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `align`     | `'start' \| 'end'`  | `'start'` | Which side of the conversation this row belongs to. Reverses the row and shifts descendant parts to match. |
| `className` | `string`            | —         | Merged after the base class.                                                                                |

All other props are native `<div>` props and are forwarded as-is.

### MessageGroup / MessageAvatar / MessageContent / MessageHeader / MessageFooter

Each accepts only `className` (merged after its base class) plus native
`<div>` props — no variant props of their own. `align` lives on `Message`
alone; the other parts react to it via CSS, not a prop of their own.

## Examples

```tsx
import { Avatar, AvatarFallback, AvatarImage } from '@gears-frontx/ui-kit';
import { Bubble, BubbleContent } from '@gears-frontx/ui-kit';
import { Message, MessageAvatar, MessageContent } from '@gears-frontx/ui-kit';

<Message>
  <MessageAvatar>
    <Avatar>
      <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  </MessageAvatar>
  <MessageContent>
    <Bubble>
      <BubbleContent>How can I help you today?</BubbleContent>
    </Bubble>
  </MessageContent>
</Message>;
```

### Alignment

`align="end"` reverses the row (avatar moves to the trailing edge) and
right-aligns `MessageContent`'s children and `MessageFooter`'s own content
— use it for the current user's own messages in a two-sided conversation.

```tsx
<Message align="end">
  <MessageAvatar>
    <Avatar>
      <AvatarFallback>You</AvatarFallback>
    </Avatar>
  </MessageAvatar>
  <MessageContent>
    <Bubble align="end">
      <BubbleContent>What did the last deploy change?</BubbleContent>
    </Bubble>
  </MessageContent>
</Message>
```

### Group

Use `MessageGroup` to stack consecutive messages from the same sender.
Render an empty `MessageAvatar` on the earlier messages to keep them
aligned with the avatar on the last one.

```tsx
<MessageGroup>
  <Message>
    <MessageAvatar />
    <MessageContent>
      <Bubble>
        <BubbleContent>I checked the registry output.</BubbleContent>
      </Bubble>
    </MessageContent>
  </Message>
  <Message>
    <MessageAvatar>
      <Avatar>
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
    </MessageAvatar>
    <MessageContent>
      <Bubble>
        <BubbleContent>The stale route is gone.</BubbleContent>
      </Bubble>
    </MessageContent>
  </Message>
</MessageGroup>
```

### Header and footer

Use `MessageHeader` for a sender name and `MessageFooter` for metadata such
as a delivery or read status, or message-level actions.

```tsx
<Message>
  <MessageContent>
    <MessageHeader>Assistant</MessageHeader>
    <Bubble>
      <BubbleContent>Done — 4 files changed.</BubbleContent>
    </Bubble>
    <MessageFooter>Delivered</MessageFooter>
  </MessageContent>
</Message>
```

`MessageHeader`/`MessageFooter` collapse their inline padding to zero when
the message's `Bubble` is `variant="ghost"` — an inset header/footer would
otherwise float disconnected from a bubble that no longer has a frame to
sit inside.

## Accessibility

Message is a presentational layout wrapper. Accessibility comes from the
content placed inside it.

- **Label icon-only actions.** Action buttons in `MessageFooter` are
  usually icon-only — give each one an `aria-label`.
- **Status updates.** For an in-progress message, use a
  [`Marker`](marker.md) with `role="status"` inside the row so assistive
  tech announces the update as it appears:

  ```tsx
  <Message>
    <Marker role="status">
      <MarkerIcon>
        <Spinner />
      </MarkerIcon>
      <MarkerContent>Checking the logs...</MarkerContent>
    </Marker>
  </Message>
  ```

## Anti-patterns

- Do not render the message surface directly inside `Message` — always go
  through `MessageContent` > `Bubble`, so header/footer padding and the
  avatar's footer-aware shift work correctly.
- Do not set `align` on individual sub-parts — it belongs on `Message`
  alone; every other part reacts to it through CSS.
