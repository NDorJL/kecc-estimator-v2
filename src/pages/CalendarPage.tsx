import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/queryClient'
import { Job, Subscription, Contractor } from '@/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight, MapPin, Phone, Wrench, RefreshCw, Calendar } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string           // unique key for rendering
  title: string        // customer name
  subtitle: string     // service name
  type: 'one_time' | 'subscription'
  color: string        // tailwind bg class
  // For one-time jobs
  job?: Job
  // For subscription events
  sub?: Subscription
  contractorId?: string | null
  serviceName?: string
}

// ── Calendar event generation ─────────────────────────────────────────────────

function getWeekNumber(date: Date): number {
  // Weeks since epoch (Sunday) — used for bi-weekly parity
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - dayOfWeek)
  return Math.floor(monday.getTime() / (7 * 24 * 60 * 60 * 1000))
}

function generateSubEvents(subs: Subscription[], year: number, month: number): Map<string, CalEvent[]> {
  // Map from 'YYYY-MM-DD' → events
  const map = new Map<string, CalEvent[]>()

  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)

  const COLORS = [
    'bg-blue-500', 'bg-purple-500', 'bg-teal-500', 'bg-orange-500',
    'bg-pink-500', 'bg-indigo-500', 'bg-cyan-500', 'bg-emerald-500',
  ]

  subs.forEach((sub, subIdx) => {
    if (sub.status !== 'ACTIVE') return
    const color = COLORS[subIdx % COLORS.length]

    for (const sch of (sub.serviceSchedules ?? [])) {
      const startDate = new Date(sch.startDate + 'T12:00:00')
      const freq = (sch.frequency ?? '').toLowerCase()

      // Walk every day of the month that matches dayOfWeek
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== sch.dayOfWeek) continue

        // Check frequency
        let include = false
        if (freq.includes('week') && !freq.includes('bi')) {
          include = true
        } else if (freq.includes('bi') && freq.includes('week')) {
          // Bi-weekly: same parity of week number as startDate
          const startWeek = getWeekNumber(startDate)
          const thisWeek  = getWeekNumber(d)
          include = (thisWeek - startWeek) % 2 === 0
        } else if (freq.includes('month')) {
          // Monthly: only the occurrence closest to startDate day-of-month
          const targetDay = startDate.getDate()
          // Find the first occurrence of dayOfWeek in the month on or after targetDay
          const firstOccurrence = new Date(year, month, 1)
          while (firstOccurrence.getDay() !== sch.dayOfWeek) firstOccurrence.setDate(firstOccurrence.getDate() + 1)
          // The occurrence that lands on or after targetDay — or just first occurrence if targetDay > all occurrences
          const occurrences: Date[] = []
          for (let od = new Date(firstOccurrence); od.getMonth() === month; od.setDate(od.getDate() + 7)) {
            occurrences.push(new Date(od))
          }
          // Pick the one closest to the target day
          const best = occurrences.reduce((a, b) =>
            Math.abs(a.getDate() - targetDay) <= Math.abs(b.getDate() - targetDay) ? a : b
          )
          include = d.getDate() === best.getDate()
        } else if (freq.includes('annual')) {
          // Annual: only if same month as startDate
          include = d.getMonth() === startDate.getMonth() && d.getDate() === startDate.getDate()
        } else if (freq.includes('quarter')) {
          // Quarterly: every 3 months from startDate month
          const monthDiff = (d.getMonth() - startDate.getMonth() + 12) % 12
          include = monthDiff % 3 === 0 && d.getDate() === startDate.getDate()
        } else {
          // Default: weekly
          include = true
        }

        if (!include) continue

        // startDate must be on or before this date
        if (d < startDate) continue

        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const ev: CalEvent = {
          id: `${sub.id}-${sch.serviceId}-${key}`,
          title: sub.customerName,
          subtitle: sch.serviceName,
          type: 'subscription',
          color,
          sub,
          contractorId: sch.contractorId,
          serviceName: sch.serviceName,
        }
        const arr = map.get(key) ?? []
        arr.push(ev)
        map.set(key, arr)
      }
    }
  })

  return map
}

function generateJobEvents(jobs: Job[], year: number, month: number): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  for (const job of jobs) {
    if (!job.scheduledDate) continue
    const d = new Date(job.scheduledDate + 'T12:00:00')
    if (d.getFullYear() !== year || d.getMonth() !== month) continue
    if (job.status === 'cancelled') continue
    const key = job.scheduledDate
    const ev: CalEvent = {
      id: `job-${job.id}`,
      title: job.customerName ?? 'Unknown',
      subtitle: job.serviceName,
      type: 'one_time',
      color: 'bg-green-500',
      job,
    }
    const arr = map.get(key) ?? []
    arr.push(ev)
    map.set(key, arr)
  }
  return map
}

// ── Day detail sheet ──────────────────────────────────────────────────────────

