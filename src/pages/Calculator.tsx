import { useState, useMemo, useCallback, useRef } from 'react'
import {
  calculateSubscriptionPrice,
  calculatePerSqftPrice,
  rtcepLite,
  ctcepLite,
  mulchDefaults,
  MULCH_DIFFICULTY,
  MULCH_DEPTHS,
  calcMulchPrice,
  type ServiceDefinition,
  type FrequencyDiscount,
} from '@/lib/pricing'
import type { LineItem, CompanySettings, Contact } from '@/types'
// Contact is used as the type parameter for directCreateMutation
import { useServices } from '@/lib/services-context'
import { useQuoteContext } from '@/lib/quote-context'
import { useLocation } from 'wouter'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiGet, apiRequest, queryClient } from '@/lib/queryClient'
import { useToast } from '@/hooks/use-toast'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
import {
  ShoppingCart, Trash2, Send, ChevronRight, Plus,
  Droplets, Leaf, Sparkles, Home, Building2, Layers,
} from 'lucide-react'
// Leaf, Sparkles used in categoryIcons fallback; Droplets in categoryIcons map

function fmt(n: number): string {
  return '$' + n.toFixed(2)
}

// Determine if a service uses quantity-based unit pricing (acres, sqft, lf)
function isUnitPriced(model: string) {
  return model === 'per_sqft' || model === 'per_lf' || model === 'per_acre'
}

function unitLabel(model: string) {
  if (model === 'per_sqft') return 'Sqft'
  if (model === 'per_lf') return 'LF'
  if (model === 'per_acre') return 'Acres'
  return 'Qty'
}

function unitPlaceholder(model: string) {
  if (model === 'per_sqft') return 'e.g. 2000'
  if (model === 'per_acre') return 'e.g. 0.5'
  return '1'
}

function calcUnitTotal(model: string, tierPrice: number, min: number, qty: number) {
  if (model === 'per_sqft' || model === 'per_lf') {
    return calculatePerSqftPrice({ label: '', min, price: tierPrice }, qty)
  }
  if (model === 'per_acre') {
    // no minimum floor for per_acre
    return tierPrice * qty
  }
  return tierPrice * qty
}

function describeUnit(_model: string, label: string, _qty: number) {
  // Strip internal pricing details from tier labels (e.g. "Flatwork ($0.22/sqft, $85 min)" → "Flatwork")
  // These are for internal reference only and should never appear on customer-facing quotes.
  return label.replace(/\s*\(\$[^)]*\)/g, '').trim() || label
}

// Category → icon mapping for visual flair
const categoryIcons: Record<string, React.ElementType> = {
  'Lawn Care': Leaf,
  'Pressure Washing': Droplets,
  'Window Cleaning': Sparkles,
}

/* ── Controlled qty input that allows free typing ─────────────────────── */
function QtyInput({
  value,
  onChange,
  placeholder,
}: {
  value: number
  onChange: (v: number) => void
  placeholder?: string
}) {
  const [text, setText] = useState(String(value))
  const prevRef = useRef(value)
  if (value !== prevRef.current) {
    prevRef.current = value
    setText(String(value))
  }
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        if (raw === '' || raw === '.') return
        const num = parseFloat(raw)
        if (!isNaN(num) && num >= 0) onChange(num)
      }}
      onBlur={() => {
        if (text === '' || text === '.') {
          setText('0')
          onChange(0)
        }
      }}
      placeholder={placeholder}
      className="min-h-[44px] text-sm"
    />
  )
}

