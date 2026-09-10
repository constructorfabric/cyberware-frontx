import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioPanel } from './StudioPanel';

const toggleCollapsed = vi.fn();
const setPortalContainer = vi.fn();
const handleResizeMouseDown = vi.fn();
const handleDragMouseDown = vi.fn();

vi.mock('@gears-frontx/react', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./hooks/useResizable', () => ({
  useResizable: () => ({
    size: { width: 420, height: 520 },
    isResizing: false,
    handleMouseDown: handleResizeMouseDown,
  }),
}));

vi.mock('./hooks/useDraggable', () => ({
  useDraggable: () => ({
    position: { x: 120, y: 80 },
    isDragging: false,
    handleMouseDown: handleDragMouseDown,
  }),
}));

vi.mock('./StudioProvider', () => ({
  useStudioContext: () => ({
    toggleCollapsed,
    setPortalContainer,
  }),
}));

vi.mock('./sections/ControlPanel', () => ({
  ControlPanel: () => <div>control-panel</div>,
}));

describe('StudioPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the translated title and control panel content', () => {
    render(<StudioPanel />);

    screen.getByText('studio:title');
    screen.getByText('control-panel');
  });

  it('applies draggable position and resizable dimensions to the panel', () => {
    const { container } = render(<StudioPanel />);

    const panel = container.querySelector<HTMLDivElement>('.studio-panel');
    expect(panel).not.toBeNull();
    expect(panel?.style.left).toBe('120px');
    expect(panel?.style.top).toBe('80px');
    expect(panel?.style.width).toBe('420px');
    expect(panel?.style.height).toBe('520px');
  });

  it('toggles collapse when the collapse button is clicked', () => {
    render(<StudioPanel />);

    const collapseButton = screen.getByRole('button', {
      name: 'studio:aria.collapseButton',
    });
    // The control an unattended browser run collapses the panel with, and the
    // presence of this id is also how such a run tells an expanded overlay
    // from a collapsed one.
    expect(collapseButton.getAttribute('data-testid')).toBe('studio-collapse');
    fireEvent.click(collapseButton);
    expect(toggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('wires drag and resize mouse handlers to the panel controls', () => {
    const { container } = render(<StudioPanel />);

    const header = container.querySelector('.studio-header');
    expect(header).not.toBeNull();
    fireEvent.mouseDown(header!);
    expect(handleDragMouseDown).toHaveBeenCalledTimes(1);

    const resizeHandle = screen.getByRole('button', {
      name: 'studio:aria.resizeHandle',
    });
    fireEvent.mouseDown(resizeHandle);
    expect(handleResizeMouseDown).toHaveBeenCalledTimes(1);
  });

  it('registers and clears the portal container on mount lifecycle', () => {
    const { unmount } = render(<StudioPanel />);

    expect(setPortalContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        className: expect.stringContaining('studio-portal-container'),
      })
    );

    unmount();

    expect(setPortalContainer).toHaveBeenLastCalledWith(null);
  });
});
