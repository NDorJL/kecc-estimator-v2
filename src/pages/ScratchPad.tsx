import { useState, useEffect } from 'react'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'kecc-scratchpad'

export default function ScratchPad() {
  const [text, setText] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')

  // Persist to localStorage on every change — survives page navigation
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, text)
  }, [text])

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Scratch Pad</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Jot down anything — stays here until you clear it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setText('')}
          className="gap-2 min-h-[36px] shrink-0"
        >
          <Eraser className="h-4 w-4" />
          Clear
        </Button>
      </div>

      {/* Text area — fills all remaining vertical space */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Start typing…"
        spellCheck
        className="flex-1 w-full resize-none rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground/50 p-4 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
      />

      {/* Subtle character count */}
      {text.length > 0 && (
        <p className="text-[10px] text-muted-foreground/60 text-right shrink-0 -mt-1">
          {text.length.toLocaleString()} characters · {text.split(/\n/).length} lines
        </p>
      )}
    </div>
  )
}
