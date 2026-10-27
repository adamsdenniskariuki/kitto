import { useId, type ReactNode } from 'react';
import { cn } from '@kitto/ui';
import {
  barRects,
  donutArcs,
  labelIndexes,
  linePath,
  niceCeiling,
  percent,
  slotCentres,
  ticks,
  yScale,
} from './math';

/*
 * Charts drawn as plain SVG on the server: no chart library and no client
 * JavaScript. Every chart is a <figure> holding
 *
 *   - an <svg role="img"> named by its <title> and described by its <desc>
 *     (a one-sentence summary such as "Collected KES 9,000 over 7 days"),
 *   - a visible caption and legend (aria-hidden: the table repeats them),
 *   - a visually hidden <table> with every number, for screen readers.
 *
 * Plot areas stretch to their container (preserveAspectRatio="none") so text
 * is kept in HTML around the SVG, and strokes use non-scaling-stroke. Colours
 * are the theme's CSS variables, so charts follow the tenant theme and dark
 * mode with no extra work.
 */

/** Theme colours for series, in order. */
export const CHART_COLORS = [
  'var(--brand)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--ink)',
  'var(--muted)',
] as const;

const colorAt = (i: number, color?: string) => color ?? CHART_COLORS[i % CHART_COLORS.length]!;

const W = 600;
const H = 200;

export interface ChartSeries {
  name: string;
  values: readonly number[];
  color?: string;
}

interface ChartText {
  /** Short name: the SVG <title>, the caption and the hidden table's caption. */
  title: string;
  /** One-sentence summary for the SVG <desc>. */
  description: string;
  /** How values are written (money, counts...). */
  format?: (value: number) => string;
  className?: string;
}

export interface XYChartProps extends ChartText {
  /** One label per category (day, week, bucket). */
  labels: readonly string[];
  /** Header of the label column in the hidden table, e.g. "Day". */
  labelHeader?: string;
  series: readonly ChartSeries[];
}

