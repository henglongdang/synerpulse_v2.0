/**
 * Chart components — D3 scales/shapes rendered as React SVG (the paper's prototype used D3.js).
 * Conventions (see docs/DESIGN_SYSTEM.md › Data visualisation):
 *  - 2px lines, ~10% area wash, bars ≤ 24px with 4px rounded data-ends, hairline solid grid;
 *  - legend for ≥ 2 series, crosshair + tooltip listing every series, keyboard accessible;
 *  - every chart has a table view; text never wears the series colour.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { money } from '../lib/format';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
  area?: boolean;
}

/** One tick style per axis: compact (10K) when the axis reaches $10,000, full otherwise. */
function axisFormatter(ticks: number[], currency: string) {
  const compact = Math.max(0, ...ticks.map((t) => Math.abs(t))) >= 1_000_000;
  return (t: number) => (compact ? money(t, currency, { compact: true }) : money(t, currency, { noCents: true }));
}

function niceDomain(values: number[], includeZero = true): [number, number] {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) max = min + 100_00;
  const pad = (max - min) * 0.06;
  return [min < 0 ? min - pad : min, max + pad];
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'swatch' | 'dashed' }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          {i.kind === 'swatch' ? (
            <span className="swatch" style={{ background: i.color }} />
          ) : (
            <span className={`line-key ${i.kind === 'dashed' ? 'dashed' : ''}`} style={{ background: i.color, color: i.color, height: 2 }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function TableView({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="details" style={{ marginTop: 8 }}>
      <summary>View as table</summary>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c} className={i ? 'r' : ''}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className={j ? 'r' : ''}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Time-series line chart with crosshair. Used for net worth and the cash-flow forecast. */
export function LineChart({
  labels,
  series,
  currency,
  height = 220,
  ariaLabel,
  refLines = [],
  markers = [],
  xTickEvery,
  tooltipExtra,
}: {
  labels: string[];
  series: Series[];
  currency: string;
  height?: number;
  ariaLabel: string;
  refLines?: { value: number; label: string; color: string }[];
  markers?: { index: number; seriesKey: string; label: string; color: string }[];
  xTickEvery?: number;
  tooltipExtra?: (i: number) => ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 12, right: 12, bottom: 26, left: 56 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const all = series.flatMap((s) => s.values).concat(refLines.map((r) => r.value));
  const x = useMemo(() => scalePoint<number>().domain(labels.map((_, i) => i)).range([0, w]), [labels, w]);
  const y = useMemo(() => scaleLinear().domain(niceDomain(all.length ? all : [0])).nice(4).range([h, 0]), [all.join(','), h]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticks = y.ticks(4);
  const fmtTick = axisFormatter(ticks, currency);
  const every = xTickEvery ?? Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 72))));
  const lineGen = line<number>()
    .x((_, i) => x(i) ?? 0)
    .y((v) => y(v))
    .curve(curveMonotoneX);
  const areaGen = area<number>()
    .x((_, i) => x(i) ?? 0)
    .y0(() => y(Math.max(y.domain()[0], 0)))
    .y1((v) => y(v))
    .curve(curveMonotoneX);

  const onMove = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !labels.length) return;
    const px = clientX - rect.left - m.left;
    const step = labels.length > 1 ? w / (labels.length - 1) : w;
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round(px / step))));
  };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((hv) => Math.min(labels.length - 1, (hv ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover((hv) => Math.max(0, (hv ?? labels.length) - 1));
            if (e.key === 'Escape') setHover(null);
          }}
          onBlur={() => setHover(null)}
          style={{ touchAction: 'pan-y' }}
        >
          <g transform={`translate(${m.left},${m.top})`}>
            <g className="grid">
              {ticks.map((t) => (
                <line key={t} x1={0} x2={w} y1={y(t)} y2={y(t)} />
              ))}
            </g>
            <g className="axis">
              {ticks.map((t) => (
                <text key={t} x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                  {fmtTick(t)}
                </text>
              ))}
              {labels.map((l, i) =>
                i % every === 0 || i === labels.length - 1 ? (
                  <text key={i} x={x(i)} y={h + 18} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
                    {i !== labels.length - 1 && labels.length - 1 - i < every ? '' : l}
                  </text>
                ) : null,
              )}
            </g>
            {refLines.map((r) => (
              <g key={r.label}>
                <line x1={0} x2={w} y1={y(r.value)} y2={y(r.value)} stroke={r.color} strokeWidth={1} />
                <text x={w} y={y(r.value) - 4} textAnchor="end" fontSize={11} fill="var(--ink-500)">
                  {r.label}
                </text>
              </g>
            ))}
            {series.map((s) => (
              <g key={s.key}>
                {s.area && <path d={areaGen(s.values) ?? ''} fill={s.color} opacity={0.1} />}
                <path
                  d={lineGen(s.values) ?? ''}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed ? '6 4' : undefined}
                />
              </g>
            ))}
            {series.map((s) => {
              const i = s.values.length - 1;
              return i >= 0 ? <circle key={`end-${s.key}`} cx={x(i)} cy={y(s.values[i])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
            })}
            {markers.map((mk) => {
              const s = series.find((ss) => ss.key === mk.seriesKey);
              if (!s || s.values[mk.index] === undefined) return null;
              return (
                <g key={mk.label}>
                  <circle cx={x(mk.index)} cy={y(s.values[mk.index])} r={6} fill={mk.color} stroke="var(--surface)" strokeWidth={2} />
                </g>
              );
            })}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="var(--ink-400)" strokeWidth={1} />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </g>
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tooltip" style={{ left: Math.min(Math.max(m.left + (x(hover) ?? 0), 90), width - 90), top: m.top + Math.min(...series.map((s) => y(s.values[hover]))) }}>
          <div className="tt-title">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="tt-row">
              <span className={`line-key ${s.dashed ? 'dashed' : ''}`} style={{ background: s.color, color: s.color }} />
              <span className="muted">{s.label}</span>
              <strong>{money(s.values[hover], currency, { noCents: true })}</strong>
            </div>
          ))}
          {tooltipExtra?.(hover)}
        </div>
      )}
    </div>
  );
}

