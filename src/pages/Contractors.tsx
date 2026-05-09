import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'
import type { Contractor } from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { quoCallUrl, quoTextUrl } from '@/lib/utils'
import {
  Search, Plus, Phone, Mail, Building2, DollarSign, ChevronRight,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Switch } from '@/components/ui/switch'

// ── Contractor Detail Sheet ───────────────────────────────────────────────────

function ContractorDetailSheet({
  contractor,
  open,
  onClose,
}: {
  contractor: Contractor | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    specialty: '',
    ratePerJob: '',
    notes: '',
    is1099: true,
  })

  // Sync form when contractor changes
  if (contractor && !editing) {
    const next = {
      name:      contractor.name,
      phone:     contractor.phone ?? '',
      email:     contractor.email ?? '',
      company:   contractor.company ?? '',
      specialty: contractor.specialty ?? '',
      ratePerJob: contractor.ratePerJob?.toString() ?? '',
      notes:     contractor.notes ?? '',
      is1099:    contractor.is1099,
    }
    if (JSON.stringify(next) !== JSON.stringify(form)) setForm(next)
  }

  const updateMutation = useMutation({
    mutationFn: () => apiRequest('PATCH', `/contractors/${contractor?.id}`, {
      name:      form.name,
      phone:     form.phone || null,
      email:     form.email || null,
      company:   form.company || null,
      specialty: form.specialty || null,
      ratePerJob: form.ratePerJob ? parseFloat(form.ratePerJob) : null,
      notes:     form.notes || null,
      is1099:    form.is1099,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contractors'] })
      toast({ title: 'Contractor saved' })
      setEditing(false)
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  })

  if (!contractor) return null

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) { setEditing(false); onClose() } }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            {contractor.name}
            {contractor.is1099 && (
              <Badge variant="secondary" className="text-[10px]">1099</Badge>
            )}
          </SheetTitle>
          {contractor.specialty && (
            <p className="text-xs text-muted-foreground">{contractor.specialty}</p>
          )}
        </SheetHeader>

        <div className="py-4 space-y-4">
          {/* Quick actions */}
          <div className="flex gap-2">
            {contractor.phone && (
              <a href={quoCallUrl(contractor.phone)} className="flex-1">
                <Button variant="outline" size="sm" className="w-full">
                  <Phone className="h-3.5 w-3.5 mr-1" />Call
                </Button>
              </a>
            )}
            {contractor.phone && (
              <a href={quoTextUrl(contractor.phone)} className="flex-1">
                <Button variant="outline" size="sm" className="w-full">
                  <Phone className="h-3.5 w-3.5 mr-1" />Text
                </Button>
              </a>
            )}
            {contractor.email && (
              <a href={`mailto:${contractor.email}`} className="flex-1">
                <Button variant="outline" size="sm" className="w-full">
                  <Mail className="h-3.5 w-3.5 mr-1" />Email
                </Button>
              </a>
            )}
          </div>

          {/* Info / Edit */}
          <div className="rounded-xl border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Details</h3>
              {!editing ? (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
              ) : (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>Save</Button>
                </div>
              )}
            </div>

            {editing ? (
              <div className="space-y-2">
                <div><Label className="text-xs">Name</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
                <div><Label className="text-xs">Company</Label>
                  <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
                <div><Label className="text-xs">Specialty / Trade</Label>
                  <Input value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
                <div><Label className="text-xs">Phone</Label>
                  <Input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
                <div><Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
                <div><Label className="text-xs">Rate per Job ($)</Label>
                  <Input type="number" value={form.ratePerJob} onChange={e => setForm(f => ({ ...f, ratePerJob: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.is1099} onCheckedChange={v => setForm(f => ({ ...f, is1099: v }))} />
                  <Label className="text-xs">1099 Contractor</Label>
                </div>
                <div><Label className="text-xs">Notes</Label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="mt-1 text-sm" /></div>
              </div>
            ) : (
              <div className="space-y-1.5 text-sm">
                {contractor.company && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />{contractor.company}
                  </div>
                )}
                {contractor.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />{contractor.phone}
                  </div>
                )}
                {contractor.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />{contractor.email}
                  </div>
                )}
                {contractor.ratePerJob != null && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <DollarSign className="h-3.5 w-3.5" />${contractor.ratePerJob.toFixed(2)} / job
                  </div>
                )}
                {contractor.notes && (
                  <p className="text-xs text-muted-foreground border-t pt-2 mt-2">{contractor.notes}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── New Contractor Sheet ──────────────────────────────────────────────────────

function NewContractorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [form, setForm] = useState({ name: '', phone: '', email: '', company: '', specialty: '', ratePerJob: '', notes: '', is1099: true })

  const createMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/contractors', {
      name:      form.name,
      phone:     form.phone || null,
      email:     form.email || null,
      company:   form.company || null,
      specialty: form.specialty || null,
      ratePerJob: form.ratePerJob ? parseFloat(form.ratePerJob) : null,
      notes:     form.notes || null,
      is1099:    form.is1099,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contractors'] })
      toast({ title: 'Contractor added' })
      setForm({ name: '', phone: '', email: '', company: '', specialty: '', ratePerJob: '', notes: '', is1099: true })
      onClose()
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  })

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="pb-3 border-b">
          <SheetTitle>New Contractor</SheetTitle>
        </SheetHeader>
        <div className="py-4 space-y-2">
          <div><Label className="text-xs">Name *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
          <div><Label className="text-xs">Company</Label>
            <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
          <div><Label className="text-xs">Specialty / Trade</Label>
            <Input value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
          <div><Label className="text-xs">Phone</Label>
            <Input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
          <div><Label className="text-xs">Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
          <div><Label className="text-xs">Rate per Job ($)</Label>
            <Input type="number" value={form.ratePerJob} onChange={e => setForm(f => ({ ...f, ratePerJob: e.target.value }))} className="mt-1 h-9 text-sm" /></div>
          <div className="flex items-center gap-2 pt-1">
            <Switch checked={form.is1099} onCheckedChange={v => setForm(f => ({ ...f, is1099: v }))} />
            <Label className="text-xs">1099 Contractor</Label>
          </div>
          <div><Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="mt-1 text-sm" /></div>
          <Button
            className="w-full mt-2 min-h-[44px]"
            disabled={!form.name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Adding…' : 'Add Contractor'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Contractors Page ──────────────────────────────────────────────────────────

export default function Contractors() {
  const [search, setSearch] = useState('')
  const [selectedContractor, setSelectedContractor] = useState<Contractor | null>(null)
  const [showNew, setShowNew] = useState(false)

  const { data: contractors = [], isLoading } = useQuery<Contractor[]>({
    queryKey: ['/contractors', search],
    queryFn: () => apiGet(`/contractors${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  })

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Contractors</h2>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-1" />Add
          </Button>
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
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map(n => <Skeleton key={n} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : contractors.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center p-4">
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
          <div className="p-4 space-y-2">
            {contractors.map(c => (
              <button
                key={c.id}
                className="w-full text-left rounded-xl border bg-card p-3 flex items-center gap-3 hover:bg-muted/40 active:scale-[0.99] transition-all"
                onClick={() => setSelectedContractor(c)}
              >
                {/* Avatar */}
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-bold text-muted-foreground">
                  {c.name.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold truncate">{c.name}</span>
                    {c.is1099 && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0">1099</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    {c.specialty && <span className="truncate">{c.specialty}</span>}
                    {c.specialty && c.phone && <span>·</span>}
                    {c.phone && <span>{c.phone}</span>}
                  </div>
                  {c.ratePerJob != null && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">${c.ratePerJob.toFixed(0)}/job</p>
                  )}
                </div>

                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      <ContractorDetailSheet
        contractor={selectedContractor}
        open={!!selectedContractor}
        onClose={() => setSelectedContractor(null)}
      />
      <NewContractorSheet open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}
