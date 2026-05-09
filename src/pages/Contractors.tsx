/**
 * Contractors.tsx — Standalone Contractors page
 *
 * All contractor-specific components (ContractorCard, ContractorSheet,
 * ContractorDocsSection, ContractorScaSection, GenerateScaDialog) are
 * verbatim copies of the implementations in Contacts.tsx so the two
 * surfaces stay at parity. If you update one, update the other.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { quoCallUrl } from '@/lib/utils'
import { Contractor, ContractorDoc, SubcontractorAgreement } from '@/types'
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
import {
  Search, Plus, Phone, Mail, Building2, HardHat, DollarSign,
  Pencil, Trash2, Upload, FileText, X, ExternalLink,
  Download, Copy, Send, ClipboardList,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ── Contractor form type ───────────────────────────────────────────────────────

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

// ── Contractor Card ───────────────────────────────────────────────────────────

function ContractorCard({
  contractor, sca, scas, onEdit, onDelete,
}: {
  contractor: Contractor
  sca?: SubcontractorAgreement
  scas: SubcontractorAgreement[]
  onEdit: (c: Contractor) => void
  onDelete: (id: string) => void
}) {
  const threshold1099 = contractor.is1099 && contractor.ratePerJob !== null && contractor.ratePerJob >= 600

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-sm truncate">{contractor.name}</span>
            {contractor.is1099 && (
              <Badge variant="outline" className={`text-xs shrink-0 ${threshold1099 ? 'border-yellow-400 text-yellow-700 dark:text-yellow-400' : ''}`}>
                1099
              </Badge>
            )}
            {contractor.specialty && (
              <Badge variant="secondary" className="text-xs shrink-0">{contractor.specialty}</Badge>
            )}
            {sca?.status === 'signed' && (
              <Badge className="text-xs shrink-0 bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-700">
                ✓ SCA Signed
              </Badge>
            )}
            {sca?.status === 'pending_signature' && (
              <Badge className="text-xs shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                Awaiting Signature
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {contractor.company && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Building2 className="h-3 w-3 shrink-0" />{contractor.company}
              </span>
            )}
            {contractor.phone && (
              <a href={quoCallUrl(contractor.phone)} className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground">
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
            <p className="text-[11px] text-yellow-700 dark:text-yellow-400 mt-1">
              ⚠ Rate ≥ $600 — may require 1099-NEC. Track total annual payments.
            </p>
          )}
          {contractor.notes && (
            <p className="text-xs text-muted-foreground mt-1 italic truncate">{contractor.notes}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
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

// ── Contractor Sheet (add / edit) ─────────────────────────────────────────────

function ContractorSheet({
  open, onClose, contractor, scas = [],
}: {
  open: boolean; onClose: () => void; contractor?: Contractor | null; scas?: SubcontractorAgreement[]
}) {
  const [form, setForm] = useState<ContractorForm>(EMPTY_CONTRACTOR_FORM)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const isEdit = !!contractor

  useEffect(() => {
    setForm(
      contractor
        ? {
            name:      contractor.name,
            phone:     contractor.phone ?? '',
            email:     contractor.email ?? '',
            company:   contractor.company ?? '',
            specialty: contractor.specialty ?? '',
            ratePerJob: contractor.ratePerJob !== null ? String(contractor.ratePerJob) : '',
            notes:     contractor.notes ?? '',
            is1099:    contractor.is1099,
          }
        : EMPTY_CONTRACTOR_FORM
    )
  }, [open, contractor])

  const mutation = useMutation({
    mutationFn: (data: ContractorForm) => {
      const payload = {
        name:      data.name,
        phone:     data.phone     || null,
        email:     data.email     || null,
        company:   data.company   || null,
        specialty: data.specialty || null,
        ratePerJob: data.ratePerJob ? parseFloat(data.ratePerJob) : null,
        notes:     data.notes     || null,
        is1099:    data.is1099,
      }
      if (isEdit) return apiRequest('PATCH', `/contractors/${contractor!.id}`, payload)
      return apiRequest('POST', '/contractors', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contractors'] })
      toast({ title: isEdit ? 'Contractor updated' : 'Contractor added' })
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
          <div><Label className="text-xs">Name *</Label>
            <Input className="mt-1" value={form.name} onChange={e => set('name')(e.target.value)} /></div>
          <div><Label className="text-xs">Company</Label>
            <Input className="mt-1" value={form.company} onChange={e => set('company')(e.target.value)} /></div>
          <div><Label className="text-xs">Trade / Specialty</Label>
            <Input className="mt-1" value={form.specialty} onChange={e => set('specialty')(e.target.value)} /></div>
          <div><Label className="text-xs">Phone</Label>
            <Input className="mt-1" type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} /></div>
          <div><Label className="text-xs">Email</Label>
            <Input className="mt-1" type="email" value={form.email} onChange={e => set('email')(e.target.value)} /></div>
          <div><Label className="text-xs">Rate per Job ($)</Label>
            <Input className="mt-1" type="number" value={form.ratePerJob} onChange={e => set('ratePerJob')(e.target.value)} /></div>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">1099 Contractor</p>
              <p className="text-xs text-muted-foreground">Receives 1099-NEC if paid ≥$600/year</p>
            </div>
            <Switch checked={form.is1099} onCheckedChange={v => set('is1099')(v)} />
          </div>
          <div><Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" rows={3} value={form.notes} onChange={e => set('notes')(e.target.value)} /></div>

          <Button
            className="w-full min-h-[44px]"
            disabled={!form.name.trim() || mutation.isPending}
            onClick={() => mutation.mutate(form)}
          >
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Contractor'}
          </Button>

          {/* Documents — only visible when editing an existing contractor */}
          {isEdit && contractor && (
            <ContractorDocsSection contractor={contractor} />
          )}

          {/* Subcontractor Agreement — only visible when editing */}
          {isEdit && contractor && (
            <ContractorScaSection contractor={contractor} scas={scas} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Contractor Documents Section ──────────────────────────────────────────────

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

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Document Name</Label>
            <Input className="mt-1" placeholder="e.g. W-9 2025" value={docName} onChange={e => setDocName(e.target.value)} />
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
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" disabled={uploading} onChange={handleUpload} />
        </label>
      </div>
    </div>
  )
}

