import { useState } from 'react'
import type { useStore } from '../store'
import { PERIODS_PER_YEAR, type PayFrequency } from '../engine/tax'
import { getTaxYear } from '../engine/taxData'
import { NumberInput } from '../components/NumberInput'

type Store = ReturnType<typeof useStore>

export const FREQUENCIES: PayFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly']

/**
 * First run. Three fields are enough to draw a paycheck; the other twenty can
 * wait. Values are held locally and committed on submit, so typing the first
 * digit of a salary doesn't flip the whole app into showing a $1 paycheck.
 */
export function QuickStart({
  store,
  tab,
  onSettings,
}: {
  store: Store
  tab: 'paycheck' | 'plan'
  onSettings: () => void
}) {
  const { profile } = store.state
  const taxYear = getTaxYear(profile.year)
  const [salary, setSalary] = useState(0)
  const [state, setState] = useState(profile.state)
  const [payFrequency, setPayFrequency] = useState<PayFrequency>(profile.payFrequency)
  const valid = salary > 0

  return (
    <div className="card empty-state quickstart">
      <div className="value">
        Add your salary to see {tab === 'plan' ? 'what a raise or a bonus is worth' : 'your paycheck broken down'}.
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          store.setProfile({ annualSalary: salary, state, payFrequency })
        }}
      >
        <div className="field-grid">
          <label className="field">
            Annual salary
            <NumberInput
              prefix="$"
              autoFocus
              value={salary}
              placeholder="e.g. 120000"
              onChange={(n) => setSalary(n ?? 0)}
            />
          </label>
          <label className="field">
            State
            <select aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
              {Object.entries(taxYear.states).map(([code, s]) => (
                <option key={code} value={code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Pay frequency
            <select
              aria-label="Pay frequency"
              value={payFrequency}
              onChange={(e) => setPayFrequency(e.target.value as PayFrequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f[0].toUpperCase() + f.slice(1)} ({PERIODS_PER_YEAR[f]}/yr)
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="action primary" type="submit" disabled={!valid}>
            Show my {tab === 'plan' ? 'plan' : 'paycheck'}
          </button>
          <button className="action" type="button" onClick={onSettings}>
            All settings
          </button>
        </div>
      </form>
      <p className="muted-note" style={{ marginTop: 16 }}>
        Assumes a single filer with no 401(k), HSA or premiums until you say otherwise in
        Settings. Nothing leaves this browser. Time Off works without a salary.
      </p>
    </div>
  )
}
