/**
 * Hand-rolled SVG charts. Small enough not to warrant a charting dependency,
 * and it keeps exact control over the mark specs: 2px surface gaps between
 * fills, rounded data-ends, 2px lines, recessive grid, direct labels.
 */

import { useId, useMemo, useRef, useState } from 'react'
import { money, hoursLabel, shortMonth, prettyDate } from './format'
import { parseDate, toISO } from './engine/pto'

interface TipState {
  x: number
  y: number
  title: string
  rows: { label: string; value: string }[]
}

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: tip.x + 14, top: tip.y - 10 }} role="presentation">
      <div style={{ fontWeight: 600, marginBottom: tip.rows.length ? 4 : 0 }}>{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="tip-row" key={r.label}>
          <span className="tip-label">{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export interface TableSpec {
  head: string[]
  rows: (string | number)[][]
  /** Per column; numeric columns right-align with tabular figures. */
  numeric?: boolean[]
}

/**
 * Every chart can be flipped to a table. Hover tooltips are otherwise the only
 * route to the exact figures, and hover doesn't exist on a phone or a keyboard.
 */
function ChartOrTable({ table, children }: { table: TableSpec; children: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <div>
      {asTable ? (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={i} className={table.numeric?.[i] ? 'num' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className={table.numeric?.[ci] ? 'num' : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
      <button
        type="button"
        className="chart-toggle"
        aria-pressed={asTable}
        onClick={() => setAsTable((v) => !v)}
      >
        {asTable ? 'Show as chart' : 'Show as table'}
      </button>
    </div>
  )
}

export interface Segment {
  label: string
  value: number
  color: string
}

/**
 * Horizontal stacked bar showing how gross pay splits. Every segment is also
 * direct-labelled in the legend with its dollar value and share, which is the
 * required relief for the two palette slots that sit under 3:1 on light.
 */
export function AllocationBar({ segments, total }: { segments: Segment[]; total: number }) {
  const clipId = useId()
  const [tip, setTip] = useState<TipState | null>(null)
  const height = 46
  const gap = 2

  const shown = segments.filter((s) => s.value > 0)
  const sum = shown.reduce((a, s) => a + s.value, 0) || 1

  let cursor = 0
  const placed = shown.map((s) => {
    const width = (s.value / sum) * 100
    const seg = { ...s, x: cursor, width }
    cursor += width
    return seg
  })

  const table: TableSpec = {
    head: ['Segment', 'Amount', 'Share of gross'],
    numeric: [false, true, true],
    rows: placed.map((s) => [s.label, money(s.value), `${((s.value / sum) * 100).toFixed(1)}%`]),
  }

  return (
    <ChartOrTable table={table}>
      <svg
        width="100%"
        height={height}
        role="img"
        aria-label={`Allocation of ${money(total)} gross pay`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width="100%" height={height} rx="4" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {placed.map((s) => (
            <rect
              key={s.label}
              x={`${s.x}%`}
              y={0}
              width={`calc(${s.width}% - ${gap}px)`}
              height={height}
              fill={s.color}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  title: s.label,
                  rows: [
                    { label: 'Amount', value: money(s.value) },
                    { label: 'Share of gross', value: `${((s.value / sum) * 100).toFixed(1)}%` },
                  ],
                })
              }
              onMouseLeave={() => setTip(null)}
            />
          ))}
        </g>
      </svg>

      <div className="legend">
        {placed.map((s) => (
          <span className="item" key={s.label}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} — {money(s.value)} ({((s.value / sum) * 100).toFixed(1)}%)
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </ChartOrTable>
  )
}

export interface LinePoint {
  date: string
  balance: number
}

export interface BalanceSeries {
  id: string
  label: string
  color: string
  points: LinePoint[]
  /** Buckets can define different workday lengths, so hours→days is per-series. */
  hoursPerDay: number
  /** Carryover cap, drawn as a dashed reference line in the series colour. */
  cap?: number | null
}

/**
 * Projected balances over time, one line per time-off bucket, sharing a single
 * y-axis (they're all hours — a second scale would be a lie). The crosshair
 * reports every series at once so the buckets can be compared at a glance.
 */
export function BalanceLines({
  series,
  markerDate,
}: {
  series: BalanceSeries[]
  markerDate?: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const w = 720
  const h = 230
  // Right pad leaves room for the direct end-labels on each line — wide enough
  // for the longest bucket name, or the label gets clipped by the viewBox.
  const pad = { top: 16, right: 124, bottom: 28, left: 44 }

  const live = series.filter((s) => s.points.length > 0)
  if (live.length === 0) return null

  // All buckets project over the same month-end grid, so the x-axis is shared.
  const dates = live[0].points.map((p) => p.date)
  const n = dates.length

  const values = live.flatMap((s) => s.points.map((p) => p.balance))
  for (const s of live) if (s.cap != null) values.push(s.cap)
  const maxV = Math.max(...values, 1)
  const minV = Math.min(...values, 0)
  const span = maxV - minV || 1

  const x = (i: number) => pad.left + (i / Math.max(n - 1, 1)) * (w - pad.left - pad.right)
  const y = (v: number) => pad.top + (1 - (v - minV) / span) * (h - pad.top - pad.bottom)

  const ticks = Array.from({ length: 5 }, (_, i) => minV + (span * i) / 4)
  const markerIdx = markerDate ? dates.findIndex((d) => d >= markerDate) : -1

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const relX = ((e.clientX - rect.left) / rect.width) * w
    const frac = (relX - pad.left) / (w - pad.left - pad.right)
    const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))))
    setHoverIdx(idx)
    // Days are summed per-series, not derived from total hours, so buckets with
    // different workday lengths still add up correctly.
    const totalDays = live.reduce(
      (a, s) => a + (s.points[idx]?.balance ?? 0) / s.hoursPerDay,
      0,
    )
    setTip({
      x: e.clientX,
      y: e.clientY,
      title: prettyDate(dates[idx]),
      rows: [
        ...live.map((s) => ({
          label: s.label,
          value: `${hoursLabel(s.points[idx]?.balance ?? 0)} · ${
            Math.round(((s.points[idx]?.balance ?? 0) / s.hoursPerDay) * 100) / 100
          }d`,
        })),
        ...(live.length > 1
          ? [{ label: 'Total', value: `${Math.round(totalDays * 100) / 100} days` }]
          : []),
      ],
    })
  }

  const daysAt = (s: BalanceSeries, i: number) =>
    Math.round(((s.points[i]?.balance ?? 0) / s.hoursPerDay) * 100) / 100
  const table: TableSpec = {
    head: ['Month end', ...live.map((s) => s.label), ...(live.length > 1 ? ['Total'] : [])],
    numeric: [false, ...live.map(() => true), true],
    rows: dates.map((d, i) => [
      prettyDate(d),
      ...live.map((s) => `${hoursLabel(s.points[i]?.balance ?? 0)} · ${daysAt(s, i)}d`),
      ...(live.length > 1
        ? [`${Math.round(live.reduce((a, s) => a + daysAt(s, i), 0) * 100) / 100} days`]
        : []),
    ]),
  }

  return (
    <ChartOrTable table={table}>
      <svg
        ref={ref}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Projected time-off balance by month, per bucket"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setTip(null)
          setHoverIdx(null)
        }}
        // Width-only sizing: a fixed height attribute would letterbox the
        // viewBox and leave the plot floating in the middle of the card.
        style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair' }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--grid)"
              strokeWidth="1"
            />
            <text
              x={pad.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {Math.round(t)}h
            </text>
          </g>
        ))}

        {live.map((s) =>
          s.cap != null ? (
            <g key={`cap-${s.id}`}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={y(s.cap)}
                y2={y(s.cap)}
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray="5 4"
                opacity="0.65"
              />
              <text
                // Left-anchored: the right edge holds the end-labels.
                x={pad.left + 4}
                y={y(s.cap) - 6}
                fontSize="11"
                fill={s.color}
              >
                {s.label} carryover cap
              </text>
            </g>
          ) : null,
        )}

        {markerIdx >= 0 && (
          <>
            <line
              x1={x(markerIdx)}
              x2={x(markerIdx)}
              y1={pad.top}
              y2={h - pad.bottom}
              stroke="var(--axis)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text x={x(markerIdx) + 5} y={pad.top + 10} fontSize="11" fill="var(--text-muted)">
              today
            </text>
          </>
        )}

        {live.map((s) => (
          <g key={s.id}>
            <path
              d={s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.balance)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {s.points.map((p, i) => (
              <circle
                key={p.date}
                cx={x(i)}
                cy={y(p.balance)}
                r={hoverIdx === i ? 5.5 : 4}
                fill={s.color}
                stroke="var(--surface-1)"
                strokeWidth="2"
              />
            ))}
            {/* Direct end-label: identity is never carried by colour alone. */}
            <text
              x={x(n - 1) + 10}
              y={y(s.points[n - 1]?.balance ?? 0) + 4}
              fontSize="11"
              fontWeight="600"
              fill={s.color}
            >
              {s.label}
            </text>
          </g>
        ))}

        {dates.map((d, i) =>
          i % 2 === 0 ? (
            <text
              key={`l-${d}`}
              x={x(i)}
              y={h - pad.bottom + 16}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {shortMonth(d)}
            </text>
          ) : null,
        )}

        <line
          x1={pad.left}
          x2={w - pad.right}
          y1={h - pad.bottom}
          y2={h - pad.bottom}
          stroke="var(--axis)"
          strokeWidth="1"
        />
      </svg>

      <div className="legend">
        {live.map((s) => (
          <span className="item" key={s.id}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} — {hoursLabel(s.points[n - 1]?.balance ?? 0)} at year end
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </ChartOrTable>
  )
}

