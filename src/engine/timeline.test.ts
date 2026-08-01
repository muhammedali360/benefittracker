import { describe, expect, it } from 'vitest'
import { payDates, payTimeline, summariseTimeline } from './timeline'
import { computePaycheck, type CompProfile } from './tax'
import { getTaxYear } from './taxData'

const base: CompProfile = {
  annualSalary: 120_000,
  filingStatus: 'single',
  state: 'CA',
  payFrequency: 'biweekly',
  year: 2026,
  retirement401kPercent: 0,
  hsaAnnual: 0,
  fsaAnnual: 0,
  premiumsAnnual: 0,
  employerMatchPercent: 0,
  employerMatchLimitPercent: 0,
}

const sum = (ps: { net: number }[]) => ps.reduce((a, p) => a + p.net, 0)

describe('payDates', () => {
  it('produces the right number of dates per frequency', () => {
    expect(payDates({ ...base, payFrequency: 'weekly' })).toHaveLength(52)
    expect(payDates({ ...base, payFrequency: 'biweekly' })).toHaveLength(26)
    expect(payDates({ ...base, payFrequency: 'semimonthly' })).toHaveLength(24)
    expect(payDates({ ...base, payFrequency: 'monthly' })).toHaveLength(12)
  })

  it('pays semimonthly on the 15th and the last day of the month', () => {
    const dates = payDates({ ...base, payFrequency: 'semimonthly' })
    expect(dates[0]).toBe('2026-01-15')
    expect(dates[1]).toBe('2026-01-31')
    // February's last day, not a hardcoded 30/31.
    expect(dates[3]).toBe('2026-02-28')
  })

  it('walks an anchor from a previous year forward into this one', () => {
    const dates = payDates(base, '2024-01-05')
    expect(dates[0].startsWith('2026-')).toBe(true)
    expect(dates).toHaveLength(26)
  })
})

describe('payTimeline', () => {
  it('is empty without a salary', () => {
    expect(payTimeline({ ...base, annualSalary: 0 })).toEqual([])
  })

  it('reconciles to the annual take-home', () => {
    const annual = computePaycheck(base)
    const periods = payTimeline(base)
    expect(sum(periods)).toBeCloseTo(annual.net, 4)
    expect(periods[periods.length - 1].cumulativeNet).toBeCloseTo(annual.net, 4)
  })

  it('reconciles with pre-tax deductions and a 401(k) in play', () => {
    const profile = {
      ...base,
      annualSalary: 180_000,
      retirement401kPercent: 0.08,
      hsaAnnual: 4_400,
      premiumsAnnual: 3_000,
    }
    expect(sum(payTimeline(profile))).toBeCloseTo(computePaycheck(profile).net, 4)
  })

  it('leaves every paycheck identical when nothing steps', () => {
    const nets = new Set(payTimeline(base).map((p) => Math.round(p.net * 100)))
    expect(nets.size).toBe(1)
    expect(summariseTimeline(payTimeline(base)).spread).toBeCloseTo(0, 6)
  })

  it('stops Social Security once the wage base is crossed, making later checks bigger', () => {
    const rich = { ...base, annualSalary: 400_000 }
    const periods = payTimeline(rich)
    const wageBase = getTaxYear(2026).federal.socialSecurity.wageBase

    expect(periods[0].socialSecurity).toBeGreaterThan(0)
    expect(periods[periods.length - 1].socialSecurity).toBe(0)
    // Total SS withheld is exactly the base times the rate — no more, no less.
    const totalSS = periods.reduce((a, p) => a + p.socialSecurity, 0)
    expect(totalSS).toBeCloseTo(wageBase * 0.062, 4)
    // Which is the whole point: take-home rises partway through the year.
    expect(periods[periods.length - 1].net).toBeGreaterThan(periods[0].net)
    expect(periods.some((p) => p.event === 'ss-cap')).toBe(true)
  })

  it('caps the 401(k) deferral at the annual limit and flags the check it happens on', () => {
    const heavy = { ...base, annualSalary: 200_000, retirement401kPercent: 0.3 }
    const limit = getTaxYear(2026).limits.elective401k
    const periods = payTimeline(heavy)

    expect(periods[periods.length - 1].cumulativeRetirement).toBeCloseTo(limit, 4)
    expect(periods[periods.length - 1].retirement).toBe(0)
    const capped = periods.find((p) => p.event === 'deferral-cap')
    expect(capped).toBeDefined()
    expect(capped!.index).toBeLessThan(26)
  })

  it('stops the employer match with the deferral, and quantifies what is lost', () => {
    const heavy = {
      ...base,
      annualSalary: 200_000,
      retirement401kPercent: 0.3,
      employerMatchPercent: 0.5,
      employerMatchLimitPercent: 0.06,
    }
    const s = summariseTimeline(payTimeline(heavy))
    expect(s.forfeitedMatch).toBeGreaterThan(0)
    // Spreading the same money across the year forfeits nothing.
    const spread = summariseTimeline(payTimeline({ ...heavy, retirement401kPercent: 0.12 }))
    expect(spread.forfeitedMatch).toBeCloseTo(0, 6)
    expect(spread.totalMatch).toBeGreaterThan(s.totalMatch)
  })

  it('withholds the Medicare surtax only after cumulative wages cross the threshold', () => {
    const periods = payTimeline({ ...base, annualSalary: 300_000 })
    expect(periods[0].additionalMedicare).toBe(0)
    expect(periods[periods.length - 1].additionalMedicare).toBeGreaterThan(0)
    const total = periods.reduce((a, p) => a + p.additionalMedicare, 0)
    expect(total).toBeCloseTo((300_000 - 200_000) * 0.009, 4)
  })

  it('keeps CA SDI running all year, because it is uncapped', () => {
    const periods = payTimeline({ ...base, annualSalary: 400_000 })
    expect(periods[periods.length - 1].disability).toBeCloseTo(periods[0].disability, 6)
  })
})

describe('summariseTimeline', () => {
  it('handles an empty year without inventing numbers', () => {
    const s = summariseTimeline([])
    expect(s.smallest).toBeNull()
    expect(s.spread).toBe(0)
    expect(s.totalNet).toBe(0)
  })
})
