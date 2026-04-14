import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Lead, Contact, LeadStage } from '@/types'
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
import { Plus, Clock } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ── Stage config ────────────────────────────────────────────────────────────

const STAGES: { id: LeadStage; label: string; color: string }[] = [
  { id: 'new',        label: 'New',        color: 'bg-slate-100 dark:bg-slate-800' },
  { id: 'contacted',  label: 'Contacted',  color: 'bg-blue-50 dark:bg-blue-950/40' },
  { id: 'quoted',     label: 'Quoted',     color: 'bg-yellow-50 dark:bg-yellow-950/30' },
  { id: 'follow_up',  label: 'Follow-Up',  color: 'bg-orange-50 dark:bg-orange-950/30' },
  { id: 'won',        label: 'Won',        color: 'bg-green-50 dark:bg-green-950/30' },
  { id: 'lost',       label: 'Lost',       color: 'bg-red-50 dark:bg-red-950/30' },
]

function daysAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d === 0 ? 'today' : d === 1 ? '1d' : `${d}d`
}

function fmt(n: number | null) {
  if (!n) return null
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`
}

// ── Lead Card ───────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  contactName,
  onClick,
}: {
  lead: Lead
  contactName: string
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
      <p className="text-sm font-medium leading-snug">{contactName}</p>
      {lead.serviceInterest && (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{lead.serviceInterest}</p>
      )}
      <div className="flex items-center justify-between mt-1.5">
        {fmt(lead.estimatedValue) ? (
          <span className="text-xs font-semibold text-primary">{fmt(lead.estimatedValue)}</span>
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

// Ghost card used in DragOverlay
function LeadCardGhost({ lead, contactName }: { lead: Lead; contactName: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-lg rotate-1 opacity-90">
      <p className="text-sm font-medium">{contactName}</p>
      {lead.serviceInterest && <p className="text-xs text-muted-foreground mt-0.5">{lead.serviceInterest}</p>}
    </div>
  )
}

// ── Column ──────────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  leads,
  contactNames,
  onCardClick,
}: {
  stage: typeof STAGES[number]
  leads: Lead[]
  contactNames: Record<string, string>
  onCardClick: (lead: Lead) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  return (
    <div className={`flex flex-col rounded-xl border min-w-[200px] w-[200px] shrink-0 ${stage.color} ${isOver ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white/50 dark:bg-black/20 rounded-t-xl">
        <span className="text-xs font-semibold">{stage.label}</span>
        <Badge variant="secondary" className="text-xs h-5 px-1.5">{leads.length}</Badge>
      </div>
      <div ref={setNodeRef} className="flex flex-col gap-2 p-2 min-h-[120px]">
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              contactName={contactNames[l.contactId ?? ''] ?? 'Unknown'}
              onClick={() => onCardClick(l)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}

// ── Lead Detail Sheet ───────────────────────────────────────────────────────

function LeadDetailSheet({
  lead,
  contactName,
  open,
  onClose,
}: {
  lead: Lead | null
  contactName: string
  open: boolean
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [notes, setNotes] = useState(lead?.notes ?? '')
  const [lostReason, setLostReason] = useState(lead?.lostReason ?? '')

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
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{contactName}</SheetTitle>
        </SheetHeader>
        <div className="space-y-3">
          {lead.serviceInterest && (
            <div>
              <Label className="text-xs">Service Interest</Label>
              <p className="text-sm mt-1">{lead.serviceInterest}</p>
            </div>
          )}
          {lead.estimatedValue && (
            <div>
              <Label className="text-xs">Estimated Value</Label>
              <p className="text-sm font-semibold mt-1">{fmt(lead.estimatedValue)}</p>
            </div>
          )}
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
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder="Add notes about this lead…"
            />
          </div>
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
                View Contact
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── New Lead Sheet ──────────────────────────────────────────────────────────

function NewLeadSheet({ open, onClose, contacts }: { open: boolean; onClose: () => void; contacts: Contact[] }) {
  const [form, setForm] = useState({
    contactId: '',
    serviceInterest: '',
    estimatedValue: '',
    source: '',
    notes: '',
  })
  const queryClient = useQueryClient()
  const { toast } = useToast()

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

// ── Main Leads Page ─────────────────────────────────────────────────────────

export default function Leads() {
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [showNew, setShowNew] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: leads, isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ['/leads'],
    queryFn: () => apiGet('/leads'),
  })

  const { data: contacts, isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet('/contacts'),
  })

  const contactNames: Record<string, string> = {}
  for (const c of contacts ?? []) contactNames[c.id] = c.name

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragStart(e: DragStartEvent) {
    const lead = leads?.find(l => l.id === e.active.id)
    setActiveLead(lead ?? null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveLead(null)
    const { active, over } = e
    if (!over) return
    const lead = leads?.find(l => l.id === active.id)
    if (!lead) return

    // over could be a column id or a lead id inside a column
    const targetStage = STAGES.find(s => s.id === over.id)?.id
      ?? leads?.find(l => l.id === over.id)?.stage

    if (targetStage && targetStage !== lead.stage) {
      updateStageMutation.mutate({ id: lead.id, stage: targetStage })
    }
  }

  function handleDragOver(e: DragOverEvent) {
    // Allow dropping into empty columns
    const { over } = e
    if (!over) return
    const lead = leads?.find(l => l.id === e.active.id)
    if (!lead) return
    const targetStage = STAGES.find(s => s.id === over.id)?.id
    if (targetStage && targetStage !== lead.stage) {
      queryClient.setQueryData<Lead[]>(['/leads'], old =>
        old?.map(l => l.id === lead.id ? { ...l, stage: targetStage } : l) ?? []
      )
    }
  }

  const loading = leadsLoading || contactsLoading

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <div>
          <h2 className="text-base font-semibold">Lead Pipeline</h2>
          <p className="text-xs text-muted-foreground">{leads?.length ?? 0} leads</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4 mr-1" />New Lead
        </Button>
      </div>

      {loading ? (
        <div className="flex gap-3 p-3 overflow-x-auto">
          {STAGES.map(s => (
            <div key={s.id} className="min-w-[200px] w-[200px]">
              <Skeleton className="h-8 w-full rounded-t-xl" />
              <Skeleton className="h-24 w-full rounded-b-xl mt-px" />
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragOver={handleDragOver}>
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex gap-3 p-3 h-full" style={{ minWidth: 'max-content' }}>
              {STAGES.map(stage => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  leads={(leads ?? []).filter(l => l.stage === stage.id)}
                  contactNames={contactNames}
                  onCardClick={l => setSelectedLead(l)}
                />
              ))}
            </div>
          </div>
          <DragOverlay>
            {activeLead && (
              <LeadCardGhost
                lead={activeLead}
                contactName={contactNames[activeLead.contactId ?? ''] ?? 'Unknown'}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      <LeadDetailSheet
        lead={selectedLead}
        contactName={selectedLead ? (contactNames[selectedLead.contactId ?? ''] ?? 'Unknown') : ''}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
      />
      <NewLeadSheet
        open={showNew}
        onClose={() => setShowNew(false)}
        contacts={contacts ?? []}
      />
    </div>
  )
}
