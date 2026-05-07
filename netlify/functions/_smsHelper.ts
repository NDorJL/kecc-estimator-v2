/**
 * _smsHelper.ts — shared OpenPhone SMS sender + attachment helpers
 */

import { createClient } from '@supabase/supabase-js'

/**
 * Generate 7-day signed URLs for a list of attachment file paths.
 * Returns an array of { name, url } objects for including in SMS messages.
 */
export async function getAttachmentLinks(
  filePaths: string[],
): Promise<Array<{ name: string; url: string }>> {
  if (filePaths.length === 0) return []
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const results: Array<{ name: string; url: string }> = []
  for (const path of filePaths) {
    try {
      const { data } = await supabase.storage
        .from('attachments')
        .createSignedUrl(path, 60 * 60 * 24 * 7) // 7 days
      if (data?.signedUrl) {
        results.push({ name: path, url: data.signedUrl })
      }
    } catch (_e) { /* skip failed individual attachment */ }
  }
  return results
}

export async function sendOpenPhoneSms(
  apiKey: string,
  from: string,
  to: string,
  content: string,
): Promise<void> {
  const baseUrl = (process.env.QUO_BASE_URL ?? 'https://api.openphone.com/v1').replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], content }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`OpenPhone ${res.status}: ${text}`)
  }
}
