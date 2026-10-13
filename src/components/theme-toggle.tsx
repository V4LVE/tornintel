import { useEffect, useState } from 'react'

export const THEME_STORAGE = 'tornintel.theme'

type Theme = 'dark' | 'light'

// Runs in <head> before the page paints, so a saved light theme never flashes dark.
export const themeBootScript = `try{if(localStorage.getItem('${THEME_STORAGE}')==='light')document.documentElement.dataset.theme='light'}catch(e){}`

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    )
  }, [])

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    if (next === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem(THEME_STORAGE, next)
    } catch {
      // The theme still applies for this visit without storage.
    }
  }

  const label =
    theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'
  return (
    <button
      type="button"
      className="icon-button"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {theme === 'light' ? '☾' : '☀'}
    </button>
  )
}
