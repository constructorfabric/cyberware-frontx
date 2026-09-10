import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScreenExtension } from '@gears-frontx/react';
import { EMPTY_STATE_GRACE_MS, Menu } from './Menu';

const mockUseFrontX = vi.fn();
const mockUseMountedExtensions = vi.fn();

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: () => undefined,
  useFrontX: () => mockUseFrontX(),
  useMountedExtensions: () => mockUseMountedExtensions(),
}));

const screenExtension = (
  id: string,
  route: string,
  order: number,
  label: string = id
): ScreenExtension => ({
  id,
  domain: 'screen-domain',
  entry: `${id}.entry`,
  presentation: { label, route, order },
});

/**
 * An extension the registry accepts and the menu cannot render: `presentation`
 * is asserted by a cast rather than validated anywhere on the registration
 * path, so this shape reaches the menu in a real boot.
 */
const withoutPresentation = (id: string) => ({ id, domain: 'screen-domain', entry: `${id}.entry` });

// Shaped like a real registry id - dots, tildes and all - so the test id
// assertion below stands as evidence that the id goes in verbatim rather than
// through a slug step that would flatten exactly this punctuation.
const tasks = screenExtension(
  'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.tasks.v1',
  '/tasks',
  20,
  'Tasks'
);

describe('Menu', () => {
  let app: {
    mfeRegistry: {
      getExtensionsForDomain: ReturnType<typeof vi.fn>;
      executeActionsChain: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    app = {
      mfeRegistry: {
        getExtensionsForDomain: vi.fn().mockReturnValue([tasks]),
        executeActionsChain: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockUseFrontX.mockReturnValue(app);
    mockUseMountedExtensions.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const emptyState = () => screen.queryByText(/No screens yet/);

  it('mounts the screen a menu item names when that item is clicked through its test id', async () => {
    render(<Menu />);

    // Driven through the test id an unattended browser run addresses this item
    // by, spelled out rather than built with `menuItemTestId`: the point is to
    // hold the published derivation - the `menu-item-` prefix and the
    // extension id verbatim after it - which a shared helper on both sides
    // would let drift unnoticed.
    await userEvent.click(await screen.findByTestId(`menu-item-${tasks.id}`));

    await waitFor(() => {
      expect(app.mfeRegistry.executeActionsChain).toHaveBeenCalledTimes(1);
    });
    const chain = app.mfeRegistry.executeActionsChain.mock.calls[0][0] as {
      action: { payload: { subject: string } };
    };
    expect(chain.action.payload.subject).toBe(tasks.id);
  });

  it('stays blank instead of claiming there are no screens while the MFEs are still registering', async () => {
    // The registry is empty on the first poll and populated on the next one -
    // exactly what a hard page load looks like from the menu's side.
    app.mfeRegistry.getExtensionsForDomain.mockReturnValueOnce([]).mockReturnValue([tasks]);
    vi.useFakeTimers();
    render(<Menu />);

    expect(emptyState()).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_GRACE_MS);
    });

    expect(emptyState()).toBeNull();
    expect(screen.getByText(tasks.presentation.label)).toBeTruthy();
  });

  it('shows the empty state after the grace window when the app carries no MFE registry at all', async () => {
    // `mfeRegistry` is optional on the app, so a project without the
    // microfrontends plugin has no registry to poll and no screens coming.
    // That reader is the one the hint is written for, which is why the grace
    // window is timed from mount rather than from discovery: tied to the
    // registry it would never close here.
    mockUseFrontX.mockReturnValue({ mfeRegistry: undefined });
    vi.useFakeTimers();
    render(<Menu />);

    expect(emptyState()).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_GRACE_MS);
    });

    expect(emptyState()).not.toBeNull();
  });

  it('never claims there are no screens when a populated registry only appears after the grace window', async () => {
    // The grace window is timed from mount, so it can close before a registry
    // exists at all - the app object carries none until the microfrontends
    // plugin has one to hand over.
    mockUseFrontX.mockReturnValue({ mfeRegistry: undefined });
    vi.useFakeTimers();
    const { container, rerender } = render(<Menu />);

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_GRACE_MS);
    });

    // Sampled from inside the read rather than after it, because the render
    // this guards against is not the one the test can assert on afterwards:
    // discovery polls from an effect, so the first read of the late registry
    // runs against the DOM committed for the render that introduced it - the
    // exact render a settled-only gate renders the hint in, one commit before
    // the screens land.
    const domDuringReads: string[] = [];
    app.mfeRegistry.getExtensionsForDomain.mockImplementation(() => {
      domDuringReads.push(container.textContent ?? '');
      return [tasks];
    });
    mockUseFrontX.mockReturnValue(app);
    await act(async () => {
      rerender(<Menu />);
    });

    expect(domDuringReads.length).toBeGreaterThan(0);
    expect(domDuringReads.join('\n')).not.toMatch(/No screens yet/);
    expect(emptyState()).toBeNull();
    expect(screen.getByText(tasks.presentation.label)).toBeTruthy();
  });

  it('still lists the well-formed screens when a sibling extension carries no presentation metadata', async () => {
    // `getExtensionsForDomain` is typed loosely and cast, so `presentation` is
    // asserted rather than checked and nothing on the path from the manifest to
    // `registry.registerExtension` checks it either. One such sibling must cost
    // only itself: dereferencing it mid-sort throws, and a throw that takes the
    // read takes every valid screen with it and leaves the menu claiming there
    // are none. Paired with a well-formed extension because a one-element sort
    // never calls the comparator: it takes a second element for the dereference
    // the cast permits to actually run.
    app.mfeRegistry.getExtensionsForDomain.mockReturnValue([tasks, withoutPresentation('broken')]);
    vi.useFakeTimers();

    render(<Menu />);

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_GRACE_MS);
    });

    expect(screen.getByText(tasks.presentation.label)).toBeTruthy();
    expect(emptyState()).toBeNull();
  });

  it('falls back to the empty-state hint when every registered extension lacks presentation metadata', async () => {
    // Nothing survives the presentation check here, so the menu has no screen it
    // could name and the hint is again the only thing worth rendering.
    app.mfeRegistry.getExtensionsForDomain.mockReturnValue([
      withoutPresentation('broken-one'),
      withoutPresentation('broken-two'),
    ]);
    vi.useFakeTimers();

    render(<Menu />);

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_GRACE_MS);
    });

    expect(emptyState()).not.toBeNull();
  });

  it('reaches the empty-state hint and logs a throwing registry read once, not once per poll', async () => {
    // A registry broken past one malformed extension - the case the catch is
    // still there for. Two claims ride on it. The hint must stay reachable: with
    // the read left unmarked, discovery never completes and the fallback becomes
    // unreachable for good. And the failure must cost one log line, not the two
    // per second a 500ms poll produces for a condition that does not clear.
    const readFailure = new Error('registry unavailable');
    app.mfeRegistry.getExtensionsForDomain.mockImplementation(() => {
      throw readFailure;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    // Rendering at all is part of the claim: an escaping throw here comes out of
    // the effect body, not the interval, and takes the tree down.
    render(<Menu />);

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_GRACE_MS * 3);
    });

    expect(emptyState()).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[Menu] Failed to read screen extensions'),
      expect.any(Error)
    );
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('shows the empty state once the grace window passes with nothing registered', async () => {
    app.mfeRegistry.getExtensionsForDomain.mockReturnValue([]);
    vi.useFakeTimers();
    render(<Menu />);

    expect(emptyState()).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_GRACE_MS);
    });

    expect(emptyState()).not.toBeNull();
  });
});
