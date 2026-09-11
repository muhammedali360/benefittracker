import { describe, it, expect } from 'vitest'
import {
  generateAccruals,
  buildLedger,
  balanceAsOf,
  projectBalance,
  forecastYearEnd,
  businessDayCount,
  inclusiveDayCount,
  hourlyRate,
  earliestAffordable,
  type BucketConfig,
  type PtoEvent,
} from './pto'

/** The user's real setup: 10 days/yr, accrued monthly, 8-hour days. */
const pto: BucketConfig = {
  id: 'pto',
  label: 'PTO',
  hoursPerDay: 8,
  accrualKind: 'monthly',
  annualDays: 10,
  accrualStart: '2026-01-01',
  maxBalanceHours: null,
  carryoverCapHours: null,
  color: '#4C7EF3',
}

const floating: BucketConfig = {
  ...pto,
  id: 'floating',
  label: 'Floating Holidays',
  accrualKind: 'none',
  annualDays: 0,
}

describe('monthly accrual', () => {
  it('credits 1/12 of the annual allotment at each month end', () => {
    const events = generateAccruals(pto, '2026-12-31')
    expect(events).toHaveLength(12)
    expect(events[0].date).toBe('2026-01-31')
    expect(events[11].date).toBe('2026-12-31')
    // 10 days x 8h = 80h/yr => 6.667h/month
    expect(events[0].hours).toBeCloseTo(80 / 12, 6)
  })

  it('does not credit a month that has not ended yet', () => {
    const events = generateAccruals(pto, '2026-08-15')
    expect(events).toHaveLength(7) // Jan–Jul
    expect(events.at(-1)!.date).toBe('2026-07-31')
  })

  it('accumulates to exactly the annual allotment over a full year', () => {
    expect(balanceAsOf(pto, [], '2026-12-31')).toBeCloseTo(80, 6)
  })
})

describe('lump-sum accrual', () => {
  it('grants the full allotment on Jan 1 of each year', () => {
    const lump: BucketConfig = { ...pto, accrualKind: 'lump' }
    const events = generateAccruals(lump, '2027-06-30')
    expect(events.map((e) => e.date)).toEqual(['2026-01-01', '2027-01-01'])
    expect(events[0].hours).toBe(80)
  })
})

describe('one-off grants and usage', () => {
  // A floating holiday awarded in July, exactly as the user described.
  const floater: PtoEvent = {
    id: 'f1',
    bucketId: 'floating',
    type: 'grant',
    date: '2026-07-15',
    hours: 8,
    note: 'Floating holiday',
  }

  it('treats a grant as an ordinary ledger event', () => {
    expect(balanceAsOf(floating, [floater], '2026-07-14')).toBe(0)
    expect(balanceAsOf(floating, [floater], '2026-07-15')).toBe(8)
  })

  it('subtracts usage from the running balance', () => {
    const usage: PtoEvent = {
      id: 'u1',
      bucketId: 'pto',
      type: 'usage',
      date: '2026-06-15',
      hours: -16,
      note: 'Long weekend',
    }
    // 6 months accrued (40h) minus 2 days taken
    expect(balanceAsOf(pto, [usage], '2026-06-30')).toBeCloseTo(80 / 12 * 6 - 16, 6)
  })

  it('funds same-day usage from that day\'s accrual', () => {
    const usage: PtoEvent = {
      id: 'u2',
      bucketId: 'pto',
      type: 'usage',
      date: '2026-01-31',
      hours: -6,
    }
    const ledger = buildLedger(pto, [usage], '2026-01-31')
    // Accrual is ordered before usage, so the balance never dips negative.
    expect(ledger[0].type).toBe('accrual')
    expect(ledger[1].balance).toBeCloseTo(80 / 12 - 6, 6)
  })

  it('allows a negative balance when usage outruns accrual', () => {
    const usage: PtoEvent = {
      id: 'u3',
      bucketId: 'pto',
      type: 'usage',
      date: '2026-02-01',
      hours: -40,
    }
    expect(balanceAsOf(pto, [usage], '2026-02-01')).toBeCloseTo(80 / 12 - 40, 6)
  })
})

