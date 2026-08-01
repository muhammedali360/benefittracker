import { describe, expect, it } from 'vitest'
import { federalHolidays, holidaySet } from './holidays'
import { chargeableDays } from './pto'

const on = (year: number, name: string) =>
  federalHolidays(year).find((h) => h.name === name)

describe('federalHolidays', () => {
  it('returns all eleven federal holidays', () => {
    expect(federalHolidays(2026)).toHaveLength(11)
  })

  it('places floating holidays on the right weekday', () => {
    // 2026: MLK is the 3rd Monday of January = Jan 19.
    expect(on(2026, 'Martin Luther King Jr. Day')?.date).toBe('2026-01-19')
    // Thanksgiving is the 4th Thursday of November = Nov 26.
    expect(on(2026, 'Thanksgiving')?.date).toBe('2026-11-26')
  })

  it('uses the LAST Monday of May for Memorial Day, not the fourth', () => {
    // May 2026 has five Mondays; the 4th (May 25) happens to be the last, but
    // 2027 separates them: 4th Monday is May 24, last is May 31.
    expect(on(2027, 'Memorial Day')?.date).toBe('2027-05-31')
  })

  it('observes a Saturday holiday on the preceding Friday', () => {
    // July 4 2026 falls on a Saturday — observed Friday July 3.
    const july4 = on(2026, 'Independence Day')
    expect(july4?.date).toBe('2026-07-03')
    expect(july4?.observedFor).toBe('2026-07-04')
  })

  it('observes a Sunday holiday on the following Monday', () => {
    // Dec 25 2022 was a Sunday — observed Monday Dec 26.
    const xmas = on(2022, 'Christmas Day')
    expect(xmas?.date).toBe('2022-12-26')
    expect(xmas?.observedFor).toBe('2022-12-25')
  })

  it('leaves weekday holidays unshifted', () => {
    expect(on(2026, 'Juneteenth')).toEqual({ date: '2026-06-19', name: 'Juneteenth' })
  })

  it('comes back in date order', () => {
    const dates = federalHolidays(2026).map((h) => h.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('chargeableDays', () => {
  const holidays = holidaySet([2026])

  it('does not charge for a holiday inside the span', () => {
    // Thanksgiving week 2026: Mon Nov 23 – Fri Nov 27. Thu the 26th is a holiday.
    const week = chargeableDays('2026-11-23', '2026-11-27', holidays)
    expect(week.workdays).toBe(4)
    expect(week.holidays).toEqual([{ date: '2026-11-26', name: 'Thanksgiving' }])
    expect(week.weekendDays).toBe(0)
  })

  it('charges the full week when no holiday falls in it', () => {
    expect(chargeableDays('2026-03-02', '2026-03-06', holidays).workdays).toBe(5)
  })

  it('excludes weekends and counts them separately', () => {
    const span = chargeableDays('2026-03-02', '2026-03-08', holidays)
    expect(span.workdays).toBe(5)
    expect(span.weekendDays).toBe(2)
  })

  it('skips the observed date, not the statutory one', () => {
    // Independence Day 2026 is observed Friday July 3; July 4 is a Saturday.
    const span = chargeableDays('2026-06-29', '2026-07-03', holidays)
    expect(span.workdays).toBe(4)
    expect(span.holidays[0].date).toBe('2026-07-03')
  })

  it('charges every weekday when no holiday calendar is supplied', () => {
    expect(chargeableDays('2026-11-23', '2026-11-27').workdays).toBe(5)
  })
})
