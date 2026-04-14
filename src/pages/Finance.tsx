import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiRequest } from '@/lib/queryClient'
import { Lock, TrendingUp, TrendingDown, DollarSign, AlertTriangle, Upload, Plus, Pencil, Trash2, Check, X, RefreshCw } from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const YEAR = 2026

const INCOME_CATS = [
  'Active Jobs - Residential','Active Jobs - Commercial',
  'Subscription - TCEP','Subscription - Lawn Care','Subscription - Other','Other Income',
]
const EXPENSE_CATS = [
  'Software - Perplexity','Software - Claude Pro','Software - Dropbox','Software - Squarespace',
  'Software - Workflowy','Software - Quo','Software - Canva','Software - Google Workspace',
  'Software - QuickBooks','Marketing - Social Media','Insurance - General Liability',
  'Materials & Supplies','Subcontracted Labor','Fuel & Vehicle','Debt Service',
  'Equipment Purchase','Misc / Other',
]
const ALL_CATS = [...INCOME_CATS, ...EXPENSE_CATS]
const ACCOUNTS = ['KECC Checking (TVA)','KECC Savings (TVA)','Chase Ink Business Unlimited','Cash','Other']

const CAT_COLORS: Record<string, string> = {
  'Active Jobs - Residential':'#1B4332','Active Jobs - Commercial':'#2D6A4F',
  'Subscription - TCEP':'#52B788','Subscription - Lawn Care':'#74C69D',
  'Subscription - Other':'#95D5B2','Other Income':'#B7E4C7',
  'Software - Perplexity':'#6366f1','Software - Claude Pro':'#8b5cf6',
  'Software - Dropbox':'#0ea5e9','Software - Squarespace':'#06b6d4',
  'Software - Workflowy':'#14b8a6','Software - Quo':'#10b981',
  'Software - Canva':'#f59e0b','Software - Google Workspace':'#ef4444',
  'Software - QuickBooks':'#22c55e','Marketing - Social Media':'#ec4899',
  'Insurance - General Liability':'#f97316','Materials & Supplies':'#84cc16',
  'Subcontracted Labor':'#e76f51','Fuel & Vehicle':'#a78bfa',
  'Debt Service':'#f43f5e','Equipment Purchase':'#0891b2',
  'Misc / Other':'#94a3b8',
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  type: 'Income' | 'Expense'
  category: string
  account: string
  notes: string
  review: boolean
  review_note: string
  source: string
  created_at: string
}

interface Snapshot {
  id: string
  month: number
  year: number
  checking: number
  savings: number
  equipment: number
  vehicles: number
  real_estate: number
  other_assets: number
  chase_ink: number
  auto_loan: number
  biz_loan: number
  other_liab: number
}

// ── Auto-categorization ───────────────────────────────────────────────────
interface CatResult { type: 'Income' | 'Expense' | null; cat: string; review: boolean; note: string }
const RULES: Array<{ test: (d: string) => boolean; type: 'Income' | 'Expense'; cat: string; review?: boolean; note?: string }> = [
  { test: d => /perplexity/i.test(d), type:'Expense', cat:'Software - Perplexity' },
  { test: d => /claude|anthropic/i.test(d), type:'Expense', cat:'Software - Claude Pro' },
  { test: d => /dropbox/i.test(d), type:'Expense', cat:'Software - Dropbox' },
  { test: d => /squarespace/i.test(d), type:'Expense', cat:'Software - Squarespace' },
  { test: d => /workflowy/i.test(d), type:'Expense', cat:'Software - Workflowy' },
  { test: d => /\bquo\b/i.test(d), type:'Expense', cat:'Software - Quo' },
  { test: d => /canva/i.test(d), type:'Expense', cat:'Software - Canva' },
  { test: d => /google\s*(workspace|one)|gsuite/i.test(d), type:'Expense', cat:'Software - Google Workspace' },
  { test: d => /quickbooks|intuit/i.test(d), type:'Expense', cat:'Software - QuickBooks' },
  { test: d => /corterie|liability.*insur|general.?liab/i.test(d), type:'Expense', cat:'Insurance - General Liability' },
  { test: d => /\bhope\b|social.?media/i.test(d), type:'Expense', cat:'Marketing - Social Media' },
  { test: d => /shell|bp\b|exxon|chevron|valero|marathon|speedway|sunoco|murphy|kwik.*trip|circle.?k|fuel|gas.sta|pilot.*travel|love.*travel|ta\s+travel/i.test(d), type:'Expense', cat:'Fuel & Vehicle' },
  { test: d => /home.?depot|lowe.?s|menards|ace.?hardware|harbor.?freight|true.?value/i.test(d), type:'Expense', cat:'Materials & Supplies' },
  { test: d => /chase.*autopay|chase.*payment|credit.?card.*pay|cc.?payment|autopay/i.test(d), type:'Expense', cat:'Debt Service' },
  { test: d => /tcep|bailey|grimes/i.test(d), type:'Income', cat:'Subscription - TCEP' },
  { test: d => /lawn|mow|turf/i.test(d), type:'Income', cat:'Subscription - Lawn Care' },
  { test: d => /exterior.*care|kecc|soft.?wash|pressure.*wash|gutter|window.*clean|roof.*clean/i.test(d), type:'Income', cat:'Active Jobs - Residential' },
  { test: d => /cash.*withdrawal|atm.*with|atm\s|cash.?adv/i.test(d), type:'Expense', cat:'Subcontracted Labor', review: true, note:'Cash withdrawal — likely subcontractor pay. Confirm.' },
  { test: d => /zelle|venmo|cashapp|paypal.*send|apple.?pay.*send/i.test(d), type:'Expense', cat:'Subcontracted Labor', review: true, note:'Digital transfer — confirm subcontractor or personal.' },
]

