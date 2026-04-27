import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { quoCallUrl, quoTextUrl } from '@/lib/utils'
import { useQuoteContext } from '@/lib/quote-context'
import { Lead, Quote, LeadStage, LineItem, Contact } from '@/types'
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
  MapPin, Phone, Mail, User, CalendarPlus,
  Trash2, Archive, PhoneCall, MessageSquare, FileSignature,
  Send, Receipt, CheckCircle2, XCircle, RotateCcw, TrendingDown,
  Users, DollarSign, ChevronRight,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { ScheduleQuoteSheet } from '@/components/ScheduleQuoteSheet'
import { QuoteDetail } from '@/pages/Quotes'

// ── Stage config ─────────────────────────────────────────────────────────────

const STAGES: { id: LeadStage; label: string; color: string; headerColor?: string }[] = [
  { id: 'new',            label: 'New Lead',        color: 'bg-slate-100 dark:bg-slate-800' },
  { id: 'contacted',      label: 'Contacted',       color: 'bg-blue-50 dark:bg-blue-950/40' },
  { id: 'follow_up',      label: 'Follow-Up',       color: 'bg-orange-50 dark:bg-orange-950/30',  headerColor: 'text-orange-700 dark:text-orange-400' },
  { id: 'quoted',         label: 'Quoted',          color: 'bg-yellow-50 dark:bg-yellow-950/30' },
  { id: 'scheduled',      label: 'Scheduled',       color: 'bg-violet-50 dark:bg-violet-950/30',  headerColor: 'text-violet-700 dark:text-violet-400' },
  { id: 'recurring',      label: 'Recurring ↻',     color: 'bg-indigo-50 dark:bg-indigo-950/30',  headerColor: 'text-indigo-700 dark:text-indigo-400' },
  { id: 'finished_unpaid', label: 'Finished / Unpaid', color: 'bg-amber-50 dark:bg-amber-950/30', headerColor: 'text-amber-700 dark:text-amber-400' },
  { id: 'finished_paid',  label: 'Finished / Paid', color: 'bg-emerald-50 dark:bg-emerald-950/30', headerColor: 'text-emerald-700 dark:text-emerald-400' },
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

function isRecurringQuote(quote: Quote | null): boolean {
  return !!quote && quote.lineItems.some(li => li.isSubscription)
}

// ── Lead Card (sortable within kanban) ───────────────────────────────────────

function LeadCard({
  lead,
  displayName,
  subline,
  phone,
  email,
  address,
  onClick,
  showAgreementBadge,
}: {
  lead: Lead
  displayName: string
  subline: string
  phone?: string | null
  email?: string | null
  address?: string | null
  onClick: () => void
  showAgreementBadge?: boolean
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
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm font-semibold leading-snug">{displayName}</p>
        {showAgreementBadge && (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" title="Agreement signed" />
        )}
      </div>
      {subline && (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{subline}</p>
      )}
      {address && (
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate flex items-center gap-0.5">
          <MapPin className="h-2.5 w-2.5 shrink-0" />{address}
        </p>
      )}
      {phone && (
        <p className="text-[10px] text-muted-foreground truncate flex items-center gap-0.5">
          <Phone className="h-2.5 w-2.5 shrink-0" />{phone}
        </p>
      )}
      {email && (
        <p className="text-[10px] text-muted-foreground truncate flex items-center gap-0.5">
          <Mail className="h-2.5 w-2.5 shrink-0" />{email}
        </p>
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

function LeadCardGhost({ displayName, subline, phone }: { displayName: string; subline: string; phone?: string | null }) {
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-lg rotate-1 opacity-90">
      <p className="text-sm font-semibold">{displayName}</p>
      {subline && <p className="text-xs text-muted-foreground mt-0.5">{subline}</p>}
      {phone && <p className="text-[10px] text-muted-foreground">{phone}</p>}
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
  phones,
  emails,
  addresses,
  agreementBadgeIds,
  onCardClick,
}: {
  stage: typeof STAGES[number]
  leads: Lead[]
  displayNames: Record<string, string>
  sublines: Record<string, string>
  phones: Record<string, string | null>
  emails: Record<string, string | null>
  addresses: Record<string, string | null>
  agreementBadgeIds: Set<string>
  onCardClick: (lead: Lead) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const [search, setSearch] = useState('')
  const isRecurring = stage.id === 'recurring'
  const activeSearch = isRecurring ? search : ''

  const filteredLeads = activeSearch
    ? leads.filter(l => {
        const name  = (displayNames[l.id] ?? '').toLowerCase()
        const sub   = (sublines[l.id] ?? '').toLowerCase()
        const term  = activeSearch.toLowerCase()
        return name.includes(term) || sub.includes(term)
      })
    : leads

  return (
    <div className={`flex flex-col rounded-xl border min-w-[180px] w-[180px] shrink-0 ${stage.color} ${isOver ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center justify-between px-2.5 py-2 border-b bg-white/50 dark:bg-black/20 rounded-t-xl">
        <span className={`text-xs font-semibold ${stage.headerColor ?? ''}`}>{stage.label}</span>
        <Badge variant="secondary" className="text-xs h-5 px-1.5">{leads.length}</Badge>
      </div>
      {isRecurring && (
        <div className="px-2 pt-2">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-7 text-xs"
          />
        </div>
      )}
      <div ref={setNodeRef} className="flex flex-col gap-2 p-2 min-h-[100px]">
        <SortableContext items={filteredLeads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {filteredLeads.map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              displayName={displayNames[l.id] ?? 'Unknown'}
              subline={sublines[l.id] ?? ''}
              phone={phones[l.id]}
              email={emails[l.id]}
              address={addresses[l.id]}
              showAgreementBadge={agreementBadgeIds.has(l.id)}
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
                      {li.quantity} {li.unitLabel ?? 'units'} × ${li.unitPrice.toFixed(2)}
                    </p>
                  )}
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0">${li.lineTotal.toFixed(2)}</span>
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
                  ${(li.monthlyAmount ?? li.lineTotal).toFixed(2)}/mo
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
              <span className="text-xs text-green-600 font-medium">−${quote.discount.toFixed(2)}</span>
            </div>
          )}
          {onetimeItems.length > 0 && subItems.length > 0 ? (
            <>
              <div className="flex justify-between">
                <span className="text-xs font-semibold">Due Today</span>
                <span className="text-sm font-bold tabular-nums">
                  ${onetimeItems.reduce((s, li) => s + li.lineTotal, 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs font-semibold">Monthly</span>
                <span className="text-sm font-bold tabular-nums text-primary">
                  ${subItems.reduce((s, li) => s + (li.monthlyAmount ?? li.lineTotal), 0).toFixed(2)}/mo
                </span>
              </div>
            </>
          ) : (
            <div className="flex justify-between">
              <span className="text-xs font-semibold">Total</span>
              <span className="text-sm font-bold tabular-nums text-primary">
                ${quote.total.toFixed(2)}{subItems.length > 0 ? '/mo' : ''}
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
        {quote.signedAt && (
          <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3" />
            Signed {new Date(quote.signedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
        {!quote.signedAt && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(quote.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
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
  allLeadQuotes,
  displayName,
  contactForPrefill,
  open,
  onClose,
}: {
  lead: Lead | null
  quote: Quote | null
  allLeadQuotes: Quote[]
  displayName: string
  contactForPrefill: Contact | null
  open: boolean
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const { setPrefillContact } = useQuoteContext()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [notes, setNotes] = useState(lead?.notes ?? '')
  const [lostReason, setLostReason] = useState(lead?.lostReason ?? '')
  const [serviceInterest, setServiceInterest] = useState(lead?.serviceInterest ?? '')
  const [estimatedValue, setEstimatedValue] = useState(lead?.estimatedValue?.toString() ?? '')
  const [contractorCost, setContractorCost] = useState(lead?.contractorCost?.toString() ?? '')
  const [showSchedule, setShowSchedule] = useState(false)
  // Inline quote editor — when true, renders QuoteDetail inside this sheet
  const [editingQuote, setEditingQuote] = useState(false)
  // Local quote state updated after inline saves (so the sheet reflects edits immediately)
  const [localQuote, setLocalQuote] = useState<Quote | null>(null)
  const effectiveQuote = localQuote ?? quote

  // Sync form state when a different lead is selected
  useEffect(() => {
    setNotes(lead?.notes ?? '')
    setLostReason(lead?.lostReason ?? '')
    setServiceInterest(lead?.serviceInterest ?? '')
    setEstimatedValue(lead?.estimatedValue?.toString() ?? '')
    setContractorCost(lead?.contractorCost?.toString() ?? '')
    setEditingQuote(false)
    setLocalQuote(null)
    setShowMarkLost(false)
    setLostReasonPreset('')
    setLostReasonCustom('')
  }, [lead?.id])
  const [confirmDeleteQuote, setConfirmDeleteQuote] = useState(false)
  const [confirmDeleteLead, setConfirmDeleteLead] = useState(false)
  const [confirmInvoice, setConfirmInvoice] = useState(false)
  const [showMarkLost, setShowMarkLost] = useState(false)
  const [lostReasonPreset, setLostReasonPreset] = useState('')
  const [lostReasonCustom, setLostReasonCustom] = useState('')
  // Which quote (by id) is expanded inline in the multi-quote list
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null)

  const isRecurring = isRecurringQuote(effectiveQuote)
  // For one-time: quote signed = can schedule
  // For recurring: BOTH quote signed AND service agreement signed = can schedule
  const canSchedule = !!effectiveQuote?.signedAt && (!isRecurring || !!lead?.agreementSignedAt)

  // Phone number: prefer quote, fall back to lead contact info (if any in serviceInterest)
  const phone = effectiveQuote?.customerPhone ?? null

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

  const deleteLeadMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', `/leads/${lead?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Lead deleted' })
      setConfirmDeleteLead(false)
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Failed to delete lead', description: err.message, variant: 'destructive' }),
  })

  const markLostMutation = useMutation({
    mutationFn: (reason: string) =>
      apiRequest('PATCH', `/leads/${lead?.id}`, { stage: 'lost', lostReason: reason || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Lead marked as lost', description: 'Removed from pipeline. View lost leads from the header.' })
      setShowMarkLost(false)
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const setPrimaryMutation = useMutation({
    mutationFn: (quoteId: string) =>
      apiRequest('PATCH', `/leads/${lead?.id}`, { quoteId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Primary quote updated' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const archiveQuoteMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/quotes/${effectiveQuote?.id}/trash`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotes'] })
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Quote archived', description: 'Moved to trash. Restore it from the Quotes page.' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Failed to archive', description: err.message, variant: 'destructive' }),
  })

  const deleteQuoteMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', `/quotes/${effectiveQuote?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotes'] })
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Quote deleted permanently' })
      setConfirmDeleteQuote(false)
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Failed to delete', description: err.message, variant: 'destructive' }),
  })

  // Send quote via SMS
  const sendQuoteMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/quotes/${effectiveQuote?.id}/send`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotes'] })
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Quote sent!', description: `SMS delivered to ${phone}` })
    },
    onError: (err: Error) => toast({ title: 'Failed to send quote', description: err.message, variant: 'destructive' }),
  })

  // Generate QB invoice
  const generateInvoiceMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/qb?action=invoice`, { quoteId: effectiveQuote?.id }),
    onSuccess: (data: { qbInvoiceId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/quotes'] })
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      setConfirmInvoice(false)
      toast({
        title: 'Invoice created in QuickBooks!',
        description: `Invoice #${data.qbInvoiceId} is ready for review in QB.`,
      })
    },
    onError: (err: Error) => {
      setConfirmInvoice(false)
      toast({ title: 'QB invoice failed', description: err.message, variant: 'destructive' })
    },
  })

  if (!lead) return null

  const inFinishedUnpaid = lead.stage === 'finished_unpaid'
  const hasInvoice = !!effectiveQuote?.qbInvoiceId

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[90dvh] overflow-y-auto">

        {/* ── Inline quote editor (replaces full sheet content when editing) ── */}
        {editingQuote && effectiveQuote ? (
          <QuoteDetail
            quote={effectiveQuote}
            onBack={() => setEditingQuote(false)}
            onUpdate={(updated) => {
              setLocalQuote(updated)
              queryClient.invalidateQueries({ queryKey: ['/quotes'] })
              queryClient.invalidateQueries({ queryKey: ['/leads'] })
              setEditingQuote(false)
            }}
          />
        ) : (
        <>
        <SheetHeader className="mb-3">
          <SheetTitle className="flex items-center gap-2">
            {displayName}
            {effectiveQuote && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[effectiveQuote.status] ?? 'bg-muted'}`}>
                {effectiveQuote.status}
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">

          {/* ── Call / Text buttons ────────────────────────────────────────── */}
          {phone && (
            <div className="flex gap-2">
              <a
                href={quoCallUrl(phone)}
                className="flex-1"
                onClick={e => e.stopPropagation()}
              >
                <Button variant="outline" className="w-full gap-2 text-blue-600 border-blue-200 hover:bg-blue-50">
                  <PhoneCall className="h-4 w-4" />
                  Call
                </Button>
              </a>
              <a
                href={quoTextUrl(phone)}
                className="flex-1"
                onClick={e => e.stopPropagation()}
              >
                <Button variant="outline" className="w-full gap-2 text-green-600 border-green-200 hover:bg-green-50">
                  <MessageSquare className="h-4 w-4" />
                  Text
                </Button>
              </a>
            </div>
          )}

          {/* ── Agreement signed badge ─────────────────────────────────────── */}
          {lead.agreementSignedAt && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-green-800">Service Agreement Signed</p>
                <p className="text-[10px] text-green-600">
                  {new Date(lead.agreementSignedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>
          )}

          {/* ── All quotes for this lead ───────────────────────────────── */}
          {allLeadQuotes.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide">
                  Quotes ({allLeadQuotes.length})
                </p>
                <button
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  onClick={() => {
                    const p = new URLSearchParams()
                    if (lead?.id)        p.set('leadId',    lead.id)
                    if (lead?.contactId) p.set('contactId', lead.contactId)
                    if (contactForPrefill?.name)         p.set('name',         contactForPrefill.name)
                    if (contactForPrefill?.phone)        p.set('phone',        contactForPrefill.phone)
                    if (contactForPrefill?.email)        p.set('email',        contactForPrefill.email)
                    if (contactForPrefill?.businessName) p.set('businessName', contactForPrefill.businessName)
                    const qs = p.toString()
                    navigate(qs ? `/calculator?${qs}` : '/calculator')
                    onClose()
                  }}
                >
                  <Plus className="h-3 w-3" />Add Quote
                </button>
              </div>

              <div className="space-y-2">
                {allLeadQuotes
                  .slice()
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map(q => {
                    const isPrimary = q.id === lead?.quoteId
                    const isExpanded = expandedQuoteId === q.id
                    const summary = servicesSummary(q.lineItems)
                    return (
                      <div key={q.id} className={`rounded-xl border overflow-hidden ${isPrimary ? 'border-primary/40' : ''}`}>
                        {/* Quote row header */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isPrimary && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                                  Primary
                                </span>
                              )}
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[q.status] ?? 'bg-muted text-muted-foreground'}`}>
                                {q.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-sm font-bold text-primary">${q.total.toFixed(0)}</span>
                              {summary && <span className="text-xs text-muted-foreground truncate">{summary}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs gap-1 text-primary"
                              onClick={() => { setLocalQuote(q); setEditingQuote(true) }}
                            >
                              <FileSignature className="h-3 w-3" />Edit
                            </Button>
                            <button
                              onClick={() => setExpandedQuoteId(isExpanded ? null : q.id)}
                              className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1"
                            >
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="border-t">
                            <QuoteDetailPanel quote={q} />
                            <div className="flex gap-2 px-3 pb-3">
                              {!isPrimary && (
                                <Button
                                  variant="outline" size="sm"
                                  className="flex-1 text-xs text-primary border-primary/30"
                                  disabled={setPrimaryMutation.isPending}
                                  onClick={() => setPrimaryMutation.mutate(q.id)}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  {setPrimaryMutation.isPending ? 'Setting…' : 'Set as Primary'}
                                </Button>
                              )}
                              {q.customerPhone && (
                                <Button
                                  variant="outline" size="sm"
                                  className="flex-1 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                                  disabled={sendQuoteMutation.isPending}
                                  onClick={() => {
                                    setLocalQuote(q)
                                    sendQuoteMutation.mutate()
                                  }}
                                >
                                  <Send className="h-3 w-3 mr-1" />
                                  {q.sentAt ? 'Resend' : 'Send SMS'}
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* ── Lead fields (always editable) ─────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Service Interest</Label>
              <Input
                value={serviceInterest}
                onChange={e => setServiceInterest(e.target.value)}
                placeholder="e.g. Lawn Care…"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Estimated Value ($)</Label>
              <Input
                type="number"
                value={estimatedValue}
                onChange={e => setEstimatedValue(e.target.value)}
                placeholder="0"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Subcontractor Cost ($)</Label>
              <Input
                type="number"
                value={contractorCost}
                onChange={e => setContractorCost(e.target.value)}
                placeholder="0"
                className="mt-1 h-9 text-sm"
              />
            </div>
            {/* Profit margin preview — only shown when both values are filled */}
            {estimatedValue && contractorCost && (
              <div className="flex flex-col justify-end pb-0.5">
                <Label className="text-xs text-muted-foreground">Est. Profit</Label>
                {(() => {
                  const rev = parseFloat(estimatedValue) || 0
                  const cost = parseFloat(contractorCost) || 0
                  const profit = rev - cost
                  const margin = rev > 0 ? (profit / rev) * 100 : 0
                  return (
                    <p className={`text-sm font-bold mt-1 ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                      {profit >= 0 ? '+' : ''}{fmtMoney(profit)}
                      <span className="text-xs font-normal text-muted-foreground ml-1">({margin.toFixed(0)}%)</span>
                    </p>
                  )
                })()}
              </div>
            )}
          </div>

          {/* ── Stage ─────────────────────────────────────────────────────── */}
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

          {/* ── Lead notes ────────────────────────────────────────────────── */}
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

          {/* ── Create Quote (only when zero quotes exist for this lead) ──── */}
          {allLeadQuotes.length === 0 && (
            <Button
              variant="outline"
              className="w-full gap-2 border-primary/40 text-primary hover:bg-primary/5"
              onClick={() => {
                const p = new URLSearchParams()
                if (lead?.id)        p.set('leadId',    lead.id)
                if (lead?.contactId) p.set('contactId', lead.contactId)
                if (contactForPrefill?.name)         p.set('name',         contactForPrefill.name)
                if (contactForPrefill?.phone)        p.set('phone',        contactForPrefill.phone)
                if (contactForPrefill?.email)        p.set('email',        contactForPrefill.email)
                if (contactForPrefill?.businessName) p.set('businessName', contactForPrefill.businessName)
                const qs = p.toString()
                navigate(qs ? `/calculator?${qs}` : '/calculator')
                onClose()
              }}
            >
              <FileSignature className="h-4 w-4" />
              Create Quote for This Lead
            </Button>
          )}

          {/* ── Schedule Job (gated on signatures) ───────────────────────── */}
          {canSchedule && (
            <Button className="w-full bg-primary" onClick={() => setShowSchedule(true)}>
              <CalendarPlus className="h-4 w-4 mr-2" />Schedule Job
            </Button>
          )}

          {/* ── Waiting for signatures info ───────────────────────────────── */}
          {effectiveQuote && !canSchedule && (
            <div className="rounded-lg bg-muted/50 border border-dashed p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Before Scheduling</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  {effectiveQuote.signedAt
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    : <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/40" />}
                  <span className={effectiveQuote.signedAt ? 'text-green-700 line-through' : 'text-muted-foreground'}>
                    Quote signed by customer
                  </span>
                </div>
                {isRecurring && (
                  <div className="flex items-center gap-2 text-xs">
                    {lead.agreementSignedAt
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      : <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/40" />}
                    <span className={lead.agreementSignedAt ? 'text-green-700 line-through' : 'text-muted-foreground'}>
                      Service agreement signed
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Generate QB Invoice (Finished/Unpaid only) ────────────────── */}
          {inFinishedUnpaid && effectiveQuote && (
            <div className="rounded-xl border border-dashed border-amber-400/60 bg-amber-50/40 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Billing</p>
              {hasInvoice ? (
                <div className="flex items-center gap-2 text-xs text-amber-700">
                  <Receipt className="h-4 w-4 shrink-0" />
                  <span>Invoice <strong>#{effectiveQuote.qbInvoiceId}</strong> created in QuickBooks — awaiting payment</span>
                </div>
              ) : !confirmInvoice ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-amber-700 border-amber-400 hover:bg-amber-100"
                  onClick={() => setConfirmInvoice(true)}
                >
                  <Receipt className="h-3.5 w-3.5 mr-1.5" />
                  Generate QB Invoice
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-amber-800 font-medium">
                    Before generating the invoice, confirm the scope of work matches the original quote.
                  </p>
                  <p className="text-xs text-amber-700">Were there any upcharges or work outside the scope of the quote?</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmInvoice(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                      disabled={generateInvoiceMutation.isPending}
                      onClick={() => generateInvoiceMutation.mutate()}
                    >
                      {generateInvoiceMutation.isPending ? 'Creating…' : 'No Changes — Generate'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Quote actions ─────────────────────────────────────────────── */}
          {effectiveQuote && (
            <div className="rounded-xl border border-dashed border-destructive/40 p-3 space-y-2">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Quote Actions</p>
              {!confirmDeleteQuote ? (
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm" className="flex-1 text-amber-600 border-amber-300 hover:bg-amber-50"
                    disabled={archiveQuoteMutation.isPending}
                    onClick={() => archiveQuoteMutation.mutate()}
                  >
                    <Archive className="h-3.5 w-3.5 mr-1.5" />
                    {archiveQuoteMutation.isPending ? 'Archiving…' : 'Archive Quote'}
                  </Button>
                  <Button
                    variant="outline" size="sm" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                    onClick={() => setConfirmDeleteQuote(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete Quote
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-destructive font-medium">Permanently delete this quote? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmDeleteQuote(false)}>Cancel</Button>
                    <Button
                      variant="destructive" size="sm" className="flex-1"
                      disabled={deleteQuoteMutation.isPending}
                      onClick={() => deleteQuoteMutation.mutate()}
                    >
                      {deleteQuoteMutation.isPending ? 'Deleting…' : 'Yes, Delete'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Mark as Lost ──────────────────────────────────────────────── */}
          {lead.stage !== 'lost' && (
            <div className="rounded-xl border border-dashed border-rose-300/60 bg-rose-50/30 dark:bg-rose-950/10 p-3 space-y-3">
              <p className="text-xs text-rose-700 dark:text-rose-400 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5" />Lost / Not Moving Forward
              </p>

              {!showMarkLost ? (
                <Button
                  variant="outline" size="sm"
                  className="w-full text-rose-700 border-rose-300 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-800 dark:hover:bg-rose-950/30"
                  onClick={() => { setShowMarkLost(true); setLostReasonPreset(''); setLostReasonCustom('') }}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />Mark as Lost
                </Button>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-xs text-rose-700 dark:text-rose-400">Why did you lose this lead?</p>

                  {/* Preset reasons */}
                  <div className="space-y-1.5">
                    {[
                      { value: 'chose_competitor', label: 'Chose a competitor' },
                      { value: 'price_too_high',   label: 'Price was too high' },
                      { value: 'no_response',      label: 'No response / went cold' },
                      { value: 'bad_timing',        label: 'Not ready / bad timing' },
                      { value: 'other',             label: 'Other reason…' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setLostReasonPreset(opt.value); setLostReasonCustom('') }}
                        className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          lostReasonPreset === opt.value
                            ? 'border-rose-400 bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 font-medium'
                            : 'border-border hover:bg-muted/50 text-muted-foreground'
                        }`}
                      >
                        <div className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                          lostReasonPreset === opt.value ? 'border-rose-500' : 'border-muted-foreground/40'
                        }`}>
                          {lostReasonPreset === opt.value && <div className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                        </div>
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom text for "Other" */}
                  {lostReasonPreset === 'other' && (
                    <Input
                      value={lostReasonCustom}
                      onChange={e => setLostReasonCustom(e.target.value)}
                      placeholder="Describe the reason…"
                      className="text-sm h-9"
                    />
                  )}

                  <div className="flex gap-2 pt-0.5">
                    <Button
                      variant="outline" size="sm" className="flex-1"
                      onClick={() => setShowMarkLost(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-rose-600 hover:bg-rose-700 text-white"
                      disabled={
                        !lostReasonPreset ||
                        (lostReasonPreset === 'other' && !lostReasonCustom.trim()) ||
                        markLostMutation.isPending
                      }
                      onClick={() => {
                        const reason = lostReasonPreset === 'other'
                          ? lostReasonCustom.trim()
                          : ({
                              chose_competitor: 'Chose a competitor',
                              price_too_high:   'Price was too high',
                              no_response:      'No response / went cold',
                              bad_timing:       'Not ready / bad timing',
                            } as Record<string, string>)[lostReasonPreset] ?? lostReasonPreset
                        markLostMutation.mutate(reason)
                      }}
                    >
                      {markLostMutation.isPending ? 'Saving…' : 'Confirm Lost'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Lead actions (delete) ─────────────────────────────────────── */}
          <div className="rounded-xl border border-dashed border-destructive/40 p-3 space-y-2">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Danger Zone</p>
            {!confirmDeleteLead ? (
              <Button
                variant="outline" size="sm" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5"
                onClick={() => setConfirmDeleteLead(true)}
                disabled={deleteLeadMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete This Lead Permanently
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-destructive font-medium">Permanently remove this lead? The linked quote (if any) stays intact.</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmDeleteLead(false)}>Cancel</Button>
                  <Button
                    variant="destructive" size="sm" className="flex-1"
                    disabled={deleteLeadMutation.isPending}
                    onClick={() => deleteLeadMutation.mutate()}
                  >
                    {deleteLeadMutation.isPending ? 'Deleting…' : 'Yes, Delete'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Footer actions ────────────────────────────────────────────── */}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({
                notes: notes || null,
                lostReason: lostReason || null,
                serviceInterest: serviceInterest.trim() || null,
                estimatedValue: estimatedValue ? parseFloat(estimatedValue) : null,
                contractorCost: contractorCost ? parseFloat(contractorCost) : null,
              })}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            {lead.contactId && (
              <Button
                variant="outline"
                onClick={() => { navigate(`/contacts/${lead.contactId}`); onClose() }}
              >
                Contact
              </Button>
            )}
          </div>
        </div>

        {/* Schedule sheet — nested so it shares the lead detail's quote context */}
        {effectiveQuote && (
          <ScheduleQuoteSheet
            quote={effectiveQuote}
            open={showSchedule}
            onClose={() => setShowSchedule(false)}
          />
        )}
        </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Lost Leads Sheet ──────────────────────────────────────────────────────────

const LOST_REASON_LABEL: Record<string, string> = {
  'Chose a competitor':      'Chose a competitor',
  'Price was too high':      'Price too high',
  'No response / went cold': 'Went cold',
  'Not ready / bad timing':  'Bad timing',
}

function LostLeadsSheet({
  open,
  onClose,
  lostLeads,
  displayNames,
  onRestore,
}: {
  open: boolean
  onClose: () => void
  lostLeads: Lead[]
  displayNames: Record<string, string>
  onRestore: (lead: Lead) => void
}) {
  const totalLostValue = lostLeads.reduce((s, l) => s + (l.estimatedValue ?? 0), 0)

  function fmtLostReason(r: string | null): string {
    if (!r) return 'No reason given'
    return LOST_REASON_LABEL[r] ?? r
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-rose-500" />
            Lost Leads
          </SheetTitle>
        </SheetHeader>

        {/* Summary strip */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <p className="text-2xl font-bold">{lostLeads.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total Lost</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <p className="text-2xl font-bold text-rose-600">
              {totalLostValue >= 1000 ? `$${(totalLostValue / 1000).toFixed(1)}k` : `$${totalLostValue.toFixed(0)}`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Est. Value Lost</p>
          </div>
        </div>

        {lostLeads.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <TrendingDown className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No lost leads yet</p>
            <p className="text-xs mt-1">Great work keeping the pipeline clean!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lostLeads
              .slice()
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map(lead => (
                <div key={lead.id} className="rounded-xl border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{displayNames[lead.id] ?? 'Unknown'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-medium">
                          {fmtLostReason(lead.lostReason)}
                        </span>
                        {lead.estimatedValue && (
                          <span className="text-xs text-muted-foreground font-medium">
                            ${lead.estimatedValue.toFixed(0)}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Lost {daysAgo(lead.createdAt)} ago
                      </p>
                    </div>
                    <Button
                      variant="outline" size="sm"
                      className="shrink-0 h-8 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/5"
                      onClick={() => onRestore(lead)}
                    >
                      <RotateCcw className="h-3 w-3" />Restore
                    </Button>
                  </div>
                </div>
              ))}
          </div>
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
  const [showLost, setShowLost] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  // Track the stage at drag-start to prevent stale closure issues in handleDragEnd
  const dragStartStageRef = useRef<LeadStage | null>(null)

  const { data: leads, isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ['/leads'],
    queryFn: () => apiGet('/leads'),
  })

  const { data: contacts, isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet('/contacts'),
  })

  const { data: quotes, isLoading: quotesLoading } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
  })

  // Contact lookups
  const contactNames: Record<string, string> = {}
  const contactById: Record<string, Contact> = {}
  for (const c of contacts ?? []) {
    contactNames[c.id] = c.name
    contactById[c.id] = c
  }

  // Quote lookup by ID
  const quoteById: Record<string, Quote> = {}
  for (const q of quotes ?? []) quoteById[q.id] = q

  // Map quoteId → lead stage (for indicator on right panel)
  // Covers both legacy quote_id links and new lead_id links
  const quoteLeadMap: Record<string, LeadStage> = {}
  for (const l of leads ?? []) {
    if (l.quoteId) quoteLeadMap[l.quoteId] = l.stage
  }
  for (const q of quotes ?? []) {
    if (q.leadId && !quoteLeadMap[q.id]) {
      const lead = (leads ?? []).find(l => l.id === q.leadId)
      if (lead) quoteLeadMap[q.id] = lead.stage
    }
  }

  // Per-lead: display name and subline
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

  function getContactInfo(lead: Lead): { phone: string | null; email: string | null; address: string | null } {
    if (lead.quoteId && quoteById[lead.quoteId]) {
      const q = quoteById[lead.quoteId]
      return {
        phone:   q.customerPhone   ?? null,
        email:   q.customerEmail   ?? null,
        address: q.customerAddress ?? null,
      }
    }
    if (lead.contactId && contactById[lead.contactId]) {
      const c = contactById[lead.contactId]
      return { phone: c.phone ?? null, email: c.email ?? null, address: null }
    }
    return { phone: null, email: null, address: null }
  }

  // Agreement badge: show on recurring leads that have agreementSignedAt set
  const agreementBadgeIds = new Set(
    (leads ?? []).filter(l => !!l.agreementSignedAt).map(l => l.id)
  )

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

  const restoreLeadMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiRequest('PATCH', `/leads/${id}`, { stage: 'new', lostReason: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      toast({ title: 'Lead restored', description: 'Moved back to New Lead column.' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
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
      dragStartStageRef.current = null
    } else {
      const lead = leads?.find(l => l.id === id) ?? null
      setActiveLead(lead)
      setActiveQuote(null)
      dragStartStageRef.current = lead?.stage ?? null
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

    const originalStage = dragStartStageRef.current
    dragStartStageRef.current = null

    const targetStage: LeadStage | undefined =
      (STAGES.find(s => s.id === overId)?.id as LeadStage | undefined) ??
      leads?.find(l => l.id === overId)?.stage

    if (targetStage && targetStage !== originalStage) {
      updateStageMutation.mutate({ id: activeId, stage: targetStage })
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

  const lostLeads   = (leads ?? []).filter(l => l.stage === 'lost')
  const activeLeads = (leads ?? []).filter(l => l.stage !== 'lost')

  // Quotes for right panel: exclude any already in the pipeline, sort by priority
  const sortedQuotes = [...(quotes ?? [])]
    .filter(q => !quoteLeadMap[q.id])
    .sort((a, b) => {
      const order: Record<string, number> = { sent: 0, accepted: 1, draft: 2, declined: 3 }
      const sa = order[a.status] ?? 2
      const sb = order[b.status] ?? 2
      if (sa !== sb) return sa - sb
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  // Selected lead's primary quote (if any)
  const selectedQuote = selectedLead?.quoteId ? (quoteById[selectedLead.quoteId] ?? null) : null

  // All quotes for the selected lead: by lead_id OR by the legacy quote_id link
  const selectedLeadQuotes = selectedLead
    ? (quotes ?? []).filter(q =>
        !q.trashedAt && (
          q.leadId === selectedLead.id ||
          q.id === selectedLead.quoteId
        )
      )
    : []

  // Build display name/subline/contact info maps once
  const displayNames = Object.fromEntries((leads ?? []).map(l => [l.id, getDisplayName(l)]))
  const sublines     = Object.fromEntries((leads ?? []).map(l => [l.id, getSubline(l)]))
  const contactInfos = Object.fromEntries((leads ?? []).map(l => [l.id, getContactInfo(l)]))
  const phones       = Object.fromEntries((leads ?? []).map(l => [l.id, contactInfos[l.id]?.phone ?? null]))
  const emails       = Object.fromEntries((leads ?? []).map(l => [l.id, contactInfos[l.id]?.email ?? null]))
  const addresses    = Object.fromEntries((leads ?? []).map(l => [l.id, contactInfos[l.id]?.address ?? null]))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0">
        <div>
          <h2 className="text-base font-bold">Lead Pipeline</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground">
              {activeLeads.length} active
            </p>
            {lostLeads.length > 0 && (
              <button
                onClick={() => setShowLost(true)}
                className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 hover:underline"
              >
                <XCircle className="h-3 w-3" />
                {lostLeads.length} lost
              </button>
            )}
          </div>
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
                    leads={activeLeads.filter(l => l.stage === stage.id)}
                    displayNames={displayNames}
                    sublines={sublines}
                    phones={phones}
                    emails={emails}
                    addresses={addresses}
                    agreementBadgeIds={agreementBadgeIds}
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
              phone={getContactInfo(activeLead).phone}
            />
          )}
          {activeQuote && <QuoteCardGhost quote={activeQuote} />}
        </DragOverlay>
      </DndContext>

      {/* Sheets */}
      <LeadDetailSheet
        lead={selectedLead}
        quote={selectedQuote}
        allLeadQuotes={selectedLeadQuotes}
        displayName={selectedLead ? getDisplayName(selectedLead) : ''}
        contactForPrefill={
          selectedLead?.contactId ? (contactById[selectedLead.contactId] ?? null) : null
        }
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
      />
      <NewLeadSheet
        open={showNew}
        onClose={() => setShowNew(false)}
      />
      <LostLeadsSheet
        open={showLost}
        onClose={() => setShowLost(false)}
        lostLeads={lostLeads}
        displayNames={displayNames}
        onRestore={lead => restoreLeadMutation.mutate({ id: lead.id })}
      />
    </div>
  )
}
