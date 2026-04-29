import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { quoCallUrl } from '@/lib/utils'
import { Job, Subscription, Contractor, ServiceSchedule, Lead, Quote, LineItem } from '@/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  CalendarDays, MapPin, Phone, Mail, Wrench,
  ChevronRight, Clock, AlertCircle, CheckCircle2, RefreshCw, Calendar,
  CloudRain, UserCheck, FileText, Plus, Search, MessageSquare, ArrowLeft,
} from 'lucide-react'

type RescheduleReason = 'weather' | 'customer_request' | 'other'

// ── Window helpers (shared) ───────────────────────────────────────────────────
type ScheduleWindow = 'morning' | 'afternoon' | 'anytime'

const SCHEDULE_WINDOWS: { id: ScheduleWindow; label: string; sub: string }[] = [
  { id: 'morning',   label: 'Morning',   sub: '8 am – 12 pm' },
  { id: 'afternoon', label: 'Afternoon', sub: '12 pm – 5 pm' },
  { id: 'anytime',   label: 'Any Time',  sub: 'Flexible'     },
]
const WINDOW_LABELS: Record<ScheduleWindow, string> = {
  morning:   'in the morning (8 am–12 pm)',
  afternoon: 'in the afternoon (12 pm–5 pm)',
  anytime:   '',
}

function buildSmsMessage(opts: {
  firstName: string; serviceName: string; date: string
  window: ScheduleWindow; companyName: string
}) {
  const { firstName, serviceName, date, window, companyName } = opts
  const [yr, mo, dy] = date.split('-').map(Number)
  const d = new Date(yr, mo - 1, dy)
  const day = d.toLocaleDateString('en-US', { weekday: 'long' })
  const mon = d.toLocaleDateString('en-US', { month: 'long' })
  const win = WINDOW_LABELS[window] ? ` ${WINDOW_LABELS[window]}` : ''
  return (
    `Hi ${firstName}! Your ${serviceName} with ${companyName} is confirmed for ` +
    `${day}, ${mon} ${dy}, ${yr}${win}.\n\n` +
    `If you have any questions or need to make changes, just reply to this message.\n\n` +
    `Thank you for choosing ${companyName}!\n\nAutomated msg. Reply STOP to opt out.`
  )
}

