import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';
import styles from './sheet.module.css';

afterEach(cleanup);

function renderSheet(contentProps: Parameters<typeof SheetContent>[0] = {}) {
  return render(
    <Sheet>
      <SheetTrigger>Open</SheetTrigger>
      <SheetContent {...contentProps}>
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>Make changes to your profile here.</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <SheetClose>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>,
  );
}

describe('Sheet', () => {
  it('renders a trigger and keeps the panel out of the DOM until opened', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on trigger click and renders content with kit classes', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain(styles.popup);
    expect(screen.getByText('Edit profile').className).toContain(styles.title);
    expect(screen.getByText('Make changes to your profile here.').className).toContain(
      styles.description,
    );
  });

  it.each([
    ['top', styles.sideTop],
    ['right', styles.sideRight],
    ['bottom', styles.sideBottom],
    ['left', styles.sideLeft],
  ] as const)('applies the %s side class', (side, sideClass) => {
    render(
      <Sheet defaultOpen>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent side={side}>
          <SheetTitle>Panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain(sideClass);
    expect(dialog.getAttribute('data-side')).toBe(side);
  });

  it('defaults to the right side when no side prop is given', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog').className).toContain(styles.sideRight);
  });

  it('closes on Escape', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on an outside press', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.mouseUp(document.body);
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes via the built-in close button', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton.className).toContain(styles.closeButton);
    fireEvent.click(closeButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renames the built-in close button via closeLabel for non-English apps', () => {
    render(
      <Sheet defaultOpen>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent closeLabel="Закрыть">
          <SheetTitle>Локализовано</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('closes via a consumer-composed SheetClose', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('portals the panel into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <Sheet defaultOpen>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent container={container}>
          <SheetTitle>Themed</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(true);
    container.remove();
  });

  // modal={false} alone never yields a usable non-modal sheet: the backdrop
  // still covers the page and click-closes over it. showBackdrop is the
  // other half of that pairing — same contract as Dialog's.
  it('omits the backdrop when showBackdrop is false', () => {
    render(
      <Sheet defaultOpen modal={false}>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent showBackdrop={false}>
          <SheetTitle>Non-modal</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector(`.${styles.backdrop}`)).toBeNull();
  });

  it('renders the backdrop by default', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.querySelector(`.${styles.backdrop}`)).toBeTruthy();
  });

  it('supports a consumer-composed SheetClose when showCloseButton is false', async () => {
    render(
      <Sheet defaultOpen>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent showCloseButton={false}>
          <SheetTitle>No close button</SheetTitle>
          <SheetClose>Cancel</SheetClose>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
