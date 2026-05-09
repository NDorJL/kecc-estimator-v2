import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiRequest } from '@/lib/queryClient'
import type { MarketingChannel, MarketingSpend, Campaign, CampaignEvent, Lead, Quote, Job } from '@/types'
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Users, Briefcase,
  Target, ChevronUp, ChevronDown, Plus, Pencil, Trash2, Download, Megaphone,
  Award, BarChart2, Pause, Play, Archive, Copy, QrCode,
} from 'lucide-react'

// ── Period types ─────────────────────────────────────────────────────────────

type PeriodPreset = 'this_month' | 'last_month' | 'last_3' | 'last_6' | 'last_12' | 'custom'

interface DateRange { start: string; end: string }  // 'YYYY-MM'

const PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: 'This Month',
  last_month: 'Last Month',
  last_3:     'Last 3M',
  last_6:     'Last 6M',
  last_12:    'Last 12M',
  custom:     'Custom',
}

// ── Period math helpers ───────────────────────────────────────────────────────

function thisMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getPeriodRange(preset: PeriodPreset, custom: DateRange): DateRange {
  const tm = thisMonthStr()
  switch (preset) {
    case 'this_month': return { start: tm, end: tm }
    case 'last_month': return { start: addMonths(tm, -1), end: addMonths(tm, -1) }
    case 'last_3':     return { start: addMonths(tm, -2), end: tm }
    case 'last_6':     return { start: addMonths(tm, -5), end: tm }
    case 'last_12':    return { start: addMonths(tm, -11), end: tm }
    case 'custom':     return custom
  }
}

function getPrevRange(preset: PeriodPreset, range: DateRange): DateRange | null {
  if (preset === 'custom') return null
  const [sy, sm] = range.start.split('-').map(Number)
  const [ey, em] = range.end.split('-').map(Number)
  const months = (ey - sy) * 12 + (em - sm) + 1
  return {
    start: addMonths(range.start, -months),
    end:   addMonths(range.end,   -months),
  }
}

