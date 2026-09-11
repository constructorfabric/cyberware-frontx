import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

/*
 * The kit's chart component draws no chart type of its own — it supplies the
 * container, the config-to-CSS-variable bridge, the tooltip and the legend,
 * and the consumer composes Recharts primitives inside. These sections cover
 * the shapes a dashboard actually reaches for, so the wrapper is exercised
 * against more than one bar chart.
 *
 * Every color is a `--color-<dataKey>` variable, which ChartContainer emits
 * from the ChartConfig below. The palette entries themselves are kit theme
 * tokens: the kit defines no --chart-1..5 ramp, and a literal hex would only
 * hold for one theme.
 */
const PALETTE = {
  violet: 'var(--primary)',
  blue: 'var(--info)',
  green: 'var(--success)',
  amber: 'var(--warning)',
  rose: 'var(--destructive)',
} as const;

const chartConfig = {
  desktop: { label: 'Desktop', color: 'var(--primary)' },
  mobile: { label: 'Mobile', color: 'var(--info)' },
} satisfies ChartConfig;

const themedChartConfig = {
  desktop: { label: 'Desktop', theme: { light: '#2563eb', dark: '#60a5fa' } },
  mobile: { label: 'Mobile', color: '#e11d48' },
} satisfies ChartConfig;

const data = [
  { month: 'Jan', desktop: 186, mobile: 80 },
  { month: 'Feb', desktop: 305, mobile: 200 },
  { month: 'Mar', desktop: 237, mobile: 120 },
  { month: 'Apr', desktop: 173, mobile: 190 },
  { month: 'May', desktop: 209, mobile: 130 },
];

/* ------------------------------------------------------------------ */
/* Donut                                                               */
/* ------------------------------------------------------------------ */

const stageConfig = {
  prospect: { label: 'Prospect', color: PALETTE.blue },
  engaged: { label: 'Engaged', color: PALETTE.green },
  customer: { label: 'Customer', color: PALETTE.amber },
  'at-risk': { label: 'At risk', color: PALETTE.violet },
  churned: { label: 'Churned', color: PALETTE.rose },
} satisfies ChartConfig;

const stageSegments = [
  { id: 'prospect', label: 'Prospect', count: 128 },
  { id: 'engaged', label: 'Engaged', count: 94 },
  { id: 'customer', label: 'Customer', count: 61 },
  { id: 'at-risk', label: 'At risk', count: 27 },
  { id: 'churned', label: 'Churned', count: 14 },
];

const stageTotal = stageSegments.reduce((sum, segment) => sum + segment.count, 0);

/**
 * A `Pie` with an `innerRadius` is the donut. One `Cell` per segment is what
 * gives each slice its own fill — a `Pie` takes a single `fill`, so per-slice
 * color has to come from the children.
 *
 * The legend is plain markup rather than `ChartLegendContent`, which renders a
 * swatch and a label only. A donut usually wants the count and share next to
 * each label, so it reads without hovering.
 */
