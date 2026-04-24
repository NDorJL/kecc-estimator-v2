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
  contactId: string | null;
  expiresAt: string | null;
  acceptToken: string | null;
  // E-sign fields
  signedAt: string | null;
  signatureData: string | null;
  signedIp: string | null;
  qbInvoiceId: string | null;
  sentAt: string | null;
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

// Per-service scheduling config stored on a subscription
// dayOfWeek: 0=Sunday … 6=Saturday
// startDate: ISO date string — the first occurrence (used to calculate bi-weekly parity)
export interface ServiceSchedule {
  serviceId: string;
  serviceName: string;
  frequency: string;        // matches SubscriptionService.frequency
  dayOfWeek: number;        // 0–6
  startDate: string;        // ISO 'YYYY-MM-DD'
  contractorId: string | null;
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
  contactId: string | null;
  agreementId: string | null;
  qbInvoiceId: string | null;
  serviceSchedules: ServiceSchedule[];
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
  serviceAgreementTemplate: string | null;
  qbConnected: boolean;
  qbRealmId: string | null;
  qbTokenExpiresAt: string | null;
  quoApiKey: string | null;
  quoFromNumber: string | null;
  googleCalConnected: boolean;
  themeConfig: Record<string, string>;
  navConfig: { items?: Array<{ id: string; visible: boolean }> };
  googleCalId: string | null;
  googleCalExpiresAt: string | null;
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

// ── Contractor Types ────────────────────────────────────────────────────
export interface ContractorDoc {
  id: string;
  name: string;
  docType: string;   // 'w9' | 'agreement' | 'license' | 'other'
  fileUrl: string;
  filePath: string;
  uploadedAt: string;
}

export interface Contractor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  specialty: string | null;
  ratePerJob: number | null;
  notes: string | null;
  is1099: boolean;
  documents: ContractorDoc[];
  createdAt: string;
}

// ── Service Agreement Types ─────────────────────────────────────────────
export type AgreementStatus = 'draft' | 'pending_signature' | 'signed' | 'void';

export interface ServiceAgreement {
  id: string;
  contactId: string;
  subscriptionId: string | null;
  customerName: string;
  customerAddress: string | null;
  status: AgreementStatus;
  quoteType: string | null;
  pdfPath: string | null;
  pdfUrl: string | null;
  acceptToken: string | null;
  signedAt: string | null;
  qbInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
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

// ── Contact / Property / Lead / Activity Types ────────────────────────
export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  type: 'residential' | 'commercial';
  businessName: string | null;
  source: string | null;
  notes: string | null;
  tags: string[];
  customFields: Record<string, string>;
  leadScore: number;
  referredBy: string | null;
  nextFollowup: string | null;
  createdAt: string;
}

export interface Property {
  id: string;
  contactId: string;
  label: string | null;
  address: string;
  type: 'residential' | 'commercial';
  mowableAcres: number | null;
  sqft: number | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  createdAt: string;
}

export type LeadStage =
  | 'new' | 'contacted' | 'follow_up' | 'quoted' | 'scheduled'
  | 'recurring' | 'finished_unpaid' | 'finished_paid'
  // keep 'lost' in the type for DB compatibility with older rows; not shown in kanban
  | 'lost'
  // legacy aliases kept for any in-flight DB rows during migration window
  | 'finished' | 'unpaid' | 'paid';

export interface Lead {
  id: string;
  contactId: string | null;
  stage: LeadStage;
  source: string | null;
  serviceInterest: string | null;
  estimatedValue: number | null;
  quoteId: string | null;
  lostReason: string | null;
  notes: string | null;
  createdAt: string;
  contactedAt: string | null;
  followUpSentAt: string | null;
  agreementSignedAt: string | null;
}

export type ActivityType =
  | 'note' | 'call' | 'sms_in' | 'sms_out' | 'email_sent'
  | 'quote_sent' | 'quote_accepted' | 'quote_declined'
  | 'job_scheduled' | 'job_completed' | 'invoice_sent'
  | 'payment_received' | 'esign_sent' | 'esign_completed';

