import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Paycheck } from './views/Paycheck'
import { TimeOff } from './views/TimeOff'
import { Plan } from './views/Plan'
import { Settings } from './views/Settings'
import { QuickStart } from './views/QuickStart'
import { getTaxYear } from './engine/taxData'
import './theme.css'

export type Tab = 'paycheck' | 'plan' | 'timeoff' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'paycheck', label: 'Paycheck' },
  { id: 'plan', label: 'Plan' },
  { id: 'timeoff', label: 'Time Off' },
  { id: 'settings', label: 'Settings' },
]

const isTab = (s: string): s is Tab => TABS.some((t) => t.id === s)

/**
 * The tab (and the Plan sub-section) live in the URL hash, so a reload lands
 * where you were and a link to "#plan/bonus" means something.
 */
function readRoute(): { tab: Tab; section?: string } {
  const [tab, section] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { tab: isTab(tab) ? tab : 'paycheck', section: section || undefined }
}

function useRoute() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const go = (tab: Tab, section?: string) => {
    window.location.hash = section ? `${tab}/${section}` : tab
  }
  return { ...route, go }
}

export default function App() {
  const store = useStore()
  const { tab, section, go } = useRoute()
  const { profile } = store.state
  const needsSalary = profile.annualSalary <= 0
  const taxYear = getTaxYear(profile.year)

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>Benefit Tracker</h1>
          <div className="sub">
            {profile.year}
            {taxYear.carriedFrom ? ` (using ${taxYear.carriedFrom} figures)` : ''} · {profile.state}{' '}
            · local to this machine
          </div>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* Both money tabs are gated on a salary — an invented one would look
          just like a real one. Time Off stands on its own without it. */}
      {(tab === 'paycheck' || tab === 'plan') && needsSalary && (
        <QuickStart store={store} tab={tab} onSettings={() => go('settings')} />
      )}

      {tab === 'paycheck' && !needsSalary && <Paycheck profile={profile} />}
      {tab === 'plan' && !needsSalary && (
        <Plan store={store} section={section} onSection={(s) => go('plan', s)} />
      )}

      {tab === 'timeoff' && <TimeOff store={store} />}
      {tab === 'settings' && <Settings store={store} />}
    </div>
  )
}
