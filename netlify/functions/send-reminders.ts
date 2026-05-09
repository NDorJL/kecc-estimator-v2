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
// sendOpenPhoneSms import removed — all sends now go through the approval queue  // ← CHANGED

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── SMS Queue helper ─────────────────────────────────────────────────────────  // ← NEW
// Inserts a message into sms_queue with status='pending'.                       // ← NEW
// The message will NOT be sent until approved in the Dashboard queue panel.     // ← NEW
async function queueSms(opts: {                                                   // ← NEW
  toPhone:    string                                                              // ← NEW
  message:    string                                                              // ← NEW
  type:       'review_request' | 'quote_followup' | 'service_reminder' | 'kpi_report' | 'custom'  // ← NEW
  leadId?:    string | null                                                       // ← NEW
  contactId?: string | null                                                       // ← NEW
}): Promise<void> {                                                               // ← NEW
  const { error } = await supabase.from('sms_queue').insert({                    // ← NEW
    to_phone:   opts.toPhone,                                                     // ← NEW
    message:    opts.message,                                                     // ← NEW
    type:       opts.type,                                                        // ← NEW
    lead_id:    opts.leadId    ?? null,                                           // ← NEW
    contact_id: opts.contactId ?? null,                                           // ← NEW
    status:     'pending',                                                        // ← NEW
  })                                                                              // ← NEW
  if (error) throw new Error(`[sms-queue insert] ${error.message}`)              // ← NEW
}                                                                                 // ← NEW

