/**
 * PTO as an append-only ledger.
 *
 * There is no stored balance anywhere in this app. A balance is always the
 * result of replaying typed events in date order. That makes floating holidays,
 * comp days, and one-off corrections ordinary events rather than special cases,
 * and it means "what will my balance be in November?" is the same computation
 * as "what is it today" — just with a later cutoff.
 */

export type PtoEventType =
  | 'accrual' // earned on schedule
  | 'grant' // one-off award (floating holiday, comp day)
  | 'usage' // time taken
  | 'adjustment' // manual correction
  | 'expiration' // lost to a carryover cap

export type AccrualKind = 'monthly' | 'per-paycheck' | 'lump' | 'none'

export interface PtoEvent {
  id: string
  bucketId: string
  type: PtoEventType
  /** ISO date, YYYY-MM-DD. */
  date: string
  /** Signed hours: positive adds to balance, negative removes. */
  hours: number
  note?: string
  /** True for events synthesised by the accrual schedule rather than entered. */
  generated?: boolean
}

export interface BucketConfig {
  id: string
  label: string
  hoursPerDay: number
  accrualKind: AccrualKind
  /** Days earned per year under the accrual schedule. */
  annualDays: number
  /** Date the accrual schedule starts (hire date, or Jan 1). */
  accrualStart: string
  /** Accrual pauses once the balance reaches this. null = no ceiling. */
  maxBalanceHours: number | null
  /** Hours allowed to survive into the next year. null = unlimited. */
  carryoverCapHours: number | null
  color: string
}

export interface LedgerEntry extends PtoEvent {
  /** Balance immediately after this event is applied. */
  balance: number
  /** Hours dropped because the balance ceiling was already reached. */
  cappedHours?: number
}

// --- date helpers (all UTC, date-only, to dodge timezone drift) ---

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function endOfMonth(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex + 1, 0))
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

/** Whole days between two ISO dates, inclusive of both endpoints. */
export function inclusiveDayCount(startISO: string, endISO: string): number {
  const start = parseDate(startISO)
  const end = parseDate(endISO)
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
}

/** Weekdays between two ISO dates, inclusive — what usually counts against PTO. */
export function businessDayCount(startISO: string, endISO: string): number {
  let count = 0
  let cursor = parseDate(startISO)
  const end = parseDate(endISO)
  while (cursor <= end) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) count++
    cursor = addDays(cursor, 1)
  }
  return count
}

export interface ChargeableDays {
  /** Weekdays in the span that actually consume the balance. */
  workdays: number
  /** Weekdays skipped because the office was closed anyway. */
  holidays: { date: string; name: string }[]
  weekendDays: number
}

/**
 * Weekdays in a span, minus the ones that are company holidays. Booking the
 * week of Thanksgiving costs four days, not five, and quietly charging five is
 * how a tracker invents a day you don't have.
 */
export function chargeableDays(
  startISO: string,
  endISO: string,
  holidays: Map<string, string> = new Map(),
): ChargeableDays {
  let workdays = 0
  let weekendDays = 0
  const hit: { date: string; name: string }[] = []
  let cursor = parseDate(startISO)
  const end = parseDate(endISO)
  while (cursor <= end) {
    const iso = toISO(cursor)
    const day = cursor.getUTCDay()
    if (day === 0 || day === 6) weekendDays++
    else {
      const name = holidays.get(iso)
      if (name) hit.push({ date: iso, name })
      else workdays++
    }
    cursor = addDays(cursor, 1)
  }
  return { workdays, holidays: hit, weekendDays }
}

export interface AffordabilityResult {
  /** Earliest date the requested time is fully covered. */
  date: string
  /** Days available on that date, across every bucket. */
  daysAvailable: number
  /** Days short right now — zero if it's already affordable. */
  shortfallToday: number
}

/**
 * "When can I actually take a week off?"
 *
 * Balance projections answer what you'll have; this answers the question people
 * really ask, which is when. Buckets are summed in days rather than hours,
 * because a bucket can define its own workday length and adding raw hours
 * across two different workday lengths gives a number that means nothing.
 */
