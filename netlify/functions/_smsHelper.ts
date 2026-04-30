/**
 * _smsHelper.ts — shared OpenPhone SMS sender
 *
 * Single source of truth for sending SMS via the OpenPhone API.
 * Import this instead of defining sendOpenPhoneSms locally in each function.
 */

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
