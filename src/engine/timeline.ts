/**
 * The year, paycheck by paycheck.
 *
 * `computePaycheck` answers "what does an average check look like", which is
 * the right question only if every check is the same. They aren't. Social
 * Security stops mid-year at the wage base, a 401(k) deferral stops the moment
 * it hits the 402(g) limit, and the employer match stops with it. The annual
 * average hides all three.
 *
 * So this replays the year period by period, carrying the running totals that
 * actually drive those cutoffs. Income-tax withholding is spread evenly — the
 * annualised method — because the alternative is Publication 15-T's
 * percentage-method tables and W-4 entries, which is a payroll engine, not a
 * planning model. Everything that *does* step is stepped correctly.
 */

import { computePaycheck, type CompProfile } from './tax'
import { getTaxYear, type TaxYear } from './taxData'
import { payDates } from './payDates'

export interface PayPeriod {
  /** 1-based paycheck number within the year. */
  index: number
  /** Pay date, ISO. */
  date: string
  gross: number
  /** HSA + FSA + premiums for this period. */
  pretax: number
  /** 401(k) deferred this period — zero once the annual limit is reached. */
  retirement: number
  employerMatch: number
  socialSecurity: number
  medicare: number
  additionalMedicare: number
  disability: number
  federal: number
  state: number
  tax: number
  net: number
  cumulativeNet: number
  cumulativeRetirement: number
  /** Set on the first check where something structural changed. */
  event?: 'ss-cap' | 'deferral-cap'
}

export { payDates }

export function payTimeline(
  profile: CompProfile,
  taxYear: TaxYear = getTaxYear(profile.year),
  anchorISO?: string,
): PayPeriod[] {
  const state = taxYear.states[profile.state]
  if (!state) throw new Error(`No tax data for state ${profile.state}`)

  const dates = payDates(profile, anchorISO ?? profile.firstPayDate)
  const periods = dates.length
  if (periods === 0 || profile.annualSalary <= 0) return []

  const annual = computePaycheck(profile, taxYear)
  const { federal } = taxYear

  const grossPer = profile.annualSalary / periods
  const pretaxPer = (profile.hsaAnnual + profile.fsaAnnual + profile.premiumsAnnual) / periods
  const ficaWagesPer = Math.max(0, grossPer - pretaxPer)
  // Income tax is the annual liability, levelled. Only the wage-base-driven
  // items below are allowed to step.
  const federalPer = annual.federalIncomeTax / periods
  const statePer = annual.stateIncomeTax / periods

  const di = state.disabilityInsurance
  const deferralTarget = grossPer * profile.retirement401kPercent
  const matchRate =
    Math.min(profile.retirement401kPercent, profile.employerMatchLimitPercent) *
    (profile.employerMatchPercent || 0)

  let ssWagesSoFar = 0
  let ficaWagesSoFar = 0
  let deferredSoFar = 0
  let cumulativeNet = 0
  let ssCapSeen = false
  let deferralCapSeen = false

  return dates.map((date, i) => {
    // Social Security only applies to wages below the base; the check where the
    // running total crosses it is partly taxed, and every later one isn't.
    const ssRoom = Math.max(0, federal.socialSecurity.wageBase - ssWagesSoFar)
    const ssWages = Math.min(ficaWagesPer, ssRoom)
    const socialSecurity = ssWages * federal.socialSecurity.rate
    ssWagesSoFar += ssWages

    const medicare = ficaWagesPer * federal.medicare.rate
    // The 0.9% surtax starts on the check that crosses $200k of cumulative wages.
    const surtaxBefore = Math.max(0, ficaWagesSoFar - federal.additionalMedicare.withholdingThreshold)
    ficaWagesSoFar += ficaWagesPer
    const surtaxAfter = Math.max(0, ficaWagesSoFar - federal.additionalMedicare.withholdingThreshold)
    const additionalMedicare = (surtaxAfter - surtaxBefore) * federal.additionalMedicare.rate

    const disability = di
      ? (di.wageBase === null
          ? ficaWagesPer
          : Math.max(0, Math.min(ficaWagesPer, di.wageBase - (ficaWagesSoFar - ficaWagesPer)))) *
        di.rate
      : 0

    // Deferrals stop dead at the 402(g) limit — and the match stops with them,
    // which is the whole reason this view exists.
    const deferral = Math.max(
      0,
      Math.min(deferralTarget, taxYear.limits.elective401k - deferredSoFar),
    )
    deferredSoFar += deferral
    const employerMatch = deferral > 0 ? grossPer * matchRate : 0

    const tax = federalPer + statePer + socialSecurity + medicare + additionalMedicare + disability
    const net = grossPer - pretaxPer - deferral - tax
    cumulativeNet += net

    let event: PayPeriod['event']
    if (!deferralCapSeen && deferralTarget > 0 && deferral < deferralTarget) {
      deferralCapSeen = true
      event = 'deferral-cap'
    } else if (!ssCapSeen && socialSecurity === 0 && federal.socialSecurity.rate > 0 && ssRoom <= 0) {
      ssCapSeen = true
      event = 'ss-cap'
    }

    return {
      index: i + 1,
      date,
      gross: grossPer,
      pretax: pretaxPer,
      retirement: deferral,
      employerMatch,
      socialSecurity,
      medicare,
      additionalMedicare,
      disability,
      federal: federalPer,
      state: statePer,
      tax,
      net,
      cumulativeNet,
      cumulativeRetirement: deferredSoFar,
      ...(event ? { event } : {}),
    }
  })
}

export interface TimelineSummary {
  periods: PayPeriod[]
  smallest: PayPeriod | null
  largest: PayPeriod | null
  /** Take-home swing between the smallest and largest check of the year. */
  spread: number
  totalNet: number
  totalMatch: number
  totalDeferred: number
  /** Match left on the table because deferrals stopped early. */
  forfeitedMatch: number
}

export function summariseTimeline(periods: PayPeriod[]): TimelineSummary {
  if (periods.length === 0) {
    return {
      periods,
      smallest: null,
      largest: null,
      spread: 0,
      totalNet: 0,
      totalMatch: 0,
      totalDeferred: 0,
      forfeitedMatch: 0,
    }
  }
  const sorted = [...periods].sort((a, b) => a.net - b.net)
  const smallest = sorted[0]
  const largest = sorted[sorted.length - 1]
  const totalMatch = periods.reduce((a, p) => a + p.employerMatch, 0)
  // What the match would have been had every check carried a deferral.
  const fullMatch = periods[0].employerMatch > 0 ? periods[0].employerMatch * periods.length : 0
  return {
    periods,
    smallest,
    largest,
    spread: largest.net - smallest.net,
    totalNet: periods[periods.length - 1].cumulativeNet,
    totalMatch,
    totalDeferred: periods[periods.length - 1].cumulativeRetirement,
    forfeitedMatch: Math.max(0, fullMatch - totalMatch),
  }
}
