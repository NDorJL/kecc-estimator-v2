import { useState, useMemo } from 'react'
import { Sensitive } from '@/components/ui/sensitive'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiRequest } from '@/lib/queryClient'  // ← apiRequest added
import type { Quote, Subscription, CompanySettings, Lead, Job, SubcontractorAgreement } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TrendingUp, FileText, CalendarCheck, DollarSign,
  Users, Target, BookOpen, BarChart2, MessageSquare,
  CheckCircle2, PenLine, X, Bell, ChevronDown, ChevronUp, Send,  // ← Send added
  Clock, AlertTriangle, Star, Zap, RefreshCw, Megaphone,
  Calendar, Calculator as CalcIcon, Settings, Briefcase,
  MapPin, BarChart,
} from 'lucide-react'
import { useLocation } from 'wouter'
import { ALL_NAV_ITEMS, mergeNavItems } from '@/lib/theme'

// ── Icon map (mirrors App.tsx NAV_ICONS) ─────────────────────────────────────

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard:     BarChart,
  contacts:      Users,
  calendar:      Calendar,
  jobs:          Briefcase,
  calculator:    CalcIcon,
  quotes:        FileText,
  subscriptions: RefreshCw,
  finance:       TrendingUp,
  pricebook:     BookOpen,
  leads:         Megaphone,
  settings:      Settings,
  marketing:     BarChart2,
}

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
  const arr = Array.from(ids).slice(-200)
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr))
}

// ── Notification types ───────────────────────────────────────────────────────

interface AppNotification {
  id: string
  emoji: string
  title: string
  subtitle: string
  colorClass: string
  path: string
}

// ── SMS Queue types (NEW) ────────────────────────────────────────────────────

interface SmsQueueItem {
  id:             string
  created_at:     string
  to_phone:       string
  message:        string
  type:           'review_request' | 'quote_followup' | 'service_reminder' | 'kpi_report' | 'custom'
  lead_id:        string | null
  contact_id:     string | null
  status:         'pending' | 'approved' | 'sent' | 'dismissed'
  approved_at:    string | null
  sent_at:        string | null
  recipient_name: string | null   // joined from contacts table
}

const SMS_TYPE_LABELS: Record<string, string> = {
  service_reminder: 'Service Reminder',
  quote_followup:   'Quote Follow-Up',
  review_request:   'Review Request',
  kpi_report:       'KPI Report',
  custom:           'Custom',
}