function Legend({ items }: { items: readonly { name: string; color: string }[] }) {
  return (
    <span aria-hidden="true" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((s) => (
        <span key={s.name} className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </span>
  );
}

/** The numbers behind a chart, for screen readers (and anyone copying them). */
export function ChartTable({
  caption,
  labelHeader,
  columns,
  rows,
}: {
  caption: string;
  labelHeader: string;
  columns: readonly string[];
  rows: readonly { label: string; values: readonly ReactNode[] }[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{labelHeader}</th>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.label}-${i}`}>
            <th scope="row">{r.label}</th>
            {r.values.map((v, j) => (
              <td key={j}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function XYFrame({
  title,
  description,
  format,
  labels,
  labelHeader,
  series,
  className,
  max,
  children,
}: Required<Pick<XYChartProps, 'format' | 'labelHeader'>> &
  Omit<XYChartProps, 'format' | 'labelHeader'> & { max: number; children: ReactNode }) {
  const id = useId();
  const axis = ticks(max, 2).reverse();
  const shown = labelIndexes(labels.length, 5);
  return (
    <figure className={cn('min-w-0 space-y-2', className)}>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="flex w-16 shrink-0 flex-col justify-between text-right text-xs text-muted tabular-nums sm:w-24"
        >
          {axis.map((t) => (
            <span key={t} className="truncate">
              {format(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-desc`}
            className="block h-44 w-full sm:h-56"
          >
            <title id={`${id}-title`}>{title}</title>
            <desc id={`${id}-desc`}>{description}</desc>
            {axis.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={yScale(max, H)(t)}
                y2={yScale(max, H)(t)}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: 'var(--line)' }}
              />
            ))}
            {children}
          </svg>
          <div
            aria-hidden="true"
            className="mt-1 flex justify-between gap-2 text-xs text-muted tabular-nums"
          >
            {shown.map((i) => (
              <span key={i}>{labels[i]}</span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-medium text-ink">{title}</span>
        <Legend items={series.map((s, i) => ({ name: s.name, color: colorAt(i, s.color) }))} />
      </figcaption>
      <ChartTable
        caption={title}
        labelHeader={labelHeader}
        columns={series.map((s) => s.name)}
        rows={labels.map((label, i) => ({
          label,
          values: series.map((s) => format(s.values[i] ?? 0)),
        }))}
      />
    </figure>
  );
}

const defaultFormat = (n: number) => String(n);
const maxOf = (series: readonly ChartSeries[]) =>
  niceCeiling(Math.max(0, ...series.flatMap((s) => s.values)));

/** Vertical bars, grouped when there is more than one series. */
export function BarChart({
  format = defaultFormat,
  labelHeader = 'Period',
  ...props
}: XYChartProps) {
  const max = maxOf(props.series);
  const rects = barRects(
    props.series.map((s) => s.values),
    W,
    H,
    max,
  );
  return (
    <XYFrame {...props} format={format} labelHeader={labelHeader} max={max}>
      {rects.map((bars, s) =>
        bars.map((r, c) => (
          <rect
            key={`${s}-${c}`}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            style={{ fill: colorAt(s, props.series[s]!.color) }}
          >
            <title>{`${props.labels[c]}, ${props.series[s]!.name}: ${format(props.series[s]!.values[c] ?? 0)}`}</title>
          </rect>
        )),
      )}
    </XYFrame>
  );
}

/** Lines through each category, one per series. */
export function LineChart({
  format = defaultFormat,
  labelHeader = 'Period',
  ...props
}: XYChartProps) {
  const max = maxOf(props.series);
  const xs = slotCentres(props.labels.length, W);
  const y = yScale(max, H);
  return (
    <XYFrame {...props} format={format} labelHeader={labelHeader} max={max}>
      {props.series.map((s, i) => (
        <g key={s.name} style={{ stroke: colorAt(i, s.color), fill: colorAt(i, s.color) }}>
          <path
            d={linePath(s.values, W, H, max)}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Invisible hit areas so each point has a tooltip. */}
          {s.values.map((v, c) => (
            <rect
              key={c}
              x={xs[c]! - W / Math.max(1, props.labels.length) / 2}
              y={0}
              width={W / Math.max(1, props.labels.length)}
              height={H}
              style={{ fill: 'transparent', stroke: 'none' }}
            >
              <title>{`${props.labels[c]}, ${s.name}: ${format(v)}`}</title>
            </rect>
          ))}
          {props.labels.length <= 31 &&
            s.values.map((v, c) => (
              <circle
                key={`p${c}`}
                cx={xs[c]}
                cy={y(v)}
                r={3}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: 'none' }}
              />
            ))}
        </g>
      ))}
    </XYFrame>
  );
}