describe('balance ceiling', () => {
  it('stops accruing once the cap is reached and records the loss', () => {
    const capped: BucketConfig = { ...pto, maxBalanceHours: 20 }
    const ledger = buildLedger(capped, [], '2026-12-31')
    expect(ledger.at(-1)!.balance).toBe(20)
    expect(ledger.some((e) => e.cappedHours)).toBe(true)
  })

  it('resumes accruing after usage frees up room under the cap', () => {
    const capped: BucketConfig = { ...pto, maxBalanceHours: 20 }
    const usage: PtoEvent = {
      id: 'u4',
      bucketId: 'pto',
      type: 'usage',
      date: '2026-05-01',
      hours: -20,
    }
    // Without the usage the balance would sit pinned at 20 all year.
    expect(balanceAsOf(capped, [usage], '2026-12-31')).toBeGreaterThan(0)
    expect(balanceAsOf(capped, [usage], '2026-12-31')).toBeLessThanOrEqual(20)
  })
})

describe('year-end carryover', () => {
  const withCap: BucketConfig = { ...pto, carryoverCapHours: 40 }

  it('forfeits hours above the cap when the year rolls over', () => {
    const ledger = buildLedger(withCap, [], '2027-01-31')
    const expiry = ledger.find((e) => e.type === 'expiration')
    expect(expiry).toBeDefined()
    expect(expiry!.date).toBe('2026-12-31')
    // 80h accrued, 40h cap => 40h lost
    expect(expiry!.hours).toBeCloseTo(-40, 6)
  })

  it('forecasts the forfeiture before it happens', () => {
    const f = forecastYearEnd(withCap, [], 2026)
    expect(f.balanceAtYearEnd).toBeCloseTo(80, 6)
    expect(f.forfeitedHours).toBeCloseTo(40, 6)
  })

  it('reports no forfeiture when time is used first', () => {
    const usage: PtoEvent = {
      id: 'u5',
      bucketId: 'pto',
      type: 'usage',
      date: '2026-11-20',
      hours: -40,
    }
    expect(forecastYearEnd(withCap, [usage], 2026).forfeitedHours).toBe(0)
  })

  it('carries nothing over when there is no cap', () => {
    expect(forecastYearEnd(pto, [], 2026).forfeitedHours).toBe(0)
    expect(balanceAsOf(pto, [], '2027-12-31')).toBeCloseTo(160, 6)
  })
})

describe('projection', () => {
  it('produces a month-end balance series', () => {
    const points = projectBalance(pto, [], '2026-01-01', '2026-12-31')
    expect(points).toHaveLength(12)
    expect(points[0].balance).toBeCloseTo(80 / 12, 6)
    expect(points.at(-1)!.balance).toBeCloseTo(80, 6)
  })

  it('reflects planned future time off in the projection', () => {
    const planned: PtoEvent = {
      id: 'p1',
      bucketId: 'pto',
      type: 'usage',
      date: '2026-11-23',
      hours: -24,
      note: 'Thanksgiving trip',
    }
    const points = projectBalance(pto, [planned], '2026-01-01', '2026-12-31')
    expect(points.at(-1)!.balance).toBeCloseTo(80 - 24, 6)
  })
})

describe('day counting', () => {
  it('counts only weekdays for a span crossing a weekend', () => {
    // Mon 2026-11-23 .. Fri 2026-11-27
    expect(businessDayCount('2026-11-23', '2026-11-27')).toBe(5)
    // Adding Sat+Sun adds no chargeable days
    expect(businessDayCount('2026-11-23', '2026-11-29')).toBe(5)
    expect(inclusiveDayCount('2026-11-23', '2026-11-29')).toBe(7)
  })

  it('counts a single weekday as one day', () => {
    expect(businessDayCount('2026-11-23', '2026-11-23')).toBe(1)
  })
})

describe('dollar value of time', () => {
  it('prices an hour off a 260-day work year', () => {
    expect(hourlyRate(104_000, 8)).toBeCloseTo(50, 6)
    // A full 10-day balance is worth two weeks of salary.
    expect(hourlyRate(104_000, 8) * 80).toBeCloseTo(4_000, 6)
  })
})

