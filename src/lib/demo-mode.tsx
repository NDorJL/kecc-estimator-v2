/**
 * Demo Mode — blurs sensitive CRM data for screen sharing / presentations.
 * Toggle via the eye icon in the app header. State persists in localStorage.
 * Any element with data-sensitive or className containing "demo-sensitive"
 * gets blurred when demo mode is active.
 */
import { createContext, useContext, useState, useEffect } from 'react'

interface DemoModeContextValue {
  demoMode: boolean
  toggleDemoMode: () => void
}

const DemoModeContext = createContext<DemoModeContextValue>({
  demoMode: false,
  toggleDemoMode: () => {},
})

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const [demoMode, setDemoMode] = useState<boolean>(() => {
    try { return localStorage.getItem('kecc-demo-mode') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('kecc-demo-mode', String(demoMode)) } catch {}
    // Toggle a class on the root so CSS can target [data-sensitive] globally
    document.documentElement.classList.toggle('demo-mode', demoMode)
  }, [demoMode])

  return (
    <DemoModeContext.Provider value={{ demoMode, toggleDemoMode: () => setDemoMode(d => !d) }}>
      {children}
    </DemoModeContext.Provider>
  )
}

export function useDemoMode(): DemoModeContextValue {
  return useContext(DemoModeContext)
}
