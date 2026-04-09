import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ServiceDefinition, PricingModel, ServiceType } from '@/lib/pricing'
import { apiRequest, apiGet } from '@/lib/queryClient'
import { useServices } from '@/lib/services-context'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Check, X, Pencil, Trash2, RotateCcw, Plus, Loader2, EyeOff, FileDown } from 'lucide-react'

function fmt(n: number): string {
  return '$' + n.toFixed(2)
}

function pct(n: number): string {
  return (n * 100).toFixed(0) + '%'
}

const tagColors: Record<string, string> = {
  onetime: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  standalonesub: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  subaddin: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
}

function ServiceCard({
  service,
  onSaveOverride,
  onDelete,
  isCustom,
}: {
  service: ServiceDefinition
  onSaveOverride: (serviceId: string, field: string, value: number) => void
  onDelete: (serviceId: string, isCustom: boolean) => void
  isCustom: boolean
}) {
  const [editingTier, setEditingTier] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (tierIdx: number, currentPrice: number) => {
    setEditingTier(tierIdx)
    setEditValue(currentPrice.toFixed(2))
  }

  const cancelEdit = () => {
    setEditingTier(null)
    setEditValue('')
  }

  const saveEdit = (tierIdx: number) => {
    const val = parseFloat(editValue)
    if (!isNaN(val) && val >= 0) {
      onSaveOverride(service.id, `tier_${tierIdx}`, val)
    }
    setEditingTier(null)
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">{service.name}</h4>
            <p className="text-xs text-muted-foreground">
              {service.pricingModel} · {service.unitLabel}
              {service.subcategory && ` · ${service.subcategory}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex gap-1 flex-wrap justify-end">
              {service.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className={`text-[10px] px-1.5 py-0 ${tagColors[tag] ?? ''}`}
                >
                  {tag}
                </Badge>
              ))}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {service.serviceType}
              </Badge>
              {isCustom && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  custom
                </Badge>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive/70 hover:text-destructive shrink-0"
              onClick={() => onDelete(service.id, isCustom)}
              title={isCustom ? 'Delete custom service' : 'Hide service'}
            >
              {isCustom ? <Trash2 className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Sub Cost: {pct(service.subCostPct)}</span>
          <span>Margin: {pct(1 - service.subCostPct)}</span>
          {service.pricingModel === 'per_acre' && (
            <span className="text-primary font-medium">Rate: per mowable acre</span>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {service.pricingModel === 'per_acre' ? 'Per-Acre Rate' : 'Tiers / Pricing'}
          </p>
          {service.tiers.map((tier, idx) => {
            const isEditing = editingTier === idx
            return (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 py-1 border-b last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm">{tier.label}</span>
                  {service.pricingModel === 'per_acre' ? (
                    <span className="text-xs text-muted-foreground ml-2">per mowable acre</span>
                  ) : tier.min > 0 ? (
                    <span className="text-xs text-muted-foreground ml-2">
                      {tier.min}{tier.max ? `–${tier.max}` : '+'} {service.unitLabel}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  {isEditing ? (
                    <>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(idx)
                          if (e.key === 'Escape') cancelEdit()
                        }}
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => saveEdit(idx)}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-semibold">{fmt(tier.price)}</span>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(idx, tier.price)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {service.frequencies.length > 1 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Frequency Discounts</p>
            <div className="flex flex-wrap gap-1.5">
              {service.frequencies.map((freq) => (
                <Badge key={freq.frequency} variant="outline" className="text-[10px]">
                  {freq.label}{freq.discountPct > 0 && ` (${freq.discountPct}% off)`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {service.notes && (
          <p className="text-xs text-muted-foreground italic">{service.notes}</p>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Add Service Dialog ───────────────────────────────────────────────── */
const defaultNewService = {
  name: '',
  category: '',
  serviceType: 'both' as ServiceType,
  pricingModel: 'flat' as PricingModel,
  unitLabel: 'per service',
  price: '',
  subCostPct: '0.78',
}

function AddServiceDialog({
  onAdd,
  isPending,
}: {
  onAdd: (svc: Partial<ServiceDefinition>) => void
  isPending: boolean
}) {
  const [form, setForm] = useState(defaultNewService)
  const [open, setOpen] = useState(false)

  const handleSubmit = () => {
    if (!form.name || !form.category || !form.price) return
    const price = parseFloat(form.price)
    if (isNaN(price) || price <= 0) return
    onAdd({
      name: form.name,
      category: form.category,
      serviceType: form.serviceType,
      pricingModel: form.pricingModel,
      unitLabel: form.unitLabel,
      tags: ['onetime'],
      subCostPct: parseFloat(form.subCostPct) || 0.78,
      tiers: [{ label: 'Standard', min: 0, price }],
      frequencies: [{ frequency: 'onetime', label: 'One-Time', multiplierPerMonth: 0, discountPct: 0, annualMultiplier: 1 }],
    })
    setForm(defaultNewService)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 min-h-[44px]">
          <Plus className="h-4 w-4" /> Add Service
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Service</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label>Service Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Fence Staining"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Category</Label>
            <Input
              value={form.category}
              onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Painting"
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Service Type</Label>
              <Select value={form.serviceType} onValueChange={(v) => setForm(f => ({ ...f, serviceType: v as ServiceType }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pricing Model</Label>
              <Select value={form.pricingModel} onValueChange={(v) => setForm(f => ({ ...f, pricingModel: v as PricingModel }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="tiered">Tiered</SelectItem>
                  <SelectItem value="per_sqft">Per Sq Ft</SelectItem>
                  <SelectItem value="per_unit">Per Unit</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="per_lf">Per LF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Base Price ($)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={form.price}
                onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Sub Cost (0–1)</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={form.subCostPct}
                onChange={(e) => setForm(f => ({ ...f, subCostPct: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label>Unit Label</Label>
            <Input
              value={form.unitLabel}
              onChange={(e) => setForm(f => ({ ...f, unitLabel: e.target.value }))}
              placeholder="per service"
              className="mt-1"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleSubmit}
              disabled={isPending || !form.name || !form.category || !form.price}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Add Service
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ── Hidden Services Panel ────────────────────────────────────────────── */
function DeletedServicesPanel({
  deletedIds,
  onRestore,
}: {
  deletedIds: string[]
  onRestore: (id: string) => void
}) {
  if (deletedIds.length === 0) return null
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="deleted">
        <AccordionTrigger className="min-h-[44px] text-sm font-semibold text-muted-foreground">
          Hidden Services
          <Badge variant="secondary" className="ml-2 text-xs">{deletedIds.length}</Badge>
        </AccordionTrigger>
        <AccordionContent className="space-y-2 pt-2">
          {deletedIds.map((id) => (
            <div key={id} className="flex items-center justify-between p-2 border rounded-md">
              <span className="text-sm text-muted-foreground">{id}</span>
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => onRestore(id)}>
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </Button>
            </div>
          ))}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

/* ── Main Page ────────────────────────────────────────────────────────── */
export default function PriceBook() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { services, isLoading } = useServices()

  const { data: deletedIds = [] } = useQuery<string[]>({
    queryKey: ['/services?action=deleted'],
    queryFn: () => apiGet<string[]>('/services?action=deleted'),
  })

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/services?action=merged'] })
    queryClient.invalidateQueries({ queryKey: ['/services?action=deleted'] })
  }, [queryClient])

  const createOverride = useMutation({
    mutationFn: (data: { serviceId: string; field: string; value: number }) =>
      apiRequest('POST', '/services?action=override', data),
    onSuccess: () => {
      invalidateAll()
      toast({ title: 'Price updated', description: 'Override saved.' })
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const addCustom = useMutation({
    mutationFn: (data: Partial<ServiceDefinition>) =>
      apiRequest('POST', '/services?action=custom', data),
    onSuccess: () => {
      invalidateAll()
      toast({ title: 'Service added', description: 'New custom service created.' })
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const deleteService = useMutation({
    mutationFn: ({ id, isCustom }: { id: string; isCustom: boolean }) => {
      if (isCustom) {
        return apiRequest('DELETE', `/services?action=custom&id=${id}`)
      }
      return apiRequest('POST', `/services?action=delete&id=${id}`)
    },
    onSuccess: (_, { isCustom }) => {
      invalidateAll()
      toast({
        title: isCustom ? 'Service deleted' : 'Service hidden',
        description: isCustom ? 'Custom service removed.' : 'Service hidden. You can restore it below.',
      })
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const restoreService = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/services?action=restore&id=${id}`),
    onSuccess: () => {
      invalidateAll()
      toast({ title: 'Service restored', description: 'Service is visible again.' })
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const categories = Array.from(new Set(services.map(s => s.category)))

  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-4 pb-2 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Price Book</h1>
          <p className="text-sm text-muted-foreground">
            {services.length} services · Tap pencil to edit price, eye to hide
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2 min-h-[44px]"
            onClick={() => {
              window.location.href = '/.netlify/functions/services?action=export-csv'
            }}
          >
            <FileDown className="h-4 w-4" /> Export CSV
          </Button>
          <AddServiceDialog
            onAdd={(svc) => addCustom.mutate(svc)}
            isPending={addCustom.isPending}
          />
        </div>
      </div>

      <Accordion type="multiple">
        {categories.map((cat) => {
          const svcs = services.filter(s => s.category === cat)
          return (
            <AccordionItem key={cat} value={cat}>
              <AccordionTrigger className="min-h-[44px] text-sm font-semibold">
                {cat}{' '}
                <Badge variant="secondary" className="ml-2 text-xs">
                  {svcs.length}
                </Badge>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-2">
                {svcs.map((svc) => (
                  <ServiceCard
                    key={svc.id}
                    service={svc}
                    onSaveOverride={(serviceId, field, value) =>
                      createOverride.mutate({ serviceId, field, value })
                    }
                    onDelete={(id, isCustom) => deleteService.mutate({ id, isCustom })}
                    isCustom={svc.id.startsWith('custom_')}
                  />
                ))}
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>

      <DeletedServicesPanel
        deletedIds={deletedIds}
        onRestore={(id) => restoreService.mutate(id)}
      />
    </div>
  )
}