export interface Activity {
  id: string;
  contactId: string;
  type: ActivityType;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Supabase row → camelCase helpers ──────────────────────────────────
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
    contactId: r.contact_id ?? null,
    expiresAt: r.expires_at ?? null,
    acceptToken: r.accept_token ?? null,
    signedAt: r.signed_at ?? null,
    signatureData: r.signature_data ?? null,
    signedIp: r.signed_ip ?? null,
    qbInvoiceId: r.qb_invoice_id ?? null,
    sentAt: r.sent_at ?? null,
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
    contactId: r.contact_id ?? null,
    agreementId: r.agreement_id ?? null,
    qbInvoiceId: r.qb_invoice_id ?? null,
    serviceSchedules: Array.isArray(r.service_schedules) ? r.service_schedules : [],
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
    serviceAgreementTemplate: r.service_agreement_template ?? null,
    qbConnected: !!r.qb_realm_id,
    qbRealmId: r.qb_realm_id ?? null,
    qbTokenExpiresAt: r.qb_token_expires_at ?? null,
    quoApiKey: r.quo_api_key ?? null,
    quoFromNumber: r.quo_from_number ?? null,
    themeConfig: r.theme_config ?? {},
    navConfig: r.nav_config ?? {},
    googleCalConnected: !!r.google_cal_refresh_token,
    googleCalId: r.google_cal_id ?? null,
    googleCalExpiresAt: r.google_cal_token_expires_at ?? null,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToContact(r: any): Contact {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    type: r.type,
    businessName: r.business_name,
    source: r.source,
    notes: r.notes,
    tags: Array.isArray(r.tags) ? r.tags : [],
    customFields: r.custom_fields ?? {},
    leadScore: r.lead_score ?? 0,
    referredBy: r.referred_by,
    nextFollowup: r.next_followup,
    createdAt: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToProperty(r: any): Property {
  return {
    id: r.id,
    contactId: r.contact_id,
    label: r.label,
    address: r.address,
    type: r.type,
    mowableAcres: r.mowable_acres !== null ? Number(r.mowable_acres) : null,
    sqft: r.sqft !== null ? Number(r.sqft) : null,
    lat: r.lat !== null ? Number(r.lat) : null,
    lng: r.lng !== null ? Number(r.lng) : null,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToLead(r: any): Lead {
  return {
    id: r.id,
    contactId: r.contact_id,
    stage: r.stage,
    source: r.source,
    serviceInterest: r.service_interest,
    estimatedValue: r.estimated_value !== null ? Number(r.estimated_value) : null,
    quoteId: r.quote_id,
    lostReason: r.lost_reason,
    notes: r.notes,
    createdAt: r.created_at,
    contactedAt: r.contacted_at ?? null,
    followUpSentAt: r.follow_up_sent_at ?? null,
    agreementSignedAt: r.agreement_signed_at ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToActivity(r: any): Activity {
  return {
    id: r.id,
    contactId: r.contact_id,
    type: r.type,
    summary: r.summary,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToContractor(r: any): Contractor {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? null,
    email: r.email ?? null,
    company: r.company ?? null,
    specialty: r.specialty ?? null,
    ratePerJob: r.rate_per_job !== null && r.rate_per_job !== undefined ? Number(r.rate_per_job) : null,
    notes: r.notes ?? null,
    is1099: r.is_1099,
    documents: Array.isArray(r.documents) ? r.documents : [],
    createdAt: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToServiceAgreement(r: any): ServiceAgreement {
  return {
    id: r.id,
    contactId: r.contact_id,
    subscriptionId: r.subscription_id ?? null,
    customerName: r.customer_name,
    customerAddress: r.customer_address ?? null,
    status: r.status,
    quoteType: r.quote_type ?? null,
    pdfPath: r.pdf_path ?? null,
    pdfUrl: r.pdf_url ?? null,
    acceptToken: r.accept_token ?? null,
    signedAt: r.signed_at ?? null,
    qbInvoiceId: r.qb_invoice_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Job Types ──────────────────────────────────────────────────────────
export type JobType   = 'one_time' | 'subscription_visit' | 'quote_visit';
export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface Job {
  id: string;
  contactId: string | null;
  subscriptionId: string | null;
  quoteId: string | null;
  contractorId: string | null;
  jobType: JobType;
  serviceName: string;
  status: JobStatus;
  scheduledDate: string | null;     // ISO date 'YYYY-MM-DD'
  scheduledTime: string | null;     // 'HH:MM' 24-hour, for quote visits
  scheduledWindow: string | null;   // 'morning' | 'afternoon' | 'evening' | 'anytime'
  startTime: string | null;         // ISO timestamptz
  endTime: string | null;           // ISO timestamptz
  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  internalNotes: string | null;
  propertyInfo: Record<string, string>;  // gateCode, dogOnProperty, parkingNotes, etc.
  googleEventId: string | null;
  reminderSentAt: string | null;
  createdAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToJob(r: any): Job {
  return {
    id: r.id,
    contactId: r.contact_id ?? null,
    subscriptionId: r.subscription_id ?? null,
    quoteId: r.quote_id ?? null,
    contractorId: r.contractor_id ?? null,
    jobType: r.job_type ?? 'one_time',
    serviceName: r.service_name,
    status: r.status ?? 'scheduled',
    scheduledDate: r.scheduled_date ?? null,
    scheduledTime: r.scheduled_time ?? null,
    scheduledWindow: r.scheduled_window ?? null,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    customerName: r.customer_name ?? null,
    customerAddress: r.customer_address ?? null,
    customerPhone: r.customer_phone ?? null,
    customerEmail: r.customer_email ?? null,
    notes: r.notes ?? null,
    internalNotes: r.internal_notes ?? null,
    propertyInfo: r.property_info ?? {},
    googleEventId: r.google_event_id ?? null,
    reminderSentAt: r.reminder_sent_at ?? null,
    createdAt: r.created_at,
  };
}