export interface Slice {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps extends ChartText {
  slices: readonly Slice[];
  /** Header of the label column in the hidden table. */
  labelHeader?: string;
  /** Big text in the hole, e.g. the total. */
  centre?: string;
}

/** Shares of a whole (payment methods). Zero slices are listed but not drawn. */
export function DonutChart({
  title,
  description,
  slices,
  format = defaultFormat,
  labelHeader = 'Category',
  centre,
  className,
}: DonutChartProps) {
  const id = useId();
  const total = slices.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const arcs = donutArcs(
    slices.map((s) => s.value),
    48,
    30,
  );
  return (
    <figure className={cn('flex min-w-0 flex-wrap items-center gap-6', className)}>
      <svg
        viewBox="-50 -50 100 100"
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="size-40 shrink-0"
      >
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-desc`}>{description}</desc>
        <circle r={39} fill="none" strokeWidth={18} style={{ stroke: 'var(--surface-2)' }} />
        {arcs.map((a) => (
          <path key={a.index} d={a.path} style={{ fill: colorAt(a.index, slices[a.index]!.color) }}>
            <title>{`${slices[a.index]!.label}: ${format(a.value)} (${percent(a.value, total)}%)`}</title>
          </path>
        ))}
        {centre && (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={centre.length > 9 ? 9 : 12}
            fontWeight={700}
            style={{ fill: 'var(--ink)' }}
          >
            {centre}
          </text>
        )}
      </svg>
      <figcaption className="min-w-0 flex-1 space-y-2 text-sm">
        <span className="block font-medium">{title}</span>
        <ul aria-hidden="true" className="space-y-1">
          {slices.map((s, i) => (
            <li key={s.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ background: colorAt(i, s.color) }}
                />
                {s.label}
              </span>
              <span className="text-muted tabular-nums">
                {format(s.value)} · {percent(s.value, total)}%
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
      <ChartTable
        caption={title}
        labelHeader={labelHeader}
        columns={['Amount', 'Share']}
        rows={slices.map((s) => ({
          label: s.label,
          values: [format(s.value), `${percent(s.value, total)}%`],
        }))}
      />
    </figure>
  );
}

/** One horizontal bar split into parts of a whole (reservations by status). */
export function StackedBar({
  title,
  description,
  slices,
  format = defaultFormat,
  labelHeader = 'Category',
  className,
}: DonutChartProps) {
  const id = useId();
  const total = slices.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  let x = 0;
  return (
    <figure className={cn('min-w-0 space-y-3', className)}>
      <svg
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="block h-6 w-full overflow-hidden rounded-md"
      >
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-desc`}>{description}</desc>
        <rect width={100} height={10} style={{ fill: 'var(--surface-2)' }} />
        {slices.map((s, i) => {
          if (total <= 0 || s.value <= 0) return null;
          const width = (s.value / total) * 100;
          const rect = (
            <rect
              key={s.label}
              x={x}
              width={width}
              height={10}
              style={{ fill: colorAt(i, s.color) }}
            >
              <title>{`${s.label}: ${format(s.value)} (${percent(s.value, total)}%)`}</title>
            </rect>
          );
          x += width;
          return rect;
        })}
      </svg>
      <figcaption className="space-y-2 text-sm">
        <span className="block font-medium">{title}</span>
        <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {slices.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: colorAt(i, s.color) }}
              />
              {s.label} <span className="tabular-nums">{format(s.value)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
      <ChartTable
        caption={title}
        labelHeader={labelHeader}
        columns={['Count', 'Share']}
        rows={slices.map((s) => ({
          label: s.label,
          values: [format(s.value), `${percent(s.value, total)}%`],
        }))}
      />
    </figure>
  );
}

export interface BarListRow {
  label: ReactNode;
  value: number;
  /** What to print for the value (defaults to format(value)). */
  display?: ReactNode;
}

/**
 * Ranked horizontal bars as a plain list (top items, utilisation). The text is
 * the data, so the bars themselves are decorative.
 */
export function BarList({
  title,
  rows,
  max,
  format = defaultFormat,
  className,
}: {
  title: string;
  rows: readonly BarListRow[];
  /** Value of a full bar (default: the largest value). */
  max?: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const id = useId();
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  return (
    <figure className={cn('min-w-0', className)} aria-labelledby={id}>
      <figcaption id={id} className="mb-2 text-sm font-medium">
        {title}
      </figcaption>
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 text-muted tabular-nums">
                {r.display ?? format(r.value)}
              </span>
            </div>
            <svg
              aria-hidden="true"
              viewBox="0 0 100 4"
              preserveAspectRatio="none"
              className="mt-1 block h-2 w-full rounded-full"
            >
              <rect width={100} height={4} rx={2} style={{ fill: 'var(--surface-2)' }} />
              <rect
                width={top > 0 ? Math.min(Math.max(r.value, 0) / top, 1) * 100 : 0}
                height={4}
                rx={2}
                style={{ fill: 'var(--brand)' }}
              />
            </svg>
          </li>
        ))}
      </ol>
    </figure>
  );
}
