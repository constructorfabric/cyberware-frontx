import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DirectionProvider,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Textarea,
} from '@gears-frontx/ui-kit';
import { useId, useState } from 'react';

import { CloseIcon, Row, Section } from '../shared';

const longParagraphs = Array.from({ length: 12 }, (_, index) => (
  <p key={index}>
    Paragraph {index + 1}. This action cannot be undone. This will permanently delete the project and
    remove its data from our servers.
  </p>
));

/*
 * A dialog whose body is a <form>. Worth its own example because the form
 * element sits BETWEEN DialogContent and the header/fields/footer, so the
 * content's own grid gap has to survive that extra wrapper — the regions
 * are still expected to space themselves as if the form were not there.
 * Exercises `size="lg"` and a Textarea with an explicit `rows` at the same
 * time, both of which the popup's width and the field's height depend on.
 */
function ComposeDialog() {
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' });
  const toFieldId = useId();
  const subjectFieldId = useId();
  const bodyFieldId = useId();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setDraft({ to: '', subject: '', body: '' });
      }}
    >
      <DialogTrigger render={<Button variant="outline">Compose message</Button>} />
      <DialogContent size="lg">
        {/* Nothing is submitted anywhere — the demo only needs the markup shape. */}
        <form onSubmit={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>Fields wire their own ids — see field.md.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={toFieldId}>To</FieldLabel>
              <Input
                id={toFieldId}
                type="email"
                value={draft.to}
                onValueChange={(to) => setDraft((previous) => ({ ...previous, to }))}
                placeholder="name@example.com"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={subjectFieldId}>Subject</FieldLabel>
              <Input
                id={subjectFieldId}
                value={draft.subject}
                onValueChange={(subject) => setDraft((previous) => ({ ...previous, subject }))}
                placeholder="What is this about?"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={bodyFieldId}>Message</FieldLabel>
              <Textarea
                id={bodyFieldId}
                rows={8}
                value={draft.body}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, body: event.target.value }))
                }
                placeholder="Write your message…"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={draft.to.trim() === ''}>
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* The same form-wrapped shape at the default width, with a single field. */
function CreateChannelDialog() {
  const [name, setName] = useState('');
  const nameFieldId = useId();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setName('');
      }}
    >
      <DialogTrigger render={<Button variant="outline">New channel</Button>} />
      <DialogContent>
        <form onSubmit={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>New channel</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={nameFieldId}>Channel name</FieldLabel>
            <Input
              id={nameFieldId}
              value={name}
              onValueChange={setName}
              placeholder="design-reviews"
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={name.trim() === ''}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DialogExample() {
  return (
    <>
      <Section title="Default">
        <Dialog>
          <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete project?</DialogTitle>
              <DialogDescription>This action cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <DialogClose render={<Button variant="destructive">Delete</Button>} />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Form dialog">
        <Row>
          <ComposeDialog />
          <CreateChannelDialog />
        </Row>
      </Section>

      <Section title="Custom close button">
        <Dialog>
          <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <DialogTitle>Share link</DialogTitle>
                <DialogClose render={<Button variant="ghost" icon={<CloseIcon />} aria-label="Close" />} />
              </Row>
              <DialogDescription>Anyone with this link can view this document.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button>Done</Button>} />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="No close button">
        <Dialog>
          <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Processing payment</DialogTitle>
              <DialogDescription>Please wait, this will only take a moment.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Scrollable content">
        <Dialog>
          <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Terms of service</DialogTitle>
              <DialogDescription>Read the full agreement before continuing.</DialogDescription>
            </DialogHeader>
            <div style={{ maxHeight: '16rem', overflowY: 'auto', display: 'grid', gap: 'var(--space-3)' }}>
              {longParagraphs}
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Decline</Button>} />
              <DialogClose render={<Button>Accept</Button>} />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Sticky footer">
        <Dialog>
          <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Terms of service</DialogTitle>
              <DialogDescription>Scroll to read the full agreement.</DialogDescription>
            </DialogHeader>
            {longParagraphs}
            {/* Sticky + opaque by default now - no inline workaround needed. */}
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Decline</Button>} />
              <DialogClose render={<Button>Accept</Button>} />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="RTL">
        <DirectionProvider direction="rtl">
          <Dialog>
            <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete project?</DialogTitle>
                <DialogDescription>This action cannot be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Cancel</Button>} />
                <DialogClose render={<Button variant="destructive">Delete</Button>} />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DirectionProvider>
      </Section>
    </>
  );
}
