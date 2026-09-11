/**
 * Pay dates for a year. Weekly/biweekly step from an anchor; semimonthly and
 * monthly are calendar-driven. Lives on its own so both the paycheck engine
 * and the timeline can name the same real dates without importing each other.
 */

import { PERIODS_PER_YEAR, type PayFrequency } from './payFrequency'
import { toISO } from './dates'

export function payDates(
  profile: { year: number; payFrequency: PayFrequency },
  anchorISO?: string,
): string[] {
  const { year, payFrequency } = profile
  const out: string[] = []

  if (payFrequency === 'monthly') {
    for (let m = 0; m < 12; m++) out.push(toISO(new Date(Date.UTC(year, m + 1, 0))))
    return out
  }

  if (payFrequency === 'semimonthly') {
    for (let m = 0; m < 12; m++) {
      out.push(toISO(new Date(Date.UTC(year, m, 15))))
      out.push(toISO(new Date(Date.UTC(year, m + 1, 0))))
    }
    return out
  }

  const step = payFrequency === 'weekly' ? 7 : 14
  const cursor = anchorISO ? new Date(`${anchorISO}T00:00:00Z`) : firstFriday(year)
  // An anchor from another year is walked into this one rather than rejected,
  // so a saved hire-date anchor keeps working as the years roll over.
  while (cursor.getUTCFullYear() < year) cursor.setUTCDate(cursor.getUTCDate() + step)
  const periods = PERIODS_PER_YEAR[payFrequency]
  for (let i = 0; i < periods; i++) {
    out.push(toISO(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + step)
  }
  return out
}

function firstFriday(year: number): Date {
  const d = new Date(Date.UTC(year, 0, 1))
  d.setUTCDate(1 + ((5 - d.getUTCDay() + 7) % 7))
  return d
}
