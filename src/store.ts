/**
 * Persistence. Everything lives in localStorage on this machine — no server,
 * no account, no network call. Paystub data is nobody else's business.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CompProfile } from './engine/tax'
import type { BucketConfig, PtoEvent } from './engine/pto'
import { DEFAULT_YEAR } from './engine/taxData'

const KEY = 'benefittracker.v1'

/**
 * What-if inputs from the Plan tab. They're persisted so switching tabs (or
 * reloading) doesn't throw away a scenario someone was halfway through.
 */
export interface Scenarios {
  /** null = not yet touched; the view seeds a 10% raise from the profile. */
  raise: { annualSalary: number; state: string; retirement401kPercent: number } | null
  bonus: { gross: number; deferPct: number }
  familyHsa: boolean
}

export interface AppState {
  profile: CompProfile
  buckets: BucketConfig[]
  events: PtoEvent[]
  scenarios: Scenarios
}

export const PTO_BUCKET = 'pto'
export const FLOATING_BUCKET = 'floating'

/** Colours handed out to new buckets, in order, after the two defaults. */
export const BUCKET_COLORS = ['#2a78d6', '#1baf7a', '#eb6834', '#4a3aa7', '#eda100', '#d03b3b']

export const initialScenarios: Scenarios = {
  raise: null,
  bonus: { gross: 10_000, deferPct: 0 },
  familyHsa: false,
}

export const initialState: AppState = {
  profile: {
    // Left at zero deliberately: the app shows a setup prompt rather than
    // inventing a salary and presenting fabricated numbers as if they were real.
    annualSalary: 0,
    filingStatus: 'single',
    state: 'CA',
    payFrequency: 'biweekly',
    year: DEFAULT_YEAR,
    retirement401kPercent: 0,
    hsaAnnual: 0,
    fsaAnnual: 0,
    premiumsAnnual: 0,
    employerMatchPercent: 0,
    employerMatchLimitPercent: 0,
  },
  buckets: [
    {
      id: PTO_BUCKET,
      label: 'PTO',
      hoursPerDay: 8,
      accrualKind: 'monthly',
      annualDays: 10,
      accrualStart: `${DEFAULT_YEAR}-01-01`,
      maxBalanceHours: null,
      carryoverCapHours: null,
      color: BUCKET_COLORS[0],
    },
    {
      // Floaters aren't earned on a schedule — they show up as one-off grants.
      id: FLOATING_BUCKET,
      label: 'Floating Holidays',
      hoursPerDay: 8,
      accrualKind: 'none',
      annualDays: 0,
      accrualStart: `${DEFAULT_YEAR}-01-01`,
      maxBalanceHours: null,
      carryoverCapHours: null,
      color: BUCKET_COLORS[1],
    },
  ],
  // Empty on purpose. A fabricated grant would sit in the ledger looking
  // exactly like a real one.
  events: [],
  scenarios: initialScenarios,
}

function merge(parsed: Partial<AppState>): AppState {
  return {
    profile: { ...initialState.profile, ...parsed.profile },
    buckets: parsed.buckets?.length ? parsed.buckets : initialState.buckets,
    events: parsed.events ?? [],
    scenarios: {
      ...initialScenarios,
      ...parsed.scenarios,
      bonus: { ...initialScenarios.bonus, ...parsed.scenarios?.bonus },
    },
  }
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState
    return merge(JSON.parse(raw) as Partial<AppState>)
  } catch {
    return initialState
  }
}

export function useStore() {
  const [state, setState] = useState<AppState>(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state))
  }, [state])

  const setProfile = useCallback((patch: Partial<CompProfile>) => {
    setState((s) => ({ ...s, profile: { ...s.profile, ...patch } }))
  }, [])

  const setScenarios = useCallback((patch: Partial<Scenarios>) => {
    setState((s) => ({ ...s, scenarios: { ...s.scenarios, ...patch } }))
  }, [])

  const setBucket = useCallback((id: string, patch: Partial<BucketConfig>) => {
    setState((s) => ({
      ...s,
      buckets: s.buckets.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))
  }, [])

  const addBucket = useCallback(() => {
    setState((s) => {
      const template = s.buckets[0] ?? initialState.buckets[0]
      const color = BUCKET_COLORS[s.buckets.length % BUCKET_COLORS.length]
      const bucket: BucketConfig = {
        id: `b-${crypto.randomUUID()}`,
        label: 'New bucket',
        hoursPerDay: template.hoursPerDay,
        accrualKind: 'none',
        annualDays: 0,
        accrualStart: `${s.profile.year}-01-01`,
        maxBalanceHours: null,
        carryoverCapHours: null,
        color,
      }
      return { ...s, buckets: [...s.buckets, bucket] }
    })
  }, [])

  /** Removes the bucket and every event booked against it. */
  const removeBucket = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      buckets: s.buckets.filter((b) => b.id !== id),
      events: s.events.filter((e) => e.bucketId !== id),
    }))
  }, [])

  const addEvent = useCallback((event: Omit<PtoEvent, 'id'>) => {
    setState((s) => ({
      ...s,
      events: [...s.events, { ...event, id: `e-${crypto.randomUUID()}` }],
    }))
  }, [])

  const updateEvent = useCallback((id: string, patch: Omit<PtoEvent, 'id'>) => {
    setState((s) => ({
      ...s,
      // Replace rather than merge: a booking edited from a span to a single
      // day must lose its endDate, not keep a stale one.
      events: s.events.map((e) => (e.id === id ? { ...patch, id } : e)),
    }))
  }, [])

  const removeEvent = useCallback((id: string) => {
    setState((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }))
  }, [])

  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `benefittracker-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [state])

  const importJSON = useCallback(async (file: File) => {
    setState(merge(JSON.parse(await file.text()) as Partial<AppState>))
  }, [])

  const resetAll = useCallback(() => {
    localStorage.removeItem(KEY)
    setState(initialState)
  }, [])

  return {
    state,
    setProfile,
    setScenarios,
    setBucket,
    addBucket,
    removeBucket,
    addEvent,
    updateEvent,
    removeEvent,
    exportJSON,
    importJSON,
    resetAll,
  }
}
