import { describe, expect, it } from 'vitest'
import { contributionHeadroom, deferralPacing } from './contributions'
import { computeBonus, compareProfiles, computePaycheck, type CompProfile } from './tax'
import { getTaxYear } from './taxData'

const base: CompProfile = {
  annualSalary: 150_000,
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
const limits = getTaxYear(2026).limits

describe('deferralPacing', () => {
  it('reports nothing to pace at a zero rate', () => {
    const p = deferralPacing(base)
    expect(p.status).toBe('none')
    expect(p.forfeitedMatch).toBe(0)
  })

  it('solves for the rate that spends the limit on the last paycheck', () => {
    const p = deferralPacing(base)
    expect(p.idealPercent).toBeCloseTo(limits.elective401k / 150_000, 10)
    // Adopting it puts the plan on target and forfeits nothing.
    const adopted = deferralPacing({ ...base, retirement401kPercent: p.idealPercent })
    expect(adopted.status).toBe('on-target')
    expect(adopted.limitPeriod).toBe(26)
    expect(adopted.forfeitedMatch).toBe(0)
  })

  it('never suggests deferring more than 100% of pay', () => {
    expect(deferralPacing({ ...base, annualSalary: 20_000 }).idealPercent).toBe(1)
  })

  it('flags a front-loaded rate and prices the match it costs', () => {
    const p = deferralPacing({
      ...base,
      retirement401kPercent: 0.4,
      employerMatchPercent: 0.5,
      employerMatchLimitPercent: 0.06,
    })
    expect(p.status).toBe('front-loaded')
    expect(p.limitPeriod).toBeLessThan(26)
    expect(p.forfeitedMatch).toBeGreaterThan(0)
  })

  it('calls a rate that leaves the limit unused under-limit', () => {
    expect(deferralPacing({ ...base, retirement401kPercent: 0.03 }).status).toBe('under-limit')
  })
})

describe('contributionHeadroom', () => {
  it('prices headroom in take-home, not in gross', () => {
    const hsa = contributionHeadroom(base).find((h) => h.key === 'hsa')!
    expect(hsa.headroom).toBe(limits.hsaSelfOnly)
    // The saving is real but partial: cost is strictly between zero and gross.
    expect(hsa.netCost).toBeGreaterThan(0)
    expect(hsa.netCost).toBeLessThan(hsa.headroom)
    expect(hsa.taxSaved + hsa.netCost).toBeCloseTo(hsa.headroom, 6)
  })

  it('makes a cafeteria-plan dollar cheaper than a 401(k) dollar', () => {
    const [k, hsa] = contributionHeadroom(base)
    // Same income-tax saving, but the HSA also dodges FICA.
    expect(hsa.taxSaved / hsa.headroom).toBeGreaterThan(k.taxSaved / k.headroom)
    expect(hsa.ficaExempt).toBe(true)
    expect(k.ficaExempt).toBe(false)
  })

  it('reports zero headroom once an account is maxed', () => {
    const maxed = contributionHeadroom({ ...base, fsaAnnual: limits.fsaHealth })
    const fsa = maxed.find((h) => h.key === 'fsa')!
    expect(fsa.headroom).toBe(0)
    expect(fsa.netCost).toBe(0)
  })

  it('switches to the family limit on request', () => {
    const family = contributionHeadroom(base, undefined, true).find((h) => h.key === 'hsa')!
    expect(family.limit).toBe(limits.hsaFamily)
    expect(family.label).toContain('family')
  })

  it('measures 401(k) headroom against the capped deferral, not the raw election', () => {
    // 30% of $150k is $45k, well over the limit — headroom must be zero, not negative.
    const k = contributionHeadroom({ ...base, retirement401kPercent: 0.3 })[0]
    expect(k.elected).toBe(limits.elective401k)
    expect(k.headroom).toBe(0)
  })
})

describe('elective deferral cap', () => {
  it('shelters only up to the §402(g) limit', () => {
    const heavy = computePaycheck({ ...base, retirement401kPercent: 0.5 })
    expect(heavy.retirement).toBe(limits.elective401k)
    // The unshelterable remainder is taxed and lands in take-home.
    const none = computePaycheck(base)
    expect(heavy.net).toBeCloseTo(none.net - limits.elective401k + (none.totalTax - heavy.totalTax), 4)
  })
})

describe('computeBonus', () => {
  const fed = getTaxYear(2026).federal.supplemental

  it('returns zeroes for a zero bonus rather than dividing by it', () => {
    const b = computeBonus(base, 0)
    expect(b.net).toBe(0)
    expect(b.keepRate).toBe(0)
  })

  it('withholds federal at the flat supplemental rate, not the bracket rate', () => {
    const b = computeBonus(base, 20_000)
    expect(b.federalWithheld).toBeCloseTo(20_000 * fed.rate, 4)
    // The bracket rate at $150k is 24% — so 22% under-withholds.
    expect(b.withholdingGap).toBeLessThan(0)
  })

  it('applies the higher rate only to the excess over $1M', () => {
    const b = computeBonus(base, 1_500_000)
    const expected = fed.threshold * fed.rate + 500_000 * fed.rateAboveThreshold
    expect(b.federalWithheld).toBeCloseTo(expected, 4)
  })

  it('over-withholds for a low earner, who gets it back', () => {
    // At $40k the marginal bracket is 12% federal, well under the 22% withheld.
    expect(computeBonus({ ...base, annualSalary: 40_000 }, 5_000).withholdingGap).toBeGreaterThan(0)
  })

  it('charges Social Security only on wages still under the base', () => {
    const rich = { ...base, annualSalary: 400_000 }
    expect(computeBonus(rich, 50_000).socialSecurity).toBe(0)
    expect(computeBonus(base, 50_000).socialSecurity).toBeGreaterThan(0)
  })

  it('keeps CA SDI on the whole bonus, since it is uncapped', () => {
    const b = computeBonus({ ...base, annualSalary: 400_000 }, 50_000)
    expect(b.disability).toBeCloseTo(50_000 * 0.013, 4)
  })

  it('charges no state withholding in a state without an income tax', () => {
    expect(computeBonus({ ...base, state: 'TX' }, 20_000).stateWithheld).toBe(0)
  })

  it('shares the 401(k) limit with payroll deferrals', () => {
    const nearlyMaxed = { ...base, retirement401kPercent: limits.elective401k / 150_000 }
    expect(computeBonus(nearlyMaxed, 50_000, undefined, 0.5).retirement).toBeCloseTo(0, 6)
    expect(computeBonus(base, 50_000, undefined, 0.1).retirement).toBeCloseTo(5_000, 6)
  })

  it('reconciles: gross = deferral + withholding + net', () => {
    const b = computeBonus(base, 25_000, undefined, 0.05)
    expect(b.retirement + b.totalWithheld + b.net).toBeCloseTo(b.gross, 6)
    expect(b.keepRate).toBeCloseTo(b.net / b.gross, 10)
  })
})

describe('compareProfiles', () => {
  it('shows how little of a raise survives', () => {
    const d = compareProfiles(base, { ...base, annualSalary: 170_000 })
    expect(d.grossDelta).toBe(20_000)
    expect(d.netDelta).toBeGreaterThan(0)
    expect(d.netDelta).toBeLessThan(d.grossDelta)
    expect(d.keepRate).toBeCloseTo(d.netDelta / d.grossDelta, 10)
    expect(d.keepRate).toBeLessThan(1)
  })

  it('values a move to a no-income-tax state at the same salary', () => {
    const d = compareProfiles(base, { ...base, state: 'TX' })
    expect(d.grossDelta).toBe(0)
    expect(d.netDelta).toBeGreaterThan(0)
    // No gross changed, so a keep rate would be meaningless — not Infinity.
    expect(d.keepRate).toBe(0)
  })

  it('counts employer match as value received, not just take-home', () => {
    const d = compareProfiles(base, {
      ...base,
      retirement401kPercent: 0.06,
      employerMatchPercent: 0.5,
      employerMatchLimitPercent: 0.06,
    })
    // Deferring cuts take-home but the match more than offsets it.
    expect(d.netDelta).toBeLessThan(0)
    expect(d.matchDelta).toBeGreaterThan(0)
    expect(d.totalValueDelta).toBeGreaterThan(d.netDelta)
  })
})
