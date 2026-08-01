import { useMemo, useState } from 'react'
import type { useStore } from '../store'
import {
  buildLedger,
  balanceAsOf,
  projectBalance,
  forecastYearEnd,
  businessDayCount,
  hourlyRate,
  type PtoEventType,
} from '../engine/pto'
import { money, hoursLabel, prettyDate, todayISO } from '../format'
import { BalanceLines, type BalanceSeries } from '../charts'

type Store = ReturnType<typeof useStore>

const TYPE_LABEL: Record<PtoEventType, string> = {
  accrual: 'Accrual',
  grant: 'Grant',
  usage: 'Time off',
  adjustment: 'Adjustment',
  expiration: 'Expired',
}

const days = (n: number) => `${Math.round(n * 100) / 100} ${Math.abs(n) === 1 ? 'day' : 'days'}`

export function TimeOff({ store }: { store: Store }) {
  const { state, addEvent, removeEvent } = store
  const { profile, buckets, events } = state
  const today = todayISO()
  const year = profile.year

  const [form, setForm] = useState({
    bucketId: buckets[0]?.id ?? '',
    type: 'usage' as PtoEventType,
    start: today,
    end: today,
    hours: '',
    note: '',
  })
  const formBucket = buckets.find((b) => b.id === form.bucketId) ?? buckets[0]

  /**
   * Every bucket is derived together — the whole point of merging the view is
   * that "how much time can I take?" is one number, not a per-tab lookup.
   */
  const derived = useMemo(
    () =>
      buckets.map((b) => {
        const rate = profile.annualSalary > 0 ? hourlyRate(profile.annualSalary, b.hoursPerDay) : 0
        const balance = balanceAsOf(b, events, today)
        const forecast = forecastYearEnd(b, events, year)
        return {
          bucket: b,
          rate,
          balance,
          forecast,
          balanceDays: balance / b.hoursPerDay,
          value: balance * rate,
          points: projectBalance(b, events, `${year}-01-01`, `${year}-12-31`),
        }
      }),
    [buckets, events, profile.annualSalary, today, year],
  )

  const totals = useMemo(
    () => ({
      // Days are summed per bucket, since workday length is per-bucket config.
      days: derived.reduce((a, d) => a + d.balanceDays, 0),
      hours: derived.reduce((a, d) => a + d.balance, 0),
      value: derived.reduce((a, d) => a + d.value, 0),
      yearEndDays: derived.reduce(
        (a, d) => a + d.forecast.balanceAtYearEnd / d.bucket.hoursPerDay,
        0,
      ),
      monthlyAccrual: derived.reduce(
        (a, d) =>
          a + (d.bucket.accrualKind === 'none' ? 0 : (d.bucket.annualDays * d.bucket.hoursPerDay) / 12),
        0,
      ),
    }),
    [derived],
  )

  // One ledger across every bucket, in date order.
  const ledger = useMemo(
    () =>
      buckets
        .flatMap((b) =>
          buildLedger(b, events, `${year}-12-31`).map((e) => ({ ...e, bucket: b })),
        )
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [buckets, events, year],
  )

  const series: BalanceSeries[] = derived.map((d) => ({
    id: d.bucket.id,
    label: d.bucket.label,
    color: d.bucket.color,
    points: d.points,
    hoursPerDay: d.bucket.hoursPerDay,
    cap: d.bucket.carryoverCapHours,
  }))

  const derivedHours =
    form.type === 'usage' && form.start && form.end && form.end >= form.start
      ? businessDayCount(form.start, form.end) * formBucket.hoursPerDay
      : 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const raw = form.hours.trim() !== '' ? Number(form.hours) : derivedHours
    if (!raw) return
    const signed =
      form.type === 'usage' ? -Math.abs(raw) : form.type === 'adjustment' ? raw : Math.abs(raw)
    addEvent({
      bucketId: form.bucketId,
      type: form.type,
      date: form.start,
      hours: signed,
      note: form.note.trim() || undefined,
    })
    setForm({ ...form, start: today, end: today, hours: '', note: '' })
  }

  const breakdown = derived
    .filter((d) => Math.abs(d.balanceDays) > 0.001)
    .map((d) => `${Math.round(d.balanceDays * 100) / 100} ${d.bucket.label}`)
    .join(' + ')

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">Available today</div>
          <div className="value">{days(totals.days)}</div>
          <div className="note">{breakdown || 'nothing banked yet'}</div>
        </div>
        <div className="tile">
          <div className="label">What it's worth</div>
          <div className="value">{totals.value ? money(totals.value) : '—'}</div>
          <div className="note">
            {totals.value ? `${hoursLabel(totals.hours)} banked` : 'add your salary in Settings'}
          </div>
        </div>
        <div className="tile">
          <div className="label">Projected Dec 31</div>
          <div className="value">{days(totals.yearEndDays)}</div>
          <div className="note">if you take nothing more this year</div>
        </div>
        <div className="tile">
          <div className="label">Earned per month</div>
          <div className="value">{hoursLabel(totals.monthlyAccrual)}</div>
          <div className="note">
            {derived
              .filter((d) => d.bucket.accrualKind !== 'none')
              .map((d) => `${d.bucket.annualDays} days/yr`)
              .join(', ') || 'granted, not accrued'}
          </div>
        </div>
      </div>

      {derived
        .filter((d) => d.forecast.forfeitedHours > 0)
        .map((d) => (
          <div className="callout critical" key={d.bucket.id}>
            <span className="icon" aria-hidden="true">
              ⚠
            </span>
            <span>
              <strong>
                You're on track to forfeit{' '}
                {days(d.forecast.forfeitedHours / d.bucket.hoursPerDay)} of {d.bucket.label}
                {d.rate ? ` — ${money(d.forecast.forfeitedHours * d.rate)}` : ''} on Dec 31.
              </strong>{' '}
              The projected balance of {hoursLabel(d.forecast.balanceAtYearEnd)} is above the{' '}
              {hoursLabel(d.bucket.carryoverCapHours ?? 0)} carryover cap. Book time before year
              end or you simply lose it.
            </span>
          </div>
        ))}

      <div className="card">
        <h2>Balance through {year}</h2>
        <p className="caption">
          Month-end balance per bucket, including anything already booked for later in the year.
          Hover for the running total.
        </p>
        <BalanceLines series={series} markerDate={today} />
      </div>

      <div className="card">
        <h2>Log time</h2>
        <p className="caption">
          Book time off, record a floating holiday, or correct a balance. Everything is an event
          — nothing is overwritten.
        </p>
        <form onSubmit={submit}>
          <div className="field-grid">
            <label className="field">
              Bucket
              {/* Explicit aria-label: a nested <select> otherwise absorbs its
                  own option text into its accessible name. */}
              <select
                aria-label="Bucket"
                value={form.bucketId}
                onChange={(e) => setForm({ ...form, bucketId: e.target.value })}
              >
                {buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Type
              <select
                aria-label="Type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as PtoEventType })}
              >
                <option value="usage">Time off taken</option>
                <option value="grant">Grant (floater, comp day)</option>
                <option value="adjustment">Manual adjustment</option>
              </select>
            </label>
            <label className="field">
              {form.type === 'usage' ? 'First day' : 'Date'}
              <input
                type="date"
                value={form.start}
                onChange={(e) =>
                  setForm({
                    ...form,
                    start: e.target.value,
                    end: e.target.value > form.end ? e.target.value : form.end,
                  })
                }
              />
            </label>
            {form.type === 'usage' && (
              <label className="field">
                Last day
                <input
                  type="date"
                  min={form.start}
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
                <span className="hint">
                  {derivedHours
                    ? `${businessDayCount(form.start, form.end)} weekdays = ${hoursLabel(derivedHours)}`
                    : 'weekends are not counted'}
                </span>
              </label>
            )}
            <label className="field">
              Hours
              <input
                type="number"
                step="0.5"
                value={form.hours}
                placeholder={derivedHours ? String(derivedHours) : String(formBucket.hoursPerDay)}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
              <span className="hint">
                {form.type === 'adjustment'
                  ? 'negative to remove hours'
                  : 'blank uses the value above'}
              </span>
            </label>
            <label className="field">
              Note
              <input
                type="text"
                value={form.note}
                placeholder={form.type === 'grant' ? 'Floating holiday' : 'Trip to Tahoe'}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="action primary" type="submit">
              Add to ledger
            </button>
            {(() => {
              const d = derived.find((x) => x.bucket.id === form.bucketId)
              const h = Number(form.hours) || derivedHours
              return d && d.rate > 0 && h ? (
                <span className="muted-note">worth {money(h * d.rate)}</span>
              ) : null
            })()}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Ledger</h2>
        <p className="caption">
          Every event across all buckets in {year}, oldest first. Accruals are generated from your
          schedule and recalculated on the fly.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Bucket</th>
              <th>Type</th>
              <th>Detail</th>
              <th className="num">Hours</th>
              <th className="num">Bucket balance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>
                  No events yet.
                </td>
              </tr>
            )}
            {ledger.map((e) => (
              <tr key={`${e.bucket.id}-${e.id}`}>
                <td>{prettyDate(e.date)}</td>
                <td>
                  <span className="item" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <span className="swatch" style={{ background: e.bucket.color }} />
                    {e.bucket.label}
                  </span>
                </td>
                <td className="name">{TYPE_LABEL[e.type]}</td>
                <td>
                  {e.note ?? '—'}
                  {e.cappedHours ? (
                    <span className="pill" style={{ marginLeft: 8 }}>
                      {hoursLabel(e.cappedHours)} lost to ceiling
                    </span>
                  ) : null}
                </td>
                <td
                  className="num"
                  style={{ color: e.hours >= 0 ? 'var(--success-text)' : 'var(--text-primary)' }}
                >
                  {e.hours >= 0 ? '+' : ''}
                  {Math.round(e.hours * 10) / 10}
                </td>
                <td className="num">{Math.round(e.balance * 10) / 10}</td>
                <td className="num">
                  {!e.generated && (
                    <button
                      className="action danger-text"
                      onClick={() => removeEvent(e.id)}
                      aria-label={`Delete ${TYPE_LABEL[e.type]} on ${prettyDate(e.date)}`}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
