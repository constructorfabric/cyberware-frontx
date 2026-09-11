import { useState, type ReactNode } from 'react';

import {
  Button,
  Marker,
  MarkerContent,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

interface ChatMessage {
  id: string;
  from: 'agent' | 'user';
  text: string;
}

// Long enough to overflow a fixed-height viewport — long lines force the
// browser to wrap, which is what actually produces enough scrollable height
// to exercise auto-follow and the jump button.
const TRANSCRIPT: ChatMessage[] = [
  { id: '1', from: 'agent', text: "Hi! I'm the FrontX assistant. What are you building today?" },
  { id: '2', from: 'user', text: 'A support console for our billing team.' },
  { id: '3', from: 'agent', text: 'Got it. Do you need a ticket list, a detail view, or both to start?' },
  { id: '4', from: 'user', text: 'Both — list on the left, detail on the right.' },
  { id: '5', from: 'agent', text: 'That maps to Table + Card from the kit, with a Tabs strip for status filters.' },
  { id: '6', from: 'user', text: 'Can the table rows show a status badge?' },
  { id: '7', from: 'agent', text: 'Yes — Badge with the semantic variant matching the ticket status.' },
  { id: '8', from: 'user', text: 'What about bulk actions across selected rows?' },
  { id: '9', from: 'agent', text: 'Table supports a selection state; pair it with a floating action bar.' },
  { id: '10', from: 'user', text: 'Good. Let’s also add a quick reply composer at the bottom.' },
  { id: '11', from: 'agent', text: 'A Textarea plus a primary Button works well there.' },
  { id: '12', from: 'user', text: 'Should the composer be disabled while a ticket is closed?' },
  { id: '13', from: 'agent', text: 'Yes — disable the Textarea and Button, and show a Badge explaining why.' },
];

function Bubble({ message }: { message: ChatMessage }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: message.from === 'user' ? 'flex-end' : 'flex-start',
        padding: 'var(--space-2) var(--space-4)',
      }}
    >
      <div
        style={{
          maxWidth: '32rem',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          backgroundColor: message.from === 'user' ? 'var(--primary)' : 'var(--muted)',
          color: message.from === 'user' ? 'var(--primary-foreground)' : 'var(--foreground)',
          fontSize: 'var(--text-body-size)',
          lineHeight: 'var(--text-body-line-height)',
        }}
      >
        {message.text}
      </div>
    </div>
  );
}

function frame(children: ReactNode, height = '16rem') {
  return (
    <MessageScroller
      style={{
        height,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: 'var(--surface)',
      }}
    >
      {children}
    </MessageScroller>
  );
}

function JumpToEnd() {
  const { end } = useMessageScrollerScrollable();
  return end ? <MessageScrollerButton direction="end" /> : null;
}

function CommandButtons() {
  const { scrollToEnd, scrollToMessage, scrollToStart } = useMessageScroller();
  return (
    <Row>
      <Button size="sm" variant="outline" onClick={() => scrollToStart()}>
        Scroll to start
      </Button>
      <Button size="sm" variant="outline" onClick={() => scrollToMessage('7')}>
        Jump to message 7
      </Button>
      <Button size="sm" variant="outline" onClick={() => scrollToEnd()}>
        Scroll to end
      </Button>
    </Row>
  );
}

function TranscriptOutline() {
  const { currentAnchorId } = useMessageScrollerVisibility();
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-1)' }}>
      {TRANSCRIPT.map((message) => (
        <li
          key={message.id}
          style={{
            fontWeight: currentAnchorId === message.id ? 'var(--text-label-weight)' : undefined,
            color: currentAnchorId === message.id ? 'var(--foreground)' : 'var(--muted-foreground)',
          }}
        >
          #{message.id} {message.from}
        </li>
      ))}
    </ul>
  );
}

const RECENT = TRANSCRIPT.slice(-6);

