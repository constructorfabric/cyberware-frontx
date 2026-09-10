import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Message, MessageAvatar, MessageContent, MessageFooter, MessageGroup, MessageHeader } from './message';
import styles from './message.module.css';

afterEach(cleanup);

describe('Message', () => {
  it('renders a row with the base class and defaults to start alignment', () => {
    render(<Message data-testid="row">Hi</Message>);
    const row = screen.getByTestId('row');
    expect(row.tagName).toBe('DIV');
    expect(row.className).toContain(styles.message);
    expect(row.getAttribute('data-align')).toBe('start');
  });

  it('reflects align="end" as a data attribute rather than a variant class', () => {
    render(
      <Message data-testid="row" align="end">
        Hi
      </Message>,
    );
    expect(screen.getByTestId('row').getAttribute('data-align')).toBe('end');
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(
      <Message data-testid="row" className="consumer">
        Hi
      </Message>,
    );
    const row = screen.getByTestId('row');
    expect(row.className).toContain(styles.message);
    expect(row.className).toContain('consumer');
  });

  it('does not leak the align prop to the DOM as a bare attribute', () => {
    render(
      <Message data-testid="row" align="end">
        Hi
      </Message>,
    );
    expect(screen.getByTestId('row').hasAttribute('align')).toBe(false);
  });

  it('forwards native div props such as aria-label', () => {
    render(
      <Message data-testid="row" aria-label="Assistant message">
        Hi
      </Message>,
    );
    expect(screen.getByTestId('row').getAttribute('aria-label')).toBe('Assistant message');
  });
});

describe('Message parts', () => {
  it('renders MessageGroup, MessageAvatar, MessageContent, MessageHeader, and MessageFooter with their own classes', () => {
    render(
      <MessageGroup data-testid="group">
        <Message>
          <MessageAvatar data-testid="avatar" />
          <MessageContent data-testid="content">
            <MessageHeader data-testid="header">Assistant</MessageHeader>
            <MessageFooter data-testid="footer">Delivered</MessageFooter>
          </MessageContent>
        </Message>
      </MessageGroup>,
    );
    expect(screen.getByTestId('group').className).toContain(styles.messageGroup);
    expect(screen.getByTestId('avatar').className).toContain(styles.messageAvatar);
    expect(screen.getByTestId('content').className).toContain(styles.messageContent);
    expect(screen.getByTestId('header').className).toContain(styles.messageHeader);
    expect(screen.getByTestId('footer').className).toContain(styles.messageFooter);
  });
});
