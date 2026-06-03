import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { scheduleFiresOn } from '@/lib/subSchedule'
import { quoCallUrl } from '@/lib/utils'
import { Job, Subscription, Contractor, Contact, Quote, Lead } from '@/types'
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
      const [sy, sm, sd] = sch.startDate.split('-').map(Number)
      const freq = (sch.frequency ?? '').toLowerCase()
      for (let day = 1; day <= daysInMonth; day++) {
        // Recurrence decision is shared with Finance via src/lib/subSchedule.ts.
        if (!scheduleFiresOn({ y: sy, m: sm, d: sd }, freq, sch.dayOfWeek, { y: year, m: month + 1, d: day })) continue
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

    // Fallback for subs that have services[] but no serviceSchedules yet.
    // Now uses the shared scheduleFiresOn (dow derived from startDate) — this also fixes a
    // latent bug where the old fallback treated monthly/bi-monthly as weekly, making the
    // calendar disagree with the Finance occurrence count.
    if (schedules.length === 0 && (sub.services ?? []).length > 0) {
      const [sy, sm, sd] = (sub.startDate ?? '').split('-').map(Number)
      if (!sy) return
      for (const svc of sub.services) {
        const freq = (svc.frequency ?? '').toLowerCase()
        for (let day = 1; day <= daysInMonth; day++) {
          if (!scheduleFiresOn({ y: sy, m: sm, d: sd }, freq, null, { y: year, m: month + 1, d: day })) continue
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
    const isQuoteVisit = job.jobType === 'quote_visit'

    // Build list of dates this job spans (start through end, or just start)
    const startStr = job.scheduledDate
    const endStr   = job.scheduledEndDate && job.scheduledEndDate > startStr ? job.scheduledEndDate : startStr
    const start = new Date(startStr + 'T12:00:00')
    const end   = new Date(endStr   + 'T12:00:00')
    const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1

    for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
      const d = new Date(start)
      d.setDate(start.getDate() + dayOffset)
      if (d.getFullYear() !== year || d.getMonth() !== month) continue
      const key = d.toISOString().slice(0, 10)
      const arr = map.get(key) ?? []
      const dayLabel = totalDays > 1 ? ` (Day ${dayOffset + 1}/${totalDays})` : ''
      arr.push({
        id: `job-${job.id}-d${dayOffset}`,
        title: job.customerName ?? 'Unknown',
        subtitle: isQuoteVisit
          ? `📋 Quote Visit${job.scheduledTime ? ' · ' + fmtTime12(job.scheduledTime) : ''}`
          : job.serviceName + dayLabel,
        type: isQuoteVisit ? 'quote_visit' : 'one_time',
        color: isQuoteVisit ? 'bg-purple-500' : 'bg-green-500',
        job,
        window: job.scheduledWindow,
      })
      map.set(key, arr)
    }
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
                        <a href={quoCallUrl(ev.job?.customerPhone ?? ev.sub?.customerPhone ?? '')} className="text-xs text-primary mt-0.5 flex items-center gap-1">
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
                          <a href={quoCallUrl(ev.job.customerPhone ?? '')} className="text-xs text-primary mt-0.5 flex items-center gap-1">
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

/* ── Universal Add Event Sheet ───────────────────────────────────────────── */

const EVENT_TYPES = [
  { value: 'one_time',    label: 'One-Time Service', icon: '🔧', desc: 'Individual service visit' },
  { value: 'quote_visit', label: 'Quote Visit',      icon: '📋', desc: 'In-person estimate appointment' },
  { value: 'sub_visit',   label: 'Subscription Visit', icon: '🔄', desc: 'Scheduled recurring client visit' },
] as const
type EventType = typeof EVENT_TYPES[number]['value']

const TIME_WINDOWS = [
  { value: 'anytime',   label: 'Anytime' },
  { value: 'morning',   label: 'Morning  (8 am – 12 pm)' },
  { value: 'afternoon', label: 'Afternoon (12 pm – 5 pm)' },
  { value: 'evening',   label: 'Evening  (5 pm – 8 pm)' },
  { value: 'specific',  label: 'Specific time…' },
]

function UniversalEventSheet({
  open, onClose, defaultDate, onCreated,
}: {
  open: boolean
  onClose: () => void
  defaultDate: string
  onCreated: () => void
}) {
  const { toast } = useToast()

  // Event type
  const [eventType, setEventType] = useState<EventType>('one_time')

  // Date / time
  const [date, setDate]             = useState(defaultDate)
  const [endDate, setEndDate]       = useState('')
  const [window, setWindow]         = useState('anytime')
  const [specificTime, setSpecificTime] = useState('09:00')

  // Contact search
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [contactSearch, setContactSearch]     = useState('')
  const [showDropdown, setShowDropdown]       = useState(false)
  const searchRef   = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Customer fields (auto-filled or manual)
  const [customerName, setCustomerName]       = useState('')
  const [customerPhone, setCustomerPhone]     = useState('')
  const [customerAddress, setCustomerAddress] = useState('')

  // Service / content
  const [serviceName, setServiceName] = useState('')
  const [notes, setNotes]             = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  // Subscription picker (for sub_visit)
  const [subId, setSubId] = useState('')

  const [loading, setLoading] = useState(false)

  // Reset when opened / date changes
  useEffect(() => {
    if (open) {
      setDate(defaultDate)
      setEventType('one_time')
      setEndDate('')
      setWindow('anytime')
      setSpecificTime('09:00')
      setSelectedContact(null)
      setContactSearch('')
      setCustomerName('')
      setCustomerPhone('')
      setCustomerAddress('')
      setServiceName('')
      setNotes('')
      setInternalNotes('')
      setSubId('')
    }
  }, [open, defaultDate])

  // Auto-fill service name for quote visits
  useEffect(() => {
    if (eventType === 'quote_visit') setServiceName('In-Person Quote')
    else if (eventType === 'one_time') setServiceName('')
  }, [eventType])

  // Load contacts for picker
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet('/contacts'),
    enabled: open,
  })

  // Load subscriptions for sub_visit
  const { data: subs = [] } = useQuery<Subscription[]>({
    queryKey: ['/subscriptions'],
    queryFn: () => apiGet('/subscriptions'),
    enabled: open && eventType === 'sub_visit',
  })
  const activeSubs = subs.filter(s => s.status === 'ACTIVE')

  // Contact search filter
  const filteredContacts = contactSearch.trim().length > 0
    ? contacts.filter(c =>
        c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
        (c.phone ?? '').includes(contactSearch)
      ).slice(0, 8)
    : contacts.slice(0, 8)

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDropdown])

  async function selectContact(c: Contact) {
    setSelectedContact(c)
    setCustomerName(c.name)
    setCustomerPhone(c.phone ?? '')
    setContactSearch('')
    setShowDropdown(false)
    try {
      const props = await apiGet<Array<{ address: string }>>(`/properties?contactId=${c.id}`)
      if (props?.[0]?.address) setCustomerAddress(props[0].address)
    } catch { /* non-fatal */ }
  }

  // Auto-fill from selected subscription
  useEffect(() => {
    if (eventType !== 'sub_visit' || !subId) return
    const sub = activeSubs.find(s => s.id === subId)
    if (!sub) return
    setCustomerName(sub.customerName ?? '')
    setCustomerAddress(sub.customerAddress ?? '')
    const svcNames = (sub.services ?? []).map((s: { serviceName: string }) => s.serviceName).join(', ')
    setServiceName(svcNames || '')
  }, [subId, eventType]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    if (!date) { toast({ title: 'Date is required', variant: 'destructive' }); return }
    if (eventType === 'one_time' && !serviceName.trim()) {
      toast({ title: 'Service name is required', variant: 'destructive' }); return
    }
    if (eventType === 'sub_visit' && !subId) {
      toast({ title: 'Please select a subscription', variant: 'destructive' }); return
    }

    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        jobType:         eventType === 'sub_visit' ? 'one_time' : eventType,
        serviceName:     serviceName.trim() || 'Service Visit',
        status:          'scheduled',
        scheduledDate:   date,
        scheduledWindow: window === 'specific' ? 'specific' : window,
        notes:           notes.trim() || null,
        internalNotes:   internalNotes.trim() || null,
        customerName:    customerName.trim() || null,
        customerPhone:   customerPhone.trim() || null,
        customerAddress: customerAddress.trim() || null,
      }
      if (endDate && endDate > date) body.scheduledEndDate = endDate
      if (window === 'specific') body.scheduledTime = specificTime
      if (selectedContact) body.contactId = selectedContact.id
      if (eventType === 'sub_visit') body.subscriptionId = subId

      await apiRequest('POST', '/jobs', body)
      toast({ title: '✓ Event added', description: `${serviceName || 'Event'} on ${date}` })
      onCreated()
      onClose()
    } catch (err) {
      toast({ title: 'Failed to create event', description: String(err), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="h-[90dvh] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
          <SheetTitle>Add Event</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">

          {/* Event type selector */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Event Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {EVENT_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setEventType(t.value)}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-all ${
                    eventType === t.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  <span className="text-xl">{t.icon}</span>
                  <span className="text-[11px] font-semibold leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">
              {EVENT_TYPES.find(t => t.value === eventType)?.desc}
            </p>
          </div>

          {/* Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ev-date" className="text-xs font-semibold mb-1.5 block">Date *</Label>
              <Input id="ev-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            {eventType === 'one_time' && (
              <div>
                <Label htmlFor="ev-end" className="text-xs font-semibold mb-1.5 block">End Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="ev-end" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
              </div>
            )}
          </div>

          {/* Time window */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Time Window</Label>
            <div className="flex flex-wrap gap-2">
              {TIME_WINDOWS.map(tw => (
                <button
                  key={tw.value}
                  onClick={() => setWindow(tw.value)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                    window === tw.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  {tw.value === 'specific' ? '⏰ Specific time' : tw.label.split(' ')[0]}
                </button>
              ))}
            </div>
            {window === 'specific' && (
              <Input
                type="time"
                value={specificTime}
                onChange={e => setSpecificTime(e.target.value)}
                className="mt-2 w-36"
              />
            )}
          </div>

          {/* Subscription picker — only for sub_visit */}
          {eventType === 'sub_visit' && (
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Subscription *</Label>
              <Select value={subId} onValueChange={setSubId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a subscription…" />
                </SelectTrigger>
                <SelectContent>
                  {activeSubs.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.customerName} — {(s.services ?? []).map((sv: { serviceName: string }) => sv.serviceName).join(', ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Contact search */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">
              Customer / Contact <span className="text-muted-foreground font-normal">{eventType === 'quote_visit' ? '(recommended)' : '(optional)'}</span>
            </Label>
            {selectedContact ? (
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">{selectedContact.name}</p>
                  {selectedContact.phone && <p className="text-xs text-muted-foreground">{selectedContact.phone}</p>}
                </div>
                <button onClick={() => { setSelectedContact(null); setCustomerName(''); setCustomerPhone(''); setCustomerAddress('') }} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  placeholder="Search contacts…"
                  value={contactSearch}
                  onChange={e => { setContactSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  className="pl-8"
                />
                {showDropdown && (
                  <div ref={dropdownRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {filteredContacts.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-3 py-2">No contacts found</p>
                    ) : filteredContacts.map(c => (
                      <button key={c.id} onClick={() => selectContact(c)} className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors">
                        <p className="text-sm font-semibold">{c.name}</p>
                        {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Manual fallback fields if no contact selected */}
            {!selectedContact && (customerName || customerPhone || customerAddress) && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input placeholder="Name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                <Input placeholder="Phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
              </div>
            )}
          </div>

          {/* Service name */}
          {eventType !== 'sub_visit' && (
            <div>
              <Label htmlFor="ev-service" className="text-xs font-semibold mb-1.5 block">
                {eventType === 'quote_visit' ? 'Appointment Label' : 'Service Name *'}
              </Label>
              <Input
                id="ev-service"
                placeholder={eventType === 'quote_visit' ? 'In-Person Quote' : 'e.g. House Wash, Lawn Mow…'}
                value={serviceName}
                onChange={e => setServiceName(e.target.value)}
              />
            </div>
          )}

          {/* Address */}
          <div>
            <Label htmlFor="ev-addr" className="text-xs font-semibold mb-1.5 block">Location / Address <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              id="ev-addr"
              placeholder="123 Main St, Knoxville TN"
              value={customerAddress}
              onChange={e => setCustomerAddress(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="ev-notes" className="text-xs font-semibold mb-1.5 block">Notes <span className="text-muted-foreground font-normal">(visible to customer)</span></Label>
            <Textarea id="ev-notes" rows={2} placeholder="Any details for this event…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ev-internal" className="text-xs font-semibold mb-1.5 block">Internal Notes <span className="text-muted-foreground font-normal">(crew only)</span></Label>
            <Textarea id="ev-internal" rows={2} placeholder="Gate code, dog on property, parking notes…" value={internalNotes} onChange={e => setInternalNotes(e.target.value)} />
          </div>

        </div>

        {/* Footer */}
        <div className="shrink-0 border-t px-4 py-3 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Adding…' : 'Add Event'}
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
  const [calView, setCalView] = useState<CalView>('month')
  const [dayViewDate, setDayViewDate] = useState<Date | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ job: Job; dateKey: string } | null>(null)
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [showUniversalEvent, setShowUniversalEvent] = useState(false)
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

  // Helper: invalidate all views that reflect job state
  const invalidateJobRelated = () => {
    qc.invalidateQueries({ queryKey: ['/jobs'] })
    qc.invalidateQueries({ queryKey: ['/leads'] })   // lead stage may reflect job status
  }

  const deleteJobMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/jobs/${id}`),
    onSuccess: () => {
      invalidateJobRelated()
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
      invalidateJobRelated()
      toast({ title: 'Job scheduled!' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const updateJobMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
      apiRequest('PATCH', `/jobs/${id}`, updates),
    onSuccess: () => {
      invalidateJobRelated()
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
            <div className="ml-auto shrink-0">
              <button
                onClick={() => setShowUniversalEvent(true)}
                className="flex items-center gap-1.5 text-xs font-semibold py-1.5 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all"
              >
                <Plus className="h-3.5 w-3.5" />Add Event
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

      {/* Universal Add Event */}
      <UniversalEventSheet
        open={showUniversalEvent}
        onClose={() => setShowUniversalEvent(false)}
        defaultDate={selectedDateKey ?? `${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`}
        onCreated={() => { qc.invalidateQueries({ queryKey: ['/jobs'] }); qc.invalidateQueries({ queryKey: ['/leads'] }) }}
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
