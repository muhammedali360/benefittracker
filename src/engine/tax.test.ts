import { describe, it, expect } from 'vitest'
import {
  computePaycheck,
  taxFromBrackets,
  socialSecurityCutoff,
  matchForfeitureRisk,
  type CompProfile,
} from './tax'
import { getTaxYear } from './taxData'
import { payDates } from './payDates'

const base: CompProfile = {
  annualSalary: 100_000,
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

describe('taxFromBrackets', () => {
  const brackets = [
    { rate: 0.1, from: 0, to: 100 },
    { rate: 0.2, from: 100, to: 200 },
    { rate: 0.3, from: 200, to: null },
  ]

  it('taxes only the portion inside each bracket', () => {
    expect(taxFromBrackets(50, brackets)).toBeCloseTo(5)
    expect(taxFromBrackets(150, brackets)).toBeCloseTo(10 + 10)
    expect(taxFromBrackets(300, brackets)).toBeCloseTo(10 + 20 + 30)
  })

  it('returns zero at or below zero income', () => {
    expect(taxFromBrackets(0, brackets)).toBe(0)
    expect(taxFromBrackets(-500, brackets)).toBe(0)
  })
})

describe('computePaycheck — $100k single in CA', () => {
  const r = computePaycheck(base)

  it('computes federal tax off income after the standard deduction', () => {
    // 100,000 - 16,100 std ded = 83,900 taxable
    expect(r.federalTaxable).toBe(83_900)
    // 12,400@10% + 38,000@12% + 33,500@22%
    expect(r.federalIncomeTax).toBeCloseTo(13_170, 2)
  })

  it('applies CA brackets and subtracts the exemption credit', () => {
    expect(r.stateTaxable).toBe(94_294)
    // 5,207.98 of bracket tax less the $153 personal exemption credit
    expect(r.stateIncomeTax).toBeCloseTo(5_054.98, 2)
  })

  it('computes FICA and uncapped CA SDI', () => {
    expect(r.socialSecurity).toBeCloseTo(6_200, 2)
    expect(r.medicare).toBeCloseTo(1_450, 2)
    expect(r.additionalMedicare).toBe(0)
    expect(r.disabilityInsurance).toBeCloseTo(1_300, 2)
  })

  it('nets out to gross minus total tax', () => {
    expect(r.totalTax).toBeCloseTo(27_174.98, 2)
    expect(r.net).toBeCloseTo(72_825.02, 2)
    expect(r.effectiveRate).toBeCloseTo(0.2717, 3)
  })

  it('splits the year into the right number of paychecks', () => {
    expect(r.periodsPerYear).toBe(26)
    const takeHome = r.lineItems.find((l) => l.kind === 'net')!
    expect(takeHome.perPeriod).toBeCloseTo(72_825.02 / 26, 2)
  })
})

describe('pre-tax deduction handling', () => {
  it('exempts HSA/FSA/premiums from FICA but not 401(k)', () => {
    const withHsa = computePaycheck({ ...base, hsaAnnual: 4_400 })
    const with401k = computePaycheck({ ...base, retirement401kPercent: 0.044 })

    // HSA shrinks FICA wages; 401(k) does not.
    expect(withHsa.ficaWages).toBe(95_600)
    expect(with401k.ficaWages).toBe(100_000)

    // Both reduce income tax identically ($4,400 off AGI).
    expect(withHsa.federalTaxable).toBe(with401k.federalTaxable)

    // So the HSA saves strictly more tax overall.
    expect(withHsa.totalTax).toBeLessThan(with401k.totalTax)
  })
})

describe('Social Security wage base', () => {
  it('stops withholding above the 2026 base of $184,500', () => {
    const r = computePaycheck({ ...base, annualSalary: 250_000 })
    expect(r.socialSecurity).toBeCloseTo(184_500 * 0.062, 2)
  })

  it('keeps SDI uncapped — it scales past the SS base', () => {
    const r = computePaycheck({ ...base, annualSalary: 250_000 })
    // SB 951 removed CA's SDI ceiling, so this tracks full wages.
    expect(r.disabilityInsurance).toBeCloseTo(250_000 * 0.013, 2)
  })

  it('withholds the additional Medicare surtax over $200k', () => {
    const r = computePaycheck({ ...base, annualSalary: 250_000 })
    expect(r.additionalMedicare).toBeCloseTo(50_000 * 0.009, 2)
  })

  it('reports the paycheck where SS withholding stops', () => {
    expect(socialSecurityCutoff(base)).toBeNull()
    const cutoff = socialSecurityCutoff({ ...base, annualSalary: 250_000 })
    expect(cutoff).not.toBeNull()
    expect(cutoff!.periodIndex).toBeLessThan(26)
  })

  it('dates the cutoff on a real pay date, not a day-of-year estimate', () => {
    const profile = { ...base, annualSalary: 250_000 }
    const cutoff = socialSecurityCutoff(profile)!
    expect(cutoff.date).toBe(payDates(profile)[cutoff.periodIndex - 1])
  })
})

describe('states without income tax', () => {
  it('charges no state tax or SDI in Texas', () => {
    const r = computePaycheck({ ...base, state: 'TX' })
    expect(r.stateIncomeTax).toBe(0)
    expect(r.disabilityInsurance).toBe(0)
    expect(r.net).toBeGreaterThan(computePaycheck(base).net)
  })
})

describe('401(k) match forfeiture', () => {
  const matched: CompProfile = {
    ...base,
    annualSalary: 300_000,
    employerMatchPercent: 1,
    employerMatchLimitPercent: 0.06,
  }

  it('flags forfeited match when the limit is hit before year end', () => {
    // 40% of $300k = $120k/yr, so the $24.5k cap lands in period 6 of 26.
    const risk = matchForfeitureRisk({ ...matched, retirement401kPercent: 0.4 })
    expect(risk.hitsLimitEarly).toBe(true)
    expect(risk.limitPeriod).toBeLessThan(26)
    expect(risk.forfeitedMatch).toBeGreaterThan(0)
  })

  it('reports no risk when contributions spread across the year', () => {
    const risk = matchForfeitureRisk({ ...matched, retirement401kPercent: 0.06 })
    expect(risk.hitsLimitEarly).toBe(false)
    expect(risk.forfeitedMatch).toBe(0)
  })
})

describe('tax data integrity', () => {
  const ty = getTaxYear(2026)

  it('has contiguous non-overlapping brackets', () => {
    const schedules = [
      ...Object.values(ty.federal.brackets),
      ...Object.values(ty.states).flatMap((s) => Object.values(s.brackets)),
    ]
    for (const brackets of schedules) {
      for (let i = 1; i < brackets.length; i++) {
        expect(brackets[i].from).toBe(brackets[i - 1].to)
      }
      if (brackets.length) expect(brackets[brackets.length - 1].to).toBeNull()
    }
  })

  it('flags CA figures as carried forward from TY2025', () => {
    expect(ty.states.CA.provenanceNote).toBeTruthy()
  })
})
