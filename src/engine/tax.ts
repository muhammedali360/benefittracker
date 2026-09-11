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

import { PERIODS_PER_YEAR, type PayFrequency } from './payFrequency'
import { payDates } from './payDates'

export { PERIODS_PER_YEAR, type PayFrequency }

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
  /**
   * Any real pay date, ISO. Weekly and biweekly checks step from it, so the
   * paycheck timeline and per-paycheck accruals land on the actual days.
   * Absent, the first Friday of the year stands in.
   */
  firstPayDate?: string
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
  // Traditional 401(k) escapes income tax but is still FICA wages. The elective
  // deferral is hard-capped by §402(g) — electing 30% of a large salary does not
  // shelter 30%, it shelters the limit and the rest lands in your paycheck.
  const retirement = Math.min(gross * profile.retirement401kPercent, taxYear.limits.elective401k)

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
  // The real pay date, so the callout lands on the same day the timeline chart
  // draws the step.
  const date = payDates(profile, profile.firstPayDate)[periodIndex - 1]
  return { periodIndex, date }
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

// --- bonuses ---------------------------------------------------------------

export interface BonusBreakdown {
  gross: number
  /** Deferred to the 401(k) out of the bonus, if the plan allows it. */
  retirement: number
  federalWithheld: number
  stateWithheld: number
  socialSecurity: number
  medicare: number
  additionalMedicare: number
  disability: number
  totalWithheld: number
  /** What actually lands in the account. */
  net: number
  /** Share of the bonus you keep after withholding. */
  keepRate: number
  /** Income tax the bonus genuinely adds, at your bracket — not the flat rate. */
  trueIncomeTax: number
  /**
   * Withheld income tax minus what the bonus really costs. Positive means the
   * flat supplemental rate over-withheld and April pays it back; negative means
   * it under-withheld and April collects.
   */
  withholdingGap: number
}

/**
 * A bonus is not taxed at a special rate — it's *withheld* at one. Employers
 * apply a flat supplemental percentage (22% federal under §3402(g), higher over
 * $1M) instead of running it through your brackets, so the number that lands in
 * your account has almost nothing to do with what the bonus finally costs you.
 *
 * Both figures are returned, because the gap between them is the entire point:
 * under-withholding shows up as an April bill nobody budgeted for, and
 * over-withholding is an interest-free loan to the Treasury.
 */
export function computeBonus(
  profile: CompProfile,
  bonusGross: number,
  taxYear: TaxYear = getTaxYear(profile.year),
  deferPercent = 0,
): BonusBreakdown {
  const { federal } = taxYear
  const state = taxYear.states[profile.state]
  if (!state) throw new Error(`No tax data for state ${profile.state}`)
  if (bonusGross <= 0) {
    return {
      gross: 0, retirement: 0, federalWithheld: 0, stateWithheld: 0, socialSecurity: 0,
      medicare: 0, additionalMedicare: 0, disability: 0, totalWithheld: 0, net: 0,
      keepRate: 0, trueIncomeTax: 0, withholdingGap: 0,
    }
  }

  const salaryRun = computePaycheck(profile, taxYear)
  // Deferrals out of a bonus share the same §402(g) limit as payroll deferrals.
  const deferralRoom = Math.max(0, taxYear.limits.elective401k - salaryRun.retirement)
  const retirement = Math.min(bonusGross * deferPercent, deferralRoom)
  const taxableBonus = bonusGross - retirement

  // Flat supplemental withholding, with the higher rate on the excess over $1M.
  const sup = federal.supplemental
  const overThreshold = Math.max(0, taxableBonus - sup.threshold)
  const federalWithheld =
    (taxableBonus - overThreshold) * sup.rate + overThreshold * sup.rateAboveThreshold
  const stateWithheld = taxableBonus * (state.supplementalRate ?? 0)

  // FICA has no supplemental concept — the bonus stacks straight onto YTD wages.
  const ssRoom = Math.max(0, federal.socialSecurity.wageBase - salaryRun.ficaWages)
  const socialSecurity = Math.min(bonusGross, ssRoom) * federal.socialSecurity.rate
  const medicare = bonusGross * federal.medicare.rate
  const surtaxBase = federal.additionalMedicare.withholdingThreshold
  const additionalMedicare =
    (Math.max(0, salaryRun.ficaWages + bonusGross - surtaxBase) -
      Math.max(0, salaryRun.ficaWages - surtaxBase)) *
    federal.additionalMedicare.rate

  const di = state.disabilityInsurance
  const disability = di
    ? (di.wageBase === null
        ? bonusGross
        : Math.max(0, Math.min(bonusGross, di.wageBase - salaryRun.ficaWages))) * di.rate
    : 0

  const totalWithheld =
    federalWithheld + stateWithheld + socialSecurity + medicare + additionalMedicare + disability

  // The honest number: what stacking `taxableBonus` on top of existing taxable
  // income costs once it runs through the actual brackets.
  const fs = profile.filingStatus
  const trueFederal =
    taxFromBrackets(salaryRun.federalTaxable + taxableBonus, federal.brackets[fs]) -
    taxFromBrackets(salaryRun.federalTaxable, federal.brackets[fs])
  const trueState =
    taxFromBrackets(salaryRun.stateTaxable + taxableBonus, state.brackets[fs]) -
    taxFromBrackets(salaryRun.stateTaxable, state.brackets[fs])
  const trueIncomeTax = trueFederal + trueState

  return {
    gross: bonusGross,
    retirement,
    federalWithheld,
    stateWithheld,
    socialSecurity,
    medicare,
    additionalMedicare,
    disability,
    totalWithheld,
    net: bonusGross - retirement - totalWithheld,
    keepRate: (bonusGross - retirement - totalWithheld) / bonusGross,
    trueIncomeTax,
    withholdingGap: federalWithheld + stateWithheld - trueIncomeTax,
  }
}

// --- scenario comparison ---------------------------------------------------

export interface ScenarioDelta {
  base: PaycheckBreakdown
  variant: PaycheckBreakdown
  grossDelta: number
  netDelta: number
  taxDelta: number
  matchDelta: number
  /** Take-home + employer match, i.e. total value actually received. */
  totalValueDelta: number
  /**
   * Share of the extra gross that survives to take-home. For a raise this is
   * the only number that matters, and it is never the headline percentage.
   */
  keepRate: number
}

/**
 * Two profiles, side by side. A $15k raise, a move to Texas and a bump in the
 * 401(k) rate are all the same operation: change one field and ask what the
 * take-home actually does.
 */
export function compareProfiles(
  base: CompProfile,
  variant: CompProfile,
  taxYear?: TaxYear,
): ScenarioDelta {
  const b = computePaycheck(base, taxYear ?? getTaxYear(base.year))
  const v = computePaycheck(variant, taxYear ?? getTaxYear(variant.year))
  const grossDelta = v.gross - b.gross
  const netDelta = v.net - b.net
  const matchDelta = v.employerMatch - b.employerMatch
  return {
    base: b,
    variant: v,
    grossDelta,
    netDelta,
    taxDelta: v.totalTax - b.totalTax,
    matchDelta,
    totalValueDelta: netDelta + matchDelta,
    // With no change in gross, "keep rate" has no meaning — don't invent one.
    keepRate: grossDelta !== 0 ? netDelta / grossDelta : 0,
  }
}
