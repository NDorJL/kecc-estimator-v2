// ── Quote Types ────────────────────────────────────────────────────────
export type QuoteType =
  | 'residential_onetime'
  | 'commercial_onetime'
  | 'residential_tcep'
  | 'commercial_tcep'
  | 'residential_autopilot'
  | 'commercial_autopilot';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined';

export interface LineItem {
  serviceId: string;
  serviceName: string;
  category: string;
  description?: string;
  quantity: number;
  unitLabel?: string;
  frequency?: string;
  unitPrice: number;
  lineTotal: number;
  isSubscription: boolean;
  monthlyAmount?: number;
}

export interface Quote {
  id: string;
  customerName: string;
  customerAddress: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  businessName: string | null;
  quoteType: QuoteType;
  lineItems: LineItem[];
  subtotal: number;
  discount: number | null;
  total: number;
  notes: string | null;
  status: QuoteStatus;
  trashedAt: string | null;
  createdAt: string;
}

// ── Subscription Types ─────────────────────────────────────────────────
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELED' | 'ARCHIVED';

export interface SubscriptionService {
  id: string;
  serviceName: string;
  category: string;
  description?: string;
  pricePerMonth: number;
  frequency: string;
  seasonal: boolean;
  activeMonths: number[];
}

export interface ChangeHistoryEntry {
  timestamp: string;
  changedBy: string;
  summary: string;
}

export interface Subscription {
  id: string;
  customerName: string;
  customerAddress: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  businessName: string | null;
  status: SubscriptionStatus;
  startDate: string;
  pauseUntil: string | null;
  services: SubscriptionService[];
  inSeasonMonthlyTotal: number;
  offSeasonMonthlyTotal: number;
  quickbooksReference: string | null;
  changeHistory: ChangeHistoryEntry[];
  createdAt: string;
}

// ── Settings & Attachments ─────────────────────────────────────────────
export interface CompanySettings {
  id: string;
  companyName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
  quoteFooter: string | null;
}

export interface QuoteAttachment {
  id: string;
  name: string;
  fileName: string;
  fileUrl: string;
  filePath: string;
  enabled: boolean;
  attachMode: 'always' | 'manual';
  sortOrder: number;
  createdAt: string;
}

export interface PriceOverride {
  id: string;
  serviceId: string;
  field: string;
  value: number;
}

// ── Seasonal constants (from original shared/schema.ts) ────────────────
export const MOWING_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11]
export const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const OFF_SEASON_MONTHS = [12, 1, 2];
export const SEASONAL_CATEGORIES = ['Lawn Care'];

export function computeSeasonalTotals(services: SubscriptionService[]) {
  let inSeason = 0;
  let offSeason = 0;
  for (const svc of services) {
    const activeInSeason = svc.activeMonths.some(m => MOWING_MONTHS.includes(m));
    const activeOffSeason = svc.activeMonths.some(m => OFF_SEASON_MONTHS.includes(m));
    if (activeInSeason) inSeason += svc.pricePerMonth;
    if (activeOffSeason) offSeason += svc.pricePerMonth;
  }
  return {
    inSeason: Math.round(inSeason * 100) / 100,
    offSeason: Math.round(offSeason * 100) / 100,
  };
}

// ── Supabase row → camelCase helpers ──────────────────────────────────
// Supabase returns snake_case columns; these helpers normalize them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToQuote(r: any): Quote {
  return {
    id: r.id,
    customerName: r.customer_name,
    customerAddress: r.customer_address,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    businessName: r.business_name,
    quoteType: r.quote_type,
    lineItems: Array.isArray(r.line_items) ? r.line_items : [],
    subtotal: Number(r.subtotal),
    discount: r.discount !== null ? Number(r.discount) : null,
    total: Number(r.total),
    notes: r.notes,
    status: r.status,
    trashedAt: r.trashed_at,
    createdAt: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToSubscription(r: any): Subscription {
  return {
    id: r.id,
    customerName: r.customer_name,
    customerAddress: r.customer_address,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    businessName: r.business_name,
    status: r.status,
    startDate: r.start_date,
    pauseUntil: r.pause_until,
    services: Array.isArray(r.services) ? r.services : [],
    inSeasonMonthlyTotal: Number(r.in_season_monthly_total),
    offSeasonMonthlyTotal: Number(r.off_season_monthly_total),
    quickbooksReference: r.quickbooks_reference,
    changeHistory: Array.isArray(r.change_history) ? r.change_history : [],
    createdAt: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToSettings(r: any): CompanySettings {
  return {
    id: r.id,
    companyName: r.company_name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    logoUrl: r.logo_url,
    quoteFooter: r.quote_footer,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToAttachment(r: any): QuoteAttachment {
  return {
    id: r.id,
    name: r.name,
    fileName: r.file_name,
    fileUrl: r.file_url,
    filePath: r.file_path,
    enabled: r.enabled,
    attachMode: r.attach_mode,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}
