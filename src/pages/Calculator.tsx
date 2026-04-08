import { useState, useMemo, useCallback, useRef } from 'react'
import {
  calculateSubscriptionPrice,
  calculatePerSqftPrice,
  getBundleDiscountPct,
  applyBundleDiscount,
  rtcepLite,
  ctcepLite,
  type ServiceDefinition,
  type FrequencyDiscount,
} from '@/lib/pricing'
import type { LineItem } from '@/types'
import { useServices } from '@/lib/services-context'
import { useQuoteContext } from '@/lib/quote-context'
import { useLocation } from 'wouter'
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
import { ShoppingCart, Trash2, Tag, TrendingUp, Send, ChevronRight, Plus } from 'lucide-react'

function fmt(n: number): string {
  return '$' + n.toFixed(2)
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

/* ── Bundle discount callout ─────────────────────────────────────────── */
function BundleCallout({ recurringCount }: { recurringCount: number }) {
  const pct = getBundleDiscountPct(recurringCount)
  if (recurringCount === 0) return null
  if (pct === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
        <Tag className="h-3.5 w-3.5 shrink-0" />
        <span>Bundle Discount: None yet — add one more recurring service to unlock <span className="font-semibold text-foreground">10% off</span></span>
      </div>
    )
  }
  if (pct === 10) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2 text-xs">
        <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-600" />
        <span className="text-green-700 dark:text-green-400"><span className="font-semibold">10% bundle discount applied</span> — add one more service to unlock <span className="font-semibold">15%</span></span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2 text-xs">
      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-600" />
      <span className="text-green-700 dark:text-green-400"><span className="font-semibold">15% bundle discount applied</span> — maximum savings unlocked</span>
    </div>
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
  const [quantity, setQuantity] = useState(1)
  const [freqKey, setFreqKey] = useState(service.frequencies[0]?.frequency ?? 'onetime')

  const freq = service.frequencies.find(f => f.frequency === freqKey) ?? service.frequencies[0]
  const tier = service.tiers[tierIndex]

  const pricing = useMemo(() => {
    if (!tier || !freq) return null
    const isPerSqft = service.pricingModel === 'per_sqft' || service.pricingModel === 'per_lf'
    const onetimeTotal = isPerSqft
      ? calculatePerSqftPrice(tier, quantity)
      : tier.price * quantity
    const sub = calculateSubscriptionPrice(onetimeTotal, freq)
    const isSub = freq.frequency !== 'onetime'
    return { onetimeTotal, sub, isSub, isPerSqft }
  }, [tier, freq, quantity, service.pricingModel])

  const handleAdd = () => {
    if (!pricing || !tier || !freq) return
    const item: LineItem = {
      serviceId: service.id,
      serviceName: service.name,
      category: service.category,
      description: pricing.isPerSqft ? `${tier.label} — ${quantity.toLocaleString()} sqft` : tier.label,
      quantity,
      unitLabel: service.unitLabel,
      frequency: freq.label,
      unitPrice: pricing.isPerSqft ? pricing.onetimeTotal : tier.price,
      lineTotal: pricing.isSub ? pricing.sub.monthlyAmount : pricing.onetimeTotal,
      isSubscription: pricing.isSub,
      monthlyAmount: pricing.isSub ? pricing.sub.monthlyAmount : undefined,
    }
    onAdd(item)
    setQuantity(1)
    setTierIndex(0)
  }

  return (
    <Card>
      <CardContent className="pt-3 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{service.name}</p>
            <p className="text-xs text-muted-foreground">{service.unitLabel}</p>
          </div>
          {pricing && (
            <div className="text-right shrink-0">
              {pricing.isSub ? (
                <p className="text-sm font-bold">{fmt(pricing.sub.monthlyAmount)}/mo</p>
              ) : (
                <p className="text-sm font-bold">{fmt(pricing.onetimeTotal)}</p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* Tier */}
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

          {/* Quantity */}
          <div className={`space-y-1 ${service.tiers.length > 1 ? 'col-span-1' : 'col-span-2'}`}>
            <Label className="text-xs">
              {service.pricingModel === 'per_sqft' ? 'Sqft' : service.pricingModel === 'per_lf' ? 'LF' : 'Qty'}
            </Label>
            <QtyInput
              value={quantity}
              onChange={setQuantity}
              placeholder={service.pricingModel === 'per_sqft' ? 'e.g. 2000' : '1'}
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

        <Button
          size="sm"
          className="w-full min-h-[44px]"
          onClick={handleAdd}
          disabled={!pricing}
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
      quantity: 1,
      frequency: svc.frequencies.find(f => f.frequency !== 'onetime') ?? svc.frequencies[0],
    })
  }

  const isPerSqft = line.service.pricingModel === 'per_sqft' || line.service.pricingModel === 'per_lf'
  const tier = line.service.tiers[line.tierIndex]
  const onetimeTotal = isPerSqft && tier
    ? calculatePerSqftPrice(tier, line.quantity)
    : (tier?.price ?? 0) * line.quantity
  const sub = calculateSubscriptionPrice(onetimeTotal, line.frequency)

  return (
    <Card>
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

          <div className="space-y-1">
            <Label className="text-xs">
              {line.service.pricingModel === 'per_sqft' ? 'Sqft' : line.service.pricingModel === 'per_lf' ? 'LF' : 'Qty'}
            </Label>
            <QtyInput
              value={line.quantity}
              onChange={(v) => onUpdate(lineIndex, { quantity: v })}
              placeholder={line.service.pricingModel === 'per_sqft' ? 'e.g. 2000' : '1'}
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

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {isPerSqft
              ? `${fmt(tier?.price ?? 0)}/sqft × ${line.quantity.toLocaleString()}`
              : `${fmt(tier?.price ?? 0)} × ${line.quantity}`}
            {line.frequency.frequency !== 'onetime' && ` via ${line.frequency.label}`}
          </span>
          <span className="font-medium text-foreground">
            {line.frequency.frequency !== 'onetime'
              ? `${fmt(sub.monthlyAmount)}/mo`
              : fmt(onetimeTotal)}
          </span>
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
        quantity: 1,
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

  const recurringCount = lines.filter(l => l.frequency.frequency !== 'onetime').length

  const totals = useMemo(() => {
    let preDiscountMonthly = 0
    const lineDetails = lines.map(line => {
      const tier = line.service.tiers[line.tierIndex]
      const isPerSqft = line.service.pricingModel === 'per_sqft' || line.service.pricingModel === 'per_lf'
      const onetimeTotal = isPerSqft && tier
        ? calculatePerSqftPrice(tier, line.quantity)
        : (tier?.price ?? 0) * line.quantity
      const sub = calculateSubscriptionPrice(onetimeTotal, line.frequency)
      const monthly = line.frequency.frequency !== 'onetime' ? sub.monthlyAmount : 0
      preDiscountMonthly += monthly
      return { onetimeTotal, sub, monthly }
    })

    const { discountPct, discountAmount, discountedTotal } = isAutopilot
      ? { discountPct: 0, discountAmount: 0, discountedTotal: preDiscountMonthly }
      : applyBundleDiscount(preDiscountMonthly, recurringCount)

    return {
      lineDetails,
      preDiscountMonthly,
      discountPct,
      discountAmount,
      monthlyTotal: discountedTotal,
      annualTotal: discountedTotal * 12,
    }
  }, [lines, isAutopilot, recurringCount])

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
      const isPerSqft = line.service.pricingModel === 'per_sqft' || line.service.pricingModel === 'per_lf'
      const onetimeTotal = isPerSqft && tier
        ? calculatePerSqftPrice(tier, line.quantity)
        : (tier?.price ?? 0) * line.quantity
      const sub = calculateSubscriptionPrice(onetimeTotal, line.frequency)
      return {
        serviceId: line.service.id,
        serviceName: line.service.name,
        category: line.service.category,
        description: isPerSqft
          ? `${tier?.label ?? ''} — ${line.quantity.toLocaleString()} sqft`
          : (tier?.label ?? ''),
        quantity: line.quantity,
        unitLabel: line.service.unitLabel,
        frequency: line.frequency.label,
        unitPrice: isPerSqft ? onetimeTotal : (tier?.price ?? 0),
        lineTotal: line.frequency.frequency === 'onetime' ? onetimeTotal : sub.monthlyAmount,
        isSubscription: line.frequency.frequency !== 'onetime',
        monthlyAmount: line.frequency.frequency !== 'onetime' ? sub.monthlyAmount : undefined,
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
              <Badge>{fmt(litePlan.monthlyPrice)}/mo</Badge>
              <Button size="sm" variant="outline" onClick={handleAddLiteToCart}>
                <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
          </div>
          <Card>
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

        {lines.length > 0 && !isAutopilot && (
          <BundleCallout recurringCount={recurringCount} />
        )}

        {lines.length > 0 && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              {!isAutopilot && totals.discountPct > 0 && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="text-sm line-through text-muted-foreground">
                      {fmt(totals.preDiscountMonthly)}/mo
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-green-700 dark:text-green-400">
                      Bundle Discount ({totals.discountPct}%)
                    </span>
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">
                      -{fmt(totals.discountAmount)}/mo
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Monthly Total</span>
                <span className="text-lg font-bold">{fmt(totals.monthlyTotal)}/mo</span>
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
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: LineItem[]
  onRemove: (idx: number) => void
  onClear: () => void
  onCreateQuote: () => void
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
                onClick={() => {
                  onOpenChange(false)
                  onCreateQuote()
                }}
              >
                <Send className="h-4 w-4 mr-2" />
                Create Quote
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
    <div
      className="sticky bottom-0 z-40 bg-primary text-primary-foreground flex items-center justify-between px-4 py-3 shadow-lg"
      style={{ marginBottom: 0 }}
    >
      <div className="flex items-center gap-2">
        <ShoppingCart className="h-5 w-5" />
        <span className="text-sm font-semibold">
          {items.length} item{items.length !== 1 ? 's' : ''} ·{' '}
          {fmt(displayTotal)}{hasSub && '/mo'}
        </span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="gap-1"
        onClick={onOpen}
      >
        Review
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

/* ── Main Calculator Page ────────────────────────────────────────────── */
type CustomerType = 'residential' | 'commercial'
type ServiceMode = 'onetime' | 'subscription'
type PlanType = 'tcep' | 'autopilot'

export default function Calculator() {
  const { cartItems, addToCart, removeFromCart, clearCart, setIsCreatingQuote } = useQuoteContext()
  const [, navigate] = useLocation()
  const { services: allServices, isLoading, getServicesByType } = useServices()

  const [customerType, setCustomerType] = useState<CustomerType>('residential')
  const [serviceMode, setServiceMode] = useState<ServiceMode>('onetime')
  const [planType, setPlanType] = useState<PlanType>('tcep')
  const [cartOpen, setCartOpen] = useState(false)

  const handleCreateQuote = () => {
    setIsCreatingQuote(true)
    navigate('/quotes')
  }

  // For one-time mode: get services filtered by customerType, excluding sub-only tags
  const onetimeServices = useMemo(() => {
    if (serviceMode !== 'onetime') return []
    return getServicesByType(customerType).filter(
      s => s.tags.some(t => t === 'onetime' || t === 'standalonesub')
    )
  }, [customerType, serviceMode, getServicesByType])

  // Group one-time services by category
  const categories = useMemo(() => {
    const cats: string[] = []
    const seen = new Set<string>()
    for (const s of onetimeServices) {
      if (!seen.has(s.category)) {
        seen.add(s.category)
        cats.push(s.category)
      }
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
    <div className="flex flex-col">
      {/* Toggle controls */}
      <div className="px-4 pt-4 pb-2 space-y-2 bg-background sticky top-0 z-30 border-b">
        {/* Customer type */}
        <ToggleGroup
          type="single"
          value={customerType}
          onValueChange={(v) => { if (v) setCustomerType(v as CustomerType) }}
          className="w-full"
        >
          <ToggleGroupItem value="residential" className="flex-1 min-h-[44px] text-sm font-medium">
            Residential
          </ToggleGroupItem>
          <ToggleGroupItem value="commercial" className="flex-1 min-h-[44px] text-sm font-medium">
            Commercial
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Service mode */}
        <ToggleGroup
          type="single"
          value={serviceMode}
          onValueChange={(v) => { if (v) setServiceMode(v as ServiceMode) }}
          className="w-full"
        >
          <ToggleGroupItem value="onetime" className="flex-1 min-h-[44px] text-sm font-medium">
            One-Time
          </ToggleGroupItem>
          <ToggleGroupItem value="subscription" className="flex-1 min-h-[44px] text-sm font-medium">
            Subscription
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Plan type (subscription only) */}
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
      <div className="flex-1 p-4 space-y-3">
        {serviceMode === 'onetime' ? (
          // Accordion by category for one-time services
          categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No services available for this type.
            </p>
          ) : (
            <Accordion type="multiple">
              {categories.map((cat) => {
                const svcs = onetimeServices.filter(s => s.category === cat)
                return (
                  <AccordionItem key={cat} value={cat}>
                    <AccordionTrigger className="min-h-[48px] text-sm font-semibold">
                      {cat}
                      <Badge variant="secondary" className="ml-2 text-xs">{svcs.length}</Badge>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-2">
                      {svcs.map((svc) => (
                        <OnetimeServiceCard
                          key={svc.id}
                          service={svc}
                          onAdd={(item) => addToCart([item])}
                        />
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )
        ) : (
          // TCEP / Autopilot plan builder
          <SubPlanBuilder
            customerType={customerType}
            planType={planType}
            onAddToCart={addToCart}
          />
        )}
      </div>

      {/* Sticky cart bar */}
      <CartBar items={cartItems} onOpen={() => setCartOpen(true)} />

      {/* Cart drawer */}
      <CartDrawer
        open={cartOpen}
        onOpenChange={setCartOpen}
        items={cartItems}
        onRemove={removeFromCart}
        onClear={clearCart}
        onCreateQuote={handleCreateQuote}
      />
    </div>
  )
}
