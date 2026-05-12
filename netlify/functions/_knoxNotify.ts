/**
 * _knoxNotify.ts — Shared Knox owner notification helper
 * Used by event-driven functions to send direct SMS to the owner.
 * All calls are fire-and-forget (non-fatal).
 */
import { sendOpenPhoneSms } from './_smsHelper'

const OWNER_PHONE = process.env.OWNER_PHONE ?? '8656036396'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notifyOwner(supabase: any, message: string): Promise<void> {
  const { data: settings } = await supabase
    .from('company_settings')
    .select('quo_api_key, quo_from_number')
    .limit(1).single()

  const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY     ?? ''
  const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''

  if (!apiKey || !fromNumber) return
  await sendOpenPhoneSms(apiKey, fromNumber, OWNER_PHONE, message)
}
