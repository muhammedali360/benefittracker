import { describe, expect, it } from 'vitest'
import { getTaxYear, PUBLISHED_YEARS, TAX_YEARS } from './taxData'

describe('getTaxYear', () => {
  it('returns the published block untouched', () => {
    expect(getTaxYear(2026)).toBe(TAX_YEARS[2026])
    expect(getTaxYear(2026).carriedFrom).toBeUndefined()
  })

  it('carries the latest published block into an unpublished year and says so', () => {
    const latest = PUBLISHED_YEARS[PUBLISHED_YEARS.length - 1]
    const next = getTaxYear(latest + 1)
    expect(next.year).toBe(latest + 1)
    expect(next.carriedFrom).toBe(latest)
    expect(next.federal).toBe(TAX_YEARS[latest].federal)
    expect(next.limits).toBe(TAX_YEARS[latest].limits)
  })

  it('is referentially stable for a carried-forward year', () => {
    const latest = PUBLISHED_YEARS[PUBLISHED_YEARS.length - 1]
    expect(getTaxYear(latest + 2)).toBe(getTaxYear(latest + 2))
  })

  it('falls back to the earliest block for years before anything published', () => {
    expect(getTaxYear(PUBLISHED_YEARS[0] - 1).carriedFrom).toBe(PUBLISHED_YEARS[0])
  })
})
