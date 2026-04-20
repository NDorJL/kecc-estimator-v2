import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { LineItem } from '@/types'

interface QuoteContextType {
  cartItems: LineItem[]
  bundleDiscount: number
  addToCart: (items: LineItem[]) => void
  removeFromCart: (index: number) => void
  clearCart: () => void
  isCreatingQuote: boolean
  setIsCreatingQuote: (v: boolean) => void
  setBundleDiscount: (v: number) => void
}

const QuoteContext = createContext<QuoteContextType | null>(null)

export function QuoteProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<LineItem[]>([])
  const [isCreatingQuote, setIsCreatingQuote] = useState(false)
  const [bundleDiscount, setBundleDiscount] = useState(0)

  const addToCart = useCallback((items: LineItem[]) => {
    setCartItems((prev) => [...prev, ...items])
  }, [])

  const removeFromCart = useCallback((index: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearCart = useCallback(() => {
    setCartItems([])
    setBundleDiscount(0)
  }, [])

  return (
    <QuoteContext.Provider
      value={{ cartItems, bundleDiscount, addToCart, removeFromCart, clearCart, isCreatingQuote, setIsCreatingQuote, setBundleDiscount }}
    >
      {children}
    </QuoteContext.Provider>
  )
}

export function useQuoteContext(): QuoteContextType {
  const ctx = useContext(QuoteContext)
  if (!ctx) throw new Error('useQuoteContext must be used within QuoteProvider')
  return ctx
}
