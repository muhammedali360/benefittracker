import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'
const KEY = 'benefittracker.theme'

const read = (): Theme => {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** Pins light or dark, or follows the OS. Applied as `data-theme` on <html>. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      root.removeAttribute('data-theme')
      localStorage.removeItem(KEY)
    } else {
      root.setAttribute('data-theme', theme)
      localStorage.setItem(KEY, theme)
    }
  }, [theme])
  return [theme, setTheme]
}
