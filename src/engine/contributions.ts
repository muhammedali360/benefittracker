/**
 * What to actually type into the payroll portal.
 *
 * The app already diagnoses — "you may forfeit $3,100 of match", "you're
 * $8,200 under the HSA limit". A diagnosis without a prescription is a dead
 * end, so this solves for the number: the deferral percentage that lands on
 * the §402(g) limit with the last paycheck of the year rather than in October,
 * and what a dollar of unused headroom would really cost.
 *
 * The cost figure is the point. Nobody moves $8,200 into an HSA when they read
 * it as $8,200 of foregone take-home; the true figure is closer to $5,000, and
 * that's a different decision.
 */

import {
  PERIODS_PER_YEAR,
  computePaycheck,
  marginalRateFromBrackets,
  type CompProfile,
} from './tax'
import { getTaxYear, type TaxYear } from './taxData'

export interface DeferralPacing {
  /** Contribution the current rate produces over the year. */
  elected: number
  limit: number
  /** Rate that spends the limit exactly on the final paycheck. */
  idealPercent: number
  /** Paycheck the limit is reached at, out of the year's total. */
  limitPeriod: number
  periodsPerYear: number
  /** Match lost because later paychecks defer nothing. */
  forfeitedMatch: number
  status: 'none' | 'under-limit' | 'on-target' | 'front-loaded'
}

/**
 * A deferral rate is "correct" when it spends the annual limit across every
 * paycheck. Too high and the deferral — and the match riding on it — stops
 * early; too low and the limit goes unused.
 */
export function deferralPacing(
  profile: CompProfile,
  taxYear: TaxYear = getTaxYear(profile.year),
): DeferralPacing {
  const periodsPerYear = PERIODS_PER_YEAR[profile.payFrequency]
  const limit = taxYear.limits.elective401k
  const elected = profile.annualSalary * profile.retirement401kPercent

  // Salaries below the limit can't reach it at any rate; 100% is the ceiling.
  const idealPercent = profile.annualSalary > 0 ? Math.min(1, limit / profile.annualSalary) : 0

  if (elected <= 0) {
    return {
      elected: 0,
      limit,
      idealPercent,
      limitPeriod: periodsPerYear,
      periodsPerYear,
      forfeitedMatch: 0,
      status: 'none',
    }
  }

  const perPeriod = elected / periodsPerYear
  const limitPeriod = Math.min(periodsPerYear, Math.ceil(limit / perPeriod))
  const frontLoaded = limitPeriod < periodsPerYear

  const matchPerPeriod =
    (profile.annualSalary / periodsPerYear) *
    Math.min(profile.retirement401kPercent, profile.employerMatchLimitPercent) *
    (profile.employerMatchPercent || 0)

  return {
    elected,
    limit,
    idealPercent,
    limitPeriod,
    periodsPerYear,
    forfeitedMatch: frontLoaded ? matchPerPeriod * (periodsPerYear - limitPeriod) : 0,
    status: frontLoaded
      ? 'front-loaded'
      : // Within one paycheck of the limit is on target, not "under".
        elected >= limit - perPeriod
        ? 'on-target'
        : 'under-limit',
  }
}

export interface Headroom {
  key: '401k' | 'hsa' | 'fsa'
  label: string
  elected: number
  limit: number
  /** Unused room under the limit. */
  headroom: number
  /** Extra per paycheck needed to use all of it. */
  perPeriodToMax: number
  /** Tax the headroom would avoid if contributed. */
  taxSaved: number
  /** What using the headroom actually costs in take-home. */
  netCost: number
  /** Whether the account also escapes FICA (cafeteria plan) or only income tax. */
  ficaExempt: boolean
}

/**
 * Remaining room in each pre-tax account, priced in take-home rather than in
 * gross. `netCost` is the number that changes the decision.
 */
export function contributionHeadroom(
  profile: CompProfile,
  taxYear: TaxYear = getTaxYear(profile.year),
  hsaFamily = false,
): Headroom[] {
  const run = computePaycheck(profile, taxYear)
  const { federal } = taxYear
  const state = taxYear.states[profile.state]
  const fs = profile.filingStatus
  const periods = PERIODS_PER_YEAR[profile.payFrequency]

  // Marginal rates at the *current* taxable income. Contributing enough to drop
  // a bracket would make this optimistic, so it's an upper bound on the saving.
  const incomeRate =
    marginalRateFromBrackets(run.federalTaxable, federal.brackets[fs]) +
    (state ? marginalRateFromBrackets(run.stateTaxable, state.brackets[fs]) : 0)
  const ficaRate =
    (run.ficaWages < federal.socialSecurity.wageBase ? federal.socialSecurity.rate : 0) +
    federal.medicare.rate +
    (state?.disabilityInsurance ? state.disabilityInsurance.rate : 0)

  const build = (
    key: Headroom['key'],
    label: string,
    elected: number,
    limit: number,
    ficaExempt: boolean,
  ): Headroom => {
    const headroom = Math.max(0, limit - elected)
    const rate = ficaExempt ? incomeRate + ficaRate : incomeRate
    const taxSaved = headroom * rate
    return {
      key,
      label,
      elected,
      limit,
      headroom,
      perPeriodToMax: headroom / periods,
      taxSaved,
      netCost: headroom - taxSaved,
      ficaExempt,
    }
  }

  return [
    build('401k', '401(k)', run.retirement, taxYear.limits.elective401k, false),
    build(
      'hsa',
      hsaFamily ? 'HSA (family)' : 'HSA (self-only)',
      profile.hsaAnnual,
      hsaFamily ? taxYear.limits.hsaFamily : taxYear.limits.hsaSelfOnly,
      true,
    ),
    build('fsa', 'Health FSA', profile.fsaAnnual, taxYear.limits.fsaHealth, true),
  ]
}
