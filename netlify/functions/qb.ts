import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const QB_BASE = 'https://quickbooks.api.intuit.com'
const QB_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const MINOR_VERSION = '65'

function qbBase(): string {
  return process.env.QB_SANDBOX === 'true' ? QB_BASE_SANDBOX : QB_BASE
}

function basicAuth(): string {
  const clientId = process.env.QB_CLIENT_ID ?? ''
  const clientSecret = process.env.QB_CLIENT_SECRET ?? ''
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
}

async function getSettings() {
  const { data } = await supabase.from('company_settings').select('*').limit(1).single()
  return data
}

async function ensureValidToken(settings: Record<string, unknown>): Promise<string> {
  const expiresAt = settings.qb_token_expires_at ? new Date(settings.qb_token_expires_at as string).getTime() : 0
  const now = Date.now()
  if (now < expiresAt - 5 * 60 * 1000 && settings.qb_access_token) {
    return settings.qb_access_token as string
  }

  // Refresh token
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: (settings.qb_refresh_token as string) ?? '',
    }),
  })
  if (!res.ok) throw new Error(`QB token refresh failed: ${res.status}`)
  const data = await res.json()

  const newExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
  await supabase.from('company_settings').update({
    qb_access_token: data.access_token,
    qb_refresh_token: data.refresh_token ?? settings.qb_refresh_token,
    qb_token_expires_at: newExpiry,
  }).eq('id', settings.id as string)

  return data.access_token as string
}

