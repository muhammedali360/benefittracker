/**
 * Hand-rolled SVG charts. Small enough not to warrant a charting dependency,
 * and it keeps exact control over the mark specs: 2px surface gaps between
 * fills, rounded data-ends, 2px lines, recessive grid, direct labels.
 */

import { useId, useRef, useState } from 'react'
import { money, hoursLabel, shortMonth, prettyDate } from './format'

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

  return (
    <div>
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
    </div>
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

  return (
    <div>
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
    </div>
  )
}
