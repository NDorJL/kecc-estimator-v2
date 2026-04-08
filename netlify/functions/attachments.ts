import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToAttachment } from '../../src/types'
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

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const rawPath = event.path.replace(/\/.netlify\/functions\/attachments\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const action = event.queryStringParameters?.action
  const method = event.httpMethod

  try {
    // GET all attachments
    if (method === 'GET' && !id) {
      const { data, error } = await supabase.from('quote_attachments').select('*').order('sort_order')
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToAttachment)) }
    }

    // POST: get signed upload URL (so client can upload directly to Supabase Storage)
    if (method === 'POST' && action === 'upload-url') {
      const body = JSON.parse(event.body ?? '{}')
      const { fileName, contentType } = body
      if (!fileName) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'fileName required' }) }
      if (contentType !== 'application/pdf') return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Only PDF files allowed' }) }

      // Check max 5 attachments
      const { count } = await supabase.from('quote_attachments').select('*', { count: 'exact', head: true })
      if ((count ?? 0) >= 5) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Maximum 5 attachments allowed' }) }

      const ext = fileName.split('.').pop() ?? 'pdf'
      const path = `pdfs/${randomUUID()}.${ext}`
      const { data, error } = await supabase.storage.from('attachments').createSignedUploadUrl(path)
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ signedUrl: data.signedUrl, path }) }
    }

    // POST: save attachment metadata after direct upload
    if (method === 'POST' && !id && !action) {
      const body = JSON.parse(event.body ?? '{}')
      const { name, fileName, filePath, attachMode } = body
      if (!name || !fileName || !filePath) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'name, fileName, filePath required' }) }

      // Get public URL (for private bucket this will be used to generate signed URLs at PDF time)
      const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/attachments/${filePath}`

      const { count } = await supabase.from('quote_attachments').select('*', { count: 'exact', head: true })
      const { data, error } = await supabase.from('quote_attachments').insert({
        name,
        file_name: fileName,
        file_url: fileUrl,
        file_path: filePath,
        enabled: true,
        attach_mode: attachMode ?? 'manual',
        sort_order: count ?? 0,
      }).select().single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToAttachment(data)) }
    }

    // PATCH attachment metadata
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const update: Record<string, unknown> = {}
      if (body.name !== undefined) update.name = body.name
      if (body.enabled !== undefined) update.enabled = body.enabled
      if (body.attachMode !== undefined) update.attach_mode = body.attachMode
      if (body.sortOrder !== undefined) update.sort_order = body.sortOrder
      const { data, error } = await supabase.from('quote_attachments').update(update).eq('id', id).select().single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Attachment not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToAttachment(data)) }
    }

    // DELETE attachment
    if (method === 'DELETE' && id) {
      const { data: att } = await supabase.from('quote_attachments').select('file_path').eq('id', id).single()
      if (att?.file_path) {
        await supabase.storage.from('attachments').remove([att.file_path])
      }
      await supabase.from('quote_attachments').delete().eq('id', id)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Deleted' }) }
    }

    // POST reorder
    if (method === 'POST' && id === 'reorder') {
      const body = JSON.parse(event.body ?? '{}')
      const { ids } = body as { ids: string[] }
      if (!Array.isArray(ids)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'ids must be array' }) }
      await Promise.all(ids.map((attachId, idx) =>
        supabase.from('quote_attachments').update({ sort_order: idx }).eq('id', attachId)
      ))
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Reordered' }) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('attachments error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'Internal server error' }) }
  }
}