function categorize(description: string): CatResult {
  const d = (description || '').toLowerCase()
  for (const r of RULES) {
    if (r.test(d)) return { type: r.type, cat: r.cat, review: r.review || false, note: r.note || '' }
  }
  return { type: null, cat: '', review: true, note: 'Could not auto-categorize — please assign a category.' }
}

// ── CSV Parser ────────────────────────────────────────────────────────────
type CsvFormat = 'DEBIT_CREDIT' | 'CHASE_CC' | 'CHASE_CHECKING' | 'GENERIC' | 'UNKNOWN'
function detectCsvFormat(headers: string[]): CsvFormat {
  const h = headers.map(x => (x || '').toLowerCase().trim())
  const has = (k: string) => h.some(x => x.includes(k))
  if (has('debit') && has('credit'))                 return 'DEBIT_CREDIT'
  if (has('transaction date') && has('type'))        return 'CHASE_CC'
  if (has('posting date') && has('details'))         return 'CHASE_CHECKING'
  if (has('amount') || has('transaction amount'))    return 'GENERIC'
  return 'UNKNOWN'
}

function parseCSV(csvText: string, statementType: string): Omit<Transaction, 'id' | 'created_at'>[] {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim())
  const fmt = detectCsvFormat(headers)
  const results: Omit<Transaction, 'id' | 'created_at'>[] = []

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].match(/(".*?"|[^,]+)/g)?.map(v => v.replace(/"/g, '').trim()) ?? []
    if (vals.length < 2) continue
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? '' })

    const get = (keys: string[]) => {
      for (const k of keys) {
        const match = headers.find(h => h.toLowerCase().includes(k))
        if (match && row[match]) return row[match]
      }
      return ''
    }
    const toNum = (s: string) => parseFloat(s.replace(/[$,\s]/g, '')) || 0

    let date = '', desc = '', amount = 0, isDebit: boolean | null = null

    if (fmt === 'DEBIT_CREDIT') {
      date = get(['date'])
      desc = get(['description', 'memo', 'payee', 'name'])
      const debit = toNum(get(['debit', 'withdrawal']))
      const credit = toNum(get(['credit', 'deposit']))
      if (debit > 0) { amount = debit; isDebit = true }
      if (credit > 0) { amount = credit; isDebit = false }
    } else if (fmt === 'CHASE_CC') {
      date = get(['transaction date'])
      desc = get(['description', 'memo'])
      const raw = toNum(get(['amount']))
      if (raw > 0) { amount = raw; isDebit = true } else { amount = -raw; isDebit = false }
    } else if (fmt === 'CHASE_CHECKING') {
      date = get(['posting date'])
      desc = get(['description'])
      const raw = toNum(get(['amount']))
      amount = Math.abs(raw); isDebit = raw < 0
    } else {
      date = get(['date', 'posted', 'transaction date', 'trans date'])
      desc = get(['description', 'memo', 'payee', 'name', 'narration'])
      const raw = toNum(get(['amount', 'transaction amount']))
      amount = Math.abs(raw)
      isDebit = statementType === 'cc' ? raw > 0 : raw < 0
    }

    if (!date || !amount || !desc) continue
    let normalDate = ''
    try {
      const d = new Date(date)
      if (!isNaN(d.getTime())) normalDate = d.toISOString().slice(0, 10)
    } catch { continue }
    if (!normalDate) continue

    const type = isDebit ? 'Expense' : 'Income'
    const { cat, review, note } = categorize(desc)
    const finalType: 'Income' | 'Expense' = cat ? (INCOME_CATS.includes(cat) ? 'Income' : 'Expense') : type
    const account = statementType === 'cc' ? 'Chase Ink Business Unlimited'
      : statementType === 'savings' ? 'KECC Savings (TVA)' : 'KECC Checking (TVA)'

    results.push({
      date: normalDate, description: desc, amount,
      type: finalType, category: cat || '',
      account, notes: '',
      review: review || !cat,
      review_note: note || (!cat ? 'Unrecognized — assign a category.' : ''),
      source: 'upload',
    })
  }
  return results
}

