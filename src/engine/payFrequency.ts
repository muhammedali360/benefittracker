export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
}
