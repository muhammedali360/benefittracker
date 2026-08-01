export const money = (n: number, cents = false) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })

export const percent = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`

/** Hours read more naturally as "3.5 days (28h)" for time-off balances. */
export const hoursAsDays = (hours: number, hoursPerDay: number) => {
  const days = hours / hoursPerDay
  const rounded = Math.round(days * 100) / 100
  return `${rounded} ${Math.abs(rounded) === 1 ? 'day' : 'days'}`
}

export const hoursLabel = (hours: number) => `${Math.round(hours * 10) / 10}h`

export const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

export const shortMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })

export const todayISO = () => new Date().toISOString().slice(0, 10)
