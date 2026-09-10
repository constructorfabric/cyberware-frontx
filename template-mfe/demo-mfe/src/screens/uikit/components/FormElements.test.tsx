import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FormElements } from './FormElements';

// The identity `t` makes the translation key the rendered text, so the
// assertions name the message key rather than a translation that can be
// reworded.
function renderFormElements() {
  render(<FormElements t={(key) => key} portalContainer={{ current: null }} />);
  return screen.getByLabelText('Email');
}

describe('FormElements email field', () => {
  it('flags a malformed address once the field is left', async () => {
    const user = userEvent.setup();
    const email = renderFormElements();

    await user.type(email, 'not-an-email');
    await user.tab();

    expect(screen.getByText('form_email_invalid')).toBeTruthy();
  });

  it('says nothing while a first address is still being typed', async () => {
    const user = userEvent.setup();
    const email = renderFormElements();

    await user.type(email, 'not-an-email');

    expect(screen.queryByText('form_email_invalid')).toBeNull();
  });

  it('clears a shown message as soon as the address is corrected, without waiting for another blur', async () => {
    const user = userEvent.setup();
    const email = renderFormElements();

    await user.type(email, 'not-an-email');
    await user.tab();
    await user.click(email);
    await user.type(email, '@company.com');

    expect(screen.queryByText('form_email_invalid')).toBeNull();
  });
});
