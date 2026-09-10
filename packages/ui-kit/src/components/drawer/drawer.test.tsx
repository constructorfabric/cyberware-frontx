import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';
import styles from './drawer.module.css';

afterEach(cleanup);

function renderDrawer(rootProps: Parameters<typeof Drawer>[0] = {}) {
  return render(
    <Drawer {...rootProps}>
      <DrawerTrigger>Open</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Edit profile</DrawerTitle>
          <DrawerDescription>Make changes to your profile here.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>,
  );
}

describe('Drawer', () => {
  it('renders a trigger and keeps the popup out of the DOM until opened', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on trigger click and renders content with kit classes', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain(styles.popup);
    expect(screen.getByText('Edit profile').className).toContain(styles.title);
    expect(screen.getByText('Make changes to your profile here.').className).toContain(
      styles.description,
    );
  });

  // Base UI's own runtime data-swipe-direction attribute is what actually
  // drives the slide/dismiss geometry (see drawer.module.css) — this only
  // asserts the kit's OWN side-prop-driven half: the CVA .sideXxx class and
  // its data-side twin, mirroring sheet.test.tsx's equivalent case exactly.
  it.each([
    ['top', styles.sideTop],
    ['right', styles.sideRight],
    ['bottom', styles.sideBottom],
    ['left', styles.sideLeft],
  ] as const)('applies the %s side class', (side, sideClass) => {
    render(
      <Drawer defaultOpen side={side}>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Panel</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain(sideClass);
    expect(dialog.getAttribute('data-side')).toBe(side);
  });

  it('defaults to the bottom side when no side prop is given', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog').className).toContain(styles.sideBottom);
  });

  it('closes on Escape', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on an outside press (a click on the backdrop)', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.mouseUp(document.body);
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes via a consumer-composed DrawerClose', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <Drawer defaultOpen>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent container={container}>
          <DrawerTitle>Themed</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(true);
    container.remove();
  });

  // modal={false} on the root is Drawer's only backdrop escape hatch —
  // unlike Dialog/Sheet, DrawerContent has no separate showBackdrop prop:
  // upstream's own fetched source ties the Overlay strictly to
  // `modal === true` with no independent opt-out, and this port stays
  // faithful to that shape (see drawer.tsx's own comment on the choice).
  it('omits the backdrop when modal is false', () => {
    render(
      <Drawer defaultOpen modal={false}>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Non-modal</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector(`.${styles.backdrop}`)).toBeNull();
  });

  it('renders the backdrop by default', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.querySelector(`.${styles.backdrop}`)).toBeTruthy();
  });

  it('renders a swipe handle when showSwipeHandle is true', () => {
    render(
      <Drawer defaultOpen showSwipeHandle>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Grab me</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    expect(document.querySelector(`.${styles.swipeHandle}`)).toBeTruthy();
  });

  it('omits the swipe handle by default', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.querySelector(`.${styles.swipeHandle}`)).toBeNull();
  });

  // Swipe-gesture dismissal itself (a real pointer-drag sequence recognized
  // by Base UI's own useSwipeDismiss) is Base UI's responsibility, not this
  // port's, and isn't practically simulatable through jsdom's synthetic
  // pointer events (no real layout/geometry to derive a drag distance or
  // velocity from) — trigger/backdrop/Escape/close-button dismissal above
  // already cover the kit-level open/close contract this port owns.

  /*
   * Source-level, not behavioural: the enter/exit slide is a pure CSS
   * transition between `[data-starting-style]`/`[data-ending-style]` and the
   * resting transform, and jsdom neither resolves calc() nor runs
   * transitions, so nothing rendered can observe this. What it guards is a
   * failure mode that is invisible in every other check: inside calc(), a
   * bare `0` is a <number>, and adding a number to a <length-percentage> is
   * a type error, which makes `--closed-transform` invalid at computed-value
   * time and silently collapses `transform: var(--closed-transform)` to
   * `none`. The drawer then materialises at its resting place and vanishes
   * from it while the backdrop still fades — read by reviewers as the
   * animation running backwards. This shipped once (`--drawer-inset: 0`);
   * the guard is here because the symptom points nowhere near the cause.
   */
  it('keeps --drawer-inset length-typed for the --closed-transform calc()s', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'drawer.module.css'), 'utf8');

    const closedTransforms = [...css.matchAll(/--closed-transform:([^;]+);/g)].map(([, v]) => v);
    expect(closedTransforms.length, '--closed-transform is no longer declared per side').toBe(4);
    for (const value of closedTransforms) {
      expect(value, 'a --closed-transform stopped accounting for --drawer-inset').toContain(
        'var(--drawer-inset',
      );
    }

    // Every value --drawer-inset can take here: this file's own default plus
    // any fallback the calc()s supply. A consumer override is out of reach of
    // a source check — hence the unit requirement stated in drawer.md.
    const insetValues = [
      ...[...css.matchAll(/--drawer-inset:\s*([^;]+);/g)].map(([, v]) => v.trim()),
      ...[...css.matchAll(/var\(--drawer-inset,\s*([^)]+)\)/g)].map(([, v]) => v.trim()),
    ];
    expect(insetValues.length, '--drawer-inset is no longer declared').toBeGreaterThan(0);
    for (const value of insetValues) {
      expect(value, `"${value}" is unitless — it makes --closed-transform's calc() a type error`).toMatch(
        /^-?\d*\.?\d+(?:px|rem|em|vh|vw|dvh|dvw|%)$/,
      );
    }
  });
});