// Find or create a QuickBooks customer, returning their QB ID
async function findOrCreateQBCustomer(
  token: string,
  realmId: string,
  name: string,
  email: string | null,
  phone: string | null,
  contactId: string | null
): Promise<string> {
  // Check if we have cached QB customer ID in contact custom_fields
  if (contactId) {
    const { data: contact } = await supabase.from('contacts').select('custom_fields').eq('id', contactId).single()
    if (contact?.custom_fields?.qbCustomerId) {
      return contact.custom_fields.qbCustomerId as string
    }
  }

  // Search QB for existing customer by display name
  const searchRes = await fetch(
    `${qbBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`)}&minorversion=${MINOR_VERSION}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  )
  if (searchRes.ok) {
    const sd = await searchRes.json()
    const existing = sd?.QueryResponse?.Customer?.[0]
    if (existing?.Id) {
      if (contactId) {
        const { data: c } = await supabase.from('contacts').select('custom_fields').eq('id', contactId).single()
        const cf = c?.custom_fields ?? {}
        await supabase.from('contacts').update({ custom_fields: { ...cf, qbCustomerId: existing.Id } }).eq('id', contactId)
      }
      return existing.Id as string
    }
  }

  // Create new QB customer
  const payload: Record<string, unknown> = { DisplayName: name }
  if (email) payload.PrimaryEmailAddr = { Address: email }
  if (phone) payload.PrimaryPhone = { FreeFormNumber: phone }

  const createRes = await fetch(
    `${qbBase()}/v3/company/${realmId}/customer?minorversion=${MINOR_VERSION}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }
  )
  if (!createRes.ok) throw new Error(`QB create customer failed: ${createRes.status}`)
  const cd = await createRes.json()
  const newId = cd?.Customer?.Id
  if (!newId) throw new Error('QB create customer: no ID returned')

  // Cache it
  if (contactId) {
    const { data: c } = await supabase.from('contacts').select('custom_fields').eq('id', contactId).single()
    const cf = c?.custom_fields ?? {}
    await supabase.from('contacts').update({ custom_fields: { ...cf, qbCustomerId: newId } }).eq('id', contactId)
  }

  return newId as string
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const action = event.queryStringParameters?.action
  const method = event.httpMethod

  try {
    // ── GET /qb?action=connect — redirect to Intuit OAuth ──────────────
    if (method === 'GET' && action === 'connect') {
      const clientId = process.env.QB_CLIENT_ID
      if (!clientId) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'QB_CLIENT_ID not set' }) }

      const baseUrl = process.env.URL ?? 'http://localhost:8888'
      const redirectUri = encodeURIComponent(`${baseUrl}/.netlify/functions/qb?action=callback`)
      const scope = encodeURIComponent('com.intuit.quickbooks.accounting')
      const state = randomUUID()
      const authorizeUrl =
        `https://appcenter.intuit.com/connect/oauth2` +
        `?client_id=${clientId}` +
        `&redirect_uri=${redirectUri}` +
        `&response_type=code` +
        `&scope=${scope}` +
        `&state=${state}`

      return { statusCode: 302, headers: { ...CORS, Location: authorizeUrl }, body: '' }
    }

    // ── GET /qb?action=callback — exchange code for tokens ─────────────
    if (method === 'GET' && action === 'callback') {
      const code = event.queryStringParameters?.code
      const realmId = event.queryStringParameters?.realmId
      if (!code || !realmId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing code or realmId' }) }

      const baseUrl = process.env.URL ?? 'http://localhost:8888'
      const redirectUri = `${baseUrl}/.netlify/functions/qb?action=callback`

      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuth(),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      })
      if (!res.ok) {
        const txt = await res.text()
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `QB token exchange failed: ${txt}` }) }
      }
      const data = await res.json()
      const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()

      const settings = await getSettings()
      if (!settings) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'No settings row' }) }

      await supabase.from('company_settings').update({
        qb_realm_id: realmId,
        qb_access_token: data.access_token,
        qb_refresh_token: data.refresh_token,
        qb_token_expires_at: expiresAt,
      }).eq('id', settings.id)

      // Redirect back to app settings page
      return { statusCode: 302, headers: { ...CORS, Location: `${baseUrl}/#/settings?qb=connected` }, body: '' }
    }

    // ── GET /qb?action=status ──────────────────────────────────────────
    if (method === 'GET' && action === 'status') {
      const settings = await getSettings()
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          connected: !!settings?.qb_realm_id,
          realmId: settings?.qb_realm_id ?? null,
          expiresAt: settings?.qb_token_expires_at ?? null,
          sandbox: process.env.QB_SANDBOX === 'true',
        }),
      }
    }

    // ── POST /qb?action=disconnect ─────────────────────────────────────
    if (method === 'POST' && action === 'disconnect') {
      const settings = await getSettings()
      if (settings) {
        await supabase.from('company_settings').update({
          qb_realm_id: null,
          qb_access_token: null,
          qb_refresh_token: null,
          qb_token_expires_at: null,
        }).eq('id', settings.id)
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ disconnected: true }) }
    }

    // ── POST /qb?action=invoice ────────────────────────────────────────
    if (method === 'POST' && action === 'invoice') {
      const body = JSON.parse(event.body ?? '{}')
      const { documentType, documentId } = body as { documentType: 'quote' | 'agreement'; documentId: string }

      const settings = await getSettings()
      if (!settings?.qb_realm_id) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'QuickBooks not connected' }) }
      }

      const token = await ensureValidToken(settings)
      const realmId = settings.qb_realm_id as string

      let customerName: string
      let customerEmail: string | null
      let customerPhone: string | null
      let contactId: string | null
      let lineData: Array<{ description: string; amount: number }>
      let dueDate: string
      let privateNote: string

      if (documentType === 'quote') {
        const { data: q } = await supabase.from('quotes').select('*').eq('id', documentId).single()
        if (!q) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Quote not found' }) }
        customerName = q.customer_name
        customerEmail = q.customer_email
        customerPhone = q.customer_phone
        contactId = q.contact_id
        lineData = (Array.isArray(q.line_items) ? q.line_items : []).map((li: { serviceName?: string; lineTotal?: number; monthlyAmount?: number; isSubscription?: boolean; description?: string }) => ({
          description: `${li.serviceName ?? ''}${li.description ? ' — ' + li.description : ''}`,
          amount: Number(li.isSubscription ? (li.monthlyAmount ?? li.lineTotal ?? 0) : (li.lineTotal ?? 0)),
        }))
        const due = new Date()
        due.setDate(due.getDate() + 14)
        dueDate = due.toISOString().slice(0, 10)
        privateNote = `Quote ID: ${documentId.slice(0, 8).toUpperCase()}`
      } else {
        const { data: a } = await supabase.from('service_agreements').select('*, subscriptions(*)').eq('id', documentId).single()
        if (!a) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Agreement not found' }) }
        customerName = a.customer_name
        customerEmail = null
        customerPhone = null
        contactId = a.contact_id
        const sub = a.subscriptions
        lineData = sub
          ? [{ description: `Subscription Services — ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}`, amount: Number(sub.in_season_monthly_total ?? 0) }]
          : []
        const due = new Date()
        due.setDate(due.getDate() + 14)
        dueDate = due.toISOString().slice(0, 10)
        privateNote = `Agreement ID: ${documentId.slice(0, 8).toUpperCase()}`
      }

      if (!lineData.length) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No line items to invoice' }) }
      }

      // Find or create QB customer
      const qbCustomerId = await findOrCreateQBCustomer(token, realmId, customerName, customerEmail, customerPhone, contactId)

      // Build invoice payload
      const invoicePayload = {
        Line: lineData.map(li => ({
          Amount: li.amount,
          DetailType: 'SalesItemLineDetail',
          Description: li.description,
          SalesItemLineDetail: {
            ItemRef: { value: '1', name: 'Services' },
            Qty: 1,
            UnitPrice: li.amount,
          },
        })),
        CustomerRef: { value: qbCustomerId },
        DueDate: dueDate,
        PrivateNote: privateNote,
      }

      const invRes = await fetch(
        `${qbBase()}/v3/company/${realmId}/invoice?minorversion=${MINOR_VERSION}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(invoicePayload),
        }
      )

      if (!invRes.ok) {
        const txt = await invRes.text()
        throw new Error(`QB create invoice failed: ${invRes.status} — ${txt}`)
      }

      const invData = await invRes.json()
      const qbInvoiceId = invData?.Invoice?.Id
      if (!qbInvoiceId) throw new Error('QB create invoice: no ID returned')

      // Write QB invoice ID back to the document
      if (documentType === 'quote') {
        await supabase.from('quotes').update({ qb_invoice_id: qbInvoiceId }).eq('id', documentId)
      } else {
        await supabase.from('service_agreements').update({ qb_invoice_id: qbInvoiceId }).eq('id', documentId)
      }

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ success: true, qbInvoiceId, note: documentType === 'agreement' ? 'For subscription clients, set up the recurring schedule in QuickBooks Online under Recurring Transactions.' : undefined }),
      }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('qb error:', message)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
