import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import styles from './dialog.module.css';

afterEach(cleanup);

function renderDialog(rootProps: Parameters<typeof Dialog>[0] = {}) {
  return render(
    <Dialog {...rootProps}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

describe('Dialog', () => {
  it('renders a trigger and keeps the popup out of the DOM until opened', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on trigger click and renders content with kit classes', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain(styles.popup);
    expect(screen.getByText('Delete project').className).toContain(styles.title);
    expect(screen.getByText('This action cannot be undone.').className).toContain(
      styles.description,
    );
  });

  it('closes on Escape', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes via the built-in close button', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton.className).toContain(styles.closeButton);
    fireEvent.click(closeButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renames the built-in close button via closeLabel for non-English apps', () => {
    render(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent closeLabel="Закрыть">
          <DialogTitle>Локализовано</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('closes via a consumer-composed DialogClose', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent container={container}>
          <DialogTitle>Themed</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(true);
    container.remove();
  });

  // modal={false} alone never yielded a usable non-modal dialog: the
  // backdrop still covered the page and click-closed over it. showBackdrop
  // is the other half of that pairing.
  it('omits the backdrop when showBackdrop is false', () => {
    render(
      <Dialog defaultOpen modal={false}>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent showBackdrop={false}>
          <DialogTitle>Non-modal</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector(`.${styles.backdrop}`)).toBeNull();
  });

  it('renders the backdrop by default', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.querySelector(`.${styles.backdrop}`)).toBeTruthy();
  });

  // dialog.md's contract for the opt-out: only disable the built-in X when
  // composing your own DialogClose inside the popup, so the dialog never
  // ships without an in-popup close control. This is that sanctioned shape.
  it('supports a consumer-composed DialogClose when showCloseButton is false', async () => {
    render(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent showCloseButton={false}>
          <DialogTitle>No close button</DialogTitle>
          <DialogClose>Cancel</DialogClose>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stamps data-size on the popup for the width CSS to key off', () => {
    render(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent size="lg">
          <DialogTitle>Wide form</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog').getAttribute('data-size')).toBe('lg');
  });

  it('defaults data-size to "default"', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog').getAttribute('data-size')).toBe('default');
  });
});
