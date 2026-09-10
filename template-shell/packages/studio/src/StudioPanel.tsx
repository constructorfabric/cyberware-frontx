import React from 'react';
import { useTranslation } from '@gears-frontx/react';
import { Card } from './uikit/base/card';
import { Button } from './uikit/base/button';
import { ButtonVariant, ButtonSize } from './uikit/types';
import { useDraggable } from './hooks/useDraggable';
import { useResizable } from './hooks/useResizable';
import { useStudioContext } from './StudioProvider';
import { ControlPanel } from './sections/ControlPanel';
import { STORAGE_KEYS } from './types';
import { STUDIO_COLLAPSE_TESTID } from './testIds';

export const StudioPanel: React.FC = () => {
  const { toggleCollapsed, setPortalContainer } = useStudioContext();
  const { t } = useTranslation();
  const portalRef = React.useRef<HTMLDivElement>(null);

  // Initialize hooks
  const { size, isResizing: _isResizing, handleMouseDown: handleResizeMouseDown } = useResizable();

  const { position, isDragging, handleMouseDown: handleDragMouseDown } = useDraggable({
    panelSize: size,
    storageKey: STORAGE_KEYS.POSITION,
  });

  // Register portal container with context on mount
  React.useEffect(() => {
    setPortalContainer(portalRef.current);
    return () => setPortalContainer(null);
  }, [setPortalContainer]);

  return (
    <>
      {/* High z-index portal container for dropdowns */}
      <div
        ref={portalRef}
        className="studio-portal-container fixed z-[99999] pointer-events-none"
      />

      <div
        className="studio-panel fixed z-[10000]"
        // The floating panel is page content outside <header>/<main>, so it
        // carries its own landmark (axe: region) — complementary fits a
        // supporting dev tool that is not part of the page's main flow.
        role="complementary"
        aria-label={t('studio:title')}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
        }}
      >
      <Card className="h-full w-full flex flex-col overflow-hidden bg-white/20 dark:bg-black/50 backdrop-blur-md backdrop-saturate-[180%] border border-white/30 dark:border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.2)]">
        {/* Header with drag handle */}
        {/* jsx-a11y/no-static-element-interactions is exempted for this file in
            eslint.config.js (an inline directive can't be used: the plugin
            arrives with an installed verify package, and a directive is an
            error when the rule is undefined and unused when it never fires):
            onMouseDown starts a pointer-only panel drag; the header's real
            controls (collapse button) are native and keyboard-reachable. */}
        <div
          className="studio-header px-4 py-3 border-b border-[color-mix(in_oklab,var(--border)_50%,transparent)] select-none flex items-center justify-between"
          onMouseDown={handleDragMouseDown}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <h2 className="text-sm font-semibold text-foreground">{t('studio:title')}</h2>
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Sm}
            onClick={toggleCollapsed}
            data-testid={STUDIO_COLLAPSE_TESTID}
            className="h-7 w-7 p-0"
            aria-label={t('studio:aria.collapseButton')}
            title={t('studio:aria.collapseButton')}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <ControlPanel />
        </div>

        {/* Resize handle */}
        <div
          className="studio-resize-handle absolute bottom-1 right-1 w-5 h-5 cursor-nwse-resize"
          onMouseDown={handleResizeMouseDown}
          role="button"
          aria-label={t('studio:aria.resizeHandle')}
          title={t('studio:aria.resizeHandle')}
          tabIndex={0}
        >
          <svg
            className="w-5 h-5 text-[color-mix(in_oklab,var(--muted-foreground)_70%,transparent)] hover:text-muted-foreground transition-colors"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
          </svg>
        </div>
      </Card>
    </div>
    </>
  );
};

StudioPanel.displayName = 'StudioPanel';
