import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { LineItem } from '@/types'

interface QuoteContextType {
  cartItems: LineItem[]
  addToCart: (items: LineItem[]) => void
  removeFromCart: (index: number) => void
  clearCart: () => void
  isCreatingQuote: boolean
  setIsCreatingQuote: (v: boolean) => void
  prefillContactId: string | null
  setPrefillContactId: (id: string | null) => void
}

const QuoteContext = createContext<QuoteContextType | null>(null)

export function QuoteProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<LineItem[]>([])
  const [isCreatingQuote, setIsCreatingQuote] = useState(false)
  const [prefillContactId, setPrefillContactId] = useState<string | null>(null)

  const addToCart = useCallback((items: LineItem[]) => {
    setCartItems((prev) => [...prev, ...items])
  }, [])

  const removeFromCart = useCallback((index: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearCart = useCallback(() => {
    setCartItems([])
  }, [])

  return (
    <QuoteContext.Provider
      value={{ cartItems, addToCart, removeFromCart, clearCart, isCreatingQuote, setIsCreatingQuote, prefillContactId, setPrefillContactId }}
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
