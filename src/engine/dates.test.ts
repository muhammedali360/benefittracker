import { describe, expect, it } from 'vitest'
import { isValidISO } from './dates'

describe('isValidISO', () => {
  it('accepts real dates and rejects the rest', () => {
    expect(isValidISO('2026-02-28')).toBe(true)
    expect(isValidISO('2026-02-30')).toBe(false)
    expect(isValidISO('')).toBe(false)
    expect(isValidISO('2026-1-5')).toBe(false)
    expect(isValidISO('not-a-date')).toBe(false)
  })
})
