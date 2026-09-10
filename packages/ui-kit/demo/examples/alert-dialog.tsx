import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Section } from '../shared';

const longParagraphs = Array.from({ length: 12 }, (_, index) => (
  <p key={index}>
    Paragraph {index + 1}. This action cannot be undone. This will permanently delete your account
    and remove its data from our servers.
  </p>
));

export default function AlertDialogExample() {
  return (
    <>
      <Section title="Default">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="outline">Enable notifications</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Enable notifications?</AlertDialogTitle>
              <AlertDialogDescription>
                You can turn this off again at any time from settings.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Enable</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>

      <Section title="Destructive">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive">Delete account</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete your account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive">Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>

      <Section title="Scrollable content">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive">Delete account</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>Scroll to read the full consequences.</AlertDialogDescription>
            </AlertDialogHeader>
            {longParagraphs}
            {/* Sticky + opaque by default now - no inline workaround needed. */}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive">Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>

      <Section title="Small">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="outline">Sign out</Button>} />
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out?</AlertDialogTitle>
              <AlertDialogDescription>You'll need to sign in again next time.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Sign out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>

      <Section title="With media">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive">Discard draft</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <DemoIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
              <AlertDialogDescription>
                Your unsaved changes will be lost permanently.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction variant="destructive">Discard</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>

      <Section title="Small with media">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive">Remove device</Button>} />
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogMedia>
                <DemoIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Remove this device?</AlertDialogTitle>
              <AlertDialogDescription>It will be signed out immediately.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>
    </>
  );
}
