import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Lead, Quote, LeadStage, LineItem } from '@/types'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Plus, Clock, GripVertical, FileText, ArrowRight,
  MapPin, Phone, Mail, User, ChevronRight, CalendarPlus,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { ScheduleQuoteSheet } from '@/components/ScheduleQuoteSheet'

// ── Stage config ─────────────────────────────────────────────────────────────

const STAGES: { id: LeadStage; label: string; color: string; headerColor?: string }[] = [
  { id: 'new',       label: 'New Lead',   color: 'bg-slate-100 dark:bg-slate-800' },
  { id: 'contacted', label: 'Contacted',  color: 'bg-blue-50 dark:bg-blue-950/40' },
  { id: 'quoted',    label: 'Quoted',     color: 'bg-yellow-50 dark:bg-yellow-950/30' },
  { id: 'scheduled', label: 'Scheduled',  color: 'bg-violet-50 dark:bg-violet-950/30', headerColor: 'text-violet-700 dark:text-violet-400' },
  { id: 'finished',  label: 'Finished',   color: 'bg-teal-50 dark:bg-teal-950/30', headerColor: 'text-teal-700 dark:text-teal-400' },
  { id: 'recurring', label: 'Recurring ↻', color: 'bg-indigo-50 dark:bg-indigo-950/30', headerColor: 'text-indigo-700 dark:text-indigo-400' },
  { id: 'unpaid',    label: 'Unpaid',     color: 'bg-amber-50 dark:bg-amber-950/30', headerColor: 'text-amber-700 dark:text-amber-400' },
  { id: 'paid',      label: 'Paid ✓',    color: 'bg-emerald-50 dark:bg-emerald-950/30', headerColor: 'text-emerald-700 dark:text-emerald-400' },
  { id: 'lost',      label: 'Lost',       color: 'bg-red-50 dark:bg-red-950/30' },
]

function daysAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d === 0 ? 'today' : d === 1 ? '1d' : `${d}d`
}