function DonutChartExample() {
  return (
    <Row style={{ alignItems: 'center', gap: 'var(--space-6)' }}>
      <ChartContainer
        config={stageConfig}
        style={{ width: 180, height: 180 }}
        initialDimension={{ width: 180, height: 180 }}
      >
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="id" />} />
          <Pie
            data={stageSegments}
            dataKey="count"
            nameKey="id"
            innerRadius="65%"
            outerRadius="100%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {stageSegments.map((segment) => (
              <Cell key={segment.id} fill={`var(--color-${segment.id})`} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-2)' }}>
        {stageSegments.map((segment) => (
          <li key={segment.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 'var(--radius-sm)',
                background: `var(--color-${segment.id})`,
              }}
            />
            <span style={{ minWidth: '6rem' }}>{segment.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{segment.count}</span>
            <span style={{ color: 'var(--muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round((segment.count / stageTotal) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </Row>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked bars                                                        */
/* ------------------------------------------------------------------ */

const resolvedConfig = {
  chat: { label: 'Chat', color: PALETTE.blue },
  mail: { label: 'Mail', color: PALETTE.green },
  tasks: { label: 'Tasks', color: PALETTE.amber },
} satisfies ChartConfig;

const resolvedPerDay = [
  { day: 'Mon', chat: 12, mail: 8, tasks: 5 },
  { day: 'Tue', chat: 18, mail: 6, tasks: 9 },
  { day: 'Wed', chat: 9, mail: 11, tasks: 4 },
  { day: 'Thu', chat: 21, mail: 7, tasks: 12 },
  { day: 'Fri', chat: 15, mail: 13, tasks: 6 },
  { day: 'Sat', chat: 6, mail: 3, tasks: 2 },
  { day: 'Sun', chat: 4, mail: 2, tasks: 3 },
];

/* ------------------------------------------------------------------ */
/* Multi-line                                                          */
/* ------------------------------------------------------------------ */

const recordsConfig = {
  companies: { label: 'Companies', color: PALETTE.blue },
  opportunities: { label: 'Opportunities', color: PALETTE.amber },
  people: { label: 'People', color: PALETTE.green },
} satisfies ChartConfig;

const recordsCreated = [
  { month: 'Jan', companies: 6, opportunities: 11, people: 14 },
  { month: 'Feb', companies: 9, opportunities: 8, people: 17 },
  { month: 'Mar', companies: 7, opportunities: 15, people: 12 },
  { month: 'Apr', companies: 12, opportunities: 13, people: 19 },
  { month: 'May', companies: 10, opportunities: 18, people: 15 },
  { month: 'Jun', companies: 14, opportunities: 16, people: 20 },
];

/* ------------------------------------------------------------------ */
/* Combo bar + line                                                    */
/* ------------------------------------------------------------------ */

const newContactsConfig = {
  inbound: { label: 'Inbound', color: PALETTE.blue },
  total: { label: 'Total', color: PALETTE.violet },
} satisfies ChartConfig;

const newContacts = [
  { day: 'Mon', inbound: 14, total: 22 },
  { day: 'Tue', inbound: 19, total: 31 },
  { day: 'Wed', inbound: 11, total: 18 },
  { day: 'Thu', inbound: 23, total: 36 },
  { day: 'Fri', inbound: 17, total: 28 },
  { day: 'Sat', inbound: 6, total: 9 },
  { day: 'Sun', inbound: 4, total: 7 },
];

/* ------------------------------------------------------------------ */
/* Sparklines                                                          */
/* ------------------------------------------------------------------ */

const trendConfig = {
  value: { label: 'Activity', color: PALETTE.amber },
} satisfies ChartConfig;

const trend = [4, 7, 5, 9, 6, 11, 8, 13, 10, 15, 12, 18].map((value, index) => ({ index, value }));

const SPARKLINE_DIMENSION = { width: 220, height: 96 };
const SPARKLINE_MARGIN = { top: 6, right: 4, bottom: 0, left: 4 };

/**
 * A sparkline is this component with every axis, grid line, legend and dot
 * left out — there is no separate sparkline mode to switch on. The gradient
 * fill needs a `<defs>` of its own; its id comes from `useId` because an SVG
 * gradient id is a document-global reference, so two area charts sharing a
 * literal id would silently share one gradient.
 */
function AreaSparkline() {
  const gradientId = `chart-demo-area-${useId().replace(/:/g, '')}`;

  return (
    <ChartContainer
      config={trendConfig}
      style={{ width: 220 }}
      initialDimension={SPARKLINE_DIMENSION}
    >
      <AreaChart data={trend} margin={SPARKLINE_MARGIN}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.45} />
            <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Single highlighted bar                                              */
/* ------------------------------------------------------------------ */

const trafficConfig = {
  visits: { label: 'Visits', color: PALETTE.violet },
} satisfies ChartConfig;

const traffic = [
  { day: 'Mon', visits: 320 },
  { day: 'Tue', visits: 410 },
  { day: 'Wed', visits: 280 },
  { day: 'Thu', visits: 520 },
  { day: 'Fri', visits: 460 },
  { day: 'Sat', visits: 190 },
  { day: 'Sun', visits: 150 },
];

const busiestDay = traffic.reduce((peak, point) => (point.visits > peak.visits ? point : peak));

export default function ChartExample() {
  return (
    <>
      <Section title="Bar chart">
        <ChartContainer config={chartConfig} style={{ maxWidth: 480 }}>
          <BarChart data={data}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
            <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      </Section>
      <Section title="Donut">
        <DonutChartExample />
      </Section>

      <Section title="Stacked bars">
        <ChartContainer config={resolvedConfig} style={{ maxWidth: 480 }}>
          <BarChart data={resolvedPerDay} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              stroke="var(--muted-foreground)"
              fontSize={12}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              stroke="var(--muted-foreground)"
              fontSize={12}
              width={24}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {/* One stackId across all three series is what stacks them; the
                radius goes on the topmost series only, so the stack rounds
                once instead of at every seam. */}
            <Bar dataKey="chat" stackId="resolved" fill="var(--color-chat)" />
            <Bar dataKey="mail" stackId="resolved" fill="var(--color-mail)" />
            <Bar dataKey="tasks" stackId="resolved" fill="var(--color-tasks)" radius={[4, 4, 0, 0]} />
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      </Section>

      <Section title="Multi-line">
        <ChartContainer config={recordsConfig} style={{ maxWidth: 480 }}>
          <LineChart data={recordsCreated} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              stroke="var(--muted-foreground)"
              fontSize={11}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              stroke="var(--muted-foreground)"
              fontSize={11}
              width={24}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="companies"
              stroke="var(--color-companies)"
              strokeWidth={2.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="opportunities"
              stroke="var(--color-opportunities)"
              strokeWidth={2.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="people"
              stroke="var(--color-people)"
              strokeWidth={2.5}
              dot={false}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </LineChart>
        </ChartContainer>
      </Section>

      <Section title="Combo bar and line">
        {/* ComposedChart is what mixes marks on one set of axes. The bar is
            dimmed and the line is not, so the line reads as the subject and
            the bars as its context rather than two competing series. */}
        <ChartContainer config={newContactsConfig} style={{ maxWidth: 480 }}>
          <ComposedChart data={newContacts} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              stroke="var(--muted-foreground)"
              fontSize={11}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="inbound"
              fill="var(--color-inbound)"
              fillOpacity={0.35}
              radius={[4, 4, 0, 0]}
              barSize={16}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="var(--color-total)"
              strokeWidth={2.5}
              dot={false}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </ComposedChart>
        </ChartContainer>
      </Section>

      <Section title="Sparklines">
        <Row style={{ alignItems: 'flex-start' }}>
          <AreaSparkline />
          <ChartContainer
            config={trendConfig}
            style={{ width: 220 }}
            initialDimension={SPARKLINE_DIMENSION}
          >
            <BarChart data={trend} margin={SPARKLINE_MARGIN} barCategoryGap="28%">
              <Bar dataKey="value" fill="var(--color-value)" radius={[6, 6, 2, 2]} />
            </BarChart>
          </ChartContainer>
          <ChartContainer
            config={trendConfig}
            style={{ width: 220 }}
            initialDimension={SPARKLINE_DIMENSION}
          >
            <LineChart data={trend} margin={SPARKLINE_MARGIN}>
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </Row>
      </Section>

      <Section title="Highlighted bar">
        {/* Same `Cell`-per-datum mechanism the donut uses, here to single out
            one bar: every other bar drops to a low opacity instead of taking
            a second color, so the highlight needs no extra palette entry. */}
        <ChartContainer config={trafficConfig} style={{ maxWidth: 480 }}>
          <BarChart data={traffic} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              stroke="var(--muted-foreground)"
              fontSize={12}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="visits" radius={4}>
              {traffic.map((point) => (
                <Cell
                  key={point.day}
                  fill="var(--color-visits)"
                  fillOpacity={point.day === busiestDay.day ? 1 : 0.28}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </Section>

      <Section title="Tooltip indicators">
        <Row>
          {(['dot', 'line', 'dashed'] as const).map((indicator) => (
            <ChartContainer key={indicator} config={chartConfig} style={{ width: 260 }}>
              <BarChart data={data}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent indicator={indicator} />} />
                <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
                <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
              </BarChart>
            </ChartContainer>
          ))}
        </Row>
      </Section>
      <Section title="Legend position">
        <ChartContainer config={chartConfig} style={{ maxWidth: 480 }}>
          <BarChart data={data}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartLegend content={<ChartLegendContent verticalAlign="top" />} verticalAlign="top" />
            <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
            <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
          </BarChart>
        </ChartContainer>
      </Section>
      <Section title="Colors">
        <ChartContainer config={themedChartConfig} style={{ maxWidth: 480 }}>
          <BarChart data={data}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
            <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      </Section>
    </>
  );
}
