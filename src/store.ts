/**
 * Persistence. Everything lives in localStorage on this machine — no server,
 * no account, no network call. Paystub data is nobody else's business.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CompProfile } from './engine/tax'
import type { BucketConfig, PtoEvent } from './engine/pto'
import { DEFAULT_YEAR } from './engine/taxData'

const KEY = 'benefittracker.v1'

export interface AppState {
  profile: CompProfile
  buckets: BucketConfig[]
  events: PtoEvent[]
}

export const PTO_BUCKET = 'pto'
export const FLOATING_BUCKET = 'floating'

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
      color: '#2a78d6',
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
      color: '#1baf7a',
    },
  ],
  events: [
    {
      id: 'seed-floater',
      bucketId: FLOATING_BUCKET,
      type: 'grant',
      date: `${DEFAULT_YEAR}-07-15`,
      hours: 8,
      note: 'Floating holiday awarded',
    },
  ],
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState
    const parsed = JSON.parse(raw) as Partial<AppState>
    return {
      profile: { ...initialState.profile, ...parsed.profile },
      buckets: parsed.buckets?.length ? parsed.buckets : initialState.buckets,
      events: parsed.events ?? initialState.events,
    }
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

  const setBucket = useCallback((id: string, patch: Partial<BucketConfig>) => {
    setState((s) => ({
      ...s,
      buckets: s.buckets.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))
  }, [])

  const addEvent = useCallback((event: Omit<PtoEvent, 'id'>) => {
    setState((s) => ({
      ...s,
      events: [...s.events, { ...event, id: `e-${crypto.randomUUID()}` }],
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
    const parsed = JSON.parse(await file.text()) as Partial<AppState>
    setState({
      profile: { ...initialState.profile, ...parsed.profile },
      buckets: parsed.buckets?.length ? parsed.buckets : initialState.buckets,
      events: parsed.events ?? [],
    })
  }, [])

  return { state, setProfile, setBucket, addEvent, removeEvent, exportJSON, importJSON }
}