const SMS_TYPE_COLORS: Record<string, string> = {
  service_reminder: 'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-300',
  quote_followup:   'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-300',
  review_request:   'bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-300',
  kpi_report:       'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  custom:           'bg-muted      text-muted-foreground',
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title, value, sub, icon: Icon, loading, onClick,
}: {
  title: string
  value: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
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
            <Sensitive as="p" className="text-[2rem] font-black tracking-tight leading-none mt-0.5 tabular-nums">{value}</Sensitive>
            {sub && <Sensitive as="p" className="text-xs text-muted-foreground mt-1">{sub}</Sensitive>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Window badge ─────────────────────────────────────────────────────────────

const WINDOW_LABELS: Record<string, string> = {
  morning:   '8am–12pm',
  afternoon: '12pm–5pm',
  evening:   '5pm–8pm',
  anytime:   'Anytime',
}

const JOB_STATUS_COLORS: Record<string, string> = {
  scheduled:   'bg-blue-100 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  completed:   'bg-green-100 text-green-700 border-green-200',
  cancelled:   'bg-red-100 text-red-700 border-red-200',
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, navigate] = useLocation()
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed)
  const [notifExpanded, setNotifExpanded] = useState(true)

  // ── Data fetching ────────────────────────────────────────────────────────────
  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  const { data: quotes, isLoading: quotesLoading } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet('/quotes'),
  })

  const { data: subs, isLoading: subsLoading } = useQuery<Subscription[]>({
    queryKey: ['/subscriptions'],
    queryFn: () => apiGet('/subscriptions'),
  })

  const { data: leads, isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ['/leads'],
    queryFn: () => apiGet('/leads'),
  })

  const { data: jobs, isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ['/jobs'],
    queryFn: () => apiGet('/jobs'),
  })

  const { data: scas = [] } = useQuery<SubcontractorAgreement[]>({
    queryKey: ['/subcontractor-agreements'],
    queryFn: () => apiGet('/subcontractor-agreements?action=list'),
  })

  // ── SMS Queue (NEW) ────────────────────────────────────────────────────────
  const {
    data: smsQueue = [],
    isLoading: queueLoading,
    refetch: refetchQueue,
  } = useQuery<SmsQueueItem[]>({
    queryKey: ['/sms-queue'],
    queryFn: () => apiGet('/sms-queue'),
    refetchInterval: 60_000,   // poll every minute so the panel stays fresh
  })

  // Track which item IDs are mid-action (approve/dismiss) to show loading state
  const [queueActionIds, setQueueActionIds] = useState<Set<string>>(new Set())

  async function handleApprove(item: SmsQueueItem) {
    setQueueActionIds(prev => new Set(prev).add(item.id))
    try {
      await apiRequest('PATCH', `/sms-queue/${item.id}`, { status: 'approved' })
      await apiRequest('POST', `/sms-queue/${item.id}/send`, {})
      await refetchQueue()
    } catch (err) {
      console.error('[sms-queue approve]', err)
      // Re-surface the error; don't swallow it silently
      alert(`Send failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setQueueActionIds(prev => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }

  async function handleDismiss(item: SmsQueueItem) {
    setQueueActionIds(prev => new Set(prev).add(item.id))
    try {
      await apiRequest('PATCH', `/sms-queue/${item.id}`, { status: 'dismissed' })
      await refetchQueue()
    } catch (err) {
      console.error('[sms-queue dismiss]', err)
    } finally {
      setQueueActionIds(prev => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }

  // ── Mark contact as reviewed (NEW) ─────────────────────────────────────────
  // Shortcut so you don't have to navigate to the contact page.
  // Patches has_left_review = true on the contact, then dismisses the SMS card.
  async function handleMarkReviewed(item: SmsQueueItem) {
    if (!item.contact_id) return
    setQueueActionIds(prev => new Set(prev).add(item.id))
    try {
      await apiRequest('PATCH', `/contacts/${item.contact_id}`, { hasLeftReview: true })
      // Also dismiss the queue card so it disappears immediately
      await apiRequest('PATCH', `/sms-queue/${item.id}`, { status: 'dismissed' })
      await refetchQueue()
    } catch (err) {
      console.error('[review] mark reviewed failed:', err)
    } finally {
      setQueueActionIds(prev => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }
  // ── end SMS Queue ──────────────────────────────────────────────────────────

  const loading = quotesLoading || subsLoading

  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`

  // ── Today's schedule ─────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10)  // 'YYYY-MM-DD'

  const todaysJobs = useMemo(() =>
    (jobs ?? [])
      .filter(j =>
        j.scheduledDate === todayStr &&
        j.status !== 'cancelled' &&
        j.status !== 'completed'
      )
      .sort((a, b) => {
        const order = { morning: 0, afternoon: 1, evening: 2, anytime: 3 }
        const aw = (a.scheduledWindow ?? 'anytime') as keyof typeof order
        const bw = (b.scheduledWindow ?? 'anytime') as keyof typeof order
        return (order[aw] ?? 3) - (order[bw] ?? 3)
      }),
    [jobs, todayStr]
  )

  // ── KPI calculations ─────────────────────────────────────────────────────────
  // MRR = sum of inSeasonMonthlyTotal for ACTIVE subscriptions.
  // Subscriptions table is the single source of truth — Dashboard and Subscriptions page agree.
  const activeSubs = useMemo(() =>
    (subs ?? []).filter(s => s.status === 'ACTIVE'),
  [subs])

  const mrr = useMemo(() =>
    activeSubs.reduce((sum, s) => sum + s.inSeasonMonthlyTotal, 0),
  [activeSubs])

  const activeSubsCount = activeSubs.length

  const openQuotes = (quotes ?? []).filter(q => q.status === 'draft' || q.status === 'sent')
  const openQuotesValue = openQuotes.reduce((sum, q) => sum + q.total, 0)

  // ── Dynamic quick nav ────────────────────────────────────────────────────────
  // Show pages that are NOT visible in the nav bar (except dashboard itself)
  const quickNavItems = useMemo(() => {
    const navItems = mergeNavItems(settings?.navConfig?.items ?? [])
    return navItems
      .filter(item => !item.visible && item.id !== 'dashboard')
      .map(item => {
        const def = ALL_NAV_ITEMS.find(n => n.id === item.id)
        if (!def) return null
        return {
          id:    item.id,
          label: def.label,
          path:  def.path,
          icon:  NAV_ICONS[item.id] ?? FileText,
        }
      })
      .filter(Boolean) as { id: string; label: string; path: string; icon: React.ComponentType<{ className?: string }> }[]
  }, [settings])

  // ── Notifications ─────────────────────────────────────────────────────────────
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  const notifications = useMemo((): AppNotification[] => {
    const result: AppNotification[] = []
    const qs   = quotes  ?? []
    const ls   = leads   ?? []
    const js   = jobs    ?? []
    const ss   = subs    ?? []
    const scaList = scas ?? []

    // 1. Recently signed quotes (last 7 days)
    const sevenDaysAgo = new Date(now - 7 * DAY)
    for (const q of qs) {
      if (q.signedAt && new Date(q.signedAt) >= sevenDaysAgo) {
        result.push({
          id: `signed-${q.id}`,
          emoji: '✅',
          title: `${q.customerName} signed their quote`,
          subtitle: `${fmt(q.total)} · ${new Date(q.signedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
          colorClass: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
          path: '/quotes',
        })
      }
    }

    // 2. Quotes awaiting signature — sent 3+ days ago, not signed, not declined
    for (const q of qs) {
      if (q.sentAt && !q.signedAt && q.status === 'sent') {
        const sentDaysAgo = (now - new Date(q.sentAt).getTime()) / DAY
        if (sentDaysAgo >= 3) {
          result.push({
            id: `unsigned-${q.id}`,
            emoji: '✍️',
            title: `Quote awaiting signature — ${q.customerName}`,
            subtitle: `Sent ${Math.floor(sentDaysAgo)} days ago · ${fmt(q.total)}`,
            colorClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
            path: '/quotes',
          })
        }
      }
    }

    // 3. Quotes expiring soon (expires_at within 3 days)
    if (qs.some((q: any) => q.expiresAt)) {
      for (const q of qs as any[]) {
        if (q.expiresAt && !q.signedAt && q.status !== 'declined') {
          const daysLeft = (new Date(q.expiresAt).getTime() - now) / DAY
          if (daysLeft >= 0 && daysLeft <= 3) {
            result.push({
              id: `expiring-${q.id}`,
              emoji: '📅',
              title: `Quote expiring soon — ${q.customerName}`,
              subtitle: `Expires ${daysLeft < 1 ? 'today' : `in ${Math.ceil(daysLeft)} day${Math.ceil(daysLeft) === 1 ? '' : 's'}`}`,
              colorClass: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
              path: '/quotes',
            })
          }
        }
      }
    }

    // 4. Stale leads — in 'new' or 'contacted' for 7+ days
    for (const l of ls) {
      if (l.stage === 'new' || l.stage === 'contacted') {
        const staleDays = (now - new Date(l.createdAt).getTime()) / DAY
        if (staleDays >= 7) {
          const contactName = l.serviceInterest ?? 'lead'
          result.push({
            id: `stale-lead-${l.id}`,
            emoji: '💤',
            title: `Stale lead — ${l.stage} for ${Math.floor(staleDays)} days`,
            subtitle: contactName,
            colorClass: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-400',
            path: '/leads',
          })
        }
      }
    }

    // follow_up stage removed — leads stay in 'quoted' after follow-up SMS

    // 6. Awaiting invoice — lead in 'finished_unpaid' for 2+ days
    for (const l of ls) {
      if (l.stage === 'finished_unpaid') {
        const unpaidAge = (now - new Date(l.createdAt).getTime()) / DAY
        if (unpaidAge >= 2) {
          result.push({
            id: `unpaid-lead-${l.id}`,
            emoji: '💰',
            title: `Invoice needed — ${Math.floor(unpaidAge)} days since completion`,
            subtitle: l.serviceInterest ?? 'Finished job',
            colorClass: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
            path: '/leads',
          })
        }
      }
    }

    // 7. Recurring lead with no linked subscription
    for (const l of ls) {
      if (l.stage === 'recurring') {
        const hasActiveSub = ss.some(s => {
          // check via contactId if linked
          return l.contactId && (s as any).contactId === l.contactId && s.status === 'ACTIVE'
        })
        if (!hasActiveSub) {
          result.push({
            id: `no-sub-${l.id}`,
            emoji: '🔗',
            title: `Recurring lead has no active subscription`,
            subtitle: l.serviceInterest ?? 'Check lead record',
            colorClass: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
            path: '/leads',
          })
        }
      }
    }

    // 8. Unscheduled one-time jobs
    for (const j of js) {
      if (j.jobType === 'one_time' && !j.scheduledDate && j.status === 'scheduled') {
        result.push({
          id: `unscheduled-${j.id}`,
          emoji: '📵',
          title: `Unscheduled job — ${j.serviceName}`,
          subtitle: j.customerName ?? 'No date set',
          colorClass: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400',
          path: '/jobs',
        })
      }
    }

    // 9. Review pending — job completed 2+ days ago with no review request
    for (const j of js) {
      if (j.status === 'completed' && !j.reviewSentAt && j.completedAt) {
        const daysSinceCompletion = (now - new Date(j.completedAt).getTime()) / DAY
        if (daysSinceCompletion >= 2) {
          result.push({
            id: `review-pending-${j.id}`,
            emoji: '⭐',
            title: `Review request not sent — ${j.serviceName}`,
            subtitle: `${j.customerName ?? 'Job'} completed ${Math.floor(daysSinceCompletion)} days ago`,
            colorClass: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
            path: '/jobs',
          })
        }
      }
    }

    // 10. Recently signed SCAs (last 7 days)
    const sevenDaysAgoSca = new Date(now - 7 * DAY)
    for (const sca of scaList) {
      if (sca.status === 'signed' && sca.signedAt && new Date(sca.signedAt) >= sevenDaysAgoSca) {
        result.push({
          id: `sca-signed-${sca.id}`,
          emoji: '📝',
          title: `${sca.contractorName} signed their SCA`,
          subtitle: new Date(sca.signedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          colorClass: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
          path: '/contacts',
        })
      }
    }

    // 11. Today's events (header notification)
    if (todaysJobs.length > 0) {
      result.unshift({
        id: `today-events-${todayStr}`,
        emoji: '📋',
        title: `${todaysJobs.length} job${todaysJobs.length === 1 ? '' : 's'} on today's schedule`,
        subtitle: todaysJobs.map(j => j.customerName ?? j.serviceName).slice(0, 3).join(', '),
        colorClass: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
        path: '/jobs',
      })
    }

    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, leads, jobs, subs, scas, todayStr])

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

  // Auto-expand when new notifications appear
  const hasNew = visible.length > 0

  return (
    <div className="p-4 space-y-5 pb-8">
      <div>
        <h2 className="text-xl font-bold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* ── Pending SMS Queue (NEW) ───────────────────────────────────────── */}
      {!queueLoading && (
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Pending SMS
              </span>
              {smsQueue.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center">
                  {smsQueue.length}
                </span>
              )}
            </div>
            <span className="text-[10px] text-amber-700/70 dark:text-amber-400/60 font-medium uppercase tracking-wide">
              Approve before sending
            </span>
          </div>

          {/* Body */}
          {smsQueue.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted-foreground text-center">
              No messages waiting for approval
            </div>
          ) : (
            <div className="divide-y divide-border">
              {smsQueue.map(item => {
                const isActing   = queueActionIds.has(item.id)
                const recipientLabel = item.recipient_name ?? item.to_phone
                const queuedMinsAgo  = Math.round(
                  (Date.now() - new Date(item.created_at).getTime()) / 60_000
                )
                const timeLabel = queuedMinsAgo < 60
                  ? `${queuedMinsAgo}m ago`
                  : `${Math.round(queuedMinsAgo / 60)}h ago`

                return (
                  <div key={item.id} className="p-3 space-y-2">
                    {/* Top row: recipient + type tag + time */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate flex-1 min-w-0">
                        {recipientLabel}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${SMS_TYPE_COLORS[item.type] ?? SMS_TYPE_COLORS.custom}`}>
                        {SMS_TYPE_LABELS[item.type] ?? item.type}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel}</span>
                    </div>

                    {/* Phone (if we have a name to show separately) */}
                    {item.recipient_name && (
                      <p className="text-[11px] text-muted-foreground">{item.to_phone}</p>
                    )}

                    {/* Message preview */}
                    <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
                      {item.message}
                    </p>

                    {/* Actions */}
                    <div className="flex gap-2 pt-0.5">
                      <button
                        disabled={isActing}
                        onClick={() => handleApprove(item)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send className="h-3 w-3 shrink-0" />
                        {isActing ? 'Sending…' : 'Approve & Send'}
                      </button>
                      <button
                        disabled={isActing}
                        onClick={() => handleDismiss(item)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground text-xs font-semibold py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3 shrink-0" />
                        Dismiss
                      </button>
                    </div>
                    {/* Mark as Reviewed shortcut — only on review_request cards (NEW) */}
                    {item.type === 'review_request' && item.contact_id && (
                      <button
                        disabled={isActing}
                        onClick={() => handleMarkReviewed(item)}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-green-400/50 text-green-700 dark:text-green-400 text-xs font-semibold py-1.5 transition-colors hover:bg-green-50 dark:hover:bg-green-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        They Left a Review — Mark &amp; Dismiss
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {/* ── end Pending SMS Queue ─────────────────────────────────────────── */}

      {/* ── Notification Center ───────────────────────────────────────────── */}
      {!quotesLoading && !leadsLoading && !jobsLoading && (
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
            <button
              className="flex items-center gap-1.5 text-sm font-semibold"
              onClick={() => setNotifExpanded(e => !e)}
            >
              <Bell className="h-4 w-4 text-primary" />
              <span>Notifications</span>
              {visible.length > 0 && (
                <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs font-bold w-5 h-5 flex items-center justify-center">
                  {visible.length}
                </span>
              )}
              {notifExpanded
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-1" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" />
              }
            </button>
            {visible.length > 0 && (
              <button
                onClick={dismissAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {notifExpanded && (
            <>
              {visible.length === 0 ? (
                <div className="px-4 py-4 text-sm text-muted-foreground text-center">
                  All clear — no action items 🎉
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visible.map(n => (
                    <div key={n.id} className={`flex items-start gap-3 p-3 ${n.colorClass}`}>
                      <button
                        onClick={() => navigate(n.path)}
                        className="flex items-start gap-3 flex-1 min-w-0 text-left"
                      >
                        <span className="text-base mt-0.5 shrink-0">{n.emoji}</span>
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
            </>
          )}
        </div>
      )}

      {/* ── Today's Schedule ──────────────────────────────────────────────── */}
      {!jobsLoading && (
        <div>
          <h3 className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <CalendarCheck className="h-3.5 w-3.5" />
            Today's Schedule
            {todaysJobs.length > 0 && (
              <span className="ml-1 text-primary font-bold">({todaysJobs.length})</span>
            )}
          </h3>
          {todaysJobs.length === 0 ? (
            <div className="rounded-xl border bg-muted/20 px-4 py-5 text-center text-sm text-muted-foreground">
              Nothing scheduled today — enjoy the day! ☀️
            </div>
          ) : (
            <div className="space-y-2">
              {todaysJobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => navigate('/jobs')}
                  className="w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/50 active:scale-95 transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{job.customerName ?? job.serviceName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.serviceName}</p>
                      {job.customerAddress && (
                        <div className="flex items-center gap-1 mt-1">
                          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground truncate">{job.customerAddress}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 capitalize ${JOB_STATUS_COLORS[job.status] ?? ''}`}
                      >
                        {job.status.replace('_', ' ')}
                      </Badge>
                      {job.scheduledWindow && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {WINDOW_LABELS[job.scheduledWindow] ?? job.scheduledWindow}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── KPI Grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {/* MRR — uses subsLoading since mrr comes from subs, navigates to /subscriptions so number matches */}
        <KpiCard
          title="Monthly Recurring"
          value={subsLoading ? '—' : fmt(mrr)}
          sub="active subscriptions"
          icon={TrendingUp}
          loading={subsLoading}
          onClick={() => navigate('/subscriptions')}
        />
        <KpiCard
          title="Open Quotes"
          value={loading ? '—' : String(openQuotes.length)}
          sub={loading ? '' : `${fmt(openQuotesValue)} pipeline`}
          icon={FileText}
          loading={loading}
          onClick={() => navigate('/quotes')}
        />
        {/* Recurring Clients — count from activeSubs, subsLoading matches the data source */}
        <KpiCard
          title="Recurring Clients"
          value={subsLoading ? '—' : String(activeSubsCount)}
          sub="active subscriptions"
          icon={CalendarCheck}
          loading={subsLoading}
          onClick={() => navigate('/subscriptions')}
        />
        <KpiCard
          title="Leads"
          value={leadsLoading ? '—' : String((leads ?? []).filter(l => l.stage !== 'finished_paid').length)}
          sub="active pipeline"
          icon={Target}
          loading={leadsLoading}
          onClick={() => navigate('/leads')}
        />
      </div>

      {/* ── Dynamic Quick Nav — desktop only (mobile uses bottom quick-bar) ── */}
      {quickNavItems.length > 0 && (
        <div className="hidden md:block">
          <h3 className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider">Navigate</h3>
          <div className="grid grid-cols-4 gap-2">
            {quickNavItems.map(({ id, label, path, icon: Icon }) => (
              <button
                key={id}
                onClick={() => navigate(path)}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-3 text-center hover:bg-muted/50 active:scale-95 transition-all"
              >
                <Icon className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Open Quotes ────────────────────────────────────────────── */}
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
                  <Sensitive className="font-semibold text-sm">{q.customerName}</Sensitive>
                  <Sensitive className="text-sm font-bold">${q.total.toFixed(0)}</Sensitive>
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
