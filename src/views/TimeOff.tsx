import { useMemo, useRef, useState } from 'react'
import type { useStore } from '../store'
import {
  buildLedger,
  balanceAsOf,
  projectBalance,
  forecastYearEnd,
  chargeableDays,
  earliestAffordable,
  hourlyRate,
  type PtoEvent,
  type PtoEventType,
} from '../engine/pto'
import { holidaySet } from '../engine/holidays'
import { bestBridgePerHoliday, type BridgePlan } from '../engine/bridge'
import { money, hoursLabel, daysLabel, prettyDate, todayISO } from '../format'
import { BalanceLines, YearCalendar, type BalanceSeries, type CalendarMark } from '../charts'

type Store = ReturnType<typeof useStore>

const TYPE_LABEL: Record<PtoEventType, string> = {
  accrual: 'Accrual',
  grant: 'Grant',
  usage: 'Time off',
  adjustment: 'Adjustment',
  expiration: 'Expired',
}

/** How many ledger rows show before "Show all". */
const LEDGER_PREVIEW = 10

interface FormState {
  bucketId: string
  type: PtoEventType
  start: string
  end: string
  hours: string
  note: string
}

export function TimeOff({ store }: { store: Store }) {
  const { state, addEvent, updateEvent, removeEvent } = store
  const { profile, buckets, events } = state
  const today = todayISO()
  const year = profile.year

  const blankForm = (): FormState => ({
    bucketId: buckets[0]?.id ?? '',
    type: 'usage',
    start: today,
    end: today,
    hours: '',
    note: '',
  })
  const [form, setForm] = useState<FormState>(blankForm)
  /** Set while an existing entry is loaded into the form; submit updates it. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)
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

  // Generated accruals outnumber real entries many to one, so they fold away
  // by default; expirations are generated too but matter, so they always show.
  const [showAccruals, setShowAccruals] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const accrualCount = ledger.filter((e) => e.type === 'accrual').length
  const filtered = showAccruals ? ledger : ledger.filter((e) => e.type !== 'accrual')
  const visible = showAll ? filtered : filtered.slice(-LEDGER_PREVIEW)

  const series: BalanceSeries[] = derived.map((d) => ({
    id: d.bucket.id,
    label: d.bucket.label,
    color: d.bucket.color,
    points: d.points,
    hoursPerDay: d.bucket.hoursPerDay,
    cap: d.bucket.carryoverCapHours,
  }))

  // Federal holidays for this year and its neighbours, so a span crossing New
  // Year is still costed correctly.
  const holidays = useMemo(() => holidaySet([year - 1, year, year + 1]), [year])

  const span =
    form.type === 'usage' && form.start && form.end && form.end >= form.start
      ? chargeableDays(form.start, form.end, holidays)
      : null
  const derivedHours = span ? span.workdays * formBucket.hoursPerDay : 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const raw = form.hours.trim() !== '' ? Number(form.hours) : derivedHours
    if (!raw) return
    const signed =
      form.type === 'usage' ? -Math.abs(raw) : form.type === 'adjustment' ? raw : Math.abs(raw)
    const payload: Omit<PtoEvent, 'id'> = {
      bucketId: form.bucketId,
      type: form.type,
      date: form.start,
      ...(form.type === 'usage' && form.end > form.start ? { endDate: form.end } : {}),
      hours: signed,
      note: form.note.trim() || undefined,
    }
    if (editingId) updateEvent(editingId, payload)
    else addEvent(payload)
    setEditingId(null)
    setForm(blankForm())
  }

  const startEdit = (e: PtoEvent) => {
    setEditingId(e.id)
    setForm({
      bucketId: e.bucketId,
      type: e.type,
      start: e.date,
      end: e.endDate ?? e.date,
      // Usage and grants are entered unsigned; adjustments keep their sign.
      hours: String(e.type === 'adjustment' ? e.hours : Math.abs(e.hours)),
      note: e.note ?? '',
    })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(blankForm())
  }

  const confirmRemove = (e: PtoEvent & { bucket: { label: string } }) => {
    const what = `${TYPE_LABEL[e.type].toLowerCase()} of ${hoursLabel(Math.abs(e.hours))} ${e.bucket.label} on ${prettyDate(e.date)}`
    if (window.confirm(`Delete the ${what}? This can't be undone.`)) {
      if (editingId === e.id) cancelEdit()
      removeEvent(e.id)
    }
  }

  // --- planning ------------------------------------------------------------

  const [wanted, setWanted] = useState(5)
  const affordable = useMemo(
    () =>
      earliestAffordable(buckets, events, wanted, today, `${year + 1}-12-31`),
    [buckets, events, wanted, today, year],
  )

  const primary = buckets[0]
  const bridges = useMemo(
    () => bestBridgePerHoliday(year, { maxPtoDays: 5, fromISO: today }).slice(0, 6),
    [year, today],
  )

  /** Days banked by a date, across every bucket — what a plan has to fit inside. */
  const daysBankedBy = (iso: string) =>
    buckets.reduce((a, b) => a + balanceAsOf(b, events, iso) / b.hoursPerDay, 0)

  const bookBridge = (plan: BridgePlan) => {
    if (!primary) return
    addEvent({
      bucketId: primary.id,
      type: 'usage',
      date: plan.bookDates[0],
      ...(plan.bookDates.length > 1
        ? { endDate: plan.bookDates[plan.bookDates.length - 1] }
        : {}),
      hours: -plan.ptoDays * primary.hoursPerDay,
      note: plan.holidays.map((h) => h.name).join(' + '),
    })
  }

  // Every day a booking covers, so the calendar draws a week off as a week.
  const marks = useMemo(() => {
    const out = new Map<string, CalendarMark>()
    for (const [date, name] of holidays) {
      if (date.startsWith(String(year))) out.set(date, { kind: 'holiday', title: name, color: 'var(--warning)' })
    }
    for (const b of buckets) {
      for (const e of events) {
        if (e.bucketId !== b.id || e.type !== 'usage') continue
        let cursor = e.date
        const end = e.endDate ?? e.date
        while (cursor <= end) {
          const dow = new Date(`${cursor}T00:00:00Z`).getUTCDay()
          // Weekends and holidays inside a trip weren't charged, so they aren't
          // drawn as spent either.
          if (dow !== 0 && dow !== 6 && !holidays.has(cursor)) {
            out.set(cursor, { kind: 'booked', title: e.note ?? `${b.label} booked`, color: b.color })
          }
          const next = new Date(`${cursor}T00:00:00Z`)
          next.setUTCDate(next.getUTCDate() + 1)
          cursor = next.toISOString().slice(0, 10)
        }
      }
    }
    return out
  }, [buckets, events, holidays, year])

  const breakdown = derived
    .filter((d) => Math.abs(d.balanceDays) > 0.001)
    .map((d) => `${Math.round(d.balanceDays * 100) / 100} ${d.bucket.label}`)
    .join(' + ')

  const formValue = (() => {
    const d = derived.find((x) => x.bucket.id === form.bucketId)
    const h = Number(form.hours) || derivedHours
    return d && d.rate > 0 && h ? h * d.rate : 0
  })()

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">Available today</div>
          <div className="value">{daysLabel(totals.days)}</div>
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
          <div className="value">{daysLabel(totals.yearEndDays)}</div>
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
                {daysLabel(d.forecast.forfeitedHours / d.bucket.hoursPerDay)} of {d.bucket.label}
                {d.rate ? ` — ${money(d.forecast.forfeitedHours * d.rate)}` : ''} on Dec 31.
              </strong>{' '}
              The projected balance of{' '}
              {daysLabel(d.forecast.balanceAtYearEnd / d.bucket.hoursPerDay)} is above the{' '}
              {daysLabel((d.bucket.carryoverCapHours ?? 0) / d.bucket.hoursPerDay)} carryover cap.
              Book time before year end or you simply lose it.
            </span>
          </div>
        ))}

      {/* Logging is the thing done most often, so it sits above the analysis. */}
      <div className="card" ref={formRef}>
        <h2>{editingId ? 'Edit entry' : 'Log time'}</h2>
        <p className="caption">
          {editingId
            ? 'Change anything below and save. The balance is replayed from scratch.'
            : 'Book time off, record a floating holiday, or correct a balance. Everything is an event — nothing is overwritten.'}
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
                  {span
                    ? `${span.workdays} workdays = ${hoursLabel(derivedHours)}`
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
                placeholder={derivedHours ? String(derivedHours) : String(formBucket?.hoursPerDay ?? 8)}
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
                placeholder={form.type === 'grant' ? 'Floating holiday awarded' : 'Trip to Tahoe'}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          {span && span.holidays.length > 0 && (
            <p className="muted-note" style={{ marginTop: 12 }}>
              {span.holidays.map((h) => h.name).join(' and ')}{' '}
              {span.holidays.length === 1 ? 'falls' : 'fall'} inside this span, so{' '}
              {span.holidays.length === 1 ? 'it is' : 'they are'} not charged —{' '}
              {span.workdays} days instead of {span.workdays + span.holidays.length}.
            </p>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="action primary" type="submit">
              {editingId ? 'Save changes' : 'Add to ledger'}
            </button>
            {editingId && (
              <button className="action" type="button" onClick={cancelEdit}>
                Cancel
              </button>
            )}
            {formValue > 0 && <span className="muted-note">worth {money(formValue)}</span>}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Balance through {year}</h2>
        <p className="caption">
          Month-end balance per bucket, including anything already booked for later in the year.
          Hover for the running total.
        </p>
        <BalanceLines series={series} markerDate={today} />
      </div>

      <div className="card">
        <h2>When can you take {wanted} {wanted === 1 ? 'day' : 'days'} off?</h2>
        <p className="caption">
          Balance projections say what you'll have. This says when — the first date the whole
          request is covered, counting anything you've already booked.
        </p>
        <div className="row">
          <label className="field" style={{ maxWidth: 160 }}>
            Days wanted
            <input
              type="number"
              min="1"
              step="1"
              value={wanted || ''}
              onChange={(e) => setWanted(Math.max(0, Number(e.target.value)))}
            />
          </label>
        </div>
        <div className="verdict">
          {!affordable ? (
            <>
              <div className="big">Not before {year + 1} is out</div>
              <p className="qualifier">
                {wanted} days is more than you'll have banked at any point through Dec 31, {year + 1}
                {totals.monthlyAccrual > 0 && (
                  <> at {hoursLabel(totals.monthlyAccrual)} a month</>
                )}
                . Either the request is too big or something already booked is in the way.
              </p>
            </>
          ) : affordable.shortfallToday === 0 ? (
            <>
              <div className="big delta up">Today</div>
              <p className="qualifier">
                You have {daysLabel(totals.days)} banked, so a {wanted}-day break is already covered
                {totals.value > 0 && (
                  <> — worth {money(wanted * (derived[0]?.rate ?? 0) * (primary?.hoursPerDay ?? 8))} of salary</>
                )}
                .
              </p>
            </>
          ) : (
            <>
              <div className="big">{prettyDate(affordable.date)}</div>
              <p className="qualifier">
                You're {daysLabel(affordable.shortfallToday)} short today. By {prettyDate(affordable.date)}{' '}
                you'll have {daysLabel(affordable.daysAvailable)} banked, which covers it.
              </p>
            </>
          )}
        </div>
      </div>

      {bridges.length > 0 && (
        <div className="card">
          <h2>Long weekends worth taking</h2>
          <p className="caption">
            A holiday next to a weekend is leverage: the runs below buy the most days off per day of
            PTO spent. Ranked best first, from today onwards.
          </p>
          <div className="plan-list">
            {bridges.map((plan) => {
              const banked = daysBankedBy(plan.start)
              const affordableThen = banked >= plan.ptoDays
              return (
                <div className="plan" key={`${plan.start}-${plan.end}`}>
                  <span className="lede">
                    {plan.totalDaysOff} days off for {plan.ptoDays}
                  </span>
                  <span className="detail">
                    {prettyDate(plan.start)} – {prettyDate(plan.end)} · book{' '}
                    {plan.bookDates.map((d) => prettyDate(d).replace(`, ${year}`, '')).join(', ')} ·{' '}
                    {plan.holidays.map((h) => h.name).join(' + ')}
                  </span>
                  {!affordableThen && (
                    <span className="pill unaffordable">
                      only {Math.round(banked * 10) / 10}d banked by then
                    </span>
                  )}
                  {primary && (
                    <button
                      className="action"
                      onClick={() => bookBridge(plan)}
                      disabled={!affordableThen}
                      title={
                        affordableThen
                          ? `Book ${plan.ptoDays} days of ${primary.label}`
                          : 'You will not have enough banked by then'
                      }
                    >
                      Book it
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="muted-note" style={{ marginTop: 12 }}>
            US federal holidays, observed dates. If your employer's calendar differs, the arithmetic
            here differs with it.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Your {year}</h2>
        <p className="caption">
          Everything booked, and every holiday you don't need to spend a day on.
        </p>
        <YearCalendar year={year} marks={marks} today={today} />
        <div className="legend">
          <span className="item">
            <span className="swatch" style={{ background: 'var(--warning)', opacity: 0.5 }} />
            Federal holiday
          </span>
          {buckets.map((b) => (
            <span className="item" key={b.id}>
              <span className="swatch" style={{ background: b.color }} />
              {b.label} booked
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Ledger</h2>
        <p className="caption">
          Every event across all buckets in {year}, oldest first. Accruals are generated from your
          schedule and recalculated on the fly.
        </p>
        <div className="ledger-tools">
          {accrualCount > 0 && (
            <button
              type="button"
              className="action small"
              aria-pressed={showAccruals}
              onClick={() => setShowAccruals((v) => !v)}
            >
              {showAccruals ? 'Hide' : 'Show'} {accrualCount} accrual{accrualCount === 1 ? '' : 's'}
            </button>
          )}
          {filtered.length > LEDGER_PREVIEW && (
            <button type="button" className="action small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Show latest ${LEDGER_PREVIEW}` : `Show all ${filtered.length}`}
            </button>
          )}
          {!showAll && filtered.length > LEDGER_PREVIEW && (
            <span>latest {LEDGER_PREVIEW} of {filtered.length}</span>
          )}
        </div>
        <div className="table-scroll">
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
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>
                    {ledger.length === 0
                      ? 'No events yet. Log time above to start the ledger.'
                      : 'Only accruals so far — show them above, or log time.'}
                  </td>
                </tr>
              )}
              {visible.map((e) => (
                <tr key={`${e.bucket.id}-${e.id}`} className={editingId === e.id ? 'editing' : undefined}>
                  <td>
                    {prettyDate(e.date)}
                    {e.endDate && e.endDate !== e.date && (
                      <span className="muted-note"> – {prettyDate(e.endDate)}</span>
                    )}
                  </td>
                  <td>
                    <span className="item" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span className="swatch" style={{ background: e.bucket.color }} />
                      {e.bucket.label}
                    </span>
                  </td>
                  <td className="name">{TYPE_LABEL[e.type]}</td>
                  <td className="wrap">
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
                      <span className="row" style={{ gap: 2, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button
                          className="action danger-text"
                          onClick={() => startEdit(e)}
                          aria-label={`Edit ${TYPE_LABEL[e.type]} on ${prettyDate(e.date)}`}
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          className="action danger-text"
                          onClick={() => confirmRemove(e)}
                          aria-label={`Delete ${TYPE_LABEL[e.type]} on ${prettyDate(e.date)}`}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
