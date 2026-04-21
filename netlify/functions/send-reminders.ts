/**
 * send-reminders.ts — Daily scheduled function
 *
 * Runs every day at 10 AM Eastern (14:00 UTC).
 * Finds all one-time jobs scheduled exactly 2 days from today that:
 *   - have a customer phone number
 *   - haven't had a reminder sent yet (reminder_sent_at IS NULL)
 *   - are not cancelled or completed
 * Sends an SMS reminder via OpenPhone, then stamps reminder_sent_at.
 */

import { schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** Returns 'YYYY-MM-DD' for today + offsetDays, in UTC */
function dateOffset(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

async function sendOpenPhoneSms(apiKey: string, from: string, to: string, content: string): Promise<void> {
  const baseUrl = (process.env.QUO_BASE_URL ?? 'https://api.openphone.com/v1').replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], content }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`OpenPhone ${res.status}: ${text}`)
  }
}

function buildReminderMessage(opts: {
  customerName: string
  serviceName: string
  scheduledDate: string   // 'YYYY-MM-DD'
  scheduledWindow: string | null
  companyName: string
}): string {
  const { customerName, serviceName, scheduledDate, scheduledWindow, companyName } = opts
  const firstName = customerName.split(' ')[0]

  const [yr, mo, dy] = scheduledDate.split('-').map(Number)
  const dateObj = new Date(yr, mo - 1, dy)
  const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' })
  const monthName = dateObj.toLocaleDateString('en-US', { month: 'long' })

  const windowMap: Record<string, string> = {
    morning:   'in the morning (8am–12pm)',
    afternoon: 'in the afternoon (12pm–5pm)',
    evening:   'in the evening (5pm–8pm)',
  }
  const windowStr = scheduledWindow && windowMap[scheduledWindow]
    ? ` ${windowMap[scheduledWindow]}`
    : ''

  return (
    `Hi ${firstName}! 👋 Just a heads-up — your ${serviceName} with ${companyName} is scheduled for ` +
    `${dayOfWeek}, ${monthName} ${dy}${windowStr}.\n\n` +
    `We'll see you then! If you need to make any changes, just reply to this message.\n\n` +
    `— ${companyName}\n` +
    `Reply STOP to opt out.`
  )
}

const handler = schedule('0 14 * * *', async () => {
  console.log('[send-reminders] Starting daily reminder run')

  try {
    // Fetch SMS credentials and company name from settings
    const { data: settings, error: settingsErr } = await supabase
      .from('company_settings')
      .select('quo_api_key, quo_from_number, company_name')
      .limit(1)
      .single()

    if (settingsErr || !settings) {
      console.error('[send-reminders] Could not load settings:', settingsErr?.message)
      return
    }

    const apiKey     = settings.quo_api_key    ?? process.env.QUO_API_KEY ?? ''
    const fromNumber = settings.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
    const companyName = settings.company_name ?? 'Knox Exterior Care Co.'

    if (!apiKey || !fromNumber) {
      console.log('[send-reminders] OpenPhone not configured — skipping')
      return
    }

    // Find jobs scheduled 2 days from today
    const targetDate = dateOffset(2)
    console.log(`[send-reminders] Looking for one-time jobs on ${targetDate}`)

    const { data: jobs, error: jobsErr } = await supabase
      .from('jobs')
      .select('id, customer_name, customer_phone, service_name, scheduled_date, scheduled_window, contact_id')
      .eq('job_type', 'one_time')
      .eq('scheduled_date', targetDate)
      .not('customer_phone', 'is', null)
      .is('reminder_sent_at', null)
      .not('status', 'in', '("cancelled","completed")')

    if (jobsErr) {
      console.error('[send-reminders] Query error:', jobsErr.message)
      return
    }

    if (!jobs || jobs.length === 0) {
      console.log('[send-reminders] No jobs to remind today')
      return
    }

    console.log(`[send-reminders] Sending ${jobs.length} reminder(s)`)

    for (const job of jobs) {
      if (!job.customer_phone || !job.customer_name) continue

      try {
        const message = buildReminderMessage({
          customerName:    job.customer_name,
          serviceName:     job.service_name,
          scheduledDate:   job.scheduled_date,
          scheduledWindow: job.scheduled_window,
          companyName,
        })

        await sendOpenPhoneSms(apiKey, fromNumber, job.customer_phone, message)

        // Stamp reminder_sent_at so we don't double-send
        await supabase
          .from('jobs')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', job.id)

        // Log to contact's activity timeline (non-fatal)
        if (job.contact_id) {
          await supabase.from('activities').insert({
            contact_id: job.contact_id,
            type:       'sms_out',
            summary:    `Service reminder sent for ${job.service_name} on ${job.scheduled_date}`,
            metadata:   { jobId: job.id, scheduledDate: job.scheduled_date, to: job.customer_phone },
          }).catch(() => {})
        }

        console.log(`[send-reminders] ✓ Reminded ${job.customer_name} (job ${job.id})`)
      } catch (err) {
        // Log failure but keep going — one bad number shouldn't stop the rest
        console.error(`[send-reminders] ✗ Failed for job ${job.id}:`, err instanceof Error ? err.message : err)

        // Still stamp reminder_sent_at to prevent retry loops on bad numbers
        // (remove this line if you want it to retry the next day)
        await supabase
          .from('jobs')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', job.id)
      }
    }

    console.log('[send-reminders] Done')
  } catch (err) {
    console.error('[send-reminders] Unexpected error:', err instanceof Error ? err.message : err)
  }
})

export { handler }