export default function MessageScrollerExample() {
  const [loadedOlder, setLoadedOlder] = useState(false);
  const history = loadedOlder ? TRANSCRIPT : RECENT;

  return (
    <>
      <Section title="New chat">
        <MessageScrollerProvider defaultScrollPosition="end">
          {frame(
            <>
              <MessageScrollerViewport>
                <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                  {TRANSCRIPT.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={index === TRANSCRIPT.length - 1}
                    >
                      <Bubble message={message} />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <JumpToEnd />
            </>,
          )}
        </MessageScrollerProvider>
      </Section>

      <Section title="Keeping context visible">
        <MessageScrollerProvider defaultScrollPosition="end" scrollPreviousItemPeek={48}>
          {frame(
            <MessageScrollerViewport>
              <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                {TRANSCRIPT.slice(-4).map((message, index, arr) => (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={index === arr.length - 1}>
                    <Bubble message={message} />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>,
          )}
        </MessageScrollerProvider>
      </Section>

      <Section title="Group chat">
        <MessageScrollerProvider defaultScrollPosition="end">
          {frame(
            <MessageScrollerViewport>
              <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                <MessageScrollerItem messageId="joined" scrollAnchor>
                  <Marker variant="separator">
                    <MarkerContent>Marcus joined</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
                {TRANSCRIPT.slice(-3).map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    <Bubble message={message} />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>,
          )}
        </MessageScrollerProvider>
      </Section>

      <Section title="Opening position">
        <Row style={{ alignItems: 'stretch' }}>
          {(['start', 'end', 'last-anchor'] as const).map((position) => (
            <div key={position} style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>{position}</span>
              <MessageScrollerProvider defaultScrollPosition={position}>
                {frame(
                  <MessageScrollerViewport>
                    <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                      {TRANSCRIPT.slice(-5).map((message, index, arr) => (
                        <MessageScrollerItem
                          key={message.id}
                          messageId={message.id}
                          scrollAnchor={index === arr.length - 1}
                        >
                          <Bubble message={message} />
                        </MessageScrollerItem>
                      ))}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>,
                  '10rem',
                )}
              </MessageScrollerProvider>
            </div>
          ))}
        </Row>
      </Section>

      <Section title="Load history">
        <MessageScrollerProvider defaultScrollPosition="end">
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Row>
              <Button size="sm" variant="outline" disabled={loadedOlder} onClick={() => setLoadedOlder(true)}>
                Load older messages
              </Button>
            </Row>
            {frame(
              <MessageScrollerViewport preserveScrollOnPrepend>
                <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                  {history.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={index === history.length - 1}
                    >
                      <Bubble message={message} />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>,
            )}
          </div>
        </MessageScrollerProvider>
      </Section>

      <Section title="Commands">
        <MessageScrollerProvider defaultScrollPosition="end">
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <CommandButtons />
            {frame(
              <MessageScrollerViewport>
                <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                  {TRANSCRIPT.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={index === TRANSCRIPT.length - 1}
                    >
                      <Bubble message={message} />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>,
            )}
          </div>
        </MessageScrollerProvider>
      </Section>

      <Section title="Transcript outline">
        <MessageScrollerProvider defaultScrollPosition="end">
          <div style={{ display: 'grid', gridTemplateColumns: '10rem 1fr', gap: 'var(--space-3)' }}>
            <TranscriptOutline />
            {frame(
              <MessageScrollerViewport>
                <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                  {TRANSCRIPT.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={index === TRANSCRIPT.length - 1}
                    >
                      <Bubble message={message} />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>,
            )}
          </div>
        </MessageScrollerProvider>
      </Section>

      <Section title="Scroll status">
        <MessageScrollerProvider defaultScrollPosition="end">
          {frame(
            <>
              <MessageScrollerViewport>
                <MessageScrollerContent style={{ paddingBlock: 'var(--space-3)' }}>
                  {TRANSCRIPT.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={index === TRANSCRIPT.length - 1}
                    >
                      <Bubble message={message} />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <JumpToEnd />
            </>,
          )}
        </MessageScrollerProvider>
      </Section>
    </>
  );
}
