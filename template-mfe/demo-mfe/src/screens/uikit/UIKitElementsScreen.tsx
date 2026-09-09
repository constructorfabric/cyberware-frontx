/**
 * UIKit Elements Screen
 *
 * Showcase of @gears-frontx/ui-kit's published component surface.
 * Features:
 * - CategoryMenu over the kit's categories
 * - One demo per exported kit component
 * - Lazy loading for category components
 * - Scroll-to-element navigation
 * - i18n support for all text
 * - Theme and language reactivity via bridge
 */

import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { FRONTX_SHARED_PROPERTY_LANGUAGE, FRONTX_SHARED_PROPERTY_THEME } from '@gears-frontx/react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Toaster } from '@gears-frontx/ui-kit';
import { useScreenTranslations } from '../../shared/useScreenTranslations';
import { useBridgeProperty } from '../../shared/useBridgeProperty';
import { useHostDirection } from '../../shared/useHostDirection';
import { kitThemeScopeFor } from '../../shared/kitThemeScope';
import { CategoryMenu } from './components/CategoryMenu';
import styles from './UIKitElements.module.css';

// Lazy-loaded category components
const LayoutElements = lazy(() =>
  import('./components/LayoutElements').then((m) => ({ default: m.LayoutElements }))
);
const NavigationElements = lazy(() =>
  import('./components/NavigationElements').then((m) => ({ default: m.NavigationElements }))
);
const FormElements = lazy(() =>
  import('./components/FormElements').then((m) => ({ default: m.FormElements }))
);
const ActionElements = lazy(() =>
  import('./components/ActionElements').then((m) => ({ default: m.ActionElements }))
);
const FeedbackElements = lazy(() =>
  import('./components/FeedbackElements').then((m) => ({ default: m.FeedbackElements }))
);
const DataDisplayElements = lazy(() =>
  import('./components/DataDisplayElements').then((m) => ({ default: m.DataDisplayElements }))
);
const OverlayElements = lazy(() =>
  import('./components/OverlayElements').then((m) => ({ default: m.OverlayElements }))
);

interface UIKitElementsScreenProps {
  bridge: ChildMfeBridge;
}

// Stable reference for translation modules (hoisted to module level to prevent re-render loops)
const languageModules = import.meta.glob('./i18n/*.json') as Record<
  string,
  () => Promise<{ default: Record<string, string> }>
>;

/**
 * Placeholder for a category still loading.
 *
 * Declared once rather than inline per Suspense boundary: seven identical
 * fallbacks written out is the same tree seven times, and a change to it would
 * have to be made in seven places.
 */
const categoryFallback = (
  <div className={styles.placeholders} role="status" aria-busy="true">
    <Skeleton className={styles.placeholderTitle} />
    <Skeleton className={styles.placeholderBlock} />
  </div>
);

/**
 * UIKit Elements Screen component.
 *
 * Displays a showcase of every component @gears-frontx/ui-kit exports, with:
 * - CategoryMenu navigation
 * - Lazy-loaded category sections
 * - Scroll-to-element functionality
 * - Full i18n support
 * - Theme and language reactivity
 */
