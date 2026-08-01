/**
 * Paycheck / tax computation. Everything here is a pure function of
 * (profile, tax year) — no dates, no storage, no React.
 */

import {
  type Bracket,
  type FilingStatus,
  type TaxYear,
  getTaxYear,
} from './taxData'

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
}

export interface CompProfile {
  annualSalary: number
  filingStatus: FilingStatus
  state: string
  payFrequency: PayFrequency
  year: number
  /** Percent of gross deferred to traditional 401(k), e.g. 0.06 for 6%. */
  retirement401kPercent: number
  /** Annual dollars to HSA (pre-tax, also exempt from FICA via cafeteria plan). */
  hsaAnnual: number
  /** Annual dollars to health FSA (pre-tax, FICA-exempt). */
  fsaAnnual: number
  /** Annual employee-paid medical/dental/vision premiums (pre-tax, FICA-exempt). */
  premiumsAnnual: number
  /** Employer match as a percent of gross, capped at `matchLimitPercent`. */
  employerMatchPercent: number
  employerMatchLimitPercent: number
}

export interface LineItem {
  label: string
  annual: number
  perPeriod: number
  kind: 'gross' | 'pretax' | 'tax' | 'net' | 'employer'
}

export interface PaycheckBreakdown {
  gross: number
  /** Pre-tax deductions that reduce both income tax and FICA wages. */
  ficaExemptPretax: number
  /** 401(k) — reduces income tax but NOT FICA wages. */
  retirement: number
  federalTaxable: number
  stateTaxable: number
  ficaWages: number
  federalIncomeTax: number
  stateIncomeTax: number
  socialSecurity: number
  medicare: number
  additionalMedicare: number
  disabilityInsurance: number
  totalTax: number
  net: number
  employerMatch: number
  effectiveRate: number
  marginalRate: number
  lineItems: LineItem[]
  periodsPerYear: number
}

/** Progressive tax on `income` through `brackets`. */
export function taxFromBrackets(income: number, brackets: Bracket[]): number {
  if (income <= 0) return 0
  let tax = 0
  for (const b of brackets) {
    if (income <= b.from) break
    const ceiling = b.to ?? Infinity
    tax += (Math.min(income, ceiling) - b.from) * b.rate
  }
  return tax
}

/** The rate that would apply to one more dollar of income. */
export function marginalRateFromBrackets(income: number, brackets: Bracket[]): number {
  let rate = 0
  for (const b of brackets) {
    if (income >= b.from) rate = b.rate
    else break
  }
  return rate
}

export function computePaycheck(
  profile: CompProfile,
  taxYear: TaxYear = getTaxYear(profile.year),
): PaycheckBreakdown {
  const { federal } = taxYear
  const state = taxYear.states[profile.state]
  if (!state) throw new Error(`No tax data for state ${profile.state}`)

  const fs = profile.filingStatus
  const gross = profile.annualSalary
  const periodsPerYear = PERIODS_PER_YEAR[profile.payFrequency]

  // Section 125 cafeteria-plan deductions escape income tax AND FICA.
  const ficaExemptPretax = profile.hsaAnnual + profile.fsaAnnual + profile.premiumsAnnual
  // Traditional 401(k) escapes income tax but is still FICA wages.
  const retirement = gross * profile.retirement401kPercent

  const ficaWages = Math.max(0, gross - ficaExemptPretax)
  const agi = Math.max(0, gross - ficaExemptPretax - retirement)

  const federalTaxable = Math.max(0, agi - federal.standardDeduction[fs])
  const federalIncomeTax = taxFromBrackets(federalTaxable, federal.brackets[fs])

  const stateTaxable = Math.max(0, agi - state.standardDeduction[fs])
  const stateBracketTax = taxFromBrackets(stateTaxable, state.brackets[fs])
  const surtax = state.surtax && stateTaxable > state.surtax.threshold
    ? (stateTaxable - state.surtax.threshold) * state.surtax.rate
    : 0
  // Exemption credits reduce tax owed, never below zero.
  const stateIncomeTax = Math.max(0, stateBracketTax + surtax - state.exemptionCredit[fs])

  const socialSecurity =
    Math.min(ficaWages, federal.socialSecurity.wageBase) * federal.socialSecurity.rate
  const medicare = ficaWages * federal.medicare.rate
  const additionalMedicare =
    Math.max(0, ficaWages - federal.additionalMedicare.withholdingThreshold) *
    federal.additionalMedicare.rate

  const di = state.disabilityInsurance
  const disabilityInsurance = di
    ? (di.wageBase === null ? ficaWages : Math.min(ficaWages, di.wageBase)) * di.rate
    : 0

  const totalTax =
    federalIncomeTax +
    stateIncomeTax +
    socialSecurity +
    medicare +
    additionalMedicare +
    disabilityInsurance

  const net = gross - ficaExemptPretax - retirement - totalTax

  const employerMatch =
    gross *
    Math.min(profile.retirement401kPercent, profile.employerMatchLimitPercent) *
    (profile.employerMatchPercent || 0)

  const marginalRate =
    marginalRateFromBrackets(federalTaxable, federal.brackets[fs]) +
    marginalRateFromBrackets(stateTaxable, state.brackets[fs]) +
    (ficaWages < federal.socialSecurity.wageBase ? federal.socialSecurity.rate : 0) +
    federal.medicare.rate +
    (di ? di.rate : 0)

  const per = (n: number) => n / periodsPerYear
  const item = (label: string, annual: number, kind: LineItem['kind']): LineItem => ({
    label,
    annual,
    perPeriod: per(annual),
    kind,
  })

  const lineItems: LineItem[] = [
    item('Gross salary', gross, 'gross'),
    ...(profile.premiumsAnnual ? [item('Health premiums', -profile.premiumsAnnual, 'pretax')] : []),
    ...(profile.hsaAnnual ? [item('HSA', -profile.hsaAnnual, 'pretax')] : []),
    ...(profile.fsaAnnual ? [item('FSA', -profile.fsaAnnual, 'pretax')] : []),
    ...(retirement ? [item('401(k)', -retirement, 'pretax')] : []),
    item('Federal income tax', -federalIncomeTax, 'tax'),
    ...(stateIncomeTax ? [item(`${state.name} income tax`, -stateIncomeTax, 'tax')] : []),
    item('Social Security', -socialSecurity, 'tax'),
    item('Medicare', -medicare, 'tax'),
    ...(additionalMedicare ? [item('Additional Medicare', -additionalMedicare, 'tax')] : []),
    ...(disabilityInsurance && di ? [item(di.label, -disabilityInsurance, 'tax')] : []),
    item('Take-home', net, 'net'),
  ]

  return {
    gross,
    ficaExemptPretax,
    retirement,
    federalTaxable,
    stateTaxable,
    ficaWages,
    federalIncomeTax,
    stateIncomeTax,
    socialSecurity,
    medicare,
    additionalMedicare,
    disabilityInsurance,
    totalTax,
    net,
    employerMatch,
    effectiveRate: gross > 0 ? totalTax / gross : 0,
    marginalRate,
    lineItems,
    periodsPerYear,
  }
}

