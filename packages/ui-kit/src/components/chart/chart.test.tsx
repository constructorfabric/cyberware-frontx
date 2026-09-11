import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type ChartConfig,
  ChartContainer,
  ChartLegendContent,
  ChartStyle,
  ChartTooltipContent,
} from './chart';
import styles from './chart.module.css';

afterEach(cleanup);

/*
 * Recharts' ResponsiveContainer only renders its children once it measures
 * a positive size (see ResponsiveContainer.js's isAcceptableSize gate).
 * jsdom has no layout engine, so its default 0x0 getBoundingClientRect()
 * would make the ResizeObserver effect that fires right after mount
 * collapse the container straight back to empty — the same measurement-
 * driven-component problem slider.test.tsx documents and works around.
 * Stubbing a non-zero rect keeps ChartContainer's children mounted so the
 * tests below assert against real DOM instead of nothing.
 *
 * What this does NOT make testable: an actual Recharts chart type (Bar,
 * Line, Area, ...) rendering its SVG, or the mouse-hover interaction that
 * normally drives Tooltip/Legend's `active`/`payload` props at runtime —
 * both are Recharts' own internals, not this port's surface. The tests
 * below exercise ChartTooltipContent/ChartLegendContent the way Recharts
 * itself invokes them: as presentational components fed explicit
 * `active`/`payload` props, which is what a `content={<ChartTooltipContent
 * />}` render prop receives regardless of how the hover was triggered.
 */
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 320,
    height: 200,
    top: 0,
    left: 0,
    right: 320,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  }));
});

afterAll(() => {
  vi.restoreAllMocks();
});

const config = {
  desktop: { label: 'Desktop', color: '#2563eb' },
  mobile: { label: 'Mobile', theme: { light: '#dc2626', dark: '#f87171' } },
} satisfies ChartConfig;

