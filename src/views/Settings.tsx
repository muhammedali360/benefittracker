import { useRef } from 'react'
import type { useStore } from '../store'
import { PERIODS_PER_YEAR, type PayFrequency } from '../engine/tax'
import type { AccrualKind } from '../engine/pto'
import { getTaxYear } from '../engine/taxData'
import { money } from '../format'

type Store = ReturnType<typeof useStore>

const FREQUENCIES: PayFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly']
const ACCRUALS: { value: AccrualKind; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'per-paycheck', label: 'Every paycheck' },
  { value: 'lump', label: 'Lump sum on Jan 1' },
  { value: 'none', label: 'No accrual (grants only)' },
]

/** Empty string clears the cap rather than coercing to 0, which means something else. */
const optionalNumber = (v: string): number | null => (v.trim() === '' ? null : Number(v))

export function Settings({ store }: { store: Store }) {
  const { state, setProfile, setBucket, exportJSON, importJSON } = store
  const { profile, buckets } = state
  const taxYear = getTaxYear(profile.year)
  const stateParams = taxYear.states[profile.state]
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <>
      <div className="card">
        <h2>Pay & filing</h2>
        <p className="caption">
          Drives every tax figure in the app. Nothing here leaves this machine.
        </p>
        <div className="field-grid">
          <label className="field">
            Annual salary
            <input
              type="number"
              value={profile.annualSalary || ''}
              placeholder="e.g. 120000"
              onChange={(e) => setProfile({ annualSalary: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Filing status
            <select
              aria-label="Filing status"
              value={profile.filingStatus}
              onChange={(e) =>
                setProfile({ filingStatus: e.target.value as 'single' | 'mfj' })
              }
            >
              <option value="single">Single</option>
              <option value="mfj">Married filing jointly</option>
            </select>
          </label>
          <label className="field">
            State
            <select
              aria-label="State"
              value={profile.state}
              onChange={(e) => setProfile({ state: e.target.value })}
            >
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
              value={profile.payFrequency}
              onChange={(e) => setProfile({ payFrequency: e.target.value as PayFrequency })}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f[0].toUpperCase() + f.slice(1)} ({PERIODS_PER_YEAR[f]}/yr)
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Pre-tax deductions</h2>
        <p className="caption">
          HSA, FSA and premiums avoid income tax <em>and</em> FICA. A traditional 401(k)
          avoids income tax only — it is still Social Security and Medicare wages.
        </p>
        <div className="field-grid">
          <label className="field">
            401(k) contribution
            <input
              type="number"
              step="0.5"
              value={profile.retirement401kPercent * 100 || ''}
              placeholder="6"
              onChange={(e) =>
                setProfile({ retirement401kPercent: Number(e.target.value) / 100 })
              }
            />
            <span className="hint">
              % of gross · {money(profile.annualSalary * profile.retirement401kPercent)} /yr ·{' '}
              {profile.year} limit {money(taxYear.limits.elective401k)}
            </span>
          </label>
          <label className="field">
            HSA (annual)
            <input
              type="number"
              value={profile.hsaAnnual || ''}
              placeholder="0"
              onChange={(e) => setProfile({ hsaAnnual: Number(e.target.value) })}
            />
            <span className="hint">
              limit {money(taxYear.limits.hsaSelfOnly)} self / {money(taxYear.limits.hsaFamily)}{' '}
              family
            </span>
          </label>
          <label className="field">
            Health FSA (annual)
            <input
              type="number"
              value={profile.fsaAnnual || ''}
              placeholder="0"
              onChange={(e) => setProfile({ fsaAnnual: Number(e.target.value) })}
            />
            <span className="hint">limit {money(taxYear.limits.fsaHealth)}</span>
          </label>
          <label className="field">
            Health premiums (annual)
            <input
              type="number"
              value={profile.premiumsAnnual || ''}
              placeholder="0"
              onChange={(e) => setProfile({ premiumsAnnual: Number(e.target.value) })}
            />
            <span className="hint">your share, medical + dental + vision</span>
          </label>
          <label className="field">
            Employer match rate
            <input
              type="number"
              step="10"
              value={profile.employerMatchPercent * 100 || ''}
              placeholder="50"
              onChange={(e) =>
                setProfile({ employerMatchPercent: Number(e.target.value) / 100 })
              }
            />
            <span className="hint">% of your contribution, e.g. 50 for $0.50 on the dollar</span>
          </label>
          <label className="field">
            Match applies up to
            <input
              type="number"
              step="0.5"
              value={profile.employerMatchLimitPercent * 100 || ''}
              placeholder="6"
              onChange={(e) =>
                setProfile({ employerMatchLimitPercent: Number(e.target.value) / 100 })
              }
            />
            <span className="hint">% of your salary</span>
          </label>
        </div>
      </div>

      {buckets.map((b) => (
        <div className="card" key={b.id}>
          <h2>{b.label}</h2>
          <p className="caption">
            Balances are replayed from the event ledger, so changing these numbers
            retroactively corrects history.
          </p>
          <div className="field-grid">
            <label className="field">
              Days per year
              <input
                type="number"
                step="0.5"
                value={b.annualDays || ''}
                placeholder="0"
                onChange={(e) => setBucket(b.id, { annualDays: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Accrues
              <select
                aria-label={`${b.label} accrual schedule`}
                value={b.accrualKind}
                onChange={(e) =>
                  setBucket(b.id, { accrualKind: e.target.value as AccrualKind })
                }
              >
                {ACCRUALS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Hours per day
              <input
                type="number"
                step="0.5"
                value={b.hoursPerDay}
                onChange={(e) => setBucket(b.id, { hoursPerDay: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Accrual starts
              <input
                type="date"
                value={b.accrualStart}
                onChange={(e) => setBucket(b.id, { accrualStart: e.target.value })}
              />
              <span className="hint">your hire date, or Jan 1</span>
            </label>
            <label className="field">
              Balance ceiling (hours)
              <input
                type="number"
                value={b.maxBalanceHours ?? ''}
                placeholder="none"
                onChange={(e) =>
                  setBucket(b.id, { maxBalanceHours: optionalNumber(e.target.value) })
                }
              />
              <span className="hint">accrual pauses here; blank = no ceiling</span>
            </label>
            <label className="field">
              Carryover cap (hours)
              <input
                type="number"
                value={b.carryoverCapHours ?? ''}
                placeholder="none"
                onChange={(e) =>
                  setBucket(b.id, { carryoverCapHours: optionalNumber(e.target.value) })
                }
              />
              <span className="hint">max surviving Dec 31; blank = unlimited</span>
            </label>
          </div>
        </div>
      ))}

      <div className="card">
        <h2>Your data</h2>
        <p className="caption">
          Stored in this browser's localStorage only. Export to back it up or move machines.
        </p>
        <div className="row">
          <button className="action" onClick={exportJSON}>
            Export JSON
          </button>
          <button className="action" onClick={() => fileInput.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importJSON(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <div className="card">
        <h2>Where these numbers come from</h2>
        <p className="muted-note">
          Federal &amp; FICA: {taxYear.federal.source}.
          <br />
          {stateParams.name}: {stateParams.source}.
          <br />
          Limits: {taxYear.limits.source}.
        </p>
        {stateParams.provenanceNote && (
          <div className="callout warn" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="icon" aria-hidden="true">
              ⚠
            </span>
            <span>
              <strong>Heads up:</strong> {stateParams.provenanceNote}
            </span>
          </div>
        )}
      </div>
    </>
  )
}
