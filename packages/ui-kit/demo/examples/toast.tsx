import { Button, toast } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

// The Toaster viewport that actually renders these lives once at the app
// root (main.tsx) — Base UI's toast manager is a singleton, so a second
// mount per screen would just fight the first over the same queue.
export default function ToastExample() {
  return (
    <>
      <Section title="Default">
        <Row>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: 'Saved', description: 'Palette applied.' })}
          >
            Show toast
          </Button>
        </Row>
      </Section>

      <Section title="Types">
        <Row>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: 'Saved', description: 'Palette applied.', type: 'success' })}
          >
            Success
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: 'Heads up', description: 'A new version is available.', type: 'info' })}
          >
            Info
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: 'Low storage', description: '90% of quota used.', type: 'warning' })}
          >
            Warning
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: 'Failed', description: 'Try again.', type: 'error' })}
          >
            Error
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: 'Syncing…', type: 'loading' })}
          >
            Loading
          </Button>
        </Row>
      </Section>

      <Section title="Action">
        <Row>
          <Button
            variant="secondary"
            onClick={() =>
              toast.add({
                title: 'File deleted',
                actionProps: { children: 'Undo', onClick: () => toast.add({ title: 'Restored' }) },
              })
            }
          >
            With action
          </Button>
        </Row>
      </Section>

      <Section title="Promise">
        <Row>
          <Button
            variant="secondary"
            onClick={() =>
              toast.promise(
                new Promise<string>((resolve, reject) =>
                  setTimeout(() => (Math.random() > 0.3 ? resolve('draft-1') : reject(new Error('Network error'))), 1500),
                ),
                {
                  loading: 'Saving…',
                  success: (id) => `Saved as ${id}`,
                  error: (thrown) => (thrown instanceof Error ? thrown.message : 'Failed to save'),
                },
              )
            }
          >
            Save draft
          </Button>
        </Row>
      </Section>
    </>
  );
}
