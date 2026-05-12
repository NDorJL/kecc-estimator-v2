/**
 * Demo Mode — blurs sensitive CRM data for screen sharing / presentations.
 *
 * Two layers of protection:
 * 1. CSS: .demo-mode [data-sensitive] { filter: blur(8px) }
 *    Manually-tagged elements via <Sensitive> component.
 * 2. DOM scanner: MutationObserver watches the app root and auto-tags any
 *    text node that matches a currency or phone number pattern.
 *
 * Hover any blurred element to temporarily reveal it.
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

// Patterns to auto-detect sensitive content in text nodes
const CURRENCY_RE = /\$[\d,]+(\.\d{0,2})?/
const PHONE_RE    = /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/

function scanForSensitiveData(root: Element) {
  // Remove previously auto-tagged elements first
  root.querySelectorAll('[data-auto-sensitive]').forEach(el => {
    el.removeAttribute('data-sensitive')
    el.removeAttribute('data-auto-sensitive')
  })

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Text | null

  while ((node = walker.nextNode() as Text | null)) {
    const text = (node.textContent ?? '').trim()
    if (!text || text.length < 3) continue

    const parent = node.parentElement
    if (!parent) continue

    // Skip non-content elements and already-tagged elements
    const tag = parent.tagName.toUpperCase()
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA') continue
    if (parent.hasAttribute('data-sensitive')) continue

    if (CURRENCY_RE.test(text) || PHONE_RE.test(text)) {
      parent.setAttribute('data-sensitive', '')
      parent.setAttribute('data-auto-sensitive', '')
    }
  }
}

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const [demoMode, setDemoMode] = useState<boolean>(() => {
    try { return localStorage.getItem('kecc-demo-mode') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('kecc-demo-mode', String(demoMode)) } catch {}
    document.documentElement.classList.toggle('demo-mode', demoMode)

    const appRoot = document.getElementById('root')
    if (!appRoot) return

    if (!demoMode) {
      // Clear all auto-tagged elements
      appRoot.querySelectorAll('[data-auto-sensitive]').forEach(el => {
        el.removeAttribute('data-sensitive')
        el.removeAttribute('data-auto-sensitive')
      })
      return
    }

    // Initial scan
    scanForSensitiveData(appRoot)

    // Rescan whenever React re-renders the DOM
    // Debounce via rAF to avoid excessive scanning
    let rafId: number | null = null
    const observer = new MutationObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        scanForSensitiveData(appRoot)
        rafId = null
      })
    })

    observer.observe(appRoot, {
      childList:      true,
      subtree:        true,
      characterData:  false,
      attributes:     false,  // Don't re-trigger on our own data-sensitive writes
    })

    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
    }
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
