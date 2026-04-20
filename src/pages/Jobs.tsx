import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Job, Subscription, Contractor, ServiceSchedule } from '@/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  CalendarDays, User, MapPin, Phone, Mail, Wrench,
  ChevronRight, Clock, AlertCircle, CheckCircle2, RefreshCw, Calendar,
} from 'lucide-react'

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

  // Re-sync form when job changes
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  if (job && job.id !== lastJobId) {
    setLastJobId(job.id)
    setForm({
      status: job.status,
      scheduledDate: job.scheduledDate ?? '',
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

  const saveMutation = useMutation({
    mutationFn: () => apiRequest('PATCH', `/jobs/${job!.id}`, {
      status: form.status,
      scheduledDate: form.scheduledDate || null,
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

  if (!job) return null

  const contractor = contractors.find(c => c.id === form.contractorId)

  return (
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
                <a href={`tel:${job.customerPhone}`} className="text-primary">{job.customerPhone}</a>
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
              <Label className="text-xs">Scheduled Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
              />
            </div>
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
                {contractor.phone && <a href={`tel:${contractor.phone}`} className="flex items-center gap-1"><Phone className="h-3 w-3" />{contractor.phone}</a>}
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

          <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : 'Save Job'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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
      <div className="px-4 pt-4 pb-2 border-b">
        <h2 className="text-base font-semibold">Open Jobs</h2>
        <p className="text-xs text-muted-foreground">
          {activeSubs.length} subscription{activeSubs.length !== 1 ? 's' : ''} · {oneTimeJobs.length} one-time job{oneTimeJobs.length !== 1 ? 's' : ''}
        </p>
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
    </div>
  )
}
