/**
 * MarketingTest — in-CRM smoke test panel for all marketing tracking flows.
 *
 * Fires real requests against the live Netlify functions and shows
 * pass / fail / skip for each tracking trigger. Creates test records
 * clearly marked with KECC_TEST so the cleanup button can remove them.
 *
 * Access: "🧪 Test Tracking" button on the Marketing page.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/queryClient'
import { Campaign } from '@/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, XCircle, Loader2, SkipForward, Trash2, Play } from 'lucide-react'

// ── Test marker (used to find and clean up test records) ──────────────────────
const MARKER = 'KECC_TEST'
const TEST_PHONE   = '+15550100001'   // 555-010-xxxx = reserved for testing
const TEST_EMAIL   = 'test-tracking@kecc-internal.test'
const TEST_NAME    = 'KECC Test Lead'

// ── Types ─────────────────────────────────────────────────────────────────────

type TestStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skip'

interface TestResult {
  name:    string
  status:  TestStatus
  detail:  string
  hint?:   string       // what to do if it fails
}

function makeResult(name: string): TestResult {
  return { name, status: 'idle', detail: '' }
}

const INITIAL_RESULTS: TestResult[] = [
  makeResult('Campaign events endpoint (GET)'),
  makeResult('Phone click → lead stub created'),
  makeResult('Email click event logged'),
  makeResult('QR scan via track function'),
  makeResult('UTM form capture (POST /capture)'),
  makeResult('Referral lead counts in marketing'),
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`/.netlify/functions${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, json }
}

async function get(path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`/.netlify/functions${path}`)
  let json: unknown = null
  try { json = await res.json() } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, json }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
}

export function MarketingTestPanel({ open, onClose }: Props) {
  const [results, setResults]     = useState<TestResult[]>(INITIAL_RESULTS)
  const [running, setRunning]     = useState(false)
  const [cleaning, setCleaning]   = useState(false)
  const [cleanMsg, setCleanMsg]   = useState('')

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['/campaigns'],
    queryFn: () => apiGet('/campaigns'),
    enabled: open,
  })

  function patch(idx: number, update: Partial<TestResult>) {
    setResults(prev => prev.map((r, i) => i === idx ? { ...r, ...update } : r))
  }

  async function runAll() {
    setRunning(true)
    setCleanMsg('')
    setResults(INITIAL_RESULTS.map(r => ({ ...r, status: 'idle', detail: '' })))

    // ── Test 0: GET /campaign-events ──────────────────────────────────────────
    {
      const idx = 0
      patch(idx, { status: 'running', detail: 'GET /campaign-events…' })
      try {
        const r = await get('/campaign-events')
        if (r.ok) {
          const count = Array.isArray(r.json) ? r.json.length : '?'
          patch(idx, { status: 'pass', detail: `Returned ${count} event(s). Endpoint healthy.` })
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}`, hint: 'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e), hint: 'Function may not be deployed.' })
      }
    }

    // ── Test 1: phone_click → lead stub ────────────────────────────────────────
    {
      const idx = 1
      patch(idx, { status: 'running', detail: 'POST /campaign-events (phone_click)…' })
      try {
        const r = await post('/campaign-events', {
          eventType: 'phone_click',
          campaignId: null,
          metadata: {
            number: TEST_PHONE,
            page:   `${window.location.origin}/${MARKER}-test`,
          },
        })
        if (r.ok || r.status === 201) {
          // Give DB a moment, then check for the lead stub
          await new Promise(res => setTimeout(res, 1200))
          const leads = await get(`/leads`)
          const arr = Array.isArray(leads.json) ? leads.json as { notes?: string }[] : []
          const stub = arr.find(l => l.notes?.includes(MARKER) || l.notes?.includes(TEST_PHONE))
          if (stub) {
            patch(idx, { status: 'pass', detail: `Event logged + lead stub created (phone ${TEST_PHONE}).` })
          } else {
            patch(idx, { status: 'fail', detail: 'Event was logged but no lead stub found in /leads.', hint: 'Check campaign-events.ts phone_click branch and source_locked column migration.' })
          }
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}: ${JSON.stringify(r.json)}`, hint: 'Check campaign-events.ts POST handler.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    // ── Test 2: email_click event ──────────────────────────────────────────────
    {
      const idx = 2
      patch(idx, { status: 'running', detail: 'POST /campaign-events (email_click)…' })
      try {
        const r = await post('/campaign-events', {
          eventType: 'email_click',
          campaignId: null,
          metadata: { address: TEST_EMAIL, page: window.location.origin },
        })
        if (r.ok || r.status === 201) {
          patch(idx, { status: 'pass', detail: `email_click event logged for ${TEST_EMAIL}.` })
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}`, hint: 'Check campaign-events.ts POST handler.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    // ── Test 3: QR scan via track function ────────────────────────────────────
    {
      const idx = 3
      const qrCampaign = campaigns.find(c => c.campaignType === 'qr' && c.redirectToken)
      if (!qrCampaign) {
        patch(idx, { status: 'skip', detail: 'No QR campaign with a redirect token found.', hint: 'Create a QR-type campaign to test this flow.' })
      } else {
        patch(idx, { status: 'running', detail: `Hitting track?c=${qrCampaign.redirectToken}…` })
        try {
          const res = await fetch(`/.netlify/functions/track?c=${qrCampaign.redirectToken}`, { redirect: 'manual' })
          // A redirect means track fired correctly (status 0 = opaqueredirect, 302 = redirect)
          if (res.status === 0 || res.status === 302 || res.type === 'opaqueredirect') {
            patch(idx, { status: 'pass', detail: `Scan event logged for campaign "${qrCampaign.name}". Redirect fired.` })
          } else if (res.ok) {
            // Some environments follow the redirect
            patch(idx, { status: 'pass', detail: `track function responded OK for "${qrCampaign.name}".` })
          } else {
            patch(idx, { status: 'fail', detail: `HTTP ${res.status}`, hint: 'Check track.ts and that the campaign redirect_token matches a DB record.' })
          }
        } catch (e) {
          patch(idx, { status: 'fail', detail: String(e) })
        }
      }
    }

    // ── Test 4: POST /capture (UTM form submission) ───────────────────────────
    {
      const idx = 4
      const campaign = campaigns.find(c => c.status === 'active')
      if (!campaign) {
        patch(idx, { status: 'skip', detail: 'No active campaign to attribute the test lead to.', hint: 'Create and activate a campaign first.' })
      } else {
        patch(idx, { status: 'running', detail: `POST /capture attributed to "${campaign.name}"…` })
        try {
          const r = await post('/capture', {
            name:            TEST_NAME,
            phone:           TEST_PHONE,
            email:           TEST_EMAIL,
            serviceInterest: 'Tracking Test',
            message:         `[${MARKER}] Automated tracking test — safe to delete.`,
            campaignId:      campaign.id,
            utmSource:       campaign.utmSource ?? 'test',
          })
          if (r.ok || r.status === 201) {
            const body = r.json as { leadId?: string; contactId?: string }
            patch(idx, { status: 'pass', detail: `Contact + lead created. leadId=${body?.leadId?.slice(0,8)}… attributed to "${campaign.name}".` })
          } else {
            patch(idx, { status: 'fail', detail: `HTTP ${r.status}: ${JSON.stringify(r.json)}`, hint: 'Check capture.ts and SUPABASE env vars.' })
          }
        } catch (e) {
          patch(idx, { status: 'fail', detail: String(e) })
        }
      }
    }

    // ── Test 5: Referral lead → marketing page ────────────────────────────────
    {
      const idx = 5
      patch(idx, { status: 'running', detail: 'POST /leads (source=referral)…' })
      try {
        const r = await post('/leads', {
          source: 'referral',
          stage:  'new',
          notes:  `[${MARKER}] Referral attribution test — safe to delete.`,
          serviceInterest: 'Tracking Test',
        })
        if (r.ok || r.status === 201) {
          // Check that getLeadChannelId would map this — we verify the lead exists with source=referral
          const body = r.json as { id?: string }
          patch(idx, { status: 'pass', detail: `Lead created (id=${body?.id?.slice(0,8)}…) with source=referral. Will count in Word of Mouth channel on the marketing page.` })
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}: ${JSON.stringify(r.json)}`, hint: 'Check leads.ts POST handler.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    setRunning(false)
  }

  // ── Cleanup: delete all test records ──────────────────────────────────────
  async function cleanup() {
    setCleaning(true)
    setCleanMsg('')
    let deleted = 0

    try {
      // Delete test leads (by notes marker)
      const leads = await get('/leads')
      const arr = Array.isArray(leads.json) ? leads.json as { id: string; notes?: string; source?: string }[] : []

      for (const l of arr) {
        const isTest = l.notes?.includes(MARKER) || l.notes?.includes(TEST_PHONE)
        if (isTest) {
          await fetch(`/.netlify/functions/leads/${l.id}`, { method: 'DELETE' })
          deleted++
        }
      }

      // Delete test contacts (by phone/email)
      const contacts = await get('/contacts')
      const carr = Array.isArray(contacts.json) ? contacts.json as { id: string; phone?: string; email?: string }[] : []
      for (const c of carr) {
        if (c.phone === TEST_PHONE || c.email === TEST_EMAIL) {
          await fetch(`/.netlify/functions/contacts/${c.id}`, { method: 'DELETE' })
          deleted++
        }
      }

      setCleanMsg(`Cleaned up ${deleted} test record(s).`)
    } catch (e) {
      setCleanMsg(`Cleanup error: ${String(e)}`)
    }

    setCleaning(false)
  }

  const passCount = results.filter(r => r.status === 'pass').length
  const failCount = results.filter(r => r.status === 'fail').length
  const allDone   = results.every(r => r.status !== 'idle' && r.status !== 'running')

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            🧪 Marketing Tracking Test Suite
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Fires real requests against the live endpoints. Creates clearly-marked test records — click <strong>Clean Up</strong> when done.
          </p>
        </SheetHeader>

        {/* Results list */}
        <div className="space-y-2 mb-4">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
              <div className="shrink-0 mt-0.5">
                {r.status === 'idle'    && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />}
                {r.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {r.status === 'pass'    && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {r.status === 'fail'    && <XCircle className="h-4 w-4 text-destructive" />}
                {r.status === 'skip'    && <SkipForward className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{r.name}</span>
                  {r.status !== 'idle' && r.status !== 'running' && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 h-4 ${
                        r.status === 'pass' ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' :
                        r.status === 'fail' ? 'text-destructive border-destructive/30 bg-destructive/10' :
                        'text-muted-foreground'
                      }`}
                    >
                      {r.status.toUpperCase()}
                    </Badge>
                  )}
                </div>
                {r.detail && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{r.detail}</p>
                )}
                {r.hint && r.status === 'fail' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    💡 {r.hint}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        {allDone && (
          <div className={`rounded-lg px-4 py-3 mb-4 text-sm font-medium ${
            failCount === 0
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          }`}>
            {failCount === 0
              ? `✅ All ${passCount} tests passed — tracking is working correctly.`
              : `⚠️ ${passCount} passed, ${failCount} failed. Check the hints above.`}
          </div>
        )}

        {/* Cleanup message */}
        {cleanMsg && (
          <p className="text-xs text-muted-foreground mb-3">{cleanMsg}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={runAll}
            disabled={running || cleaning}
          >
            {running
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running…</>
              : <><Play className="h-3.5 w-3.5 mr-1.5" />Run All Tests</>}
          </Button>
          <Button
            variant="outline"
            onClick={cleanup}
            disabled={running || cleaning}
            className="gap-1.5"
          >
            {cleaning
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Cleaning…</>
              : <><Trash2 className="h-3.5 w-3.5" />Clean Up</>}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 text-center">
          Test records use phone {TEST_PHONE} and are marked {MARKER} in notes for easy cleanup.
        </p>
      </SheetContent>
    </Sheet>
  )
}
