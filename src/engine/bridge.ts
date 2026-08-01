/**
 * Bridge days.
 *
 * A holiday on a Thursday is worth more than a holiday on a Wednesday, because
 * one PTO day on the Friday buys a four-day weekend. That arbitrage is the
 * reason a holiday calendar is worth having at all: on its own it only stops
 * the app charging you for Thanksgiving, which is arithmetic. Here it tells you
 * where to spend the balance you're about to forfeit.
 *
 * Everything is a pure function of the year, so the suggestions are stable and
 * testable — affordability is layered on by the caller, which knows the ledger.
 */

import { federalHolidays, type Holiday } from './holidays'
import { parseDate, toISO } from './pto'

export interface BridgePlan {
  /** Holidays the run is built around. */
  holidays: Holiday[]
  /** Workdays that must actually be booked. */
  bookDates: string[]
  ptoDays: number
  /** First and last day of the resulting consecutive run. */
  start: string
  end: string
  /** Consecutive days off, including weekends and the holidays. */
  totalDaysOff: number
  /** Days off bought per PTO day spent. Higher is better. */
  leverage: number
}

const DAY = 86_400_000

/** Longest calendar window considered. Beyond ~2.5 weeks it stops being a bridge. */
const MAX_WINDOW_DAYS = 18

/**
 * Every run of consecutive days off that can be built around a holiday, ranked
 * by how many days off each booked PTO day buys.
 *
 * `maxPtoDays` bounds the search to plans a person would plausibly book — the
 * whole appeal is spending two days to get nine, not spending nine to get
 * eleven.
 */
export function bridgeOpportunities(
  year: number,
  { maxPtoDays = 5, fromISO }: { maxPtoDays?: number; fromISO?: string } = {},
): BridgePlan[] {
  // Adjacent years are included so a run spanning New Year is scored correctly.
  const holidays = [
    ...federalHolidays(year - 1),
    ...federalHolidays(year),
    ...federalHolidays(year + 1),
  ]
  const byDate = new Map(holidays.map((h) => [h.date, h]))

  const start = Date.UTC(year, 0, 1)
  const end = Date.UTC(year, 11, 31)
  const days: { iso: string; ms: number; off: boolean }[] = []
  // Pad either side so runs that spill over a year boundary still expand fully.
  for (let ms = start - 20 * DAY; ms <= end + 20 * DAY; ms += DAY) {
    const d = new Date(ms)
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
    const iso = toISO(d)
    days.push({ iso, ms, off: weekend || byDate.has(iso) })
  }

  const indexOf = new Map(days.map((d, i) => [d.iso, i]))
  const firstInYear = indexOf.get(toISO(new Date(start)))!
  const lastInYear = indexOf.get(toISO(new Date(end)))!
  const minIdx = fromISO ? (indexOf.get(fromISO) ?? firstInYear) : firstInYear

  // Best plan per resulting run, keyed by the run itself — two windows that
  // produce the same time off are the same plan, and the cheaper one wins.
  const best = new Map<string, BridgePlan>()

  for (let s = minIdx; s <= lastInYear; s++) {
    // A window that opens on a day already off is just a shifted version of a
    // shorter one; skipping them keeps the candidate set honest.
    if (days[s].off) continue

    const bookDates: string[] = []
    for (let e = s; e < Math.min(s + MAX_WINDOW_DAYS, days.length); e++) {
      if (!days[e].off) bookDates.push(days[e].iso)
      if (bookDates.length > maxPtoDays) break
      // The window must end on a booked day for the same reason it must start
      // on one, and it has to actually buy a holiday to count as a bridge.
      if (days[e].off) continue

      let runStart = s
      let runEnd = e
      while (runStart > 0 && days[runStart - 1].off) runStart--
      while (runEnd < days.length - 1 && days[runEnd + 1].off) runEnd++

      const used: Holiday[] = []
      for (let i = runStart; i <= runEnd; i++) {
        const h = byDate.get(days[i].iso)
        if (h) used.push(h)
      }
      if (used.length === 0) continue

      const totalDaysOff = runEnd - runStart + 1
      const plan: BridgePlan = {
        holidays: used,
        bookDates: [...bookDates],
        ptoDays: bookDates.length,
        start: days[runStart].iso,
        end: days[runEnd].iso,
        totalDaysOff,
        leverage: totalDaysOff / bookDates.length,
      }

      const key = `${plan.start}:${plan.end}`
      const incumbent = best.get(key)
      if (!incumbent || plan.ptoDays < incumbent.ptoDays) best.set(key, plan)
    }
  }

  return [...best.values()]
    .filter((p) => p.leverage > 1 && p.start <= toISO(new Date(end)))
    .sort(
      (a, b) =>
        b.leverage - a.leverage || a.ptoDays - b.ptoDays || (a.start < b.start ? -1 : 1),
    )
}

/**
 * The best plan around each holiday, so a ranked list doesn't return eleven
 * variations on Thanksgiving before mentioning Memorial Day.
 */
export function bestBridgePerHoliday(
  year: number,
  opts: { maxPtoDays?: number; fromISO?: string } = {},
): BridgePlan[] {
  const seen = new Set<string>()
  const out: BridgePlan[] = []
  for (const plan of bridgeOpportunities(year, opts)) {
    // Claim every holiday the run covers — a plan spanning two of them
    // shouldn't leave the second one to be re-suggested on its own.
    if (plan.holidays.every((h) => seen.has(h.date))) continue
    for (const h of plan.holidays) seen.add(h.date)
    out.push(plan)
  }
  return out
}

/** Calendar days between two ISO dates, inclusive. */
export function spanDays(startISO: string, endISO: string): number {
  return Math.round((parseDate(endISO).getTime() - parseDate(startISO).getTime()) / DAY) + 1
}
