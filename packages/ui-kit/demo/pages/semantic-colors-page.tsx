import { Section } from '../shared';
import { useTokenValues } from './token-utils';

/*
 * Ordered to match the Figma foundations mockup's "Semantic colors" board
 * inventory (31 roles, background → info-soft), then every remaining
 * theme.css color custom property appended in theme.css's own declaration
 * order — card/popover/destructive/link/sidebar/blue are real tokens the
 * mockup's 31-role list doesn't name but the kit ships and a consumer can
 * reach for. Excluded on purpose: --overlay (a translucent scrim, not a
 * fill a chip can show meaningfully), and --popover-border/--popover-shadow
 * (composite values, not standalone colors — --popover-shadow gets its own
 * specimen on the Layout & Elevation page instead).
 */
const SEMANTIC_COLOR_TOKENS = [
  // Mockup inventory order.
  'background',
  'surface',
  'surface-elevated',
  'muted',
  'border',
  'border-strong',
  'foreground',
  'muted-foreground',
  'subtle-foreground',
  'code-background',
  'code-foreground',
  'primary',
  'primary-hover',
  'primary-foreground',
  'ring',
  'accent',
  'accent-foreground',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-soft',
  'info',
  'info-soft',
  // Remaining theme.css color tokens, theme.css declaration order.
  'card',
  'card-hover',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary-ring',
  'secondary',
  'secondary-foreground',
  'destructive',
  'destructive-foreground',
  'destructive-ring',
  'link-foreground',
  'blue',
  'input',
  'sidebar',
  'sidebar-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
] as const;

function ColorRow({ token, value }: { token: string; value?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <div
        aria-hidden="true"
        style={{
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: 'var(--radius-md)',
          background: `var(--${token})`,
          border: 'var(--border-width) solid var(--border-strong)',
        }}
      />
      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <code style={{ fontSize: 'var(--text-label-size)' }}>--{token}</code>
        <code
          style={{
            fontSize: 'var(--text-meta-size)',
            color: 'var(--muted-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          var(--{token}) · {value}
        </code>
      </div>
    </div>
  );
}

export function SemanticColorsPage() {
  const values = useTokenValues(SEMANTIC_COLOR_TOKENS);
  return (
    <Section title="Semantic Colors">
      {/* No separate Light/Dark pages: the demo's global theme toggle
          (header, top of the shell) already repaints every chip below from
          the same tokens — flip it instead of duplicating this page. */}
      <p style={{ margin: 0, fontSize: 'var(--text-meta-size)', color: 'var(--muted-foreground)' }}>
        One list for both themes — use the auto/light/dark toggle above to see every chip repaint
        from these same tokens.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {SEMANTIC_COLOR_TOKENS.map((token) => (
          <ColorRow key={token} token={token} value={values[token]} />
        ))}
      </div>
    </Section>
  );
}
