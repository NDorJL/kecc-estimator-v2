import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Quo (OpenPhone) deep-link helpers ─────────────────────────────────────────
// Opens OpenPhone directly instead of the native dialer / Messages app.
// URL scheme: openphone://  —  update the paths here if OpenPhone changes them.

export function quoCallUrl(phone: string): string {
  return `openphone://calls/new?to=${encodeURIComponent(phone)}`
}

export function quoTextUrl(phone: string): string {
  return `openphone://messages/new?to=${encodeURIComponent(phone)}`
}
