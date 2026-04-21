import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Job, Subscription, Contractor } from '@/types'
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { ChevronLeft, ChevronRight, MapPin, Phone, Wrench, RefreshCw, Calendar, Clock, GripVertical, ClipboardList, Plus, MessageSquare } from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime12(hhmm: string): string {
  const [hh, mm] = hhmm.split(':').map(Number)
  const ampm = hh >= 12 ? 'PM' : 'AM'
  const h = hh % 12 || 12
  return `${h}:${String(mm).padStart(2, '0')} ${ampm}`
}

// ── Types ────────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string
  title: string
  subtitle: string
  type: 'one_time' | 'subscription' | 'quote_visit'
  color: string
  job?: Job
  sub?: Subscription
  contractorId?: string | null
  window?: string | null
}

// ── Calendar generation helpers ──────────────────────────────────────────────

function getWeekNumber(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = d.getDay()
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - dayOfWeek)
  return Math.floor(sunday.getTime() / (7 * 24 * 60 * 60 * 1000))
}

const SUB_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-teal-500', 'bg-orange-500',
  'bg-pink-500', 'bg-indigo-500', 'bg-cyan-500', 'bg-emerald-500',
]

function generateSubEvents(subs: Subscription[], year: number, month: number): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()

  subs.forEach((sub, subIdx) => {
    if (sub.status !== 'ACTIVE') return
    const color = SUB_COLORS[subIdx % SUB_COLORS.length]

    const schedules = sub.serviceSchedules ?? []
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    for (const sch of schedules) {
      // Parse start year/month/day — avoid Date constructor timezone issues entirely
      const [sy, sm, sd] = sch.startDate.split('-').map(Number)
      // sm and sd are 1-based (e.g. month 5 = May)
      const freq = (sch.frequency ?? '').toLowerCase()
      const isDateBased = freq.includes('quarter') || freq.includes('annual')

      for (let day = 1; day <= daysInMonth; day++) {
        // Skip days before the service start date
        if (year < sy) continue
        if (year === sy && month + 1 < sm) continue
        if (year === sy && month + 1 === sm && day < sd) continue

        if (isDateBased) {
          // Quarterly / Annual: fires on the same calendar date, every N months
          const totalMonths = (year - sy) * 12 + ((month + 1) - sm)
          const interval = freq.includes('quarter') ? 3 : 12
          if (totalMonths % interval !== 0) continue   // wrong month
          if (day !== sd) continue                      // wrong day-of-month
        } else {
          // Week-based / Monthly: must land on the right day-of-week first
          const dow = new Date(year, month, day).getDay()
          if (dow !== sch.dayOfWeek) continue

          if (freq.includes('bi') && freq.includes('week')) {
            // Bi-weekly: same parity of week as the start date
            const startDow = new Date(sy, sm - 1, sd).getDay()
            const startSunday = new Date(sy, sm - 1, sd - startDow)
            const thisSunday  = new Date(year, month, day - dow)
            const weekDiff = Math.round((thisSunday.getTime() - startSunday.getTime()) / (7 * 86400000))
            if (weekDiff % 2 !== 0) continue
          } else if (freq.includes('month') || freq.includes('bi')) {
            // Monthly (and bi-monthly): fire on the occurrence of this weekday closest
            // to the original day-of-month within this month
            const targetDom = sd
            const occs: number[] = []
            for (let d2 = 1; d2 <= daysInMonth; d2++) {
              if (new Date(year, month, d2).getDay() === sch.dayOfWeek) occs.push(d2)
            }
            const best = occs.reduce((a, b) =>
              Math.abs(a - targetDom) <= Math.abs(b - targetDom) ? a : b
            )
            if (day !== best) continue
            if (freq.includes('bi') && !freq.includes('week')) {
              // Bi-monthly: only every other month from start
              const totalMonths = (year - sy) * 12 + ((month + 1) - sm)
              if (totalMonths % 2 !== 0) continue
            }
          }
          // Weekly: every matching weekday — no extra check needed
        }

        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const arr = map.get(key) ?? []
        arr.push({
          id: `${sub.id}-${sch.serviceId}-${key}`,
          title: sub.customerName,
          subtitle: sch.serviceName,
          type: 'subscription',
          color,
          sub,
          contractorId: sch.contractorId,
        })
        map.set(key, arr)
      }
    }

    // Fallback for subs that have services[] but no serviceSchedules yet
    if (schedules.length === 0 && (sub.services ?? []).length > 0) {
      const [sy, sm, sd] = (sub.startDate ?? '').split('-').map(Number)
      if (!sy) return

      for (const svc of sub.services) {
        const freq = (svc.frequency ?? '').toLowerCase()
        const isDateBased = freq.includes('quarter') || freq.includes('annual')

        for (let day = 1; day <= daysInMonth; day++) {
          if (year < sy) continue
          if (year === sy && month + 1 < sm) continue
          if (year === sy && month + 1 === sm && day < sd) continue

          if (isDateBased) {
            const totalMonths = (year - sy) * 12 + ((month + 1) - sm)
            const interval = freq.includes('quarter') ? 3 : 12
            if (totalMonths % interval !== 0) continue
            if (day !== sd) continue
          } else {
            const startDow = new Date(sy, sm - 1, sd).getDay()
            const dow = new Date(year, month, day).getDay()
            if (dow !== startDow) continue
            if (freq.includes('bi') && freq.includes('week')) {
              const startSunday = new Date(sy, sm - 1, sd - startDow)
              const thisSunday  = new Date(year, month, day - dow)
              const weekDiff = Math.round((thisSunday.getTime() - startSunday.getTime()) / (7 * 86400000))
              if (weekDiff % 2 !== 0) continue
            }
          }

          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const arr = map.get(key) ?? []
          arr.push({
            id: `${sub.id}-${svc.id}-${key}`,
            title: sub.customerName,
            subtitle: svc.serviceName,
            type: 'subscription',
            color,
            sub,
            contractorId: null,
          })
          map.set(key, arr)
        }
      }
    }
  })
  return map
}