/** Grouped columns (e.g. income vs spending per month). */
export function ColumnChart({
  labels,
  series,
  currency,
  height = 220,
  ariaLabel,
}: {
  labels: string[];
  series: { key: string; label: string; color: string; values: number[] }[];
  currency: string;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 12, right: 8, bottom: 26, left: 56 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const x0 = scaleBand<number>().domain(labels.map((_, i) => i)).range([0, w]).paddingInner(0.28).paddingOuter(0.1);
  const barW = Math.min(24, (x0.bandwidth() - 2 * (series.length - 1)) / series.length);
  const groupW = barW * series.length + 2 * (series.length - 1);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const y = scaleLinear().domain([0, max * 1.08]).nice(4).range([h, 0]);
  const ticks = y.ticks(4);
  const fmtTick = axisFormatter(ticks, currency);
  const bar = (bx: number, by: number, bw: number, bh: number) => {
    const r = Math.min(4, bh, bw / 2);
    return `M${bx},${by + bh} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bw - r} Q${bx + bw},${by} ${bx + bw},${by + r} V${by + bh} Z`;
  };
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <g transform={`translate(${m.left},${m.top})`}>
            <g className="grid">
              {ticks.map((t) => (
                <line key={t} x1={0} x2={w} y1={y(t)} y2={y(t)} />
              ))}
            </g>
            <g className="axis">
              {ticks.map((t) => (
                <text key={t} x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                  {fmtTick(t)}
                </text>
              ))}
              {labels.map((l, i) => (
                <text key={i} x={(x0(i) ?? 0) + x0.bandwidth() / 2} y={h + 18} textAnchor="middle">
                  {l}
                </text>
              ))}
            </g>
            {labels.map((_, i) => {
              const gx = (x0(i) ?? 0) + (x0.bandwidth() - groupW) / 2;
              return (
                <g
                  key={i}
                  tabIndex={0}
                  role="img"
                  aria-label={`${labels[i]}: ${series.map((s) => `${s.label} ${money(s.values[i], currency, { noCents: true })}`).join(', ')}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <rect x={x0(i)} y={0} width={x0.bandwidth()} height={h} fill={hover === i ? 'var(--surface-hover)' : 'transparent'} />
                  {series.map((s, si) => {
                    const v = s.values[i];
                    const bh = Math.max(v > 0 ? 1 : 0, h - y(v));
                    return <path key={s.key} d={bar(gx + si * (barW + 2), h - bh, barW, bh)} fill={s.color} />;
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tooltip" style={{ left: Math.min(Math.max(m.left + (x0(hover) ?? 0) + x0.bandwidth() / 2, 90), width - 90), top: m.top + y(Math.max(...series.map((s) => s.values[hover]))) }}>
          <div className="tt-title">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="tt-row">
              <span className="swatch" style={{ background: s.color }} />
              <span className="muted">{s.label}</span>
              <strong>{money(s.values[hover], currency, { noCents: true })}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tall segmented bar — one whole split into ≤ 6 parts (replaces the prototype's donut). */
export function SegmentedBar({ parts, currency, ariaLabel }: { parts: { key: string; label: string; value: number; color: string }[]; currency: string; ariaLabel: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  if (total <= 0) return null;
  return (
    <div className="chart">
      <div className="segbar" role="img" aria-label={ariaLabel}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const share = p.value / total;
            return (
              <div
                key={p.key}
                tabIndex={0}
                style={{ flexGrow: share, flexBasis: 0, background: p.color, outline: hover === p.key ? '2px solid var(--ink-900)' : undefined, outlineOffset: 1 }}
                onPointerEnter={() => setHover(p.key)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(p.key)}
                onBlur={() => setHover(null)}
                aria-label={`${p.label}: ${money(p.value, currency)} (${Math.round(share * 100)}%)`}
              >
                {share >= 0.12 ? `${Math.round(share * 100)}%` : ''}
              </div>
            );
          })}
      </div>
      {hover && (
        <div className="small" style={{ marginTop: 6 }} aria-live="polite">
          {(() => {
            const p = parts.find((x) => x.key === hover)!;
            return (
              <>
                <strong>{p.label}</strong> · <span className="num">{money(p.value, currency)}</span> · {Math.round((p.value / total) * 100)}%
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars, one colour (identity comes from the row label). */
export function RankedBars({ rows, currency, color = 'var(--viz-spend)', onSelect }: { rows: { key: string; label: string; value: number; meta?: string }[]; currency: string; color?: string; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="list" style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => {
        const content = (
          <>
            <div className="spread small" style={{ marginBottom: 4 }}>
              <span className="truncate" style={{ color: 'var(--ink-900)', fontWeight: 500 }}>
                {r.label}
              </span>
              <span className="num" style={{ color: 'var(--ink-900)' }}>
                {money(r.value, currency)}
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--surface-sunken)', borderRadius: 4 }}>
              <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: color, borderRadius: '0 4px 4px 0', minWidth: 2 }} />
            </div>
            {r.meta && <div className="xs muted" style={{ marginTop: 2 }}>{r.meta}</div>}
          </>
        );
        return (
          <li key={r.key}>
            {onSelect ? (
              <button type="button" className="row-button" style={{ padding: '2px 0', borderRadius: 4 }} onClick={() => onSelect(r.key)}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Goal progress ring (the prototype's "Financial Goals" rings). */
export function ProgressRing({ bp, size = 76, label }: { bp: number; size?: number; label: string }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, bp / 10_000));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${Math.floor(bp / 100)}% saved`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--leaf-100)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={frac >= 1 ? 'var(--good-600)' : 'var(--viz-income)'}
        strokeWidth={stroke}
        strokeDasharray={`${c * frac} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 300ms var(--ease)' }}
      />
      <text x="50%" y="50%" dy="0.35em" textAnchor="middle" className="ring-label">
        {Math.floor(bp / 100)}%
      </text>
    </svg>
  );
}