function dedupe(incoming: Omit<Transaction, 'id' | 'created_at'>[], existing: Transaction[]) {
  return incoming.filter(tx => !existing.some(e =>
    e.date === tx.date &&
    Math.abs(e.amount - tx.amount) < 0.01 &&
    e.description.toLowerCase().slice(0, 20) === tx.description.toLowerCase().slice(0, 20)
  ))
}

// ── Formatting helpers ────────────────────────────────────────────────────
const fmt$ = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0)
const fmt$d = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0)

// ── P&L Calculation ───────────────────────────────────────────────────────
function calcPL(transactions: Transaction[], year: number) {
  const pl: Record<number, { income: Record<string, number>; expenses: Record<string, number>; totalIncome: number; totalExpenses: number; net: number }> = {}
  for (let m = 1; m <= 12; m++) {
    pl[m] = { income: {}, expenses: {}, totalIncome: 0, totalExpenses: 0, net: 0 }
    for (const cat of INCOME_CATS) pl[m].income[cat] = 0
    for (const cat of EXPENSE_CATS) pl[m].expenses[cat] = 0
  }
  for (const tx of transactions) {
    const txYear = new Date(tx.date + 'T12:00:00').getFullYear()
    if (txYear !== year) continue
    const m = new Date(tx.date + 'T12:00:00').getMonth() + 1
    if (tx.type === 'Income' && tx.category && pl[m].income[tx.category] !== undefined) {
      pl[m].income[tx.category] += Number(tx.amount)
    } else if (tx.type === 'Expense' && tx.category && pl[m].expenses[tx.category] !== undefined) {
      pl[m].expenses[tx.category] += Number(tx.amount)
    }
  }
  for (let m = 1; m <= 12; m++) {
    pl[m].totalIncome = Object.values(pl[m].income).reduce((a, b) => a + b, 0)
    pl[m].totalExpenses = Object.values(pl[m].expenses).reduce((a, b) => a + b, 0)
    pl[m].net = pl[m].totalIncome - pl[m].totalExpenses
  }
  return pl
}

// ── PIN Gate ──────────────────────────────────────────────────────────────
const SESSION_KEY = 'finance_unlocked'

