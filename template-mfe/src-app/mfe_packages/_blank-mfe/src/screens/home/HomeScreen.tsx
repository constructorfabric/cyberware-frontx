import React, { useEffect, useRef, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  FRONTX_SHARED_PROPERTY_THEME,
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  useApiQuery,
  apiRegistry,
} from '@gears-frontx/react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@gears-frontx/ui-kit';
import { useScreenTranslations } from '../../shared/useScreenTranslations';
import { kitThemeScopeFor } from '../../shared/kitThemeScope';
import { _BlankApiService } from '../../api/_BlankApiService';
import styles from './HomeScreen.module.css';

// Stable reference for translation modules (hoisted to module level to prevent re-render loops)
const languageModules = import.meta.glob('./i18n/*.json') as Record<
  string,
  () => Promise<{ default: Record<string, string> }>
>;

const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

function readBridgeProperty(bridge: ChildMfeBridge, property: string, fallback: string): string {
  const current = bridge.getProperty(property);
  return current && typeof current.value === 'string' ? current.value : fallback;
}

/**
 * Props for the HomeScreen component.
 */
interface HomeScreenProps {
  bridge: ChildMfeBridge;
}

/**
 * Home Screen for the Blank MFE template.
 *
 * This is a template component that demonstrates:
 * - Shadow DOM isolation
 * - Bridge communication with the host
 * - Theme property subscription
 * - Language property subscription
 * - MFE-local i18n with dynamic translation loading
 * - Components from @gears-frontx/ui-kit, styled from its design tokens
 *
 * To use this template:
 * 1. Copy the entire _blank-mfe directory to a new name
 * 2. Update all placeholder IDs in mfe.json
 * 3. Update package.json name and port
 * 4. Update vite.config.ts name
 * 5. Customize this component for your use case
 * 6. Add/modify translation files as needed
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({ bridge }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  /*
   * The bridge's current values are read here, in lazy useState initializers,
   * rather than at the top of the effect below. A setState called synchronously
   * in an effect body re-renders the screen before paint, which is why
   * `react-hooks/set-state-in-effect` rejects it; the effect only has to
   * SUBSCRIBE.
   */
  const [theme, setTheme] = useState<string>(() =>
    readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default')
  );
  const [language, setLanguage] = useState<string>(() =>
    readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en')
  );
  // The lazy initializers above run only on mount; if the host swaps the bridge
  // instance, re-read its current properties during render ("adjusting state
  // during render") — the subscription effect only delivers future changes.
  const [prevBridge, setPrevBridge] = useState(bridge);
  if (prevBridge !== bridge) {
    setPrevBridge(bridge);
    setTheme(readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default'));
    setLanguage(readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en'));
  }

  const service = apiRegistry.getService(_BlankApiService);
  const { t, loading } = useScreenTranslations(languageModules, bridge);
  const {
    data: statusData,
    isLoading: isStatusLoading,
    isError: isStatusError,
    error: statusError,
  } = useApiQuery(service.getStatus);

  useEffect(() => {
    // Subscribe to theme domain property
    const themeUnsubscribe = bridge.subscribeToProperty(
      FRONTX_SHARED_PROPERTY_THEME,
      (property) => {
        if (typeof property.value === 'string') {
          setTheme(property.value);
        }
      }
    );

    // Subscribe to language domain property
    const languageUnsubscribe = bridge.subscribeToProperty(
      FRONTX_SHARED_PROPERTY_LANGUAGE,
      (property) => {
        if (typeof property.value === 'string') {
          setLanguage(property.value);
        }
      }
    );

    return () => {
      themeUnsubscribe();
      languageUnsubscribe();
    };
  }, [bridge]);

  // Keep the Shadow DOM host's text direction in sync with the active language.
  // An effect keyed by `language` (rather than logic inside the subscription
  // callback) also covers the initial language, which never fires a callback.
  useEffect(() => {
    const rootNode = containerRef.current?.getRootNode();
    if (rootNode && 'host' in rootNode) {
      (rootNode.host as HTMLElement).dir = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
    }
  }, [language]);

  const kitThemeScope = kitThemeScopeFor(theme);

  /*
   * The `data-testid` attributes below are verification API, not decoration.
   * A screen renders inside a shadow root, so selectors issued from outside it
   * cannot reach these nodes; browser verification runs an eval inside the root
   * and addresses controls by testid. Accessibility-snapshot refs are ephemeral
   * and have to be re-learned after every navigation, which these ids replace.
   * `screen-root` is present in every branch, so a run has one node to wait for
   * before deciding which state the screen settled into. Every screen copied
   * from this scaffold inherits the contract: keep a `screen-<control>` testid
   * on each interactive control and on the status region, and rename the id
   * with the control rather than dropping it.
   */

  // Show skeleton while translations are loading
  if (loading) {
    return (
      // A Skeleton carries no loading semantics of its own; the region announces them.
      <div
        ref={containerRef}
        className={styles.screen}
        data-theme={kitThemeScope}
        data-testid="screen-root"
        role="status"
        aria-busy="true"
      >
        <div className={styles.placeholders} data-testid="screen-loading">
          <Skeleton className={styles.placeholderTitle} />
          <Skeleton className={styles.placeholderLine} />
        </div>
        <Card>
          <CardContent>
            <div className={styles.placeholders}>
              <Skeleton className={styles.placeholderLine} />
              <Skeleton className={styles.placeholderLine} />
              <Skeleton className={styles.placeholderLineShort} />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  let statusCardBody: React.ReactNode;
  if (isStatusLoading) {
    statusCardBody = (
      <div
        role="status"
        aria-busy="true"
        className={styles.placeholders}
        data-testid="screen-status-loading"
      >
        <Skeleton className={styles.placeholderLine} />
        <Skeleton className={styles.placeholderLineShort} />
        <Skeleton className={styles.placeholderBlock} />
      </div>
    );
  } else if (isStatusError) {
    statusCardBody = (
      <p className={styles.error} data-testid="screen-status-error">
        {statusError?.message}
      </p>
    );
  } else {
    statusCardBody = (
      <pre className={styles.payload} data-testid="screen-status-payload">
        {JSON.stringify(statusData, null, 2)}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className={styles.screen}
      data-theme={kitThemeScope}
      data-testid="screen-root"
    >
      <div className={styles.intro}>
        <h1 className={styles.title} data-testid="screen-title">
          {t('title')}
        </h1>
        <p className={styles.description}>{t('description')}</p>
      </div>

      {/*
        Card spaces its slots with `gap: var(--card-spacing)` declared on the
        card root, so that rhythm only ever falls between Card's DIRECT
        children — the slots below stay directly under <Card>. A wrapper around
        them (`<Card><form>…slots…</form></Card>`, the shape a form screen
        invites) leaves the card a single child and the gap applies to nothing,
        while the slots' horizontal padding still lands because the kit sets it
        through descendant rules (`.card .cardContent`) — half-correct spacing
        reads as a small visual glitch rather than as the composition mistake
        it is. A form goes inside a slot; README "Styling" carries the shape.
      */}
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
              <dd className={styles.value} data-testid="screen-domain-id">
                {bridge.extDomainId}
              </dd>
            </div>
            <div>
              <dt className={styles.term}>{t('instance_id')}</dt>
              <dd className={styles.value} data-testid="screen-instance-id">
                {bridge.extensionId}
              </dd>
            </div>
            <div>
              <dt className={styles.term}>{t('current_theme')}</dt>
              <dd className={styles.value} data-testid="screen-theme">
                {theme}
              </dd>
            </div>
            <div>
              <dt className={styles.term}>{t('current_language')}</dt>
              <dd className={styles.value} data-testid="screen-language">
                {language}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent data-testid="screen-status">{statusCardBody}</CardContent>
      </Card>
    </div>
  );
};

HomeScreen.displayName = 'HomeScreen';
