// AttachmentTitle's shimmer and AttachmentGroup's scroll-fade-x/
// no-scrollbar below depend on this package's utility stylesheet —
// side-effect-imported here rather than added to demo/main.tsx, so this
// example carries its own dependency instead of assuming a shell change.
import '@gears-frontx/ui-kit/utilities.css';

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@gears-frontx/ui-kit';
import { CloseIcon, DemoIcon, Row, Section } from '../shared';

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23d4d4d8'/%3E%3C/svg%3E";

export default function AttachmentExample() {
  return (
    <>
      <Section title="Default">
        <Row>
          <Attachment>
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>sales-dashboard.pdf</AttachmentTitle>
              <AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction aria-label="Remove sales-dashboard.pdf">
                <CloseIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        </Row>
      </Section>

      <Section title="Image">
        <Row>
          <Attachment orientation="vertical">
            <AttachmentMedia variant="image">
              <img src={PLACEHOLDER_IMAGE} alt="" />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>workspace.png</AttachmentTitle>
              <AttachmentDescription>PNG · 1.1 MB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment orientation="vertical">
            <AttachmentMedia variant="image">
              <img src={PLACEHOLDER_IMAGE} alt="" />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>diagram.png</AttachmentTitle>
              <AttachmentDescription>PNG · 820 KB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        </Row>
      </Section>

      <Section title="States">
        <Row>
          <Attachment state="idle">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>drop-target.pdf</AttachmentTitle>
              <AttachmentDescription>Awaiting upload</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment state="uploading">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>large-export.csv</AttachmentTitle>
              <AttachmentDescription>Uploading… 64%</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment state="processing">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>video-clip.mp4</AttachmentTitle>
              <AttachmentDescription>Processing…</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment state="error">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>report.docx</AttachmentTitle>
              <AttachmentDescription>Upload failed — network error</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment state="done">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>invoice.pdf</AttachmentTitle>
              <AttachmentDescription>PDF · 340 KB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        </Row>
      </Section>

      <Section title="Sizes">
        <Row style={{ alignItems: 'flex-end' }}>
          <Attachment>
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>notes.md</AttachmentTitle>
              <AttachmentDescription>Markdown · 4 KB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment size="sm">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>notes.md</AttachmentTitle>
              <AttachmentDescription>Markdown · 4 KB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment size="xs">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>todo.txt</AttachmentTitle>
            </AttachmentContent>
          </Attachment>
        </Row>
      </Section>

      <Section title="Group">
        <AttachmentGroup style={{ paddingBlockEnd: 'var(--space-2)' }}>
          <Attachment orientation="vertical">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>diagram.png</AttachmentTitle>
              <AttachmentDescription>PNG · 820 KB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment orientation="vertical">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>screenshot.png</AttachmentTitle>
              <AttachmentDescription>PNG · 1.1 MB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
          <Attachment orientation="vertical">
            <AttachmentMedia>
              <DemoIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>mockup.png</AttachmentTitle>
              <AttachmentDescription>PNG · 640 KB</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        </AttachmentGroup>
      </Section>

      <Section title="Trigger">
        <Row>
          <Dialog>
            <Attachment>
              <AttachmentMedia>
                <DemoIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>research-summary.pdf</AttachmentTitle>
                <AttachmentDescription>PDF · 1.8 MB</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction aria-label="Remove research-summary.pdf">
                  <CloseIcon />
                </AttachmentAction>
              </AttachmentActions>
              <DialogTrigger render={<AttachmentTrigger aria-label="Preview research-summary.pdf" />} />
            </Attachment>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>research-summary.pdf</DialogTitle>
                <DialogDescription>PDF · 1.8 MB</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </Row>
      </Section>
    </>
  );
}
