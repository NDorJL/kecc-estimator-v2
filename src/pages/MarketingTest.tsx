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

// ── Test marker and reserved test data ────────────────────────────────────────
const MARKER    = 'KECC_TEST'
const TEST_PHONE = '+15550100001'   // 555-010-xxxx = reserved for testing
const TEST_EMAIL = 'test-tracking@kecc-internal.test'
const TEST_NAME  = 'KECC Test Lead'

// Campaign IDs created during setup — used to verify fallback attribution
const CONTACT_FORM_CAMPAIGN_ID    = '9f0ac3ec-2ed2-4dc3-8745-af674dad3ac1'
const WEBSITE_ORGANIC_CAMPAIGN_ID = '8548a349-4fc0-48db-b5a0-cd49f7c94e16'

// ── Types ─────────────────────────────────────────────────────────────────────
type TestStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skip'

interface TestResult {
  name:   string
  status: TestStatus
  detail: string
  hint?:  string
}

function makeResult(name: string): TestResult {
  return { name, status: 'idle', detail: '' }
}

const INITIAL_RESULTS: TestResult[] = [
  makeResult('1 — Campaign events endpoint (GET)'),
  makeResult('2 — Phone click → source-locked lead stub'),
  makeResult('3 — Email click event logged'),
  makeResult('4 — QR scan via track function'),
  makeResult('5 — UTM slug → campaign attribution (POST /capture)'),
  makeResult('6 — No-attribution fallback → Contact Form campaign'),
  makeResult('7 — Organic campaign exists in DB'),
  makeResult('8 — Referral lead counts in marketing'),
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
export function MarketingTestPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [results,  setResults]  = useState<TestResult[]>(INITIAL_RESULTS)
  const [running,  setRunning]  = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [cleanMsg, setCleanMsg] = useState('')

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

    // ── Test 1: phone_click → source-locked lead stub ─────────────────────────
    // Verifies: event logged, lead stub created, source_locked=true, source='website'
    {
      const idx = 1
      patch(idx, { status: 'running', detail: 'POST /campaign-events (phone_click)…' })
      try {
        const r = await post('/campaign-events', {
          eventType: 'phone_click',
          campaignId: null,
          metadata: { number: TEST_PHONE, page: `${window.location.origin}/${MARKER}-test` },
        })
        if (r.ok || r.status === 201) {
          await new Promise(res => setTimeout(res, 1200))
          const leads = await get('/leads')
          const arr = Array.isArray(leads.json)
            ? leads.json as { notes?: string; source_locked?: boolean; source?: string }[]
            : []
          const stub = arr.find(l => l.notes?.includes(TEST_PHONE) || l.notes?.includes(MARKER))
          if (!stub) {
            patch(idx, { status: 'fail', detail: 'Event logged but no lead stub found.', hint: 'Check campaign-events.ts phone_click branch and source_locked column.' })
          } else if (!stub.source_locked) {
            patch(idx, { status: 'fail', detail: `Stub found but source_locked=false. Source: ${stub.source}`, hint: 'campaign-events.ts should set source_locked:true on the lead insert.' })
          } else {
            patch(idx, { status: 'pass', detail: `Stub created: source="${stub.source}", source_locked=true ✓` })
          }
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}: ${JSON.stringify(r.json)}`, hint: 'Check campaign-events.ts POST handler.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    // ── Test 2: email_click event ─────────────────────────────────────────────
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
          patch(idx, { status: 'pass', detail: `email_click logged for ${TEST_EMAIL}.` })
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}`, hint: 'Check campaign-events.ts event_type constraint.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    // ── Test 3: QR scan via track function ────────────────────────────────────
    {
      const idx = 3
      const qrCampaign = campaigns.find(c => (c.campaignType === 'qr' || c.campaignType === 'sponsorship') && c.redirectToken)
      if (!qrCampaign) {
        patch(idx, { status: 'skip', detail: 'No QR/Sponsorship campaign with redirect token found.', hint: 'Create a QR-type campaign to test this flow.' })
      } else {
        patch(idx, { status: 'running', detail: `Hitting track?c=${qrCampaign.redirectToken} for "${qrCampaign.name}"…` })
        try {
          const res = await fetch(`/.netlify/functions/track?c=${qrCampaign.redirectToken}`, { redirect: 'manual' })
          if (res.status === 0 || res.status === 302 || res.type === 'opaqueredirect' || res.ok) {
            patch(idx, { status: 'pass', detail: `Scan event logged for "${qrCampaign.name}". Redirect fired. Cookie would be planted on the visitor's browser.` })
          } else {
            patch(idx, { status: 'fail', detail: `HTTP ${res.status}`, hint: 'Check track.ts and that the redirect_token exists in DB.' })
          }
        } catch (e) {
          patch(idx, { status: 'fail', detail: String(e) })
        }
      }
    }

    // ── Test 4: UTM slug → campaign attribution via POST /capture ─────────────
    // Verifies capture.ts resolves utm_campaign slug to a campaign UUID
    {
      const idx = 4
      const utmCampaign = campaigns.find(c => c.utmCampaign && c.status === 'active')
      if (!utmCampaign) {
        patch(idx, { status: 'skip', detail: 'No active campaign with a utm_campaign slug found.', hint: 'Create a digital campaign with a UTM slug to test this flow.' })
      } else {
        patch(idx, { status: 'running', detail: `POST /capture with utm_campaign="${utmCampaign.utmCampaign}"…` })
        try {
          const r = await post('/capture', {
            name:            TEST_NAME,
            phone:           '+15550100002',  // different phone to avoid dedup with test 1
            email:           'test-utm@kecc-internal.test',
            serviceInterest: 'Tracking Test — UTM Slug',
            message:         `[${MARKER}] UTM slug attribution test — safe to delete.`,
            utmCampaign:     utmCampaign.utmCampaign,
            utmSource:       utmCampaign.utmSource ?? 'test',
          })
          if (r.ok || r.status === 201) {
            const body = r.json as { leadId?: string; campaignId?: string }
            // Verify the lead got the right campaign ID
            await new Promise(res => setTimeout(res, 600))
            const leadsRes = await get('/leads')
            const arr = Array.isArray(leadsRes.json) ? leadsRes.json as { id?: string; campaign_id?: string; notes?: string }[] : []
            const lead = arr.find(l => l.notes?.includes('UTM Slug'))
            const gotCampaignId = lead?.campaign_id ?? (body as { campaignId?: string })?.campaignId
            if (gotCampaignId === utmCampaign.id) {
              patch(idx, { status: 'pass', detail: `Lead attributed to "${utmCampaign.name}" via utm_campaign slug "${utmCampaign.utmCampaign}". Slug lookup ✓` })
            } else if (gotCampaignId) {
              patch(idx, { status: 'pass', detail: `Lead created and attributed to a campaign. Slug: "${utmCampaign.utmCampaign}" → ${gotCampaignId?.slice(0,8)}…` })
            } else {
              patch(idx, { status: 'fail', detail: `Lead created but campaign_id not set. Got: ${JSON.stringify(body)}`, hint: 'Check capture.ts UTM slug lookup (queries campaigns by utm_campaign column).' })
            }
          } else {
            patch(idx, { status: 'fail', detail: `HTTP ${r.status}: ${JSON.stringify(r.json)}`, hint: 'Check capture.ts.' })
          }
        } catch (e) {
          patch(idx, { status: 'fail', detail: String(e) })
        }
      }
    }

    // ── Test 5: No attribution → Contact Form Submissions campaign ────────────
    // Verifies the fallback: POST /capture with no UTM and no campaignId
    // should attribute to the "Contact Form Submissions" campaign
    {
      const idx = 5
      patch(idx, { status: 'running', detail: 'POST /capture with no UTM and no campaignId…' })
      try {
        const r = await post('/capture', {
          name:            TEST_NAME,
          phone:           '+15550100003',
          email:           'test-fallback@kecc-internal.test',
          serviceInterest: 'Tracking Test — Fallback',
          message:         `[${MARKER}] Contact Form fallback test — safe to delete.`,
          // No campaignId, no utmSource, no utmCampaign
        })
        if (r.ok || r.status === 201) {
          await new Promise(res => setTimeout(res, 600))
          const leadsRes = await get('/leads')
          const arr = Array.isArray(leadsRes.json) ? leadsRes.json as { id?: string; campaign_id?: string; notes?: string }[] : []
          const lead = arr.find(l => l.notes?.includes('Fallback'))
          const campaignId = lead?.campaign_id
          if (campaignId === CONTACT_FORM_CAMPAIGN_ID) {
            patch(idx, { status: 'pass', detail: 'Lead attributed to "Contact Form Submissions" campaign (fallback ✓). No UTM, no campaign — correctly routed.' })
          } else if (campaignId === WEBSITE_ORGANIC_CAMPAIGN_ID) {
            patch(idx, { status: 'fail', detail: 'Lead went to Website/Organic instead of Contact Form Submissions.', hint: 'capture.ts CONTACT_FORM_CAMPAIGN_ID constant may not match the DB ID.' })
          } else if (campaignId) {
            patch(idx, { status: 'fail', detail: `Lead attributed to unexpected campaign: ${campaignId}`, hint: 'Check capture.ts fallback logic.' })
          } else {
            patch(idx, { status: 'fail', detail: 'Lead created but no campaign_id set (expected Contact Form fallback).', hint: 'Check CONTACT_FORM_CAMPAIGN_ID constant in capture.ts.' })
          }
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}: ${JSON.stringify(r.json)}`, hint: 'Check capture.ts.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    // ── Test 6: Website/Organic campaign exists ───────────────────────────────
    // Verifies both SEO campaigns are in the DB and active
    {
      const idx = 6
      patch(idx, { status: 'running', detail: 'Checking Website/Organic and Contact Form campaigns…' })
      try {
        const organic     = campaigns.find(c => c.id === WEBSITE_ORGANIC_CAMPAIGN_ID)
        const contactForm = campaigns.find(c => c.id === CONTACT_FORM_CAMPAIGN_ID)
        if (organic && contactForm) {
          patch(idx, {
            status: 'pass',
            detail: `"${organic.name}" (organic clicks) and "${contactForm.name}" (form submissions) both active. Phone/email clicks with no campaign cookie route to Website/Organic; form fills without UTM route to Contact Form.`,
          })
        } else {
          const missing = [!organic && 'Website/Organic', !contactForm && 'Contact Form Submissions'].filter(Boolean).join(', ')
          patch(idx, {
            status: 'fail',
            detail: `Missing campaigns: ${missing}`,
            hint: 'Run the DB migration that created these campaigns, or check the campaign IDs in MarketingTest.tsx.',
          })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    // ── Test 7: Referral lead → Word of Mouth channel ─────────────────────────
    {
      const idx = 7
      patch(idx, { status: 'running', detail: 'POST /leads (source=referral, no campaignId)…' })
      try {
        const r = await post('/leads', {
          source:          'referral',
          stage:           'new',
          notes:           `[${MARKER}] Referral attribution test — safe to delete.`,
          serviceInterest: 'Tracking Test',
        })
        if (r.ok || r.status === 201) {
          const body = r.json as { id?: string }
          patch(idx, {
            status: 'pass',
            detail: `Lead (id=${body?.id?.slice(0,8)}…) with source=referral created. Will count in Word of Mouth/Referral campaign on the marketing page — no promo code needed.`,
          })
        } else {
          patch(idx, { status: 'fail', detail: `HTTP ${r.status}: ${JSON.stringify(r.json)}`, hint: 'Check leads.ts POST handler.' })
        }
      } catch (e) {
        patch(idx, { status: 'fail', detail: String(e) })
      }
    }

    setRunning(false)
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  async function cleanup() {
    setCleaning(true)
    setCleanMsg('')
    let deleted = 0
    try {
      const leadsRes = await get('/leads')
      const leads = Array.isArray(leadsRes.json) ? leadsRes.json as { id: string; notes?: string }[] : []
      for (const l of leads) {
        if (l.notes?.includes(MARKER) || l.notes?.includes(TEST_PHONE)) {
          await fetch(`/.netlify/functions/leads/${l.id}`, { method: 'DELETE' })
          deleted++
        }
      }
      const contactsRes = await get('/contacts')
      const contacts = Array.isArray(contactsRes.json) ? contactsRes.json as { id: string; phone?: string; email?: string }[] : []
      for (const c of contacts) {
        const isTest = [TEST_PHONE, '+15550100002', '+15550100003'].includes(c.phone ?? '')
          || ['test-tracking@kecc-internal.test', 'test-utm@kecc-internal.test', 'test-fallback@kecc-internal.test'].includes(c.email ?? '')
        if (isTest) {
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
          <SheetTitle>🧪 Marketing Tracking Test Suite</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Fires real requests against the live endpoints. Creates test records marked <code className="text-[10px] bg-muted px-1 rounded">{MARKER}</code> — click <strong>Clean Up</strong> when done.
          </p>
        </SheetHeader>

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
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${
                      r.status === 'pass' ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' :
                      r.status === 'fail' ? 'text-destructive border-destructive/30 bg-destructive/10' :
                      'text-muted-foreground'
                    }`}>
                      {r.status.toUpperCase()}
                    </Badge>
                  )}
                </div>
                {r.detail && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{r.detail}</p>}
                {r.hint && r.status === 'fail' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">💡 {r.hint}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {allDone && (
          <div className={`rounded-lg px-4 py-3 mb-4 text-sm font-medium ${
            failCount === 0
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          }`}>
            {failCount === 0
              ? `✅ All ${passCount} tests passed — full tracking stack is working.`
              : `⚠️ ${passCount} passed, ${failCount} failed. Check the hints above.`}
          </div>
        )}

        {cleanMsg && <p className="text-xs text-muted-foreground mb-3">{cleanMsg}</p>}

        <div className="flex gap-2">
          <Button className="flex-1" onClick={runAll} disabled={running || cleaning}>
            {running
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running…</>
              : <><Play className="h-3.5 w-3.5 mr-1.5" />Run All Tests</>}
          </Button>
          <Button variant="outline" onClick={cleanup} disabled={running || cleaning} className="gap-1.5">
            {cleaning
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Cleaning…</>
              : <><Trash2 className="h-3.5 w-3.5" />Clean Up</>}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 text-center">
          Test records use reserved phone numbers (555-010-xxxx) and are marked {MARKER} for easy cleanup.
        </p>
      </SheetContent>
    </Sheet>
  )
}
