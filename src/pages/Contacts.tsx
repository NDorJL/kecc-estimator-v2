import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Contact } from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, Plus, Phone, Mail, Building2, User } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type FilterType = 'all' | 'residential' | 'commercial'

interface NewContactForm {
  name: string
  phone: string
  email: string
  type: 'residential' | 'commercial'
  businessName: string
  source: string
}

const EMPTY_FORM: NewContactForm = {
  name: '',
  phone: '',
  email: '',
  type: 'residential',
  businessName: '',
  source: '',
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

function NewContactSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [form, setForm] = useState<NewContactForm>(EMPTY_FORM)
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
      setForm(EMPTY_FORM)
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
        <SheetHeader className="mb-4">
          <SheetTitle>New Contact</SheetTitle>
        </SheetHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input
              placeholder="Full name"
              value={form.name}
              onChange={e => set('name')(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={form.type} onValueChange={v => set('type')(v)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.type === 'commercial' && (
            <div>
              <Label className="text-xs">Business Name</Label>
              <Input
                placeholder="Company name"
                value={form.businessName}
                onChange={e => set('businessName')(e.target.value)}
                className="mt-1"
              />
            </div>
          )}
          <div>
            <Label className="text-xs">Phone</Label>
            <Input
              type="tel"
              placeholder="(xxx) xxx-xxxx"
              value={form.phone}
              onChange={e => set('phone')(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              placeholder="email@example.com"
              value={form.email}
              onChange={e => set('email')(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Source</Label>
            <Select value={form.source} onValueChange={v => set('source')(v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="How did they find you?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="website">Website</SelectItem>
                <SelectItem value="social">Social Media</SelectItem>
                <SelectItem value="cold_call">Cold Call</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full mt-2"
            disabled={!form.name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(form)}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Contact'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default function Contacts() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [showNew, setShowNew] = useState(false)

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ['/contacts', search, filter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filter !== 'all') params.set('type', filter)
      return apiGet(`/contacts?${params.toString()}`)
    },
  })

  const filterTabs: FilterType[] = ['all', 'residential', 'commercial']

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {filterTabs.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {f === 'all' ? 'All' : f === 'residential' ? 'Residential' : 'Commercial'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? (
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
        onClick={() => setShowNew(true)}
        className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom) + 12px)' }}
      >
        <Plus className="h-6 w-6" />
      </button>

      <NewContactSheet open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}