/** Returns 'YYYY-MM-DD' for today + offsetDays, in UTC */
function dateOffset(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
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

        // QUEUED — will not send until approved in Dashboard          // ← CHANGED
        await queueSms({                                               // ← CHANGED
          toPhone:   job.customer_phone,                              // ← CHANGED
          message,                                                     // ← CHANGED
          type:      'service_reminder',                               // ← CHANGED
          contactId: job.contact_id,                                   // ← CHANGED
        })                                                             // ← CHANGED

        // Stamp reminder_sent_at so we don't re-queue the next day
        await supabase
          .from('jobs')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', job.id)

        // Log to contact's activity timeline (non-fatal)
        if (job.contact_id) {
          try { await supabase.from('activities').insert({
            contact_id: job.contact_id,
            type:       'sms_out',
            summary:    `Service reminder sent for ${job.service_name} on ${job.scheduled_date}`,
            metadata:   { jobId: job.id, scheduledDate: job.scheduled_date, to: job.customer_phone },
          }) } catch (_e) { /* non-fatal */ }
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

    console.log('[send-reminders] Done — job reminders complete')

    // ── Quote follow-up sweep ────────────────────────────────────────────────
    // Leads in 'quoted' where the quote was sent 3+ days ago and is still unsigned.
    // Send a follow-up SMS and advance to 'follow_up'.
    console.log('[send-reminders] Starting quote follow-up sweep')

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    // Join leads with their linked quote to check sent_at and signed_at
    const { data: staleQuoteLeads, error: staleLeadsErr } = await supabase
      .from('leads')
      .select(`
        id,
        contact_id,
        quote_id,
        quotes!inner (
          customer_name,
          customer_phone,
          sent_at,
          signed_at
        )
      `)
      .eq('stage', 'quoted')
      .is('follow_up_sent_at', null)
      .not('quote_id', 'is', null)

    if (staleLeadsErr) {
      console.error('[send-reminders] Quote follow-up query error:', staleLeadsErr.message)
    } else {
      // Filter in JS: sent_at exists, is > 3 days ago, and quote is not yet signed
      const toFollowUp = (staleQuoteLeads ?? []).filter(lead => {
        const q = Array.isArray(lead.quotes) ? lead.quotes[0] : lead.quotes as any
        return q?.sent_at && q.sent_at < threeDaysAgo && !q?.signed_at
      })

      if (toFollowUp.length === 0) {
        console.log('[send-reminders] No quote follow-ups needed today')
      } else {
        console.log(`[send-reminders] Sending ${toFollowUp.length} quote follow-up(s)`)

        for (const lead of toFollowUp) {
          const q = Array.isArray(lead.quotes) ? lead.quotes[0] : lead.quotes as any
          const name  = q?.customer_name  ?? null
          const phone = q?.customer_phone ?? null
          const firstName = name ? name.split(' ')[0] : 'there'
          const now = new Date().toISOString()

          // Always advance stage + stamp follow_up_sent_at
          await supabase
            .from('leads')
            .update({ stage: 'follow_up', follow_up_sent_at: now })
            .eq('id', lead.id)
            .catch(e => console.error(`[send-reminders] Stage update failed for lead ${lead.id}:`, (e as Error).message))

          if (phone && apiKey && fromNumber) {
            const message =
              `Hi ${firstName}, KECC here — just wanted to check in on the quote we sent the other day. ` +
              `Please let us know if there is anything we can do to earn your business. ` +
              `You can call or text this number to get in contact with a KECC rep! ` +
              `Automated msg. Reply STOP to opt out.`

            try {
              // QUEUED — will not send until approved in Dashboard        // ← CHANGED
              await queueSms({                                             // ← CHANGED
                toPhone:   phone,                                          // ← CHANGED
                message,                                                   // ← CHANGED
                type:      'quote_followup',                               // ← CHANGED
                leadId:    lead.id,                                        // ← CHANGED
                contactId: lead.contact_id,                               // ← CHANGED
              })                                                           // ← CHANGED
              console.log(`[send-reminders] ✓ Quote follow-up queued for ${name} (lead ${lead.id})`)  // ← CHANGED
            } catch (err) {
              console.error(`[send-reminders] ✗ Queue insert failed for lead ${lead.id}:`, err instanceof Error ? err.message : err)
            }
          } else {
            console.log(`[send-reminders] Lead ${lead.id} moved to follow_up (no phone/SMS — no message sent)`)
          }

          if (lead.contact_id) {
            try { await supabase.from('activities').insert({
              contact_id: lead.contact_id,
              type:       phone && apiKey ? 'sms_out' : 'note',
              summary:    phone && apiKey
                ? `Automated quote follow-up SMS sent to ${name}`
                : `Lead auto-advanced to Follow-Up (no phone on file)`,
              metadata:   { leadId: lead.id, automated: true },
            }) } catch (_e) { /* non-fatal */ }
          }
        }
      }
    }

    console.log('[send-reminders] Quote follow-up sweep done')

    // ── Scheduled → Finished/Unpaid auto-advance ─────────────────────────────
    // One-time jobs whose scheduled date has passed move to 'finished_unpaid'.
    console.log('[send-reminders] Starting finished/unpaid sweep')

    const today = new Date().toISOString().slice(0, 10)

    const { data: pastScheduled, error: pastErr } = await supabase
      .from('leads')
      .select(`
        id,
        contact_id,
        quote_id,
        jobs!inner (
          id,
          scheduled_date,
          status,
          job_type
        )
      `)
      .eq('stage', 'scheduled')
      .not('quote_id', 'is', null)

    if (pastErr) {
      console.error('[send-reminders] Finished/unpaid query error:', pastErr.message)
    } else {
      // Keep only leads whose linked job date has passed and job isn't cancelled
      const toFinish = (pastScheduled ?? []).filter(lead => {
        const job = Array.isArray(lead.jobs) ? lead.jobs[0] : lead.jobs as any
        return job?.scheduled_date
          && job.scheduled_date < today
          && job.status !== 'cancelled'
          && job.job_type !== 'quote_visit'
      })

      if (toFinish.length === 0) {
        console.log('[send-reminders] No jobs to move to finished/unpaid today')
      } else {
        console.log(`[send-reminders] Moving ${toFinish.length} lead(s) to finished/unpaid`)
        for (const lead of toFinish) {
          const job = Array.isArray(lead.jobs) ? lead.jobs[0] : lead.jobs as any

          await supabase
            .from('leads')
            .update({ stage: 'finished_unpaid' })
            .eq('id', lead.id)
            .catch(e => console.error(`[send-reminders] Stage update failed for lead ${lead.id}:`, (e as Error).message))

          // Mark the job as completed
          try {
            await supabase
              .from('jobs')
              .update({ status: 'completed' })
              .eq('id', job.id)
              .eq('status', 'scheduled')   // only if still 'scheduled', don't override manual changes
          } catch (_e) { /* non-fatal */ }

          if (lead.contact_id) {
            try { await supabase.from('activities').insert({
              contact_id: lead.contact_id,
              type:       'job_completed',
              summary:    `Job date passed — lead auto-moved to Finished/Unpaid`,
              metadata:   { leadId: lead.id, jobId: job.id, automated: true },
            }) } catch (_e) { /* non-fatal */ }
          }
          console.log(`[send-reminders] ✓ Lead ${lead.id} → finished/unpaid (job ${job.id})`)
        }
      }
    }

    console.log('[send-reminders] Finished/unpaid sweep done')

    // ── Review request sweep (v2) ────────────────────────────────────────────
    // Reads from review_requests table — triggered by lead stage changes via
    // _cascade.ts, not by jobs.completed_at (which is never stamped in our flow).
    console.log('[send-reminders] Starting review request sweep (v2)')

    // ── Part A: queue pending_queue records ──────────────────────────────────
    const { data: pendingReviews, error: pendingRevErr } = await supabase
      .from('review_requests')
      .select(`
        id, contact_id, lead_id, type,
        contacts!inner ( name, phone, has_left_review )
      `)
      .eq('status', 'pending_queue')

    if (pendingRevErr) {
      console.error('[send-reminders] review_requests pending query error:', pendingRevErr.message)
    } else {
      for (const rr of (pendingReviews ?? [])) {
        const contact = Array.isArray(rr.contacts) ? rr.contacts[0] : rr.contacts as any
        const phone   = contact?.phone ?? null
        const name    = contact?.name  ?? null

        // Skip if contact already left a review — clean up the record
        if (contact?.has_left_review) {
          await supabase.from('review_requests')
            .update({ status: 'max_reached' })
            .eq('id', rr.id)
            .catch(e => console.error('[send-reminders] cleanup max_reached failed:', (e as Error).message))
          continue
        }

        // Count total one_time requests for this contact to enforce 3-request cap
        if (rr.type === 'one_time') {
          const { count: totalCount } = await supabase
            .from('review_requests')
            .select('id', { count: 'exact', head: true })
            .eq('contact_id', rr.contact_id)
            .eq('type', 'one_time')
          if ((totalCount ?? 0) > 3) {
            await supabase.from('review_requests')
              .update({ status: 'max_reached' })
              .eq('id', rr.id)
              .catch(() => {})
            continue
          }
        }

        // Build message
        const firstName = name ? name.split(' ')[0] : 'there'
        const message =
          `Hi ${firstName}! Thank you for choosing ${companyName}! ` +
          `We'd love to hear about your experience. If you have a moment, ` +
          `please leave us a review:\n\n` +
          `https://g.page/r/CYjpuP4I4MbiEBM/review\n\n` +
          `It means the world to us! — ${companyName}\n` +
          `Reply STOP to opt out.`

        // Determine new status: if this is the 3rd record, mark max_reached after send
        const { count: priorSent } = await supabase
          .from('review_requests')
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', rr.contact_id)
          .eq('type', rr.type)
          .eq('status', 'sent_initial')
        const isThirdRequest = rr.type === 'one_time' && (priorSent ?? 0) >= 2
        const nextStatus = isThirdRequest ? 'max_reached' : 'sent_initial'

        try {
          if (phone && apiKey && fromNumber) {
            await queueSms({
              toPhone:   phone,
              message,
              type:      'review_request',
              contactId: rr.contact_id,
            })
          }
          await supabase.from('review_requests')
            .update({ status: nextStatus })
            .eq('id', rr.id)
          console.log(`[send-reminders] ✓ Review request queued for ${name ?? rr.contact_id} (rr ${rr.id}, status→${nextStatus})`)
        } catch (err) {
          console.error(`[send-reminders] ✗ Review queue failed for rr ${rr.id}:`, err instanceof Error ? err.message : err)
        }
      }
    }

    // ── Part B: create 30-day follow-up records ──────────────────────────────
    // For any sent_initial one_time record older than 30 days, create a new
    // pending_queue row if the contact hasn't reviewed and hasn't hit the cap.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: dueFollowups, error: followupErr } = await supabase
      .from('review_requests')
      .select('contact_id, lead_id')
      .eq('status', 'sent_initial')
      .eq('type', 'one_time')
      .lt('created_at', thirtyDaysAgo)

    if (followupErr) {
      console.error('[send-reminders] follow-up query error:', followupErr.message)
    } else {
      // Deduplicate by contact_id (multiple sent records could match)
      const followupContacts = new Map<string, string | null>()
      for (const row of (dueFollowups ?? [])) {
        if (row.contact_id && !followupContacts.has(row.contact_id)) {
          followupContacts.set(row.contact_id, row.lead_id ?? null)
        }
      }

      for (const [contactId, leadId] of followupContacts) {
        try {
          // Check has_left_review
          const { data: c } = await supabase
            .from('contacts').select('has_left_review').eq('id', contactId).single()
          if (c?.has_left_review) continue

          // Count total one_time records — don't exceed 3
          const { count: total } = await supabase
            .from('review_requests')
            .select('id', { count: 'exact', head: true })
            .eq('contact_id', contactId)
            .eq('type', 'one_time')
          if ((total ?? 0) >= 3) continue

          // Only create one follow-up if none is already pending
          const { count: alreadyPending } = await supabase
            .from('review_requests')
            .select('id', { count: 'exact', head: true })
            .eq('contact_id', contactId)
            .eq('type', 'one_time')
            .eq('status', 'pending_queue')
          if ((alreadyPending ?? 0) > 0) continue

          await supabase.from('review_requests').insert({
            contact_id: contactId,
            lead_id:    leadId,
            type:       'one_time',
            status:     'pending_queue',
          })
          console.log(`[send-reminders] ✓ 30-day follow-up review_request created for contact ${contactId}`)
        } catch (err) {
          console.error(`[send-reminders] ✗ Follow-up creation failed for contact ${contactId}:`, err instanceof Error ? err.message : err)
        }
      }
    }

    // ── Part C: recurring quarterly check ────────────────────────────────────
    // Contacts with active 'recurring' leads get a review request at most once
    // per quarter (90 days) and at most 4 times per year.
    const ninetyDaysAgo  = new Date(Date.now() - 90  * 24 * 60 * 60 * 1000).toISOString()
    const oneYearAgo     = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()

    const { data: recurringLeads, error: recurringLeadsErr } = await supabase
      .from('leads')
      .select('id, contact_id')
      .eq('stage', 'recurring')
      .not('contact_id', 'is', null)

    if (recurringLeadsErr) {
      console.error('[send-reminders] recurring leads query error:', recurringLeadsErr.message)
    } else {
      const seenContacts = new Set<string>()
      for (const lead of (recurringLeads ?? [])) {
        if (!lead.contact_id || seenContacts.has(lead.contact_id)) continue
        seenContacts.add(lead.contact_id)

        try {
          const { data: c } = await supabase
            .from('contacts').select('has_left_review').eq('id', lead.contact_id).single()
          if (c?.has_left_review) continue

          // Check 90-day cooldown — any recurring request in last 90 days?
          const { count: recentCount } = await supabase
            .from('review_requests')
            .select('id', { count: 'exact', head: true })
            .eq('contact_id', lead.contact_id)
            .eq('type', 'recurring')
            .gte('created_at', ninetyDaysAgo)
          if ((recentCount ?? 0) > 0) continue

          // Check yearly cap (max 4 per year)
          const { count: yearCount } = await supabase
            .from('review_requests')
            .select('id', { count: 'exact', head: true })
            .eq('contact_id', lead.contact_id)
            .eq('type', 'recurring')
            .gte('created_at', oneYearAgo)
          if ((yearCount ?? 0) >= 4) continue

          await supabase.from('review_requests').insert({
            contact_id: lead.contact_id,
            lead_id:    lead.id,
            type:       'recurring',
            status:     'pending_queue',
          })
          console.log(`[send-reminders] ✓ Quarterly recurring review_request created for contact ${lead.contact_id}`)
        } catch (err) {
          console.error(`[send-reminders] ✗ Recurring review creation failed:`, err instanceof Error ? err.message : err)
        }
      }
    }

    console.log('[send-reminders] Review request sweep (v2) done')
  } catch (err) {
    console.error('[send-reminders] Unexpected error:', err instanceof Error ? err.message : err)
  }
})

export { handler }
