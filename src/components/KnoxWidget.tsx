import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'wouter'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { X, Send, Loader2, ImagePlus, XCircle } from 'lucide-react'
import { apiGet } from '@/lib/queryClient'

// ── Write tool names — used for cache invalidation after Knox acts ────────────
const WRITE_TOOL_NAMES = new Set([
  'create_contact', 'update_contact', 'add_property', 'create_lead', 'update_lead_stage', 'add_note',
  'queue_sms', 'complete_job', 'schedule_job', 'batch_queue_review_requests',
  'remember_fact',
])

// ── Knox logo image (placed at /public/knox-logo.png) ─────────────────────────
function KnoxLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/knox-logo.png"
      alt="Knox"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      style={{ imageRendering: 'auto' }}
    />
  )
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  images?: string[]      // base64 strings attached to user messages
  streaming?: boolean    // true while response is being streamed
}

const STORAGE_KEY = 'knox-messages'
const MAX_STORED  = 30  // cap stored messages to avoid localStorage limits

// ── Page label from URL ───────────────────────────────────────────────────────
function pageLabel(location: string): string {
  const map: Record<string, string> = {
    '/': 'Dashboard', '/leads': 'Leads', '/contacts': 'Contacts',
    '/calendar': 'Calendar', '/jobs': 'Jobs', '/quotes': 'Quotes',
    '/subscriptions': 'Subscriptions', '/finance': 'Finance',
    '/marketing': 'Marketing', '/calculator': 'Calculator',
    '/pricebook': 'Price Book', '/settings': 'Settings',
    '/scratchpad': 'Scratch Pad', '/contractors': 'Contractors',
  }
  if (map[location]) return map[location]
  const prefix = Object.keys(map)
    .filter(k => k !== '/' && location.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? map[prefix] : location
}

// ── Parse record type + ID from URL (e.g. /contacts/uuid) ────────────────────
function parseRecordFromPath(location: string): { type: string; id: string } | null {
  const m = location.match(/^\/(contacts|leads|jobs|quotes)\/([a-f0-9-]{36})$/)
  return m ? { type: m[1], id: m[2] } : null
}

export function KnoxWidget() {
  const [location]   = useLocation()
  const qc           = useQueryClient()
  const { toast }    = useToast()

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [open,       setOpen]      = useState(false)
  const [input,      setInput]     = useState('')
  const [loading,    setLoading]   = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error,      setError]     = useState<string | null>(null)

  // ── Messages — load from localStorage on mount ────────────────────────────────
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    try {
      const toStore = messages
        .filter(m => !m.streaming)
        .slice(-MAX_STORED)
        .map(m => ({ role: m.role, content: m.content })) // strip images to save space
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
    } catch { /* quota exceeded — ignore */ }
  }, [messages])

  // ── Image picker ──────────────────────────────────────────────────────────────
  const [pendingImage, setPendingImage] = useState<string | null>(null)  // base64
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setPendingImage((ev.target?.result as string).split(',')[1] ?? null)
    reader.readAsDataURL(file)
    e.target.value = ''  // reset so same file can be picked again
  }

  // ── Context injection — fetch record label from URL ───────────────────────────
  const [recordLabel, setRecordLabel] = useState<string | undefined>(undefined)

  useEffect(() => {
    const rec = parseRecordFromPath(location)
    if (!rec) { setRecordLabel(undefined); return }

    apiGet<{ name?: string; customerName?: string; serviceName?: string }>(
      `/${rec.type}/${rec.id}`
    ).then(data => {
      setRecordLabel(data?.name ?? data?.customerName ?? data?.serviceName ?? undefined)
    }).catch(() => setRecordLabel(undefined))
  }, [location])

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, statusText])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && open) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // ── Send message via streaming endpoint ───────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if ((!text && !pendingImage) || loading) return

    // Build user message (multimodal if image attached)
    const userMsg: Message = pendingImage
      ? {
          role: 'user',
          content: text || '(image attached)',
          images: [pendingImage],
        }
      : { role: 'user', content: text }

    const msgContent = pendingImage
      ? [
          { type: 'text' as const, text: text || 'What do you see in this image?' },
          { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${pendingImage}` } },
        ]
      : text

    // History for the API — map to API format
    const apiMessages = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.images?.length
        ? [
            { type: 'text', text: m.content },
            ...m.images.map(img => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } }))
          ]
        : m.content,
    }))
    // Replace last user message with properly formatted content
    apiMessages[apiMessages.length - 1].content = msgContent

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setPendingImage(null)
    setLoading(true)
    setStatusText(null)
    setError(null)

    // Add streaming placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    try {
      const res = await fetch('/.netlify/functions/agent-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          context: {
            page:        pageLabel(location),
            recordLabel: recordLabel ?? undefined,
          },
        }),
      })

      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf       = ''
      let curEvent  = ''
      let streamedText = ''
      let toolsUsed: string[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.trim()) continue
          const lines = part.split('\n')

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              curEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              let parsed: Record<string, unknown>
              try { parsed = JSON.parse(line.slice(6)) } catch { continue }

              if (curEvent === 'status') {
                setStatusText(parsed.text as string)

              } else if (curEvent === 'token') {
                streamedText += parsed.text as string
                setMessages(prev => {
                  const next = [...prev]
                  next[next.length - 1] = { role: 'assistant', content: streamedText, streaming: true }
                  return next
                })

              } else if (curEvent === 'done') {
                toolsUsed = (parsed.toolsUsed as string[]) ?? []
                setMessages(prev => {
                  const next = [...prev]
                  next[next.length - 1] = { role: 'assistant', content: streamedText }
                  return next
                })
                setStatusText(null)

                // Write action feedback — invalidate CRM caches + toast
                const hadWrite = toolsUsed.some(t => WRITE_TOOL_NAMES.has(t))
                if (hadWrite) {
                  qc.invalidateQueries({ queryKey: ['/leads'] })
                  qc.invalidateQueries({ queryKey: ['/contacts'] })
                  qc.invalidateQueries({ queryKey: ['/jobs'] })
                  qc.invalidateQueries({ queryKey: ['/quotes'] })
                  qc.invalidateQueries({ queryKey: ['/subscriptions'] })
                  toast({ title: '✓ Knox made changes', description: 'CRM data has been updated.' })
                }

              } else if (curEvent === 'error') {
                setError(parsed.message as string)
                setMessages(prev => prev.filter(m => !m.streaming))
              }
            }
          }
        }
      }
    } catch (err) {
      setError('Could not reach Knox. Check your connection.')
      setMessages(prev => prev.filter(m => !m.streaming))
    } finally {
      setLoading(false)
      setStatusText(null)
    }
  }, [input, pendingImage, loading, messages, location, recordLabel, qc, toast])

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function clearChat() {
    setMessages([])
    setError(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  const hasMessages = messages.length > 0

  return (
    <>
      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-24 right-4 sm:right-6 z-50 flex flex-col rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden"
          style={{ width: 'min(380px, calc(100vw - 32px))', height: 'min(540px, calc(100dvh - 140px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card shrink-0">
            <div className="flex items-center gap-2.5">
              <KnoxLogo size={72} className="shrink-0" />
              <div>
                <p className="text-sm font-semibold leading-none">Knox</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">KECC AI Assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasMessages && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground px-2" onClick={clearChat}>
                  Clear
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
            style={{ overscrollBehavior: 'contain' }}
          >
            {/* Empty state */}
            {!hasMessages && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-4">
                <KnoxLogo size={160} />
                <div>
                  <p className="text-sm font-semibold">Hey, I'm Knox.</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Ask me anything about your leads, jobs, contacts, or quotes. I can look up gate codes, check today's route, pull up unsigned quotes, and more.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 w-full mt-1">
                  {[
                    "Give me my daily briefing",
                    "Compare this week vs last week",
                    "Any unsigned quotes over $500?",
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
                  <KnoxLogo size={56} className="shrink-0 mt-0.5 mr-1.5" />
                )}
                <div className={`flex flex-col gap-1.5 max-w-[82%]`}>
                  {/* Image thumbnail for user messages */}
                  {msg.images?.map((img, ii) => (
                    <img key={ii} src={`data:image/jpeg;base64,${img}`} alt="attached" className="rounded-xl max-h-40 object-cover" />
                  ))}
                  {msg.content && (
                    <div
                      className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-muted text-foreground rounded-bl-sm'
                      } ${msg.streaming ? 'animate-pulse' : ''}`}
                    >
                      {msg.content}
                      {msg.streaming && <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse rounded-sm" />}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Status / loading indicator */}
            {loading && !messages.some(m => m.streaming) && (
              <div className="flex justify-start">
                <KnoxLogo size={56} className="shrink-0 mt-0.5 mr-2" />
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-2">
                  {statusText ? (
                    <span className="text-xs text-muted-foreground italic">{statusText}</span>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Status during streaming (tool calls still happening) */}
            {statusText && messages.some(m => m.streaming) && (
              <p className="text-[10px] text-muted-foreground/60 italic text-center">{statusText}</p>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Pending image preview */}
          {pendingImage && (
            <div className="px-3 pb-1 shrink-0 flex items-center gap-2">
              <div className="relative">
                <img src={`data:image/jpeg;base64,${pendingImage}`} alt="pending" className="h-12 w-12 rounded-lg object-cover border border-border/60" />
                <button
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive flex items-center justify-center"
                  onClick={() => setPendingImage(null)}
                >
                  <XCircle className="h-3 w-3 text-white" />
                </button>
              </div>
              <span className="text-xs text-muted-foreground">Image attached</span>
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 px-3 py-3 border-t border-border/60">
            <div className="flex gap-2 items-end">
              {/* Image picker button */}
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                title="Attach image"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />

              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask Knox anything…"
                disabled={loading}
                className="flex-1 resize-none rounded-xl border border-border/60 bg-muted/40 px-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50 max-h-[120px] overflow-y-auto"
                style={{ minHeight: '38px', fontSize: '16px' }}
                onInput={e => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
                }}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl"
                disabled={(!input.trim() && !pendingImage) || loading}
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
        className={`fixed bottom-6 right-4 sm:right-6 z-50 flex items-center justify-center transition-all duration-200 ${
          open
            ? 'h-11 w-11 rounded-full bg-card/80 border border-border/60 shadow-lg scale-90'
            : 'hover:scale-110 active:scale-95 drop-shadow-lg'
        }`}
        style={open ? {} : { width: 128, height: 128 }}
        aria-label={open ? 'Close Knox' : 'Open Knox AI Assistant'}
      >
        {open
          ? <X className="h-4 w-4 text-muted-foreground" />
          : <KnoxLogo size={128} />}
      </button>
    </>
  )
}
