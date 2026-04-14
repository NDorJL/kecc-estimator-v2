import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/queryClient'
import { Quote, Subscription } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, FileText, CalendarCheck, DollarSign } from 'lucide-react'
import { useLocation } from 'wouter'

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  loading,
}: {
  title: string
  value: string
  sub?: string
  icon: React.ElementType
  loading?: boolean
}) {
  return (
    <Card>
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

  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Overview of your business</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          title="Monthly Recurring"
          value={loading ? '—' : fmt(mrr)}
          sub="active subscriptions"
          icon={TrendingUp}
          loading={loading}
        />
        <KpiCard
          title="Open Quotes"
          value={loading ? '—' : String(openQuotes.length)}
          sub={loading ? '' : `${fmt(openQuotesValue)} pipeline`}
          icon={FileText}
          loading={loading}
        />
        <KpiCard
          title="Active Subscriptions"
          value={loading ? '—' : String(activeSubs)}
          sub="in season"
          icon={CalendarCheck}
          loading={loading}
        />
        <KpiCard
          title="Invoices"
          value="—"
          sub="Phase 4"
          icon={DollarSign}
          loading={false}
        />
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => navigate('/calculator')}
            className="rounded-xl border bg-card p-3 text-left text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            + New Quote
          </button>
          <button
            onClick={() => navigate('/contacts')}
            className="rounded-xl border bg-card p-3 text-left text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            + New Contact
          </button>
          <button
            onClick={() => navigate('/leads')}
            className="rounded-xl border bg-card p-3 text-left text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            View Leads
          </button>
          <button
            onClick={() => navigate('/quotes')}
            className="rounded-xl border bg-card p-3 text-left text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            View Quotes
          </button>
        </div>
      </div>

      {/* Recent Quotes */}
      {!quotesLoading && openQuotes.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Open Quotes</h3>
          <div className="space-y-2">
            {openQuotes.slice(0, 5).map(q => (
              <button
                key={q.id}
                onClick={() => navigate('/quotes')}
                className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/50 transition-colors"
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
