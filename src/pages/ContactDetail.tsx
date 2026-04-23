import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useParams } from 'wouter'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Contact, Property, Quote, Subscription, Activity, ServiceAgreement, rowToContact } from '@/types'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Plus, Pencil, Check, X, MapPin, Phone, Mail, Building2, MessageSquare, FileText, Send, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Info Tab ───────────────────────────────────────────────────────────────

function InfoTab({ contact }: { contact: Contact }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: contact.name,
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    type: contact.type,
    businessName: contact.businessName ?? '',
    source: contact.source ?? '',
    notes: contact.notes ?? '',
  })
  const [showNewProperty, setShowNewProperty] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: properties, isLoading: propsLoading } = useQuery<Property[]>({
    queryKey: ['/properties', contact.id],
    queryFn: () => apiGet(`/properties?contactId=${contact.id}`),
  })

  const updateMutation = useMutation({
    mutationFn: (updates: typeof form) =>
      apiRequest('PATCH', `/contacts/${contact.id}`, {
        name: updates.name,
        phone: updates.phone || null,
        email: updates.email || null,
        type: updates.type,
        businessName: updates.businessName || null,
        source: updates.source || null,
        notes: updates.notes || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contacts'] })
      queryClient.invalidateQueries({ queryKey: ['/contacts', contact.id] })
      // Backend already propagated name/email/phone to linked quotes, subs, jobs —
      // invalidate those caches so every view refreshes immediately.
      queryClient.invalidateQueries({ queryKey: ['/quotes'] })
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      queryClient.invalidateQueries({ queryKey: ['/jobs'] })
      toast({ title: 'Contact saved' })
      setEditing(false)
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="p-4 space-y-4">
      {/* Contact fields */}
      <div className="rounded-xl border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Contact Info</h3>
          {!editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" />Edit
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate(form)}>
                <Check className="h-3.5 w-3.5 mr-1" />Save
              </Button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={e => set('name')(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={form.type} onValueChange={v => set('type')(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.type === 'commercial' && (
              <div>
                <Label className="text-xs">Business Name</Label>
                <Input value={form.businessName} onChange={e => set('businessName')(e.target.value)} className="mt-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">Phone</Label>
              <Input type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email} onChange={e => set('email')(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <Select value={form.source} onValueChange={v => set('source')(v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="social">Social Media</SelectItem>
                  <SelectItem value="cold_call">Cold Call</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={e => set('notes')(e.target.value)} rows={3} className="mt-1" />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 text-sm">
            {contact.businessName && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                <span>{contact.businessName}</span>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                <a href={`tel:${contact.phone}`} className="hover:text-foreground">{contact.phone}</a>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                <a href={`mailto:${contact.email}`} className="hover:text-foreground">{contact.email}</a>
              </div>
            )}
            {contact.source && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-xs">Source:</span>
                <span className="capitalize">{contact.source.replace('_', ' ')}</span>
              </div>
            )}
            {contact.notes && (
              <p className="text-muted-foreground mt-2 text-xs border-t pt-2">{contact.notes}</p>
            )}
          </div>
        )}
      </div>

      {/* Properties */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Properties</h3>
          <Button variant="ghost" size="sm" onClick={() => setShowNewProperty(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add
          </Button>
        </div>
        {propsLoading ? (
          <Skeleton className="h-12 w-full rounded-xl" />
        ) : !properties?.length ? (
          <p className="text-sm text-muted-foreground">No properties yet.</p>
        ) : (
          <div className="space-y-2">
            {properties.map(p => (
              <div key={p.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    {p.label && <p className="text-xs font-medium text-muted-foreground">{p.label}</p>}
                    <p className="text-sm">{p.address}</p>
                    {(p.mowableAcres || p.sqft) && (
                      <p className="text-xs text-muted-foreground">
                        {p.mowableAcres ? `${p.mowableAcres} acres` : ''}
                        {p.mowableAcres && p.sqft ? ' · ' : ''}
                        {p.sqft ? `${p.sqft.toLocaleString()} sqft` : ''}
                      </p>
                    )}
                    {p.notes && <p className="text-xs text-muted-foreground mt-0.5">{p.notes}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <NewPropertySheet
        contactId={contact.id}
        open={showNewProperty}
        onClose={() => setShowNewProperty(false)}
      />
    </div>
  )
}

// ── New Property Sheet ─────────────────────────────────────────────────────

function NewPropertySheet({ contactId, open, onClose }: { contactId: string; open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ label: '', address: '', type: 'residential', mowableAcres: '', sqft: '', notes: '' })
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const createMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/properties', {
      contactId,
      label: form.label || null,
      address: form.address,
      type: form.type,
      mowableAcres: form.mowableAcres ? parseFloat(form.mowableAcres) : null,
      sqft: form.sqft ? parseFloat(form.sqft) : null,
      notes: form.notes || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/properties', contactId] })
      toast({ title: 'Property added' })
      setForm({ label: '', address: '', type: 'residential', mowableAcres: '', sqft: '', notes: '' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="mb-4"><SheetTitle>Add Property</SheetTitle></SheetHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Label (optional)</Label>
            <Input placeholder='e.g. "Main House", "Rental"' value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Address *</Label>
            <Input placeholder="123 Main St, City, TN" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Mowable Acres</Label>
              <Input type="number" step="0.1" placeholder="0.0" value={form.mowableAcres} onChange={e => setForm(f => ({ ...f, mowableAcres: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Sq Ft</Label>
              <Input type="number" placeholder="0" value={form.sqft} onChange={e => setForm(f => ({ ...f, sqft: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea placeholder="Gate code, dogs, parking notes…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1" />
          </div>
          <Button className="w-full" disabled={!form.address.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Adding…' : 'Add Property'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Quotes Tab ─────────────────────────────────────────────────────────────

function QuotesTab({ contactId }: { contactId: string }) {
  const { data: allQuotes, isLoading } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
  })
  const quotes = (allQuotes ?? []).filter(q => q.contactId === contactId)

  const STATUS_COLORS: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    accepted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    declined: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  }

  if (isLoading) return <div className="p-4"><Skeleton className="h-20 w-full rounded-xl" /></div>
  if (!quotes.length) return (
    <div className="flex flex-col items-center justify-center h-48 text-center p-4">
      <p className="text-muted-foreground text-sm">No quotes linked to this contact yet.</p>
    </div>
  )

  return (
    <div className="p-4 space-y-2">
      {quotes.map(q => (
        <div key={q.id} className="rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium capitalize">{q.quoteType.replace(/_/g, ' ')}</span>
            <span className="text-sm font-semibold">${q.total.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', STATUS_COLORS[q.status] ?? '')}>{q.status}</span>
            <span className="text-xs text-muted-foreground">{new Date(q.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Subscriptions Tab ──────────────────────────────────────────────────────

function SubsTab({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: allSubs, isLoading } = useQuery<Subscription[]>({
    queryKey: ['/subscriptions'],
    queryFn: () => apiGet('/subscriptions'),
  })
  const subs = (allSubs ?? []).filter(s => s.contactId === contactId)

  const generateAgreementMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      apiRequest('POST', '/agreements', { contactId, subscriptionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/agreements', contactId] })
      toast({ title: 'Agreement generated', description: 'Check the Agreements tab to review and send.' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  if (isLoading) return <div className="p-4"><Skeleton className="h-20 w-full rounded-xl" /></div>
  if (!subs.length) return (
    <div className="flex flex-col items-center justify-center h-48 text-center p-4">
      <p className="text-muted-foreground text-sm">No subscriptions linked to this contact.</p>
    </div>
  )

  return (
    <div className="p-4 space-y-2">
      {subs.map(s => (
        <div key={s.id} className="rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">{s.customerName}</span>
            <div className="flex items-center gap-1.5">
              {!s.agreementId && (
                <span className="flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-3 w-3" />No Agreement
                </span>
              )}
              <Badge variant={s.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-xs">{s.status}</Badge>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">${s.inSeasonMonthlyTotal}/mo in-season</p>
          {!s.agreementId && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8 text-xs w-full"
              disabled={generateAgreementMutation.isPending}
              onClick={() => generateAgreementMutation.mutate(s.id)}
            >
              <FileText className="h-3.5 w-3.5 mr-1" />
              {generateAgreementMutation.isPending ? 'Generating…' : 'Generate Agreement'}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Agreements Tab ─────────────────────────────────────────────────────────

const AGREEMENT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_signature: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  signed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  void: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

function AgreementsTab({ contactId }: { contactId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: agreements, isLoading } = useQuery<ServiceAgreement[]>({
    queryKey: ['/agreements', contactId],
    queryFn: () => apiGet(`/agreements?contactId=${contactId}`),
  })

  const sendMutation = useMutation({
    mutationFn: (agreementId: string) =>
      apiRequest('POST', `/agreements/${agreementId}/send`, {}),
    onSuccess: async (res, agreementId) => {
      const data = await (res as Response).json()
      const signUrl: string = data.signUrl ?? ''
      try {
        await navigator.clipboard.writeText(signUrl)
        toast({ title: 'E-sign link copied!', description: 'Paste and send to your customer.' })
      } catch {
        toast({ title: 'E-sign link ready', description: signUrl })
      }
      queryClient.invalidateQueries({ queryKey: ['/agreements', contactId] })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    )
  }

  if (!agreements?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center p-4">
        <FileText className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-muted-foreground text-sm">No agreements yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Generate one from the Subs tab.</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {agreements.map(ag => (
        <div key={ag.id} className="rounded-xl border bg-card p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ag.customerName}</p>
              {ag.customerAddress && (
                <p className="text-xs text-muted-foreground truncate">{ag.customerAddress}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                Created {new Date(ag.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', AGREEMENT_STATUS_COLORS[ag.status] ?? '')}>
                {ag.status.replace('_', ' ')}
              </span>
              {ag.signedAt && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Signed {new Date(ag.signedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {ag.pdfUrl && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs"
                onClick={() => window.open(ag.pdfUrl!, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />View PDF
              </Button>
            )}
            {ag.status !== 'signed' && ag.status !== 'void' && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs"
                disabled={sendMutation.isPending}
                onClick={() => sendMutation.mutate(ag.id)}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                {sendMutation.isPending ? 'Copying…' : 'Send E-Sign Link'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Activity Tab ───────────────────────────────────────────────────────────

const ACTIVITY_ICONS: Record<string, string> = {
  note: '📝', call: '📞', sms_in: '💬', sms_out: '💬',
  email_sent: '📧', quote_sent: '📄', quote_accepted: '✅',
  quote_declined: '❌', job_scheduled: '📅', job_completed: '🔧',
  invoice_sent: '🧾', payment_received: '💰',
}

function LogActivitySheet({ contactId, open, onClose }: { contactId: string; open: boolean; onClose: () => void }) {
  const [type, setType] = useState('note')
  const [summary, setSummary] = useState('')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const logMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/activities', { contactId, type, summary }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/activities', contactId] })
      toast({ title: 'Activity logged' })
      setSummary('')
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
        <SheetHeader className="mb-4"><SheetTitle>Log Activity</SheetTitle></SheetHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="sms_out">SMS Sent</SelectItem>
                <SelectItem value="email_sent">Email Sent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Summary</Label>
            <Textarea placeholder="What happened?" value={summary} onChange={e => setSummary(e.target.value)} rows={3} className="mt-1" />
          </div>
          <Button className="w-full" disabled={!summary.trim() || logMutation.isPending} onClick={() => logMutation.mutate()}>
            {logMutation.isPending ? 'Logging…' : 'Log Activity'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ActivityTab({ contactId }: { contactId: string }) {
  const [showLog, setShowLog] = useState(false)

  const { data: activities, isLoading } = useQuery<Activity[]>({
    queryKey: ['/activities', contactId],
    queryFn: () => apiGet(`/activities?contactId=${contactId}`),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-end p-3 border-b">
        <Button variant="outline" size="sm" onClick={() => setShowLog(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Log Activity
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)
        ) : !activities?.length ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <p className="text-muted-foreground text-sm">No activity yet.</p>
          </div>
        ) : (
          activities.map(a => (
            <div key={a.id} className="flex items-start gap-3">
              <span className="text-base mt-0.5">{ACTIVITY_ICONS[a.type] ?? '•'}</span>
              <div className="flex-1">
                <p className="text-sm">{a.summary}</p>
                <p className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <LogActivitySheet contactId={contactId} open={showLog} onClose={() => setShowLog(false)} />
    </div>
  )
}

// ── Main ContactDetail ─────────────────────────────────────────────────────

export default function ContactDetail() {
  const params = useParams<{ id: string }>()
  const [, navigate] = useLocation()
  const id = params.id

  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ['/contacts', id],
    queryFn: async () => {
      const raw = await apiGet(`/contacts/${id}`)
      return rowToContact(raw)
    },
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <p className="text-muted-foreground">Contact not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/contacts')}>
          Back to Contacts
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/contacts')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{contact.name}</h2>
          {contact.businessName && (
            <p className="text-xs text-muted-foreground truncate">{contact.businessName}</p>
          )}
        </div>
        <Badge variant={contact.type === 'commercial' ? 'default' : 'secondary'} className="shrink-0 text-xs">
          {contact.type === 'commercial' ? 'Commercial' : 'Residential'}
        </Badge>
      </div>

      {/* Quick action buttons */}
      <div className="flex gap-2 px-3 py-2 border-b">
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <Phone className="h-3.5 w-3.5 mr-1" />Call
            </Button>
          </a>
        )}
        {contact.phone && (
          <a href={`sms:${contact.phone}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <MessageSquare className="h-3.5 w-3.5 mr-1" />Text
            </Button>
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <Mail className="h-3.5 w-3.5 mr-1" />Email
            </Button>
          </a>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info" className="flex flex-col flex-1 overflow-hidden">
        <div className="shrink-0 border-b overflow-x-auto">
          <TabsList className="w-max min-w-full rounded-none bg-transparent justify-start px-3 gap-0 h-10">
            {(['info', 'quotes', 'subs', 'agreements', 'jobs', 'invoices', 'activity'] as const).map(tab => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="capitalize rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-3 h-10 whitespace-nowrap"
              >
                {tab === 'subs' ? 'Subs' : tab === 'info' ? 'Info' : tab === 'agreements' ? 'Agreements' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="info" className="mt-0 h-full">
            <InfoTab contact={contact} />
          </TabsContent>
          <TabsContent value="quotes" className="mt-0 h-full">
            <QuotesTab contactId={contact.id} />
          </TabsContent>
          <TabsContent value="subs" className="mt-0 h-full">
            <SubsTab contactId={contact.id} />
          </TabsContent>
          <TabsContent value="agreements" className="mt-0 h-full">
            <AgreementsTab contactId={contact.id} />
          </TabsContent>
          <TabsContent value="jobs" className="mt-0 h-full">
            <div className="flex flex-col items-center justify-center h-48 text-center p-4">
              <p className="text-muted-foreground text-sm">Jobs coming in Phase 3.</p>
            </div>
          </TabsContent>
          <TabsContent value="invoices" className="mt-0 h-full">
            <div className="flex flex-col items-center justify-center h-48 text-center p-4">
              <p className="text-muted-foreground text-sm">Invoices coming in Phase 4.</p>
            </div>
          </TabsContent>
          <TabsContent value="activity" className="mt-0 h-full">
            <ActivityTab contactId={contact.id} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
