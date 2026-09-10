import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import buttonStyles from '../button/button.module.css';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';
import styles from './alert-dialog.module.css';

afterEach(cleanup);

function renderAlertDialog(onAction = vi.fn()) {
  render(
    <AlertDialog>
      <AlertDialogTrigger>Delete account</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAction}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
  return onAction;
}

describe('AlertDialog', () => {
  it('renders a trigger and keeps the popup out of the DOM until opened', () => {
    renderAlertDialog();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens on trigger click and renders content with kit classes', () => {
    renderAlertDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const popup = screen.getByRole('alertdialog');
    expect(popup.className).toContain(styles.popup);
    expect(screen.getByText('Are you absolutely sure?').className).toContain(styles.title);
    expect(screen.getByText('This action cannot be undone.').className).toContain(
      styles.description,
    );
  });

  // An alert dialog demands an explicit choice — unlike Dialog/Popover,
  // Base UI's AlertDialog does not close on outside press.
  it('does not close on outside click', async () => {
    renderAlertDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('closes via AlertDialogCancel', async () => {
    renderAlertDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('runs the action handler and closes via AlertDialogAction', async () => {
    const onAction = renderAlertDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  // The escape hatch an async confirm needs: keep the dialog up while the
  // work runs, without giving up the Close semantics for every other case.
  it('keeps the dialog open when the action handler prevents the Base UI handler', async () => {
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete account</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogAction onClick={(event) => event.preventBaseUIHandler()}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  // The whole async-confirm flow, end to end: prevent the close, go
  // loading, and the same button cannot be pressed again while the request
  // is in flight — then the consumer closes the dialog itself.
  it('keeps a loading action pressed-once and closable by the consumer', async () => {
    function AsyncConfirm() {
      const [open, setOpen] = useState(true);
      const [loading, setLoading] = useState(false);
      const [clicks, setClicks] = useState(0);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <span data-testid="clicks">{clicks}</span>
            <AlertDialogFooter>
              <AlertDialogAction
                loading={loading}
                onClick={(event) => {
                  event.preventBaseUIHandler();
                  setClicks((count) => count + 1);
                  setLoading(true);
                }}
              >
                Continue
              </AlertDialogAction>
              {/* Stands in for the async work resolving — the consumer
                * owns `open`, so it is the consumer that closes. Inside the
                * footer because a modal alert dialog inerts the page behind
                * it, so a control out there would be unreachable. */}
              <button type="button" onClick={() => setOpen(false)}>
                finish
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }

    render(<AsyncConfirm />);
    const action = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(action);

    expect(screen.getByTestId('clicks').textContent).toBe('1');
    expect(action.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    // Second press while the work is in flight does nothing.
    fireEvent.click(action);
    expect(screen.getByTestId('clicks').textContent).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('renders an icon through Button\'s own slot, not as a child', () => {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogAction icon={<svg data-testid="glyph" />}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const action = screen.getByRole('button', { name: 'Continue' });
    // Button's icon slot wraps it; a child would land in the label span
    // instead, losing the gap and centering (see button.tsx).
    expect(screen.getByTestId('glyph').parentElement?.className).toContain(buttonStyles.icon);
    expect(action.hasAttribute('data-icon-only')).toBe(false);
  });

  it('renders the backdrop by default', () => {
    renderAlertDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(document.querySelector(`.${styles.backdrop}`)).toBeTruthy();
  });

  it('omits the backdrop when showBackdrop is false', () => {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogTrigger>Delete account</AlertDialogTrigger>
        <AlertDialogContent showBackdrop={false}>
          <AlertDialogTitle>No backdrop</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(document.querySelector(`.${styles.backdrop}`)).toBeNull();
  });

  it('stamps data-size on the popup for the footer/width CSS to key off', () => {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogTrigger>Delete account</AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogTitle>Small</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByRole('alertdialog').getAttribute('data-size')).toBe('sm');
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <AlertDialog defaultOpen>
        <AlertDialogTrigger>Delete account</AlertDialogTrigger>
        <AlertDialogContent container={container}>
          <AlertDialogTitle>Themed</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const popup = screen.getByRole('alertdialog');
    expect(container.contains(popup)).toBe(true);
    container.remove();
  });
});
