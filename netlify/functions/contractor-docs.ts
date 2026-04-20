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
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Doc-Name, X-Doc-Type, X-Contractor-Id',
}

const BUCKET = 'contractor-docs'

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const rawPath = event.path.replace(/\/.netlify\/functions\/contractor-docs\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  // Routes:
  //   POST   /contractor-docs/:contractorId         → upload file, add to docs array
  //   DELETE /contractor-docs/:contractorId/:docId  → remove doc from array + storage
  const contractorId = parts[0]
  const docId        = parts[1]

  if (!contractorId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'contractorId required' }) }
  }

  try {
    // ── POST: upload file ────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const docName = event.headers['x-doc-name'] || 'Document'
      const docType = event.headers['x-doc-type'] || 'other'  // 'w9' | 'agreement' | 'license' | 'other'
      const contentType = event.headers['content-type'] || 'application/octet-stream'

      const ext = contentType === 'application/pdf' ? 'pdf' : contentType.split('/')[1] ?? 'bin'
      const filePath = `${contractorId}/${randomUUID()}.${ext}`

      const fileBuffer = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64')
        : Buffer.from(event.body ?? '')

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, fileBuffer, { contentType, upsert: false })
      if (uploadError) throw new Error(uploadError.message)

      // Generate a long-lived signed URL (10 years)
      const { data: signedData, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(filePath, 60 * 60 * 24 * 365 * 10)
      if (signedError) throw new Error(signedError.message)

      // Append to contractor's documents array
      const { data: contractor } = await supabase
        .from('contractors')
        .select('documents')
        .eq('id', contractorId)
        .single()

      const docs: ContractorDoc[] = Array.isArray(contractor?.documents) ? contractor.documents : []
      const newDoc: ContractorDoc = {
        id: randomUUID(),
        name: docName,
        docType,
        fileUrl: signedData.signedUrl,
        filePath,
        uploadedAt: new Date().toISOString(),
      }
      docs.push(newDoc)

      const { error: updateError } = await supabase
        .from('contractors')
        .update({ documents: docs })
        .eq('id', contractorId)
      if (updateError) throw new Error(updateError.message)

      return { statusCode: 201, headers: CORS, body: JSON.stringify(newDoc) }
    }

    // ── DELETE: remove doc ───────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE' && docId) {
      const { data: contractor } = await supabase
        .from('contractors')
        .select('documents')
        .eq('id', contractorId)
        .single()

      const docs: ContractorDoc[] = Array.isArray(contractor?.documents) ? contractor.documents : []
      const target = docs.find(d => d.id === docId)

      if (target?.filePath) {
        await supabase.storage.from(BUCKET).remove([target.filePath])
      }

      const updated = docs.filter(d => d.id !== docId)
      const { error } = await supabase
        .from('contractors')
        .update({ documents: updated })
        .eq('id', contractorId)
      if (error) throw new Error(error.message)

      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed' }) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('contractor-docs error:', msg)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: msg }) }
  }
}

interface ContractorDoc {
  id: string
  name: string
  docType: string
  fileUrl: string
  filePath: string
  uploadedAt: string
}