function DaySheet({
  date,
  events,
  contractors,
  open,
  onClose,
}: {
  date: Date | null
  events: CalEvent[]
  contractors: Contractor[]
  open: boolean
  onClose: () => void
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
          <p className="text-sm text-muted-foreground text-center py-8">No jobs scheduled for this day.</p>
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
                          {ev.type === 'subscription' ? 'Subscription' : 'One-Time'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{ev.subtitle}</p>

                      {/* Contact info from job */}
                      {ev.job?.customerAddress && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />{ev.job.customerAddress}
                        </p>
                      )}
                      {ev.job?.customerPhone && (
                        <a href={`tel:${ev.job.customerPhone}`} className="text-xs text-primary mt-0.5 flex items-center gap-1">
                          <Phone className="h-3 w-3 shrink-0" />{ev.job.customerPhone}
                        </a>
                      )}
                      {/* Sub contact info */}
                      {ev.sub?.customerAddress && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />{ev.sub.customerAddress}
                        </p>
                      )}
                      {ev.sub?.customerPhone && (
                        <a href={`tel:${ev.sub.customerPhone}`} className="text-xs text-primary mt-0.5 flex items-center gap-1">
                          <Phone className="h-3 w-3 shrink-0" />{ev.sub.customerPhone}
                        </a>
                      )}

                      {/* Property notes */}
                      {ev.job?.propertyInfo?.gateCode && (
                        <p className="text-xs text-muted-foreground mt-1">🔑 Gate: {ev.job.propertyInfo.gateCode}</p>
                      )}
                      {ev.job?.propertyInfo?.dogOnProperty && (
                        <p className="text-xs text-muted-foreground">🐕 {ev.job.propertyInfo.dogOnProperty}</p>
                      )}

                      {/* Contractor */}
                      {contractor && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Wrench className="h-3 w-3 shrink-0" />{contractor.name}{contractor.phone ? ` · ${contractor.phone}` : ''}
                        </p>
                      )}

                      {/* Job notes */}
                      {ev.job?.notes && (
                        <p className="text-xs text-muted-foreground mt-1 bg-muted/50 rounded p-1.5">{ev.job.notes}</p>
                      )}

                      {ev.job && (
                        <div className="mt-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            ev.job.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' :
                            ev.job.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' :
                            'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                          }`}>{ev.job.status.replace('_', ' ')}</span>
                        </div>
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

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

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

  const loading = jobsLoading || subsLoading

  // Generate all events for the current month
  const subEventMap  = useMemo(() => generateSubEvents(subs, year, month), [subs, year, month])
  const jobEventMap  = useMemo(() => generateJobEvents(jobs, year, month), [jobs, year, month])

  function eventsForDate(d: Date): CalEvent[] {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return [
      ...(jobEventMap.get(key) ?? []),
      ...(subEventMap.get(key) ?? []),
    ]
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Build grid: pad with nulls for days before month starts
  const firstDayOfMonth = new Date(year, month, 1).getDay()
  const daysInMonth     = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDayOfMonth).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad end to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedEvents = selectedDate ? eventsForDate(selectedDate) : []

  // Count total events this month for summary
  let totalSubEvents = 0
  subEventMap.forEach(arr => { totalSubEvents += arr.length })
  let totalJobEvents = 0
  jobEventMap.forEach(arr => { totalJobEvents += arr.length })

  return (
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

      {/* Legend */}
      <div className="px-4 py-2 flex items-center gap-3 border-b">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />One-time job
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />Subscription
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
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-48 w-full mx-4 rounded-xl" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <div className="grid grid-cols-7 gap-px">
            {cells.map((day, idx) => {
              if (!day) {
                return <div key={`empty-${idx}`} className="min-h-[64px]" />
              }
              const cellDate = new Date(year, month, day)
              const isToday  = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
              const events   = eventsForDate(cellDate)
              const hasJobs  = events.some(e => e.type === 'one_time')
              const hasSubs  = events.some(e => e.type === 'subscription')

              // Condense: show up to 2 dots, then +N
              const dotColors = [...new Set(events.slice(0, 3).map(e => e.color))]

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDate(cellDate)}
                  className={`min-h-[64px] rounded-lg p-1 flex flex-col items-center transition-colors ${
                    isToday
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
                  {/* Service type pills — tiny */}
                  <div className="flex flex-col items-center gap-0.5 mt-0.5 w-full">
                    {hasJobs && !isToday && (
                      <div className="w-full text-center">
                        <Calendar className="h-2.5 w-2.5 inline text-green-600" />
                      </div>
                    )}
                    {hasSubs && !isToday && (
                      <div className="w-full text-center">
                        <RefreshCw className="h-2.5 w-2.5 inline text-blue-500" />
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <DaySheet
        date={selectedDate}
        events={selectedEvents}
        contractors={contractors}
        open={!!selectedDate}
        onClose={() => setSelectedDate(null)}
      />
    </div>
  )
}