function getLast6Months(): string[] {
  const tm = thisMonthStr()
  return Array.from({ length: 6 }, (_, i) => addMonths(tm, -(5 - i)))
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtPct(n: number): string { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` }
function fmtNum(n: number): string { return n.toLocaleString() }

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

type MetricKind = 'currency' | 'number' | 'percent' | 'text'
type TrendDir = 'up' | 'down' | 'flat'

function trendDir(cur: number | null, prev: number | null): TrendDir {
  if (cur === null || prev === null) return 'flat'
  if (cur > prev) return 'up'
  if (cur < prev) return 'down'
  return 'flat'
}

function formatKpi(v: number | null, kind: MetricKind): string {
  if (v === null) return '—'
  if (kind === 'currency') return fmtCurrency(v)
  if (kind === 'percent')  return `${v.toFixed(1)}%`
  if (kind === 'number')   return fmtNum(Math.round(v))
  return String(v)
}

function KpiCard({
  title, icon, value, prev, kind, lowerIsBetter = false, isEstimated = false,
}: {
  title: string
  icon: React.ReactNode
  value: number | null
  prev: number | null
  kind: MetricKind
  lowerIsBetter?: boolean
  isEstimated?: boolean
}) {
  const dir = trendDir(value, prev)
  const isGood = dir === 'flat' ? null : lowerIsBetter ? dir === 'down' : dir === 'up'

  const TrendIcon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus
  const trendColor =
    isGood === null ? 'text-muted-foreground' :
    isGood          ? 'text-emerald-500'      : 'text-red-500'

  const delta =
    prev !== null && prev !== 0 && value !== null
      ? ((value - prev) / Math.abs(prev)) * 100
      : null

  return (
    <Card className="shrink-0 w-[160px] sm:w-auto">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-tight">{title}</span>
          <span className="text-muted-foreground/60">{icon}</span>
        </div>
        <div className="text-xl font-bold tracking-tight truncate">
          {isEstimated && value !== null && (
            <span className="text-base text-muted-foreground/50 mr-0.5" title="Estimate — no completed job found">~</span>
          )}
          {formatKpi(value, kind)}
        </div>
        <div className={`flex items-center gap-0.5 mt-1 text-xs ${trendColor}`}>
          <TrendIcon className="h-3 w-3 shrink-0" />
          {delta !== null ? (
            <span>{Math.abs(delta).toFixed(0)}% vs prior</span>
          ) : (
            <span className="text-muted-foreground">no prior data</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── TextKpiCard — for "Best Channel" (string value, no trend) ────────────────

function TextKpiCard({ title, icon, value }: { title: string; icon: React.ReactNode; value: string | null }) {
  return (
    <Card className="shrink-0 w-[160px] sm:w-auto">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-tight">{title}</span>
          <span className="text-muted-foreground/60">{icon}</span>
        </div>
        <div className="text-base font-bold tracking-tight leading-snug">{value ?? '—'}</div>
        <div className="mt-1 text-xs text-muted-foreground">lowest CPA this period</div>
      </CardContent>
    </Card>
  )
}

// ── SparklineChart ────────────────────────────────────────────────────────────

function SparklineChart({ data }: { data: { v: number }[] }) {
  const hasData = data.some(d => d.v > 0)
  if (!hasData) return <span className="text-xs text-muted-foreground/40">—</span>
  return (
    <div style={{ width: 72, height: 28 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── SpendEntrySheet ───────────────────────────────────────────────────────────

function SpendEntrySheet({
  open, onClose, channels, initialChannelId, initialMonth, editEntry,
}: {
  open: boolean
  onClose: () => void
  channels: MarketingChannel[]
  initialChannelId?: string
  initialMonth?: string
  editEntry?: MarketingSpend
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const tm = thisMonthStr()

  const [channelId, setChannelId] = useState(editEntry?.channelId ?? initialChannelId ?? '')
  const [month,     setMonth]     = useState(editEntry?.month ?? initialMonth ?? tm)
  const [amount,    setAmount]    = useState(editEntry ? String(editEntry.amount) : '')
  const [notes,     setNotes]     = useState(editEntry?.notes ?? '')

  // Reset when sheet opens
  const handleOpen = (o: boolean) => {
    if (o) {
      setChannelId(editEntry?.channelId ?? initialChannelId ?? '')
      setMonth(editEntry?.month ?? initialMonth ?? tm)
      setAmount(editEntry ? String(editEntry.amount) : '')
      setNotes(editEntry?.notes ?? '')
    } else {
      onClose()
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { channelId, month, amount: parseFloat(amount) || 0, notes: notes || null }
      if (editEntry) {
        return apiRequest('PATCH', `/marketing-spend/${editEntry.id}`, payload)
      }
      return apiRequest('POST', '/marketing-spend', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/marketing-spend'] })
      toast({ title: editEntry ? 'Spend updated' : 'Spend entry saved' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const isValid = channelId && month && amount && parseFloat(amount) >= 0

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{editEntry ? 'Edit Spend Entry' : 'Add Spend Entry'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Channel</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select channel…" /></SelectTrigger>
              <SelectContent>
                {channels.map(ch => (
                  <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Month</Label>
            <Input
              type="month"
              className="mt-1"
              value={month}
              onChange={e => setMonth(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Amount ($)</Label>
            <Input
              type="number"
              className="mt-1"
              placeholder="0.00"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              className="mt-1"
              placeholder="Campaign details, invoice #, etc."
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <SheetFooter className="mt-5 flex flex-row gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1"
            disabled={!isValid || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── ChannelDetailSheet ────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  paused: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  ended:  'bg-muted text-muted-foreground border-border',
}

const TYPE_BADGE_OUTER: Record<string, string> = {
  digital:  'bg-blue-500/10 text-blue-600 border-blue-500/20',
  print:    'bg-amber-500/10 text-amber-600 border-amber-500/20',
  referral: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  other:    'bg-muted text-muted-foreground border-border',
}

function fmtOr(v: number | null, fmt: (n: number) => string, fallback = '—'): string {
  return v !== null ? fmt(v) : fallback
}

function ChannelDetailSheet({
  channel, onClose, stats, channelCampaigns,
}: {
  channel: MarketingChannel | null
  onClose: () => void
  stats: {
    spend: number; leadsCount: number; closedJobs: number
    chRevenue: number; chRevenueEst: boolean
    chCpl: number | null; chCpa: number | null; chRoi: number | null
  } | null
  channelCampaigns: Campaign[]
}) {
  const TYPE_BADGE = TYPE_BADGE_OUTER

  return (
    <Sheet open={!!channel} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg">{channel?.name ?? 'Channel'}</SheetTitle>
            {channel && (
              <Badge variant="outline" className={`text-[11px] px-1.5 py-0 h-5 ${TYPE_BADGE[channel.type] ?? TYPE_BADGE.other}`}>
                {channel.type}
              </Badge>
            )}
          </div>
        </SheetHeader>

        {stats ? (
          <>
            {/* ── Stats grid ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {[
                { label: 'Spend',    value: fmtCurrency(stats.spend) },
                { label: 'Leads',    value: String(stats.leadsCount || '—') },
                { label: 'Closed',   value: String(stats.closedJobs || '—') },
                {
                  label: 'Revenue',
                  value: stats.chRevenue > 0
                    ? `${stats.chRevenueEst ? '~' : ''}${fmtCurrency(stats.chRevenue)}`
                    : '—',
                },
                { label: 'CPL',      value: fmtOr(stats.chCpl, fmtCurrency) },
                { label: 'CPA',      value: fmtOr(stats.chCpa, fmtCurrency) },
                {
                  label: 'ROI',
                  value: stats.chRoi !== null ? fmtPct(stats.chRoi) : '—',
                  color: stats.chRoi !== null
                    ? stats.chRoi >= 0 ? 'text-emerald-600' : 'text-red-500'
                    : undefined,
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-muted/40 rounded-lg p-3">
                  <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{label}</div>
                  <div className={`text-base font-bold tabular-nums ${color ?? ''}`}>{value}</div>
                </div>
              ))}
            </div>

            {/* ── Campaigns list ─────────────────────────────────────────── */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Campaigns ({channelCampaigns.length})
              </h4>
              {channelCampaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No campaigns yet for this channel</p>
              ) : (
                <div className="space-y-2">
                  {channelCampaigns.map(cam => (
                    <div key={cam.id} className="border border-border/60 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{cam.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 h-5 shrink-0 ${STATUS_BADGE[cam.status] ?? STATUS_BADGE.ended}`}
                        >
                          {cam.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                        <span className="text-[11px] text-muted-foreground capitalize">{cam.campaignType}</span>
                        {cam.startDate && (
                          <span className="text-[11px] text-muted-foreground">
                            {cam.startDate}{cam.endDate ? ` – ${cam.endDate}` : ''}
                          </span>
                        )}
                        {cam.budget != null && (
                          <span className="text-[11px] text-muted-foreground">Budget: {fmtCurrency(cam.budget)}</span>
                        )}
                      </div>
                      {cam.utmCampaign && (
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground/60 truncate">
                          utm_campaign={cam.utmCampaign}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mt-8 text-center text-muted-foreground">
            <BarChart2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No data for this period</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Campaign status badges ────────────────────────────────────────────────────

const CAM_STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  paused: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  ended:  'bg-muted text-muted-foreground border-border',
}

// ── CampaignCard ──────────────────────────────────────────────────────────────

interface CampaignMetrics {
  views: number; leads: number; closed: number
  spend: number; revenue: number; revenueIsEst: boolean
  cpl: number | null; cpa: number | null; roi: number | null
}

function CampaignCard({
  campaign, channel, metrics, onEdit, onStatusToggle, onArchive,
}: {
  campaign: Campaign
  channel: MarketingChannel | undefined
  metrics: CampaignMetrics
  onEdit: () => void
  onStatusToggle: () => void
  onArchive: () => void
}) {
  const { toast } = useToast()
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)

  // Generate QR for QR-type campaigns
  useEffect(() => {
    if (campaign.campaignType !== 'qr' || !campaign.redirectToken) return
    setQrLoading(true)
    const url = `${window.location.origin}/.netlify/functions/track?c=${campaign.redirectToken}`
    QRCode.toDataURL(url, { width: 240, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then(d => { setQrDataUrl(d); setQrLoading(false) })
      .catch(() => setQrLoading(false))
  }, [campaign.campaignType, campaign.redirectToken])

  function downloadQr() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `${campaign.name.replace(/\s+/g, '-').toLowerCase()}-qr.png`
    a.click()
  }

  const convViewsLeads  = metrics.views > 0  ? `${(metrics.leads  / metrics.views  * 100).toFixed(0)}%` : null
  const convLeadsClosed = metrics.leads > 0  ? `${(metrics.closed / metrics.leads  * 100).toFixed(0)}%` : null

  const budgetPct    = campaign.budget && campaign.budget > 0 ? Math.min((metrics.spend / campaign.budget) * 100, 100) : null
  const isOverBudget = !!(campaign.budget && metrics.spend > campaign.budget)

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => toast({ title: 'Copied!' })).catch(() => {})
  }

  return (
    <Card className="flex flex-col">
      <CardContent className="p-4 flex flex-col gap-3">

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-semibold text-sm leading-tight truncate">{campaign.name}</h4>
            <div className="flex flex-wrap gap-1 mt-1">
              {channel && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{channel.name}</Badge>
              )}
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${CAM_STATUS_BADGE[campaign.status] ?? CAM_STATUS_BADGE.ended}`}>
                {campaign.status}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 capitalize">{campaign.campaignType}</Badge>
            </div>
            {(campaign.startDate || campaign.endDate) && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {campaign.startDate ?? '?'} – {campaign.endDate ?? 'ongoing'}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-0.5 shrink-0">
            {campaign.status !== 'ended' && (
              <Button size="icon" variant="ghost" className="h-7 w-7"
                title={campaign.status === 'active' ? 'Pause' : 'Resume'}
                onClick={onStatusToggle}>
                {campaign.status === 'active'
                  ? <Pause className="h-3.5 w-3.5" />
                  : <Play  className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {campaign.status !== 'ended' && (
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                title="Archive (mark ended)" onClick={onArchive}>
                <Archive className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* ── Budget progress ───────────────────────────────────────── */}
        {campaign.budget && campaign.budget > 0 ? (
          <div>
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
              <span>Spend: {fmtCurrency(metrics.spend)}</span>
              <span className={isOverBudget ? 'text-destructive font-semibold' : ''}>Budget: {fmtCurrency(campaign.budget)}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all ${isOverBudget ? 'bg-destructive' : (budgetPct ?? 0) > 80 ? 'bg-amber-500' : 'bg-primary'}`}
                style={{ width: `${budgetPct ?? 0}%` }}
              />
            </div>
          </div>
        ) : metrics.spend > 0 ? (
          <p className="text-[11px] text-muted-foreground">Spend: {fmtCurrency(metrics.spend)} (no budget set)</p>
        ) : null}

        {/* ── Funnel: Views → Leads → Closed ───────────────────────── */}
        <div className="grid grid-cols-5 items-center gap-1 text-center">
          <div className="col-span-1 bg-muted/40 rounded-lg py-2">
            <div className="text-sm font-bold">{metrics.views}</div>
            <div className="text-[10px] text-muted-foreground">Views</div>
          </div>
          <div className="col-span-1 text-[10px] text-muted-foreground font-medium">
            {convViewsLeads ?? '→'}
          </div>
          <div className="col-span-1 bg-muted/40 rounded-lg py-2">
            <div className="text-sm font-bold">{metrics.leads}</div>
            <div className="text-[10px] text-muted-foreground">Leads</div>
          </div>
          <div className="col-span-1 text-[10px] text-muted-foreground font-medium">
            {convLeadsClosed ?? '→'}
          </div>
          <div className="col-span-1 bg-muted/40 rounded-lg py-2">
            <div className="text-sm font-bold">{metrics.closed}</div>
            <div className="text-[10px] text-muted-foreground">Closed</div>
          </div>
        </div>

        {/* ── CPL / CPA / ROI ──────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1 text-center border border-border/40 rounded-lg p-2">
          <div>
            <div className="text-xs font-semibold tabular-nums">
              {metrics.cpl != null ? fmtCurrency(metrics.cpl) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">CPL</div>
          </div>
          <div>
            <div className="text-xs font-semibold tabular-nums">
              {metrics.cpa != null ? fmtCurrency(metrics.cpa) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">CPA</div>
          </div>
          <div>
            <div className={`text-xs font-semibold tabular-nums ${metrics.roi != null ? (metrics.roi >= 0 ? 'text-emerald-600' : 'text-red-500') : ''}`}>
              {metrics.roi != null ? fmtPct(metrics.roi) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">ROI</div>
          </div>
        </div>

        {/* ── QR Code ──────────────────────────────────────────────── */}
        {campaign.campaignType === 'qr' && (
          <div className="border border-border/60 rounded-lg p-3 flex flex-col items-center gap-2">
            <p className="text-[10px] text-muted-foreground self-start">QR Code → {campaign.destinationUrl ?? 'no destination set'}</p>
            {qrLoading ? (
              <Skeleton className="w-[120px] h-[120px] rounded" />
            ) : qrDataUrl ? (
              <>
                <img src={qrDataUrl} alt="QR code" className="w-[120px] h-[120px] rounded border border-border/40" />
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 w-full" onClick={downloadQr}>
                  <Download className="h-3.5 w-3.5" /> Download QR PNG
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground py-2">QR unavailable</p>
            )}
          </div>
        )}

        {/* ── Referral code ─────────────────────────────────────────── */}
        {campaign.campaignType === 'referral' && campaign.utmCampaign && (
          <div className="border border-border/60 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground mb-1.5">Referral Code</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono font-bold bg-muted px-2 py-1 rounded truncate">
                {campaign.utmCampaign}
              </code>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                onClick={() => copyText(campaign.utmCampaign ?? '')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Digital UTM URL ───────────────────────────────────────── */}
        {campaign.campaignType === 'digital' && campaign.destinationUrl && (
          <div className="border border-border/60 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground mb-1.5">Campaign URL</p>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[10px] font-mono text-muted-foreground truncate">{campaign.destinationUrl}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                onClick={() => copyText(campaign.destinationUrl ?? '')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  )
}

// ── CampaignSheet ─────────────────────────────────────────────────────────────

function CampaignSheet({
  open, onClose, channels, editCampaign,
}: {
  open: boolean
  onClose: () => void
  channels: MarketingChannel[]
  editCampaign: Campaign | null
}) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [name,           setName]           = useState('')
  const [channelId,      setChannelId]      = useState('')
  const [campaignType,   setCampaignType]   = useState<Campaign['campaignType']>('digital')
  const [startDate,      setStartDate]      = useState('')
  const [endDate,        setEndDate]        = useState('')
  const [budget,         setBudget]         = useState('')
  // Digital
  const [destinationUrl, setDestinationUrl] = useState('')
  const [utmMedium,      setUtmMedium]      = useState('paid')
  const [utmCampaignSlug,setUtmCampaignSlug]= useState('')
  const slugDirty = useRef(false)
  // Referral
  const [referralCode,   setReferralCode]   = useState('')

  // Reset form when sheet opens
  useEffect(() => {
    if (!open) return
    slugDirty.current = false
    if (editCampaign) {
      setName(editCampaign.name)
      setChannelId(editCampaign.channelId)
      setCampaignType(editCampaign.campaignType)
      setStartDate(editCampaign.startDate ?? '')
      setEndDate(editCampaign.endDate ?? '')
      setBudget(editCampaign.budget != null ? String(editCampaign.budget) : '')
      setDestinationUrl(editCampaign.destinationUrl ?? '')
      setUtmMedium(editCampaign.utmMedium ?? 'paid')
      setUtmCampaignSlug(editCampaign.utmCampaign ?? '')
      setReferralCode(editCampaign.utmCampaign ?? '')
      slugDirty.current = true  // don't auto-overwrite on edit
    } else {
      setName(''); setChannelId(''); setCampaignType('digital')
      setStartDate(new Date().toISOString().slice(0, 10)); setEndDate('')
      setBudget(''); setDestinationUrl(''); setUtmMedium('paid')
      setUtmCampaignSlug(''); setReferralCode('')
    }
  }, [open, editCampaign])

  // Auto-slugify name → utm_campaign (unless user has manually edited the field)
  useEffect(() => {
    if (!slugDirty.current) setUtmCampaignSlug(slugify(name))
  }, [name])

  // Auto-generate referral code when channel selected on new campaigns
  useEffect(() => {
    if (editCampaign || campaignType !== 'referral' || !channelId) return
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    const chPart = ch.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
    const rand   = Math.random().toString(36).slice(2, 6).toUpperCase()
    setReferralCode(`REF-${chPart}-${rand}`)
  }, [channelId, campaignType, editCampaign, channels])

  const selectedChannel = channels.find(c => c.id === channelId)
  const utmSource = selectedChannel ? slugify(selectedChannel.name) : ''

  const generatedUtmUrl = useMemo(() => {
    if (!destinationUrl) return ''
    const p = new URLSearchParams()
    if (utmSource)       p.set('utm_source',   utmSource)
    if (utmMedium)       p.set('utm_medium',    utmMedium)
    if (utmCampaignSlug) p.set('utm_campaign',  utmCampaignSlug)
    return `${destinationUrl}?${p.toString()}`
  }, [destinationUrl, utmSource, utmMedium, utmCampaignSlug])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const base = {
        name, channelId, campaignType,
        startDate: startDate || null,
        endDate:   endDate   || null,
        budget:    budget    ? parseFloat(budget) : null,
        status:    editCampaign?.status ?? 'active',
      }
      let extra: Record<string, unknown> = {}
      if (campaignType === 'digital') {
        extra = {
          destinationUrl: generatedUtmUrl || destinationUrl || null,
          utmSource,
          utmMedium,
          utmCampaign: utmCampaignSlug || null,
        }
      } else if (campaignType === 'qr') {
        extra = { destinationUrl: destinationUrl || null }
      } else {
        extra = { utmCampaign: referralCode || null }
      }
      const payload = { ...base, ...extra }
      return editCampaign
        ? apiRequest('PATCH', `/campaigns/${editCampaign.id}`, payload)
        : apiRequest('POST',  '/campaigns', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/campaigns'] })
      toast({ title: editCampaign ? 'Campaign updated' : 'Campaign created' })
      onClose()
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const isValid = !!(name.trim() && channelId && campaignType)

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-y-auto pb-safe">
        <SheetHeader className="mb-4">
          <SheetTitle>{editCampaign ? 'Edit Campaign' : 'New Campaign'}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <Label className="text-xs">Campaign Name</Label>
            <Input className="mt-1" placeholder="e.g. Spring Door Hanger Run" value={name} onChange={e => setName(e.target.value)} />
          </div>

          {/* Channel */}
          <div>
            <Label className="text-xs">Channel</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select channel…" /></SelectTrigger>
              <SelectContent>
                {channels.map(ch => <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Campaign type */}
          <div>
            <Label className="text-xs">Campaign Type</Label>
            <div className="flex gap-1.5 mt-1">
              {(['digital', 'qr', 'referral'] as Campaign['campaignType'][]).map(t => (
                <button
                  key={t}
                  onClick={() => setCampaignType(t)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors capitalize ${
                    campaignType === t
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent border-border text-muted-foreground hover:border-foreground'
                  }`}
                >
                  {t === 'qr' ? 'QR Code' : t}
                </button>
              ))}
            </div>
          </div>

          {/* Dates + Budget */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input type="date" className="mt-1" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input type="date" className="mt-1" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Budget ($)</Label>
            <Input type="number" min="0" className="mt-1" placeholder="0" value={budget} onChange={e => setBudget(e.target.value)} />
          </div>

          {/* ── Type-specific fields ──────────────────────────────── */}

          {campaignType === 'digital' && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">UTM Builder</p>

              <div>
                <Label className="text-xs">Destination URL</Label>
                <Input className="mt-1 text-sm" placeholder="https://yoursite.com/landing" value={destinationUrl} onChange={e => setDestinationUrl(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">utm_source <span className="text-muted-foreground">(auto)</span></Label>
                  <Input className="mt-1 text-sm bg-muted/40" readOnly value={utmSource} />
                </div>
                <div>
                  <Label className="text-xs">utm_medium</Label>
                  <Select value={utmMedium} onValueChange={setUtmMedium}>
                    <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">paid</SelectItem>
                      <SelectItem value="organic">organic</SelectItem>
                      <SelectItem value="social">social</SelectItem>
                      <SelectItem value="email">email</SelectItem>
                      <SelectItem value="cpc">cpc</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">utm_campaign</Label>
                <Input
                  className="mt-1 text-sm"
                  placeholder={slugify(name) || 'campaign-slug'}
                  value={utmCampaignSlug}
                  onChange={e => { slugDirty.current = true; setUtmCampaignSlug(e.target.value) }}
                />
              </div>

              {generatedUtmUrl && (
                <div className="rounded-md bg-muted/60 p-2">
                  <p className="text-[10px] text-muted-foreground mb-1">Generated URL</p>
                  <div className="flex items-start gap-2">
                    <p className="flex-1 text-[11px] font-mono text-foreground break-all leading-relaxed">{generatedUtmUrl}</p>
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 mt-0.5"
                      onClick={() => navigator.clipboard.writeText(generatedUtmUrl).then(() => toast({ title: 'Copied!' }))}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {campaignType === 'qr' && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">QR Destination</p>
              <div>
                <Label className="text-xs">Destination URL</Label>
                <Input className="mt-1 text-sm" placeholder="https://yoursite.com/landing" value={destinationUrl} onChange={e => setDestinationUrl(e.target.value)} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                After saving, a QR code will appear on the campaign card pointing to the tracking redirect, which forwards visitors to this URL.
              </p>
            </div>
          )}

          {campaignType === 'referral' && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Referral Code</p>
              <div>
                <Label className="text-xs">Code (editable)</Label>
                <Input className="mt-1 font-mono text-sm" value={referralCode} onChange={e => setReferralCode(e.target.value)} placeholder="REF-CHANNEL-XXXX" />
              </div>
              <p className="text-[11px] text-muted-foreground">This code will be shown prominently on the campaign card. Share it with referrers.</p>
            </div>
          )}
        </div>

        <SheetFooter className="mt-5 flex flex-row gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!isValid || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : editCampaign ? 'Update Campaign' : 'Create Campaign'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

type SortCol = 'name' | 'spend' | 'leads' | 'views' | 'convRate' | 'closedJobs' | 'closeRate' | 'revenue' | 'cpl' | 'cpa' | 'roi'

function SortTh({
  col, label, active, dir, onSort, className = '',
}: {
  col: SortCol; label: string; active: boolean; dir: 'asc' | 'desc'
  onSort: (c: SortCol) => void; className?: string
}) {
  return (
    <th
      className={`px-3 py-2 text-right text-[11px] font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-0.5 justify-end">
        {label}
        {active
          ? (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ChevronDown className="h-3 w-3 opacity-30" />}
      </span>
    </th>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Marketing() {
  const { toast } = useToast()
  const qc = useQueryClient()

  // ── Period state ──────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<PeriodPreset>('this_month')
  const [customStart, setCustomStart] = useState(addMonths(thisMonthStr(), -2))
  const [customEnd,   setCustomEnd]   = useState(thisMonthStr())

  const range    = useMemo(() => getPeriodRange(preset, { start: customStart, end: customEnd }), [preset, customStart, customEnd])
  const prevRange = useMemo(() => getPrevRange(preset, range), [preset, range])

  // ── UI state ──────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<SortCol>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [detailChannel, setDetailChannel] = useState<MarketingChannel | null>(null)
  const [showAddSpend,  setShowAddSpend]  = useState(false)
  const [editSpend,     setEditSpend]     = useState<MarketingSpend | undefined>(undefined)
  const [spendChannelPreset, setSpendChannelPreset] = useState<string | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // Campaign manager state
  const [campaignFilter,  setCampaignFilter]  = useState<'all' | 'active' | 'paused' | 'ended'>('all')
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [editCampaign,    setEditCampaign]    = useState<Campaign | null>(null)

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: channels = [], isLoading: loadingChannels } = useQuery<MarketingChannel[]>({
    queryKey: ['/marketing-channels'],
    queryFn: () => apiGet('/marketing-channels'),
  })

  const { data: allSpend = [], isLoading: loadingSpend } = useQuery<MarketingSpend[]>({
    queryKey: ['/marketing-spend'],
    queryFn: () => apiGet('/marketing-spend'),
  })

  const { data: allLeads = [] } = useQuery<Lead[]>({
    queryKey: ['/leads'],
    queryFn: () => apiGet('/leads'),
  })

  const { data: allQuotes = [] } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
  })

  const { data: allCampaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['/campaigns'],
    queryFn: () => apiGet('/campaigns'),
  })

  const { data: allEvents = [] } = useQuery<CampaignEvent[]>({
    queryKey: ['/campaign-events'],
    queryFn: () => apiGet('/campaign-events'),
  })

  const { data: allJobs = [] } = useQuery<Job[]>({
    queryKey: ['/jobs'],
    queryFn: () => apiGet('/jobs'),
  })

  // ── Attribution maps ──────────────────────────────────────────────────────

  // campaign_id → channel_id
  const campaignChannelMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of allCampaigns) m[c.id] = c.channelId
    return m
  }, [allCampaigns])

  // source string → channel_id (fallback when no campaign_id)
  const sourceToChannelId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const ch of channels) {
      // Exact name match (e.g. "Door Hangers" from cookie tracking)
      m[ch.name.toLowerCase()] = ch.id
      // snake_case variant (e.g. "door_hangers" from UTM source)
      m[ch.name.toLowerCase().replace(/[\s/]+/g, '_')] = ch.id
    }
    // Common manual aliases for UTM sources people type
    const manualAliases: Record<string, string[]> = {
      'facebook ads':           ['facebook', 'fb', 'facebook_ads'],
      'google ads':             ['google', 'google_ads', 'gads'],
      'google business profile':['google_business', 'gbp', 'gmb'],
      'nextdoor':               ['nextdoor'],
      'instagram':              ['instagram', 'instagram_ads', 'ig'],
      'direct mail':            ['mailers', 'direct_mail'],
      'yard signs':             ['yard_signs'],
      'door hangers':           ['door_hangers'],
      'truck wrap':             ['truck_wrap', 'truck'],
      'referral':               ['referral', 'word_of_mouth', 'wom'],
      'word of mouth':          ['word_of_mouth', 'wom', 'referral'],
    }
    for (const ch of channels) {
      const name = ch.name.toLowerCase()
      const aliases = manualAliases[name]
      if (aliases) for (const a of aliases) m[a] = ch.id
    }
    return m
  }, [channels])

  function getLeadChannelId(lead: Lead): string | null {
    if (lead.campaignId) return campaignChannelMap[lead.campaignId] ?? null
    if (lead.source)     return sourceToChannelId[lead.source.toLowerCase()] ?? null
    return null
  }

  // ── Period-filtered data ──────────────────────────────────────────────────

  const periodSpend = useMemo(
    () => allSpend.filter(s => s.month >= range.start && s.month <= range.end),
    [allSpend, range],
  )

  const prevSpend = useMemo(
    () => prevRange ? allSpend.filter(s => s.month >= prevRange.start && s.month <= prevRange.end) : [],
    [allSpend, prevRange],
  )

  function inRange(isoTs: string, r: DateRange): boolean {
    const ym = isoTs.slice(0, 7)
    return ym >= r.start && ym <= r.end
  }

  const periodLeads = useMemo(() => allLeads.filter(l => inRange(l.createdAt, range)), [allLeads, range])
  const prevLeads   = useMemo(() => prevRange ? allLeads.filter(l => inRange(l.createdAt, prevRange)) : [], [allLeads, prevRange])

  const periodEvents = useMemo(() => allEvents.filter(e => inRange(e.createdAt, range)), [allEvents, range])

  // Closed leads = finished_paid or finished_unpaid
  const isClosed = (l: Lead) => l.stage === 'finished_paid' || l.stage === 'finished_unpaid'

  const periodClosed = useMemo(() => periodLeads.filter(isClosed), [periodLeads])
  const prevClosed   = useMemo(() => prevLeads.filter(isClosed),   [prevLeads])

  // Returns the revenue figure for one lead.
  // isEstimated = true when no completed job has been found (so the number is
  // the quote total / estimatedValue, not a confirmed invoice amount).
  function leadRevenue(lead: Lead): { amount: number; isEstimated: boolean } {
    const completedJob = allJobs.find(j =>
      j.status === 'completed' &&
      ((lead.quoteId    && j.quoteId    === lead.quoteId) ||
       (lead.contactId  && j.contactId  === lead.contactId))
    )
    const q = allQuotes.find(q => q.id === lead.quoteId)
    const amount = q?.total ?? lead.estimatedValue ?? 0
    return { amount, isEstimated: !completedJob }
  }

  // Aggregate revenue across a list of leads.
  function revenueFor(leads: Lead[]): { total: number; hasEstimated: boolean } {
    let total = 0; let hasEstimated = false
    for (const l of leads) {
      const r = leadRevenue(l)
      total += r.amount
      if (r.isEstimated && r.amount > 0) hasEstimated = true
    }
    return { total, hasEstimated }
  }

  // ── KPI computations ──────────────────────────────────────────────────────

  const totalSpend    = useMemo(() => periodSpend.reduce((s, e) => s + e.amount, 0), [periodSpend])
  const prevTotalSpend = useMemo(() => prevSpend.reduce((s, e) => s + e.amount, 0), [prevSpend])

  const totalLeads    = periodLeads.length
  const prevTotalLeads = prevLeads.length

  const closedCount   = periodClosed.length
  const prevClosedCount = prevClosed.length

  const { total: revenue, hasEstimated: revenueIsEst } =
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useMemo(() => revenueFor(periodClosed), [periodClosed, allQuotes, allJobs])
  const { total: prevRevenue } =
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useMemo(() => revenueFor(prevClosed), [prevClosed, allQuotes, allJobs])

  const cpl           = totalLeads  > 0 && totalSpend > 0 ? totalSpend / totalLeads  : null
  const prevCpl       = prevTotalLeads > 0 && prevTotalSpend > 0 ? prevTotalSpend / prevTotalLeads : null

  const cpa           = closedCount > 0 && totalSpend > 0 ? totalSpend / closedCount : null
  const prevCpa       = prevClosedCount > 0 && prevTotalSpend > 0 ? prevTotalSpend / prevClosedCount : null

  const roi           = totalSpend > 0 ? ((revenue - totalSpend) / totalSpend) * 100 : null
  const prevRoi       = prevTotalSpend > 0 ? ((prevRevenue - prevTotalSpend) / prevTotalSpend) * 100 : null

  // Best channel: lowest CPA with ≥1 closed job
  const bestChannel = useMemo(() => {
    let best: { name: string; cpa: number } | null = null
    for (const ch of channels) {
      const chClosed = periodClosed.filter(l => getLeadChannelId(l) === ch.id)
      if (chClosed.length === 0) continue
      const chSpend = periodSpend.filter(s => s.channelId === ch.id).reduce((s, e) => s + e.amount, 0)
      if (chSpend === 0) continue
      const chCpa = chSpend / chClosed.length
      if (best === null || chCpa < best.cpa) best = { name: ch.name, cpa: chCpa }
    }
    return best?.name ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, periodClosed, periodSpend, campaignChannelMap, sourceToChannelId])

  // ── Channel performance table data ────────────────────────────────────────

  const last6Months = useMemo(() => getLast6Months(), [])

  const channelRows = useMemo(() => {
    return channels.map(ch => {
      // Spend
      const spend = periodSpend.filter(s => s.channelId === ch.id).reduce((s, e) => s + e.amount, 0)

      // Leads attributed to this channel in period
      const leads = periodLeads.filter(l => getLeadChannelId(l) === ch.id)
      const leadsCount = leads.length

      // Views = campaign_events for campaigns belonging to this channel, in period
      const chCampaignIds = new Set(allCampaigns.filter(c => c.channelId === ch.id).map(c => c.id))
      const views = periodEvents.filter(e => chCampaignIds.has(e.campaignId)).length

      // Conversion rate: leads / views %
      const convRate = views > 0 ? (leadsCount / views) * 100 : null

      // Closed jobs
      const closedLeads = leads.filter(isClosed)
      const closedJobs = closedLeads.length

      // Close rate: closed / leads %
      const closeRate = leadsCount > 0 ? (closedJobs / leadsCount) * 100 : null

      // Revenue — job-backed (real) or quote-estimated
      const { total: chRevenue, hasEstimated: chRevenueEst } = revenueFor(closedLeads)

      // Cost metrics
      const chCpl = leadsCount > 0 && spend > 0 ? spend / leadsCount  : null
      const chCpa = closedJobs > 0 && spend > 0 ? spend / closedJobs  : null
      const chRoi = spend > 0                   ? ((chRevenue - spend) / spend) * 100 : null

      // 6-month sparkline (total leads per month, channel-scoped, all leads not just period)
      const sparkline = last6Months.map(ym => ({
        v: allLeads.filter(l => l.createdAt.slice(0, 7) === ym && getLeadChannelId(l) === ch.id).length,
      }))

      return { ch, spend, leadsCount, views, convRate, closedJobs, closeRate, chRevenue, chRevenueEst, chCpl, chCpa, chRoi, sparkline }
    })
    // Only show channels with any activity (spend or leads or events)
    .filter(r => r.spend > 0 || r.leadsCount > 0 || r.views > 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, periodSpend, periodLeads, periodEvents, allCampaigns, allLeads, allQuotes, allJobs, last6Months, campaignChannelMap, sourceToChannelId])

  const sortedChannelRows = useMemo(() => {
    const rows = [...channelRows]
    const dir = sortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      switch (sortCol) {
        case 'name':      return dir * a.ch.name.localeCompare(b.ch.name)
        case 'spend':     return dir * (a.spend - b.spend)
        case 'leads':     return dir * (a.leadsCount - b.leadsCount)
        case 'views':     return dir * (a.views - b.views)
        case 'convRate':  return dir * ((a.convRate ?? -1) - (b.convRate ?? -1))
        case 'closedJobs':return dir * (a.closedJobs - b.closedJobs)
        case 'closeRate': return dir * ((a.closeRate ?? -1) - (b.closeRate ?? -1))
        case 'revenue':   return dir * (a.chRevenue - b.chRevenue)
        case 'cpl':       return dir * ((a.chCpl ?? Infinity) - (b.chCpl ?? Infinity))
        case 'cpa':       return dir * ((a.chCpa ?? Infinity) - (b.chCpa ?? Infinity))
        case 'roi':       return dir * ((a.chRoi ?? -Infinity) - (b.chRoi ?? -Infinity))
        default:          return 0
      }
    })
    return rows
  }, [channelRows, sortCol, sortDir])

  // Fast lookup of per-channel stats for the detail sheet
  const channelStatsMap = useMemo(() => {
    return Object.fromEntries(channelRows.map(r => [r.ch.id, r]))
  }, [channelRows])

  // ── Spend log data ────────────────────────────────────────────────────────

  const sortedSpendLog = useMemo(() => {
    return [...periodSpend].sort((a, b) => {
      if (b.month !== a.month) return b.month.localeCompare(a.month)
      return b.createdAt.localeCompare(a.createdAt)
    })
  }, [periodSpend])

  // Group by month for subtotals
  const spendMonths = useMemo(() => {
    const months: string[] = []
    for (const e of sortedSpendLog) {
      if (!months.includes(e.month)) months.push(e.month)
    }
    return months
  }, [sortedSpendLog])

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/marketing-spend/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/marketing-spend'] })
      setDeleteId(null)
      toast({ title: 'Entry deleted' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  // CSV export
  function exportCSV() {
    const channelMap = Object.fromEntries(channels.map(c => [c.id, c.name]))
    const rows = [
      ['Channel', 'Month', 'Amount', 'Notes'],
      ...sortedSpendLog.map(e => [
        channelMap[e.channelId] ?? e.channelId,
        e.month,
        String(e.amount),
        e.notes ?? '',
      ]),
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `spend-${range.start}-${range.end}.csv`; a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'CSV downloaded' })
  }

  // ── Campaign mutations ────────────────────────────────────────────────────

  const updateCampaignMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
      apiRequest('PATCH', `/campaigns/${id}`, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/campaigns'] })
      toast({ title: 'Campaign updated' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  // ── Per-campaign metrics ──────────────────────────────────────────────────

  function campaignMetrics(cam: Campaign): CampaignMetrics {
    const views = allEvents.filter(e => e.campaignId === cam.id).length
    const campLeads = allLeads.filter(l => l.campaignId === cam.id)
    const leads = campLeads.length
    const closedLeads = campLeads.filter(isClosed)
    const closed = closedLeads.length

    // Spend = sum of channel spend during the campaign's date range
    let spend = 0
    if (cam.channelId && (cam.startDate || cam.endDate)) {
      const startYM = cam.startDate ? cam.startDate.slice(0, 7) : '0000-01'
      const endYM   = cam.endDate   ? cam.endDate.slice(0, 7)   : thisMonthStr()
      spend = allSpend
        .filter(s => s.channelId === cam.channelId && s.month >= startYM && s.month <= endYM)
        .reduce((sum, s) => sum + s.amount, 0)
    }

    const { total: revenue, hasEstimated: revenueIsEst } = revenueFor(closedLeads)
    const cpl = leads  > 0 && spend > 0 ? spend / leads  : null
    const cpa = closed > 0 && spend > 0 ? spend / closed : null
    const roi = spend  > 0              ? ((revenue - spend) / spend) * 100 : null
    return { views, leads, closed, spend, revenue, revenueIsEst, cpl, cpa, roi }
  }

  // ── Filtered campaigns for section 4 ─────────────────────────────────────

  const filteredCampaigns = useMemo(() => {
    if (campaignFilter === 'all') return allCampaigns
    return allCampaigns.filter(c => c.status === campaignFilter)
  }, [allCampaigns, campaignFilter])

  // ── Type badge helper ─────────────────────────────────────────────────────

  const TYPE_BADGE: Record<string, string> = {
    digital:  'bg-blue-500/10 text-blue-600 border-blue-500/20',
    print:    'bg-amber-500/10 text-amber-600 border-amber-500/20',
    referral: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    other:    'bg-muted text-muted-foreground border-border',
  }

  const isLoading = loadingChannels || loadingSpend

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Marketing</h2>
        </div>
      </div>

      <div className="p-4 space-y-6 pb-12">

        {/* ── Period selector ──────────────────────────────────────────── */}
        <div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
              <Button
                key={p}
                size="sm"
                variant={preset === p ? 'default' : 'outline'}
                className="shrink-0 h-8 text-xs px-3"
                onClick={() => setPreset(p)}
              >
                {PRESET_LABELS[p]}
              </Button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex gap-2 mt-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input type="month" className="mt-0.5 h-8 text-sm" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input type="month" className="mt-0.5 h-8 text-sm" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            </div>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {range.start === range.end
              ? monthLabel(range.start)
              : `${monthLabel(range.start)} – ${monthLabel(range.end)}`}
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 1 — KPI Bar                                           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Performance</h3>
          {isLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="shrink-0 w-[160px] h-[88px] rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:flex sm:overflow-x-auto sm:pb-1">
              <KpiCard
                title="Total Spend"
                icon={<DollarSign className="h-3.5 w-3.5" />}
                value={totalSpend}
                prev={prevTotalSpend}
                kind="currency"
                lowerIsBetter
              />
              <KpiCard
                title="Total Leads"
                icon={<Users className="h-3.5 w-3.5" />}
                value={totalLeads}
                prev={prevTotalLeads}
                kind="number"
              />
              <KpiCard
                title="Closed Jobs"
                icon={<Briefcase className="h-3.5 w-3.5" />}
                value={closedCount}
                prev={prevClosedCount}
                kind="number"
              />
              <KpiCard
                title="Revenue"
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                value={revenue}
                prev={prevRevenue}
                kind="currency"
                isEstimated={revenueIsEst}
              />
              <KpiCard
                title="Blended CPL"
                icon={<Target className="h-3.5 w-3.5" />}
                value={cpl}
                prev={prevCpl}
                kind="currency"
                lowerIsBetter
              />
              <KpiCard
                title="Blended CPA"
                icon={<Target className="h-3.5 w-3.5" />}
                value={cpa}
                prev={prevCpa}
                kind="currency"
                lowerIsBetter
              />
              <KpiCard
                title="Blended ROI"
                icon={<BarChart2 className="h-3.5 w-3.5" />}
                value={roi}
                prev={prevRoi}
                kind="percent"
              />
              <TextKpiCard
                title="Best Channel"
                icon={<Award className="h-3.5 w-3.5" />}
                value={bestChannel}
              />
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 2 — Channel Performance Table                         */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Channel Performance</h3>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                </div>
              ) : sortedChannelRows.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium">No channel activity yet</p>
                  <p className="text-xs mt-1">Add spend entries or tag leads with a source to see data here</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        {/* Channel name — left aligned */}
                        <th
                          className="px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground"
                          onClick={() => handleSort('name')}
                        >
                          <span className="inline-flex items-center gap-0.5">
                            Channel
                            {sortCol === 'name'
                              ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
                              : <ChevronDown className="h-3 w-3 opacity-30" />}
                          </span>
                        </th>
                        <SortTh col="spend"      label="Spend"    active={sortCol==='spend'}      dir={sortDir} onSort={handleSort} />
                        <SortTh col="leads"      label="Leads"    active={sortCol==='leads'}      dir={sortDir} onSort={handleSort} />
                        <SortTh col="views"      label="Views"    active={sortCol==='views'}      dir={sortDir} onSort={handleSort} />
                        <SortTh col="convRate"   label="Conv%"    active={sortCol==='convRate'}   dir={sortDir} onSort={handleSort} />
                        <SortTh col="closedJobs" label="Closed"   active={sortCol==='closedJobs'} dir={sortDir} onSort={handleSort} />
                        <SortTh col="closeRate"  label="Close%"   active={sortCol==='closeRate'}  dir={sortDir} onSort={handleSort} />
                        <SortTh col="revenue"    label="Revenue"  active={sortCol==='revenue'}    dir={sortDir} onSort={handleSort} />
                        <SortTh col="cpl"        label="CPL"      active={sortCol==='cpl'}        dir={sortDir} onSort={handleSort} />
                        <SortTh col="cpa"        label="CPA"      active={sortCol==='cpa'}        dir={sortDir} onSort={handleSort} />
                        <SortTh col="roi"        label="ROI"      active={sortCol==='roi'}        dir={sortDir} onSort={handleSort} />
                        <th className="px-3 py-2.5 text-right text-[11px] font-medium text-muted-foreground whitespace-nowrap">6M Leads</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedChannelRows.map(({ ch, spend, leadsCount, views, convRate, closedJobs, closeRate, chRevenue, chCpl, chCpa, chRoi, sparkline }) => (
                        <tr
                          key={ch.id}
                          className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={e => {
                            // Don't open detail if clicking spend cell button
                            if ((e.target as HTMLElement).closest('[data-spend-cell]')) return
                            setDetailChannel(ch)
                          }}
                        >
                          {/* Channel name + type badge */}
                          <td className="px-3 py-2.5 min-w-[140px]">
                            <div className="font-medium leading-tight">{ch.name}</div>
                            <Badge variant="outline" className={`mt-0.5 text-[10px] px-1 py-0 h-4 ${TYPE_BADGE[ch.type] ?? TYPE_BADGE.other}`}>
                              {ch.type}
                            </Badge>
                          </td>
                          {/* Spend — click to edit */}
                          <td className="px-3 py-2.5 text-right" data-spend-cell="">
                            <button
                              className="font-medium hover:text-primary hover:underline transition-colors"
                              onClick={e => {
                                e.stopPropagation()
                                setSpendChannelPreset(ch.id)
                                setEditSpend(undefined)
                                setShowAddSpend(true)
                              }}
                            >
                              {spend > 0 ? fmtCurrency(spend) : <span className="text-muted-foreground/60">+ add</span>}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right">{leadsCount || '—'}</td>
                          <td className="px-3 py-2.5 text-right">{views || '—'}</td>
                          <td className="px-3 py-2.5 text-right">
                            {convRate !== null ? `${convRate.toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">{closedJobs || '—'}</td>
                          <td className="px-3 py-2.5 text-right">
                            {closeRate !== null ? (
                              <span className={closeRate >= 50 ? 'text-emerald-600' : closeRate >= 25 ? 'text-amber-600' : 'text-red-500'}>
                                {closeRate.toFixed(0)}%
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium">
                            {chRevenue > 0
                              ? <>{chRevenueEst && <span className="text-muted-foreground/50 mr-0.5" title="Estimate">~</span>}{fmtCurrency(chRevenue)}</>
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {chCpl !== null ? fmtCurrency(chCpl) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {chCpa !== null ? fmtCurrency(chCpa) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {chRoi !== null ? (
                              <span className={chRoi >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                                {fmtPct(chRoi)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex justify-end">
                              <SparklineChart data={sparkline} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 3 — Spend Log                                         */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Spend Log</h3>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2" onClick={exportCSV} disabled={sortedSpendLog.length === 0}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => { setEditSpend(undefined); setSpendChannelPreset(undefined); setShowAddSpend(true) }}>
                <Plus className="h-3.5 w-3.5" /> Add Spend
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                </div>
              ) : sortedSpendLog.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <DollarSign className="h-7 w-7 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No spend recorded for this period</p>
                  <Button
                    size="sm" variant="outline" className="mt-3 h-7 text-xs gap-1"
                    onClick={() => { setEditSpend(undefined); setSpendChannelPreset(undefined); setShowAddSpend(true) }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add your first entry
                  </Button>
                </div>
              ) : (
                <div>
                  {spendMonths.map(month => {
                    const monthEntries = sortedSpendLog.filter(e => e.month === month)
                    const subtotal = monthEntries.reduce((s, e) => s + e.amount, 0)
                    const channelMap = Object.fromEntries(channels.map(c => [c.id, c.name]))

                    return (
                      <div key={month}>
                        {/* Month header */}
                        <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b">
                          <span className="text-xs font-semibold">{monthLabel(month)}</span>
                          <span className="text-xs font-bold tabular-nums">{fmtCurrency(subtotal)}</span>
                        </div>
                        {/* Entries */}
                        {monthEntries.map(entry => (
                          <div
                            key={entry.id}
                            className="flex items-center gap-2 px-4 py-3 border-b last:border-0 hover:bg-muted/20 group transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {channelMap[entry.channelId] ?? '—'}
                              </div>
                              {entry.notes && (
                                <div className="text-xs text-muted-foreground truncate mt-0.5">{entry.notes}</div>
                              )}
                            </div>
                            <span className="text-sm font-semibold tabular-nums shrink-0">{fmtCurrency(entry.amount)}</span>
                            <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => { setEditSpend(entry); setSpendChannelPreset(undefined); setShowAddSpend(true) }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteId(entry.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 4 — Campaign Manager                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Campaigns</h3>
            <Button size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => { setEditCampaign(null); setShowNewCampaign(true) }}>
              <Plus className="h-3.5 w-3.5" /> New Campaign
            </Button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-0.5 scrollbar-hide">
            {(['all', 'active', 'paused', 'ended'] as const).map(f => (
              <Button
                key={f}
                size="sm"
                variant={campaignFilter === f ? 'default' : 'outline'}
                className="shrink-0 h-7 text-xs px-3 capitalize"
                onClick={() => setCampaignFilter(f)}
              >
                {f}
                {f !== 'all' && (
                  <span className="ml-1 opacity-60">
                    ({allCampaigns.filter(c => c.status === f).length})
                  </span>
                )}
              </Button>
            ))}
          </div>

          {filteredCampaigns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <QrCode className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">
                  {campaignFilter === 'all' ? 'No campaigns yet' : `No ${campaignFilter} campaigns`}
                </p>
                {campaignFilter === 'all' && (
                  <Button size="sm" variant="outline" className="mt-3 h-7 text-xs gap-1"
                    onClick={() => { setEditCampaign(null); setShowNewCampaign(true) }}>
                    <Plus className="h-3.5 w-3.5" /> Create your first campaign
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCampaigns.map(cam => {
                const ch = channels.find(c => c.id === cam.channelId)
                const metrics = campaignMetrics(cam)
                return (
                  <CampaignCard
                    key={cam.id}
                    campaign={cam}
                    channel={ch}
                    metrics={metrics}
                    onEdit={() => { setEditCampaign(cam); setShowNewCampaign(true) }}
                    onStatusToggle={() => updateCampaignMutation.mutate({
                      id: cam.id,
                      updates: { status: cam.status === 'active' ? 'paused' : 'active' },
                    })}
                    onArchive={() => updateCampaignMutation.mutate({
                      id: cam.id,
                      updates: { status: 'ended' },
                    })}
                  />
                )
              })}
            </div>
          )}
        </section>

      </div>

      {/* ── Spend Entry Sheet ────────────────────────────────────────────── */}
      <SpendEntrySheet
        open={showAddSpend}
        onClose={() => { setShowAddSpend(false); setEditSpend(undefined); setSpendChannelPreset(undefined) }}
        channels={channels}
        initialChannelId={spendChannelPreset}
        initialMonth={range.end}
        editEntry={editSpend}
      />

      {/* ── Campaign Sheet ───────────────────────────────────────────────── */}
      <CampaignSheet
        open={showNewCampaign}
        onClose={() => { setShowNewCampaign(false); setEditCampaign(null) }}
        channels={channels}
        editCampaign={editCampaign}
      />

      {/* ── Channel Detail Sheet ─────────────────────────────────────────── */}
      <ChannelDetailSheet
        channel={detailChannel}
        onClose={() => setDetailChannel(null)}
        stats={detailChannel ? (channelStatsMap[detailChannel.id] ?? null) : null}
        channelCampaigns={detailChannel ? allCampaigns.filter(c => c.channelId === detailChannel.id) : []}
      />

      {/* ── Delete confirmation ──────────────────────────────────────────── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle className="text-base">Delete spend entry?</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">This cannot be undone.</p>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deleteId)}
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  )
}
