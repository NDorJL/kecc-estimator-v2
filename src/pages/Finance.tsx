import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiRequest } from '@/lib/queryClient'
import {
  Lock, AlertTriangle, Upload, Plus, Pencil, Trash2,
  Check, X, RefreshCw, Download, TrendingUp, TrendingDown, Settings2,
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CURRENT_YEAR = new Date().getFullYear()
const AVAILABLE_YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

// IRS Schedule C — Income categories
const INCOME_CATS = [
  'Residential Services',
  'Commercial Services',
  'Subscription Revenue - TCEP',
  'Subscription Revenue - Lawn Care',
  'Subscription Revenue - Other',
  'Other Income',
]

// IRS Schedule C — Expense categories (with line numbers)
const EXPENSE_CATS = [
  'Advertising & Marketing',        // Line 8
  'Car & Truck Expenses',           // Line 9
  'Contract Labor',                 // Line 11  ← 1099 subcontractors
  'Insurance',                      // Line 15
  'Legal & Professional Fees',      // Line 17
  'Office & Software Expenses',     // Line 18
  'Repairs & Maintenance',          // Line 21
  'Supplies & Materials',           // Line 22
  'Taxes & Licenses',               // Line 23
  'Travel & Lodging',               // Line 24a
  'Meals & Entertainment',          // Line 24b (50% deductible)
  'Utilities',                      // Line 25
  'Bank Charges & Interest',        // Line 27b
  'Other Expenses',                 // Line 27b
]
const ALL_CATS = [...INCOME_CATS, ...EXPENSE_CATS]

// Cost of Services categories (direct costs, shown above Gross Profit line)
const COGS_CATS = new Set(['Contract Labor', 'Supplies & Materials'])

// Schedule C line reference (for export and P&L display)
const SCHEDULE_C: Record<string, { line: string; note?: string }> = {
  'Advertising & Marketing':    { line: 'Line 8' },
  'Car & Truck Expenses':       { line: 'Line 9' },
  'Contract Labor':             { line: 'Line 11', note: 'Issue 1099-NEC if ≥ $600/yr per contractor' },
  'Insurance':                  { line: 'Line 15' },
  'Legal & Professional Fees':  { line: 'Line 17' },
  'Office & Software Expenses': { line: 'Line 18' },
  'Repairs & Maintenance':      { line: 'Line 21' },
  'Supplies & Materials':       { line: 'Line 22' },
  'Taxes & Licenses':           { line: 'Line 23' },
  'Travel & Lodging':           { line: 'Line 24a' },
  'Meals & Entertainment':      { line: 'Line 24b', note: '50% deductible — keep receipts' },
  'Utilities':                  { line: 'Line 25' },
  'Bank Charges & Interest':    { line: 'Line 27b' },
  'Other Expenses':             { line: 'Line 27b' },
}

const CAT_COLORS: Record<string, string> = {
  'Residential Services':           '#1B4332',
  'Commercial Services':            '#2D6A4F',
  'Subscription Revenue - TCEP':    '#52B788',
  'Subscription Revenue - Lawn Care':'#74C69D',
  'Subscription Revenue - Other':   '#95D5B2',
  'Other Income':                   '#B7E4C7',
  'Advertising & Marketing':        '#ec4899',
  'Car & Truck Expenses':           '#a78bfa',
  'Contract Labor':                 '#e76f51',
  'Insurance':                      '#f97316',
  'Legal & Professional Fees':      '#8b5cf6',
  'Office & Software Expenses':     '#6366f1',
  'Repairs & Maintenance':          '#14b8a6',
  'Supplies & Materials':           '#84cc16',
  'Taxes & Licenses':               '#f59e0b',
  'Travel & Lodging':               '#0ea5e9',
  'Meals & Entertainment':          '#22c55e',
  'Utilities':                      '#06b6d4',
  'Bank Charges & Interest':        '#f43f5e',
  'Other Expenses':                 '#94a3b8',
}

const ACCOUNTS = [
  'KECC Checking (TVA)',
  'KECC Savings (TVA)',
  'Chase Ink Business Unlimited',
  'Cash',
  'Other',
]

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
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

type PeriodMode = 'month' | 'quarter' | 'ytd' | 'year'
interface Period { mode: PeriodMode; year: number; month: number; quarter: number }

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-CATEGORIZATION RULES (Schedule C aligned)
// ═══════════════════════════════════════════════════════════════════════════
interface CatResult { type: 'Income' | 'Expense' | null; cat: string; review: boolean; note: string }
const RULES: Array<{ test: (d: string) => boolean; type: 'Income' | 'Expense'; cat: string; review?: boolean; note?: string }> = [
  // ── Software / Office ─────────────────────────────────────────
  { test: d => /perplexity|claude|anthropic|dropbox|squarespace|workflowy|\bquo\b|canva|google\s*(workspace|one)|gsuite|quickbooks|intuit|zapier|notion|monday|asana|slack|zoom|microsoft\s*365/i.test(d), type:'Expense', cat:'Office & Software Expenses' },
  // ── Marketing ─────────────────────────────────────────────────
  { test: d => /\bhope\b|social.?media|facebook.?ads|meta.?ads|google.?ads|instagram|mailchimp|constant.?contact|hubspot|seo|advertising/i.test(d), type:'Expense', cat:'Advertising & Marketing' },
  // ── Insurance ────────────────────────────────────────────────
  { test: d => /corterie|liability.*insur|general.?liab|insurance/i.test(d), type:'Expense', cat:'Insurance' },
  // ── Fuel / Vehicle ────────────────────────────────────────────
  { test: d => /shell|bp\b|exxon|chevron|valero|marathon|speedway|sunoco|murphy|kwik.*trip|circle.?k|fuel|gas.sta|pilot.*travel|love.*travel|ta\s+travel|autozone|o'reilly|napa.?auto|car.*wash|parking|toll/i.test(d), type:'Expense', cat:'Car & Truck Expenses' },
  // ── Supplies / Materials ──────────────────────────────────────
  { test: d => /home.?depot|lowe.?s|menards|ace.?hardware|harbor.?freight|true.?value|grainger|fastenal|uline/i.test(d), type:'Expense', cat:'Supplies & Materials' },
  // ── Legal / Professional ──────────────────────────────────────
  { test: d => /attorney|lawyer|accountant|cpa\b|legal|notary/i.test(d), type:'Expense', cat:'Legal & Professional Fees' },
  // ── Utilities ─────────────────────────────────────────────────
  { test: d => /electric|water\s*bill|gas\s*bill|internet|comcast|at&t|verizon|t-mobile|sprint|utility/i.test(d), type:'Expense', cat:'Utilities' },
  // ── Bank charges / CC interest ────────────────────────────────
  { test: d => /bank\s*fee|service.?charge|monthly.?fee|overdraft|wire\s*fee|foreign.?trans|interest.?charge|annual\s*fee/i.test(d), type:'Expense', cat:'Bank Charges & Interest' },
  // ── CC autopay (transfer — needs review) ─────────────────────
  { test: d => /chase.*autopay|chase.*payment|credit.?card.*pay|cc.?payment|autopay/i.test(d), type:'Expense', cat:'Bank Charges & Interest', review: true, note:'CC autopay — if paying principal, this is a balance sheet transfer, not an expense. Confirm with your CPA.' },
  // ── Taxes / Licenses ──────────────────────────────────────────
  { test: d => /irs\b|state.*tax|sales.*tax|business.*license|dba\b|sec.*state|sos\b|llc.*fee/i.test(d), type:'Expense', cat:'Taxes & Licenses' },
  // ── Meals ─────────────────────────────────────────────────────
  { test: d => /restaurant|doordash|uber.?eats|grubhub|chick.?fil|mcdonald|starbucks|chipotle|panera|pizza|diner|cafe|grill|sushi|coffee/i.test(d), type:'Expense', cat:'Meals & Entertainment', note:'50% deductible — keep receipts and note business purpose.' },
  // ── Travel ────────────────────────────────────────────────────
  { test: d => /hotel|airbnb|vrbo|motel|hilton|marriott|hyatt|delta|american\s*air|southwest|united\s*air|airline|rental\s*car|hertz|enterprise\s*rent/i.test(d), type:'Expense', cat:'Travel & Lodging' },
  // ─────────────────────────────────────────────────────────────
  // INCOME
  // ─────────────────────────────────────────────────────────────
  { test: d => /tcep|bailey|grimes/i.test(d), type:'Income', cat:'Subscription Revenue - TCEP' },
  { test: d => /lawn.*sub|mow.*sub|turf.*sub|lawn.*care.*pay|mowing.*pay/i.test(d), type:'Income', cat:'Subscription Revenue - Lawn Care' },
  { test: d => /exterior.*care|kecc|soft.?wash|pressure.*wash|gutter|window.*clean|roof.*clean|house.*wash/i.test(d), type:'Income', cat:'Residential Services' },
  // ── Contract labor flags ──────────────────────────────────────
  { test: d => /cash.*withdrawal|atm.*with|atm\s|cash.?adv/i.test(d), type:'Expense', cat:'Contract Labor', review: true, note:'Cash withdrawal — likely subcontractor pay. Record the contractor name and amount for potential 1099-NEC.' },
  { test: d => /zelle|venmo|cashapp|paypal.*send|apple.?pay.*send/i.test(d), type:'Expense', cat:'Contract Labor', review: true, note:'Digital transfer — confirm if subcontractor pay. Record contractor name for 1099-NEC if ≥ $600/yr.' },
]

function categorize(description: string): CatResult {
  const d = (description || '').toLowerCase()
  for (const r of RULES) {
    if (r.test(d)) return { type: r.type, cat: r.cat, review: r.review || false, note: r.note || '' }
  }
  return { type: null, cat: '', review: true, note: 'Could not auto-categorize — please assign manually.' }
}

// ═══════════════════════════════════════════════════════════════════════════
// PERIOD UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function getInitialPeriod(): Period {
  const now = new Date()
  return { mode: 'ytd', year: now.getFullYear(), month: now.getMonth() + 1, quarter: Math.ceil((now.getMonth() + 1) / 3) }
}

function txDate(tx: Transaction) { return new Date(tx.date + 'T12:00:00') }
function txYear(tx: Transaction)  { return txDate(tx).getFullYear() }
function txMonth(tx: Transaction) { return txDate(tx).getMonth() + 1 }
function txQuarter(tx: Transaction) { return Math.ceil(txMonth(tx) / 3) }

function filterByPeriod(transactions: Transaction[], period: Period): Transaction[] {
  const nowMonth = new Date().getMonth() + 1
  return transactions.filter(tx => {
    if (txYear(tx) !== period.year) return false
    switch (period.mode) {
      case 'month':   return txMonth(tx) === period.month
      case 'quarter': return txQuarter(tx) === period.quarter
      case 'ytd':     return txMonth(tx) <= nowMonth
      case 'year':    return true
    }
  })
}

function periodLabel(period: Period): string {
  switch (period.mode) {
    case 'month':   return `${MONTHS[period.month - 1]} ${period.year}`
    case 'quarter': return `Q${period.quarter} ${period.year}`
    case 'ytd':     return `YTD ${period.year}`
    case 'year':    return `FY ${period.year}`
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════════
interface PLRow { income: Record<string, number>; expenses: Record<string, number>; totalIncome: number; totalCOGS: number; grossProfit: number; totalOpEx: number; totalExpenses: number; net: number }

function calcPLRow(transactions: Transaction[]): PLRow {
  const income: Record<string, number> = {}
  const expenses: Record<string, number> = {}
  for (const c of INCOME_CATS) income[c] = 0
  for (const c of EXPENSE_CATS) expenses[c] = 0
  for (const tx of transactions) {
    if (tx.type === 'Income' && income[tx.category] !== undefined) income[tx.category] += Number(tx.amount)
    else if (tx.type === 'Expense' && expenses[tx.category] !== undefined) expenses[tx.category] += Number(tx.amount)
  }
  const totalIncome = Object.values(income).reduce((a, b) => a + b, 0)
  const totalCOGS = EXPENSE_CATS.filter(c => COGS_CATS.has(c)).reduce((s, c) => s + (expenses[c] || 0), 0)
  const grossProfit = totalIncome - totalCOGS
  const totalOpEx = EXPENSE_CATS.filter(c => !COGS_CATS.has(c)).reduce((s, c) => s + (expenses[c] || 0), 0)
  const totalExpenses = totalCOGS + totalOpEx
  return { income, expenses, totalIncome, totalCOGS, grossProfit, totalOpEx, totalExpenses, net: totalIncome - totalExpenses }
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTING & EXPORT
// ═══════════════════════════════════════════════════════════════════════════
const fmt$ = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0)
const fmt$d = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0)

function exportCSV(transactions: Transaction[], filename: string) {
  const headers = ['Date', 'Description', 'Type', 'Category', 'Schedule C Line', 'Deductible Note', 'Amount', 'Account', 'Notes']
  const rows = transactions
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(tx => [
      tx.date,
      `"${tx.description.replace(/"/g, '""')}"`,
      tx.type,
      `"${tx.category}"`,
      SCHEDULE_C[tx.category]?.line || '',
      `"${SCHEDULE_C[tx.category]?.note || ''}"`,
      tx.amount.toFixed(2),
      `"${tx.account}"`,
      `"${(tx.notes || '').replace(/"/g, '""')}"`,
    ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV PARSER
// ═══════════════════════════════════════════════════════════════════════════
type CsvFormat = 'DEBIT_CREDIT' | 'CHASE_CC' | 'CHASE_CHECKING' | 'GENERIC' | 'UNKNOWN'

function detectCsvFormat(headers: string[]): CsvFormat {
  const h = headers.map(x => (x || '').toLowerCase().trim())
  const has = (k: string) => h.some(x => x.includes(k))
  // Debit/Credit OR Withdrawal/Deposit column pairs (TVA, most credit unions)
  if ((has('debit') || has('withdrawal')) && (has('credit') || has('deposit'))) return 'DEBIT_CREDIT'
  if (has('transaction date') && has('type'))        return 'CHASE_CC'
  if (has('posting date') && has('details'))         return 'CHASE_CHECKING'
  if (has('amount') || has('transaction amount'))    return 'GENERIC'
  return 'UNKNOWN'
}

function parseCSVFile(csvText: string, statementType: string): Omit<Transaction, 'id' | 'created_at'>[] {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []

  // Handle quoted CSV properly
  const parseLine = (line: string): string[] => {
    const result: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    result.push(cur.trim())
    return result
  }

  const headers = parseLine(lines[0]).map(h => h.replace(/"/g, '').trim())
  const fmt = detectCsvFormat(headers)
  const results: Omit<Transaction, 'id' | 'created_at'>[] = []

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const vals = parseLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').replace(/"/g, '').trim() })

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
      if (debit > 0)  { amount = debit;  isDebit = true }
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

    const defaultType = isDebit ? 'Expense' : 'Income'
    const { cat, review, note } = categorize(desc)
    const finalType: 'Income' | 'Expense' = cat
      ? (INCOME_CATS.includes(cat) ? 'Income' : 'Expense')
      : defaultType
    const account = statementType === 'cc'      ? 'Chase Ink Business Unlimited'
                  : statementType === 'savings' ? 'KECC Savings (TVA)'
                  :                               'KECC Checking (TVA)'

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
    Math.abs(Number(e.amount) - tx.amount) < 0.01 &&
    e.description.toLowerCase().slice(0, 20) === tx.description.toLowerCase().slice(0, 20)
  ))
}

// ═══════════════════════════════════════════════════════════════════════════
// PIN GATE
// ═══════════════════════════════════════════════════════════════════════════
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
      if (data.valid) { sessionStorage.setItem(SESSION_KEY, '1'); onUnlock() }
      else { setFailed(true); setPin('') }
    } catch {
      toast({ title: 'Error', description: 'Could not verify PIN. Check your connection.', variant: 'destructive' })
    } finally { setLoading(false) }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-8">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Financial Dashboard</h2>
          <p className="text-sm text-muted-foreground">Enter your PIN to access financial data</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input type="password" inputMode="numeric" placeholder="Enter PIN" value={pin}
            onChange={e => setPin(e.target.value)}
            className={`text-center text-lg tracking-widest ${failed ? 'border-destructive' : ''}`}
            autoFocus />
          {failed && <p className="text-sm text-destructive">Incorrect PIN. Try again.</p>}
          <Button type="submit" className="w-full" disabled={loading || !pin}>
            {loading ? 'Verifying…' : 'Unlock'}
          </Button>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PERIOD SELECTOR
// ═══════════════════════════════════════════════════════════════════════════
function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={String(period.year)} onValueChange={v => onChange({ ...period, year: Number(v) })}>
        <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {AVAILABLE_YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex rounded-lg border overflow-hidden text-xs">
        {(['month', 'quarter', 'ytd', 'year'] as const).map(m => (
          <button key={m} onClick={() => onChange({ ...period, mode: m })}
            className={`px-2.5 py-1.5 font-medium border-r last:border-0 transition-colors ${period.mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
            {m === 'ytd' ? 'YTD' : m === 'year' ? 'Annual' : m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {period.mode === 'month' && (
        <Select value={String(period.month)} onValueChange={v => onChange({ ...period, month: Number(v) })}>
          <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {period.mode === 'quarter' && (
        <div className="flex gap-1">
          {[1, 2, 3, 4].map(q => (
            <button key={q} onClick={() => onChange({ ...period, quarter: q })}
              className={`w-9 h-8 text-xs font-semibold rounded border transition-colors ${period.quarter === q ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>
              Q{q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI CARD
// ═══════════════════════════════════════════════════════════════════════════
function KpiCard({ label, value, sub, positive, icon }: { label: string; value: string; sub?: string; positive?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className={`text-xl font-bold ${positive === true ? 'text-green-600 dark:text-green-400' : positive === false ? 'text-destructive' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════════════════
function DashboardTab({ transactions, snapshots, period }: { transactions: Transaction[]; snapshots: Snapshot[]; period: Period }) {
  const filtered = useMemo(() => filterByPeriod(transactions, period), [transactions, period])
  const pl = useMemo(() => calcPLRow(filtered), [filtered])

  // Prior period for comparison
  const priorPeriod = useMemo((): Period => {
    if (period.mode === 'month') {
      const pm = period.month === 1 ? 12 : period.month - 1
      const py = period.month === 1 ? period.year - 1 : period.year
      return { ...period, month: pm, year: py }
    }
    if (period.mode === 'quarter') {
      const pq = period.quarter === 1 ? 4 : period.quarter - 1
      const py = period.quarter === 1 ? period.year - 1 : period.year
      return { ...period, quarter: pq, year: py }
    }
    return { ...period, year: period.year - 1 }
  }, [period])
  const priorPL = useMemo(() => calcPLRow(filterByPeriod(transactions, priorPeriod)), [transactions, priorPeriod])

  // Monthly trend (full year)
  const monthlyTrend = useMemo(() =>
    MONTHS.map((label, i) => {
      const mo = filterByPeriod(transactions, { ...period, mode: 'month', month: i + 1 })
      const mopl = calcPLRow(mo)
      return { month: label, Revenue: Math.round(mopl.totalIncome * 100) / 100, Expenses: Math.round(mopl.totalExpenses * 100) / 100, Net: Math.round(mopl.net * 100) / 100 }
    }), [transactions, period])

  // Quarterly comparison
  const quarterlyTrend = useMemo(() =>
    [1, 2, 3, 4].map(q => {
      const qPl = calcPLRow(filterByPeriod(transactions, { ...period, mode: 'quarter', quarter: q }))
      return { quarter: `Q${q}`, Revenue: Math.round(qPl.totalIncome * 100) / 100, Expenses: Math.round(qPl.totalExpenses * 100) / 100, Net: Math.round(qPl.net * 100) / 100 }
    }), [transactions, period])

  // Revenue by category (pie)
  const revenuePie = INCOME_CATS
    .map(cat => ({ name: cat.replace('Subscription Revenue - ', 'Sub - ').replace(' Services', ''), value: Math.round((pl.income[cat] || 0) * 100) / 100, fill: CAT_COLORS[cat] }))
    .filter(x => x.value > 0)

  // Expense by category (horizontal bar — sorted by amount)
  const expenseBar = EXPENSE_CATS
    .map(cat => ({ name: cat, shortName: cat.replace('& ', '').split(' ').slice(0, 2).join(' '), value: Math.round((pl.expenses[cat] || 0) * 100) / 100 }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)

  const reviewCount = filtered.filter(t => t.review).length
  const grossMargin = pl.totalIncome > 0 ? (pl.grossProfit / pl.totalIncome) * 100 : 0
  const netMargin = pl.totalIncome > 0 ? (pl.net / pl.totalIncome) * 100 : 0

  const incomeChange = pl.totalIncome - priorPL.totalIncome
  const netChange = pl.net - priorPL.net

  return (
    <div className="space-y-5 p-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Revenue" value={fmt$(pl.totalIncome)} positive={pl.totalIncome > 0}
          sub={incomeChange !== 0 ? `${incomeChange >= 0 ? '+' : ''}${fmt$(incomeChange)} vs prior` : undefined}
          icon={<TrendingUp className="h-4 w-4" />} />
        <KpiCard label="Expenses" value={fmt$(pl.totalExpenses)}
          sub={`COGS ${fmt$(pl.totalCOGS)} · OpEx ${fmt$(pl.totalOpEx)}`} />
        <KpiCard label="Net Income" value={fmt$(pl.net)} positive={pl.net >= 0}
          sub={netChange !== 0 ? `${netChange >= 0 ? '+' : ''}${fmt$(netChange)} vs prior` : undefined}
          icon={pl.net >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} />
        <KpiCard label="Net Margin" value={`${netMargin.toFixed(1)}%`} positive={netMargin > 0}
          sub={`Gross margin: ${grossMargin.toFixed(1)}%`} />
      </div>

      {/* Review alert */}
      {reviewCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span><strong>{reviewCount}</strong> transaction{reviewCount > 1 ? 's' : ''} need review this period — check the Transactions tab.</span>
        </div>
      )}

      {/* Monthly Revenue vs Expenses */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Monthly Revenue vs Expenses — {period.year}</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt$d(v)} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Revenue" fill="#52B788" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Expenses" fill="#E63946" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Quarterly comparison */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Quarterly Comparison — {period.year}</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={quarterlyTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="quarter" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt$d(v)} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Revenue" fill="#52B788" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Expenses" fill="#E63946" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Net" fill="#1B4332" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Net cash flow trend */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Net Income Trend — {period.year}</h3>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={monthlyTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt$d(v)} />
            <Line type="monotone" dataKey="Net" stroke="#1B4332" strokeWidth={2} dot={{ r: 3, fill: '#52B788' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue breakdown */}
      {revenuePie.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Revenue by Source — {periodLabel(period)}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={revenuePie} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={80} innerRadius={40}>
                {revenuePie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmt$d(v)} />
              <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Expense breakdown */}
      {expenseBar.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Expenses by Category — {periodLabel(period)}</h3>
          <div className="space-y-2">
            {expenseBar.map(e => (
              <div key={e.name} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{e.name}</span>
                  <span className="font-medium">{fmt$d(e.value)}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(e.value / expenseBar[0].value) * 100}%`, backgroundColor: CAT_COLORS[e.name] || '#94a3b8' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
          <p className="text-muted-foreground text-sm">No transactions for {periodLabel(period)}.</p>
          <p className="text-muted-foreground text-xs mt-1">Upload bank statements using the CSV Import tab.</p>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// P&L TAB (Income Statement — Schedule C format)
// ═══════════════════════════════════════════════════════════════════════════
function PLTab({ transactions, period }: { transactions: Transaction[]; period: Period }) {
  // Build columns based on period mode
  const columns = useMemo(() => {
    if (period.mode === 'month') {
      return [{ label: MONTHS[period.month - 1], txs: filterByPeriod(transactions, period) }]
    }
    if (period.mode === 'quarter') {
      const qMonths = [1, 2, 3].map(offset => ((period.quarter - 1) * 3) + offset)
      return [
        ...qMonths.map(m => ({ label: MONTHS[m - 1], txs: filterByPeriod(transactions, { ...period, mode: 'month', month: m }) })),
        { label: `Q${period.quarter} Total`, txs: filterByPeriod(transactions, period) },
      ]
    }
    if (period.mode === 'ytd' || period.mode === 'year') {
      const nowMonth = period.mode === 'ytd' ? new Date().getMonth() + 1 : 12
      const activeCols = MONTHS.slice(0, nowMonth).map((label, i) => ({
        label, txs: filterByPeriod(transactions, { ...period, mode: 'month', month: i + 1 }),
      })).filter(c => {
        const p = calcPLRow(c.txs)
        return p.totalIncome > 0 || p.totalExpenses > 0
      })
      const ytdTxs = filterByPeriod(transactions, period)
      return [...activeCols, { label: period.mode === 'ytd' ? 'YTD Total' : 'Annual Total', txs: ytdTxs }]
    }
    return []
  }, [transactions, period])

  const pls = useMemo(() => columns.map(c => calcPLRow(c.txs)), [columns])
  const showSC = columns.length === 1 // show Schedule C line when only one column

  const PLrow = ({ cat, isIncome }: { cat: string; isIncome: boolean }) => {
    const vals = pls.map(p => isIncome ? (p.income[cat] || 0) : (p.expenses[cat] || 0))
    if (vals.every(v => v === 0)) return null
    const sc = SCHEDULE_C[cat]
    return (
      <tr className="border-b border-border/30 hover:bg-muted/20">
        <td className="py-1.5 pr-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CAT_COLORS[cat] }} />
            <span className="text-xs text-muted-foreground">{cat}</span>
            {sc && <span className="text-[10px] text-muted-foreground/60 ml-1">{sc.line}</span>}
          </div>
        </td>
        {vals.map((v, i) => (
          <td key={i} className="text-right py-1.5 px-2 text-xs font-medium">{v ? fmt$d(v) : <span className="text-muted-foreground/40">—</span>}</td>
        ))}
      </tr>
    )
  }

  const SummaryRow = ({ label, vals, positive, bold, border }: { label: string; vals: number[]; positive?: boolean; bold?: boolean; border?: boolean }) => (
    <tr className={`${border ? 'border-y-2 border-border' : 'border-b border-border'} ${bold ? 'font-bold' : 'font-semibold'} bg-muted/30`}>
      <td className={`py-2 pr-2 ${bold ? 'text-sm' : 'text-xs'}`}>{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={`text-right py-2 px-2 ${bold ? 'text-sm' : 'text-xs'} ${positive !== undefined ? (v >= 0 ? 'text-green-700 dark:text-green-400' : 'text-destructive') : ''}`}>
          {fmt$d(v)}
        </td>
      ))}
    </tr>
  )

  return (
    <div className="p-4 space-y-2">
      <h2 className="text-lg font-bold">Income Statement</h2>
      <p className="text-xs text-muted-foreground">IRS Schedule C format · {periodLabel(period)}</p>

      {columns.length === 0 || pls.every(p => p.totalIncome === 0 && p.totalExpenses === 0) ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center mt-4">
          <p className="text-muted-foreground text-sm">No transactions for this period. Upload statements first.</p>
        </div>
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs border-collapse" style={{ minWidth: Math.max(320, columns.length * 100 + 160) }}>
            <thead>
              <tr className="border-b-2">
                <th className="text-left py-2 pr-2 font-semibold text-muted-foreground w-44">Account</th>
                {columns.map((c, i) => (
                  <th key={i} className={`text-right py-2 px-2 font-semibold text-muted-foreground whitespace-nowrap ${i === columns.length - 1 ? 'font-bold text-foreground' : ''}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* REVENUE */}
              <tr><td colSpan={columns.length + 1} className="pt-3 pb-1 text-xs font-bold text-green-700 dark:text-green-400 uppercase tracking-wide">Revenue</td></tr>
              {INCOME_CATS.map(cat => <PLrow key={cat} cat={cat} isIncome={true} />)}
              <SummaryRow label="Total Revenue" vals={pls.map(p => p.totalIncome)} positive />

              {/* COST OF SERVICES */}
              <tr><td colSpan={columns.length + 1} className="pt-3 pb-1 text-xs font-bold text-orange-700 uppercase tracking-wide">Cost of Services</td></tr>
              {EXPENSE_CATS.filter(c => COGS_CATS.has(c)).map(cat => <PLrow key={cat} cat={cat} isIncome={false} />)}
              <SummaryRow label="Total Cost of Services" vals={pls.map(p => p.totalCOGS)} />

              <SummaryRow label="Gross Profit" vals={pls.map(p => p.grossProfit)} positive border />
              <tr>
                <td className="pb-2 text-xs text-muted-foreground italic">Gross Margin</td>
                {pls.map((p, i) => (
                  <td key={i} className="text-right pb-2 px-2 text-xs text-muted-foreground italic">
                    {p.totalIncome > 0 ? `${((p.grossProfit / p.totalIncome) * 100).toFixed(1)}%` : '—'}
                  </td>
                ))}
              </tr>

              {/* OPERATING EXPENSES */}
              <tr><td colSpan={columns.length + 1} className="pt-3 pb-1 text-xs font-bold text-destructive uppercase tracking-wide">Operating Expenses</td></tr>
              {EXPENSE_CATS.filter(c => !COGS_CATS.has(c)).map(cat => <PLrow key={cat} cat={cat} isIncome={false} />)}
              <SummaryRow label="Total Operating Expenses" vals={pls.map(p => p.totalOpEx)} />

              {/* NET INCOME */}
              <SummaryRow label="Net Income / (Loss)" vals={pls.map(p => p.net)} positive bold border />
              <tr>
                <td className="pb-2 text-xs text-muted-foreground italic">Net Margin</td>
                {pls.map((p, i) => (
                  <td key={i} className="text-right pb-2 px-2 text-xs text-muted-foreground italic">
                    {p.totalIncome > 0 ? `${((p.net / p.totalIncome) * 100).toFixed(1)}%` : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE SHEET TAB
// ═══════════════════════════════════════════════════════════════════════════
type SnapField = 'checking' | 'savings' | 'equipment' | 'vehicles' | 'real_estate' | 'other_assets' | 'chase_ink' | 'auto_loan' | 'biz_loan' | 'other_liab'
const BS_FIELDS: { key: SnapField; label: string; section: 'assets' | 'liabilities' }[] = [
  { key: 'checking',     label: 'Checking (TVA)',          section: 'assets' },
  { key: 'savings',      label: 'Savings (TVA)',           section: 'assets' },
  { key: 'equipment',    label: 'Equipment & Tools',       section: 'assets' },
  { key: 'vehicles',     label: 'Vehicles',                section: 'assets' },
  { key: 'real_estate',  label: 'Real Estate',             section: 'assets' },
  { key: 'other_assets', label: 'Other Assets',            section: 'assets' },
  { key: 'chase_ink',    label: 'Chase Ink Balance',       section: 'liabilities' },
  { key: 'auto_loan',    label: 'Auto Loan',               section: 'liabilities' },
  { key: 'biz_loan',     label: 'Business Loan',           section: 'liabilities' },
  { key: 'other_liab',   label: 'Other Liabilities',       section: 'liabilities' },
]

function BalanceSheetTab({ snapshots, period, onRefresh }: { snapshots: Snapshot[]; period: Period; onRefresh: () => void }) {
  const selMonth = period.mode === 'month' ? period.month : new Date().getMonth() + 1
  const [editMonth, setEditMonth] = useState(selMonth)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<SnapField, number>>({} as Record<SnapField, number>)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const snap = snapshots.find(s => s.month === editMonth && s.year === period.year)

  const initForm = () => {
    const init: Record<SnapField, number> = {} as Record<SnapField, number>
    BS_FIELDS.forEach(f => { init[f.key] = snap ? Number(snap[f.key]) : 0 })
    setForm(init)
  }

  const assets = BS_FIELDS.filter(f => f.section === 'assets')
  const liabs = BS_FIELDS.filter(f => f.section === 'liabilities')
  const val = (f: SnapField) => editing ? (form[f] || 0) : Number(snap?.[f] || 0)
  const totalAssets = assets.reduce((s, f) => s + val(f.key), 0)
  const totalLiabs = liabs.reduce((s, f) => s + val(f.key), 0)
  const equity = totalAssets - totalLiabs

  async function handleSave() {
    setSaving(true)
    try {
      await apiRequest('POST', '/finance?action=snapshots', { month: editMonth, year: period.year, ...form })
      toast({ title: 'Balance sheet saved' })
      setEditing(false); onRefresh()
    } catch (e) {
      toast({ title: 'Save failed', description: String(e), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const BsRow = ({ f }: { f: typeof BS_FIELDS[0] }) => (
    <div className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{f.label}</span>
      {editing
        ? <Input type="number" className="h-7 w-28 text-right text-sm" value={form[f.key] || ''}
            onChange={e => setForm(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))} />
        : <span className="text-sm font-medium">{fmt$d(Number(snap?.[f.key] || 0))}</span>}
    </div>
  )

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Balance Sheet</h2>
          <p className="text-xs text-muted-foreground">Point-in-time snapshot</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(editMonth)} onValueChange={v => { setEditMonth(Number(v)); setEditing(false) }}>
            <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m} {period.year}</SelectItem>)}</SelectContent>
          </Select>
          {!editing && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { initForm(); setEditing(true) }}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Button>}
        </div>
      </div>

      {!snap && !editing && (
        <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-xl">
          No balance sheet for {MONTHS[editMonth - 1]} {period.year}.{' '}
          <button className="text-primary underline" onClick={() => { initForm(); setEditing(true) }}>Add one</button>
        </div>
      )}

      <div className="space-y-3">
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-green-50 dark:bg-green-950/30 font-semibold text-sm text-green-700 dark:text-green-400">Assets</div>
          {assets.map(f => <BsRow key={f.key} f={f} />)}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-t font-bold text-sm">
            <span>Total Assets</span><span className="text-green-700 dark:text-green-400">{fmt$d(totalAssets)}</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-red-50 dark:bg-red-950/30 font-semibold text-sm text-destructive">Liabilities</div>
          {liabs.map(f => <BsRow key={f.key} f={f} />)}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-t font-bold text-sm">
            <span>Total Liabilities</span><span className="text-destructive">{fmt$d(totalLiabs)}</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card flex items-center justify-between px-4 py-3 font-bold">
          <span>Owner's Equity (Net Worth)</span>
          <span className={equity >= 0 ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>{fmt$d(equity)}</span>
        </div>

        {editing && (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleSave} disabled={saving}><Check className="h-4 w-4 mr-1" />{saving ? 'Saving…' : 'Save'}</Button>
            <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION EDIT DIALOG
// ═══════════════════════════════════════════════════════════════════════════
function TxDialog({ tx, open, onClose, onSave }: {
  tx: Partial<Transaction> | null; open: boolean; onClose: () => void; onSave: (d: Partial<Transaction>) => void
}) {
  const [form, setForm] = useState<Partial<Transaction>>(tx || {})
  // Sync form whenever the transaction being edited changes
  useEffect(() => { setForm(tx || {}) }, [tx])
  const set = (k: keyof Transaction, v: string | number | boolean) => setForm(p => ({ ...p, [k]: v }))
  const catList = form.type === 'Income' ? INCOME_CATS : form.type === 'Expense' ? EXPENSE_CATS : ALL_CATS

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{tx?.id ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date || ''} onChange={e => set('date', e.target.value)} /></div>
            <div className="space-y-1"><Label>Type</Label>
              <Select value={form.type ?? '__NONE__'} onValueChange={v => { set('type', v); set('category', '__NONE__') }}>
                <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__" disabled>Select type…</SelectItem>
                  <SelectItem value="Income">Income</SelectItem>
                  <SelectItem value="Expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label>Description</Label><Input value={form.description || ''} onChange={e => set('description', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Amount ($)</Label><Input type="number" step="0.01" min="0" value={form.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)} /></div>
            <div className="space-y-1"><Label>Account</Label>
              <Select value={form.account || ACCOUNTS[0]} onValueChange={v => set('account', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label>Category</Label>
            <Select value={form.category && form.category !== '__NONE__' ? form.category : '__NONE__'} onValueChange={v => set('category', v === '__NONE__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select category…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__" disabled>Select category…</SelectItem>
                {catList.map(c => (
                  <SelectItem key={c} value={c}>
                    {c}{SCHEDULE_C[c] ? ` · ${SCHEDULE_C[c].line}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.category && SCHEDULE_C[form.category]?.note && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">{SCHEDULE_C[form.category].note}</p>
            )}
          </div>
          <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.date || !form.description || !form.amount || !form.type}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTIONS TAB
// ═══════════════════════════════════════════════════════════════════════════
const PAGE_SIZE = 50

function TransactionsTab({ transactions, period, onRefresh }: { transactions: Transaction[]; period: Period; onRefresh: () => void }) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'Income' | 'Expense' | 'review'>('all')
  const [catFilter, setCatFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [editTx, setEditTx] = useState<Partial<Transaction> | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const { toast } = useToast()

  // Reset page when filters change
  useEffect(() => setPage(0), [typeFilter, catFilter, search, period])

  const periodFiltered = useMemo(() => filterByPeriod(transactions, period), [transactions, period])

  const filtered = useMemo(() => {
    let list = [...periodFiltered]
    if (typeFilter === 'Income')       list = list.filter(t => t.type === 'Income')
    else if (typeFilter === 'Expense') list = list.filter(t => t.type === 'Expense')
    else if (typeFilter === 'review')  list = list.filter(t => t.review)
    if (catFilter) list = list.filter(t => (t.category || '') === catFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [periodFiltered, typeFilter, catFilter, search])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageSlice = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page])

  const reviewCount   = periodFiltered.filter(t => t.review).length
  const totalIncome   = filtered.filter(t => t.type === 'Income').reduce((s, t) => s + Number(t.amount), 0)
  const totalExpense  = filtered.filter(t => t.type === 'Expense').reduce((s, t) => s + Number(t.amount), 0)

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<Transaction>) => {
      if (data.id) await apiRequest('PATCH', `/finance?id=${data.id}`, data)
      else await apiRequest('POST', '/finance', data)
    },
    onSuccess: () => { toast({ title: 'Transaction saved' }); setDialogOpen(false); onRefresh() },
    onError: e => toast({ title: 'Error', description: String(e), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/finance?id=${id}`),
    onSuccess: () => { toast({ title: 'Transaction deleted' }); setDeleteId(null); onRefresh() },
    onError: e => toast({ title: 'Error', description: String(e), variant: 'destructive' }),
  })

  const usedCats = useMemo(() => [...new Set(periodFiltered.map(t => t.category).filter(Boolean))].sort(), [periodFiltered])

  return (
    <div className="space-y-3 p-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border bg-card px-3 py-2 text-xs">
          <div className="text-muted-foreground">Income</div>
          <div className="font-bold text-green-600 dark:text-green-400">{fmt$d(totalIncome)}</div>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2 text-xs">
          <div className="text-muted-foreground">Expenses</div>
          <div className="font-bold text-destructive">{fmt$d(totalExpense)}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Input className="h-8 flex-1 text-sm" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        <Button size="sm" variant="outline" className="h-8 px-2" title="Export CSV"
          onClick={() => { exportCSV(filtered, `KECC-${periodLabel(period).replace(/ /g, '-')}.csv`); toast({ title: `Exported ${filtered.length} transactions` }) }}>
          <Download className="h-4 w-4" />
        </Button>
        <Button size="sm" className="h-8 px-2"
          onClick={() => { setEditTx({ type: 'Expense', date: new Date().toISOString().slice(0, 10), account: 'KECC Checking (TVA)' }); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Type filter pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {(['all', 'Income', 'Expense', 'review'] as const).map(f => (
          <button key={f} onClick={() => setTypeFilter(f)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${typeFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground'}`}>
            {f === 'review' ? `Needs Review (${reviewCount})` : f === 'all' ? `All (${filtered.length})` : f}
          </button>
        ))}
      </div>

      {/* Category filter */}
      {usedCats.length > 0 && (
        <Select value={catFilter || '__ALL__'} onValueChange={v => { setCatFilter(v === '__ALL__' ? '' : v); setPage(0) }}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__ALL__">All categories</SelectItem>
            {usedCats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {/* Transactions list — paginated */}
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-sm">
            {periodFiltered.length === 0
              ? 'No transactions for this period. Upload statements via CSV Import.'
              : 'No results matching your filters.'}
          </div>
        )}
        {pageSlice.map(tx => (
          <div key={tx.id} className={`rounded-xl border bg-card px-3 py-2.5 ${tx.review ? 'border-yellow-300 dark:border-yellow-700' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium truncate">{tx.description}</span>
                  {tx.review && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{tx.date}</span>
                  <span>·</span>
                  <span className={`font-medium ${!tx.category ? 'text-yellow-600' : ''}`}>{tx.category || 'Uncategorized'}</span>
                  {SCHEDULE_C[tx.category] && <span className="text-muted-foreground/60">{SCHEDULE_C[tx.category].line}</span>}
                  <span>·</span>
                  <span>{tx.account}</span>
                </div>
                {tx.notes && <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{tx.notes}</p>}
                {tx.review && tx.review_note && <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">{tx.review_note}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-sm font-bold ${tx.type === 'Income' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                  {tx.type === 'Income' ? '+' : '−'}{fmt$d(Number(tx.amount))}
                </span>
                <button onClick={() => { setEditTx(tx); setDialogOpen(true) }} className="p-1 text-muted-foreground hover:text-foreground rounded">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setDeleteId(tx.id)} className="p-1 text-muted-foreground hover:text-destructive rounded">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <Button variant="outline" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</Button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages} · {filtered.length} total</span>
          <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</Button>
        </div>
      )}

      {/* Edit dialog */}
      <TxDialog tx={editTx} open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={data => saveMutation.mutate(data)} />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Delete transaction?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently remove the transaction from your records.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF TEXT PARSER
// Extracts transactions from raw text pulled out of bank-statement PDFs.
// Works by scanning for lines that contain a date + amount pattern.
// ═══════════════════════════════════════════════════════════════════════════
function parsePDFText(text: string, statementType: string): Omit<Transaction, 'id' | 'created_at'>[] {
  const results: Omit<Transaction, 'id' | 'created_at'>[] = []
  // Match patterns like:  01/15/2026   Some Description   $1,234.56
  //                       01/15/26     Some Description   1,234.56
  const lineRe = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+\$?([\d,]+\.\d{2})\s*$/gm
  let match
  while ((match = lineRe.exec(text)) !== null) {
    const [, rawDate, rawDesc, rawAmt] = match
    let normalDate = ''
    try {
      const d = new Date(rawDate)
      if (!isNaN(d.getTime())) normalDate = d.toISOString().slice(0, 10)
    } catch { continue }
    if (!normalDate) continue
    const amount = parseFloat(rawAmt.replace(/,/g, '')) || 0
    if (!amount) continue
    const desc = rawDesc.trim()
    const { type: catType, cat, review, note } = categorize(desc)
    const account = statementType === 'cc'      ? 'Chase Ink Business Unlimited'
                  : statementType === 'savings' ? 'KECC Savings (TVA)'
                  :                               'KECC Checking (TVA)'
    // PDFs don't have a clear debit/credit column — flag everything for review
    const type: 'Income' | 'Expense' = catType ?? (statementType === 'cc' ? 'Expense' : 'Expense')
    const finalType = cat ? (INCOME_CATS.includes(cat) ? 'Income' : 'Expense') : type
    results.push({
      date: normalDate, description: desc, amount,
      type: finalType, category: cat || '',
      account, notes: '',
      review: true, // always flag PDF imports for manual review
      review_note: note || 'PDF import — verify amount and Income/Expense classification.',
      source: 'upload',
    })
  }
  return results
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV IMPORT TAB  — editable preview before committing
// ═══════════════════════════════════════════════════════════════════════════
type PreviewRow = Omit<Transaction, 'id' | 'created_at'>

function CsvImportTab({ transactions, onRefresh }: { transactions: Transaction[]; onRefresh: () => void }) {
  const [statementType, setStatementType] = useState('checking')
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [importing, setImporting] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const { toast } = useToast()

  // Update a single preview row
  function updateRow(i: number, changes: Partial<PreviewRow>) {
    setPreview(prev => prev.map((row, idx) => idx === i ? { ...row, ...changes } : row))
  }

  // Flip a row's Income/Expense classification
  function flipType(i: number) {
    setPreview(prev => prev.map((row, idx) => {
      if (idx !== i) return row
      const newType: 'Income' | 'Expense' = row.type === 'Income' ? 'Expense' : 'Income'
      // Reset category if it doesn't belong to the new type
      const validCats = newType === 'Income' ? INCOME_CATS : EXPENSE_CATS
      return { ...row, type: newType, category: validCats.includes(row.category) ? row.category : '' }
    }))
  }

  function removeRow(i: number) {
    setPreview(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()

    try {
      let parsed: Omit<Transaction, 'id' | 'created_at'>[] = []

      if (ext === 'pdf') {
        // Lazy-load pdfjs so it doesn't bloat the initial bundle
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).toString()

        const arrayBuf = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise
        let fullText = ''
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p)
          const content = await page.getTextContent()
          const pageText = content.items
            .map((item: { str?: string }) => item.str ?? '')
            .join(' ')
          fullText += pageText + '\n'
        }
        parsed = parsePDFText(fullText, statementType)
      } else {
        // CSV / TXT
        const text = await file.text()
        parsed = parseCSVFile(text, statementType)
      }

      const unique = dedupe(parsed, transactions)
      if (unique.length === 0) {
        toast({ title: 'No new transactions found', description: 'All rows already exist or the file could not be parsed.' })
      } else {
        setPreview(unique)
        const dupes = parsed.length - unique.length
        toast({
          title: `${unique.length} transaction${unique.length !== 1 ? 's' : ''} ready to review`,
          description: dupes > 0 ? `${dupes} duplicate(s) skipped.` : undefined,
        })
      }
    } catch (err) {
      toast({ title: 'Could not read file', description: String(err), variant: 'destructive' })
    }
    e.target.value = ''
  }

  async function handleImport() {
    const toImport = preview.filter(r => r.type && r.category) // skip any still-uncategorized
    const skipped = preview.length - toImport.length
    if (!toImport.length) {
      toast({ title: 'Nothing to import', description: 'Assign a category to each row first.' })
      return
    }
    setImporting(true)
    try {
      await apiRequest('POST', '/finance', toImport)
      toast({ title: `Imported ${toImport.length} transactions${skipped > 0 ? ` (${skipped} uncategorized skipped)` : ''}` })
      setPreview([]); onRefresh()
    } catch (e) {
      toast({ title: 'Import failed', description: String(e), variant: 'destructive' })
    } finally { setImporting(false) }
  }

  const incomeCount  = preview.filter(r => r.type === 'Income').length
  const expenseCount = preview.filter(r => r.type === 'Expense').length
  const uncatCount   = preview.filter(r => !r.category).length
  const reviewCount  = preview.filter(r => r.review).length
  const previewIncome  = preview.filter(r => r.type === 'Income').reduce((s, r) => s + r.amount, 0)
  const previewExpense = preview.filter(r => r.type === 'Expense').reduce((s, r) => s + r.amount, 0)

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-lg font-bold">Import Bank Statements</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a CSV export from your bank. Every transaction is shown for review before anything is saved — fix classifications, categories, or remove rows you don't want.
        </p>
      </div>

      {/* Upload step */}
      {preview.length === 0 && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="space-y-1.5">
            <Label>Statement Source</Label>
            <Select value={statementType} onValueChange={setStatementType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">TVA Checking</SelectItem>
                <SelectItem value="savings">TVA Savings</SelectItem>
                <SelectItem value="cc">Chase Ink (Credit Card)</SelectItem>
                <SelectItem value="other">Other / Generic</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Supported formats: TVA Credit Union, Chase, or any bank CSV with Date / Description / Amount (or Debit / Credit) columns.</p>
          </div>

          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-3">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Select a CSV or PDF file to preview</p>
              <p className="text-xs text-muted-foreground mt-0.5">Nothing is saved until you click "Import" — review and correct every row first</p>
            </div>
            <Input type="file" accept=".csv,.txt,.pdf" className="max-w-xs mx-auto cursor-pointer text-xs" onChange={handleFile} />
            <p className="text-xs text-muted-foreground">
              <strong>Tip:</strong> CSV exports are more accurate than PDFs. Export CSV from your bank's online portal when possible.
              PDF imports flag every row for manual review.
            </p>
          </div>
        </div>
      )}

      {/* Editable preview */}
      {preview.length > 0 && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="rounded-xl border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-semibold">{preview.length} transactions to review</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setPreview([])}>
                  <X className="h-3.5 w-3.5 mr-1" />Start over
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={handleImport} disabled={importing}>
                  <Check className="h-3.5 w-3.5 mr-1" />{importing ? 'Saving…' : `Import ${preview.filter(r => r.category).length}`}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              <div className="rounded-lg bg-muted px-2 py-1.5"><div className="text-muted-foreground">Income</div><div className="font-bold text-green-600">{fmt$d(previewIncome)}</div></div>
              <div className="rounded-lg bg-muted px-2 py-1.5"><div className="text-muted-foreground">Expenses</div><div className="font-bold text-destructive">{fmt$d(previewExpense)}</div></div>
              <div className="rounded-lg bg-muted px-2 py-1.5"><div className="text-muted-foreground">Uncategorized</div><div className={`font-bold ${uncatCount > 0 ? 'text-yellow-600' : 'text-green-600'}`}>{uncatCount}</div></div>
              <div className="rounded-lg bg-muted px-2 py-1.5"><div className="text-muted-foreground">Needs Review</div><div className={`font-bold ${reviewCount > 0 ? 'text-yellow-600' : ''}`}>{reviewCount}</div></div>
            </div>
            {uncatCount > 0 && (
              <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {uncatCount} row{uncatCount > 1 ? 's' : ''} need a category before they can be imported.
              </p>
            )}
          </div>

          {/* Row list */}
          <div className="space-y-2">
            {preview.map((row, i) => (
              <div key={i} className={`rounded-xl border bg-card p-3 space-y-2 ${!row.category ? 'border-yellow-300 dark:border-yellow-700' : row.review ? 'border-yellow-200 dark:border-yellow-800' : ''}`}>
                {/* Row header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{row.description}</p>
                    <p className="text-xs text-muted-foreground">{row.date} · {row.account}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-sm font-bold ${row.type === 'Income' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                      {row.type === 'Income' ? '+' : '−'}{fmt$d(row.amount)}
                    </span>
                    <button onClick={() => removeRow(i)} className="p-1 text-muted-foreground hover:text-destructive rounded" title="Remove row">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Review note */}
                {row.review && row.review_note && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{row.review_note}
                  </p>
                )}

                {/* Edit controls */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Income/Expense flip toggle */}
                  <button
                    onClick={() => flipType(i)}
                    className={`shrink-0 h-7 px-3 rounded-full text-xs font-semibold border transition-colors ${
                      row.type === 'Income'
                        ? 'bg-green-50 border-green-300 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-400'
                        : 'bg-red-50 border-red-300 text-destructive dark:bg-red-950 dark:border-red-800'
                    }`}
                    title="Tap to flip Income ↔ Expense"
                  >
                    {row.type === 'Income' ? '↑ Income' : '↓ Expense'} ⇄
                  </button>

                  {/* Category selector */}
                  <Select
                    value={row.category || ''}
                    onValueChange={v => updateRow(i, { category: v, review: v ? false : row.review })}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs min-w-[160px]">
                      <SelectValue placeholder="Assign category…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(row.type === 'Income' ? INCOME_CATS : EXPENSE_CATS).map(c => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}{SCHEDULE_C[c] ? ` · ${SCHEDULE_C[c].line}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Notes field (expandable) */}
                {editingIdx === i ? (
                  <div className="flex gap-2">
                    <Input
                      className="h-7 text-xs flex-1"
                      placeholder="Notes (optional)"
                      value={row.notes || ''}
                      onChange={e => updateRow(i, { notes: e.target.value })}
                      onBlur={() => setEditingIdx(null)}
                      autoFocus
                    />
                  </div>
                ) : (
                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditingIdx(i)}>
                    {row.notes ? `📝 ${row.notes}` : '+ Add note'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Bottom import button */}
          <Button className="w-full" onClick={handleImport} disabled={importing}>
            <Check className="h-4 w-4 mr-2" />
            {importing ? 'Saving to database…' : `Import ${preview.filter(r => r.category).length} of ${preview.length} transactions`}
          </Button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FINANCE PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function Finance() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const [period, setPeriod] = useState<Period>(getInitialPeriod)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [clearing, setClearing] = useState(false)
  const { toast } = useToast()

  const { data: transactions = [], refetch: refetchTx } = useQuery<Transaction[]>({
    queryKey: ['finance-transactions'],
    queryFn: () => apiGet('/finance'),
    enabled: unlocked,
    staleTime: 60_000,
  })

  const { data: snapshots = [], refetch: refetchSnaps } = useQuery<Snapshot[]>({
    queryKey: ['finance-snapshots'],
    queryFn: () => apiGet('/finance?action=snapshots'),
    enabled: unlocked,
    staleTime: 60_000,
  })

  const refresh = useCallback(() => { refetchTx(); refetchSnaps() }, [refetchTx, refetchSnaps])

  async function handleClearAll() {
    setClearing(true)
    try {
      await apiRequest('DELETE', '/finance?action=clear-all')
      toast({ title: 'All data cleared', description: 'You can now upload fresh statements.' })
      setShowClearDialog(false)
      refresh()
    } catch (e) {
      toast({ title: 'Clear failed', description: String(e), variant: 'destructive' })
    } finally { setClearing(false) }
  }

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-card px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold">Financial Dashboard</h1>
            <p className="text-xs text-muted-foreground">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Clear all data" onClick={() => setShowClearDialog(true)}>
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Refresh" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>

      {/* Clear All Data dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Clear All Financial Data
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">This will permanently delete <strong>all transactions</strong> and <strong>all balance sheet snapshots</strong> from the database.</p>
            <p className="text-sm text-muted-foreground">Use this to start fresh with new uploads. This cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleClearAll} disabled={clearing}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              {clearing ? 'Clearing…' : 'Delete Everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tabs */}
      <Tabs defaultValue="dashboard" className="flex-1">
        <div className="sticky top-[105px] z-10 bg-card border-b px-1">
          <TabsList className="h-9 w-full justify-start bg-transparent gap-0 overflow-x-auto no-scrollbar">
            {[
              { value: 'dashboard', label: 'Overview' },
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

        <TabsContent value="dashboard" className="mt-0"><DashboardTab transactions={transactions} snapshots={snapshots} period={period} /></TabsContent>
        <TabsContent value="pl" className="mt-0"><PLTab transactions={transactions} period={period} /></TabsContent>
        <TabsContent value="balance" className="mt-0"><BalanceSheetTab snapshots={snapshots} period={period} onRefresh={refresh} /></TabsContent>
        <TabsContent value="transactions" className="mt-0"><TransactionsTab transactions={transactions} period={period} onRefresh={refresh} /></TabsContent>
        <TabsContent value="import" className="mt-0"><CsvImportTab transactions={transactions} onRefresh={refresh} /></TabsContent>
      </Tabs>
    </div>
  )
}
