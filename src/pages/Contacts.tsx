import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Contact, Contractor, ContractorDoc } from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Search, Plus, Phone, Mail, Building2, User, HardHat, DollarSign, Pencil, Trash2, Upload, FileText, X, ExternalLink } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type FilterType = 'all' | 'residential' | 'commercial' | 'contractors'

// ── Contact Card / Sheet ───────────────────────────────────────────────────

interface NewContactForm {
  name: string
  phone: string
  email: string
  type: 'residential' | 'commercial'
  businessName: string
  source: string
}

const EMPTY_CONTACT_FORM: NewContactForm = {
  name: '', phone: '', email: '', type: 'residential', businessName: '', source: '',
}

function ContactCard({ contact }: { contact: Contact }) {
  const [, navigate] = useLocation()
  return (
    <button
      onClick={() => navigate(`/contacts/${contact.id}`)}
      className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/50 transition-colors active:bg-muted"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm truncate">{contact.name}</span>
            <Badge variant={contact.type === 'commercial' ? 'default' : 'secondary'} className="text-xs shrink-0">
              {contact.type === 'commercial' ? 'Commercial' : 'Residential'}
            </Badge>
          </div>
          {contact.businessName && (
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" />{contact.businessName}
            </p>
          )}
          <div className="flex items-center gap-3 mt-1">
            {contact.phone && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />{contact.phone}
              </span>
            )}
            {contact.email && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                <Mail className="h-3 w-3 shrink-0" />{contact.email}
              </span>
            )}
          </div>
        </div>
        <User className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      </div>
    </button>
  )
}

function NewContactSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<NewContactForm>(EMPTY_CONTACT_FORM)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const createMutation = useMutation({
    mutationFn: (data: NewContactForm) =>
      apiRequest('POST', '/contacts', {
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        type: data.type,
        businessName: data.businessName || null,
        source: data.source || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contacts'] })
      toast({ title: 'Contact created' })
      setForm(EMPTY_CONTACT_FORM)
      onClose()
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const set = (k: keyof NewContactForm) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="mb-4"><SheetTitle>New Contact</SheetTitle></SheetHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input placeholder="Full name" value={form.name} onChange={e => set('name')(e.target.value)} className="mt-1" />
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
              <Input placeholder="Company name" value={form.businessName} onChange={e => set('businessName')(e.target.value)} className="mt-1" />
            </div>
          )}
          <div>
            <Label className="text-xs">Phone</Label>
            <Input type="tel" placeholder="(xxx) xxx-xxxx" value={form.phone} onChange={e => set('phone')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" placeholder="email@example.com" value={form.email} onChange={e => set('email')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Source</Label>
            <Select value={form.source} onValueChange={v => set('source')(v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="How did they find you?" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="website">Website</SelectItem>
                <SelectItem value="social">Social Media</SelectItem>
                <SelectItem value="cold_call">Cold Call</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full mt-2" disabled={!form.name.trim() || createMutation.isPending} onClick={() => createMutation.mutate(form)}>
            {createMutation.isPending ? 'Creating…' : 'Create Contact'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Contractor Components ──────────────────────────────────────────────────

interface ContractorForm {
  name: string
  phone: string
  email: string
  company: string
  specialty: string
  ratePerJob: string
  notes: string
  is1099: boolean
}

const EMPTY_CONTRACTOR_FORM: ContractorForm = {
  name: '', phone: '', email: '', company: '', specialty: '', ratePerJob: '', notes: '', is1099: true,
}

const SPECIALTIES = [
  'Lawn Care',
  'Pressure Washing',
  'Window Cleaning',
  'Pet Waste Cleanup',
  'Lawn Irrigation',
  'Hardscaping',
  'Tree Work',
  'Landscaping',
  'Pest Control',
  'Snow Removal',
  'General Labor',
  'Other',
]

function ContractorCard({ contractor, onEdit, onDelete }: { contractor: Contractor; onEdit: (c: Contractor) => void; onDelete: (id: string) => void }) {
  const threshold1099 = contractor.is1099 && contractor.ratePerJob !== null && contractor.ratePerJob >= 600
  return (
    <div className="w-full rounded-xl border bg-card p-3 text-left">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-medium text-sm truncate">{contractor.name}</span>
            {contractor.is1099 && (
              <Badge variant="outline" className={`text-xs shrink-0 ${threshold1099 ? 'border-yellow-400 text-yellow-700 dark:text-yellow-400' : ''}`}>
                1099
              </Badge>
            )}
            {contractor.specialty && (
              <Badge variant="secondary" className="text-xs shrink-0">{contractor.specialty}</Badge>
            )}
          </div>
          {contractor.company && (
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" />{contractor.company}
            </p>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {contractor.phone && (
              <a href={`tel:${contractor.phone}`} className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground">
                <Phone className="h-3 w-3" />{contractor.phone}
              </a>
            )}
            {contractor.email && (
              <a href={`mailto:${contractor.email}`} className="text-xs text-muted-foreground flex items-center gap-1 truncate hover:text-foreground">
                <Mail className="h-3 w-3 shrink-0" />{contractor.email}
              </a>
            )}
            {contractor.ratePerJob !== null && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" />${contractor.ratePerJob.toFixed(2)}/job
              </span>
            )}
          </div>
          {threshold1099 && (
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1 flex items-center gap-1">
              ⚠ Rate ≥ $600 — may require 1099-NEC. Track total annual payments.
            </p>
          )}
          {contractor.notes && (
            <p className="text-xs text-muted-foreground mt-1 italic truncate">{contractor.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onEdit(contractor)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(contractor.id)} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ContractorSheet({
  open, onClose, contractor,
}: {
  open: boolean; onClose: () => void; contractor?: Contractor | null
}) {
  const [form, setForm] = useState<ContractorForm>(EMPTY_CONTRACTOR_FORM)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const isEdit = !!contractor

  // Sync form fields whenever the sheet opens or the contractor changes
  useEffect(() => {
    if (open) {
      setForm(
        contractor
          ? {
              name: contractor.name,
              phone: contractor.phone ?? '',
              email: contractor.email ?? '',
              company: contractor.company ?? '',
              specialty: contractor.specialty ?? '',
              ratePerJob: contractor.ratePerJob !== null ? String(contractor.ratePerJob) : '',
              notes: contractor.notes ?? '',
              is1099: contractor.is1099,
            }
          : EMPTY_CONTRACTOR_FORM
      )
    }
  }, [open, contractor])

  const mutation = useMutation({
    mutationFn: (data: ContractorForm) => {
      const payload = {
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        company: data.company || null,
        specialty: data.specialty || null,
        ratePerJob: data.ratePerJob !== '' ? parseFloat(data.ratePerJob) : null,
        notes: data.notes || null,
        is1099: data.is1099,
      }
      if (isEdit) return apiRequest('PATCH', `/contractors/${contractor!.id}`, payload)
      return apiRequest('POST', '/contractors', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contractors'] })
      toast({ title: isEdit ? 'Contractor updated' : 'Contractor added' })
      setForm(EMPTY_CONTRACTOR_FORM)
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const set = <K extends keyof ContractorForm>(k: K) => (v: ContractorForm[K]) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="mb-4"><SheetTitle>{isEdit ? 'Edit Contractor' : 'Add Contractor'}</SheetTitle></SheetHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input placeholder="Full name" value={form.name} onChange={e => set('name')(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Phone</Label>
              <Input type="tel" placeholder="(xxx) xxx-xxxx" value={form.phone} onChange={e => set('phone')(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" placeholder="email@example.com" value={form.email} onChange={e => set('email')(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Company / Business</Label>
            <Input placeholder="Optional" value={form.company} onChange={e => set('company')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Specialty</Label>
            <Select value={form.specialty || '__NONE__'} onValueChange={v => set('specialty')(v === '__NONE__' ? '' : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select specialty…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__">None</SelectItem>
                {SPECIALTIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Rate Per Job ($)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.ratePerJob}
              onChange={e => set('ratePerJob')(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">1099 Contractor</p>
              <p className="text-xs text-muted-foreground">Receives 1099-NEC if paid ≥$600/year</p>
            </div>
            <Switch checked={form.is1099} onCheckedChange={v => set('is1099')(v)} />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea placeholder="Skills, availability, vehicle info…" value={form.notes} onChange={e => set('notes')(e.target.value)} rows={2} className="mt-1" />
          </div>
          <Button className="w-full mt-2" disabled={!form.name.trim() || mutation.isPending} onClick={() => mutation.mutate(form)}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Contractor'}
          </Button>

          {/* Documents — only visible when editing an existing contractor */}
          {isEdit && contractor && (
            <ContractorDocsSection contractor={contractor} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Contractor Documents Section ───────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  w9: 'W-9',
  agreement: 'Subcontractor Agreement',
  license: 'License / Insurance',
  other: 'Other',
}

function ContractorDocsSection({ contractor }: { contractor: Contractor }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)
  const [docName, setDocName] = useState('')
  const [docType, setDocType] = useState('other')

  // Keep local docs in sync with contractor (from cache)
  const { data: contractors } = useQuery<Contractor[]>({ queryKey: ['/contractors'] })
  const current = contractors?.find(c => c.id === contractor.id) ?? contractor
  const docs: ContractorDoc[] = current.documents ?? []

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const name = docName.trim() || file.name
    setUploading(true)
    try {
      const arrayBuf = await file.arrayBuffer()
      const res = await fetch(`/.netlify/functions/contractor-docs/${contractor.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Doc-Name': name,
          'X-Doc-Type': docType,
        },
        body: arrayBuf,
      })
      if (!res.ok) throw new Error(await res.text())
      queryClient.invalidateQueries({ queryKey: ['/contractors'] })
      setDocName('')
      toast({ title: 'Document uploaded' })
    } catch (err) {
      toast({ title: 'Upload failed', description: String(err), variant: 'destructive' })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleDelete(docId: string) {
    try {
      const res = await fetch(`/.netlify/functions/contractor-docs/${contractor.id}/${docId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error(await res.text())
      queryClient.invalidateQueries({ queryKey: ['/contractors'] })
      toast({ title: 'Document removed' })
    } catch (err) {
      toast({ title: 'Delete failed', description: String(err), variant: 'destructive' })
    }
  }

  return (
    <div className="border-t pt-4 mt-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Documents</p>

      {docs.length > 0 && (
        <div className="space-y-2 mb-3">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType} · {new Date(doc.uploadedAt).toLocaleDateString()}</p>
              </div>
              <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="p-1 text-muted-foreground hover:text-primary">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button onClick={() => handleDelete(doc.id)} className="p-1 text-muted-foreground hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {docs.length === 0 && (
        <p className="text-xs text-muted-foreground mb-3">No documents yet. Upload W-9s, agreements, licenses, and more.</p>
      )}

      {/* Upload controls */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Document Name</Label>
            <Input
              className="mt-1"
              placeholder="e.g. W-9 2025"
              value={docName}
              onChange={e => setDocName(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="w9">W-9</SelectItem>
                <SelectItem value="agreement">Subcontractor Agreement</SelectItem>
                <SelectItem value="license">License / Insurance</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className={`flex items-center justify-center gap-2 w-full rounded-lg border-2 border-dashed px-4 py-3 text-sm cursor-pointer transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/40'}`}>
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{uploading ? 'Uploading…' : 'Choose PDF or image to upload'}</span>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            disabled={uploading}
            onChange={handleUpload}
          />
        </label>
      </div>
    </div>
  )
}

function ContractorsList({ search }: { search: string }) {
  const [editContractor, setEditContractor] = useState<Contractor | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: contractors, isLoading } = useQuery<Contractor[]>({
    queryKey: ['/contractors', search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      return apiGet(`/contractors?${params.toString()}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/contractors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contractors'] })
      toast({ title: 'Contractor removed' })
      setDeleteId(null)
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
    </div>
  )

  if (!contractors?.length) return (
    <div className="flex flex-col items-center justify-center h-48 text-center">
      <HardHat className="h-8 w-8 text-muted-foreground mb-2" />
      <p className="text-muted-foreground text-sm">
        {search ? 'No contractors match your search.' : 'No contractors yet. Add your first one.'}
      </p>
    </div>
  )

  return (
    <div className="space-y-2">
      {contractors.map(c => (
        <ContractorCard
          key={c.id}
          contractor={c}
          onEdit={setEditContractor}
          onDelete={setDeleteId}
        />
      ))}

      <ContractorSheet
        open={!!editContractor}
        onClose={() => setEditContractor(null)}
        contractor={editContractor}
      />

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Remove contractor?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently delete the contractor record.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              {deleteMutation.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Main Contacts Page ─────────────────────────────────────────────────────

export default function Contacts() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [showNewContact, setShowNewContact] = useState(false)
  const [showNewContractor, setShowNewContractor] = useState(false)

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ['/contacts', search, filter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filter !== 'all' && filter !== 'contractors') params.set('type', filter)
      return apiGet(`/contacts?${params.toString()}`)
    },
    enabled: filter !== 'contractors',
  })

  const filterTabs: { value: FilterType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'residential', label: 'Residential' },
    { value: 'commercial', label: 'Commercial' },
    { value: 'contractors', label: 'Contractors' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={filter === 'contractors' ? 'Search contractors…' : 'Search contacts…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {filterTabs.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filter === 'contractors' ? (
          <ContractorsList search={search} />
        ) : isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))
        ) : !contacts?.length ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <p className="text-muted-foreground text-sm">
              {search ? 'No contacts match your search.' : 'No contacts yet. Add your first one!'}
            </p>
          </div>
        ) : (
          contacts.map(c => <ContactCard key={c.id} contact={c} />)
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => filter === 'contractors' ? setShowNewContractor(true) : setShowNewContact(true)}
        className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom) + 12px)' }}
      >
        <Plus className="h-6 w-6" />
      </button>

      <NewContactSheet open={showNewContact} onClose={() => setShowNewContact(false)} />
      <ContractorSheet open={showNewContractor} onClose={() => setShowNewContractor(false)} />
    </div>
  )
}