export interface TimelinePoint {
  index: number
  date: string
  net: number
  gross: number
  retirement: number
  employerMatch: number
  socialSecurity: number
  tax: number
  event?: 'ss-cap' | 'deferral-cap'
}

const EVENT_COPY: Record<NonNullable<TimelinePoint['event']>, { label: string; tone: string }> = {
  'ss-cap': { label: 'Social Security stops', tone: 'var(--good)' },
  'deferral-cap': { label: '401(k) limit reached', tone: 'var(--critical)' },
}

/**
 * Take-home, paycheck by paycheck.
 *
 * A step line rather than bars: the checks are near-identical in magnitude, so
 * a zero-baselined bar chart would render the mid-year steps — the only thing
 * worth looking at — as invisible. Lines carry no area, so a zoomed axis is
 * legitimate here, and the floor is labelled outright rather than left to be
 * inferred.
 */
export function PaycheckTimeline({ points }: { points: TimelinePoint[] }) {
  const ref = useRef<SVGSVGElement>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const w = 720
  const h = 210
  const pad = { top: 18, right: 16, bottom: 30, left: 56 }

  if (points.length < 2) return null

  const nets = points.map((p) => p.net)
  const lo = Math.min(...nets)
  const hi = Math.max(...nets)
  // A flat year still needs a sane band, or the line lands on the axis.
  const padding = Math.max((hi - lo) * 0.35, hi * 0.02)
  const minV = Math.max(0, lo - padding)
  const maxV = hi + padding
  const span = maxV - minV || 1

  const n = points.length
  const x = (i: number) => pad.left + (i / (n - 1)) * (w - pad.left - pad.right)
  const y = (v: number) => pad.top + (1 - (v - minV) / span) * (h - pad.top - pad.bottom)

  // Step path: each check holds its value until the next one lands.
  const step = points
    .flatMap((p, i) => {
      const half = i < n - 1 ? (x(i) + x(i + 1)) / 2 : x(i)
      return i === 0
        ? [`M${pad.left},${y(p.net)}`, `L${half},${y(p.net)}`]
        : [`L${x(i) - (x(i) - x(i - 1)) / 2},${y(p.net)}`, `L${half},${y(p.net)}`]
    })
    .join(' ')

  const ticks = Array.from({ length: 4 }, (_, i) => minV + (span * i) / 3)

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const relX = ((e.clientX - rect.left) / rect.width) * w
    const frac = (relX - pad.left) / (w - pad.left - pad.right)
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))))
    const p = points[i]
    setHoverIdx(i)
    setTip({
      x: e.clientX,
      y: e.clientY,
      title: `Paycheck ${p.index} · ${prettyDate(p.date)}`,
      rows: [
        { label: 'Take-home', value: money(p.net, true) },
        { label: 'Gross', value: money(p.gross, true) },
        { label: 'Tax withheld', value: money(p.tax, true) },
        ...(p.retirement ? [{ label: '401(k)', value: money(p.retirement, true) }] : []),
        ...(p.employerMatch ? [{ label: 'Match', value: money(p.employerMatch, true) }] : []),
        ...(p.event ? [{ label: '', value: EVENT_COPY[p.event].label }] : []),
      ],
    })
  }

  const table: TableSpec = {
    head: ['#', 'Pay date', 'Gross', '401(k)', 'Match', 'Tax withheld', 'Take-home', ''],
    numeric: [true, false, true, true, true, true, true, false],
    rows: points.map((p) => [
      p.index,
      prettyDate(p.date),
      money(p.gross, true),
      money(p.retirement, true),
      money(p.employerMatch, true),
      money(p.tax, true),
      money(p.net, true),
      p.event ? EVENT_COPY[p.event].label : '',
    ]),
  }

  return (
    <ChartOrTable table={table}>
      <svg
        ref={ref}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Take-home pay for each paycheck of the year"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setTip(null)
          setHoverIdx(null)
        }}
        style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair' }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
              {money(t)}
            </text>
          </g>
        ))}

        {points.map((p, i) =>
          p.event ? (
            <g key={`ev-${p.index}`}>
              <line
                x1={x(i) - (x(1) - x(0)) / 2}
                x2={x(i) - (x(1) - x(0)) / 2}
                y1={pad.top}
                y2={h - pad.bottom}
                stroke={EVENT_COPY[p.event].tone}
                strokeWidth="2"
                strokeDasharray="4 3"
                opacity="0.7"
              />
              <text
                // Late-year events would overflow the right edge, so they label leftward.
                x={x(i) - (x(1) - x(0)) / 2 + (i > n * 0.6 ? -6 : 6)}
                textAnchor={i > n * 0.6 ? 'end' : 'start'}
                y={pad.top + 10}
                fontSize="11"
                fontWeight="600"
                fill={EVENT_COPY[p.event].tone}
              >
                {EVENT_COPY[p.event].label}
              </text>
            </g>
          ) : null,
        )}

        <path d={step} fill="none" stroke="var(--series-net)" strokeWidth="2" strokeLinejoin="round" />

        {hoverIdx !== null && (
          <circle cx={x(hoverIdx)} cy={y(points[hoverIdx].net)} r="5" fill="var(--series-net)" stroke="var(--surface-1)" strokeWidth="2" />
        )}

        {points.map((p, i) =>
          i % Math.ceil(n / 8) === 0 ? (
            <text key={`x-${p.index}`} x={x(i)} y={h - pad.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
              {shortMonth(p.date)}
            </text>
          ) : null,
        )}

        <line x1={pad.left} x2={w - pad.right} y1={h - pad.bottom} y2={h - pad.bottom} stroke="var(--axis)" />
      </svg>
      <p className="muted-note" style={{ marginTop: 8 }}>
        Axis starts at {money(minV)}, not zero — the swing between checks is the point, and it is
        small next to the checks themselves.
      </p>
      <Tooltip tip={tip} />
    </ChartOrTable>
  )
}