// ── New Job Sheet (search → schedule) ────────────────────────────────────────
function NewJobSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: leads = [] } = useQuery<Lead[]>({ queryKey: ['/leads'], queryFn: () => apiGet('/leads'), enabled: open })
  const { data: quotes = [] } = useQuery<Quote[]>({ queryKey: ['/quotes'], queryFn: () => apiGet('/quotes'), enabled: open })

  // Build a lookup of quote by id
  const quoteById = useMemo(() => {
    const m: Record<string, Quote> = {}
    for (const q of quotes) m[q.id] = q
    return m
  }, [quotes])

  // All leads that have a signed quote — any stage, including scheduled
  const schedulableLeads = useMemo(() =>
    leads
      .filter(l => l.stage !== 'lost')
      .map(l => ({ lead: l, quote: l.quoteId ? quoteById[l.quoteId] : null }))
      .filter(({ quote }) => quote && !quote.trashedAt),
  [leads, quoteById])

  // Step 1: search
  const [search, setSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null)

  // Step 2: scheduling form
  const [service, setService]     = useState('')
  const [date, setDate]           = useState('')
  const [endDate, setEndDate]     = useState('')
  const [win, setWin]             = useState<ScheduleWindow>('anytime')
  const [time, setTime]           = useState('')
  const [notes, setNotes]         = useState('')

  // Step 3: SMS prompt
  const [showSms, setShowSms]         = useState(false)
  const [smsPending, setSmsPending]   = useState<{ phone: string; msg: string; contactId: string | null } | null>(null)

  const filteredLeads = useMemo(() => {
    if (!search.trim()) return schedulableLeads
    const q = search.toLowerCase()
    return schedulableLeads.filter(({ lead, quote }) =>
      quote?.customerName?.toLowerCase().includes(q) ||
      quote?.customerPhone?.includes(q) ||
      lead.serviceInterest?.toLowerCase().includes(q)
    )
  }, [schedulableLeads, search])

  function selectLead(lead: Lead, quote: Quote) {
    setSelectedLead(lead)
    setSelectedQuote(quote)
    const items: LineItem[] = Array.isArray(quote.lineItems) ? quote.lineItems : []
    setService(items.length > 0 ? items[0].serviceName : quote.quoteType ?? '')
  }

  function resetAll() {
    setSearch(''); setSelectedLead(null); setSelectedQuote(null)
    setService(''); setDate(''); setEndDate(''); setWin('anytime'); setTime(''); setNotes('')
    setShowSms(false); setSmsPending(null)
  }

  const scheduleMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/jobs', {
      jobType:         'one_time',
      serviceName:     service || (selectedQuote?.quoteType ?? ''),
      status:          'scheduled',
      scheduledDate:    date || null,
      scheduledEndDate: endDate || null,
      scheduledWindow:  win,
      scheduledTime:   time || null,
      customerName:    selectedQuote?.customerName ?? '',
      customerAddress: selectedQuote?.customerAddress ?? null,
      customerPhone:   selectedQuote?.customerPhone ?? null,
      customerEmail:   selectedQuote?.customerEmail ?? null,
      contactId:       selectedLead?.contactId ?? selectedQuote?.contactId ?? null,
      quoteId:         selectedQuote?.id ?? null,
      notes:           notes || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobs'] })
      qc.invalidateQueries({ queryKey: ['/leads'] })
      const label = date ? new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'TBD'
      toast({ title: 'Job scheduled', description: `${service} for ${selectedQuote?.customerName} — ${label}` })

      const phone = selectedQuote?.customerPhone
      if (phone && date) {
        const firstName = selectedQuote?.customerName?.split(' ')[0] ?? 'there'
        const msg = buildSmsMessage({ firstName, serviceName: service, date, window: win, companyName: 'Knox Exterior Care Co.' })
        setSmsPending({ phone, msg, contactId: selectedLead?.contactId ?? selectedQuote?.contactId ?? null })
        setShowSms(true)
      }
      resetAll()
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Failed to schedule', description: err.message, variant: 'destructive' }),
  })

  const sendSmsMutation = useMutation({
    mutationFn: (p: { to: string; message: string; contactId: string | null }) =>
      apiRequest('POST', '/sms', { action: 'send', to: p.to, message: p.message, contactId: p.contactId }),
    onSuccess: () => {
      toast({ title: 'Confirmation sent!', description: `Text delivered to ${smsPending?.phone}` })
      setShowSms(false); setSmsPending(null)
    },
    onError: (err: Error) => {
      toast({ title: 'SMS failed', description: err.message, variant: 'destructive' })
      setShowSms(false); setSmsPending(null)
    },
  })

  const lineItems: LineItem[] = Array.isArray(selectedQuote?.lineItems) ? selectedQuote!.lineItems : []

  const STAGE_COLORS: Record<string, string> = {
    new: 'bg-slate-100 text-slate-700', contacted: 'bg-blue-100 text-blue-700',
    follow_up: 'bg-orange-100 text-orange-700', quoted: 'bg-yellow-100 text-yellow-700',
    scheduled: 'bg-violet-100 text-violet-700', recurring: 'bg-indigo-100 text-indigo-700',
    finished_unpaid: 'bg-amber-100 text-amber-700', finished_paid: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <>
      <Sheet open={open} onOpenChange={v => { if (!v) { resetAll(); onClose() } }}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[92dvh] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              {selectedLead ? (
                <button onClick={() => { setSelectedLead(null); setSelectedQuote(null) }} className="mr-1">
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                </button>
              ) : (
                <CalendarDays className="h-5 w-5 text-primary" />
              )}
              {selectedLead ? `Schedule — ${selectedQuote?.customerName}` : 'New Job'}
            </SheetTitle>
          </SheetHeader>

          {!selectedLead ? (
            /* ── Step 1: Search for a lead ── */
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by customer name or phone…"
                  className="pl-9"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''} with active quotes
              </p>
              <div className="space-y-2 max-h-[55dvh] overflow-y-auto">
                {filteredLeads.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Search className="h-7 w-7 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No matching leads</p>
                    <p className="text-xs mt-1">Try a different name or phone number</p>
                  </div>
                ) : (
                  filteredLeads.map(({ lead, quote }) => (
                    <button
                      key={lead.id}
                      onClick={() => selectLead(lead, quote!)}
                      className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/40 active:scale-95 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{quote?.customerName}</p>
                          {quote?.customerPhone && (
                            <p className="text-xs text-muted-foreground">{quote.customerPhone}</p>
                          )}
                          {quote?.customerAddress && (
                            <p className="text-xs text-muted-foreground truncate">{quote.customerAddress}</p>
                          )}
                        </div>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STAGE_COLORS[lead.stage] ?? 'bg-muted text-muted-foreground'}`}>
                          {lead.stage.replace('_', ' ')}
                        </span>
                      </div>
                      {Array.isArray(quote?.lineItems) && quote!.lineItems.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {quote!.lineItems.map((li: LineItem) => li.serviceName).join(' · ')}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* ── Step 2: Scheduling form ── */
            <div className="space-y-4">
              {/* Customer info */}
              <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
                <p className="text-sm font-semibold">{selectedQuote?.customerName}</p>
                {selectedQuote?.customerPhone && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" />{selectedQuote.customerPhone}
                  </p>
                )}
                {selectedQuote?.customerAddress && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />{selectedQuote.customerAddress}
                  </p>
                )}
              </div>

              {/* Service picker */}
              {lineItems.length > 0 ? (
                <div>
                  <Label className="text-xs mb-2 block">Which service is this day for?</Label>
                  <div className="flex flex-wrap gap-2">
                    {lineItems.map((li, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setService(li.serviceName)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                          service === li.serviceName
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        {service === li.serviceName && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                        {li.serviceName}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <Label className="text-xs mb-1 block">Service</Label>
                  <Input value={service} onChange={e => setService(e.target.value)} placeholder="Service name" />
                </div>
              )}

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Start Date</Label>
                  <Input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">End Date <span className="text-muted-foreground font-normal">(multi-day)</span></Label>
                  <Input type="date" value={endDate} min={date || new Date().toISOString().slice(0, 10)} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              {endDate && date && endDate > date && (
                <p className="text-xs text-primary -mt-1">📅 {Math.round((new Date(endDate).getTime() - new Date(date).getTime()) / 86400000) + 1}-day job</p>
              )}

              {/* Arrival window */}
              <div>
                <Label className="text-xs mb-2 block">Arrival Window</Label>
                <div className="grid grid-cols-3 gap-2">
                  {SCHEDULE_WINDOWS.map(w => (
                    <button key={w.id} type="button" onClick={() => setWin(w.id)}
                      className={`rounded-xl border py-2.5 px-2 text-center transition-all ${
                        win === w.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      <p className="text-xs font-semibold">{w.label}</p>
                      <p className="text-[10px] mt-0.5 opacity-70">{w.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Specific time */}
              <div>
                <Label className="text-xs mb-1 block">Specific Time <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="flex-1" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <Label className="text-xs mb-1 block">Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Gate code, special instructions…" rows={2} />
              </div>

              <Button className="w-full" size="lg" disabled={!date || !service || scheduleMutation.isPending} onClick={() => scheduleMutation.mutate()}>
                {scheduleMutation.isPending ? 'Scheduling…' : `Schedule ${service || 'Job'}`}
              </Button>
              {!date && <p className="text-xs text-muted-foreground text-center -mt-2">Pick a date to continue</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* SMS confirmation dialog — independent of the sheet */}
      <Dialog open={showSms} onOpenChange={v => { if (!v) { setShowSms(false); setSmsPending(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Send a confirmation text?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Do you want to send an automated text to{' '}
              <span className="font-semibold text-foreground">{smsPending?.phone}</span>{' '}
              to confirm their appointment?
            </p>
            <div className="rounded-lg bg-muted/60 border p-3 max-h-40 overflow-y-auto">
              <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-mono">{smsPending?.msg}</p>
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button variant="outline" disabled={sendSmsMutation.isPending} onClick={() => { setShowSms(false); setSmsPending(null) }}>No, Skip</Button>
            <Button disabled={sendSmsMutation.isPending} onClick={() => smsPending && sendSmsMutation.mutate({ to: smsPending.phone, message: smsPending.msg, contactId: smsPending.contactId })}>
              {sendSmsMutation.isPending ? 'Sending…' : 'Yes, Send It'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const JOB_STATUS_COLORS: Record<string, string> = {
  scheduled:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  completed:   'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  cancelled:   'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

function JobStatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${JOB_STATUS_COLORS[status] ?? ''}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── One-Time Job Detail Sheet ────────────────────────────────────────────────

function JobDetailSheet({
  job,
  contractors,
  open,
  onClose,
}: {
  job: Job | null
  contractors: Contractor[]
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [form, setForm] = useState<{
    status: string
    scheduledDate: string
    scheduledEndDate: string
    contractorId: string
    notes: string
    internalNotes: string
    gateCode: string
    dogOnProperty: string
    parkingNotes: string
    pointOfContact: string
    altPhone: string
    altEmail: string
  }>({
    status: job?.status ?? 'scheduled',
    scheduledDate: job?.scheduledDate ?? '',
    scheduledEndDate: job?.scheduledEndDate ?? '',
    contractorId: job?.contractorId ?? '',
    notes: job?.notes ?? '',
    internalNotes: job?.internalNotes ?? '',
    gateCode: job?.propertyInfo?.gateCode ?? '',
    dogOnProperty: job?.propertyInfo?.dogOnProperty ?? '',
    parkingNotes: job?.propertyInfo?.parkingNotes ?? '',
    pointOfContact: job?.propertyInfo?.pointOfContact ?? '',
    altPhone: job?.propertyInfo?.altPhone ?? '',
    altEmail: job?.propertyInfo?.altEmail ?? '',
  })

  // Track original scheduled date to detect rescheduling
  const [originalScheduledDate, setOriginalScheduledDate] = useState<string>(job?.scheduledDate ?? '')

  // Re-sync form when job changes
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  if (job && job.id !== lastJobId) {
    setLastJobId(job.id)
    const newDate = job.scheduledDate ?? ''
    setOriginalScheduledDate(newDate)
    setForm({
      status: job.status,
      scheduledDate: newDate,
      scheduledEndDate: job.scheduledEndDate ?? '',
      contractorId: job.contractorId ?? '',
      notes: job.notes ?? '',
      internalNotes: job.internalNotes ?? '',
      gateCode: job.propertyInfo?.gateCode ?? '',
      dogOnProperty: job.propertyInfo?.dogOnProperty ?? '',
      parkingNotes: job.propertyInfo?.parkingNotes ?? '',
      pointOfContact: job.propertyInfo?.pointOfContact ?? '',
      altPhone: job.propertyInfo?.altPhone ?? '',
      altEmail: job.propertyInfo?.altEmail ?? '',
    })
  }

  // Reschedule reason dialog state
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false)
  const [rescheduleReason, setRescheduleReason] = useState<RescheduleReason>('weather')
  const [rescheduleText, setRescheduleText] = useState('')

  const doSaveJob = useMutation({
    mutationFn: () => apiRequest('PATCH', `/jobs/${job!.id}`, {
      status: form.status,
      scheduledDate: form.scheduledDate || null,
      scheduledEndDate: form.scheduledEndDate || null,
      contractorId: form.contractorId || null,
      notes: form.notes || null,
      internalNotes: form.internalNotes || null,
      propertyInfo: {
        gateCode: form.gateCode,
        dogOnProperty: form.dogOnProperty,
        parkingNotes: form.parkingNotes,
        pointOfContact: form.pointOfContact,
        altPhone: form.altPhone,
        altEmail: form.altEmail,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobs'] })
      toast({ title: 'Job saved' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const sendSmsMutation = useMutation({
    mutationFn: (payload: {
      to: string
      customerName: string
      serviceName: string
      oldDate: string
      newDate: string
      newWindow: string | null
      reasonType: RescheduleReason
      reasonText: string
      contactId: string | null
    }) => apiRequest('POST', '/sms', { action: 'reschedule-notification', ...payload }),
  })

  function handleSave() {
    if (!job) return
    const dateChanged = form.scheduledDate && form.scheduledDate !== originalScheduledDate && originalScheduledDate !== ''
    const isOneTime = job.jobType === 'one_time'
    const hasPhone = !!job.customerPhone

    if (dateChanged && isOneTime && hasPhone) {
      // Show reason picker before saving
      setRescheduleReason('weather')
      setRescheduleText('')
      setShowRescheduleDialog(true)
    } else {
      // No reschedule SMS needed — just save
      doSaveJob.mutate()
    }
  }

  async function confirmReschedule() {
    if (!job) return
    setShowRescheduleDialog(false)

    try {
      await sendSmsMutation.mutateAsync({
        to: job.customerPhone!,
        customerName: job.customerName ?? 'Customer',
        serviceName: job.serviceName,
        oldDate: originalScheduledDate,
        newDate: form.scheduledDate,
        newWindow: null,
        reasonType: rescheduleReason,
        reasonText: rescheduleText,
        contactId: job.contactId ?? null,
      })
      toast({ title: 'Reschedule notification sent', description: `SMS sent to ${job.customerPhone}` })
    } catch {
      toast({ title: 'SMS failed', description: 'Could not send reschedule notification, but the job will still be saved.', variant: 'destructive' })
    }

    doSaveJob.mutate()
  }

  if (!job) return null

  const contractor = contractors.find(c => c.id === form.contractorId)

  return (
    <>
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-base">{job.serviceName}</SheetTitle>
              <p className="text-sm text-muted-foreground">{job.customerName}</p>
            </div>
            <JobStatusBadge status={form.status} />
          </div>
        </SheetHeader>

        <div className="space-y-5">
          {/* Customer info (read-only display) */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            {job.customerAddress && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>{job.customerAddress}</span>
              </div>
            )}
            {job.customerPhone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <a href={quoCallUrl(job.customerPhone)} className="text-primary">{job.customerPhone}</a>
              </div>
            )}
            {job.customerEmail && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <a href={`mailto:${job.customerEmail}`} className="text-primary">{job.customerEmail}</a>
              </div>
            )}
          </div>

          {/* Status + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
              />
            </div>
          </div>

          {/* End date for multi-day jobs */}
          <div>
            <Label className="text-xs">End Date <span className="text-muted-foreground font-normal">(leave blank for single-day)</span></Label>
            <Input
              type="date"
              className="mt-1"
              value={form.scheduledEndDate}
              min={form.scheduledDate || undefined}
              onChange={e => setForm(f => ({ ...f, scheduledEndDate: e.target.value }))}
            />
            {form.scheduledEndDate && form.scheduledDate && form.scheduledEndDate > form.scheduledDate && (
              <p className="text-xs text-primary mt-1">
                📅 {Math.round((new Date(form.scheduledEndDate).getTime() - new Date(form.scheduledDate).getTime()) / 86400000) + 1}-day job
              </p>
            )}
          </div>

          {/* Contractor */}
          <div>
            <Label className="text-xs">Assigned Contractor</Label>
            <Select
              value={form.contractorId || '_none'}
              onValueChange={v => setForm(f => ({ ...f, contractorId: v === '_none' ? '' : v }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Unassigned</SelectItem>
                {contractors.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.specialty ? ` — ${c.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contractor && (
              <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
                {contractor.phone && <a href={quoCallUrl(contractor.phone)} className="flex items-center gap-1"><Phone className="h-3 w-3" />{contractor.phone}</a>}
                {contractor.ratePerJob && <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />${contractor.ratePerJob}/job</span>}
              </div>
            )}
          </div>

          {/* Property Info */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Property Details</p>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Gate Code</Label>
                <Input className="mt-1" value={form.gateCode} onChange={e => setForm(f => ({ ...f, gateCode: e.target.value }))} placeholder="e.g. #1234" />
              </div>
              <div>
                <Label className="text-xs">Dog on Property?</Label>
                <Input className="mt-1" value={form.dogOnProperty} onChange={e => setForm(f => ({ ...f, dogOnProperty: e.target.value }))} placeholder="Yes / No / Details" />
              </div>
              <div>
                <Label className="text-xs">Parking / Access Notes</Label>
                <Input className="mt-1" value={form.parkingNotes} onChange={e => setForm(f => ({ ...f, parkingNotes: e.target.value }))} placeholder="Street parking, driveway OK, etc." />
              </div>
            </div>
          </div>

          {/* Point of Contact */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Alternate Contact</p>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Name / Role</Label>
                <Input className="mt-1" value={form.pointOfContact} onChange={e => setForm(f => ({ ...f, pointOfContact: e.target.value }))} placeholder="Property manager, spouse, etc." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input className="mt-1" value={form.altPhone} onChange={e => setForm(f => ({ ...f, altPhone: e.target.value }))} placeholder="555-000-0000" />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input className="mt-1" value={form.altEmail} onChange={e => setForm(f => ({ ...f, altEmail: e.target.value }))} placeholder="alt@email.com" />
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs">Job Notes (customer-visible)</Label>
            <Textarea className="mt-1" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes visible to crew…" />
          </div>
          <div>
            <Label className="text-xs">Internal Notes</Label>
            <Textarea className="mt-1" rows={2} value={form.internalNotes} onChange={e => setForm(f => ({ ...f, internalNotes: e.target.value }))} placeholder="Internal only — pricing, flags, history…" />
          </div>

          <Button
            className="w-full"
            disabled={doSaveJob.isPending || sendSmsMutation.isPending}
            onClick={handleSave}
          >
            {doSaveJob.isPending || sendSmsMutation.isPending ? 'Saving…' : 'Save Job'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>

    {/* ── Reschedule Reason Dialog ─────────────────────────────────────── */}
    <Sheet open={showRescheduleDialog} onOpenChange={v => { if (!v) setShowRescheduleDialog(false) }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base">Notify Customer of Reschedule</SheetTitle>
          <p className="text-sm text-muted-foreground">
            An SMS will be sent to {job?.customerPhone} about the new date.
          </p>
        </SheetHeader>

        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason for rescheduling</p>

          <div className="space-y-2">
            {/* Weather */}
            <button
              onClick={() => setRescheduleReason('weather')}
              className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                rescheduleReason === 'weather'
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/40'
              }`}
            >
              <CloudRain className={`h-5 w-5 shrink-0 ${rescheduleReason === 'weather' ? 'text-primary' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">Weather Conditions</p>
                <p className="text-xs text-muted-foreground">Rain, wind, or unsafe conditions</p>
              </div>
            </button>

            {/* Customer Request */}
            <button
              onClick={() => setRescheduleReason('customer_request')}
              className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                rescheduleReason === 'customer_request'
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/40'
              }`}
            >
              <UserCheck className={`h-5 w-5 shrink-0 ${rescheduleReason === 'customer_request' ? 'text-primary' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">Customer Request</p>
                <p className="text-xs text-muted-foreground">Customer asked to move the appointment</p>
              </div>
            </button>

            {/* Other */}
            <button
              onClick={() => setRescheduleReason('other')}
              className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                rescheduleReason === 'other'
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/40'
              }`}
            >
              <FileText className={`h-5 w-5 shrink-0 ${rescheduleReason === 'other' ? 'text-primary' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">Other Reason</p>
                <p className="text-xs text-muted-foreground">Specify a custom reason below</p>
              </div>
            </button>
          </div>

          {rescheduleReason === 'other' && (
            <div>
              <Label className="text-xs">Custom Reason</Label>
              <Textarea
                className="mt-1"
                rows={2}
                placeholder="e.g. Equipment issue, crew unavailable…"
                value={rescheduleText}
                onChange={e => setRescheduleText(e.target.value)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" onClick={() => { setShowRescheduleDialog(false); doSaveJob.mutate() }}>
              Skip SMS · Just Save
            </Button>
            <Button
              onClick={confirmReschedule}
              disabled={rescheduleReason === 'other' && !rescheduleText.trim()}
            >
              Send &amp; Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
    </>
  )
}

// ── Subscription Schedule Sheet ───────────────────────────────────────────────
// Lets the user configure when each service recurs and who does it

function SubscriptionScheduleSheet({
  sub,
  contractors,
  open,
  onClose,
}: {
  sub: Subscription | null
  contractors: Contractor[]
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [schedules, setSchedules] = useState<ServiceSchedule[]>(sub?.serviceSchedules ?? [])
  const [lastSubId, setLastSubId] = useState<string | null>(null)
  if (sub && sub.id !== lastSubId) {
    setLastSubId(sub.id)
    // Seed schedules from existing config, or generate defaults from services
    const existing = sub.serviceSchedules ?? []
    const seeded = sub.services.map(svc => {
      const found = existing.find(s => s.serviceId === svc.id)
      return found ?? {
        serviceId: svc.id,
        serviceName: svc.serviceName,
        frequency: svc.frequency,
        dayOfWeek: 1, // default Monday
        startDate: new Date().toISOString().slice(0, 10),
        contractorId: null,
      }
    })
    setSchedules(seeded)
  }

  const saveMutation = useMutation({
    mutationFn: () => apiRequest('PATCH', `/subscriptions/${sub!.id}`, { serviceSchedules: schedules }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/subscriptions'] })
      toast({ title: 'Schedule saved' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  function updateSchedule(serviceId: string, patch: Partial<ServiceSchedule>) {
    setSchedules(prev => prev.map(s => s.serviceId === serviceId ? { ...s, ...patch } : s))
  }

  if (!sub) return null

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Configure Schedule</SheetTitle>
          <p className="text-sm text-muted-foreground">{sub.customerName}</p>
        </SheetHeader>

        <div className="space-y-5">
          <p className="text-xs text-muted-foreground">
            Set the day and start date for each service. The calendar will auto-populate all future occurrences based on frequency.
          </p>

          {schedules.map(sch => {
            const contractor = contractors.find(c => c.id === sch.contractorId)
            return (
              <div key={sch.serviceId} className="rounded-xl border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{sch.serviceName}</p>
                  <Badge variant="secondary" className="text-xs">{sch.frequency}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Day of Week</Label>
                    <Select
                      value={String(sch.dayOfWeek)}
                      onValueChange={v => updateSchedule(sch.serviceId, { dayOfWeek: Number(v) })}
                    >
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Start Date</Label>
                    <Input
                      type="date"
                      className="mt-1"
                      value={sch.startDate}
                      onChange={e => updateSchedule(sch.serviceId, { startDate: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Assigned Contractor</Label>
                  <Select
                    value={sch.contractorId ?? '_none'}
                    onValueChange={v => updateSchedule(sch.serviceId, { contractorId: v === '_none' ? null : v })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {contractors.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}{c.specialty ? ` — ${c.specialty}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {contractor?.phone && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Phone className="h-3 w-3" />{contractor.phone}
                    </p>
                  )}
                </div>
              </div>
            )
          })}

          <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : 'Save Schedule'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Subscription card ────────────────────────────────────────────────────────

function SubJobCard({ sub, onConfigure }: { sub: Subscription; onConfigure: () => void }) {
  const scheduled = sub.serviceSchedules?.length > 0
  return (
    <button
      onClick={onConfigure}
      className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/40 active:scale-95 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{sub.customerName}</p>
          {sub.customerAddress && <p className="text-xs text-muted-foreground truncate">{sub.customerAddress}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sub.status === 'ACTIVE' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
            {sub.status}
          </span>
          {scheduled
            ? <span className="text-xs text-green-600 flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3" />Scheduled</span>
            : <span className="text-xs text-amber-600 flex items-center gap-0.5"><AlertCircle className="h-3 w-3" />No schedule</span>
          }
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {sub.services.map(svc => (
          <Badge key={svc.id} variant="secondary" className="text-xs">{svc.serviceName} · {svc.frequency}</Badge>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">${sub.inSeasonMonthlyTotal.toFixed(0)}/mo</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  )
}

// ── One-time job card ────────────────────────────────────────────────────────

function OneTimeJobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const hasDate = !!job.scheduledDate
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/40 active:scale-95 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{job.customerName ?? 'Unknown'}</p>
          <p className="text-xs text-muted-foreground truncate">{job.serviceName}</p>
          {job.customerAddress && <p className="text-xs text-muted-foreground truncate">{job.customerAddress}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <JobStatusBadge status={job.status} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        {hasDate
          ? <span className="text-xs text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(job.scheduledDate + 'T12:00:00').toLocaleDateString()}</span>
          : <span className="text-xs text-amber-600 flex items-center gap-1"><Clock className="h-3 w-3" />No date set</span>
        }
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Jobs() {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null)
  const [showNewJob, setShowNewJob] = useState(false)

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ['/jobs'],
    queryFn: () => apiGet('/jobs'),
  })

  const { data: subs = [], isLoading: subsLoading } = useQuery<Subscription[]>({
    queryKey: ['/subscriptions'],
    queryFn: () => apiGet('/subscriptions'),
  })

  const { data: contractors = [] } = useQuery<Contractor[]>({
    queryKey: ['/contractors'],
    queryFn: () => apiGet('/contractors'),
  })

  const oneTimeJobs = jobs.filter(j => j.jobType === 'one_time' && j.status !== 'cancelled')
  const activeSubs = subs.filter(s => s.status === 'ACTIVE' || s.status === 'PAUSED')

  const loading = jobsLoading || subsLoading

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b">
        <div>
          <h2 className="text-base font-semibold">Open Jobs</h2>
          <p className="text-xs text-muted-foreground">
            {activeSubs.length} subscription{activeSubs.length !== 1 ? 's' : ''} · {oneTimeJobs.length} one-time job{oneTimeJobs.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewJob(true)}>
          <Plus className="h-4 w-4 mr-1" />New Job
        </Button>
      </div>

      <Tabs defaultValue="subscriptions" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 shrink-0">
          <TabsTrigger value="subscriptions" className="flex-1">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Subscriptions
          </TabsTrigger>
          <TabsTrigger value="onetime" className="flex-1">
            <Calendar className="h-3.5 w-3.5 mr-1.5" />One-Time Jobs
          </TabsTrigger>
        </TabsList>

        {/* Subscriptions tab */}
        <TabsContent value="subscriptions" className="flex-1 overflow-y-auto mt-0">
          <div className="p-4 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
            ) : activeSubs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <RefreshCw className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No active subscriptions</p>
                <p className="text-xs mt-1">Activate a subscription from the Quotes page</p>
              </div>
            ) : (
              activeSubs.map(sub => (
                <SubJobCard key={sub.id} sub={sub} onConfigure={() => setSelectedSub(sub)} />
              ))
            )}
          </div>
        </TabsContent>

        {/* One-Time Jobs tab */}
        <TabsContent value="onetime" className="flex-1 overflow-y-auto mt-0">
          <div className="p-4 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
            ) : oneTimeJobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No one-time jobs yet</p>
                <p className="text-xs mt-1">Accept a one-time quote to create a job</p>
              </div>
            ) : (
              oneTimeJobs.map(job => (
                <OneTimeJobCard key={job.id} job={job} onOpen={() => setSelectedJob(job)} />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <JobDetailSheet
        job={selectedJob}
        contractors={contractors}
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
      />
      <SubscriptionScheduleSheet
        sub={selectedSub}
        contractors={contractors}
        open={!!selectedSub}
        onClose={() => setSelectedSub(null)}
      />
      <NewJobSheet
        open={showNewJob}
        onClose={() => setShowNewJob(false)}
      />
    </div>
  )
}
