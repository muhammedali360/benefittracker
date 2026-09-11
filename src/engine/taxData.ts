/**
 * Year-keyed tax parameters.
 *
 * Every figure here is data, not logic — updating a tax year should never
 * require touching the engine. Each block carries a `source` and `asOf` so a
 * future reader can tell where a number came from and whether it's stale.
 */

export type FilingStatus = 'single' | 'mfj'

/** A bracket applies `rate` to income above `from`, up to `to` (null = no ceiling). */
export interface Bracket {
  rate: number
  from: number
  to: number | null
}

export interface FederalParams {
  brackets: Record<FilingStatus, Bracket[]>
  standardDeduction: Record<FilingStatus, number>
  socialSecurity: { rate: number; wageBase: number }
  medicare: { rate: number }
  /**
   * Employers withhold the surtax on wages over $200k regardless of filing
   * status; the filing-status thresholds only matter when reconciling on Form
   * 8959. We model withholding, so `withholdingThreshold` is what we use.
   */
  additionalMedicare: {
    rate: number
    withholdingThreshold: number
    filingThreshold: Record<FilingStatus, number>
  }
  /**
   * Flat withholding on supplemental wages (bonuses, commissions) when they're
   * paid separately from regular wages. This is a *withholding* rate, not a tax
   * rate — the bonus is ordinary income and reconciles at your bracket in April.
   */
  supplemental: { rate: number; threshold: number; rateAboveThreshold: number }
  source: string
}

export interface StateParams {
  name: string
  brackets: Record<FilingStatus, Bracket[]>
  standardDeduction: Record<FilingStatus, number>
  /** Reduces tax owed, not taxable income. */
  exemptionCredit: Record<FilingStatus, number>
  /** Extra flat rate above a threshold, e.g. CA's Mental Health Services Tax. */
  surtax?: { rate: number; threshold: number; label: string }
  /** Disability insurance withholding. `wageBase: null` means uncapped. */
  disabilityInsurance?: { rate: number; wageBase: number | null; label: string }
  /** Flat state withholding on bonuses. Omit where the state has no separate rate. */
  supplementalRate?: number
  source: string
  /**
   * Set when the figures are not yet published for the labelled year and we're
   * intentionally carrying forward the prior year. Surfaced in the UI.
   */
  provenanceNote?: string
}

export interface ContributionLimits {
  elective401k: number
  catchUp401k50: number
  hsaSelfOnly: number
  hsaFamily: number
  fsaHealth: number
  source: string
}

export interface TaxYear {
  year: number
  federal: FederalParams
  states: Record<string, StateParams>
  limits: ContributionLimits
  /**
   * Set when nothing has been published for `year` and the figures are the
   * latest published block carried forward. Surfaced in the UI so a January
   * reader knows the numbers are last year's until the block is refreshed.
   */
  carriedFrom?: number
}

const FEDERAL_2026: FederalParams = {
  // Rev. Proc. 2025-32 §4.01. OBBBA §70101 made the 10/12/22/24/32/35/37
  // schedule permanent, so this structure is current law.
  brackets: {
    single: [
      { rate: 0.1, from: 0, to: 12_400 },
      { rate: 0.12, from: 12_400, to: 50_400 },
      { rate: 0.22, from: 50_400, to: 105_700 },
      { rate: 0.24, from: 105_700, to: 201_775 },
      { rate: 0.32, from: 201_775, to: 256_225 },
      { rate: 0.35, from: 256_225, to: 640_600 },
      { rate: 0.37, from: 640_600, to: null },
    ],
    mfj: [
      { rate: 0.1, from: 0, to: 24_800 },
      { rate: 0.12, from: 24_800, to: 100_800 },
      { rate: 0.22, from: 100_800, to: 211_400 },
      { rate: 0.24, from: 211_400, to: 403_550 },
      { rate: 0.32, from: 403_550, to: 512_450 },
      { rate: 0.35, from: 512_450, to: 768_700 },
      { rate: 0.37, from: 768_700, to: null },
    ],
  },
  // Rev. Proc. 2025-32 §4.14 (OBBBA §70102 raised the base, indexed thereafter).
  standardDeduction: { single: 16_100, mfj: 32_200 },
  // SSA wage base per Federal Register 2025-19763.
  socialSecurity: { rate: 0.062, wageBase: 184_500 },
  medicare: { rate: 0.0145 },
  additionalMedicare: {
    rate: 0.009,
    withholdingThreshold: 200_000,
    // Statutory, not inflation-indexed — unchanged since 2013.
    filingThreshold: { single: 200_000, mfj: 250_000 },
  },
  // §3402(g)(1)(A) / Reg. §31.3402(g)-1. OBBBA kept the top rate at 37%, so the
  // mandatory rate on supplemental wages above $1M stays there too.
  supplemental: { rate: 0.22, threshold: 1_000_000, rateAboveThreshold: 0.37 },
  source: 'IRS Rev. Proc. 2025-32; IRS Pub. 15-T (2026); SSA/Federal Register 2025-19763',
}

