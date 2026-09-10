/**
 * Theme Registry - Manages theme registration and application
 *
 * Framework Layer: L2
 */
// @cpt-flow:cpt-frontx-flow-framework-composition-theme-propagation:p1
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1
// @cpt-dod:cpt-frontx-dod-ui-libraries-choice-theme-propagation:p1

import type { ThemeRegistry, ThemeConfig } from '../types';

/**
 * Create a new theme registry instance.
 */
export function createThemeRegistry(): ThemeRegistry {
  const themes = new Map<string, ThemeConfig>();
  let currentThemeId: string | null = null;

  // Subscription support for React
  const subscribers = new Set<() => void>();
  let version = 0;

  function notifySubscribers(): void {
    version++;
    subscribers.forEach((callback) => {
      callback();
    });
  }

  /**
   * Write theme CSS custom properties into a managed <style> element in <head>.
   * Using a stylesheet rule instead of inline styles allows Shadow DOM :host rules
   * and user CSS to override theme variables, which inline style.setProperty() blocks.
   */
  function applyCSSVariables(variables: Record<string, string>): void {
    if (typeof document === 'undefined') return;

    const existing = document.getElementById('frontx-theme-vars');
    let styleEl: HTMLStyleElement;
    if (existing instanceof HTMLStyleElement) {
      styleEl = existing;
    } else {
      existing?.remove();
      styleEl = document.createElement('style');
      styleEl.id = 'frontx-theme-vars';
      document.head.appendChild(styleEl);
    }

    const sheet = styleEl.sheet;
    if (!sheet) return;
    while (sheet.cssRules.length > 0) sheet.deleteRule(0);

    const parts: string[] = [];
    for (const [key, value] of Object.entries(variables)) {
      parts.push(`${key}: ${value}`);
    }
    if (parts.length === 0) return;
    // :root:root (specificity 0,2,0) so applied theme tokens deterministically beat
    // design-system [data-theme='...'] token blocks (0,1,0) — with plain :root the
    // outcome is a specificity tie decided by style-tag order, which Vite HMR
    // re-injection can flip at any time.
    sheet.insertRule(`:root:root { ${parts.join('; ')} }`, 0);
  }

  return {
    register(config: ThemeConfig): void {
      if (themes.has(config.id)) {
        console.warn(`Theme "${config.id}" is already registered. Skipping.`);
        return;
      }

      themes.set(config.id, config);

      // If this is the default theme and no theme is applied yet, apply it
      if (config.default && currentThemeId === null) {
        this.apply(config.id);
      }
    },

    get(id: string): ThemeConfig | undefined {
      return themes.get(id);
    },

    getAll(): ThemeConfig[] {
      return Array.from(themes.values());
    },

    apply(id: string): void {
      const config = themes.get(id);

      if (!config) {
        console.warn(`Theme "${id}" not found. Cannot apply.`);
        return;
      }

      applyCSSVariables(config.variables);
      if (typeof document !== 'undefined') {
        // Default to 'light' rather than removing the attribute: with no
        // data-theme, a dark-OS machine lets the kit's
        // `:root:not([data-theme='light'])` block own every kit-only token
        // while the shell's own tokens stay light — a mixed palette.
        document.documentElement.setAttribute('data-theme', config.appearance ?? 'light');
      }
      currentThemeId = id;
      notifySubscribers();
    },

    getCurrent(): ThemeConfig | undefined {
      return currentThemeId ? themes.get(currentThemeId) : undefined;
    },

    subscribe(callback: () => void): () => void {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },

    getVersion(): number {
      return version;
    },
  };
}