// ── SCA Section in Contractor Detail ─────────────────────────────────────────

function ContractorScaSection({ contractor, scas }: { contractor: Contractor; scas: SubcontractorAgreement[] }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [generating, setGenerating] = useState(false)

  const sca = scas.find(s => s.contractorId === contractor.id && s.status !== 'void') ?? null
  const SITE_URL = window.location.origin

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/.netlify/functions/subcontractor-agreements?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId: contractor.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Failed to generate SCA')
      queryClient.invalidateQueries({ queryKey: ['/subcontractor-agreements'] })
      const via = data.sentVia === 'email' ? 'email' : data.sentVia === 'sms' ? 'SMS' : '(no email or SMS — copy link manually)'
      toast({ title: `Agreement sent via ${via}` })
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  async function handleResend() {
    if (!sca) return
    setGenerating(true)
    try {
      await fetch(`/.netlify/functions/subcontractor-agreements?action=void&id=${sca.id}`, { method: 'POST' })
      const res = await fetch('/.netlify/functions/subcontractor-agreements?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId: contractor.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Failed to resend')
      queryClient.invalidateQueries({ queryKey: ['/subcontractor-agreements'] })
      toast({ title: 'Agreement resent' })
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  function handleCopyLink() {
    if (!sca) return
    const link = `${SITE_URL}/.netlify/functions/subcontractor-agreements?token=${sca.acceptToken}`
    navigator.clipboard.writeText(link).then(() => {
      toast({ title: 'Link copied to clipboard' })
    }).catch(() => {
      toast({ title: 'Copy failed — link: ' + link })
    })
  }

  function handleDownloadPdf() {
    if (!sca) return
    window.open(`/.netlify/functions/subcontractor-agreements?action=pdf&id=${sca.id}`, '_blank')
  }

  return (
    <div className="border-t pt-4 mt-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1">
        <ClipboardList className="h-3.5 w-3.5" /> Subcontractor Agreement
      </p>

      {!sca && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">No SCA on file.</p>
          <Button size="sm" className="w-full min-h-[40px]" disabled={generating} onClick={handleGenerate}>
            {generating ? 'Generating…' : 'Generate & Send Agreement'}
          </Button>
        </div>
      )}

      {sca && sca.status === 'pending_signature' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-full px-2 py-0.5">
              Awaiting Signature
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Sent {new Date(sca.createdAt).toLocaleDateString()}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 min-h-[36px]" onClick={handleCopyLink}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy Link
            </Button>
            <Button size="sm" variant="outline" className="flex-1 min-h-[36px]" disabled={generating} onClick={handleResend}>
              <Send className="h-3.5 w-3.5 mr-1" /> Resend
            </Button>
          </div>
        </div>
      )}

      {sca && sca.status === 'signed' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-full px-2 py-0.5">
              ✓ SCA Signed
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Signed {sca.signedAt ? new Date(sca.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
          </p>
          <Button size="sm" variant="outline" className="w-full min-h-[36px]" onClick={handleDownloadPdf}>
            <Download className="h-3.5 w-3.5 mr-1" /> Download Signed PDF
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Generate SCA Dialog ───────────────────────────────────────────────────────

function GenerateScaDialog({
  open, onClose, contractors, scas,
}: {
  open: boolean
  onClose: () => void
  contractors: Contractor[]
  scas: SubcontractorAgreement[]
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [selectedId, setSelectedId] = useState<string>('')
  const [sending, setSending] = useState(false)

  const existingContractorIds = new Set(
    scas.filter(s => s.status !== 'void').map(s => s.contractorId)
  )
  const eligible = contractors.filter(c => !existingContractorIds.has(c.id))

  useEffect(() => {
    if (open) setSelectedId(eligible[0]?.id ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleGenerate() {
    if (!selectedId) return
    setSending(true)
    try {
      const res = await fetch('/.netlify/functions/subcontractor-agreements?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId: selectedId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Failed')
      queryClient.invalidateQueries({ queryKey: ['/subcontractor-agreements'] })
      const name = contractors.find(c => c.id === selectedId)?.name ?? 'contractor'
      const via = data.sentVia === 'email' ? 'email' : data.sentVia === 'sms' ? 'SMS' : 'link (no email/SMS on file)'
      toast({ title: `Agreement sent to ${name} via ${via}` })
      onClose()
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Generate Subcontractor Agreement</DialogTitle>
        </DialogHeader>
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">All contractors already have an active or pending SCA.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Select Contractor</label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose contractor…" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.company ? ` — ${c.company}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              The agreement will be sent via email if the contractor has one, otherwise via SMS.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {eligible.length > 0 && (
            <Button disabled={!selectedId || sending} onClick={handleGenerate}>
              {sending ? 'Sending…' : 'Generate & Send'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Contractors Page ─────────────────────────────────────────────────────

export default function Contractors() {
  const [search, setSearch] = useState('')
  const [editContractor, setEditContractor] = useState<Contractor | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showGenerateSca, setShowGenerateSca] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: contractors = [], isLoading } = useQuery<Contractor[]>({
    queryKey: ['/contractors', search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      return apiGet(`/contractors?${params.toString()}`)
    },
  })

  const { data: scas = [] } = useQuery<SubcontractorAgreement[]>({
    queryKey: ['/subcontractor-agreements'],
    queryFn: () => apiGet('/subcontractor-agreements?action=list'),
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

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Contractors</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowGenerateSca(true)}>
              <ClipboardList className="h-4 w-4 mr-1" />SCA
            </Button>
            <Button size="sm" onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4 mr-1" />Add
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, specialty, company…"
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(n => <Skeleton key={n} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : contractors.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <HardHat className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              {search ? 'No contractors match your search.' : 'No contractors yet.'}
            </p>
            {!search && (
              <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add first contractor
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {contractors.map(c => {
              const sca = scas.find(s => s.contractorId === c.id && s.status !== 'void')
              return (
                <ContractorCard
                  key={c.id}
                  contractor={c}
                  sca={sca}
                  scas={scas}
                  onEdit={setEditContractor}
                  onDelete={setDeleteId}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Add contractor sheet */}
      <ContractorSheet open={showNew} onClose={() => setShowNew(false)} scas={scas} />

      {/* Edit contractor sheet */}
      <ContractorSheet
        open={!!editContractor}
        onClose={() => setEditContractor(null)}
        contractor={editContractor}
        scas={scas}
      />

      {/* Generate SCA dialog */}
      <GenerateScaDialog
        open={showGenerateSca}
        onClose={() => setShowGenerateSca(false)}
        contractors={contractors}
        scas={scas}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Remove contractor?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently delete the contractor record.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
