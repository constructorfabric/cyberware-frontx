import { Section } from '../shared';
import { useTokenValues } from './token-utils';

/*
 * One entry per --text-* role theme.css actually defines. The Figma
 * foundations mockup's "Typography" board lists 10 canonical styles plus a
 * "Canonical extensions" sub-panel; theme.css defines only these 7 roles —
 * see the report for that gap, tracked rather than guessed at here.
 */
const TYPE_ROLES = [
  { role: 'display', sample: 'Build with evidence' },
  { role: 'heading-1', sample: 'Delivery is at risk' },
  { role: 'heading-2', sample: 'Connected sources' },
  { role: 'body', sample: 'Computed signals explain what changed.' },
  { role: 'label', sample: 'Review connection' },
  { role: 'meta', sample: 'Last healthy sync · 18m ago' },
  { role: 'mono', sample: 'SIG-1042 · WORKSPACE 01' },
] as const;

const TYPE_TOKENS = TYPE_ROLES.flatMap(({ role }) =>
  ['size', 'line-height', 'weight', 'tracking'].map((part) => `text-${role}-${part}`),
);

function TypeCard({ role, sample, values }: { role: string; sample: string; values: Record<string, string> }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-width) solid var(--border-strong)',
        background: 'var(--surface)',
      }}
    >
      <code style={{ fontSize: 'var(--text-meta-size)', color: 'var(--muted-foreground)' }}>--text-{role}-*</code>
      <span
        style={{
          fontFamily: role === 'mono' ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: `var(--text-${role}-size)`,
          lineHeight: `var(--text-${role}-line-height)`,
          fontWeight: `var(--text-${role}-weight)` as never,
          letterSpacing: `var(--text-${role}-tracking)`,
        }}
      >
        {sample}
      </span>
      <code style={{ fontSize: 'var(--text-meta-size)', color: 'var(--muted-foreground)' }}>
        {values[`text-${role}-size`]} / {values[`text-${role}-line-height`]} · weight{' '}
        {values[`text-${role}-weight`]} · tracking {values[`text-${role}-tracking`]}
      </code>
    </div>
  );
}

export function TypographyPage() {
  const values = useTokenValues(TYPE_TOKENS);
  return (
    <Section title="Typography">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {TYPE_ROLES.map(({ role, sample }) => (
          <TypeCard key={role} role={role} sample={sample} values={values} />
        ))}
      </div>
    </Section>
  );
}
