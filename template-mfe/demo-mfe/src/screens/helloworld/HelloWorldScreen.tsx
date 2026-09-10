import React, { useRef, useCallback } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { FRONTX_ACTION_MOUNT_EXT, FRONTX_SCREEN_DOMAIN, FRONTX_SHARED_PROPERTY_THEME, FRONTX_SHARED_PROPERTY_LANGUAGE } from '@gears-frontx/react';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@gears-frontx/ui-kit';
import { useScreenTranslations } from '../../shared/useScreenTranslations';
import { useBridgeProperty } from '../../shared/useBridgeProperty';
import { useHostDirection } from '../../shared/useHostDirection';
import {
  THEME_EXTENSION_ID,
  PROFILE_EXTENSION_ID,
  DEMO_ACTION_REFRESH_PROFILE,
  WIDGETS_HOST_EXTENSION_ID,
  WIDGETS_DOMAIN_ID,
  WIDGET_ALPHA_EXTENSION_ID,
  WIDGET_PING_ACTION_TYPE,
} from '../../shared/extension-ids';
import { kitThemeScopeFor } from '../../shared/kitThemeScope';
import styles from './HelloWorldScreen.module.css';

/**
 * Props for the HelloWorldScreen component.
 */
interface HelloWorldScreenProps {
  bridge: ChildMfeBridge;
}

// Stable reference for translation modules (hoisted to module level to prevent re-render loops)
const languageModules = import.meta.glob('./i18n/*.json') as Record<
  string,
  () => Promise<{ default: Record<string, string> }>
>;

/**
 * Hello World Screen for the MFE remote.
 *
 * Demonstrates MFE capabilities including:
 * - Shadow DOM isolation
 * - Bridge communication
 * - Theme property subscription
 * - Language property subscription
 * - MFE-local i18n with dynamic translation loading
 * - Cross-screen navigation via actions chains
 *
 * Uses @gears-frontx/ui-kit components, styled from its design tokens.
 * Runs inside Shadow DOM with isolated styles.
 */
export const HelloWorldScreen: React.FC<HelloWorldScreenProps> = ({ bridge }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default');
  const language = useBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en');
  useHostDirection(containerRef, language);

  // Load translations using the shared hook
  const { t, loading } = useScreenTranslations(languageModules, bridge);

  // Navigate to Theme Screen
  const handleGoToTheme = useCallback(async () => {
    await bridge.executeActionsChain({
      action: {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: FRONTX_SCREEN_DOMAIN,
        payload: { subject: THEME_EXTENSION_ID },
      },
    });
  }, [bridge]);

  // Mount Profile then — on success — send a refresh action to the now-mounted
  // Profile extension. The chained `next` step targets the extension ID directly
  // so the mediator routes it to Profile's registered ActionHandler rather than
  // through the domain's lifecycle action pipeline.
  const handleOpenProfileAndRefresh = useCallback(async () => {
    await bridge.executeActionsChain({
      action: {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: FRONTX_SCREEN_DOMAIN,
        payload: { subject: PROFILE_EXTENSION_ID },
      },
      next: {
        action: {
          type: DEMO_ACTION_REFRESH_PROFILE,
          target: PROFILE_EXTENSION_ID,
        },
      },
    });
  }, [bridge]);

  const kitThemeScope = kitThemeScopeFor(theme);

  // Mount Widgets Host into the shell's screen domain, then — on success —
  // mount widget-a's alpha instance into the widgets domain Widgets Host owns,
  // then — on success — ping that alpha instance. A single action chain, fully
  // defined at creation time via `next` continuations, dispatched in one
  // `executeActionsChain` call. Mounting Widgets Host evicts Hello World itself
  // from the shell's screen domain (`ExclusiveMountStrategy`), but the chain
  // keeps executing on the mediator's own promise chain regardless of what
  // happens to the sender afterward — this exercises cross-nesting delivery
  // two hops away from the shell (shell -> Widgets Host -> widgets domain ->
  // widget-a).
  const handlePingWidgetA = useCallback(async () => {
    await bridge.executeActionsChain({
      action: {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: FRONTX_SCREEN_DOMAIN,
        payload: { subject: WIDGETS_HOST_EXTENSION_ID },
      },
      next: {
        action: {
          type: FRONTX_ACTION_MOUNT_EXT,
          target: WIDGETS_DOMAIN_ID,
          payload: { subject: WIDGET_ALPHA_EXTENSION_ID },
        },
        next: {
          action: {
            type: WIDGET_PING_ACTION_TYPE,
            target: WIDGET_ALPHA_EXTENSION_ID,
            payload: {},
          },
        },
      },
    });
  }, [bridge]);

  // Show skeleton while translations are loading
  if (loading) {
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

  return (
    <div ref={containerRef} className={styles.screen} data-theme={kitThemeScope}>
      <div className={styles.intro}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.description}>{t('welcome')}</p>
      </div>

      <Card>
        <CardContent>
          <p className={styles.prose}>{t('description')}</p>
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className={styles.sectionTitle}>{t('navigation_title')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={styles.prose}>{t('navigation_description')}</p>
        </CardContent>
        <CardFooter>
          <div className={styles.actions}>
            <Button onClick={handleGoToTheme}>{t('go_to_theme')}</Button>
            <Button onClick={handleOpenProfileAndRefresh} variant="outline">
              {t('open_profile_refresh')}
            </Button>
            <Button onClick={handlePingWidgetA} variant="outline">
              {t('mount_widgets_host_and_ping')}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

HelloWorldScreen.displayName = 'HelloWorldScreen';
