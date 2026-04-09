import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { services as baseServices, calculateSubscriptionPrice, rtcepLite, ctcepLite } from '../../src/lib/pricing'
import type { ServiceDefinition } from '../../src/lib/pricing'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function getMergedServices(): Promise<ServiceDefinition[]> {
  const [{ data: overrides }, { data: custom }, { data: deleted }] = await Promise.all([
    supabase.from('price_overrides').select('*'),
    supabase.from('custom_services').select('*'),
    supabase.from('deleted_services').select('id'),
  ])

  const deletedIds = (deleted ?? []).map((d: { id: string }) => d.id)
  const activeBase = baseServices.filter(s => !deletedIds.includes(s.id))

  const merged = activeBase.map(svc => {
    const svcOverrides = (overrides ?? []).filter((o: { service_id: string }) => o.service_id === svc.id)
    if (svcOverrides.length === 0) return svc
    const newTiers = svc.tiers.map((tier, idx) => {
      const o = svcOverrides.find((ov: { field: string; value: number }) => ov.field === `tier_${idx}`)
      return o ? { ...tier, price: Number(o.value) } : tier
    })
    return { ...svc, tiers: newTiers }
  })

  const customParsed = (custom ?? []).map((c: { data: ServiceDefinition }) => c.data)
  return [...merged, ...customParsed]
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const action = event.queryStringParameters?.action ?? 'merged'
  const method = event.httpMethod

  try {
    // GET merged (with optional type filter)
    if (method === 'GET' && (action === 'merged' || action === 'base' || action === 'deleted' || action === 'plans' || action === 'export-csv')) {
      if (action === 'base') {
        return { statusCode: 200, headers: CORS, body: JSON.stringify(baseServices) }
      }

      if (action === 'deleted') {
        const { data } = await supabase.from('deleted_services').select('id')
        return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map((d: { id: string }) => d.id)) }
      }

      if (action === 'plans') {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ rtcepLite, ctcepLite }) }
      }

      if (action === 'export-csv') {
        const merged = await getMergedServices()
        const escCsv = (s: string) => {
          if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
          return s
        }
        const fmt = (n: number) => '$' + n.toFixed(2)
        const rows: string[][] = []
        rows.push(['Category','Service','Service Type','Pricing Model','Tier / Size','Unit','One-Time Price','Frequency','Discount %','Per-Visit','Monthly Amount','Annual Amount','Annual Savings','Sub Cost %','Margin %','Notes'])
        for (const svc of merged) {
          const isPerUnit = svc.pricingModel === 'per_sqft' || svc.pricingModel === 'per_lf' || svc.pricingModel === 'per_acre'
          const marginPct = ((1 - svc.subCostPct) * 100).toFixed(0) + '%'
          const subCostPct = (svc.subCostPct * 100).toFixed(0) + '%'
          if (isPerUnit) {
            for (const tier of svc.tiers) {
              const unitStr = svc.pricingModel === 'per_sqft' ? 'per sqft' : svc.pricingModel === 'per_lf' ? 'per LF' : 'per acre'
              rows.push([svc.category, svc.name, svc.serviceType, svc.pricingModel, tier.label, unitStr, fmt(tier.price), svc.frequencies.map(f => f.label).join(', '), '', tier.min > 0 ? 'Min: '+fmt(tier.min) : 'No minimum', '', '', '', subCostPct, marginPct, svc.notes ?? ''])
            }
          } else {
            for (const tier of svc.tiers) {
              for (const freq of svc.frequencies) {
                if (freq.frequency === 'onetime') {
                  rows.push([svc.category, svc.name, svc.serviceType, svc.pricingModel, tier.label, svc.unitLabel, fmt(tier.price), 'One-Time', '0%', fmt(tier.price), 'N/A', 'N/A', 'N/A', subCostPct, marginPct, svc.notes ?? ''])
                } else {
                  const calc = calculateSubscriptionPrice(tier.price, freq)
                  rows.push([svc.category, svc.name, svc.serviceType, svc.pricingModel, tier.label, svc.unitLabel, fmt(tier.price), freq.label, freq.discountPct+'%', fmt(calc.perVisit), fmt(calc.monthlyAmount)+'/mo', fmt(calc.annualAmount)+'/yr', fmt(calc.savings)+' saved', subCostPct, marginPct, svc.notes ?? ''])
                }
              }
            }
          }
        }
        const csv = rows.map(r => r.map(c => escCsv(String(c))).join(',')).join('\n')
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="KECC-Price-Book-${new Date().toISOString().slice(0,10)}.csv"` },
          body: csv,
        }
      }

      // Default: merged
      const merged = await getMergedServices()
      const typeFilter = event.queryStringParameters?.type
      if (typeFilter === 'residential' || typeFilter === 'commercial') {
        return { statusCode: 200, headers: CORS, body: JSON.stringify(merged.filter(s => s.serviceType === typeFilter || s.serviceType === 'both')) }
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(merged) }
    }

    // POST custom service
    if (method === 'POST' && action === 'custom') {
      const body = JSON.parse(event.body ?? '{}') as ServiceDefinition
      if (!body.name || !body.category) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'name and category required' }) }
      const svc: ServiceDefinition = { ...body, id: body.id || `custom_${randomUUID().replace(/-/g,'').slice(0,12)}` }
      await supabase.from('custom_services').insert({ id: svc.id, data: svc })
      return { statusCode: 201, headers: CORS, body: JSON.stringify(svc) }
    }

    // DELETE custom service
    if (method === 'DELETE' && action === 'custom') {
      const id = event.queryStringParameters?.id
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'id required' }) }
      await supabase.from('custom_services').delete().eq('id', id)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Deleted' }) }
    }

    // POST delete built-in service
    if (method === 'POST' && action === 'delete') {
      const id = event.queryStringParameters?.id
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'id required' }) }
      await supabase.from('deleted_services').upsert({ id })
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Hidden' }) }
    }

    // POST restore built-in service
    if (method === 'POST' && action === 'restore') {
      const id = event.queryStringParameters?.id
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'id required' }) }
      await supabase.from('deleted_services').delete().eq('id', id)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Restored' }) }
    }

    // POST price override
    if (method === 'POST' && action === 'override') {
      const body = JSON.parse(event.body ?? '{}')
      const { serviceId, field, value } = body
      if (!serviceId || !field || value === undefined) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'serviceId, field, value required' }) }
      await supabase.from('price_overrides').upsert({ service_id: serviceId, field, value: Number(value) }, { onConflict: 'service_id,field' })
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Override saved' }) }
    }

    // DELETE price override
    if (method === 'DELETE' && action === 'override') {
      const id = event.queryStringParameters?.id
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'id required' }) }
      await supabase.from('price_overrides').delete().eq('id', id)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Override deleted' }) }
    }

    // GET all overrides
    if (method === 'GET' && action === 'overrides') {
      const { data } = await supabase.from('price_overrides').select('*')
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data ?? []) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('services error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'Internal server error' }) }
  }
}