function fmtMoney(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

function servicesSummary(items: LineItem[]): string {
  if (!items || items.length === 0) return ''
  if (items.length === 1) return items[0].serviceName
  return `${items[0].serviceName} +${items.length - 1} more`
}

// ── Lead Card (sortable within kanban) ───────────────────────────────────────

function LeadCard({
  lead,
  displayName,
  subline,
  onClick,
}: {
  lead: Lead
  displayName: string
  subline: string
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="rounded-lg border bg-card p-2.5 shadow-sm cursor-pointer hover:border-primary/50 transition-colors touch-none"
    >
      <p className="text-sm font-semibold leading-snug">{displayName}</p>
      {subline && (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{subline}</p>
      )}
      <div className="flex items-center justify-between mt-1.5">
        {lead.estimatedValue ? (
          <span className="text-xs font-bold text-primary">{fmtMoney(lead.estimatedValue)}</span>
        ) : (
          <span />
        )}
        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
          <Clock className="h-3 w-3" />{daysAgo(lead.createdAt)}
        </span>
      </div>
    </div>
  )
}

function LeadCardGhost({ displayName, subline }: { displayName: string; subline: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-lg rotate-1 opacity-90">
      <p className="text-sm font-semibold">{displayName}</p>
      {subline && <p className="text-xs text-muted-foreground mt-0.5">{subline}</p>}
    </div>
  )
}

// ── Draggable Quote Card (right panel) ───────────────────────────────────────

const QUOTE_STATUS_COLORS: Record<string, string> = {
  draft:    'bg-muted text-muted-foreground',
  sent:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

function DraggableQuoteCard({
  quote,
  linkedStageLabel,
}: {
  quote: Quote
  linkedStageLabel: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `q-${quote.id}`,
  })

  const summary = servicesSummary(quote.lineItems)

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` } : undefined}
      {...attributes}
      {...listeners}
      className={`rounded-lg border bg-card p-2 shadow-sm cursor-grab active:cursor-grabbing touch-none select-none transition-opacity ${isDragging ? 'opacity-40' : 'opacity-100'}`}
    >
      <div className="flex items-start gap-1">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold leading-snug truncate">{quote.customerName}</p>
          {summary && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate leading-snug">{summary}</p>
          )}
          <p className="text-sm font-bold text-primary mt-0.5">{fmtMoney(quote.total)}</p>
          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1 ${QUOTE_STATUS_COLORS[quote.status] ?? 'bg-muted'}`}>
            {quote.status}
          </span>
          {linkedStageLabel && (
            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
              <ArrowRight className="h-2.5 w-2.5" />{linkedStageLabel}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function QuoteCardGhost({ quote }: { quote: Quote }) {
  return (
    <div className="rounded-lg border bg-primary text-primary-foreground p-2 shadow-xl rotate-2 w-[148px]">
      <p className="text-xs font-semibold truncate">{quote.customerName}</p>
      <p className="text-sm font-bold">{fmtMoney(quote.total)}</p>
      <p className="text-[10px] opacity-75 mt-0.5">Drop into stage →</p>
    </div>
  )
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  leads,
  displayNames,
  sublines,
  onCardClick,
}: {
  stage: typeof STAGES[number]
  leads: Lead[]
  displayNames: Record<string, string>
  sublines: Record<string, string>
  onCardClick: (lead: Lead) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  return (
    <div className={`flex flex-col rounded-xl border min-w-[180px] w-[180px] shrink-0 ${stage.color} ${isOver ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center justify-between px-2.5 py-2 border-b bg-white/50 dark:bg-black/20 rounded-t-xl">
        <span className={`text-xs font-semibold ${stage.headerColor ?? ''}`}>{stage.label}</span>
        <Badge variant="secondary" className="text-xs h-5 px-1.5">{leads.length}</Badge>
      </div>
      <div ref={setNodeRef} className="flex flex-col gap-2 p-2 min-h-[100px]">
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              displayName={displayNames[l.id] ?? 'Unknown'}
              subline={sublines[l.id] ?? ''}
              onClick={() => onCardClick(l)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}

// ── Quote Detail inside Lead Sheet ───────────────────────────────────────────

function QuoteDetailPanel({ quote }: { quote: Quote }) {
  const fmt = (n: number) => `$${n.toFixed(2)}`

  const onetimeItems = quote.lineItems.filter(li => !li.isSubscription)
  const subItems = quote.lineItems.filter(li => li.isSubscription)

  return (
    <div className="rounded-xl border bg-muted/30 overflow-hidden">
      {/* Customer info */}
      <div className="p-3 border-b space-y-1">
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-sm font-semibold">{quote.customerName}</p>
          {quote.businessName && (
            <span className="text-xs text-muted-foreground">· {quote.businessName}</span>
          )}
        </div>
        {quote.customerAddress && (
          <div className="flex items-start gap-2">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">{quote.customerAddress}</p>
          </div>
        )}
        {quote.customerPhone && (
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">{quote.customerPhone}</p>
          </div>
        )}
        {quote.customerEmail && (
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">{quote.customerEmail}</p>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="p-3 space-y-1">
        {onetimeItems.length > 0 && (
          <>
            {onetimeItems.length > 0 && subItems.length > 0 && (
              <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">One-Time</p>
            )}
            {onetimeItems.map((li, i) => (
              <div key={i} className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug">{li.serviceName}</p>
                  {li.description && (
                    <p className="text-[10px] text-muted-foreground leading-snug">{li.description}</p>
                  )}
                  {li.quantity !== 1 && (
                    <p className="text-[10px] text-muted-foreground">
                      {li.quantity} {li.unitLabel ?? 'units'} × {fmt(li.unitPrice)}
                    </p>
                  )}
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0">{fmt(li.lineTotal)}</span>
              </div>
            ))}
          </>
        )}

        {subItems.length > 0 && (
          <>
            {onetimeItems.length > 0 && (
              <p className="text-[10px] text-muted-foreground uppercase font-semibold mt-2 mb-1">Monthly</p>
            )}
            {subItems.map((li, i) => (
              <div key={i} className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug">{li.serviceName}</p>
                  {li.description && (
                    <p className="text-[10px] text-muted-foreground leading-snug">{li.description}</p>
                  )}
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0">
                  {fmt(li.monthlyAmount ?? li.lineTotal)}/mo
                </span>
              </div>
            ))}
          </>
        )}

        {/* Totals */}
        <div className="mt-2 pt-2 border-t space-y-0.5">
          {quote.discount != null && quote.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Discount</span>
              <span className="text-xs text-green-600 font-medium">−{fmt(quote.discount)}</span>
            </div>
          )}
          {onetimeItems.length > 0 && subItems.length > 0 ? (
            <>
              <div className="flex justify-between">
                <span className="text-xs font-semibold">Due Today</span>
                <span className="text-sm font-bold tabular-nums">
                  {fmt(onetimeItems.reduce((s, li) => s + li.lineTotal, 0))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs font-semibold">Monthly</span>
                <span className="text-sm font-bold tabular-nums text-primary">
                  {fmt(subItems.reduce((s, li) => s + (li.monthlyAmount ?? li.lineTotal), 0))}/mo
                </span>
              </div>
            </>
          ) : (
            <div className="flex justify-between">
              <span className="text-xs font-semibold">Total</span>
              <span className="text-sm font-bold tabular-nums text-primary">
                {fmt(quote.total)}{subItems.length > 0 ? '/mo' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Status + date */}
      <div className="px-3 pb-3 flex items-center justify-between">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[quote.status] ?? 'bg-muted text-muted-foreground'}`}>
          {quote.status}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(quote.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      {/* Notes */}
      {quote.notes && (
        <div className="px-3 pb-3 border-t pt-2">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Quote Notes</p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{quote.notes}</p>
        </div>
      )}
    </div>
  )
}

// ── Lead Detail Sheet ─────────────────────────────────────────────────────────

function LeadDetailSheet({
  lead,
  quote,
  displayName,
  open,
  onClose,
}: {
  lead: Lead | null
  quote: Quote | null
  displayName: string
  open: boolean
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [notes, setNotes] = useState(lead?.notes ?? '')
  const [lostReason, setLostReason] = useState(lead?.lostReason ?? '')
  const [showSchedule, setShowSchedule] = useState(false)

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Lead>) =>
      apiRequest('PATCH', `/leads/${lead?.id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Lead updated' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  if (!lead) return null

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            {displayName}
            {quote && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[quote.status] ?? 'bg-muted'}`}>
                {quote.status}
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Full quote detail when linked */}
          {quote && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide">Quote Details</p>
              <QuoteDetailPanel quote={quote} />
            </div>
          )}

          {/* If no quote, show lead fields */}
          {!quote && (
            <>
              {lead.serviceInterest && (
                <div>
                  <Label className="text-xs">Service Interest</Label>
                  <p className="text-sm mt-1">{lead.serviceInterest}</p>
                </div>
              )}
              {lead.estimatedValue && (
                <div>
                  <Label className="text-xs">Estimated Value</Label>
                  <p className="text-sm font-semibold mt-1">{fmtMoney(lead.estimatedValue)}</p>
                </div>
              )}
            </>
          )}

          {/* Stage */}
          <div>
            <Label className="text-xs">Stage</Label>
            <Select
              value={lead.stage}
              onValueChange={v => updateMutation.mutate({ stage: v as LeadStage })}
            >
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {lead.stage === 'lost' && (
            <div>
              <Label className="text-xs">Lost Reason</Label>
              <Input
                value={lostReason}
                onChange={e => setLostReason(e.target.value)}
                placeholder="Why was this lost?"
                className="mt-1"
              />
            </div>
          )}

          {/* Lead notes */}
          <div>
            <Label className="text-xs">Lead Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder="Add notes about this lead…"
            />
          </div>

          {/* Schedule Job — only visible once the linked quote is e-signed */}
          {quote?.signedAt && (
            <Button
              className="w-full bg-primary"
              onClick={() => setShowSchedule(true)}
            >
              <CalendarPlus className="h-4 w-4 mr-2" />Schedule Job
            </Button>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ notes: notes || null, lostReason: lostReason || null })}
            >
              Save Notes
            </Button>
            {lead.contactId && (
              <Button
                variant="outline"
                onClick={() => { navigate(`/contacts/${lead.contactId}`); onClose() }}
              >
                Contact
              </Button>
            )}
            {quote && (
              <Button
                variant="outline"
                className="flex items-center gap-1"
                onClick={() => { navigate('/quotes'); onClose() }}
              >
                <ChevronRight className="h-4 w-4" />Quote
              </Button>
            )}
          </div>
        </div>

        {/* Schedule sheet — nested so it shares the lead detail's quote context */}
        {quote && (
          <ScheduleQuoteSheet
            quote={quote}
            open={showSchedule}
            onClose={() => setShowSchedule(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── New Lead Sheet ────────────────────────────────────────────────────────────

function NewLeadSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({
    contactId: '',
    serviceInterest: '',
    estimatedValue: '',
    source: '',
    notes: '',
  })
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: contacts = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet('/contacts'),
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/leads', {
      contactId: form.contactId || null,
      serviceInterest: form.serviceInterest || null,
      estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : null,
      source: form.source || null,
      notes: form.notes || null,
      stage: 'new',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Lead created' })
      setForm({ contactId: '', serviceInterest: '', estimatedValue: '', source: '', notes: '' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="mb-4"><SheetTitle>New Lead</SheetTitle></SheetHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Contact (optional)</Label>
            <Select value={form.contactId} onValueChange={v => setForm(f => ({ ...f, contactId: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select contact…" /></SelectTrigger>
              <SelectContent>
                {contacts.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Service Interest</Label>
            <Input
              placeholder="e.g. Lawn Care, Landscaping…"
              value={form.serviceInterest}
              onChange={e => setForm(f => ({ ...f, serviceInterest: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Estimated Value ($)</Label>
            <Input
              type="number"
              placeholder="0"
              value={form.estimatedValue}
              onChange={e => setForm(f => ({ ...f, estimatedValue: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Source</Label>
            <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="How did they find you?" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="website">Website</SelectItem>
                <SelectItem value="social">Social Media</SelectItem>
                <SelectItem value="cold_call">Cold Call</SelectItem>
                <SelectItem value="inbound_sms">Inbound SMS</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              placeholder="Initial notes…"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="mt-1"
            />
          </div>
          <Button
            className="w-full"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Lead'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Main Leads Page ───────────────────────────────────────────────────────────

export default function Leads() {
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [activeQuote, setActiveQuote] = useState<Quote | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [showNew, setShowNew] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: leads, isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ['/leads'],
    queryFn: () => apiGet('/leads'),
  })

  const { data: contacts, isLoading: contactsLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet('/contacts'),
  })

  const { data: quotes, isLoading: quotesLoading } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
  })

  // Contact name lookup
  const contactNames: Record<string, string> = {}
  for (const c of contacts ?? []) contactNames[c.id] = c.name

  // Quote lookup by ID
  const quoteById: Record<string, Quote> = {}
  for (const q of quotes ?? []) quoteById[q.id] = q

  // Map quoteId → lead stage (for indicator on right panel)
  const quoteLeadMap: Record<string, LeadStage> = {}
  for (const l of leads ?? []) {
    if (l.quoteId) quoteLeadMap[l.quoteId] = l.stage
  }

  // Per-lead: display name and subline
  // Priority: quote.customerName > contactNames[contactId] > 'Unknown'
  function getDisplayName(lead: Lead): string {
    if (lead.quoteId && quoteById[lead.quoteId]) return quoteById[lead.quoteId].customerName
    if (lead.contactId && contactNames[lead.contactId]) return contactNames[lead.contactId]
    return 'Unknown'
  }

  function getSubline(lead: Lead): string {
    if (lead.quoteId && quoteById[lead.quoteId]) {
      const q = quoteById[lead.quoteId]
      return servicesSummary(q.lineItems)
    }
    return lead.serviceInterest ?? ''
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateStageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: LeadStage }) =>
      apiRequest('PATCH', `/leads/${id}`, { stage }),
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: ['/leads'] })
      const prev = queryClient.getQueryData<Lead[]>(['/leads'])
      queryClient.setQueryData<Lead[]>(['/leads'], old =>
        old?.map(l => l.id === id ? { ...l, stage } : l) ?? []
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(['/leads'], ctx?.prev)
      toast({ title: 'Failed to update stage', variant: 'destructive' })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['/leads'] }),
  })

  // Create a lead from a dragged quote — carries all quote data
  const createLeadFromQuoteMutation = useMutation({
    mutationFn: ({ quote, stage }: { quote: Quote; stage: LeadStage }) =>
      apiRequest('POST', '/leads', {
        contactId: quote.contactId ?? null,
        quoteId: quote.id,
        stage,
        estimatedValue: quote.total,
        serviceInterest: servicesSummary(quote.lineItems) || null,
        source: 'quote',
        notes: null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Lead created from quote' })
    },
    onError: (err: Error) => toast({ title: 'Failed', description: err.message, variant: 'destructive' }),
  })

  // ── DnD sensors ───────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    if (id.startsWith('q-')) {
      const quoteId = id.replace('q-', '')
      setActiveQuote(quotes?.find(q => q.id === quoteId) ?? null)
      setActiveLead(null)
    } else {
      setActiveLead(leads?.find(l => l.id === id) ?? null)
      setActiveQuote(null)
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e

    if (!over) {
      setActiveLead(null)
      setActiveQuote(null)
      return
    }

    const activeId = String(active.id)
    const overId   = String(over.id)

    // ── Quote dropped into pipeline ─────────────────────────────────────────
    if (activeId.startsWith('q-')) {
      setActiveQuote(null)
      const quoteId = activeId.replace('q-', '')
      const quote = quotes?.find(q => q.id === quoteId)
      if (!quote) return

      const targetStage: LeadStage | undefined =
        (STAGES.find(s => s.id === overId)?.id as LeadStage | undefined) ??
        leads?.find(l => l.id === overId)?.stage

      if (!targetStage) return

      const existingLead = leads?.find(l => l.quoteId === quote.id)
      if (existingLead) {
        updateStageMutation.mutate({ id: existingLead.id, stage: targetStage })
      } else {
        createLeadFromQuoteMutation.mutate({ quote, stage: targetStage })
      }
      return
    }

    // ── Lead card drag ────────────────────────────────────────────────────────
    setActiveLead(null)
    const lead = leads?.find(l => l.id === activeId)
    if (!lead) return

    const targetStage: LeadStage | undefined =
      (STAGES.find(s => s.id === overId)?.id as LeadStage | undefined) ??
      leads?.find(l => l.id === overId)?.stage

    if (targetStage && targetStage !== lead.stage) {
      updateStageMutation.mutate({ id: lead.id, stage: targetStage })
    }
  }

  function handleDragOver(e: DragOverEvent) {
    if (String(e.active.id).startsWith('q-')) return
    const { over } = e
    if (!over) return
    const lead = leads?.find(l => l.id === e.active.id)
    if (!lead) return
    const targetStage = STAGES.find(s => s.id === String(over.id))?.id as LeadStage | undefined
    if (targetStage && targetStage !== lead.stage) {
      queryClient.setQueryData<Lead[]>(['/leads'], old =>
        old?.map(l => l.id === lead.id ? { ...l, stage: targetStage } : l) ?? []
      )
    }
  }

  const loading = leadsLoading || contactsLoading

  // Quotes for right panel: exclude any already in the pipeline, sort by priority
  const sortedQuotes = [...(quotes ?? [])]
    .filter(q => !quoteLeadMap[q.id])   // hide quotes already dragged into a stage
    .sort((a, b) => {
      const order: Record<string, number> = { sent: 0, accepted: 1, draft: 2, declined: 3 }
      const sa = order[a.status] ?? 2
      const sb = order[b.status] ?? 2
      if (sa !== sb) return sa - sb
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  // Selected lead's linked quote (if any)
  const selectedQuote = selectedLead?.quoteId ? (quoteById[selectedLead.quoteId] ?? null) : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0">
        <div>
          <h2 className="text-base font-bold">Lead Pipeline</h2>
          <p className="text-xs text-muted-foreground">
            {leads?.length ?? 0} leads · drag quotes into stages
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4 mr-1" />New Lead
        </Button>
      </div>

      {/* Content */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
      >
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Left: Kanban ──────────────────────────────────────────────── */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            {loading ? (
              <div className="flex gap-3 p-3 h-full">
                {STAGES.map(s => (
                  <div key={s.id} className="min-w-[180px] w-[180px]">
                    <Skeleton className="h-8 w-full rounded-t-xl" />
                    <Skeleton className="h-24 w-full rounded-b-xl mt-px" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex gap-3 p-3 h-full" style={{ minWidth: 'max-content' }}>
                {STAGES.map(stage => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    leads={(leads ?? []).filter(l => l.stage === stage.id)}
                    displayNames={Object.fromEntries(
                      (leads ?? []).map(l => [l.id, getDisplayName(l)])
                    )}
                    sublines={Object.fromEntries(
                      (leads ?? []).map(l => [l.id, getSubline(l)])
                    )}
                    onCardClick={l => setSelectedLead(l)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Quotes panel ───────────────────────────────────────── */}
          <div className="w-[155px] shrink-0 border-l flex flex-col overflow-hidden bg-muted/20">
            <div className="px-2 py-2 border-b shrink-0 bg-card/80">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold">Quotes</span>
                {!quotesLoading && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-auto">
                    {sortedQuotes.length}
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">Drag into a stage</p>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {quotesLoading ? (
                <>
                  <Skeleton className="h-20 w-full rounded-lg" />
                  <Skeleton className="h-20 w-full rounded-lg" />
                  <Skeleton className="h-20 w-full rounded-lg" />
                </>
              ) : sortedQuotes.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-4">No quotes yet</p>
              ) : (
                sortedQuotes.map(q => {
                  const linkedStage = quoteLeadMap[q.id]
                  const stageLabel = linkedStage
                    ? STAGES.find(s => s.id === linkedStage)?.label ?? null
                    : null
                  return (
                    <DraggableQuoteCard
                      key={q.id}
                      quote={q}
                      linkedStageLabel={stageLabel}
                    />
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Drag overlays */}
        <DragOverlay>
          {activeLead && (
            <LeadCardGhost
              displayName={getDisplayName(activeLead)}
              subline={getSubline(activeLead)}
            />
          )}
          {activeQuote && <QuoteCardGhost quote={activeQuote} />}
        </DragOverlay>
      </DndContext>

      {/* Sheets */}
      <LeadDetailSheet
        lead={selectedLead}
        quote={selectedQuote}
        displayName={selectedLead ? getDisplayName(selectedLead) : ''}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
      />
      <NewLeadSheet
        open={showNew}
        onClose={() => setShowNew(false)}
      />
    </div>
  )
}
