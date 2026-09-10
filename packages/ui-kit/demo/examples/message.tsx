import {
  Attachment,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  Avatar,
  AvatarFallback,
  Button,
  Bubble,
  BubbleContent,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from '@gears-frontx/ui-kit';

import { CloseIcon, DemoIcon, Section } from '../shared';

export default function MessageExample() {
  return (
    <>
      <Section title="Basic conversation">
        <Message>
          <MessageAvatar>
            <Avatar>
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
          </MessageAvatar>
          <MessageContent>
            <Bubble>
              <BubbleContent>How can I help you today?</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
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
      </Section>

      <Section title="Group">
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
      </Section>

      <Section title="Header and footer">
        <Message>
          <MessageAvatar>
            <Avatar>
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
          </MessageAvatar>
          <MessageContent>
            <MessageHeader>Assistant</MessageHeader>
            <Bubble>
              <BubbleContent>Done — 4 files changed.</BubbleContent>
            </Bubble>
            <MessageFooter>Delivered</MessageFooter>
          </MessageContent>
        </Message>
        <Message align="end">
          <MessageAvatar>
            <Avatar>
              <AvatarFallback>You</AvatarFallback>
            </Avatar>
          </MessageAvatar>
          <MessageContent>
            <Bubble align="end">
              <BubbleContent>Thanks!</BubbleContent>
            </Bubble>
            <MessageFooter>Read Yesterday</MessageFooter>
          </MessageContent>
        </Message>
      </Section>

      <Section title="Actions">
        <Message>
          <MessageAvatar>
            <Avatar>
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
          </MessageAvatar>
          <MessageContent>
            <Bubble>
              <BubbleContent>Failed to send.</BubbleContent>
            </Bubble>
            <MessageFooter>
              <Button variant="ghost" size="sm">
                Retry
              </Button>
              <Button variant="ghost" size="sm">
                Copy
              </Button>
            </MessageFooter>
          </MessageContent>
        </Message>
      </Section>

      <Section title="Attachment">
        <Message align="end">
          <MessageAvatar>
            <Avatar>
              <AvatarFallback>You</AvatarFallback>
            </Avatar>
          </MessageAvatar>
          <MessageContent>
            <Attachment>
              <AttachmentMedia>
                <DemoIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>sales-dashboard.pdf</AttachmentTitle>
                <AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
              </AttachmentContent>
              <AttachmentAction aria-label="Remove sales-dashboard.pdf">
                <CloseIcon />
              </AttachmentAction>
            </Attachment>
            <Bubble align="end">
              <BubbleContent>Here is the latest dashboard export.</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </Section>
    </>
  );
}
