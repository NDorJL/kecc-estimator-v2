import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/queryClient'
import { Quote, Subscription } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TrendingUp, FileText, CalendarCheck, DollarSign,
  Users, Target, BookOpen, BarChart2,
  MessageSquare, CheckCircle2, PenLine,
} from 'lucide-react'
import { useLocation } from 'wouter'

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
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
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

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Overview of your business</p>
      </div>

      {/* Recently Signed Notifications */}
      {!quotesLoading && recentlySigned.length > 0 && (
        <div className="space-y-2">
          {recentlySigned.map(q => (
            <button
              key={q.id}
              onClick={() => navigate('/quotes')}
              className="w-full flex items-start gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-left hover:bg-green-500/20 active:scale-95 transition-all"
            >
              <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-green-700 dark:text-green-400 truncate">
                  {q.customerName} signed their quote
                </p>
                <p className="text-xs text-green-600/80 dark:text-green-500/80">
                  {fmt(q.total)} · {new Date(q.signedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <PenLine className="h-4 w-4 text-green-500/60 mt-0.5 shrink-0" />
            </button>
          ))}
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
        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Navigate</h3>
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
          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Open Quotes</h3>
          <div className="space-y-2">
            {openQuotes.slice(0, 5).map(q => (
              <button
                key={q.id}
                onClick={() => navigate('/quotes')}
                className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/50 active:scale-95 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{q.customerName}</span>
                  <span className="text-sm font-semibold">${q.total.toFixed(0)}</span>
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