/* ── One-time service card ────────────────────────────────────────────── */
function OnetimeServiceCard({
  service,
  onAdd,
}: {
  service: ServiceDefinition
  onAdd: (item: LineItem) => void
}) {
  const [tierIndex, setTierIndex] = useState(0)
  const [quantity, setQuantity] = useState(isUnitPriced(service.pricingModel) ? 0 : 1)
  const [freqKey, setFreqKey] = useState(service.frequencies[0]?.frequency ?? 'onetime')

  const freq = service.frequencies.find(f => f.frequency === freqKey) ?? service.frequencies[0]
  const tier = service.tiers[tierIndex]
  const isUnit = isUnitPriced(service.pricingModel)

  const pricing = useMemo(() => {
    if (!tier || !freq) return null
    const rawTotal = isUnit
      ? calcUnitTotal(service.pricingModel, tier.price, tier.min, quantity)
      : tier.price * quantity
    const isSub = freq.frequency !== 'onetime'
    const minVal = (service.minimum && service.minimum > 0) ? service.minimum : 0

    if (isSub) {
      // For subscriptions: apply minimum to monthly total, not per-cut price
      const sub = calculateSubscriptionPrice(rawTotal, freq)
      const effectiveMonthly = minVal > 0 ? Math.max(sub.monthlyAmount, minVal) : sub.monthlyAmount
      const hitMinimum = effectiveMonthly > sub.monthlyAmount
      return { onetimeTotal: rawTotal, sub, effectiveMonthly, isSub, hitMinimum }
    } else {
      // For one-time jobs: apply minimum to the flat charge
      const onetimeTotal = minVal > 0 ? Math.max(rawTotal, minVal) : rawTotal
      const sub = calculateSubscriptionPrice(onetimeTotal, freq)
      return { onetimeTotal, sub, effectiveMonthly: onetimeTotal, isSub, hitMinimum: onetimeTotal > rawTotal }
    }
  }, [tier, freq, quantity, service.pricingModel, isUnit, service.minimum])

  const handleAdd = () => {
    if (!pricing || !tier || !freq) return
    const item: LineItem = {
      serviceId: service.id,
      serviceName: service.name,
      category: service.category,
      description: describeUnit(service.pricingModel, tier.label, quantity),
      quantity,
      unitLabel: service.unitLabel,
      frequency: freq.label,
      unitPrice: isUnit ? pricing.onetimeTotal : tier.price,
      lineTotal: pricing.isSub ? pricing.effectiveMonthly : pricing.onetimeTotal,
      isSubscription: pricing.isSub,
      monthlyAmount: pricing.isSub ? pricing.effectiveMonthly : undefined,
    }
    onAdd(item)
    setQuantity(isUnit ? 0 : 1)
    setTierIndex(0)
  }

  // For per_acre: show the rate and live price prominently
  const isAcre = service.pricingModel === 'per_acre'

  return (
    <Card className="border-l-2 border-l-primary/30">
      <CardContent className="pt-3 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{service.name}</p>
            {isAcre ? (
              <p className="text-xs text-muted-foreground">
                {fmt(tier?.price ?? 0)}/acre · {service.unitLabel}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{service.unitLabel}</p>
            )}
          </div>
          {pricing && (pricing.isSub ? pricing.effectiveMonthly > 0 : pricing.onetimeTotal > 0) && (
            <div className="text-right shrink-0">
              {pricing.isSub ? (
                <p className="text-sm font-bold text-primary">{fmt(pricing.effectiveMonthly)}/mo</p>
              ) : (
                <p className="text-sm font-bold text-primary">{fmt(pricing.onetimeTotal)}</p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* Tier selector — hide if only 1 tier (e.g. per_acre) */}
          {service.tiers.length > 1 && (
            <div className="space-y-1 col-span-1">
              <Label className="text-xs">Size</Label>
              <Select value={String(tierIndex)} onValueChange={(v) => setTierIndex(parseInt(v, 10))}>
                <SelectTrigger className="min-h-[44px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {service.tiers.map((t, i) => (
                    <SelectItem key={i} value={String(i)}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Quantity / Acres / Sqft */}
          <div className={`space-y-1 ${service.tiers.length > 1 ? 'col-span-1' : 'col-span-2'}`}>
            <Label className="text-xs">{unitLabel(service.pricingModel)}</Label>
            <QtyInput
              value={quantity}
              onChange={setQuantity}
              placeholder={unitPlaceholder(service.pricingModel)}
            />
          </div>

          {/* Frequency */}
          {service.frequencies.length > 1 && (
            <div className="space-y-1 col-span-1">
              <Label className="text-xs">Freq</Label>
              <Select value={freqKey} onValueChange={setFreqKey}>
                <SelectTrigger className="min-h-[44px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {service.frequencies.map((f) => (
                    <SelectItem key={f.frequency} value={f.frequency}>
                      {f.label}{f.discountPct > 0 ? ` (${f.discountPct}% off)` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Per-acre live breakdown */}
        {isAcre && quantity > 0 && pricing && (
          <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{quantity} acre{quantity !== 1 ? 's' : ''} × {fmt(tier?.price ?? 0)}/acre</span>
              <span className="font-semibold">{fmt(pricing.onetimeTotal)} per cut</span>
            </div>
            {pricing.isSub && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Monthly ({freq?.label})</span>
                <span className="font-semibold text-primary">
                  {fmt(pricing.effectiveMonthly)}/mo
                  {pricing.hitMinimum && <span className="text-muted-foreground ml-1">(min)</span>}
                </span>
              </div>
            )}
          </div>
        )}
        {/* Minimum callout */}
        {pricing?.hitMinimum && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {pricing.isSub
              ? `Monthly minimum of ${fmt(service.minimum ?? 0)} applied`
              : `Minimum charge of ${fmt(service.minimum ?? 0)} applied`}
          </p>
        )}

        <Button
          size="sm"
          className="w-full min-h-[44px]"
          onClick={handleAdd}
          disabled={!pricing || pricing.onetimeTotal === 0}
        >
          <ShoppingCart className="h-4 w-4 mr-2" />
          Add to Cart
        </Button>
      </CardContent>
    </Card>
  )
}

/* ── Mulch Service Card ──────────────────────────────────────────────── */
function MulchServiceCard({ onAdd }: { onAdd: (item: LineItem) => void }) {
  const [sqft, setSqft] = useState(0)
  const [depth, setDepth] = useState<number>(2)
  const [typeId, setTypeId] = useState(mulchDefaults.types[0].id)
  const [diffId, setDiffId] = useState<string>('average')
  const [addOnState, setAddOnState] = useState<Record<string, { enabled: boolean; qty: number }>>(() =>
    Object.fromEntries(mulchDefaults.addOns.map(a => [a.id, { enabled: false, qty: a.unit === 'flat' ? 1 : 0 }]))
  )

  const mulchType = mulchDefaults.types.find(t => t.id === typeId) ?? mulchDefaults.types[0]
  const difficulty = MULCH_DIFFICULTY.find(d => d.id === diffId) ?? MULCH_DIFFICULTY[1]

  const addOnsInput = mulchDefaults.addOns.map(a => ({
    id: a.id,
    enabled: addOnState[a.id]?.enabled ?? false,
    qty: addOnState[a.id]?.qty ?? 1,
    price: a.price,
  }))

  const result = useMemo(() => {
    if (sqft <= 0) return null
    return calcMulchPrice({
      sqft,
      depthInches: depth,
      sellPerYard: mulchType.sellPerYard,
      laborPerYard: mulchDefaults.laborPerYard,
      difficultyMultiplier: difficulty.multiplier,
      deliveryFee: mulchDefaults.deliveryFee,
      minimumJob: mulchDefaults.minimumJob,
      addOns: addOnsInput,
    })
  }, [sqft, depth, mulchType, difficulty, addOnsInput])

  const toggleAddOn = (id: string) =>
    setAddOnState(s => ({ ...s, [id]: { ...s[id], enabled: !s[id].enabled } }))
  const setAddOnQty = (id: string, qty: number) =>
    setAddOnState(s => ({ ...s, [id]: { ...s[id], qty } }))

  const handleAdd = () => {
    if (!result) return
    const enabledAddOns = mulchDefaults.addOns
      .filter(a => addOnState[a.id]?.enabled)
      .map(a => {
        const qty = addOnState[a.id]?.qty ?? 1
        if (a.unit === 'flat') return a.label
        if (a.unit === 'per_lf') return `${a.label} (${qty} LF)`
        return `${a.label} (×${qty})`
      })
    const desc = [
      `${result.roundedYards} yds · ${mulchType.name} · ${depth}" deep`,
      `Difficulty: ${difficulty.label}`,
      ...enabledAddOns,
    ].join(' · ')

    onAdd({
      serviceId: 'mulch_install',
      serviceName: 'Mulch Installation',
      category: 'Landscaping',
      description: desc,
      quantity: result.roundedYards,
      unitLabel: 'yds',
      frequency: 'One-Time',
      unitPrice: result.finalPrice / result.roundedYards,
      lineTotal: result.finalPrice,
      isSubscription: false,
    })
    setSqft(0)
    setDepth(2)
    setDiffId('average')
    setAddOnState(Object.fromEntries(mulchDefaults.addOns.map(a => [a.id, { enabled: false, qty: a.unit === 'flat' ? 1 : 0 }])))
  }

  return (
    <Card className="border-l-2 border-l-primary/30">
      <CardContent className="pt-3 pb-3 space-y-3">
        <div>
          <p className="text-sm font-semibold">Mulch Installation</p>
          <p className="text-xs text-muted-foreground">per cubic yard installed</p>
        </div>

        {/* Row 1: sqft + depth */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Bed Sq Ft</Label>
            <QtyInput value={sqft} onChange={setSqft} placeholder="e.g. 800" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Depth (in)</Label>
            <Select value={String(depth)} onValueChange={v => setDepth(parseFloat(v))}>
              <SelectTrigger className="min-h-[44px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MULCH_DEPTHS.map(d => <SelectItem key={d} value={String(d)}>{d}"</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 2: mulch type + difficulty */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Mulch Type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger className="min-h-[44px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {mulchDefaults.types.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Difficulty</Label>
            <Select value={diffId} onValueChange={setDiffId}>
              <SelectTrigger className="min-h-[44px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MULCH_DIFFICULTY.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.label} (×{d.multiplier})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Add-ons */}
        <div className="space-y-1.5">
          <Label className="text-xs">Add-Ons</Label>
          {mulchDefaults.addOns.map(a => {
            const state = addOnState[a.id]
            return (
              <div key={a.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleAddOn(a.id)}
                  className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${state.enabled ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}
                >
                  {state.enabled && <span className="text-primary-foreground text-[10px] font-bold">✓</span>}
                </button>
                <span className="text-xs flex-1">{a.label}
                  {a.unit !== 'flat' && <span className="text-muted-foreground ml-1">
                    ({a.unit === 'per_lf' ? `$${a.price}/LF` : `$${a.price}/shrub`})
                  </span>}
                  {a.unit === 'flat' && <span className="text-muted-foreground ml-1">(${a.price})</span>}
                </span>
                {state.enabled && a.unit !== 'flat' && (
                  <Input
                    type="number"
                    min={1}
                    value={state.qty || ''}
                    onChange={e => setAddOnQty(a.id, Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 h-8 text-xs"
                    placeholder={a.unit === 'per_lf' ? 'LF' : 'qty'}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Live breakdown */}
        {result && sqft > 0 && (
          <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>{result.rawYards.toFixed(2)} raw yds → <strong className="text-foreground">{result.roundedYards} yds</strong> (rounded up)</span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Material ({result.roundedYards} yds × ${mulchType.sellPerYard}/yd)</span><span>${result.materialTotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Labor ({difficulty.label})</span><span>${result.laborTotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span>${result.delivery.toFixed(2)}</span></div>
            {result.addOnsTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Add-ons</span><span>${result.addOnsTotal.toFixed(2)}</span></div>}
            <div className="border-t border-primary/20 pt-1 flex justify-between font-semibold">
              <span className="text-primary">Total</span>
              <span className="text-primary">${result.finalPrice.toFixed(2)}</span>
            </div>
            {result.hitMinimum && (
              <p className="text-amber-600 dark:text-amber-400 text-[10px]">Minimum job charge of ${mulchDefaults.minimumJob} applied</p>
            )}
          </div>
        )}

        <Button
          size="sm"
          className="w-full min-h-[44px]"
          onClick={handleAdd}
          disabled={!result || sqft <= 0}
        >
          <ShoppingCart className="h-4 w-4 mr-2" />
          Add to Cart
        </Button>
      </CardContent>
    </Card>
  )
}

/* ── TCEP/Autopilot service line ─────────────────────────────────────── */
interface SubLine {
  service: ServiceDefinition
  tierIndex: number
  quantity: number
  frequency: FrequencyDiscount
}

function SubServiceLine({
  line,
  lineIndex,
  availableServices,
  onUpdate,
  onRemove,
}: {
  line: SubLine
  lineIndex: number
  availableServices: ServiceDefinition[]
  onUpdate: (idx: number, updates: Partial<SubLine>) => void
  onRemove: (idx: number) => void
}) {
  const changeService = (serviceId: string) => {
    const svc = availableServices.find(s => s.id === serviceId)
    if (!svc) return
    onUpdate(lineIndex, {
      service: svc,
      tierIndex: 0,
      quantity: isUnitPriced(svc.pricingModel) ? 0 : 1,
      frequency: svc.frequencies.find(f => f.frequency !== 'onetime') ?? svc.frequencies[0],
    })
  }

  const isUnit = isUnitPriced(line.service.pricingModel)
  const tier = line.service.tiers[line.tierIndex]
  const rawTotal = isUnit && tier
    ? calcUnitTotal(line.service.pricingModel, tier.price, tier.min, line.quantity)
    : (tier?.price ?? 0) * line.quantity
  const sub = calculateSubscriptionPrice(rawTotal, line.frequency)
  const minVal = (line.service.minimum && line.service.minimum > 0) ? line.service.minimum : 0
  // Apply minimum to monthly total, not per-cut price
  const effectiveMonthly = minVal > 0 ? Math.max(sub.monthlyAmount, minVal) : sub.monthlyAmount
  const hitMinimum = effectiveMonthly > sub.monthlyAmount
  const isAcre = line.service.pricingModel === 'per_acre'

  return (
    <Card className="border-l-2 border-l-primary/30">
      <CardContent className="pt-3 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Service</Label>
            <Select value={line.service.id} onValueChange={changeService}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableServices.map(svc => (
                  <SelectItem key={svc.id} value={svc.id}>{svc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="mt-6 text-destructive shrink-0"
            onClick={() => onRemove(lineIndex)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* Tier selector — hide for single-tier services */}
          {line.service.tiers.length > 1 ? (
            <div className="space-y-1">
              <Label className="text-xs">Tier</Label>
              <Select
                value={String(line.tierIndex)}
                onValueChange={(v) => onUpdate(lineIndex, { tierIndex: parseInt(v, 10) })}
              >
                <SelectTrigger className="min-h-[44px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {line.service.tiers.map((t, i) => (
                    <SelectItem key={i} value={String(i)}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : <div />}

          <div className="space-y-1">
            <Label className="text-xs">{unitLabel(line.service.pricingModel)}</Label>
            <QtyInput
              value={line.quantity}
              onChange={(v) => onUpdate(lineIndex, { quantity: v })}
              placeholder={unitPlaceholder(line.service.pricingModel)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Freq</Label>
            <Select
              value={line.frequency.frequency}
              onValueChange={(val) => {
                const f = line.service.frequencies.find(fr => fr.frequency === val)
                if (f) onUpdate(lineIndex, { frequency: f })
              }}
            >
              <SelectTrigger className="min-h-[44px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {line.service.frequencies.map(f => (
                  <SelectItem key={f.frequency} value={f.frequency}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {isAcre
                ? `${line.quantity} acre${line.quantity !== 1 ? 's' : ''} × ${fmt(tier?.price ?? 0)}/acre = ${fmt(rawTotal)}/cut`
                : isUnit
                  ? `${fmt(tier?.price ?? 0)}/unit × ${line.quantity.toLocaleString()}`
                  : `${fmt(tier?.price ?? 0)} × ${line.quantity}`}
              {line.frequency.frequency !== 'onetime' && ` · ${line.frequency.label}`}
            </span>
            <span className="font-medium text-foreground">
              {line.frequency.frequency !== 'onetime'
                ? `${fmt(effectiveMonthly)}/mo`
                : fmt(rawTotal)}
            </span>
          </div>
          {hitMinimum && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Monthly minimum of {fmt(line.service.minimum ?? 0)} applied (calculated {fmt(sub.monthlyAmount)})
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Subscription Plan Builder (TCEP / Autopilot) ────────────────────── */
function SubPlanBuilder({
  customerType,
  planType,
  onAddToCart,
}: {
  customerType: 'residential' | 'commercial'
  planType: 'tcep' | 'autopilot'
  onAddToCart: (items: LineItem[]) => void
}) {
  const { getServicesByType } = useServices()
  const litePlan = customerType === 'residential' ? rtcepLite : ctcepLite
  const isAutopilot = planType === 'autopilot'

  const subServices = useMemo(() => {
    const byType = getServicesByType(customerType)
    return byType.filter(s => s.tags.includes('subaddin') || s.tags.includes('standalonesub'))
  }, [customerType, getServicesByType])

  const [lines, setLines] = useState<SubLine[]>([])

  const addLine = () => {
    if (isAutopilot && lines.length >= 1) return
    if (subServices.length === 0) return
    const svc = subServices[0]
    setLines(prev => [
      ...prev,
      {
        service: svc,
        tierIndex: 0,
        quantity: isUnitPriced(svc.pricingModel) ? 0 : 1,
        frequency: svc.frequencies.find(f => f.frequency !== 'onetime') ?? svc.frequencies[0],
      },
    ])
  }

  const updateLine = useCallback((idx: number, updates: Partial<SubLine>) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...updates } : l)))
  }, [])

  const removeLine = useCallback((idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const totals = useMemo(() => {
    let monthlyTotal = 0
    let annualTotal = 0
    const lineDetails = lines.map(line => {
      const tier = line.service.tiers[line.tierIndex]
      const isUnit = isUnitPriced(line.service.pricingModel)
      const rawTotal = isUnit && tier
        ? calcUnitTotal(line.service.pricingModel, tier.price, tier.min, line.quantity)
        : (tier?.price ?? 0) * line.quantity
      const sub = calculateSubscriptionPrice(rawTotal, line.frequency)
      const minVal = (line.service.minimum && line.service.minimum > 0) ? line.service.minimum : 0

      // Apply minimum to monthly total (not per-cut)
      const rawMonthly = line.frequency.frequency !== 'onetime' ? sub.monthlyAmount : 0
      const effectiveMonthly = minVal > 0 ? Math.max(rawMonthly, minVal) : rawMonthly

      // Scale annual proportionally when minimum kicks in (preserves seasonal multiplier ratio)
      const rawAnnual = line.frequency.frequency !== 'onetime' ? sub.annualAmount : 0
      const effectiveAnnual = rawMonthly > 0
        ? effectiveMonthly * (rawAnnual / rawMonthly)
        : effectiveMonthly > 0 ? effectiveMonthly * 12 : 0

      monthlyTotal += effectiveMonthly
      annualTotal += effectiveAnnual
      return { rawTotal, sub, effectiveMonthly }
    })

    return {
      lineDetails,
      monthlyTotal,
      annualTotal: Math.round(annualTotal * 100) / 100,
    }
  }, [lines, isAutopilot])

  const handleAddLiteToCart = () => {
    onAddToCart([{
      serviceId: `${customerType}_tcep_lite`,
      serviceName: litePlan.name,
      category: 'TCEP',
      description: `${litePlan.commitmentMonths}-month plan`,
      quantity: 1,
      unitLabel: 'plan',
      frequency: 'Monthly',
      unitPrice: litePlan.monthlyPrice,
      lineTotal: litePlan.monthlyPrice,
      isSubscription: true,
      monthlyAmount: litePlan.monthlyPrice,
    }])
  }

  const handleAddCustomToCart = () => {
    if (lines.length === 0) return
    const items: LineItem[] = lines.map(line => {
      const tier = line.service.tiers[line.tierIndex]
      const isUnit = isUnitPriced(line.service.pricingModel)
      const rawCartTotal = isUnit && tier
        ? calcUnitTotal(line.service.pricingModel, tier.price, tier.min, line.quantity)
        : (tier?.price ?? 0) * line.quantity
      const sub = calculateSubscriptionPrice(rawCartTotal, line.frequency)
      const minVal = (line.service.minimum && line.service.minimum > 0) ? line.service.minimum : 0
      // Apply minimum to monthly total, not per-cut
      const rawMonthly = sub.monthlyAmount
      const effectiveMonthly = minVal > 0 ? Math.max(rawMonthly, minVal) : rawMonthly
      const isSub = line.frequency.frequency !== 'onetime'
      return {
        serviceId: line.service.id,
        serviceName: line.service.name,
        category: line.service.category,
        description: describeUnit(line.service.pricingModel, tier?.label ?? '', line.quantity),
        quantity: line.quantity,
        unitLabel: line.service.unitLabel,
        frequency: line.frequency.label,
        unitPrice: isUnit ? rawCartTotal : (tier?.price ?? 0),
        lineTotal: isSub ? effectiveMonthly : rawCartTotal,
        isSubscription: isSub,
        monthlyAmount: isSub ? effectiveMonthly : undefined,
      }
    })
    onAddToCart(items)
  }

  return (
    <div className="space-y-5">
      {/* Lite Plan (TCEP only) */}
      {!isAutopilot && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Lite Plan</p>
              <p className="text-xs text-muted-foreground">{litePlan.commitmentMonths}-month commitment</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">{fmt(litePlan.monthlyPrice)}/mo</Badge>
              <Button size="sm" variant="outline" onClick={handleAddLiteToCart}>
                <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
          </div>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-3 pb-3">
              <ul className="text-xs space-y-1">
                {litePlan.includedServices.map((s, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{s.description}</span>
                    <span className="text-muted-foreground">{s.frequency}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Custom Builder */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">
              {isAutopilot ? 'Autopilot Builder' : 'Custom Plan Builder'}
            </p>
            <p className="text-xs text-muted-foreground">
              {isAutopilot
                ? 'Single-service recurring plan'
                : '2+ services unlock bundle discount'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={addLine}
            disabled={isAutopilot && lines.length >= 1}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Service
          </Button>
        </div>

        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {isAutopilot ? 'Add a recurring service above.' : 'Add services to build a custom plan.'}
          </p>
        )}

        {lines.map((line, idx) => (
          <SubServiceLine
            key={idx}
            line={line}
            lineIndex={idx}
            availableServices={subServices}
            onUpdate={updateLine}
            onRemove={removeLine}
          />
        ))}

        {lines.length > 0 && (
          <Card className="border-primary/30">
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Monthly Total</span>
                <span className="text-lg font-bold text-primary">{fmt(totals.monthlyTotal)}/mo</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Annual Estimate</span>
                <span className="font-semibold">{fmt(totals.annualTotal)}/yr</span>
              </div>
              <Button className="w-full min-h-[44px] mt-2" onClick={handleAddCustomToCart}>
                <ShoppingCart className="h-4 w-4 mr-2" />
                {isAutopilot ? 'Add Autopilot Plan to Cart' : 'Add Custom Plan to Cart'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

/* ── Cart Drawer ─────────────────────────────────────────────────────── */
function CartDrawer({
  open,
  onOpenChange,
  items,
  onRemove,
  onClear,
  onCreateQuote,
  isCreating,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: LineItem[]
  onRemove: (idx: number) => void
  onClear: () => void
  onCreateQuote: () => void
  isCreating?: boolean
}) {
  const onetimeItems = items.filter(i => !i.isSubscription)
  const subItems = items.filter(i => i.isSubscription)
  const onetimeTotal = onetimeItems.reduce((s, i) => s + i.lineTotal, 0)
  const monthlyTotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal), 0)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <div className="flex items-center justify-between">
            <DrawerTitle className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Cart ({items.length})
            </DrawerTitle>
            {items.length > 0 && (
              <Button size="sm" variant="ghost" className="text-destructive text-xs" onClick={onClear}>
                Clear All
              </Button>
            )}
          </div>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-3 overflow-y-auto max-h-[60vh]">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Cart is empty.</p>
          )}

          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.serviceName}</p>
                <p className="text-xs text-muted-foreground">
                  {item.description && `${item.description} · `}
                  {item.frequency ?? 'One-Time'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className="text-sm font-semibold">{fmt(item.lineTotal)}</p>
                  {item.isSubscription && <p className="text-xs text-muted-foreground">/mo</p>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  onClick={() => onRemove(idx)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}

          {items.length > 0 && (
            <div className="border-t pt-3 space-y-1.5">
              {onetimeTotal > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">One-Time</span>
                  <span className="font-semibold">{fmt(onetimeTotal)}</span>
                </div>
              )}
              {monthlyTotal > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Monthly</span>
                  <span className="font-semibold">{fmt(monthlyTotal)}/mo</span>
                </div>
              )}
              <Button
                className="w-full min-h-[48px] mt-2"
                disabled={isCreating}
                onClick={() => {
                  onOpenChange(false)
                  onCreateQuote()
                }}
              >
                <Send className="h-4 w-4 mr-2" />
                {isCreating ? 'Creating…' : 'Create Quote'}
              </Button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

/* ── Sticky Cart Bar ─────────────────────────────────────────────────── */
function CartBar({ items, onOpen }: { items: LineItem[]; onOpen: () => void }) {
  if (items.length === 0) return null

  const onetimeTotal = items.filter(i => !i.isSubscription).reduce((s, i) => s + i.lineTotal, 0)
  const monthlyTotal = items.filter(i => i.isSubscription).reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal), 0)
  const displayTotal = onetimeTotal + monthlyTotal
  const hasSub = monthlyTotal > 0

  return (
    <div className="sticky bottom-0 z-40 bg-primary text-primary-foreground flex items-center justify-between px-4 py-3 shadow-lg">
      <div className="flex items-center gap-2">
        <ShoppingCart className="h-5 w-5" />
        <span className="text-sm font-semibold">
          {items.length} item{items.length !== 1 ? 's' : ''} · {fmt(displayTotal)}{hasSub && '/mo'}
        </span>
      </div>
      <Button size="sm" variant="secondary" className="gap-1" onClick={onOpen}>
        Review
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

/* ── Full-page logo watermark ────────────────────────────────────────── */
function LogoWatermark({ logoUrl }: { logoUrl?: string | null }) {
  if (!logoUrl) return null
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden
      className="fixed inset-0 w-full h-full object-contain pointer-events-none select-none z-0"
      style={{ opacity: 0.04 }}
    />
  )
}

/* ── Main Calculator Page ────────────────────────────────────────────── */
type CustomerType = 'residential' | 'commercial'
type ServiceMode = 'onetime' | 'subscription'
type PlanType = 'tcep' | 'autopilot'

export default function Calculator() {
  const { cartItems, addToCart, removeFromCart, clearCart, setIsCreatingQuote, prefillContact, setPrefillContact } = useQuoteContext()
  const [, navigate] = useLocation()
  const { isLoading, getServicesByType } = useServices()
  const { toast } = useToast()

  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet<CompanySettings>('/settings'),
  })

  // Read contactId from hash URL param (e.g. /#/calculator?contactId=abc)
  // Wouter hash routing puts params after "?" in the hash fragment.
  const contactIdFromUrl = useMemo(() => {
    const hash = window.location.hash          // e.g. "#/calculator?contactId=abc"
    const qStart = hash.indexOf('?')
    if (qStart < 0) return null
    return new URLSearchParams(hash.slice(qStart + 1)).get('contactId')
  }, [])

  // Read contacts from React Query cache — Leads page already fetched them,
  // so this is a cache hit with no network request.
  const { data: allContacts, isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet<Contact[]>('/contacts'),
    staleTime: 30_000,
    enabled: !!contactIdFromUrl,
  })

  // Resolved prefill contact: URL param wins, then fall back to context (legacy).
  const resolvedPrefillContact = useMemo<Contact | null>(() => {
    if (contactIdFromUrl && allContacts) {
      return allContacts.find(c => c.id === contactIdFromUrl) ?? null
    }
    return prefillContact
  }, [contactIdFromUrl, allContacts, prefillContact])

  const [customerType, setCustomerType] = useState<CustomerType>('residential')
  const [serviceMode, setServiceMode] = useState<ServiceMode>('onetime')
  const [planType, setPlanType] = useState<PlanType>('tcep')
  const [cartOpen, setCartOpen] = useState(false)

  // Direct quote creation — used when coming from a lead card.
  // Reads contact from URL param → RQ cache; no async fetch, no context dependency.
  const directCreateMutation = useMutation({
    mutationFn: async (contact: Contact) => {
      const onetimeItems = cartItems.filter(i => !i.isSubscription)
      const subItems = cartItems.filter(i => i.isSubscription)
      const onetimeTotal = onetimeItems.reduce((s, i) => s + i.lineTotal, 0)
      const monthlySubtotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal), 0)
      const total = onetimeTotal + monthlySubtotal
      const hasSubscription = subItems.length > 0
      const quoteType = hasSubscription
        ? (customerType === 'commercial' ? 'commercial_recurring' : 'residential_recurring')
        : (customerType === 'commercial' ? 'commercial_onetime' : 'residential_onetime')

      const res = await apiRequest('POST', '/quotes', {
        customerName:    contact.name,
        customerPhone:   contact.phone   ?? null,
        customerEmail:   contact.email   ?? null,
        customerAddress: null,
        businessName:    contact.businessName ?? null,
        contactId:       contact.id,
        quoteType,
        lineItems:       cartItems,
        subtotal:        total,
        total,
        notes:           null,
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotes'] })
      queryClient.invalidateQueries({ queryKey: ['/leads'] })
      clearCart()
      setPrefillContact(null)
      toast({ title: 'Quote created', description: 'Quote saved and linked to the lead.' })
      navigate('/leads')
    },
    onError: (err: Error) => {
      toast({ title: 'Error creating quote', description: err.message, variant: 'destructive' })
    },
  })

  const handleCreateQuote = () => {
    // If there's a contactId in the URL but contacts are still loading, wait.
    if (contactIdFromUrl && contactsLoading) {
      toast({ title: 'Loading contact info…', description: 'Please try again in a moment.' })
      return
    }
    // If we have a resolved prefill contact (from URL param or context), skip the form
    // and create the quote directly, then return to the lead pipeline.
    if (resolvedPrefillContact) {
      setCartOpen(false)
      directCreateMutation.mutate(resolvedPrefillContact)
      return
    }
    // Normal flow — open QuoteCreateForm in the Quotes page
    setIsCreatingQuote(true)
    navigate('/quotes')
  }

  const onetimeServices = useMemo(() => {
    if (serviceMode !== 'onetime') return []
    return getServicesByType(customerType).filter(
      s => s.tags.some(t => t === 'onetime' || t === 'standalonesub')
    )
  }, [customerType, serviceMode, getServicesByType])

  const categories = useMemo(() => {
    const cats: string[] = []
    const seen = new Set<string>()
    for (const s of onetimeServices) {
      if (!seen.has(s.category)) { seen.add(s.category); cats.push(s.category) }
    }
    return cats
  }, [onetimeServices])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
        Loading services...
      </div>
    )
  }

  return (
    <div className="flex flex-col relative">
      {/* Full-page watermark */}
      <LogoWatermark logoUrl={settings?.logoUrl} />

      {/* Toggle controls */}
      <div className="px-4 pt-3 pb-2 space-y-2 bg-background/90 sticky top-0 z-30 border-b shadow-sm relative">
        <ToggleGroup
          type="single"
          value={customerType}
          onValueChange={(v) => { if (v) setCustomerType(v as CustomerType) }}
          className="w-full"
        >
          <ToggleGroupItem value="residential" className="flex-1 min-h-[44px] text-sm font-medium gap-1.5">
            <Home className="h-4 w-4" />
            Residential
          </ToggleGroupItem>
          <ToggleGroupItem value="commercial" className="flex-1 min-h-[44px] text-sm font-medium gap-1.5">
            <Building2 className="h-4 w-4" />
            Commercial
          </ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          type="single"
          value={serviceMode}
          onValueChange={(v) => { if (v) setServiceMode(v as ServiceMode) }}
          className="w-full"
        >
          <ToggleGroupItem value="onetime" className="flex-1 min-h-[44px] text-sm font-medium">
            One-Time
          </ToggleGroupItem>
          <ToggleGroupItem value="subscription" className="flex-1 min-h-[44px] text-sm font-medium gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Subscription
          </ToggleGroupItem>
        </ToggleGroup>

        {serviceMode === 'subscription' && (
          <ToggleGroup
            type="single"
            value={planType}
            onValueChange={(v) => { if (v) setPlanType(v as PlanType) }}
            className="w-full"
          >
            <ToggleGroupItem value="tcep" className="flex-1 min-h-[44px] text-sm font-medium">
              {customerType === 'residential' ? 'TCEP' : 'TPC'} / Total Care
            </ToggleGroupItem>
            <ToggleGroupItem value="autopilot" className="flex-1 min-h-[44px] text-sm font-medium">
              Autopilot
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-3 relative z-10">
        {serviceMode === 'onetime' ? (
          categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No services available for this type.
            </p>
          ) : (
            <Accordion type="multiple">
              {categories.map((cat) => {
                const svcs = onetimeServices.filter(s => s.category === cat)
                const Icon = categoryIcons[cat] ?? Sparkles
                return (
                  <AccordionItem key={cat} value={cat}>
                    <AccordionTrigger className="min-h-[52px] text-sm font-semibold hover:no-underline group">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 group-data-[state=open]:bg-primary/20 transition-colors">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <span>{cat}</span>
                        <Badge variant="secondary" className="ml-1 text-xs">{svcs.length}</Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-2">
                      {svcs.map((svc) => (
                        svc.pricingModel === 'mulch'
                          ? <MulchServiceCard key={svc.id} onAdd={(item) => addToCart([item])} />
                          : <OnetimeServiceCard key={svc.id} service={svc} onAdd={(item) => addToCart([item])} />
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )
        ) : (
          <SubPlanBuilder
            customerType={customerType}
            planType={planType}
            onAddToCart={addToCart}
          />
        )}
      </div>

      <CartBar items={cartItems} onOpen={() => setCartOpen(true)} />

      <CartDrawer
        open={cartOpen}
        onOpenChange={setCartOpen}
        items={cartItems}
        onRemove={removeFromCart}
        onClear={clearCart}
        onCreateQuote={handleCreateQuote}
        isCreating={directCreateMutation.isPending}
      />
    </div>
  )
}
