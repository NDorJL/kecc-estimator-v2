/**
 * _emailHelper.ts — shared Resend email sender
 *
 * Uses Resend API to send email with optional PDF attachment.
 * env vars: RESEND_API_KEY, RESEND_FROM (e.g. "KECC <noreply@kecc.com>")
 *
 * If RESEND_API_KEY is not set, logs a warning and skips silently.
 */

import { Resend } from 'resend'

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  pdfBuffer?: Buffer
  pdfFilename?: string
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping email to', opts.to)
    return
  }

  const from = process.env.RESEND_FROM ?? 'KECC <noreply@kecc.com>'
  const resend = new Resend(apiKey)

  const attachments: Array<{ filename: string; content: Buffer }> = []
  if (opts.pdfBuffer && opts.pdfFilename) {
    attachments.push({ filename: opts.pdfFilename, content: opts.pdfBuffer })
  }

  const { error } = await resend.emails.send({
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    attachments: attachments.length > 0 ? attachments : undefined,
  })

  if (error) {
    throw new Error(`Resend error: ${error.message}`)
  }
}
