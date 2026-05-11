import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'wouter'
import { Button } from '@/components/ui/button'
import { X, Send, Loader2, Bot } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Pull the current page label from the URL so Knox has context
function pageLabel(location: string): string {
  const map: Record<string, string> = {
    '/':              'Dashboard',
    '/leads':         'Leads',
    '/contacts':      'Contacts',
    '/calendar':      'Calendar',
    '/jobs':          'Jobs',
    '/quotes':        'Quotes',
    '/subscriptions': 'Subscriptions',
    '/finance':       'Finance',
    '/marketing':     'Marketing',
    '/calculator':    'Calculator',
    '/pricebook':     'Price Book',
    '/settings':      'Settings',
    '/scratchpad':    'Scratch Pad',
    '/contractors':   'Contractors',
  }
  if (map[location]) return map[location]
  const prefix = Object.keys(map)
    .filter(k => k !== '/' && location.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? map[prefix] : location
}

export function KnoxWidget() {
  const [location] = useLocation()
  const [open,      setOpen]      = useState(false)
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [messages,  setMessages]  = useState<Message[]>([])
  const [error,     setError]     = useState<string | null>(null)
  const messagesEndRef  = useRef<HTMLDivElement>(null)
  const inputRef        = useRef<HTMLTextAreaElement>(null)
  const panelRef        = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: 'user', content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/.netlify/functions/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updated,
          context: { page: pageLabel(location) },
        }),
      })

      const data = await res.json()

      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong')
        return
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch {
      setError('Could not reach Knox. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Send on Enter, new line on Shift+Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearChat() {
    setMessages([])
    setError(null)
  }

  const hasMessages = messages.length > 0

  return (
    <>
      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-24 right-4 sm:right-6 z-50 flex flex-col rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden"
          style={{ width: 'min(380px, calc(100vw - 32px))', height: 'min(540px, calc(100dvh - 140px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="text-[11px] font-black text-primary-foreground">K</span>
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">Knox</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">KECC AI Assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasMessages && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
                  onClick={clearChat}
                >
                  Clear
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {/* Empty state */}
            {!hasMessages && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Hey, I'm Knox.</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Ask me anything about your leads, jobs, contacts, or quotes. I can look up gate codes, check today's route, pull up unsigned quotes, and more.
                  </p>
                </div>
                {/* Starter prompts */}
                <div className="flex flex-col gap-1.5 w-full mt-1">
                  {[
                    "What's my route today?",
                    "Any unsigned quotes over $500?",
                    "How many open leads do I have?",
                  ].map(prompt => (
                    <button
                      key={prompt}
                      className="w-full text-left text-xs rounded-lg border border-border/60 bg-muted/40 px-3 py-2 hover:bg-muted transition-colors"
                      onClick={() => { setInput(prompt); inputRef.current?.focus() }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message bubbles */}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5 mr-2">
                    <span className="text-[9px] font-black text-primary-foreground">K</span>
                  </div>
                )}
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5 mr-2">
                  <span className="text-[9px] font-black text-primary-foreground">K</span>
                </div>
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 px-3 py-3 border-t border-border/60">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask Knox anything…"
                disabled={loading}
                className="flex-1 resize-none rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50 max-h-[120px] overflow-y-auto"
                style={{ minHeight: '38px' }}
                onInput={e => {
                  // Auto-grow
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
                }}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl"
                disabled={!input.trim() || loading}
                onClick={sendMessage}
              >
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/40 text-center mt-1.5">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      )}

      {/* ── Toggle button ────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-4 sm:right-6 z-50 h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open
            ? 'bg-muted border border-border/60 scale-90'
            : 'bg-primary hover:bg-primary/90 active:scale-95'
        }`}
        aria-label={open ? 'Close Knox' : 'Open Knox AI Assistant'}
      >
        {open
          ? <X className="h-5 w-5 text-muted-foreground" />
          : <span className="text-base font-black text-primary-foreground tracking-tight">K</span>}
      </button>
    </>
  )
}
