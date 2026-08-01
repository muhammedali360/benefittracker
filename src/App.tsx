import { useState } from 'react'
import { useStore } from './store'
import { Paycheck } from './views/Paycheck'
import { TimeOff } from './views/TimeOff'
import { Plan } from './views/Plan'
import { Settings } from './views/Settings'
import './theme.css'

type Tab = 'paycheck' | 'plan' | 'timeoff' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'paycheck', label: 'Paycheck' },
  { id: 'plan', label: 'Plan' },
  { id: 'timeoff', label: 'Time Off' },
  { id: 'settings', label: 'Settings' },
]

export default function App() {
  const store = useStore()
  const [tab, setTab] = useState<Tab>('paycheck')
  const needsSalary = store.state.profile.annualSalary <= 0

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>Benefit Tracker</h1>
          <div className="sub">
            {store.state.profile.year} · {store.state.profile.state} · local to this machine
          </div>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Both money tabs are gated on a salary — an invented one would look
          just like a real one. Time Off stands on its own without it. */}
      {(tab === 'paycheck' || tab === 'plan') && needsSalary && (
        <div className="card empty-state">
          <div className="value">
            Add your salary to see {tab === 'plan' ? 'what a raise or a bonus is worth' : 'your paycheck broken down'}.
          </div>
          <p className="muted-note" style={{ marginBottom: 16 }}>
            Nothing is shown until then — an invented number would look just like a real one.
            Time Off works without it.
          </p>
          <button className="action primary" onClick={() => setTab('settings')}>
            Go to Settings
          </button>
        </div>
      )}

      {tab === 'paycheck' && !needsSalary && <Paycheck profile={store.state.profile} />}
      {tab === 'plan' && !needsSalary && <Plan store={store} />}

      {tab === 'timeoff' && <TimeOff store={store} />}
      {tab === 'settings' && <Settings store={store} />}
    </div>
  )
}