describe('earliestAffordable', () => {
  it('answers "today" when the balance already covers it', () => {
    // 10 days/yr accrued monthly: by Dec 31 the balance is a full 10 days.
    const r = earliestAffordable([pto], [], 5, '2026-12-31', '2027-12-31')
    expect(r?.date).toBe('2026-12-31')
    expect(r?.shortfallToday).toBe(0)
  })

  it('finds the accrual date the balance finally covers the request', () => {
    // Monthly accrual is 6.67h; four days = 32h needs five months of accrual.
    const r = earliestAffordable([pto], [], 4, '2026-01-01', '2026-12-31')
    expect(r?.date).toBe('2026-05-31')
    expect(r!.daysAvailable).toBeGreaterThanOrEqual(4)
    expect(r?.shortfallToday).toBeCloseTo(4, 6)
  })

  it('sums across buckets in days, not hours', () => {
    // A grant in the floating bucket brings the affordable date forward.
    const grant: PtoEvent = {
      id: 'g', bucketId: 'floating', type: 'grant', date: '2026-02-01', hours: 16,
    }
    const alone = earliestAffordable([pto], [grant], 4, '2026-01-01', '2026-12-31')
    const both = earliestAffordable([pto, floating], [grant], 4, '2026-01-01', '2026-12-31')
    expect(both!.date < alone!.date).toBe(true)
  })

  it('accounts for time already booked later in the year', () => {
    const booked: PtoEvent = {
      id: 'u', bucketId: 'pto', type: 'usage', date: '2026-06-15', hours: -40,
    }
    const clean = earliestAffordable([pto], [], 5, '2026-01-01', '2026-12-31')
    const spent = earliestAffordable([pto], [booked], 5, '2026-01-01', '2026-12-31')
    // Spending 5 days in June pushes the next 5-day trip out — or off the year.
    expect(spent === null || spent.date > clean!.date).toBe(true)
  })

  it('returns null when the horizon never gets there', () => {
    expect(earliestAffordable([pto], [], 40, '2026-01-01', '2026-12-31')).toBeNull()
  })

  it('refuses to answer a request for no time off', () => {
    expect(earliestAffordable([pto], [], 0, '2026-01-01', '2026-12-31')).toBeNull()
    expect(earliestAffordable([], [], 5, '2026-01-01', '2026-12-31')).toBeNull()
  })
})

describe('per-paycheck accrual follows the pay cadence', () => {
  const base: BucketConfig = {
    id: 'pp',
    label: 'PTO',
    hoursPerDay: 8,
    accrualKind: 'per-paycheck',
    annualDays: 13,
    accrualStart: '2026-01-01',
    maxBalanceHours: null,
    carryoverCapHours: null,
    color: '#000',
  }

  it('defaults to biweekly', () => {
    const events = generateAccruals(base, '2026-12-31')
    expect(events).toHaveLength(26)
    expect(events[0].hours).toBeCloseTo(4)
  })

  it('credits 52 smaller accruals for a weekly earner', () => {
    const events = generateAccruals({ ...base, payFrequency: 'weekly' }, '2026-12-31')
    expect(events).toHaveLength(52)
    expect(events[0].hours).toBeCloseTo(2)
  })

  it('lands semimonthly accruals on the 15th and month end', () => {
    const events = generateAccruals({ ...base, payFrequency: 'semimonthly' }, '2026-03-31')
    expect(events.map((e) => e.date)).toEqual([
      '2026-01-15',
      '2026-01-31',
      '2026-02-15',
      '2026-02-28',
      '2026-03-15',
      '2026-03-31',
    ])
  })

  it('anchors biweekly accruals on a known payday', () => {
    const events = generateAccruals(
      { ...base, payFrequency: 'biweekly', payAnchor: '2026-01-09' },
      '2026-02-28',
    )
    expect(events.map((e) => e.date)).toEqual(['2026-01-09', '2026-01-23', '2026-02-06', '2026-02-20'])
  })

  it('sums to the annual allotment whatever the cadence', () => {
    for (const payFrequency of ['weekly', 'biweekly', 'semimonthly', 'monthly'] as const) {
      const total = generateAccruals({ ...base, payFrequency }, '2026-12-31').reduce(
        (a, e) => a + e.hours,
        0,
      )
      expect(total).toBeCloseTo(13 * 8)
    }
  })
})