function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const { toast } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setFailed(false)
    try {
      const res = await apiRequest('POST', '/finance?action=verify-pin', { pin })
      const data = await res.json()
      if (data.valid) {
        sessionStorage.setItem(SESSION_KEY, '1')
        onUnlock()
      } else {
        setFailed(true)
        setPin('')
      }
    } catch {
      toast({ title: 'Error', description: 'Could not verify PIN. Try again.', variant: 'destructive' })
    } finally { setLoading(false) }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Financial Dashboard</h2>
          <p className="text-sm text-muted-foreground">Enter your PIN to access financial data</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            inputMode="numeric"
            placeholder="Enter PIN"
            value={pin}
            onChange={e => setPin(e.target.value)}
            className={`text-center text-lg tracking-widest ${failed ? 'border-destructive' : ''}`}
            autoFocus
          />
          {failed && <p className="text-sm text-destructive">Incorrect PIN. Try again.</p>}
          <Button type="submit" className="w-full" disabled={loading || pin.length < 1}>
            {loading ? 'Verifying…' : 'Unlock'}
          </Button>
        </form>
      </div>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${positive === true ? 'text-green-600' : positive === false ? 'text-destructive' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────
function DashboardTab({ transactions, snapshots }: { transactions: Transaction[]; snapshots: Snapshot[] }) {
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1)
  const pl = useMemo(() => calcPL(transactions, YEAR), [transactions])
  const mo = pl[selMonth] || { totalIncome: 0, totalExpenses: 0, net: 0, income: {}, expenses: {} }
  const prev = pl[selMonth - 1] || { totalIncome: 0, totalExpenses: 0, net: 0 }
  const bs = snapshots.find(s => s.month === selMonth && s.year === YEAR)

  const cash = bs ? Number(bs.checking) + Number(bs.savings) : null
  const ccBal = bs ? Number(bs.chase_ink) : null

  const ytdIncome = Object.values(pl).reduce((s, m) => s + m.totalIncome, 0)
  const ytdExpenses = Object.values(pl).reduce((s, m) => s + m.totalExpenses, 0)
  const ytdNet = ytdIncome - ytdExpenses

  // Bar chart data
  const barData = MONTHS.map((label, i) => ({
    month: label,
    Income: Math.round((pl[i + 1]?.totalIncome || 0) * 100) / 100,
    Expenses: Math.round((pl[i + 1]?.totalExpenses || 0) * 100) / 100,
  }))

  // Net cash flow line
  const lineData = MONTHS.map((label, i) => ({
    month: label,
    Net: Math.round((pl[i + 1]?.net || 0) * 100) / 100,
  }))

  // Expense pie
  const expensePie: { name: string; value: number; fill: string }[] = []
  for (const cat of EXPENSE_CATS) {
    const ytd = Object.values(pl).reduce((s, m) => s + (m.expenses[cat] || 0), 0)
    if (ytd > 0) expensePie.push({ name: cat, value: Math.round(ytd * 100) / 100, fill: CAT_COLORS[cat] || '#94a3b8' })
  }

  const needsReview = transactions.filter(t => {
    const txYear = new Date(t.date + 'T12:00:00').getFullYear()
    const txMo = new Date(t.date + 'T12:00:00').getMonth() + 1
    return t.review && txMo === selMonth && txYear === YEAR
  })

  return (
    <div className="space-y-6 p-4">
      {/* Month selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{YEAR} Overview</h2>
        <Select value={String(selMonth)} onValueChange={v => setSelMonth(Number(v))}>
          <SelectTrigger className="w-36 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m} {YEAR}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Monthly Income" value={fmt$(mo.totalIncome)} positive={mo.totalIncome > 0}
          sub={`${mo.totalIncome > 0 ? '+' : ''}${fmt$(mo.totalIncome - prev.totalIncome)} vs prior mo`} />
        <KpiCard label="Monthly Expenses" value={fmt$(mo.totalExpenses)}
          sub={`${mo.totalExpenses > 0 ? '+' : ''}${fmt$(mo.totalExpenses - prev.totalExpenses)} vs prior mo`} />
        <KpiCard label="Net Cash Flow" value={fmt$(mo.net)} positive={mo.net >= 0}
          sub={mo.totalIncome > 0 ? `Margin: ${((mo.net / mo.totalIncome) * 100).toFixed(1)}%` : '—'} />
        <KpiCard label="YTD Net" value={fmt$(ytdNet)} positive={ytdNet >= 0}
          sub={`of ${fmt$(ytdIncome)} income`} />
      </div>

      {/* Cash & Credit */}
      {(cash !== null || ccBal !== null) && (
        <div className="grid grid-cols-2 gap-3">
          {cash !== null && <KpiCard label="Cash on Hand" value={fmt$(cash)} sub="Checking + Savings" positive />}
          {ccBal !== null && <KpiCard label="Chase Ink Balance" value={fmt$(ccBal)}
            sub={`${((ccBal / 6000) * 100).toFixed(1)}% of $6,000 limit`}
            positive={ccBal / 6000 < 0.3} />}
        </div>
      )}

      {/* Review alert */}
      {needsReview.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{needsReview.length} transaction{needsReview.length > 1 ? 's' : ''} need review this month. Check the Transactions tab.</span>
        </div>
      )}

      {/* Income vs Expenses Bar Chart */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">Income vs Expenses</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt$d(v)} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Income" fill="#52B788" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Expenses" fill="#E63946" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Net Cash Flow Line */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">Net Cash Flow</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={lineData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt$d(v)} />
            <Line type="monotone" dataKey="Net" stroke="#1B4332" strokeWidth={2} dot={{ r: 3, fill: '#52B788' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* YTD Expense Breakdown Pie */}
      {expensePie.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">YTD Expense Breakdown</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={expensePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name.split(' - ').pop()}: ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                {expensePie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmt$d(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── P&L Tab ───────────────────────────────────────────────────────────────
function PLTab({ transactions }: { transactions: Transaction[] }) {
  const pl = useMemo(() => calcPL(transactions, YEAR), [transactions])
  const ytd = useMemo(() => {
    const inc: Record<string, number> = {}
    const exp: Record<string, number> = {}
    for (const cat of INCOME_CATS) inc[cat] = Object.values(pl).reduce((s, m) => s + (m.income[cat] || 0), 0)
    for (const cat of EXPENSE_CATS) exp[cat] = Object.values(pl).reduce((s, m) => s + (m.expenses[cat] || 0), 0)
    return { inc, exp }
  }, [pl])

  const activeCols = MONTHS.map((_, i) => i + 1).filter(m => {
    const d = pl[m]
    return d && (d.totalIncome > 0 || d.totalExpenses > 0)
  })

  return (
    <div className="p-4 overflow-x-auto">
      <h2 className="text-lg font-bold mb-4">{YEAR} Profit &amp; Loss</h2>
      <table className="w-full text-xs border-collapse min-w-[500px]">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground w-40">Category</th>
            {activeCols.map(m => <th key={m} className="text-right py-2 px-2 font-semibold text-muted-foreground">{MONTHS[m - 1]}</th>)}
            <th className="text-right py-2 pl-2 font-bold">YTD</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={activeCols.length + 2} className="py-2 font-bold text-green-700 text-sm uppercase tracking-wide">Income</td></tr>
          {INCOME_CATS.map(cat => {
            const ytdVal = ytd.inc[cat] || 0
            if (activeCols.every(m => !pl[m].income[cat]) && ytdVal === 0) return null
            return (
              <tr key={cat} className="border-b border-border/30 hover:bg-muted/30">
                <td className="py-1.5 pr-3 text-muted-foreground">{cat}</td>
                {activeCols.map(m => <td key={m} className="text-right py-1.5 px-2">{pl[m].income[cat] ? fmt$d(pl[m].income[cat]) : '—'}</td>)}
                <td className="text-right py-1.5 pl-2 font-medium">{ytdVal ? fmt$d(ytdVal) : '—'}</td>
              </tr>
            )
          })}
          <tr className="border-y border-border bg-muted/30 font-bold">
            <td className="py-2 pr-3">Total Income</td>
            {activeCols.map(m => <td key={m} className="text-right py-2 px-2 text-green-700">{fmt$d(pl[m].totalIncome)}</td>)}
            <td className="text-right py-2 pl-2 text-green-700">{fmt$d(Object.values(ytd.inc).reduce((a, b) => a + b, 0))}</td>
          </tr>

          <tr><td colSpan={activeCols.length + 2} className="py-2 pt-4 font-bold text-destructive text-sm uppercase tracking-wide">Expenses</td></tr>
          {EXPENSE_CATS.map(cat => {
            const ytdVal = ytd.exp[cat] || 0
            if (activeCols.every(m => !pl[m].expenses[cat]) && ytdVal === 0) return null
            return (
              <tr key={cat} className="border-b border-border/30 hover:bg-muted/30">
                <td className="py-1.5 pr-3 text-muted-foreground">{cat}</td>
                {activeCols.map(m => <td key={m} className="text-right py-1.5 px-2">{pl[m].expenses[cat] ? fmt$d(pl[m].expenses[cat]) : '—'}</td>)}
                <td className="text-right py-1.5 pl-2 font-medium">{ytdVal ? fmt$d(ytdVal) : '—'}</td>
              </tr>
            )
          })}
          <tr className="border-y border-border bg-muted/30 font-bold">
            <td className="py-2 pr-3">Total Expenses</td>
            {activeCols.map(m => <td key={m} className="text-right py-2 px-2 text-destructive">{fmt$d(pl[m].totalExpenses)}</td>)}
            <td className="text-right py-2 pl-2 text-destructive">{fmt$d(Object.values(ytd.exp).reduce((a, b) => a + b, 0))}</td>
          </tr>

          <tr className="border-b-2 font-extrabold text-sm">
            <td className="py-2.5 pr-3">Net Income</td>
            {activeCols.map(m => <td key={m} className={`text-right py-2.5 px-2 ${pl[m].net >= 0 ? 'text-green-700' : 'text-destructive'}`}>{fmt$d(pl[m].net)}</td>)}
            <td className={`text-right py-2.5 pl-2 ${ytdNet(pl) >= 0 ? 'text-green-700' : 'text-destructive'}`}>{fmt$d(ytdNet(pl))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
function ytdNet(pl: ReturnType<typeof calcPL>) {
  return Object.values(pl).reduce((s, m) => s + m.net, 0)
}

// ── Balance Sheet Tab ─────────────────────────────────────────────────────
type SnapshotField = keyof Omit<Snapshot, 'id' | 'month' | 'year'>
const BS_FIELDS: { key: SnapshotField; label: string; section: 'assets' | 'liabilities' }[] = [
  { key: 'checking',    label: 'Checking (TVA)',         section: 'assets' },
  { key: 'savings',     label: 'Savings (TVA)',          section: 'assets' },
  { key: 'equipment',   label: 'Equipment',              section: 'assets' },
  { key: 'vehicles',    label: 'Vehicles',               section: 'assets' },
  { key: 'real_estate', label: 'Real Estate',            section: 'assets' },
  { key: 'other_assets',label: 'Other Assets',           section: 'assets' },
  { key: 'chase_ink',   label: 'Chase Ink Balance',      section: 'liabilities' },
  { key: 'auto_loan',   label: 'Auto Loan',              section: 'liabilities' },
  { key: 'biz_loan',    label: 'Business Loan',          section: 'liabilities' },
  { key: 'other_liab',  label: 'Other Liabilities',      section: 'liabilities' },
]

function BalanceSheetTab({ snapshots, onRefresh }: { snapshots: Snapshot[]; onRefresh: () => void }) {
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<SnapshotField, number>>({} as Record<SnapshotField, number>)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const snap = snapshots.find(s => s.month === selMonth && s.year === YEAR)

  useEffect(() => {
    const init: Record<SnapshotField, number> = {} as Record<SnapshotField, number>
    BS_FIELDS.forEach(f => { init[f.key] = snap ? Number(snap[f.key]) : 0 })
    setForm(init)
  }, [selMonth, snapshots])

  const assets = BS_FIELDS.filter(f => f.section === 'assets')
  const liabs = BS_FIELDS.filter(f => f.section === 'liabilities')
  const totalAssets = assets.reduce((s, f) => s + (editing ? (form[f.key] || 0) : Number(snap?.[f.key] || 0)), 0)
  const totalLiabs = liabs.reduce((s, f) => s + (editing ? (form[f.key] || 0) : Number(snap?.[f.key] || 0)), 0)
  const equity = totalAssets - totalLiabs

  async function handleSave() {
    setSaving(true)
    try {
      await apiRequest('POST', '/finance?action=snapshots', {
        month: selMonth, year: YEAR, ...form,
      })
      toast({ title: 'Balance sheet saved' })
      setEditing(false)
      onRefresh()
    } catch (e) {
      toast({ title: 'Save failed', description: String(e), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Balance Sheet</h2>
        <div className="flex items-center gap-2">
          <Select value={String(selMonth)} onValueChange={v => { setSelMonth(Number(v)); setEditing(false) }}>
            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m} {YEAR}</SelectItem>)}
            </SelectContent>
          </Select>
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          )}
        </div>
      </div>

      {!snap && !editing && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No balance sheet for {MONTHS[selMonth - 1]} {YEAR}.{' '}
          <button className="text-primary underline" onClick={() => setEditing(true)}>Add one</button>
        </div>
      )}

      <div className="grid gap-4">
        {/* Assets */}
        <div className="rounded-xl border bg-card">
          <div className="px-4 py-2.5 border-b font-semibold text-sm text-green-700 dark:text-green-400">Assets</div>
          {assets.map(f => (
            <div key={f.key} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
              <span className="text-sm text-muted-foreground">{f.label}</span>
              {editing ? (
                <Input type="number" className="h-7 w-32 text-right text-sm" value={form[f.key] || ''}
                  onChange={e => setForm(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))} />
              ) : (
                <span className="text-sm font-medium">{fmt$d(Number(snap?.[f.key] || 0))}</span>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 font-bold text-sm border-t">
            <span>Total Assets</span>
            <span className="text-green-700">{fmt$d(totalAssets)}</span>
          </div>
        </div>

        {/* Liabilities */}
        <div className="rounded-xl border bg-card">
          <div className="px-4 py-2.5 border-b font-semibold text-sm text-destructive">Liabilities</div>
          {liabs.map(f => (
            <div key={f.key} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
              <span className="text-sm text-muted-foreground">{f.label}</span>
              {editing ? (
                <Input type="number" className="h-7 w-32 text-right text-sm" value={form[f.key] || ''}
                  onChange={e => setForm(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))} />
              ) : (
                <span className="text-sm font-medium">{fmt$d(Number(snap?.[f.key] || 0))}</span>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 font-bold text-sm border-t">
            <span>Total Liabilities</span>
            <span className="text-destructive">{fmt$d(totalLiabs)}</span>
          </div>
        </div>

        {/* Equity */}
        <div className="rounded-xl border bg-card flex items-center justify-between px-4 py-3 font-bold text-sm">
          <span>Owner&apos;s Equity (Net Worth)</span>
          <span className={equity >= 0 ? 'text-green-700' : 'text-destructive'}>{fmt$d(equity)}</span>
        </div>

        {editing && (
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              <Check className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Transaction Edit Dialog ───────────────────────────────────────────────
function TxDialog({ tx, open, onClose, onSave }: {
  tx: Partial<Transaction> | null; open: boolean; onClose: () => void; onSave: (data: Partial<Transaction>) => void
}) {
  const isNew = !tx?.id
  const [form, setForm] = useState<Partial<Transaction>>(tx || {})
  useEffect(() => { setForm(tx || {}) }, [tx])

  const set = (k: keyof Transaction, v: string | number | boolean) => setForm(p => ({ ...p, [k]: v }))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add Transaction' : 'Edit Transaction'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={form.date || ''} onChange={e => set('date', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.type || ''} onValueChange={v => {
                set('type', v)
                if (form.category && !((v === 'Income' ? INCOME_CATS : EXPENSE_CATS).includes(form.category))) set('category', '')
              }}>
                <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Income">Income</SelectItem>
                  <SelectItem value="Expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={form.description || ''} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0" value={form.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Account</Label>
              <Select value={form.account || ''} onValueChange={v => set('account', v)}>
                <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
                <SelectContent>
                  {ACCOUNTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={form.category || ''} onValueChange={v => set('category', v)}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                {(form.type === 'Income' ? INCOME_CATS : form.type === 'Expense' ? EXPENSE_CATS : ALL_CATS).map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.date || !form.description || !form.amount}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Transactions Tab ──────────────────────────────────────────────────────
function TransactionsTab({ transactions, onRefresh }: { transactions: Transaction[]; onRefresh: () => void }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'Income' | 'Expense' | 'review'>('all')
  const [search, setSearch] = useState('')
  const [editTx, setEditTx] = useState<Partial<Transaction> | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const { toast } = useToast()

  const filtered = useMemo(() => {
    let list = [...transactions]
    if (filter === 'Income') list = list.filter(t => t.type === 'Income')
    else if (filter === 'Expense') list = list.filter(t => t.type === 'Expense')
    else if (filter === 'review') list = list.filter(t => t.review)
    if (search) list = list.filter(t => t.description.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase()))
    return list
  }, [transactions, filter, search])

  const reviewCount = transactions.filter(t => t.review).length

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<Transaction>) => {
      if (data.id) {
        await apiRequest('PATCH', `/finance?id=${data.id}`, data)
      } else {
        await apiRequest('POST', '/finance', data)
      }
    },
    onSuccess: () => { toast({ title: 'Transaction saved' }); setDialogOpen(false); onRefresh() },
    onError: (e) => toast({ title: 'Error', description: String(e), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/finance?id=${id}`)
    },
    onSuccess: () => { toast({ title: 'Transaction deleted' }); onRefresh() },
    onError: (e) => toast({ title: 'Error', description: String(e), variant: 'destructive' }),
  })

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Input className="h-8 flex-1" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        <Button size="sm" onClick={() => { setEditTx({ type: 'Expense', date: new Date().toISOString().slice(0, 10), account: 'KECC Checking (TVA)' }); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(['all', 'Income', 'Expense', 'review'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filter === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground'}`}>
            {f === 'review' ? `Review (${reviewCount})` : f === 'all' ? `All (${transactions.length})` : f}
          </button>
        ))}
      </div>

      {/* Transaction list */}
      <div className="space-y-2">
        {filtered.length === 0 && <p className="text-center text-muted-foreground text-sm py-8">No transactions</p>}
        {filtered.map(tx => (
          <div key={tx.id} className={`rounded-xl border bg-card px-3 py-2.5 ${tx.review ? 'border-yellow-300 dark:border-yellow-700' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{tx.description}</span>
                  {tx.review && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{tx.date}</span>
                  <span>·</span>
                  <span>{tx.account}</span>
                  {tx.category && <><span>·</span><span>{tx.category}</span></>}
                </div>
                {tx.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{tx.notes}</p>}
                {tx.review && tx.review_note && <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">{tx.review_note}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-sm font-bold ${tx.type === 'Income' ? 'text-green-600' : 'text-destructive'}`}>
                  {tx.type === 'Income' ? '+' : '-'}{fmt$d(Number(tx.amount))}
                </span>
                <button onClick={() => { setEditTx(tx); setDialogOpen(true) }} className="p-1 text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => deleteMutation.mutate(tx.id)} className="p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <TxDialog
        tx={editTx}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={data => saveMutation.mutate(data)}
      />
    </div>
  )
}

// ── CSV Import Tab ────────────────────────────────────────────────────────
function CsvImportTab({ transactions, onRefresh }: { transactions: Transaction[]; onRefresh: () => void }) {
  const [statementType, setStatementType] = useState<string>('checking')
  const [preview, setPreview] = useState<Omit<Transaction, 'id' | 'created_at'>[]>([])
  const [importing, setImporting] = useState(false)
  const { toast } = useToast()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text, statementType)
      const unique = dedupe(parsed, transactions)
      setPreview(unique)
      if (unique.length === 0) toast({ title: 'No new transactions', description: 'All rows already exist or could not be parsed.' })
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (preview.length === 0) return
    setImporting(true)
    try {
      await apiRequest('POST', '/finance', preview)
      toast({ title: `Imported ${preview.length} transactions` })
      setPreview([])
      onRefresh()
    } catch (e) {
      toast({ title: 'Import failed', description: String(e), variant: 'destructive' })
    } finally { setImporting(false) }
  }

  return (
    <div className="p-4 space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold">CSV Import</h2>
        <p className="text-sm text-muted-foreground">Import transactions from your bank CSV export. Duplicates are automatically detected and skipped.</p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Statement Type</Label>
          <Select value={statementType} onValueChange={setStatementType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="checking">Checking (TVA)</SelectItem>
              <SelectItem value="savings">Savings (TVA)</SelectItem>
              <SelectItem value="cc">Chase Ink (Credit Card)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border-2 border-dashed border-border p-6 text-center space-y-3">
          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Upload CSV file</p>
            <p className="text-xs text-muted-foreground">Supports Chase, TVA Credit Union, or generic bank exports</p>
          </div>
          <Input type="file" accept=".csv" className="max-w-xs mx-auto cursor-pointer" onChange={handleFile} />
        </div>
      </div>

      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{preview.length} new transactions to import</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreview([])}>
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
              <Button size="sm" onClick={handleImport} disabled={importing}>
                <Check className="h-3.5 w-3.5 mr-1" /> {importing ? 'Importing…' : 'Import All'}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {preview.map((tx, i) => (
              <div key={i} className={`rounded-lg border bg-card px-3 py-2 ${tx.review ? 'border-yellow-300 dark:border-yellow-700' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tx.description}</p>
                    <p className="text-xs text-muted-foreground">{tx.date} · {tx.category || <span className="text-yellow-600">Uncategorized</span>}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {tx.review && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />}
                    <span className={`text-sm font-bold ${tx.type === 'Income' ? 'text-green-600' : 'text-destructive'}`}>
                      {tx.type === 'Income' ? '+' : '-'}{fmt$d(tx.amount)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Finance Page ─────────────────────────────────────────────────────
export default function Finance() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: transactions = [], refetch: refetchTx } = useQuery<Transaction[]>({
    queryKey: ['finance-transactions'],
    queryFn: () => apiGet(`/finance?year=${YEAR}`),
    enabled: unlocked,
    staleTime: 30_000,
  })

  const { data: snapshots = [], refetch: refetchSnaps } = useQuery<Snapshot[]>({
    queryKey: ['finance-snapshots'],
    queryFn: () => apiGet(`/finance?action=snapshots&year=${YEAR}`),
    enabled: unlocked,
    staleTime: 30_000,
  })

  // Auto-seed on first unlock if empty
  useEffect(() => {
    if (!unlocked) return
    refetchTx().then(({ data }) => {
      if (!data || data.length === 0) {
        apiRequest('POST', '/finance?action=seed').then(() => {
          refetchTx()
          refetchSnaps()
        })
      }
    })
  }, [unlocked])

  const refresh = useCallback(() => { refetchTx(); refetchSnaps() }, [refetchTx, refetchSnaps])

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />

  return (
    <div className="flex flex-col">
      {/* Page header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-3">
        <div>
          <h1 className="text-base font-bold">Financial Dashboard</h1>
          <p className="text-xs text-muted-foreground">{YEAR}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="dashboard" className="flex-1">
        <div className="sticky top-[57px] z-10 bg-card border-b px-2">
          <TabsList className="h-9 w-full justify-start bg-transparent gap-0 overflow-x-auto">
            {[
              { value: 'dashboard', label: 'Dashboard' },
              { value: 'pl', label: 'P&L' },
              { value: 'balance', label: 'Balance Sheet' },
              { value: 'transactions', label: 'Transactions' },
              { value: 'import', label: 'CSV Import' },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="shrink-0 text-xs px-3 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="mt-0">
          <DashboardTab transactions={transactions} snapshots={snapshots} />
        </TabsContent>
        <TabsContent value="pl" className="mt-0">
          <PLTab transactions={transactions} />
        </TabsContent>
        <TabsContent value="balance" className="mt-0">
          <BalanceSheetTab snapshots={snapshots} onRefresh={refresh} />
        </TabsContent>
        <TabsContent value="transactions" className="mt-0">
          <TransactionsTab transactions={transactions} onRefresh={refresh} />
        </TabsContent>
        <TabsContent value="import" className="mt-0">
          <CsvImportTab transactions={transactions} onRefresh={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
