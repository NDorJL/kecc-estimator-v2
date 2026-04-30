import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiRequest } from '@/lib/queryClient'
import type { Lead, Quote } from '@/types'
import {
  DollarSign, TrendingUp, TrendingDown, ChevronLeft, ChevronRight,
  Download, Target, Megaphone,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface SpendEntry {
  id: string
  channel: string
  amount: number
  month: string  // 'YYYY-MM-01'
  notes: string | null
  createdAt: string
}

// ── Marketing channel definitions ────────────────────────────────────────────

const CHANNELS = [
  { id: 'google_ads',       label: 'Google Ads' },
  { id: 'google_lsa',       label: 'Google LSA' },
  { id: 'seo_organic',      label: 'SEO / Organic' },
  { id: 'facebook_ads',     label: 'Facebook Ads' },
  { id: 'instagram_ads',    label: 'Instagram Ads' },
  { id: 'social_organic',   label: 'Social Media (Organic)' },
  { id: 'mailers',          label: 'Mailers / Direct Mail' },
  { id: 'yard_signs',       label: 'Yard Signs' },
  { id: 'door_hangers',     label: 'Door Hangers' },
  { id: 'referral',         label: 'Word of Mouth / Referrals' },
  { id: 'nextdoor',         label: 'Nextdoor' },
  { id: 'thumbtack',        label: 'Thumbtack' },
  { id: 'yelp_ads',         label: 'Yelp Ads' },
  { id: 'email_marketing',  label: 'Email Marketing' },
  { id: 'community',        label: 'Community Sponsorship' },
  { id: 'other',            label: 'Other' },
]

// Map channel id → lead source tags that match (for cross-referencing leads)
const CHANNEL_TO_SOURCE: Record<string, string[]> = {
  google_ads:     ['google_ads', 'google'],
  google_lsa:     ['google_lsa', 'google'],
  seo_organic:    ['seo_organic', 'seo', 'website', 'organic'],
  facebook_ads:   ['facebook_ads', 'facebook', 'social'],
  instagram_ads:  ['instagram_ads', 'instagram', 'social'],
  social_organic: ['social_organic', 'social', 'social_media'],
  mailers:        ['mailers', 'direct_mail'],
  yard_signs:     ['yard_signs'],
  door_hangers:   ['door_hangers'],
  referral:       ['referral', 'word_of_mouth'],
  nextdoor:       ['nextdoor'],
  thumbtack:      ['thumbtack'],
  yelp_ads:       ['yelp', 'yelp_ads'],
  email_marketing:['email_marketing', 'email'],
  community:      ['community', 'sponsorship'],
  other:          ['other', 'cold_call', 'inbound_sms'],
}

// Chart colors (one per channel, cycles)
const CHART_COLORS = [
  '#1B4332', '#2D6A4F', '#40916C', '#52B788', '#74C69D',
  '#95D5B2', '#B7E4C7', '#D8F3DC', '#1d3557', '#457b9d',
  '#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#264653', '#6d6875',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMonthString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function prevMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return toMonthString(d)
}

function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m, 1)
  return toMonthString(d)
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Marketing() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const [selectedMonth, setSelectedMonth] = useState<string>(toMonthString(new Date()))
  const [budgetDraft, setBudgetDraft] = useState<string>('')
  const [editingBudget, setEditingBudget] = useState(false)

  // ── Budget ──────────────────────────────────────────────────────────────────
  const { data: budgetData } = useQuery<{ monthlyBudget: number }>({
    queryKey: ['marketing-budget'],
    queryFn: () => apiGet('/.netlify/functions/marketing-spend?action=budget'),
  })
  const monthlyBudget = budgetData?.monthlyBudget ?? 0

  const saveBudgetMutation = useMutation({
    mutationFn: (v: number) =>
      apiRequest('PATCH', '/.netlify/functions/marketing-spend?action=budget', { monthlyBudget: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketing-budget'] })
      setEditingBudget(false)
      toast({ title: 'Budget saved' })
    },
  })

  // ── Spend entries for selected month ────────────────────────────────────────
  const { data: spendEntries = [] } = useQuery<SpendEntry[]>({
    queryKey: ['marketing-spend', selectedMonth],
    queryFn: () => apiGet(`/.netlify/functions/marketing-spend?month=${selectedMonth}`),
  })

  // Build a map: channel → amount for fast lookup
  const spendByChannel = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of spendEntries) {
      const ch = e.channel
      m[ch] = (m[ch] ?? 0) + Number(e.amount)
    }
    return m
  }, [spendEntries])

  const totalSpend = useMemo(() =>
    Object.values(spendByChannel).reduce((a, b) => a + b, 0), [spendByChannel])

  // ── Save spend entry ─────────────────────────────────────────────────────────
  const saveSpendMutation = useMutation({
    mutationFn: ({ channel, amount }: { channel: string; amount: number }) =>
      apiRequest('POST', '/.netlify/functions/marketing-spend', {
        channel,
        amount,
        month: selectedMonth,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketing-spend', selectedMonth] })
    },
    onError: () => toast({ title: 'Failed to save', variant: 'destructive' }),
  })

  // Local draft state for inline editing
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>({})

  function getDraftValue(channelId: string): string {
    if (channelId in draftAmounts) return draftAmounts[channelId]
    const existing = spendByChannel[channelId]
    return existing ? String(existing) : ''
  }

  function handleBlurChannel(channelId: string) {
    const raw = draftAmounts[channelId]
    if (raw === undefined) return  // no change
    const val = parseFloat(raw) || 0
    const current = spendByChannel[channelId] ?? 0
    if (val !== current) {
      saveSpendMutation.mutate({ channel: channelId, amount: val })
    }
    setDraftAmounts(prev => { const n = { ...prev }; delete n[channelId]; return n })
  }

  // ── Leads & Quotes for effectiveness ─────────────────────────────────────────
  const { data: allLeads = [] } = useQuery<Lead[]>({
    queryKey: ['/leads'],
    queryFn: () => apiGet('/leads'),
  })
  const { data: allQuotes = [] } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
  })

  // Effectiveness table: per channel — leads, spend, CPL, quotes sent, win rate, est revenue
  const effectivenessData = useMemo(() => {
    return CHANNELS.map(ch => {
      const sourceTags = CHANNEL_TO_SOURCE[ch.id] ?? [ch.id]
      const channelLeads = allLeads.filter(l => l.source && sourceTags.includes(l.source))
      const leadsCount = channelLeads.length
      const quotesFromLeads = allQuotes.filter(q =>
        channelLeads.some(l => l.quoteId === q.id)
      )
      const quotesSent = quotesFromLeads.filter(q => q.status === 'sent' || q.status === 'accepted').length
      const quotesAccepted = quotesFromLeads.filter(q => q.status === 'accepted').length
      const winRate = quotesSent > 0 ? Math.round((quotesAccepted / quotesSent) * 100) : null
      const estRevenue = quotesFromLeads
        .filter(q => q.status === 'accepted')
        .reduce((sum, q) => sum + (q.total ?? 0), 0)
      const spend = spendByChannel[ch.id] ?? 0
      const cpl = leadsCount > 0 ? spend / leadsCount : null

      return { ...ch, leadsCount, quotesSent, quotesAccepted, winRate, estRevenue, spend, cpl }
    }).filter(row => row.leadsCount > 0 || row.spend > 0)
  }, [allLeads, allQuotes, spendByChannel])

  // ── ROI per channel ──────────────────────────────────────────────────────────
  const roiData = useMemo(() => {
    return effectivenessData
      .filter(row => row.spend > 0)
      .map(row => {
        const roi = row.estRevenue / row.spend
        return { ...row, roi }
      })
      .sort((a, b) => b.roi - a.roi)
  }, [effectivenessData])

  // ── Pie chart data ────────────────────────────────────────────────────────────
  const pieData = useMemo(() =>
    CHANNELS
      .filter(ch => (spendByChannel[ch.id] ?? 0) > 0)
      .map((ch, i) => ({
        name: ch.label,
        value: spendByChannel[ch.id] ?? 0,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [spendByChannel]
  )

  // ── Historical spend (last 6 months) ─────────────────────────────────────────
  // We only have current month loaded; for the bar chart we'd need to load more months.
  // Simple approach: query last 6 months worth of entries.
  const last6Months = useMemo(() => {
    const months = []
    const [y, m] = selectedMonth.split('-').map(Number)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1)
      months.push(toMonthString(d))
    }
    return months
  }, [selectedMonth])

  const { data: historicalEntries = [] } = useQuery<SpendEntry[]>({
    queryKey: ['marketing-spend-history', last6Months[0], last6Months[5]],
    queryFn: async () => {
      const results = await Promise.all(
        last6Months.map(mo => apiGet<SpendEntry[]>(`/.netlify/functions/marketing-spend?month=${mo}`))
      )
      return results.flat()
    },
  })

  const historicalChartData = useMemo(() => {
    return last6Months.map(mo => {
      const monthEntries = historicalEntries.filter(e => e.month.startsWith(mo))
      const total = monthEntries.reduce((sum, e) => sum + Number(e.amount), 0)
      return { month: monthLabel(mo), total }
    })
  }, [last6Months, historicalEntries])

  // ── Generate Report (text export) ────────────────────────────────────────────
  function generateReport() {
    const lines: string[] = []
    lines.push(`MARKETING REPORT — ${monthLabel(selectedMonth).toUpperCase()}`)
    lines.push('='.repeat(50))
    lines.push('')
    lines.push(`Monthly Budget:   ${fmt(monthlyBudget)}`)
    lines.push(`Total Spend:      ${fmt(totalSpend)}`)
    const diff = monthlyBudget - totalSpend
    lines.push(`Over/Under:       ${diff >= 0 ? `Under by ${fmt(diff)}` : `Over by ${fmt(Math.abs(diff))}`}`)
    lines.push('')
    lines.push('SPEND BY CHANNEL')
    lines.push('-'.repeat(40))
    for (const ch of CHANNELS) {
      const amt = spendByChannel[ch.id]
      if (amt && amt > 0) {
        lines.push(`  ${ch.label.padEnd(28)} ${fmt(amt).padStart(10)}`)
      }
    }
    lines.push('')
    lines.push('CHANNEL EFFECTIVENESS')
    lines.push('-'.repeat(40))
    for (const row of effectivenessData) {
      if (row.leadsCount === 0 && row.spend === 0) continue
      lines.push(`  ${row.label}`)
      lines.push(`    Leads: ${row.leadsCount}  |  Spend: ${fmt(row.spend)}  |  CPL: ${row.cpl != null ? fmt(row.cpl) : 'N/A'}`)
      lines.push(`    Quotes Sent: ${row.quotesSent}  |  Win Rate: ${row.winRate != null ? row.winRate + '%' : 'N/A'}  |  Revenue: ${fmt(row.estRevenue)}`)
    }
    lines.push('')
    lines.push('ROI TRACKER')
    lines.push('-'.repeat(40))
    for (const row of roiData) {
      const roiStr = row.roi >= 100 ? '∞' : `${row.roi.toFixed(1)}×`
      lines.push(`  ${row.label.padEnd(28)} ROI: ${roiStr}`)
    }
    lines.push('')
    lines.push(`Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}`)

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `marketing-report-${selectedMonth}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Report downloaded' })
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const budgetPct = monthlyBudget > 0 ? Math.min((totalSpend / monthlyBudget) * 100, 100) : 0
  const budgetDiff = monthlyBudget - totalSpend
  const isOver = budgetDiff < 0

  const isCurrentOrFuture = selectedMonth >= toMonthString(new Date())

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Marketing</h2>
        </div>
        <Button size="sm" variant="outline" onClick={generateReport} className="gap-1.5">
          <Download className="h-4 w-4" />
          Export Report
        </Button>
      </div>

      <div className="p-4 space-y-5 pb-8">

        {/* ── Month selector ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedMonth(prevMonth(selectedMonth))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-base min-w-[120px] text-center">{monthLabel(selectedMonth)}</span>
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => setSelectedMonth(nextMonth(selectedMonth))}
            disabled={isCurrentOrFuture}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* ── A. Budget overview ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Target className="h-4 w-4" /> Monthly Budget</span>
              {!editingBudget && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                  setBudgetDraft(String(monthlyBudget || ''))
                  setEditingBudget(true)
                }}>
                  {monthlyBudget > 0 ? 'Edit' : 'Set Budget'}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editingBudget ? (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Monthly Budget ($)</Label>
                  <Input
                    type="number"
                    className="mt-1"
                    value={budgetDraft}
                    onChange={e => setBudgetDraft(e.target.value)}
                    placeholder="e.g. 1500"
                    autoFocus
                  />
                </div>
                <Button size="sm" onClick={() => saveBudgetMutation.mutate(parseFloat(budgetDraft) || 0)} disabled={saveBudgetMutation.isPending}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingBudget(false)}>Cancel</Button>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-semibold">{fmt(totalSpend)}</span>
                </div>
                {monthlyBudget > 0 && (
                  <>
                    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-2.5 rounded-full transition-all ${isOver ? 'bg-destructive' : budgetPct > 80 ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${budgetPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Budget: {fmt(monthlyBudget)}</span>
                      <span className={isOver ? 'text-destructive font-semibold' : 'text-emerald-600 font-semibold'}>
                        {isOver
                          ? `Over by ${fmt(Math.abs(budgetDiff))}`
                          : `Under by ${fmt(budgetDiff)}`}
                      </span>
                    </div>
                  </>
                )}
                {monthlyBudget === 0 && (
                  <p className="text-xs text-muted-foreground">No budget set for this month.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ── B. Spend by channel ──────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <DollarSign className="h-4 w-4" /> Spend by Channel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {CHANNELS.map(ch => (
              <div key={ch.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm truncate">{ch.label}</span>
                <div className="relative w-28">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
                  <Input
                    type="number"
                    className="pl-5 h-8 text-sm"
                    placeholder="0"
                    value={getDraftValue(ch.id)}
                    onChange={e => setDraftAmounts(prev => ({ ...prev, [ch.id]: e.target.value }))}
                    onBlur={() => handleBlurChannel(ch.id)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    min="0"
                    step="1"
                  />
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 border-t mt-2">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-sm font-bold">{fmt(totalSpend)}</span>
            </div>
          </CardContent>
        </Card>

        {/* ── Pie chart: spend ratio ────────────────────────────────────────── */}
        {pieData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Spend Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                  <Legend
                    iconSize={10}
                    formatter={(value) => <span className="text-xs">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ── Month-over-month bar chart ────────────────────────────────────── */}
        {historicalChartData.some(d => d.total > 0) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Monthly Spend (Last 6 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={historicalChartData} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Total Spend" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ── C. Lead source effectiveness ─────────────────────────────────── */}
        {effectivenessData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Lead Source Effectiveness</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Channel</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Leads</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Spend</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">CPL</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Quotes</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Win%</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectivenessData.map(row => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium">{row.label}</td>
                        <td className="px-3 py-2 text-right">{row.leadsCount}</td>
                        <td className="px-3 py-2 text-right">{row.spend > 0 ? fmt(row.spend) : '—'}</td>
                        <td className="px-3 py-2 text-right">{row.cpl != null ? fmt(row.cpl) : '—'}</td>
                        <td className="px-3 py-2 text-right">{row.quotesSent}</td>
                        <td className="px-3 py-2 text-right">
                          {row.winRate != null ? (
                            <span className={row.winRate >= 50 ? 'text-emerald-600' : row.winRate >= 25 ? 'text-amber-600' : 'text-destructive'}>
                              {row.winRate}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">{row.estRevenue > 0 ? fmt(row.estRevenue) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── D. ROI tracker ───────────────────────────────────────────────── */}
        {roiData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" /> ROI Tracker
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {roiData.map(row => {
                const roiDisplay = row.roi >= 100 ? '∞' : `${row.roi.toFixed(1)}×`
                const isGreen  = row.roi >= 3
                const isYellow = row.roi >= 1 && row.roi < 3
                return (
                  <div key={row.id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm truncate">{row.label}</span>
                    <span className="text-xs text-muted-foreground">{fmt(row.estRevenue)} / {fmt(row.spend)}</span>
                    <Badge
                      className={`text-xs font-bold min-w-[48px] justify-center ${
                        isGreen  ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                        isYellow ? 'bg-amber-100 text-amber-800 border-amber-300' :
                                   'bg-red-100 text-red-800 border-red-300'
                      }`}
                      variant="outline"
                    >
                      {isGreen ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                      {roiDisplay}
                    </Badge>
                  </div>
                )
              })}
              <p className="text-[10px] text-muted-foreground pt-1">
                Green ≥3× · Yellow 1–3× · Red &lt;1× return on spend
              </p>
            </CardContent>
          </Card>
        )}

        {effectivenessData.length === 0 && roiData.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>Enter spend above and tag leads with their source</p>
            <p className="text-xs mt-1">Effectiveness data will appear once leads are linked to channels</p>
          </div>
        )}

      </div>
    </div>
  )
}
