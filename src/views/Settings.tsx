import { useRef } from 'react'
import type { useStore } from '../store'
import { PERIODS_PER_YEAR, type PayFrequency } from '../engine/tax'
import type { AccrualKind } from '../engine/pto'
import { getTaxYear, PUBLISHED_YEARS } from '../engine/taxData'
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

/** Caps are stored in hours but asked for in days — the unit everything else uses. */
const capInDays = (hours: number | null, hoursPerDay: number) =>
  hours === null ? '' : String(Math.round((hours / hoursPerDay) * 100) / 100)

/** Every published year, plus this year and next so January isn't a dead end. */
function selectableYears(current: number): number[] {
  const now = new Date().getFullYear()
  return [...new Set([...PUBLISHED_YEARS, now, now + 1, current])].sort((a, b) => a - b)
}

export function Settings({ store }: { store: Store }) {
  const { state, setProfile, setBucket, addBucket, removeBucket, exportJSON, importJSON, resetAll } =
    store
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
          <label className="field">
            Tax year
            <select
              aria-label="Tax year"
              value={profile.year}
              onChange={(e) => setProfile({ year: Number(e.target.value) })}
            >
              {selectableYears(profile.year).map((y) => (
                <option key={y} value={y}>
                  {y}
                  {PUBLISHED_YEARS.includes(y) ? '' : ` (carries ${getTaxYear(y).carriedFrom} figures)`}
                </option>
              ))}
            </select>
            <span className="hint">also the year the Time Off calendar shows</span>
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
          <div className="card-head">
            <h2>
              <span className="swatch" style={{ background: b.color, marginRight: 8 }} />
              {b.label}
            </h2>
            {buckets.length > 1 && (
              <button
                className="action small danger-text"
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${b.label}? Every event logged against it is deleted too.`,
                    )
                  )
                    removeBucket(b.id)
                }}
              >
                Remove bucket
              </button>
            )}
          </div>
          <p className="caption">
            Balances are replayed from the event ledger, so changing these numbers
            retroactively corrects history.
          </p>
          <div className="field-grid">
            <label className="field">
              Name
              <input
                type="text"
                value={b.label}
                onChange={(e) => setBucket(b.id, { label: e.target.value })}
              />
              <span className="hint">PTO, sick leave, comp time…</span>
            </label>
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
                onChange={(e) => setBucket(b.id, { hoursPerDay: Number(e.target.value) || 8 })}
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
              Balance ceiling (days)
              <input
                type="number"
                step="0.5"
                value={capInDays(b.maxBalanceHours, b.hoursPerDay)}
                placeholder="none"
                onChange={(e) => {
                  const d = optionalNumber(e.target.value)
                  setBucket(b.id, { maxBalanceHours: d === null ? null : d * b.hoursPerDay })
                }}
              />
              <span className="hint">accrual pauses here; blank = no ceiling</span>
            </label>
            <label className="field">
              Carryover cap (days)
              <input
                type="number"
                step="0.5"
                value={capInDays(b.carryoverCapHours, b.hoursPerDay)}
                placeholder="none"
                onChange={(e) => {
                  const d = optionalNumber(e.target.value)
                  setBucket(b.id, { carryoverCapHours: d === null ? null : d * b.hoursPerDay })
                }}
              />
              <span className="hint">max surviving Dec 31; blank = unlimited</span>
            </label>
          </div>
        </div>
      ))}

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="action" type="button" onClick={addBucket}>
          + Add a bucket
        </button>
        <span className="muted-note">Sick leave, comp time, a second PTO tier — each keeps its own ledger.</span>
      </div>

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
          <button
            className="action danger-text"
            onClick={() => {
              if (
                window.confirm(
                  'Clear everything — salary, elections, buckets and the whole ledger? Export first if you want a copy.',
                )
              )
                resetAll()
            }}
          >
            Clear all data
          </button>
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
        {taxYear.carriedFrom && (
          <div className="callout warn" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="icon" aria-hidden="true">
              ⚠
            </span>
            <span>
              <strong>Nothing is published for {profile.year} yet.</strong> Federal, state and
              contribution-limit figures are carried forward from {taxYear.carriedFrom}. They're
              the right planning numbers until the new ones land; refresh the data block then.
            </span>
          </div>
        )}
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