function generateJobEvents(jobs: Job[], year: number, month: number): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  for (const job of jobs) {
    if (!job.scheduledDate || job.status === 'cancelled') continue
    const d = new Date(job.scheduledDate + 'T12:00:00')
    if (d.getFullYear() !== year || d.getMonth() !== month) continue
    const key = job.scheduledDate
    const arr = map.get(key) ?? []
    const isQuoteVisit = job.jobType === 'quote_visit'
    arr.push({
      id: `job-${job.id}`,
      title: job.customerName ?? 'Unknown',
      subtitle: isQuoteVisit ? `📋 Quote Visit${job.scheduledTime ? ' · ' + fmtTime12(job.scheduledTime) : ''}` : job.serviceName,
      type: isQuoteVisit ? 'quote_visit' : 'one_time',
      color: isQuoteVisit ? 'bg-purple-500' : 'bg-green-500',
      job,
      window: job.scheduledWindow,
    })
    map.set(key, arr)
  }
  return map
}

// ── Draggable unscheduled job chip ───────────────────────────────────────────

function UnscheduledJobChip({ job, isDragging }: { job: Job; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: `drag-${job.id}` })
  const style = transform ? { transform: `translate(${transform.x}px,${transform.y}px)` } : undefined
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shrink-0 cursor-grab active:cursor-grabbing touch-none select-none ${isDragging ? 'opacity-30' : 'hover:bg-muted/50'}`}
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="font-medium text-xs truncate max-w-[120px]">{job.customerName ?? 'Unknown'}</p>
        <p className="text-xs text-muted-foreground truncate max-w-[120px]">{job.serviceName}</p>
      </div>
    </div>
  )
}

// Ghost shown while dragging
function JobChipGhost({ job }: { job: Job }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card shadow-lg px-3 py-2 text-sm opacity-90 rotate-2">
      <div className="min-w-0">
        <p className="font-medium text-xs">{job.customerName ?? 'Unknown'}</p>
        <p className="text-xs text-muted-foreground">{job.serviceName}</p>
      </div>
    </div>
  )
}

// ── Droppable day cell ────────────────────────────────────────────────────────

function DayCell({
  day, year, month, events, isToday, onClick,
}: {
  day: number; year: number; month: number
  events: CalEvent[]; isToday: boolean; onClick: () => void
}) {
  const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const { isOver, setNodeRef } = useDroppable({ id: dateKey })

  const dotColors = [...new Set(events.slice(0, 3).map(e => e.color))]

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={`min-h-[64px] rounded-lg p-1 flex flex-col items-center transition-all ${
        isOver
          ? 'ring-2 ring-primary bg-primary/10 scale-105'
          : isToday
          ? 'bg-primary text-primary-foreground'
          : events.length > 0
          ? 'bg-muted/60 hover:bg-muted'
          : 'hover:bg-muted/40'
      }`}
    >
      <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'font-bold' : ''}`}>
        {day}
      </span>
      {events.length > 0 && (
        <div className="flex flex-wrap justify-center gap-0.5 mt-0.5">
          {dotColors.map((col, i) => (
            <div key={i} className={`w-1.5 h-1.5 rounded-full ${isToday ? 'bg-primary-foreground/70' : col}`} />
          ))}
          {events.length > 3 && (
            <span className={`text-[9px] font-bold ${isToday ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
              +{events.length - 3}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

// ── Time picker sheet (shown after drop) ─────────────────────────────────────

function ScheduleTimeSheet({
  open, job, targetDate, onConfirm, onClose,
}: {
  open: boolean; job: Job | null; targetDate: string
  onConfirm: (date: string, window: string, time: string) => void
  onClose: () => void
}) {
  const [window, setWindow] = useState('anytime')
  const [specificTime, setSpecificTime] = useState('08:00')

  if (!job) return null

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
        <SheetHeader className="mb-4">
          <SheetTitle>Schedule Job</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {job.customerName} · {job.serviceName}
          </p>
        </SheetHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Date</Label>
            <p className="text-sm font-medium mt-1">
              {new Date(targetDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div>
            <Label className="text-xs">Time Window</Label>
            <Select value={window} onValueChange={setWindow}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="anytime">Anytime</SelectItem>
                <SelectItem value="morning">Morning (8am – 12pm)</SelectItem>
                <SelectItem value="afternoon">Afternoon (12pm – 5pm)</SelectItem>
                <SelectItem value="evening">Evening (5pm – 8pm)</SelectItem>
                <SelectItem value="specific">Specific time…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {window === 'specific' && (
            <div>
              <Label className="text-xs">Start Time</Label>
              <Input type="time" className="mt-1" value={specificTime} onChange={e => setSpecificTime(e.target.value)} />
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={() => onConfirm(targetDate, window, specificTime)}>
              <Calendar className="h-4 w-4 mr-1" />Schedule
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Day detail sheet ──────────────────────────────────────────────────────────

const WINDOW_LABELS: Record<string, string> = {
  morning: '🌅 Morning (8am–12pm)',
  afternoon: '☀️ Afternoon (12pm–5pm)',
  evening: '🌆 Evening (5pm–8pm)',
  anytime: 'Anytime',
  specific: 'Specific time',
}

function DayDetailSheet({
  date, events, contractors, open, onClose,
}: {
  date: Date | null; events: CalEvent[]; contractors: Contractor[]; open: boolean; onClose: () => void
}) {
  if (!date) return null
  const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{label}</SheetTitle>
          <p className="text-sm text-muted-foreground">{events.length} job{events.length !== 1 ? 's' : ''}</p>
        </SheetHeader>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No jobs scheduled. Drag a job here to schedule it.</p>
        ) : (
          <div className="space-y-3">
            {events.map(ev => {
              const contractor = contractors.find(c => c.id === (ev.job?.contractorId ?? ev.contractorId))
              return (
                <div key={ev.id} className="rounded-xl border bg-card p-3">
                  <div className="flex items-start gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${ev.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{ev.title}</p>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {ev.type === 'subscription' ? 'Sub' : 'One-Time'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{ev.subtitle}</p>

                      {/* Time window */}
                      {ev.window && ev.window !== 'anytime' && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />{WINDOW_LABELS[ev.window] ?? ev.window}
                        </p>
                      )}

                      {(ev.job?.customerAddress || ev.sub?.customerAddress) && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {ev.job?.customerAddress ?? ev.sub?.customerAddress}
                        </p>
                      )}
                      {(ev.job?.customerPhone || ev.sub?.customerPhone) && (
                        <a href={`tel:${ev.job?.customerPhone ?? ev.sub?.customerPhone}`} className="text-xs text-primary mt-0.5 flex items-center gap-1">
                          <Phone className="h-3 w-3 shrink-0" />
                          {ev.job?.customerPhone ?? ev.sub?.customerPhone}
                        </a>
                      )}
                      {ev.job?.propertyInfo?.gateCode && (
                        <p className="text-xs text-muted-foreground mt-0.5">🔑 Gate: {ev.job.propertyInfo.gateCode}</p>
                      )}
                      {ev.job?.propertyInfo?.dogOnProperty && (
                        <p className="text-xs text-muted-foreground">🐕 {ev.job.propertyInfo.dogOnProperty}</p>
                      )}
                      {contractor && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Wrench className="h-3 w-3 shrink-0" />
                          {contractor.name}{contractor.phone ? ` · ${contractor.phone}` : ''}
                        </p>
                      )}
                      {ev.job?.notes && (
                        <p className="text-xs text-muted-foreground mt-1 bg-muted/50 rounded p-1.5">{ev.job.notes}</p>
                      )}
                      {ev.job && (
                        <span className={`mt-2 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                          ev.job.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' :
                          ev.job.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                        }`}>{ev.job.status.replace('_', ' ')}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Main Calendar ─────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_ABBR    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/* ── New Quote Visit Sheet ───────────────────────────────────────────────── */
function NewQuoteVisitSheet({
  open, onClose, defaultDate, onCreated,
}: {
  open: boolean
  onClose: () => void
  defaultDate: string
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [scheduledDate, setScheduledDate] = useState(defaultDate)
  const [scheduledTime, setScheduledTime] = useState('09:00')
  const [notes, setNotes] = useState('')
  const [sendSms, setSendSms] = useState(true)
  const [loading, setLoading] = useState(false)

  // Reset when opened with a new date
  useState(() => { setScheduledDate(defaultDate) })

  const handleSubmit = async () => {
    if (!customerName || !scheduledDate) return
    setLoading(true)
    try {
      // Create the job as a quote_visit
      const jobRes = await fetch('/.netlify/functions/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'quote_visit',
          serviceName: 'In-Person Quote',
          status: 'scheduled',
          scheduledDate,
          scheduledTime,
          customerName,
          customerPhone: customerPhone || null,
          customerAddress: customerAddress || null,
          notes: notes || null,
        }),
      })
      if (!jobRes.ok) throw new Error('Failed to create quote visit')

      // Send SMS confirmation if enabled and phone provided
      if (sendSms && customerPhone) {
        const smsRes = await fetch('/.netlify/functions/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'quote-visit-confirmation',
            to: customerPhone,
            customerName,
            scheduledDate,
            scheduledTime,
          }),
        })
        if (!smsRes.ok) {
          // SMS failure is non-fatal — job was already created
          toast({ title: 'Quote visit added', description: 'SMS failed to send. Check Quo settings.', variant: 'destructive' })
        } else {
          toast({ title: 'Quote visit added', description: `Confirmation text sent to ${customerPhone}` })
        }
      } else {
        toast({ title: 'Quote visit added' })
      }

      onCreated()
      onClose()
      setCustomerName('')
      setCustomerPhone('')
      setCustomerAddress('')
      setNotes('')
      setSendSms(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-purple-500" />
            New Quote Visit
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Customer Name *</Label>
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full name" className="min-h-[44px]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Date *</Label>
              <Input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="min-h-[44px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Time</Label>
              <Input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="min-h-[44px]" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Customer Phone</Label>
            <Input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+18651234567" className="min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Property Address</Label>
            <Input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="123 Main St" className="min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes (internal)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Gate code, parking, etc." className="min-h-[44px]" />
          </div>
          {customerPhone && (
            <div className="flex items-center gap-3 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 px-3 py-2.5">
              <MessageSquare className="h-4 w-4 text-purple-600 shrink-0" />
              <div className="flex-1 text-xs text-purple-800 dark:text-purple-200">
                Auto-send confirmation text to {customerPhone}
              </div>
              <button
                type="button"
                onClick={() => setSendSms(s => !s)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${sendSms ? 'bg-purple-600' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${sendSms ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          )}
          <Button
            onClick={handleSubmit}
            disabled={loading || !customerName || !scheduledDate}
            className="w-full min-h-[44px]"
          >
            {loading ? 'Saving…' : 'Add Quote Visit'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ job: Job; dateKey: string } | null>(null)
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [showNewQuoteVisit, setShowNewQuoteVisit] = useState(false)
  const { toast } = useToast()
  const qc = useQueryClient()

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

  const scheduleJobMutation = useMutation({
    mutationFn: ({ id, scheduledDate, scheduledWindow, startTime }: {
      id: string; scheduledDate: string; scheduledWindow: string; startTime?: string
    }) => {
      const body: Record<string, unknown> = { scheduledDate, scheduledWindow }
      if (scheduledWindow === 'specific' && startTime) {
        body.startTime = `${scheduledDate}T${startTime}:00`
      }
      return apiRequest('PATCH', `/jobs/${id}`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobs'] })
      toast({ title: 'Job scheduled!' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragStart(e: DragStartEvent) {
    const jobId = String(e.active.id).replace('drag-', '')
    setActiveJob(jobs.find(j => j.id === jobId) ?? null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveJob(null)
    const { active, over } = e
    if (!over) return
    const jobId = String(active.id).replace('drag-', '')
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    const dateKey = String(over.id) // 'YYYY-MM-DD'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return
    setPendingDrop({ job, dateKey })
  }

  const subEventMap = useMemo(() => generateSubEvents(subs, year, month), [subs, year, month])
  const jobEventMap = useMemo(() => generateJobEvents(jobs, year, month), [jobs, year, month])

  function eventsForKey(key: string): CalEvent[] {
    return [...(jobEventMap.get(key) ?? []), ...(subEventMap.get(key) ?? [])]
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const firstDayOfMonth = new Date(year, month, 1).getDay()
  const daysInMonth     = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDayOfMonth).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  // Unscheduled one-time jobs (no scheduledDate, not cancelled)
  const unscheduled = jobs.filter(j => j.jobType === 'one_time' && !j.scheduledDate && j.status !== 'cancelled')
  // Active subs with no schedule configured AND no services to fall back on
  const unscheduledSubs = subs.filter(s =>
    s.status === 'ACTIVE' &&
    (!s.serviceSchedules || s.serviceSchedules.length === 0) &&
    (!s.services || s.services.length === 0)
  )

  const selectedDateKey = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
    : null
  const selectedEvents = selectedDateKey ? eventsForKey(selectedDateKey) : []

  let totalSubEvents = 0; subEventMap.forEach(a => { totalSubEvents += a.length })
  let totalJobEvents = 0; jobEventMap.forEach(a => { totalJobEvents += a.length })

  const loading = jobsLoading || subsLoading

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={prevMonth}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="text-center">
              <h2 className="text-base font-semibold">{MONTH_NAMES[month]} {year}</h2>
              {!loading && (
                <p className="text-xs text-muted-foreground">
                  {totalJobEvents} one-time · {totalSubEvents} subscription visits
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={nextMonth}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Legend + New Quote Visit */}
        <div className="px-4 py-2 flex items-center gap-4 border-b">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />One-time
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />Subscription
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />Quote Visit
          </div>
          <div className="ml-auto">
            <Button size="sm" variant="outline" className="min-h-[34px] text-xs border-purple-300 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30" onClick={() => setShowNewQuoteVisit(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Quote Visit
            </Button>
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 px-2 pt-2">
          {DAY_ABBR.map(d => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : (
          <div className="overflow-y-auto px-2 pb-2">
            <div className="grid grid-cols-7 gap-px">
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} className="min-h-[64px]" />
                const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
                const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const events = eventsForKey(key)
                return (
                  <DayCell
                    key={day}
                    day={day}
                    year={year}
                    month={month}
                    events={events}
                    isToday={isToday}
                    onClick={() => setSelectedDate(new Date(year, month, day))}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Unscheduled jobs strip */}
        {(unscheduled.length > 0 || unscheduledSubs.length > 0) && (
          <div className="border-t bg-muted/30">
            <div className="px-3 pt-2 pb-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Unscheduled — drag to a day
              </p>
            </div>
            <div className="flex gap-2 px-3 pb-3 overflow-x-auto">
              {unscheduled.map(job => (
                <UnscheduledJobChip
                  key={job.id}
                  job={job}
                  isDragging={activeJob?.id === job.id}
                />
              ))}
              {unscheduledSubs.map(sub => (
                <div
                  key={sub.id}
                  className="flex items-center gap-2 rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 px-3 py-2 text-sm shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-xs truncate max-w-[120px]">{sub.customerName}</p>
                    <p className="text-xs text-muted-foreground">Set schedule in Jobs tab</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeJob && <JobChipGhost job={activeJob} />}
      </DragOverlay>

      {/* Day detail sheet */}
      <DayDetailSheet
        date={selectedDate}
        events={selectedEvents}
        contractors={contractors}
        open={!!selectedDate}
        onClose={() => setSelectedDate(null)}
      />

      {/* New Quote Visit */}
      <NewQuoteVisitSheet
        open={showNewQuoteVisit}
        onClose={() => setShowNewQuoteVisit(false)}
        defaultDate={`${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`}
        onCreated={() => qc.invalidateQueries({ queryKey: ['/jobs'] })}
      />

      {/* Time picker after drop */}
      <ScheduleTimeSheet
        open={!!pendingDrop}
        job={pendingDrop?.job ?? null}
        targetDate={pendingDrop?.dateKey ?? ''}
        onConfirm={(date, window, time) => {
          if (!pendingDrop) return
          scheduleJobMutation.mutate({
            id: pendingDrop.job.id,
            scheduledDate: date,
            scheduledWindow: window,
            startTime: time,
          })
          setPendingDrop(null)
        }}
        onClose={() => setPendingDrop(null)}
      />
    </DndContext>
  )
}