export function earliestAffordable(
  buckets: BucketConfig[],
  events: PtoEvent[],
  daysWanted: number,
  fromISO: string,
  horizonISO: string,
): AffordabilityResult | null {
  if (daysWanted <= 0 || buckets.length === 0) return null

  // Replay each bucket once over the whole horizon, then read balances off the
  // ledgers — rebuilding per candidate date would be O(days²) for no gain.
  const ledgers = buckets.map((b) => ({ bucket: b, entries: buildLedger(b, events, horizonISO) }))

  const daysAvailableOn = (iso: string) =>
    ledgers.reduce((total, { bucket, entries }) => {
      let balance = 0
      for (const e of entries) {
        if (e.date > iso) break
        balance = e.balance
      }
      return total + balance / bucket.hoursPerDay
    }, 0)

  const today = daysAvailableOn(fromISO)
  let cursor = parseDate(fromISO)
  const end = parseDate(horizonISO)

  while (cursor <= end) {
    const iso = toISO(cursor)
    const available = daysAvailableOn(iso)
    if (available >= daysWanted) {
      return {
        date: iso,
        daysAvailable: available,
        shortfallToday: Math.max(0, daysWanted - today),
      }
    }
    cursor = addDays(cursor, 1)
  }
  return null
}

/**
 * Synthesise the accrual events a bucket's schedule produces between its start
 * date and `throughISO`. These are never persisted — they're recomputed on
 * every render so that changing the accrual rate retroactively fixes history.
 */
export function generateAccruals(bucket: BucketConfig, throughISO: string): PtoEvent[] {
  if (bucket.accrualKind === 'none' || bucket.annualDays <= 0) return []

  const start = parseDate(bucket.accrualStart)
  const through = parseDate(throughISO)
  if (through < start) return []

  const annualHours = bucket.annualDays * bucket.hoursPerDay
  const events: PtoEvent[] = []

  if (bucket.accrualKind === 'lump') {
    // One grant per calendar year, on Jan 1 (or the accrual start in year one).
    for (let y = start.getUTCFullYear(); y <= through.getUTCFullYear(); y++) {
      const jan1 = new Date(Date.UTC(y, 0, 1))
      const when = jan1 < start ? start : jan1
      if (when > through) break
      events.push({
        id: `accrual-${bucket.id}-${toISO(when)}`,
        bucketId: bucket.id,
        type: 'accrual',
        date: toISO(when),
        hours: annualHours,
        note: `${bucket.annualDays} days granted for ${y}`,
        generated: true,
      })
    }
    return events
  }

  const perPeriod =
    bucket.accrualKind === 'monthly' ? annualHours / 12 : annualHours / 26

  if (bucket.accrualKind === 'monthly') {
    // Credited at the end of each month.
    let cursor = endOfMonth(start.getUTCFullYear(), start.getUTCMonth())
    while (cursor <= through) {
      if (cursor >= start) {
        events.push({
          id: `accrual-${bucket.id}-${toISO(cursor)}`,
          bucketId: bucket.id,
          type: 'accrual',
          date: toISO(cursor),
          hours: perPeriod,
          note: 'Monthly accrual',
          generated: true,
        })
      }
      cursor = endOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1)
    }
    return events
  }

  // per-paycheck: every 14 days from the accrual start.
  let cursor = new Date(start)
  while (cursor <= through) {
    events.push({
      id: `accrual-${bucket.id}-${toISO(cursor)}`,
      bucketId: bucket.id,
      type: 'accrual',
      date: toISO(cursor),
      hours: perPeriod,
      note: 'Per-paycheck accrual',
      generated: true,
    })
    cursor = addDays(cursor, 14)
  }
  return events
}

/**
 * Replay a bucket's events through `throughISO`, applying the balance ceiling
 * and year-end carryover forfeiture in chronological order.
 */
