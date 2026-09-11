import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

function Pane({ children }: { children: string }) {
  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        fontSize: 'var(--text-body-size)',
        color: 'var(--muted-foreground)',
      }}
    >
      {children}
    </div>
  );
}

const groupStyle = {
  height: 200,
  border: 'var(--border-width) solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

export default function ResizableExample() {
  return (
    <>
      <Section title="Horizontal">
        <ResizablePanelGroup style={groupStyle}>
          <ResizablePanel defaultSize={30} minSize={15}>
            <Pane>One</Pane>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel>
            <Pane>Two</Pane>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize={15}>
            <Pane>Three</Pane>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>

      <Section title="Vertical">
        <ResizablePanelGroup orientation="vertical" style={groupStyle}>
          <ResizablePanel defaultSize={40}>
            <Pane>Header</Pane>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel>
            <Pane>Content</Pane>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>

      <Section title="With handle">
        <ResizablePanelGroup style={groupStyle}>
          <ResizablePanel defaultSize={30} minSize={15}>
            <Pane>Sidebar</Pane>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel>
            <Pane>Content</Pane>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>

      <Section title="Nested">
        <ResizablePanelGroup style={groupStyle}>
          <ResizablePanel defaultSize={30} minSize={15}>
            <Pane>Sidebar</Pane>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel>
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize={65}>
                <Pane>Editor</Pane>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel minSize={15}>
                <Pane>Console</Pane>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>
    </>
  );
}
