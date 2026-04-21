/**
 * theme.ts — Color theming utilities
 *
 * Colors are stored as hex strings (#rrggbb) in the DB.
 * On load they're converted to HSL and injected as CSS variables
 * so the full Tailwind + shadcn variable system keeps working.
 */

// ── Conversion helpers ────────────────────────────────────────────────────────

export function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

export function hslToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/)
  if (parts.length < 3) return '#000000'
  const h = parseFloat(parts[0]) / 360
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// ── Theme shape ───────────────────────────────────────────────────────────────

export interface ThemeConfig {
  primaryColor:      string   // hex — buttons, active tabs, links
  primaryForeground: string   // hex — text on primary-colored backgrounds
  backgroundColor:   string   // hex — main page background
  cardColor:         string   // hex — cards, header, nav bar background
  foregroundColor:   string   // hex — main body text
  borderColor:       string   // hex — dividers, input borders
  mutedColor:        string   // hex — muted chips, secondary surfaces
  mutedForeground:   string   // hex — secondary text
}

// ── Presets ───────────────────────────────────────────────────────────────────

export interface ThemePreset extends ThemeConfig {
  label: string
}

export const THEME_PRESETS: Record<string, ThemePreset> = {
  default: {
    label: 'Default (Orange)',
    primaryColor:      '#e06307',
    primaryForeground: '#fefefe',
    backgroundColor:   '#ffffff',
    cardColor:         '#ffffff',
    foregroundColor:   '#0c0a09',
    borderColor:       '#e7e5e4',
    mutedColor:        '#f5f5f4',
    mutedForeground:   '#78716c',
  },
  highContrast: {
    label: 'High Contrast',
    primaryColor:      '#000000',
    primaryForeground: '#ffffff',
    backgroundColor:   '#ffffff',
    cardColor:         '#f8f8f8',
    foregroundColor:   '#000000',
    borderColor:       '#000000',
    mutedColor:        '#eeeeee',
    mutedForeground:   '#333333',
  },
  forest: {
    label: 'Forest Green',
    primaryColor:      '#16a34a',
    primaryForeground: '#ffffff',
    backgroundColor:   '#f0fdf4',
    cardColor:         '#ffffff',
    foregroundColor:   '#14532d',
    borderColor:       '#bbf7d0',
    mutedColor:        '#dcfce7',
    mutedForeground:   '#166534',
  },
  ocean: {
    label: 'Ocean Blue',
    primaryColor:      '#2563eb',
    primaryForeground: '#ffffff',
    backgroundColor:   '#eff6ff',
    cardColor:         '#ffffff',
    foregroundColor:   '#1e3a5f',
    borderColor:       '#bfdbfe',
    mutedColor:        '#dbeafe',
    mutedForeground:   '#1d4ed8',
  },
  slate: {
    label: 'Slate',
    primaryColor:      '#475569',
    primaryForeground: '#f8fafc',
    backgroundColor:   '#f8fafc',
    cardColor:         '#ffffff',
    foregroundColor:   '#0f172a',
    borderColor:       '#cbd5e1',
    mutedColor:        '#f1f5f9',
    mutedForeground:   '#64748b',
  },
  crimson: {
    label: 'Crimson',
    primaryColor:      '#dc2626',
    primaryForeground: '#ffffff',
    backgroundColor:   '#fff5f5',
    cardColor:         '#ffffff',
    foregroundColor:   '#1a0000',
    borderColor:       '#fecaca',
    mutedColor:        '#fee2e2',
    mutedForeground:   '#991b1b',
  },
  midnight: {
    label: 'Midnight',
    primaryColor:      '#818cf8',
    primaryForeground: '#1e1b4b',
    backgroundColor:   '#0f172a',
    cardColor:         '#1e293b',
    foregroundColor:   '#f1f5f9',
    borderColor:       '#334155',
    mutedColor:        '#1e293b',
    mutedForeground:   '#94a3b8',
  },
}

// ── Apply theme to :root CSS variables ───────────────────────────────────────

export function applyTheme(config: Partial<ThemeConfig>) {
  const root = document.documentElement
  const set = (varName: string, hex: string) => {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return
    root.style.setProperty(varName, hexToHsl(hex))
  }

  if (config.primaryColor) {
    set('--primary', config.primaryColor)
    set('--ring', config.primaryColor)
  }
  if (config.primaryForeground) set('--primary-foreground', config.primaryForeground)
  if (config.backgroundColor)   set('--background', config.backgroundColor)
  if (config.cardColor) {
    set('--card', config.cardColor)
    set('--popover', config.cardColor)
  }
  if (config.foregroundColor) {
    set('--foreground', config.foregroundColor)
    set('--card-foreground', config.foregroundColor)
    set('--popover-foreground', config.foregroundColor)
  }
  if (config.borderColor) {
    set('--border', config.borderColor)
    set('--input', config.borderColor)
  }
  if (config.mutedColor) {
    set('--muted', config.mutedColor)
    set('--accent', config.mutedColor)
    set('--secondary', config.mutedColor)
  }
  if (config.mutedForeground) {
    set('--muted-foreground', config.mutedForeground)
    set('--accent-foreground', config.mutedForeground)
  }
}

export function clearTheme() {
  const vars = [
    '--primary','--ring','--primary-foreground','--background',
    '--card','--popover','--foreground','--card-foreground','--popover-foreground',
    '--border','--input','--muted','--accent','--secondary',
    '--muted-foreground','--accent-foreground',
  ]
  vars.forEach(v => document.documentElement.style.removeProperty(v))
}

// ── Nav config ────────────────────────────────────────────────────────────────

export interface NavItemConfig {
  id: string
  visible: boolean
}

export interface NavConfig {
  items: NavItemConfig[]
}

export const ALL_NAV_ITEMS = [
  { id: 'dashboard',     label: 'Dashboard',  path: '/' },
  { id: 'contacts',      label: 'Contacts',   path: '/contacts' },
  { id: 'calendar',      label: 'Calendar',   path: '/calendar' },
  { id: 'jobs',          label: 'Jobs',       path: '/jobs' },
  { id: 'calculator',    label: 'Calc',       path: '/calculator' },
  { id: 'quotes',        label: 'Quotes',     path: '/quotes' },
  { id: 'subscriptions', label: 'Subs',       path: '/subscriptions' },
  { id: 'finance',       label: 'Finance',    path: '/finance' },
  { id: 'pricebook',     label: 'Price Book', path: '/pricebook' },
  { id: 'leads',         label: 'Leads',      path: '/leads' },
  { id: 'settings',      label: 'Settings',   path: '/settings' },
] as const

export const DEFAULT_NAV: NavItemConfig[] = [
  { id: 'dashboard',     visible: true  },
  { id: 'contacts',      visible: false },
  { id: 'calendar',      visible: true  },
  { id: 'jobs',          visible: false },
  { id: 'calculator',    visible: true  },
  { id: 'quotes',        visible: true  },
  { id: 'subscriptions', visible: true  },
  { id: 'finance',       visible: false },
  { id: 'pricebook',     visible: false },
  { id: 'leads',         visible: false },
  { id: 'settings',      visible: true  },
]