const CALIFORNIA_2026: StateParams = {
  name: 'California',
  // FTB has not published TY2026 schedules (they index to CA CPI and release in
  // fall). These are the TY2025 figures — which is also what CA payroll
  // withholding actually runs on during 2026, so they're correct for take-home.
  brackets: {
    single: [
      { rate: 0.01, from: 0, to: 11_079 },
      { rate: 0.02, from: 11_079, to: 26_264 },
      { rate: 0.04, from: 26_264, to: 41_452 },
      { rate: 0.06, from: 41_452, to: 57_542 },
      { rate: 0.08, from: 57_542, to: 72_724 },
      { rate: 0.093, from: 72_724, to: 371_479 },
      { rate: 0.103, from: 371_479, to: 445_771 },
      { rate: 0.113, from: 445_771, to: 742_953 },
      { rate: 0.123, from: 742_953, to: null },
    ],
    mfj: [
      { rate: 0.01, from: 0, to: 22_158 },
      { rate: 0.02, from: 22_158, to: 52_528 },
      { rate: 0.04, from: 52_528, to: 82_904 },
      { rate: 0.06, from: 82_904, to: 115_084 },
      { rate: 0.08, from: 115_084, to: 145_448 },
      { rate: 0.093, from: 145_448, to: 742_958 },
      { rate: 0.103, from: 742_958, to: 891_542 },
      { rate: 0.113, from: 891_542, to: 1_485_906 },
      { rate: 0.123, from: 1_485_906, to: null },
    ],
  },
  standardDeduction: { single: 5_706, mfj: 11_412 },
  exemptionCredit: { single: 153, mfj: 306 },
  // The $1M threshold is NOT doubled for MFJ — same for every filing status.
  surtax: { rate: 0.01, threshold: 1_000_000, label: 'Mental Health Services Tax' },
  // SB 951 removed the taxable wage ceiling effective 2024 — SDI is uncapped
  // and scales linearly with no maximum. Rate is final for 2026.
  disabilityInsurance: { rate: 0.013, wageBase: null, label: 'CA SDI' },
  // EDD DE 44: bonuses and stock options withhold at 10.23%; other supplemental
  // wages at 6.6%. Bonuses are the case being modelled here.
  supplementalRate: 0.1023,
  source: 'CA FTB 2025 Schedules X/Y; CA EDD DE 44 (2026 rates)',
  provenanceNote:
    'CA has not published TY2026 brackets yet (released each fall). Using TY2025 figures, which is what CA payroll withholding runs on during 2026. SDI 1.3% is final for 2026.',
}

const NO_INCOME_TAX = (name: string): StateParams => ({
  name,
  brackets: { single: [], mfj: [] },
  standardDeduction: { single: 0, mfj: 0 },
  exemptionCredit: { single: 0, mfj: 0 },
  source: 'No state income tax',
})

export const TAX_YEARS: Record<number, TaxYear> = {
  2026: {
    year: 2026,
    federal: FEDERAL_2026,
    states: {
      CA: CALIFORNIA_2026,
      TX: NO_INCOME_TAX('Texas'),
      WA: NO_INCOME_TAX('Washington'),
      FL: NO_INCOME_TAX('Florida'),
      NV: NO_INCOME_TAX('Nevada'),
      IL: {
        name: 'Illinois',
        brackets: {
          single: [{ rate: 0.0495, from: 0, to: null }],
          mfj: [{ rate: 0.0495, from: 0, to: null }],
        },
        standardDeduction: { single: 0, mfj: 0 },
        exemptionCredit: { single: 0, mfj: 0 },
        // A flat state has no separate supplemental rate — it's the same rate.
        supplementalRate: 0.0495,
        source: 'IL flat rate 4.95%',
      },
    },
    limits: {
      elective401k: 24_500,
      catchUp401k50: 8_000,
      hsaSelfOnly: 4_400,
      hsaFamily: 8_750,
      fsaHealth: 3_400,
      source: 'IRS Notice 2025-67; Rev. Proc. 2025-19; Rev. Proc. 2025-32',
    },
  },
}

/** Years with a published block, oldest first. */
export const PUBLISHED_YEARS = Object.keys(TAX_YEARS)
  .map(Number)
  .sort((a, b) => a - b)

/**
 * The calendar year, so the app rolls over in January instead of freezing on
 * the last year someone typed in. Never earlier than the first published block.
 */
export const DEFAULT_YEAR = Math.max(new Date().getFullYear(), PUBLISHED_YEARS[0])

/**
 * Tax data for a year. Unpublished years borrow the most recent published
 * block rather than throwing — the app has to keep working in January, and
 * last year's brackets are the right planning numbers until the new ones land.
 * The result is tagged with `carriedFrom` so the UI can say so.
 */
export function getTaxYear(year: number): TaxYear {
  const exact = TAX_YEARS[year]
  if (exact) return exact
  const source = [...PUBLISHED_YEARS].reverse().find((y) => y <= year) ?? PUBLISHED_YEARS[0]
  const cached = CARRIED[year]
  if (cached) return cached
  const carried: TaxYear = { ...TAX_YEARS[source], year, carriedFrom: source }
  CARRIED[year] = carried
  return carried
}

// Memoised so a carried-forward year is referentially stable across renders.
const CARRIED: Record<number, TaxYear> = {}