export interface CalendarMark {
  /** Fill colour; omit for an unmarked day. */
  color?: string
  /** Shown on hover. */
  title: string
  kind: 'holiday' | 'booked' | 'suggested'
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/**
 * The whole year at once, as twelve month grids.
 *
 * Weekday-aligned rather than a flat day strip, because the thing being looked
 * for is shape: a holiday sitting next to a weekend, a booked run stretching
 * across one. A strip hides exactly that.
 */
export function YearCalendar({
  year,
  marks,
  today,
}: {
  year: number
  marks: Map<string, CalendarMark>
  today?: string
}) {
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) => {
        const first = new Date(Date.UTC(year, m, 1))
        const daysInMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate()
        return {
          index: m,
          label: first.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
          // Leading blanks align the 1st under its weekday column.
          lead: first.getUTCDay(),
          days: Array.from({ length: daysInMonth }, (_, d) => toISO(new Date(Date.UTC(year, m, d + 1)))),
        }
      }),
    [year],
  )

  return (
    <div className="year-cal">
      {months.map((month) => (
        <div className="month" key={month.index}>
          <div className="month-label">{month.label}</div>
          <div className="dow">
            {WEEKDAY_INITIALS.map((d, i) => (
              <span key={i} aria-hidden="true">
                {d}
              </span>
            ))}
          </div>
          <div className="days">
            {Array.from({ length: month.lead }, (_, i) => (
              <span className="day blank" key={`b-${i}`} />
            ))}
            {month.days.map((iso) => {
              const mark = marks.get(iso)
              const dow = parseDate(iso).getUTCDay()
              const weekend = dow === 0 || dow === 6
              const cls = [
                'day',
                weekend ? 'weekend' : '',
                mark ? `mark-${mark.kind}` : '',
                iso === today ? 'today' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <span
                  key={iso}
                  className={cls}
                  style={mark?.color ? ({ '--mark': mark.color } as React.CSSProperties) : undefined}
                  title={mark ? `${prettyDate(iso)} — ${mark.title}` : prettyDate(iso)}
                >
                  {Number(iso.slice(8))}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