export const UIKitElementsScreen: React.FC<UIKitElementsScreenProps> = ({ bridge }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  /*
   * Every kit component that portals — Select, DropdownMenu, Tooltip, Dialog,
   * Toaster — defaults to `<body>`, which is outside this shadow root: the
   * adopted component stylesheets and the tokens on this host both stop at the
   * boundary, so a popup left on the default renders unstyled in the light DOM.
   * They all take a `container`, and Base UI accepts a ref, so this one node
   * serves all five. It has to render before them: Base UI reads the ref in a
   * layout effect on its consumer's first commit, and refs attach in tree order
   * interleaved with those effects, so a consumer placed above this node reads
   * `null` and falls back to `<body>` for good.
   */
  const portalContainerRef = useRef<HTMLDivElement>(null);
  const [activeElement, setActiveElement] = useState<string | undefined>();
  const theme = useBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default');
  const language = useBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en');
  useHostDirection(containerRef, language);

  // Load translations
  const { t, loading: translationsLoading } = useScreenTranslations(languageModules, bridge);

  /*
   * Track which element is in view, for the menu's active highlight.
   *
   * Two things make the set of nodes to observe a moving target, and missing
   * either one leaves the observer holding nothing at all - silently, since an
   * observer with no targets never reports. The first commit renders the
   * skeleton rather than the sections, so the effect has to wait for the
   * translations; and each section then arrives in its own later commit from its
   * own React.lazy chunk, which is what the MutationObserver picks up.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (translationsLoading || container === null) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.target.id.startsWith('element-')) {
            setActiveElement(entry.target.id);
          }
        });
      },
      { rootMargin: '-100px 0px -50% 0px' }
    );

    // Re-observing a node the observer already holds is a no-op; the set is
    // what keeps the callback below from making that call for every section
    // already mounted, on every mutation.
    const observed = new WeakSet<Element>();
    const observeElements = (): void => {
      // Queried from the container rather than from the root node: the
      // container is inside whichever root this screen mounted in - shadow or
      // document - and every section is inside the container.
      container.querySelectorAll('[id^="element-"]').forEach((element) => {
        if (!observed.has(element)) {
          observed.add(element);
          observer.observe(element);
        }
      });
    };

    observeElements();

    const sections = new MutationObserver(observeElements);
    sections.observe(container, { childList: true, subtree: true });

    return () => {
      sections.disconnect();
      observer.disconnect();
    };
  }, [translationsLoading]);

  const kitThemeScope = kitThemeScopeFor(theme);

  if (translationsLoading) {
    return (
      // A Skeleton carries no loading semantics of its own; the region announces them.
      <div
        ref={containerRef}
        className={styles.screen}
        data-theme={kitThemeScope}
        role="status"
        aria-busy="true"
      >
        <div className={styles.placeholders}>
          <Skeleton className={styles.placeholderTitle} />
          <Skeleton className={styles.placeholderLine} />
          <Skeleton className={styles.placeholderBlock} />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.screen} data-theme={kitThemeScope}>
      {/* Sidebar Menu */}
      <aside className={styles.sidebar}>
        <CategoryMenu t={t} activeElement={activeElement} containerRef={containerRef} />
      </aside>

      {/* Main Content */}
      <main className={styles.content}>
        <div className={styles.intro}>
          <h1 className={styles.title}>{t('title')}</h1>
          <p className={styles.description}>{t('description')}</p>
        </div>

        <Suspense fallback={categoryFallback}>
          <LayoutElements t={t} />
        </Suspense>

        <Suspense fallback={categoryFallback}>
          <NavigationElements t={t} />
        </Suspense>

        <Suspense fallback={categoryFallback}>
          <FormElements t={t} portalContainer={portalContainerRef} />
        </Suspense>

        <Suspense fallback={categoryFallback}>
          <ActionElements t={t} portalContainer={portalContainerRef} />
        </Suspense>

        <Suspense fallback={categoryFallback}>
          <FeedbackElements t={t} />
        </Suspense>

        <Suspense fallback={categoryFallback}>
          <DataDisplayElements t={t} portalContainer={portalContainerRef} />
        </Suspense>

        <Suspense fallback={categoryFallback}>
          <OverlayElements t={t} portalContainer={portalContainerRef} />
        </Suspense>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className={styles.sectionTitle}>{t('bridge_info')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className={styles.definitions}>
              <div>
                <dt className={styles.term}>{t('domain_id')}</dt>
                <dd className={styles.value}>{bridge.extDomainId}</dd>
              </div>
              <div>
                <dt className={styles.term}>{t('instance_id')}</dt>
                <dd className={styles.value}>{bridge.extensionId}</dd>
              </div>
              <div>
                <dt className={styles.term}>{t('current_theme')}</dt>
                <dd className={styles.value}>{theme}</dd>
              </div>
              <div>
                <dt className={styles.term}>{t('current_language')}</dt>
                <dd className={styles.value}>{language}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </main>

      {/*
        Ahead of the Toaster on purpose: every consumer of this ref resolves it
        in a layout effect on its own first commit, and a ref belonging to a
        later sibling is not attached yet when that runs.
      */}
      <div ref={portalContainerRef} className={styles.portalContainer} />

      {/*
        Toast container, mounted once for the screen. The shell may run a Toaster
        of its own on the kit's shared manager; this one stays inside the shadow
        root through `container`, and a duplicate viewport on that same manager
        would render every toast twice.

        Base UI names the viewport region "Notifications" and each close button
        "Close toast", in English, whatever language the screen is in, so both
        come from this screen's own namespace instead.
      */}
      <Toaster
        container={portalContainerRef}
        label={t('toast_region_label')}
        closeLabel={t('toast_close_label')}
      />
    </div>
  );
};

UIKitElementsScreen.displayName = 'UIKitElementsScreen';
