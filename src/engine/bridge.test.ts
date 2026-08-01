import { describe, expect, it } from 'vitest'
import { bestBridgePerHoliday, bridgeOpportunities, spanDays } from './bridge'
import { federalHolidays } from './holidays'

describe('bridgeOpportunities', () => {
  const plans = bridgeOpportunities(2026)

  it('only proposes plans that buy more days off than they cost', () => {
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) {
      expect(p.ptoDays).toBeGreaterThan(0)
      expect(p.leverage).toBeGreaterThan(1)
      expect(p.totalDaysOff).toBe(spanDays(p.start, p.end))
    }
  })

  it('never proposes booking a weekend or a holiday', () => {
    const holidayDates = new Set(federalHolidays(2026).map((h) => h.date))
    for (const p of plans) {
      for (const iso of p.bookDates) {
        const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
        expect(day).not.toBe(0)
        expect(day).not.toBe(6)
        expect(holidayDates.has(iso)).toBe(false)
      }
    }
  })

  it('finds the Veterans Day bridge: Wed holiday, so 2 days buys 5 off', () => {
    // Nov 11 2026 is a Wednesday. Booking Mon 9 + Tue 10 runs Sat 7 – Wed 11;
    // booking Thu 12 + Fri 13 runs Wed 11 – Sun 15. Either is 5 days for 2.
    const vets = plans.filter((p) => p.holidays.some((h) => h.date === '2026-11-11'))
    const twoDay = vets.find((p) => p.ptoDays === 2)
    expect(twoDay).toBeDefined()
    expect(twoDay!.totalDaysOff).toBe(5)
  })

  it('finds the Thanksgiving bridge: 1 day buys a 4-day weekend', () => {
    // Thanksgiving 2026 is Thu Nov 26; booking Fri Nov 27 runs Thu – Sun.
    const plan = plans.find(
      (p) => p.bookDates.length === 1 && p.bookDates[0] === '2026-11-27',
    )
    expect(plan).toBeDefined()
    expect(plan!.totalDaysOff).toBe(4)
    expect(plan!.leverage).toBe(4)
  })

  it('handles a Saturday holiday via its observed Friday', () => {
    // Jul 4 2026 is a Saturday, observed Fri Jul 3 — so Jul 3 is already off
    // and must never appear as a day to book.
    expect(plans.some((p) => p.bookDates.includes('2026-07-03'))).toBe(false)
    const july = plans.filter((p) => p.holidays.some((h) => h.date === '2026-07-03'))
    expect(july.length).toBeGreaterThan(0)
  })

  it('ranks by leverage, best first', () => {
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].leverage).toBeGreaterThanOrEqual(plans[i].leverage)
    }
  })

  it('respects the PTO ceiling', () => {
    for (const p of bridgeOpportunities(2026, { maxPtoDays: 2 })) {
      expect(p.ptoDays).toBeLessThanOrEqual(2)
    }
  })

  it('drops plans that start before the cutoff date', () => {
    const late = bridgeOpportunities(2026, { fromISO: '2026-10-01' })
    expect(late.length).toBeGreaterThan(0)
    for (const p of late) expect(p.end >= '2026-10-01').toBe(true)
    expect(late.some((p) => p.holidays.some((h) => h.date === '2026-05-25'))).toBe(false)
  })
})

describe('bestBridgePerHoliday', () => {
  const best = bestBridgePerHoliday(2026)

  it('does not return eleven variations on the same holiday', () => {
    const claimed = best.flatMap((p) => p.holidays.map((h) => h.date))
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('covers holidays across the whole year, not just the best-leveraged one', () => {
    const months = new Set(best.map((p) => p.start.slice(5, 7)))
    expect(months.size).toBeGreaterThan(4)
  })

  it('still leads with the strongest plan', () => {
    expect(best[0].leverage).toBe(bridgeOpportunities(2026)[0].leverage)
  })
})
