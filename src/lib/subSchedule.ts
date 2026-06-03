/**
 * subSchedule.ts — the single source of truth for subscription recurrence.
 *
 * Answers one question: does a subscription service-schedule fire a visit on a given
 * date? Shared by CalendarPage (event generation) and Finance (occurrence counting) so
 * the calendar and the "jobs done"/revenue metrics can never disagree about how many
 * times a recurring customer is serviced.
 *
 * Pure + deterministic. Months are passed 1-based here for readability. The frequency
 * vocabulary is matched by substring (weekly, bi-weekly, monthly, bi-monthly, quarterly,
 * annual) to tolerate the free-text values stored on services/schedules.
 */

export interface ScheduleStart {
  y: number
  m: number // 1-based (May = 5)
  d: number
}

/**
 * @param dow target weekday 0–6, or null to derive it from the start date
 *            (legacy services[] fallback path).
 */
export function scheduleFiresOn(
  start: ScheduleStart,
  freq: string,
  dow: number | null,
  check: { y: number; m: number; d: number }, // m 1-based
): boolean {
  const { y: sy, m: sm, d: sd } = start
  const f = (freq ?? '').toLowerCase()

  // Must be on or after the start date.
  if (check.y < sy) return false
  if (check.y === sy && check.m < sm) return false
  if (check.y === sy && check.m === sm && check.d < sd) return false

  const totalMonths = (check.y - sy) * 12 + (check.m - sm)
  const isDateBased = f.includes('quarter') || f.includes('annual')
  if (isDateBased) {
    const interval = f.includes('quarter') ? 3 : 12
    return totalMonths % interval === 0 && check.d === sd
  }

  // Weekday-based frequencies: must land on the target weekday first.
  const targetDow = dow ?? new Date(sy, sm - 1, sd).getDay()
  const checkDow = new Date(check.y, check.m - 1, check.d).getDay()
  if (checkDow !== targetDow) return false

  if (f.includes('bi') && f.includes('week')) {
    // Bi-weekly: same week parity as the start week.
    const startSunday = new Date(sy, sm - 1, sd - new Date(sy, sm - 1, sd).getDay())
    const thisSunday = new Date(check.y, check.m - 1, check.d - checkDow)
    const weekDiff = Math.round((thisSunday.getTime() - startSunday.getTime()) / (7 * 86400000))
    return weekDiff % 2 === 0
  }

  if (f.includes('month')) {
    // Monthly / bi-monthly: only the weekday occurrence closest to the start day-of-month.
    const daysInMonth = new Date(check.y, check.m, 0).getDate()
    const occs: number[] = []
    for (let d2 = 1; d2 <= daysInMonth; d2++) {
      if (new Date(check.y, check.m - 1, d2).getDay() === targetDow) occs.push(d2)
    }
    const best = occs.reduce((a, b) => (Math.abs(a - sd) <= Math.abs(b - sd) ? a : b))
    if (check.d !== best) return false
    if (f.includes('bi')) return totalMonths % 2 === 0 // bi-monthly: every other month
    return true
  }

  // Weekly: every matching weekday.
  return true
}
