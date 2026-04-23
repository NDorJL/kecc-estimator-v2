import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Job, Subscription, Contractor, Contact, Quote } from '@/types'
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
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { ChevronLeft, ChevronRight, MapPin, Phone, Wrench, RefreshCw, Calendar, Clock, GripVertical, ClipboardList, Plus, MessageSquare, Search, X, User, Trash2, AlertTriangle, Pencil } from 'lucide-react'

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
  date, events, contractors, open, onClose, onDeleteJob,
}: {
  date: Date | null
  events: CalEvent[]
  contractors: Contractor[]
  open: boolean
  onClose: () => void
  onDeleteJob: (jobId: string) => Promise<void>
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  if (!date) return null
  const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  async function handleConfirmDelete(jobId: string) {
    setDeleting(true)
    try {
      await onDeleteJob(jobId)
      setConfirmDeleteId(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { setConfirmDeleteId(null); onClose() } }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{label}</SheetTitle>
          <p className="text-sm text-muted-foreground">{events.length} event{events.length !== 1 ? 's' : ''}</p>
        </SheetHeader>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No jobs scheduled. Drag a job here to schedule it.</p>
        ) : (
          <div className="space-y-3">
            {events.map(ev => {
              const contractor = contractors.find(c => c.id === (ev.job?.contractorId ?? ev.contractorId))
              const isDeletable = !!ev.job  // only one-time jobs and quote visits (not subscription events)
              const isConfirming = confirmDeleteId === ev.job?.id

              return (
                <div key={ev.id} className={`rounded-xl border bg-card p-3 transition-colors ${isConfirming ? 'border-destructive/50 bg-destructive/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${ev.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{ev.title}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="secondary" className="text-xs">
                            {ev.type === 'subscription' ? 'Sub' : ev.type === 'quote_visit' ? 'Quote Visit' : 'One-Time'}
                          </Badge>
                          {isDeletable && !isConfirming && (
                            <button
                              onClick={() => setConfirmDeleteId(ev.job!.id)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete event"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
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
                      {ev.job && !isConfirming && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                            ev.job.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' :
                            ev.job.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                          }`}>{ev.job.status.replace('_', ' ')}</span>
                          {ev.job.jobType === 'one_time' && ev.job.customerPhone && (
                            ev.job.reminderSentAt
                              ? <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">📱 Reminder sent</span>
                              : <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">📱 Reminder pending</span>
                          )}
                        </div>
                      )}

                      {/* Inline delete confirm */}
                      {isConfirming && (
                        <div className="mt-2 flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-xs text-destructive flex-1">Delete this event?</span>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs px-2.5 py-1 rounded-md border hover:bg-muted transition-colors"
                            disabled={deleting}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleConfirmDelete(ev.job!.id)}
                            className="text-xs px-2.5 py-1 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                            disabled={deleting}
                          >
                            {deleting ? '…' : 'Delete'}
                          </button>
                        </div>
                      )}

                      {/* Subscription events: explain why no delete */}
                      {ev.type === 'subscription' && (
                        <p className="text-xs text-muted-foreground mt-1.5 italic">
                          Recurring visit — manage in Subscriptions tab.
                        </p>
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

  // Contact picker state
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [contactSearch, setContactSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Form fields (auto-filled from contact or typed manually)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [scheduledDate, setScheduledDate] = useState(defaultDate)
  const [scheduledTime, setScheduledTime] = useState('09:00')
  const [visitNotes, setVisitNotes] = useState('')
  const [sendSms, setSendSms] = useState(true)
  const [loading, setLoading] = useState(false)

  // Sync defaultDate when sheet opens
  useEffect(() => {
    if (open) setScheduledDate(defaultDate)
  }, [open, defaultDate])

  // Load contacts for picker
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet('/contacts'),
    enabled: open,
  })

  // Filtered list based on search text
  const filteredContacts = contactSearch.trim().length > 0
    ? contacts.filter(c =>
        c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
        (c.phone ?? '').includes(contactSearch)
      ).slice(0, 8)
    : contacts.slice(0, 8)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDropdown) return
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDropdown])

  async function selectContact(c: Contact) {
    setSelectedContact(c)
    setCustomerName(c.name)
    setCustomerPhone(c.phone ?? '')
    setCustomerEmail(c.email ?? '')
    setContactSearch('')
    setShowDropdown(false)

    // Fetch their first property to auto-fill address
    try {
      const props = await apiGet<Array<{ address: string }>>(`/properties?contactId=${c.id}`)
      if (props && props.length > 0 && props[0].address) {
        setCustomerAddress(props[0].address)
      }
    } catch {
      // non-fatal — address stays blank
    }
  }

  function clearContact() {
    setSelectedContact(null)
    setCustomerName('')
    setCustomerPhone('')
    setCustomerEmail('')
    setCustomerAddress('')
    setContactSearch('')
  }

  function resetForm() {
    setSelectedContact(null)
    setContactSearch('')
    setCustomerName('')
    setCustomerPhone('')
    setCustomerEmail('')
    setCustomerAddress('')
    setVisitNotes('')
    setSendSms(true)
    setShowDropdown(false)
  }

  const handleSubmit = async () => {
    if (!customerName || !scheduledDate) return
    setLoading(true)
    try {
      // 1. Create the quote visit job
      const jobRes = await fetch('/.netlify/functions/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'quote_visit',
          serviceName: 'In-Person Quote',
          status: 'scheduled',
          scheduledDate,
          scheduledTime,
          contactId: selectedContact?.id ?? null,
          customerName,
          customerPhone: customerPhone || null,
          customerEmail: customerEmail || null,
          customerAddress: customerAddress || null,
          notes: visitNotes || null,
        }),
      })
      if (!jobRes.ok) throw new Error('Failed to create quote visit')
      const createdJob = await jobRes.json()

      // 2. Log activity on the contact's timeline (fire-and-forget, non-fatal)
      if (selectedContact?.id) {
        const dateLabel = new Date(scheduledDate + 'T12:00:00').toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
        })
        const timeLabel = fmtTime12(scheduledTime)
        const summary = visitNotes
          ? `Quote visit on ${dateLabel} at ${timeLabel} — ${visitNotes}`
          : `Quote visit scheduled on ${dateLabel} at ${timeLabel}`

        fetch('/.netlify/functions/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: selectedContact.id,
            type: 'note',
            summary,
            metadata: {
              jobId: createdJob.id,
              scheduledDate,
              scheduledTime,
              visitNotes: visitNotes || null,
              customerAddress: customerAddress || null,
            },
          }),
        }).catch(() => {})
      }

      // 3. Send SMS confirmation if enabled and phone provided
      if (sendSms && customerPhone) {
        try {
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
            const errData = await smsRes.json().catch(() => ({ message: `HTTP ${smsRes.status}` }))
            const errMsg = errData?.message ?? `HTTP ${smsRes.status}`
            toast({ title: 'Quote visit added — SMS failed', description: errMsg, variant: 'destructive' })
          } else {
            toast({ title: 'Quote visit added', description: `Confirmation text sent to ${customerPhone}` })
          }
        } catch {
          toast({ title: 'Quote visit added — SMS failed', description: 'Could not reach SMS function.', variant: 'destructive' })
        }
      } else {
        toast({ title: 'Quote visit added' })
      }

      onCreated()
      onClose()
      resetForm()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { onClose(); resetForm() } }}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-purple-500" />
            New Quote Visit
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-3">

          {/* ── Contact picker ────────────────────────────────────────── */}
          <div className="space-y-1">
            <Label className="text-xs">Link to Existing Contact</Label>

            {selectedContact ? (
              /* Selected contact pill */
              <div className="flex items-center gap-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 px-3 py-2">
                <User className="h-4 w-4 text-purple-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedContact.name}</p>
                  {selectedContact.phone && (
                    <p className="text-xs text-muted-foreground">{selectedContact.phone}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearContact}
                  className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              /* Search input + dropdown */
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={searchRef}
                    value={contactSearch}
                    onChange={e => { setContactSearch(e.target.value); setShowDropdown(true) }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Search contacts by name or phone…"
                    className="pl-9 min-h-[44px]"
                  />
                </div>

                {showDropdown && filteredContacts.length > 0 && (
                  <div
                    ref={dropdownRef}
                    className="absolute z-50 left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto"
                  >
                    {filteredContacts.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); selectContact(c) }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 text-left border-b last:border-b-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                        </div>
                        <Badge variant="outline" className="text-xs shrink-0 capitalize">{c.type}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Visit notes will be saved to this contact's activity timeline.
            </p>
          </div>

          {/* ── Customer details (auto-filled or manual) ─────────────── */}
          <div className="space-y-1">
            <Label className="text-xs">Customer Name *</Label>
            <Input
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Full name"
              className="min-h-[44px]"
            />
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
            <Input
              type="tel"
              value={customerPhone}
              onChange={e => setCustomerPhone(e.target.value)}
              placeholder="+18651234567"
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Customer Email</Label>
            <Input
              type="email"
              value={customerEmail}
              onChange={e => setCustomerEmail(e.target.value)}
              placeholder="email@example.com"
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Property Address</Label>
            <Input
              value={customerAddress}
              onChange={e => setCustomerAddress(e.target.value)}
              placeholder="123 Main St"
              className="min-h-[44px]"
            />
          </div>

          {/* ── Visit Notes ───────────────────────────────────────────── */}
          <div className="space-y-1">
            <Label className="text-xs">Visit Notes</Label>
            <Textarea
              value={visitNotes}
              onChange={e => setVisitNotes(e.target.value)}
              placeholder={`Scope discussed, measurements taken, adjustments to quote, property details, customer concerns, next steps…`}
              className="min-h-[110px] resize-none text-sm"
            />
            {selectedContact && (
              <p className="text-xs text-purple-700 dark:text-purple-400 flex items-center gap-1">
                <User className="h-3 w-3" />
                These notes will appear in {selectedContact.name}'s activity timeline.
              </p>
            )}
          </div>

          {/* ── SMS toggle ────────────────────────────────────────────── */}
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

// ── Edit Job Sheet ────────────────────────────────────────────────────────────

function EditJobSheet({
  open, onClose, job, onSave,
}: {
  open: boolean
  onClose: () => void
  job: Job | null
  onSave: (updates: Partial<{
    serviceName: string
    notes: string
    scheduledDate: string
    scheduledTime: string
    scheduledWindow: string
    status: string
  }>) => Promise<void>
}) {
  const [serviceName, setServiceName] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledWindow, setScheduledWindow] = useState('anytime')
  const [scheduledTime, setScheduledTime] = useState('08:00')
  const [status, setStatus] = useState('scheduled')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Sync form to job when it changes
  useEffect(() => {
    if (job) {
      setServiceName(job.serviceName ?? '')
      setScheduledDate(job.scheduledDate ?? '')
      setScheduledWindow(job.scheduledWindow ?? 'anytime')
      setScheduledTime(job.scheduledTime ?? '08:00')
      setStatus(job.status ?? 'scheduled')
      setNotes(job.notes ?? '')
    }
  }, [job])

  if (!job) return null

  async function handleSave() {
    setSaving(true)
    try {
      const updates: Parameters<typeof onSave>[0] = {
        serviceName,
        notes,
        scheduledDate,
        scheduledWindow,
        status,
      }
      if (scheduledWindow === 'specific') updates.scheduledTime = scheduledTime
      await onSave(updates)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit Job
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{job.customerName}</p>
        </SheetHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Service Name</Label>
            <Input className="mt-1 min-h-[44px]" value={serviceName} onChange={e => setServiceName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" className="mt-1 min-h-[44px]" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Time Window</Label>
            <Select value={scheduledWindow} onValueChange={setScheduledWindow}>
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
          {scheduledWindow === 'specific' && (
            <div>
              <Label className="text-xs">Start Time</Label>
              <Input type="time" className="mt-1 min-h-[44px]" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
            </div>
          )}
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
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
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1 min-h-[80px] resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Job notes…" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Add Service Sheet (from accepted quote) ───────────────────────────────────

function AddServiceSheet({
  open, onClose, defaultDate, onCreated,
}: {
  open: boolean
  onClose: () => void
  defaultDate: string
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [step, setStep] = useState<'quote' | 'services'>('quote')
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null)
  const [quoteSearch, setQuoteSearch] = useState('')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [scheduledDate, setScheduledDate] = useState(defaultDate)
  const [scheduledWindow, setScheduledWindow] = useState('anytime')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setScheduledDate(defaultDate)
      setStep('quote')
      setSelectedQuote(null)
      setQuoteSearch('')
      setSelectedItems(new Set())
    }
  }, [open, defaultDate])

  const { data: allQuotes = [] } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
    enabled: open,
  })

  const acceptedQuotes = allQuotes.filter(q => q.status === 'accepted')
  const filteredQuotes = quoteSearch.trim()
    ? acceptedQuotes.filter(q =>
        q.customerName.toLowerCase().includes(quoteSearch.toLowerCase()) ||
        (q.customerAddress ?? '').toLowerCase().includes(quoteSearch.toLowerCase())
      )
    : acceptedQuotes

  function toggleItem(id: string) {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleSchedule() {
    if (!selectedQuote || selectedItems.size === 0) return
    setSaving(true)
    try {
      const items = selectedQuote.lineItems.filter(li => selectedItems.has(li.serviceId))
      await Promise.all(items.map(item =>
        apiRequest('POST', '/jobs', {
          serviceName: item.serviceName,
          jobType: 'one_time',
          quoteId: selectedQuote.id,
          customerName: selectedQuote.customerName,
          customerAddress: selectedQuote.customerAddress,
          customerPhone: selectedQuote.customerPhone,
          customerEmail: selectedQuote.customerEmail,
          scheduledDate,
          scheduledWindow,
          status: 'scheduled',
        })
      ))
      toast({ title: 'Services scheduled', description: `${items.length} service${items.length !== 1 ? 's' : ''} added to calendar.` })
      onCreated()
      onClose()
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-green-600" />
            Add Service from Quote
          </SheetTitle>
        </SheetHeader>

        {step === 'quote' ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9 min-h-[44px]"
                placeholder="Search accepted quotes…"
                value={quoteSearch}
                onChange={e => setQuoteSearch(e.target.value)}
              />
            </div>
            {filteredQuotes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No accepted quotes found.</p>
            ) : (
              <div className="space-y-2">
                {filteredQuotes.map(q => (
                  <button
                    key={q.id}
                    onClick={() => { setSelectedQuote(q); setStep('services') }}
                    className="w-full text-left rounded-xl border bg-card p-3 hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  >
                    <p className="font-semibold text-sm">{q.customerName}</p>
                    <p className="text-xs text-muted-foreground">{q.customerAddress ?? 'No address'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-medium text-green-700 dark:text-green-400">${q.total.toFixed(0)} total</span>
                      <span className="text-xs text-muted-foreground">{q.lineItems.length} item{q.lineItems.length !== 1 ? 's' : ''}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setStep('quote')} className="p-1 rounded hover:bg-muted">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div>
                <p className="font-semibold text-sm">{selectedQuote?.customerName}</p>
                <p className="text-xs text-muted-foreground">Select services to schedule</p>
              </div>
            </div>

            <div className="space-y-2">
              {selectedQuote?.lineItems.map(item => (
                <button
                  key={item.serviceId}
                  onClick={() => toggleItem(item.serviceId)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors flex items-center gap-3 ${
                    selectedItems.has(item.serviceId) ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/30'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${
                    selectedItems.has(item.serviceId) ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`}>
                    {selectedItems.has(item.serviceId) && <div className="w-2 h-2 bg-primary-foreground rounded-sm" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.serviceName}</p>
                    <p className="text-xs text-muted-foreground">${item.lineTotal.toFixed(0)}</p>
                  </div>
                </button>
              ))}
            </div>

            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" className="mt-1 min-h-[44px]" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Time Window</Label>
              <Select value={scheduledWindow} onValueChange={setScheduledWindow}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anytime">Anytime</SelectItem>
                  <SelectItem value="morning">Morning (8am – 12pm)</SelectItem>
                  <SelectItem value="afternoon">Afternoon (12pm – 5pm)</SelectItem>
                  <SelectItem value="evening">Evening (5pm – 8pm)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full min-h-[44px]"
              onClick={handleSchedule}
              disabled={saving || selectedItems.size === 0 || !scheduledDate}
            >
              {saving ? 'Scheduling…' : `Schedule ${selectedItems.size} Selected Service${selectedItems.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Add Sub Visit Sheet ───────────────────────────────────────────────────────

function AddSubVisitSheet({
  open, onClose, defaultDate, onCreated,
}: {
  open: boolean
  onClose: () => void
  defaultDate: string
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [subSearch, setSubSearch] = useState('')
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null)
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set())
  const [scheduledDate, setScheduledDate] = useState(defaultDate)
  const [scheduledWindow, setScheduledWindow] = useState('anytime')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setScheduledDate(defaultDate)
      setSelectedSub(null)
      setSubSearch('')
      setSelectedServiceIds(new Set())
      setNotes('')
    }
  }, [open, defaultDate])

  const { data: allSubs = [] } = useQuery<Subscription[]>({
    queryKey: ['/subscriptions'],
    queryFn: () => apiGet('/subscriptions'),
    enabled: open,
  })

  const activeSubs = allSubs.filter(s => s.status === 'ACTIVE')
  const filteredSubs = subSearch.trim()
    ? activeSubs.filter(s =>
        s.customerName.toLowerCase().includes(subSearch.toLowerCase()) ||
        (s.customerAddress ?? '').toLowerCase().includes(subSearch.toLowerCase())
      )
    : activeSubs

  function toggleService(id: string) {
    setSelectedServiceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleAdd() {
    if (!selectedSub || selectedServiceIds.size === 0) return
    setSaving(true)
    try {
      const services = selectedSub.services.filter(s => selectedServiceIds.has(s.id))
      await Promise.all(services.map(svc =>
        apiRequest('POST', '/jobs', {
          serviceName: svc.serviceName,
          jobType: 'one_time',
          subscriptionId: selectedSub.id,
          customerName: selectedSub.customerName,
          customerAddress: selectedSub.customerAddress,
          customerPhone: selectedSub.customerPhone,
          scheduledDate,
          scheduledWindow,
          notes: notes || null,
          status: 'scheduled',
        })
      ))
      toast({ title: 'Visit added', description: `${services.length} service${services.length !== 1 ? 's' : ''} added to calendar.` })
      onCreated()
      onClose()
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-600" />
            Add Sub Visit
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-3">
          {!selectedSub ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-9 min-h-[44px]"
                  placeholder="Search active subscriptions…"
                  value={subSearch}
                  onChange={e => setSubSearch(e.target.value)}
                />
              </div>
              {filteredSubs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active subscriptions found.</p>
              ) : (
                <div className="space-y-2">
                  {filteredSubs.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSub(s)}
                      className="w-full text-left rounded-xl border bg-card p-3 hover:border-primary/50 hover:bg-muted/30 transition-colors"
                    >
                      <p className="font-semibold text-sm">{s.customerName}</p>
                      <p className="text-xs text-muted-foreground">{s.customerAddress ?? 'No address'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.services.length} service{s.services.length !== 1 ? 's' : ''}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedSub(null)} className="p-1 rounded hover:bg-muted">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div>
                  <p className="font-semibold text-sm">{selectedSub.customerName}</p>
                  <p className="text-xs text-muted-foreground">Select services to add</p>
                </div>
              </div>

              <div className="space-y-2">
                {selectedSub.services.map(svc => (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc.id)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors flex items-center gap-3 ${
                      selectedServiceIds.has(svc.id) ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/30'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${
                      selectedServiceIds.has(svc.id) ? 'border-primary bg-primary' : 'border-muted-foreground'
                    }`}>
                      {selectedServiceIds.has(svc.id) && <div className="w-2 h-2 bg-primary-foreground rounded-sm" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{svc.serviceName}</p>
                      <p className="text-xs text-muted-foreground">{svc.frequency}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" className="mt-1 min-h-[44px]" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Time Window</Label>
                <Select value={scheduledWindow} onValueChange={setScheduledWindow}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anytime">Anytime</SelectItem>
                    <SelectItem value="morning">Morning (8am – 12pm)</SelectItem>
                    <SelectItem value="afternoon">Afternoon (12pm – 5pm)</SelectItem>
                    <SelectItem value="evening">Evening (5pm – 8pm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea className="mt-1 min-h-[70px] resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
              </div>

              <Button
                className="w-full min-h-[44px]"
                onClick={handleAdd}
                disabled={saving || selectedServiceIds.size === 0 || !scheduledDate}
              >
                {saving ? 'Adding…' : `Add ${selectedServiceIds.size} Service${selectedServiceIds.size !== 1 ? 's' : ''} to Calendar`}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Year View ─────────────────────────────────────────────────────────────────

function YearView({
  year,
  jobEventMap,
  subEventMap,
  onMonthClick,
}: {
  year: number
  jobEventMap: Map<string, CalEvent[]>
  subEventMap: Map<string, CalEvent[]>
  onMonthClick: (month: number) => void
}) {
  const today = new Date()
  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="grid grid-cols-3 gap-3">
        {MONTH_NAMES.map((name, m) => {
          const daysInMonth = new Date(year, m + 1, 0).getDate()
          const firstDow = new Date(year, m, 1).getDay()
          const cells: (number | null)[] = [
            ...Array(firstDow).fill(null),
            ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
          ]
          while (cells.length % 7 !== 0) cells.push(null)
          // Count events this month
          let totalEvents = 0
          for (let d = 1; d <= daysInMonth; d++) {
            const key = `${year}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
            totalEvents += (jobEventMap.get(key)?.length ?? 0) + (subEventMap.get(key)?.length ?? 0)
          }
          const isCurrentMonth = today.getFullYear() === year && today.getMonth() === m
          return (
            <button
              key={m}
              onClick={() => onMonthClick(m)}
              className={`rounded-xl border bg-card p-2.5 text-left hover:border-primary/50 hover:bg-muted/30 active:scale-95 transition-all ${isCurrentMonth ? 'border-primary ring-1 ring-primary/30' : ''}`}
            >
              <p className={`text-xs font-bold mb-1.5 ${isCurrentMonth ? 'text-primary' : ''}`}>{name}</p>
              {/* Mini day grid */}
              <div className="grid grid-cols-7 gap-px">
                {'SMTWTFS'.split('').map((d, i) => (
                  <div key={i} className="text-center" style={{ fontSize: 7, color: '#9ca3af', fontWeight: 600 }}>{d}</div>
                ))}
                {cells.map((day, i) => {
                  if (!day) return <div key={`e-${i}`} />
                  const isToday = today.getFullYear() === year && today.getMonth() === m && today.getDate() === day
                  const key = `${year}-${String(m + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                  const hasEvent = (jobEventMap.get(key)?.length ?? 0) + (subEventMap.get(key)?.length ?? 0) > 0
                  return (
                    <div
                      key={day}
                      className={`flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : hasEvent ? 'bg-primary/15' : ''}`}
                      style={{ fontSize: 8, width: 14, height: 14, margin: '0 auto' }}
                    >
                      {day}
                    </div>
                  )
                })}
              </div>
              {totalEvents > 0 && (
                <p style={{ fontSize: 10 }} className="mt-1.5 text-muted-foreground font-medium">
                  {totalEvents} event{totalEvents !== 1 ? 's' : ''}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Day Timeline View ─────────────────────────────────────────────────────────

function DayTimelineView({
  date,
  events,
  contractors,
  onBack,
  onDeleteJob,
  onEditJob,
}: {
  date: Date
  events: CalEvent[]
  contractors: Contractor[]
  onBack: () => void
  onDeleteJob: (jobId: string) => Promise<void>
  onEditJob: (job: Job) => void
}) {
  const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 7am – 8pm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleConfirmDelete(jobId: string) {
    setDeleting(true)
    try {
      await onDeleteJob(jobId)
      setConfirmDeleteId(null)
    } finally {
      setDeleting(false)
    }
  }

  function fmtHour(h: number) {
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${h > 12 ? h - 12 : h === 0 ? 12 : h}${ampm}`
  }

  // Map events to time slots (by window or default to 8am)
  function eventHour(ev: CalEvent): number {
    if (ev.job?.scheduledTime) {
      return parseInt(ev.job.scheduledTime.split(':')[0], 10)
    }
    switch (ev.window) {
      case 'morning':   return 8
      case 'afternoon': return 12
      case 'evening':   return 17
      default:          return 8
    }
  }

  const eventsAtHour = (h: number) => events.filter(ev => eventHour(ev) === h)
  const allDayEvents = events.filter(ev => ev.type === 'subscription')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b shrink-0">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold">{label}</p>
          <p className="text-xs text-muted-foreground">{events.length} event{events.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* All-day events (subscriptions) */}
        {allDayEvents.length > 0 && (
          <div className="px-3 py-2 border-b bg-blue-50/50 dark:bg-blue-950/20">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">All Day</p>
            <div className="space-y-1.5">
              {allDayEvents.map(ev => (
                <div key={ev.id} className="flex items-center gap-2 rounded-lg bg-blue-100/60 dark:bg-blue-900/30 px-2.5 py-1.5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${ev.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{ev.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{ev.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hourly timeline */}
        <div className="relative">
          {HOURS.map(h => {
            const slotEvents = eventsAtHour(h).filter(ev => ev.type !== 'subscription')
            const isNow = new Date().getHours() === h && new Date().toDateString() === date.toDateString()
            return (
              <div key={h} className={`flex min-h-[56px] border-b ${isNow ? 'bg-primary/5' : ''}`}>
                <div className="w-14 shrink-0 pt-2 pr-2 text-right">
                  <span className="text-xs text-muted-foreground font-medium">{fmtHour(h)}</span>
                </div>
                <div className="flex-1 py-1.5 px-2 space-y-1.5">
                  {slotEvents.map(ev => {
                    const contractor = contractors.find(c => c.id === (ev.job?.contractorId ?? ev.contractorId))
                    const isConfirming = confirmDeleteId === ev.job?.id
                    return (
                      <div
                        key={ev.id}
                        className={`rounded-lg border px-3 py-2 ${isConfirming ? 'border-destructive/50 bg-destructive/5' : 'bg-card'} ${ev.job && !isConfirming ? 'cursor-pointer hover:border-primary/40' : ''}`}
                        onClick={ev.job && !isConfirming ? () => onEditJob(ev.job!) : undefined}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${ev.color}`} />
                            <p className="text-sm font-semibold truncate">{ev.title}</p>
                          </div>
                          {ev.job && !isConfirming && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={e => { e.stopPropagation(); onEditJob(ev.job!) }}
                                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
                                title="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); setConfirmDeleteId(ev.job!.id) }}
                                className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{ev.subtitle}</p>
                        {contractor && <p className="text-xs text-muted-foreground mt-0.5">🔧 {contractor.name}</p>}
                        {ev.job?.customerAddress && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{ev.job.customerAddress}
                          </p>
                        )}
                        {ev.job?.customerPhone && (
                          <a href={`tel:${ev.job.customerPhone}`} className="text-xs text-primary mt-0.5 flex items-center gap-1">
                            <Phone className="h-3 w-3" />{ev.job.customerPhone}
                          </a>
                        )}
                        {isConfirming && (
                          <div className="mt-2 flex items-center gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                            <p className="text-xs text-destructive flex-1">Delete this event?</p>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-muted-foreground px-2 py-1 rounded border hover:bg-muted transition-colors"
                            >Cancel</button>
                            <button
                              onClick={() => handleConfirmDelete(ev.job!.id)}
                              disabled={deleting}
                              className="text-xs text-white bg-destructive px-2 py-1 rounded hover:bg-destructive/90 transition-colors disabled:opacity-50"
                            >{deleting ? '…' : 'Delete'}</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

type CalView = 'month' | 'year' | 'day'

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [calView, setCalView] = useState<CalView>('month')
  const [dayViewDate, setDayViewDate] = useState<Date | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ job: Job; dateKey: string } | null>(null)
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [showNewQuoteVisit, setShowNewQuoteVisit] = useState(false)
  const [showAddService, setShowAddService] = useState(false)
  const [showAddSubVisit, setShowAddSubVisit] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
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

  const deleteJobMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobs'] })
      toast({ title: 'Event deleted' })
    },
    onError: (err: Error) => toast({ title: 'Delete failed', description: err.message, variant: 'destructive' }),
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

  const updateJobMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
      apiRequest('PATCH', `/jobs/${id}`, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobs'] })
      toast({ title: 'Job updated' })
    },
    onError: (err: Error) => toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
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

  // When in day view, show timeline instead of month grid
  if (calView === 'day' && dayViewDate) {
    const dayKey = `${dayViewDate.getFullYear()}-${String(dayViewDate.getMonth() + 1).padStart(2, '0')}-${String(dayViewDate.getDate()).padStart(2, '0')}`
    const dayEvents = eventsForKey(dayKey)
    return (
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <DayTimelineView
          date={dayViewDate}
          events={dayEvents}
          contractors={contractors}
          onBack={() => { setCalView('month'); setDayViewDate(null) }}
          onDeleteJob={async (jobId) => { await deleteJobMutation.mutateAsync(jobId) }}
          onEditJob={setEditingJob}
        />
        <EditJobSheet
          open={!!editingJob}
          onClose={() => setEditingJob(null)}
          job={editingJob}
          onSave={async (updates) => {
            if (!editingJob) return
            await updateJobMutation.mutateAsync({ id: editingJob.id, updates: updates as Record<string, unknown> })
            setEditingJob(null)
          }}
        />
        <NewQuoteVisitSheet
          open={showNewQuoteVisit}
          onClose={() => setShowNewQuoteVisit(false)}
          defaultDate={dayKey}
          onCreated={() => qc.invalidateQueries({ queryKey: ['/jobs'] })}
        />
        <AddServiceSheet
          open={showAddService}
          onClose={() => setShowAddService(false)}
          defaultDate={dayKey}
          onCreated={() => qc.invalidateQueries({ queryKey: ['/jobs'] })}
        />
        <AddSubVisitSheet
          open={showAddSubVisit}
          onClose={() => setShowAddSubVisit(false)}
          defaultDate={dayKey}
          onCreated={() => qc.invalidateQueries({ queryKey: ['/jobs'] })}
        />
        <ScheduleTimeSheet
          open={!!pendingDrop}
          job={pendingDrop?.job ?? null}
          targetDate={pendingDrop?.dateKey ?? ''}
          onConfirm={(date, window, time) => {
            if (!pendingDrop) return
            scheduleJobMutation.mutate({ id: pendingDrop.job.id, scheduledDate: date, scheduledWindow: window, startTime: time })
            setPendingDrop(null)
          }}
          onClose={() => setPendingDrop(null)}
        />
        <DragOverlay>{activeJob && <JobChipGhost job={activeJob} />}</DragOverlay>
      </DndContext>
    )
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-3 pt-3 pb-2 border-b shrink-0">
          <div className="flex items-center justify-between gap-2">
            {calView !== 'year' ? (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setYear(y => y - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="text-center flex-1">
              <p className="text-base font-bold">
                {calView === 'year' ? year : `${MONTH_NAMES[month]} ${year}`}
              </p>
              {calView === 'month' && !loading && (
                <p className="text-xs text-muted-foreground">
                  {totalJobEvents} one-time · {totalSubEvents} sub visits
                </p>
              )}
            </div>
            {calView !== 'year' ? (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setYear(y => y + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
          {/* View switcher */}
          <div className="flex items-center gap-1 mt-2">
            {(['month', 'year'] as CalView[]).map(v => (
              <button
                key={v}
                onClick={() => setCalView(v)}
                className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
                  calView === v
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button
                onClick={() => setShowAddService(true)}
                className="flex items-center gap-1 text-xs font-semibold py-1.5 px-2.5 rounded-lg border border-green-300 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-950/30 transition-colors"
              >
                <Plus className="h-3 w-3" />Service
              </button>
              <button
                onClick={() => setShowAddSubVisit(true)}
                className="flex items-center gap-1 text-xs font-semibold py-1.5 px-2.5 rounded-lg border border-blue-300 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
              >
                <Plus className="h-3 w-3" />Sub
              </button>
              <button
                onClick={() => setShowNewQuoteVisit(true)}
                className="flex items-center gap-1 text-xs font-semibold py-1.5 px-2.5 rounded-lg border border-purple-300 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
              >
                <Plus className="h-3 w-3" />Visit
              </button>
            </div>
          </div>
        </div>

        {/* Year view */}
        {calView === 'year' ? (
          <YearView
            year={year}
            jobEventMap={jobEventMap}
            subEventMap={subEventMap}
            onMonthClick={(m) => { setMonth(m); setCalView('month') }}
          />
        ) : (
          <>
            {/* Legend */}
            <div className="px-3 py-1.5 flex items-center gap-3 border-b shrink-0">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-green-500" />One-time
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-blue-500" />Sub
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-purple-500" />Quote Visit
              </div>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 px-2 pt-1.5 shrink-0">
              {DAY_ABBR.map(d => (
                <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-1">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            {loading ? (
              <div className="flex-1 flex items-center justify-center px-4">
                <Skeleton className="h-48 w-full rounded-xl" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-2 pb-2">
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
                        onClick={() => {
                          const d = new Date(year, month, day)
                          setDayViewDate(d)
                          setCalView('day')
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Unscheduled jobs strip — only in month view */}
        {calView === 'month' && (unscheduled.length > 0 || unscheduledSubs.length > 0) && (
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
        onDeleteJob={async (jobId) => {
          await deleteJobMutation.mutateAsync(jobId)
          // Close sheet automatically if no events will remain
          if (selectedEvents.filter(e => e.job?.id !== jobId).length === 0) {
            setSelectedDate(null)
          }
        }}
      />

      {/* Edit Job */}
      <EditJobSheet
        open={!!editingJob}
        onClose={() => setEditingJob(null)}
        job={editingJob}
        onSave={async (updates) => {
          if (!editingJob) return
          await updateJobMutation.mutateAsync({ id: editingJob.id, updates: updates as Record<string, unknown> })
          setEditingJob(null)
        }}
      />

      {/* New Quote Visit */}
      <NewQuoteVisitSheet
        open={showNewQuoteVisit}
        onClose={() => setShowNewQuoteVisit(false)}
        defaultDate={`${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`}
        onCreated={() => qc.invalidateQueries({ queryKey: ['/jobs'] })}
      />

      {/* Add Service from accepted quote */}
      <AddServiceSheet
        open={showAddService}
        onClose={() => setShowAddService(false)}
        defaultDate={`${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`}
        onCreated={() => qc.invalidateQueries({ queryKey: ['/jobs'] })}
      />

      {/* Add Sub Visit */}
      <AddSubVisitSheet
        open={showAddSubVisit}
        onClose={() => setShowAddSubVisit(false)}
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
