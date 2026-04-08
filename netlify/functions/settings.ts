import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToSettings } from '../../src/types'
import Busboy from 'busboy'
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

function parseMultipart(event: { headers: Record<string, string | undefined>; body: string | null; isBase64Encoded: boolean }): Promise<{ file: Buffer; mimeType: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] ?? event.headers['Content-Type'] ?? ''
    const busboy = Busboy({ headers: { 'content-type': contentType } })
    const chunks: Buffer[] = []
    let mimeType = 'image/jpeg'
    let fileName = 'logo.jpg'

    busboy.on('file', (_fieldname, file, info) => {
      mimeType = info.mimeType
      fileName = info.filename
      file.on('data', (chunk: Buffer) => chunks.push(chunk))
    })
    busboy.on('finish', () => resolve({ file: Buffer.concat(chunks), mimeType, fileName }))
    busboy.on('error', reject)

    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64')
      : Buffer.from(event.body ?? '', 'utf8')
    busboy.write(body)
    busboy.end()
  })
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const action = event.queryStringParameters?.action
  const method = event.httpMethod

  try {
    // GET settings
    if (method === 'GET') {
      const { data, error } = await supabase.from('company_settings').select('*').limit(1).single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Settings not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToSettings(data)) }
    }

    // PATCH settings
    if (method === 'PATCH' && !action) {
      const body = JSON.parse(event.body ?? '{}')
      const update: Record<string, unknown> = {}
      if (body.companyName !== undefined) update.company_name = body.companyName
      if (body.phone !== undefined) update.phone = body.phone
      if (body.email !== undefined) update.email = body.email
      if (body.address !== undefined) update.address = body.address
      if (body.logoUrl !== undefined) update.logo_url = body.logoUrl
      if (body.quoteFooter !== undefined) update.quote_footer = body.quoteFooter

      // Get the existing settings ID
      const { data: existing } = await supabase.from('company_settings').select('id').limit(1).single()
      if (!existing) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Settings not found' }) }

      const { data, error } = await supabase.from('company_settings').update(update).eq('id', existing.id).select().single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToSettings(data)) }
    }

    // POST logo upload
    if (method === 'POST' && action === 'logo') {
      const { file, mimeType, fileName } = await parseMultipart(event as Parameters<typeof parseMultipart>[0])
      if (!file.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'No file uploaded' }) }

      const ext = fileName.split('.').pop() ?? 'jpg'
      const path = `company-logo-${randomUUID()}.${ext}`

      const { error: uploadError } = await supabase.storage.from('logos').upload(path, file, {
        contentType: mimeType,
        upsert: true,
      })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(path)

      // Update settings
      const { data: existing } = await supabase.from('company_settings').select('id').limit(1).single()
      if (!existing) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Settings not found' }) }
      const { data, error } = await supabase.from('company_settings').update({ logo_url: publicUrl }).eq('id', existing.id).select().single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ logoUrl: publicUrl, settings: rowToSettings(data) }) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('settings error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'Internal server error' }) }
  }
}
