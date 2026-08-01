/**
 * US federal holidays, computed rather than tabulated.
 *
 * This matters for time off: a week that contains Thanksgiving costs four days
 * of PTO, not five. Every real time-off tracker knows this and every naive
 * weekday count gets it wrong — which is exactly the kind of error that shows
 * up as a phantom day you thought you had.
 *
 * Dates returned are *observed* dates. A holiday falling on Saturday is
 * observed the preceding Friday, one falling on Sunday the following Monday
 * (5 U.S.C. §6103(b)) — the observed date is the one the office is shut, so
 * it's the one that should not consume a vacation day.
 */

import { toISO } from './pto'

export interface Holiday {
  /** Observed date, ISO YYYY-MM-DD. */
  date: string
  name: string
  /** Set when the observed date differs from the statutory date. */
  observedFor?: string
}

/** The `n`th `weekday` of a month; `n = -1` means the last one. */
function nthWeekday(year: number, monthIndex: number, weekday: number, n: number): Date {
  if (n < 0) {
    const last = new Date(Date.UTC(year, monthIndex + 1, 0))
    const back = (last.getUTCDay() - weekday + 7) % 7
    last.setUTCDate(last.getUTCDate() - back)
    return last
  }
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const forward = (weekday - first.getUTCDay() + 7) % 7
  first.setUTCDate(1 + forward + (n - 1) * 7)
  return first
}

/** Weekend holidays are observed on the nearest weekday. */
function observe(d: Date): { date: Date; shifted: boolean } {
  const day = d.getUTCDay()
  if (day === 6) {
    const out = new Date(d)
    out.setUTCDate(out.getUTCDate() - 1)
    return { date: out, shifted: true }
  }
  if (day === 0) {
    const out = new Date(d)
    out.setUTCDate(out.getUTCDate() + 1)
    return { date: out, shifted: true }
  }
  return { date: d, shifted: false }
}

export function federalHolidays(year: number): Holiday[] {
  const fixed: [number, number, string][] = [
    [0, 1, "New Year's Day"],
    [5, 19, 'Juneteenth'],
    [6, 4, 'Independence Day'],
    [10, 11, 'Veterans Day'],
    [11, 25, 'Christmas Day'],
  ]
  const floating: [Date, string][] = [
    [nthWeekday(year, 0, 1, 3), 'Martin Luther King Jr. Day'],
    [nthWeekday(year, 1, 1, 3), "Presidents' Day"],
    [nthWeekday(year, 4, 1, -1), 'Memorial Day'],
    [nthWeekday(year, 8, 1, 1), 'Labor Day'],
    [nthWeekday(year, 9, 1, 2), 'Columbus Day'],
    [nthWeekday(year, 10, 4, 4), 'Thanksgiving'],
  ]

  const out: Holiday[] = []

  for (const [month, day, name] of fixed) {
    const statutory = new Date(Date.UTC(year, month, day))
    const { date, shifted } = observe(statutory)
    out.push({
      date: toISO(date),
      name,
      ...(shifted ? { observedFor: toISO(statutory) } : {}),
    })
  }
  // Floating holidays are defined as a weekday, so they never need observing.
  for (const [date, name] of floating) out.push({ date: toISO(date), name })

  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Observed-date lookup for a span of years, for fast membership tests. */
export function holidaySet(years: number[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const y of years) for (const h of federalHolidays(y)) map.set(h.date, h.name)
  return map
}
