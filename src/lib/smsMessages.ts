/**
 * smsMessages.ts — shared SMS message builders
 *
 * Single source of truth for all outgoing SMS message templates.
 * Import specific builders instead of defining locally in each component.
 */

type ScheduleWindow = 'morning' | 'afternoon' | 'anytime'

const WINDOW_LABELS: Record<ScheduleWindow, string> = {
  morning:   'in the morning (8 am–12 pm)',
  afternoon: 'in the afternoon (12 pm–5 pm)',
  anytime:   '',
}

/**
 * Appointment confirmation SMS sent after a one-time job is scheduled.
 * Used by ScheduleQuoteSheet and the Jobs page New Job sheet.
 */
export function buildAppointmentSms(opts: {
  firstName: string
  serviceName: string
  date: string          // 'YYYY-MM-DD'
  window: ScheduleWindow
  companyName: string
}): string {
  const { firstName, serviceName, date, window, companyName } = opts
  const [yr, mo, dy] = date.split('-').map(Number)
  const d         = new Date(yr, mo - 1, dy)
  const dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'long' })
  const monthName = d.toLocaleDateString('en-US', { month: 'long' })
  const windowStr = WINDOW_LABELS[window] ? ` ${WINDOW_LABELS[window]}` : ''

  return (
    `Hi ${firstName}! Your ${serviceName} with ${companyName} is confirmed for ` +
    `${dayOfWeek}, ${monthName} ${dy}, ${yr}${windowStr}.\n\n` +
    `If you have any questions or need to make changes, just reply to this message.\n\n` +
    `Thank you for choosing ${companyName}!\n\nAutomated msg. Reply STOP to opt out.`
  )
}