describe('ChartContainer', () => {
  it('mounts its children once measured and stamps a data-chart id from `id`', () => {
    const { container } = render(
      <ChartContainer config={config} id="usage">
        <div data-testid="payload" />
      </ChartContainer>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain(styles.container);
    expect(root.getAttribute('data-chart')).toBe('chart-usage');
    // getByTestId throws if absent — its return alone proves the gated
    // ResponsiveContainer child actually mounted (see the file header).
    expect(screen.getByTestId('payload')).toBeTruthy();
  });

  it('falls back to a generated id when none is given', () => {
    const { container } = render(
      <ChartContainer config={config}>
        <div />
      </ChartContainer>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-chart')).toMatch(/^chart-/);
  });

  it('merges a consumer className', () => {
    const { container } = render(
      <ChartContainer config={config} className="consumer">
        <div />
      </ChartContainer>,
    );
    expect((container.firstElementChild as HTMLElement).className).toContain('consumer');
  });
});

describe('ChartStyle', () => {
  it('renders nothing when no series declares a color or theme', () => {
    const { container } = render(<ChartStyle id="empty" config={{ desktop: { label: 'Desktop' } }} />);
    expect(container.querySelector('style')).toBeNull();
  });

  it('scopes a flat color to the chart id, unconditionally (no theme block needed)', () => {
    const { container } = render(<ChartStyle id="flat" config={{ desktop: { color: '#2563eb' } }} />);
    const css = container.querySelector('style')?.innerHTML ?? '';
    expect(css).toContain("[data-chart='flat'] {");
    expect(css).toContain('--color-desktop: #2563eb;');
  });

  it("scopes a per-theme color to the kit's [data-theme]/prefers-color-scheme pair, not upstream's .dark class", () => {
    const { container } = render(
      <ChartStyle id="themed" config={{ mobile: { theme: { light: '#dc2626', dark: '#f87171' } } }} />,
    );
    const css = container.querySelector('style')?.innerHTML ?? '';
    expect(css).toContain("[data-chart='themed'] {\n  --color-mobile: #dc2626;");
    expect(css).toContain("[data-theme='dark'] [data-chart='themed'] {\n  --color-mobile: #f87171;");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root:not([data-theme='light']) [data-chart='themed']");
    expect(css).not.toContain('.dark ');
  });

  // The whole block is interpolated into a raw <style> tag, so an id, a
  // config key and a color are three separate ways for a consumer string
  // to become CSS of its own. One test per escape route, all at the point
  // where they'd land in the stylesheet.
  it('neutralizes an id, a key, or a color that would break out of the stylesheet', () => {
    const { container } = render(
      <ChartStyle
        id="evil'] { display: none } [x"
        config={{
          'desktop; } body { display: none': { color: 'red' },
          mobile: { color: 'red; } body { display: none }' },
          tablet: { color: '</style><script>alert(1)</script>' },
          laptop: { color: 'var(--primary)' },
        }}
      />,
    );
    const css = container.querySelector('style')?.innerHTML ?? '';
    expect(css).not.toContain('display: none');
    expect(css).not.toContain('<script>');
    // The key is kept, reduced to characters that can only ever be part of
    // a custom-property name...
    expect(css).toMatch(/--color-desktop[\w-]*: red;/);
    // ...while an unsafe VALUE has no such reduced form and is dropped
    // whole, taking its declaration with it.
    expect(css).not.toContain('--color-mobile');
    expect(css).not.toContain('--color-tablet');
    // A legitimate neighbour in the same config is unaffected.
    expect(css).toContain('--color-laptop: var(--primary);');
  });
});

describe('ChartTooltipContent', () => {
  const payload = [
    {
      dataKey: 'desktop',
      name: 'desktop',
      value: 186,
      color: '#2563eb',
      payload: { month: 'January' },
      // Recharts 3.x's own Payload type requires this (identifies which
      // graphical item — a Bar, Line, etc. — the tooltip row belongs to);
      // the value itself is never read by ChartTooltipContent, only by
      // Recharts internals this fixture never exercises.
      graphicalItemId: 'desktop',
    },
  ];

  function renderTooltip(props: Partial<ComponentProps<typeof ChartTooltipContent>> = {}) {
    return render(
      <ChartContainer config={config}>
        <ChartTooltipContent active payload={payload} {...props} />
      </ChartContainer>,
    );
  }

  it('renders nothing while inactive or with an empty payload', () => {
    const { container: inactive } = renderTooltip({ active: false });
    expect(inactive.querySelector(`.${styles.tooltipContent}`)).toBeNull();

    const { container: empty } = renderTooltip({ payload: [] });
    expect(empty.querySelector(`.${styles.tooltipContent}`)).toBeNull();
  });

  it("resolves each row's label, formatted value, and indicator color from ChartConfig and the payload", () => {
    renderTooltip();
    // The standalone label above the rows AND each row's own name both
    // resolve through config['desktop'].label — two matches, not one.
    expect(screen.getAllByText('Desktop')).toHaveLength(2);
    expect(screen.getByText('186')).toBeTruthy();
    const indicator = document.querySelector(`.${styles.indicatorDot}`) as HTMLElement;
    expect(indicator.style.backgroundColor).toBe('rgb(37, 99, 235)');
  });

  it('hides the label and the indicator swatch independently', () => {
    const { container: noLabel } = renderTooltip({ hideLabel: true });
    expect(noLabel.querySelector(`.${styles.tooltipLabel}`)).toBeNull();

    const { container: noIndicator } = renderTooltip({ hideIndicator: true });
    expect(noIndicator.querySelector(`.${styles.indicator}`)).toBeNull();
  });

  it('picks the dashed indicator class and skips the fill for a hollow border-only swatch', () => {
    renderTooltip({ indicator: 'dashed' });
    const indicator = document.querySelector(`.${styles.indicatorDashed}`) as HTMLElement;
    expect(indicator).toBeTruthy();
    expect(indicator.style.borderColor).toBe('rgb(37, 99, 235)');
    expect(indicator.style.backgroundColor).toBe('');
  });

  it('nests the label inside the row instead of above it, for a single non-dot-indicator item', () => {
    // nestLabel is `payload.length === 1 && indicator !== 'dot'` — both
    // conditions matter: a single item is a prerequisite, not enough by
    // itself (the default 'dot' indicator never nests, see the test above).
    const { container } = renderTooltip({ indicator: 'line' });
    expect(container.querySelector(`.${styles.tooltipContent} > .${styles.tooltipLabel}`)).toBeNull();
    expect(container.querySelector(`.${styles.tooltipItemLabelGroup} > .${styles.tooltipLabel}`)).toBeTruthy();
  });

  it('lets a custom formatter replace the default row rendering entirely', () => {
    renderTooltip({ formatter: (value, name) => <span data-testid="custom">{`${String(name)}=${value}`}</span> });
    expect(screen.getByTestId('custom').textContent).toBe('desktop=186');
    expect(screen.queryByText('186')).toBeNull();
  });
});

describe('ChartLegendContent', () => {
  const payload = [{ dataKey: 'desktop', value: 'desktop', color: '#2563eb' }];

  it('renders nothing for an empty payload', () => {
    const { container } = render(
      <ChartContainer config={config}>
        <ChartLegendContent payload={[]} />
      </ChartContainer>,
    );
    expect(container.querySelector(`.${styles.legendContent}`)).toBeNull();
  });

  it("resolves a row's label from ChartConfig and falls back to a color swatch with no icon configured", () => {
    render(
      <ChartContainer config={config}>
        <ChartLegendContent payload={payload} />
      </ChartContainer>,
    );
    expect(screen.getByText('Desktop')).toBeTruthy();
    const swatch = document.querySelector(`.${styles.legendSwatch}`) as HTMLElement;
    expect(swatch.style.backgroundColor).toBe('rgb(37, 99, 235)');
  });

  it('places its padding above the chart for verticalAlign="top" and below by default', () => {
    const { container: top } = render(
      <ChartContainer config={config}>
        <ChartLegendContent payload={payload} verticalAlign="top" />
      </ChartContainer>,
    );
    expect(top.querySelector(`.${styles.legendTop}`)).toBeTruthy();

    const { container: bottom } = render(
      <ChartContainer config={config}>
        <ChartLegendContent payload={payload} />
      </ChartContainer>,
    );
    expect(bottom.querySelector(`.${styles.legendBottom}`)).toBeTruthy();
  });
});
