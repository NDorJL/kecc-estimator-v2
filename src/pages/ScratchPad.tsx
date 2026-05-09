import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet, apiRequest } from '@/lib/queryClient'
import type { CompanySettings } from '@/types'

export default function ScratchPad() {
  const queryClient = useQueryClient()

  // ── Fetch from Supabase on mount ─────────────────────────────────────────
  const { data: settings, isLoading } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet<CompanySettings>('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  const [text, setText] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  // Hydrate from settings on first load — only once
  useEffect(() => {
    if (!initializedRef.current && settings !== undefined) {
      setText(settings.scratchpadContent ?? '')
      initializedRef.current = true
    }
  }, [settings])

  // ── Debounced auto-save (1 second after last keystroke) ──────────────────
  async function save(value: string) {
    setSaveStatus('saving')
    try {
      await apiRequest('PATCH', '/settings', { scratchpadContent: value })
      queryClient.setQueryData(['/settings'], (old: CompanySettings | undefined) =>
        old ? { ...old, scratchpadContent: value } : old
      )
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (_e) {
      setSaveStatus('idle')
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setText(value)
    setSaveStatus('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(value), 1000)
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setText('')
    save('')
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Scratch Pad</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Jot down anything — synced across devices, stays until you clear it.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Subtle save indicator */}
          {saveStatus === 'saving' && (
            <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-[10px] text-green-500 dark:text-green-400">Saved ✓</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="gap-2 min-h-[36px]"
            disabled={isLoading}
          >
            <Eraser className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      {/* Text area — fills all remaining vertical space */}
      <textarea
        value={text}
        onChange={handleChange}
        placeholder={isLoading ? 'Loading…' : 'Start typing…'}
        disabled={isLoading}
        spellCheck
        className="flex-1 w-full resize-none rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground/50 p-4 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring transition-shadow disabled:opacity-50"
      />

      {/* Character count */}
      {text.length > 0 && (
        <p className="text-[10px] text-muted-foreground/60 text-right shrink-0 -mt-1">
          {text.length.toLocaleString()} characters · {text.split(/\n/).length} lines
        </p>
      )}
    </div>
  )
}