/**
 * The pay period in which Social Security withholding stops, if it happens at
 * all. Crossing the wage base makes take-home jump mid-year — worth surfacing.
 */
export function socialSecurityCutoff(
  profile: CompProfile,
  taxYear: TaxYear = getTaxYear(profile.year),
): { periodIndex: number; date: string } | null {
  const { wageBase } = taxYear.federal.socialSecurity
  const periods = PERIODS_PER_YEAR[profile.payFrequency]
  const ficaExempt = profile.hsaAnnual + profile.fsaAnnual + profile.premiumsAnnual
  const ficaWages = Math.max(0, profile.annualSalary - ficaExempt)
  if (ficaWages <= wageBase) return null

  const perPeriod = ficaWages / periods
  const periodIndex = Math.ceil(wageBase / perPeriod)
  // Approximate the calendar date of that period's end.
  const dayOfYear = Math.round((periodIndex / periods) * 365)
  const date = new Date(Date.UTC(profile.year, 0, dayOfYear))
  return { periodIndex, date: date.toISOString().slice(0, 10) }
}

/**
 * Employer match is applied per paycheck against that paycheck's deferral. If
 * you hit the annual 401(k) limit early, later paychecks defer $0 and earn $0
 * match — money you simply forfeit unless the plan has a true-up.
 */
export function matchForfeitureRisk(
  profile: CompProfile,
  taxYear: TaxYear = getTaxYear(profile.year),
): { hitsLimitEarly: boolean; limitPeriod: number; forfeitedMatch: number } {
  const periods = PERIODS_PER_YEAR[profile.payFrequency]
  const limit = taxYear.limits.elective401k
  const perPeriodDeferral = (profile.annualSalary * profile.retirement401kPercent) / periods
  if (perPeriodDeferral <= 0) {
    return { hitsLimitEarly: false, limitPeriod: periods, forfeitedMatch: 0 }
  }

  const limitPeriod = Math.ceil(limit / perPeriodDeferral)
  if (limitPeriod >= periods) {
    return { hitsLimitEarly: false, limitPeriod: periods, forfeitedMatch: 0 }
  }

  const perPeriodGross = profile.annualSalary / periods
  const matchablePerPeriod =
    perPeriodGross *
    Math.min(profile.retirement401kPercent, profile.employerMatchLimitPercent) *
    (profile.employerMatchPercent || 0)
  return {
    hitsLimitEarly: true,
    limitPeriod,
    forfeitedMatch: matchablePerPeriod * (periods - limitPeriod),
  }
}
