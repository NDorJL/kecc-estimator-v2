import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/queryClient'
import { Quote, Subscription } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TrendingUp, FileText, CalendarCheck, DollarSign,
  Users, Target, BookOpen, BarChart2,
  MessageSquare, CheckCircle2, PenLine, X, Bell, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useLocation } from 'wouter'

// ── Notification store (localStorage-based dismiss) ──────────────────────────

const DISMISSED_KEY = 'dashboard_dismissed_notifications'

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch { return new Set() }
}

function persistDismissed(ids: Set<string>) {
  // Only keep last 50 to prevent unbounded growth
  const arr = Array.from(ids).slice(-50)
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr))
}

// ── Notification types ───────────────────────────────────────────────────────

interface AppNotification {
  id: string
  type: 'signed' | 'open_quote' | 'info'
  title: string
  subtitle: string
  icon: React.ElementType
  colorClass: string
  path: string
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  loading,
  onClick,
}: {
  title: string
  value: string
  sub?: string
  icon: React.ElementType
  loading?: boolean
  onClick?: () => void
}) {
  return (
    <Card
      className={onClick ? 'cursor-pointer active:scale-95 transition-transform hover:bg-muted/40' : ''}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <>
            <p className="text-[2rem] font-black tracking-tight leading-none mt-0.5 tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

const quickNavItems = [
  { label: 'Contacts',   path: '/contacts',  icon: Users },
  { label: 'Open Jobs',  path: '/jobs',      icon: CalendarCheck },
  { label: 'Leads',      path: '/leads',     icon: Target },
  { label: 'Price Book', path: '/pricebook', icon: BookOpen },
  { label: 'Finance',    path: '/finance',   icon: DollarSign },
  { label: 'Reports',    path: '/finance',   icon: BarChart2 },
  { label: 'Send SMS',   path: '/contacts',  icon: MessageSquare },
] as const

export default function Dashboard() {
  const [, navigate] = useLocation()
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed)
  const [notifExpanded, setNotifExpanded] = useState(true)

  const { data: quotes, isLoading: quotesLoading } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
  })

  const { data: subs, isLoading: subsLoading } = useQuery<Subscription[]>({
    queryKey: ['/subscriptions'],
    queryFn: () => apiGet('/subscriptions'),
  })

  const loading = quotesLoading || subsLoading

  // MRR from active subscriptions
  const mrr = (subs ?? [])
    .filter(s => s.status === 'ACTIVE')
    .reduce((sum, s) => sum + s.inSeasonMonthlyTotal, 0)

  // Open quotes (draft + sent)
  const openQuotes = (quotes ?? []).filter(q => q.status === 'draft' || q.status === 'sent')
  const openQuotesValue = openQuotes.reduce((sum, q) => sum + q.total, 0)

  // Active subs count
  const activeSubs = (subs ?? []).filter(s => s.status === 'ACTIVE').length

  // Recently signed quotes (last 7 days)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const recentlySigned = (quotes ?? []).filter(
    q => q.signedAt && new Date(q.signedAt) >= sevenDaysAgo
  ).sort((a, b) => new Date(b.signedAt!).getTime() - new Date(a.signedAt!).getTime())

  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`

  // Build notification list from real data
  const notifications: AppNotification[] = [
    ...recentlySigned.map(q => ({
      id: `signed-${q.id}`,
      type: 'signed' as const,
      title: `${q.customerName} signed their quote`,
      subtitle: `${fmt(q.total)} · ${new Date(q.signedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      icon: CheckCircle2,
      colorClass: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
      path: '/quotes',
    })),
  ]

  const visible = notifications.filter(n => !dismissed.has(n.id))

  function dismiss(id: string) {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(id)
      persistDismissed(next)
      return next
    })
  }

  function dismissAll() {
    setDismissed(prev => {
      const next = new Set(prev)
      for (const n of notifications) next.add(n.id)
      persistDismissed(next)
      return next
    })
  }

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-xl font-bold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Overview of your business</p>
      </div>

      {/* Notification Bar */}
      {!quotesLoading && visible.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
            <button
              className="flex items-center gap-1.5 text-sm font-semibold"
              onClick={() => setNotifExpanded(e => !e)}
            >
              <Bell className="h-4 w-4 text-primary" />
              <span>Notifications</span>
              <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs font-bold w-5 h-5 flex items-center justify-center">
                {visible.length}
              </span>
              {notifExpanded
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-1" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" />
              }
            </button>
            <button
              onClick={dismissAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>

          {/* Notifications */}
          {notifExpanded && (
            <div className="divide-y divide-border">
              {visible.map(n => (
                <div key={n.id} className={`flex items-start gap-3 p-3 ${n.colorClass}`}>
                  <button
                    onClick={() => navigate(n.path)}
                    className="flex items-start gap-3 flex-1 min-w-0 text-left"
                  >
                    <n.icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{n.title}</p>
                      <p className="text-xs opacity-80 mt-0.5">{n.subtitle}</p>
                    </div>
                    <PenLine className="h-3.5 w-3.5 opacity-50 mt-0.5 shrink-0" />
                  </button>
                  <button
                    onClick={() => dismiss(n.id)}
                    className="shrink-0 ml-1 rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-black/10 transition-all"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          title="Monthly Recurring"
          value={loading ? '—' : fmt(mrr)}
          sub="active subscriptions"
          icon={TrendingUp}
          loading={loading}
          onClick={() => navigate('/finance')}
        />
        <KpiCard
          title="Open Quotes"
          value={loading ? '—' : String(openQuotes.length)}
          sub={loading ? '' : `${fmt(openQuotesValue)} pipeline`}
          icon={FileText}
          loading={loading}
          onClick={() => navigate('/quotes')}
        />
        <KpiCard
          title="Active Subscriptions"
          value={loading ? '—' : String(activeSubs)}
          sub="in season"
          icon={CalendarCheck}
          loading={loading}
          onClick={() => navigate('/subscriptions')}
        />
        <KpiCard
          title="Invoices"
          value="—"
          sub="Phase 4"
          icon={DollarSign}
          loading={false}
          onClick={() => navigate('/finance')}
        />
      </div>

      {/* Quick Nav Grid */}
      <div>
        <h3 className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider">Navigate</h3>
        <div className="grid grid-cols-4 gap-2">
          {quickNavItems.map(({ label, path, icon: Icon }) => (
            <button
              key={label}
              onClick={() => navigate(path)}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-3 text-center hover:bg-muted/50 active:scale-95 transition-all"
            >
              <Icon className="h-5 w-5 text-primary" />
              <span className="text-xs font-medium leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Open Quotes */}
      {!quotesLoading && openQuotes.length > 0 && (
        <div>
          <h3 className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider">Open Quotes</h3>
          <div className="space-y-2">
            {openQuotes.slice(0, 5).map(q => (
              <button
                key={q.id}
                onClick={() => navigate('/quotes')}
                className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/50 active:scale-95 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{q.customerName}</span>
                  <span className="text-sm font-bold">${q.total.toFixed(0)}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-muted-foreground capitalize">{q.status}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(q.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
