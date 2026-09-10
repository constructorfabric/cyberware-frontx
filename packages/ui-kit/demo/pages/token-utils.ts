import { useEffect, useState } from 'react';

/**
 * Resolved values straight from the cascade. Re-read on `data-theme`
 * changes (watched directly — a `theme` prop would race the parent effect
 * that applies the attribute, since child effects fire first) and on OS
 * scheme flips (the `auto` case).
 *
 * Generalized out of the old single Tokens page: each split-out page now
 * owns its own token list rather than sharing one flat ALL_TOKENS array,
 * so a page only ever re-reads the custom properties it actually renders.
 */
export function useTokenValues(tokens: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const styles = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const token of tokens) {
        next[token] = styles.getPropertyValue(`--${token}`).trim();
      }
      setValues(next);
    };
    read();
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      scheme.removeEventListener('change', read);
      observer.disconnect();
    };
    // Every call site passes a module-level constant array, so this only
    // ever re-runs once per mount in practice — but listing `tokens` (rather
    // than disabling exhaustive-deps) keeps the hook correct even if a
    // future caller passes a computed list.
  }, [tokens]);
  return values;
}