export function buildLedger(
  bucket: BucketConfig,
  manualEvents: PtoEvent[],
  throughISO: string,
): LedgerEntry[] {
  const mine = manualEvents.filter((e) => e.bucketId === bucket.id)
  const all = [...generateAccruals(bucket, throughISO), ...mine]
    .filter((e) => e.date <= throughISO)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : typeOrder(a) - typeOrder(b)))

  const ledger: LedgerEntry[] = []
  let balance = 0
  let year = all.length ? parseDate(all[0].date).getUTCFullYear() : 0

  for (const event of all) {
    const eventYear = parseDate(event.date).getUTCFullYear()

    // Crossing a year boundary: forfeit anything above the carryover cap.
    while (eventYear > year) {
      if (bucket.carryoverCapHours !== null && balance > bucket.carryoverCapHours) {
        const lost = balance - bucket.carryoverCapHours
        balance = bucket.carryoverCapHours
        ledger.push({
          id: `expire-${bucket.id}-${year}`,
          bucketId: bucket.id,
          type: 'expiration',
          date: `${year}-12-31`,
          hours: -lost,
          note: `Over ${bucket.carryoverCapHours}h carryover cap`,
          generated: true,
          balance,
        })
      }
      year++
    }

    let applied = event.hours
    let cappedHours: number | undefined

    // Only earned time is subject to the ceiling; usage always applies.
    if (applied > 0 && bucket.maxBalanceHours !== null) {
      const room = Math.max(0, bucket.maxBalanceHours - balance)
      if (applied > room) {
        cappedHours = applied - room
        applied = room
      }
    }

    balance += applied
    ledger.push({ ...event, balance, ...(cappedHours ? { cappedHours } : {}) })
  }

  return ledger
}

/** Accruals credit before usage on the same day, so a same-day spend is funded. */
function typeOrder(e: PtoEvent): number {
  return e.type === 'accrual' || e.type === 'grant' ? 0 : 1
}

export function balanceAsOf(
  bucket: BucketConfig,
  manualEvents: PtoEvent[],
  dateISO: string,
): number {
  const ledger = buildLedger(bucket, manualEvents, dateISO)
  return ledger.length ? ledger[ledger.length - 1].balance : 0
}

export interface ProjectionPoint {
  date: string
  balance: number
}

/** Month-end balance series from `fromISO` through `toISO`, for charting. */
export function projectBalance(
  bucket: BucketConfig,
  manualEvents: PtoEvent[],
  fromISO: string,
  throughISO: string,
): ProjectionPoint[] {
  const ledger = buildLedger(bucket, manualEvents, throughISO)
  const points: ProjectionPoint[] = []
  const end = parseDate(throughISO)
  let cursor = parseDate(fromISO)

  while (cursor <= end) {
    const monthEnd = endOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth())
    const cutoff = monthEnd > end ? end : monthEnd
    const iso = toISO(cutoff)
    const upTo = ledger.filter((e) => e.date <= iso)
    points.push({ date: iso, balance: upTo.length ? upTo[upTo.length - 1].balance : 0 })
    cursor = endOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1)
  }

  return points
}

export interface YearEndForecast {
  balanceAtYearEnd: number
  forfeitedHours: number
  /** Hours you'd need to burn before Dec 31 to avoid forfeiting any. */
  useOrLoseHours: number
}

export function forecastYearEnd(
  bucket: BucketConfig,
  manualEvents: PtoEvent[],
  year: number,
): YearEndForecast {
  const dec31 = `${year}-12-31`
  const ledger = buildLedger(bucket, manualEvents, dec31)
  const balance = ledger.length ? ledger[ledger.length - 1].balance : 0
  const cap = bucket.carryoverCapHours
  const forfeited = cap !== null && balance > cap ? balance - cap : 0
  return {
    balanceAtYearEnd: balance,
    forfeitedHours: forfeited,
    useOrLoseHours: forfeited,
  }
}

/** What an hour of PTO is worth, so balances can be shown in dollars. */
export function hourlyRate(annualSalary: number, hoursPerDay: number): number {
  return annualSalary / (260 * hoursPerDay)
}
