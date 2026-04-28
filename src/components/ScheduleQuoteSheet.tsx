/**
 * ScheduleQuoteSheet
 *
 * A bottom sheet that lets you book a job directly from a signed quote.
 * Supports multi-service quotes — each service chip maps to one scheduled day.
 * Appears on both the Quotes page and the Leads pipeline lead-detail sheet.
 * On submit it POSTs /jobs, which automatically advances the linked lead
 * to the "Scheduled" kanban column via the jobs.ts → _leadSync.ts pipeline.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/lib/queryClient'
import { Quote, LineItem } from '@/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CalendarDays, Clock, MapPin, User, CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type Window = 'morning' | 'afternoon' | 'anytime'

const WINDOWS: { id: Window; label: string; sub: string }[] = [
  { id: 'morning',   label: 'Morning',   sub: '8 am – 12 pm' },
  { id: 'afternoon', label: 'Afternoon', sub: '12 pm – 5 pm'  },
  { id: 'anytime',   label: 'Any Time',  sub: 'Flexible'      },
]

interface Props {
  quote: Quote
  open: boolean
  onClose: () => void
}

export function ScheduleQuoteSheet({ quote, open, onClose }: Props) {
  const { toast } = useToast()
  const qc = useQueryClient()

  // All schedulable line items (one-time services and subscriptions both count)
  const lineItems: LineItem[] = Array.isArray(quote.lineItems) ? quote.lineItems : []

  // Default: first line item, or fallback to quote type label
  const defaultService =
    lineItems.length > 0 ? lineItems[0].serviceName : quote.quoteType

  const [selectedService, setSelectedService] = useState<string>(defaultService)
  const [customService, setCustomService]     = useState('')   // shown only when no line items
  const [date, setDate]       = useState('')
  const [window, setWindow]   = useState<Window>('anytime')
  const [time, setTime]       = useState('')
  const [notes, setNotes]     = useState('')

  function reset() {
    setSelectedService(defaultService)
    setCustomService('')
    setDate('')
    setWindow('anytime')
    setTime('')
    setNotes('')
  }

  const effectiveService = lineItems.length > 0 ? selectedService : (customService || defaultService)

  const scheduleMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/jobs', {
        jobType:         'one_time',
        serviceName:     effectiveService,
        status:          'scheduled',
        scheduledDate:   date || null,
        scheduledWindow: window,
        scheduledTime:   time || null,
        customerName:    quote.customerName,
        customerAddress: quote.customerAddress ?? null,
        customerPhone:   quote.customerPhone ?? null,
        customerEmail:   quote.customerEmail ?? null,
        contactId:       quote.contactId ?? null,
        quoteId:         quote.id,
        notes:           notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobs'] })
      qc.invalidateQueries({ queryKey: ['/leads'] })
      const dateLabel = date
        ? new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : 'TBD'
      toast({
        title: 'Job scheduled',
        description: `${effectiveService} for ${quote.customerName} — ${dateLabel}`,
      })
      reset()
      onClose()
    },
    onError: (err: Error) =>
      toast({ title: 'Failed to schedule', description: err.message, variant: 'destructive' }),
  })

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Schedule a Day
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Each tap schedules one service on one day. Come back to add more days for other services.
          </p>
        </SheetHeader>

        {/* Customer summary — read-only */}
        <div className="rounded-xl border bg-muted/30 p-3 mb-4 space-y-1">
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold">{quote.customerName}</span>
          </div>
          {quote.customerAddress && (
            <div className="flex items-start gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs text-muted-foreground">{quote.customerAddress}</span>
            </div>
          )}
        </div>

        <div className="space-y-4">

          {/* ── Service picker (from quote line items) ─────────────────────── */}
          {lineItems.length > 0 ? (
            <div>
              <Label className="text-xs mb-2 block">Which service is this day for?</Label>
              <div className="flex flex-wrap gap-2">
                {lineItems.map((li, i) => {
                  const isSelected = selectedService === li.serviceName
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedService(li.serviceName)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                      {li.serviceName}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs mb-1 block">Service</Label>
              <Input
                value={customService}
                onChange={e => setCustomService(e.target.value)}
                placeholder="Service name"
              />
            </div>
          )}

          {/* Date */}
          <div>
            <Label className="text-xs mb-1 block">Date</Label>
            <Input
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setDate(e.target.value)}
            />
          </div>

          {/* Time window */}
          <div>
            <Label className="text-xs mb-2 block">Arrival Window</Label>
            <div className="grid grid-cols-3 gap-2">
              {WINDOWS.map(w => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWindow(w.id)}
                  className={`rounded-xl border py-2.5 px-2 text-center transition-all ${
                    window === w.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  <p className="text-xs font-semibold">{w.label}</p>
                  <p className="text-[10px] mt-0.5 opacity-70">{w.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Specific time (optional) */}
          <div>
            <Label className="text-xs mb-1 block">
              Specific Time <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs mb-1 block">Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Contractor, gate code, special instructions…"
              rows={2}
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!date || scheduleMutation.isPending}
            onClick={() => scheduleMutation.mutate()}
          >
            {scheduleMutation.isPending
              ? 'Scheduling…'
              : `Schedule ${effectiveService}`}
          </Button>
          {!date && (
            <p className="text-xs text-muted-foreground text-center -mt-2">Pick a date to continue</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
