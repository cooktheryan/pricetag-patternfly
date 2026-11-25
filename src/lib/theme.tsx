import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ContrastMode = 'system' | 'default' | 'high' | 'glass'
export type ResolvedTheme = 'light' | 'dark'
export type ResolvedContrast = 'default' | 'high' | 'glass'

const THEME_KEY = 'pricetag-theme'
const CONTRAST_KEY = 'pricetag-contrast'

/** Read the persisted preference, falling back to the OS setting. */
export function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage can be disabled (private mode); the OS preference still works.
  }
  return 'system'
}

export function readStoredContrast(): ContrastMode {
  try {
    const stored = window.localStorage.getItem(CONTRAST_KEY)
    if (stored === 'system' || stored === 'default' || stored === 'high' || stored === 'glass') {
      return stored
    }
  } catch {
    // Storage can be disabled (private mode); the OS preference still works.
  }
  return 'system'
}

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function prefersHighContrast(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-contrast: more)').matches
  )
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode
}

function resolveContrast(mode: ContrastMode): ResolvedContrast {
  if (mode === 'system') return prefersHighContrast() ? 'high' : 'default'
  return mode
}

function applyTheme(theme: ResolvedTheme, contrast: ResolvedContrast): void {
  const root = document.documentElement
  root.classList.toggle('pf-v6-theme-dark', theme === 'dark')
  root.classList.toggle('pf-v6-theme-high-contrast', contrast === 'high')
  root.classList.toggle('pf-v6-theme-glass', contrast === 'glass')
  root.dataset.theme = theme
  root.dataset.contrast = contrast
}

/**
 * Apply the stored/system theme before the first React render so the app does
 * not flash a light shell for users who prefer dark. Called from main.tsx.
 */
export function initTheme(): void {
  applyTheme(resolveTheme(readStoredTheme()), resolveContrast(readStoredContrast()))
}

interface ThemeContextValue {
  mode: ThemeMode
  contrast: ContrastMode
  resolved: ResolvedTheme
  resolvedContrast: ResolvedContrast
  setMode: (mode: ThemeMode) => void
  setContrast: (mode: ContrastMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredTheme)
  const [contrast, setContrastState] = useState<ContrastMode>(readStoredContrast)
  const [systemDark, setSystemDark] = useState(prefersDark)
  const [systemHighContrast, setSystemHighContrast] = useState(prefersHighContrast)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-contrast: more)')
    const onChange = () => setSystemHighContrast(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  const resolvedContrast: ResolvedContrast =
    contrast === 'system' ? (systemHighContrast ? 'high' : 'default') : contrast

  useEffect(() => {
    applyTheme(resolved, resolvedContrast)
  }, [resolved, resolvedContrast])

  const setMode = useCallback((next: ThemeMode) => {
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // Persisting is best-effort; the in-memory preference still applies.
    }
    setModeState(next)
  }, [])

  const setContrast = useCallback((next: ContrastMode) => {
    try {
      window.localStorage.setItem(CONTRAST_KEY, next)
    } catch {
      // Persisting is best-effort; the in-memory preference still applies.
    }
    setContrastState(next)
  }, [])

  const value = useMemo(
    () => ({ mode, contrast, resolved, resolvedContrast, setMode, setContrast }),
    [mode, contrast, resolved, resolvedContrast, setMode, setContrast],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider')
  }
  return value
}
