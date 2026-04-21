import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { CompanySettings, QuoteAttachment } from '@/types'
import { apiRequest, apiGet } from '@/lib/queryClient'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Save, Loader2, Upload, X, ImageIcon, Paperclip, FileText, Trash2, Plus, Link2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { applyTheme, clearTheme, THEME_PRESETS, ALL_NAV_ITEMS, DEFAULT_NAV, type ThemeConfig, type NavItemConfig } from '@/lib/theme'

const settingsFormSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  phone: z.string().optional().default(''),
  email: z.string().optional().default(''),
  address: z.string().optional().default(''),
  quoteFooter: z.string().optional().default(''),
})
type SettingsFormValues = z.infer<typeof settingsFormSchema>

/* ── Logo Upload ──────────────────────────────────────────────────────── */
function LogoUpload({
  currentLogoUrl,
  onUploaded,
}: {
  currentLogoUrl: string
  onUploaded: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [preview, setPreview] = useState<string>(currentLogoUrl || '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    setPreview(currentLogoUrl || '')
  }, [currentLogoUrl])

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Invalid file', description: 'Please upload an image file.', variant: 'destructive' })
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: 'File too large', description: 'Logo must be under 5 MB.', variant: 'destructive' })
        return
      }
      setIsUploading(true)
      try {
        const formData = new FormData()
        formData.append('logo', file)
        const res = await fetch('/.netlify/functions/settings?action=logo', {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) throw new Error('Upload failed')
        const data = await res.json()
        setPreview(data.logoUrl)
        onUploaded()
        toast({ title: 'Logo uploaded', description: 'Your logo has been saved.' })
      } catch (err) {
        toast({ title: 'Upload failed', description: String(err), variant: 'destructive' })
      } finally {
        setIsUploading(false)
      }
    },
    [toast, onUploaded],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) uploadFile(file)
    },
    [uploadFile],
  )

  const removeLogo = useCallback(async () => {
    try {
      await apiRequest('PATCH', '/settings', { logoUrl: '' })
      setPreview('')
      onUploaded()
      toast({ title: 'Logo removed' })
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    }
  }, [toast, onUploaded])

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Company Logo</label>

      {preview && (
        <div className="relative inline-block">
          <img
            src={preview}
            alt="Logo preview"
            className="h-16 max-w-[200px] object-contain border rounded-md p-1 bg-white"
          />
          <Button
            size="icon"
            variant="destructive"
            className="absolute -top-2 -right-2 h-5 w-5 rounded-full"
            onClick={removeLogo}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div
        className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/30 hover:border-muted-foreground/50'
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadFile(file)
            e.target.value = ''
          }}
        />
        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Uploading...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {isDragging ? (
              <Upload className="h-8 w-8 text-primary" />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground">
              {isDragging ? 'Drop your logo here' : 'Drag & drop a logo, or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground">PNG, JPG, SVG — max 5 MB</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Quote Attachments ────────────────────────────────────────────────── */
function QuoteAttachmentsSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadName, setUploadName] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  const { data: attachments = [], isLoading } = useQuery<QuoteAttachment[]>({
    queryKey: ['/attachments'],
    queryFn: () => apiGet<QuoteAttachment[]>('/attachments'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<QuoteAttachment> }) =>
      apiRequest('PATCH', `/attachments/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/attachments'] })
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/attachments'] })
      toast({ title: 'Attachment removed' })
    },
  })

  // Signed-URL upload flow: get signed URL → PUT directly to Supabase → register metadata
  const uploadAttachment = useCallback(
    async (file: File) => {
      if (file.type !== 'application/pdf') {
        toast({ title: 'Invalid file', description: 'Only PDF files are supported.', variant: 'destructive' })
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: 'File too large', description: 'Attachment must be under 10 MB.', variant: 'destructive' })
        return
      }
      if (attachments.length >= 5) {
        toast({ title: 'Limit reached', description: 'Maximum 5 attachments allowed.', variant: 'destructive' })
        return
      }

      setIsUploading(true)
      try {
        // Step 1: get signed upload URL
        const urlRes = await fetch('/.netlify/functions/attachments?action=upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, contentType: 'application/pdf' }),
        })
        if (!urlRes.ok) throw new Error('Failed to get upload URL')
        const { signedUrl, path, fileUrl } = await urlRes.json()

        // Step 2: PUT file directly to Supabase Storage
        const putRes = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: file,
        })
        if (!putRes.ok) throw new Error('Failed to upload file')

        // Step 3: register metadata
        const name = uploadName || file.name.replace(/\.pdf$/i, '')
        const metaRes = await fetch('/.netlify/functions/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, fileName: file.name, fileUrl, filePath: path, attachMode: 'manual' }),
        })
        if (!metaRes.ok) throw new Error('Failed to save attachment metadata')

        queryClient.invalidateQueries({ queryKey: ['/attachments'] })
        setUploadName('')
        toast({ title: 'Attachment added' })
      } catch (err) {
        toast({ title: 'Upload failed', description: String(err), variant: 'destructive' })
      } finally {
        setIsUploading(false)
      }
    },
    [attachments.length, uploadName, queryClient, toast],
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Attach PDFs (warranties, agreements, service guides) to quote exports. Up to 5 slots.
        "Always" attachments auto-merge; "Manual" ones are selectable at export time.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      <div className="space-y-2">
        {attachments.map((att) => (
          <div key={att.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{att.name}</p>
              <p className="text-xs text-muted-foreground truncate">{att.fileName}</p>
            </div>
            <Switch
              checked={att.enabled}
              onCheckedChange={(v) => updateMutation.mutate({ id: att.id, updates: { enabled: v } })}
            />
            <Select
              value={att.attachMode}
              onValueChange={(v) =>
                updateMutation.mutate({ id: att.id, updates: { attachMode: v as 'always' | 'manual' } })
              }
            >
              <SelectTrigger className="h-8 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive"
              onClick={() => deleteMutation.mutate(att.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

        {attachments.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No attachments yet. Upload a PDF below.
          </p>
        )}
      </div>

      {attachments.length < 5 && (
        <div className="space-y-2 border rounded-lg p-3 bg-muted/20">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Label (optional)"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              className="h-9 text-xs flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Upload PDF
                </>
              )}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) uploadAttachment(file)
              e.target.value = ''
            }}
          />
          <p className="text-xs text-muted-foreground">
            PDF only, max 10 MB. {5 - attachments.length} slot{5 - attachments.length !== 1 ? 's' : ''} remaining.
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Service Agreement Template ───────────────────────────────────────── */
function ServiceAgreementTemplateSection({ settings }: { settings: CompanySettings | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [template, setTemplate] = useState(settings?.serviceAgreementTemplate ?? '')

  useEffect(() => {
    setTemplate(settings?.serviceAgreementTemplate ?? '')
  }, [settings?.serviceAgreementTemplate])

  const saveMutation = useMutation({
    mutationFn: () => apiRequest('PATCH', '/settings', { serviceAgreementTemplate: template }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      toast({ title: 'Template saved' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const AVAILABLE_VARS = [
    '{{customerName}}', '{{customerAddress}}', '{{customerPhone}}', '{{customerEmail}}',
    '{{businessName}}', '{{services}}', '{{pricing}}', '{{frequency}}',
    '{{date}}', '{{startDate}}', '{{companyName}}',
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Service Agreement Template
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Write your agreement text using <code className="bg-muted px-1 rounded text-xs">{'{{placeholders}}'}</code>.
          The CRM fills them in automatically when generating agreements.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABLE_VARS.map(v => (
            <code
              key={v}
              className="text-xs bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-muted/80 border"
              onClick={() => setTemplate(t => t + v)}
              title="Click to insert"
            >
              {v}
            </code>
          ))}
        </div>
        <Textarea
          value={template}
          onChange={e => setTemplate(e.target.value)}
          rows={12}
          placeholder={`This Service Agreement is entered into between {{companyName}} and {{customerName}}, effective {{date}}.\n\nSERVICES: {{services}}\nPRICING: {{pricing}}\n...`}
          className="font-mono text-xs"
        />
        <Button
          className="w-full min-h-[44px]"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Template
        </Button>
      </CardContent>
    </Card>
  )
}

/* ── Appearance Section ────────────────────────────────────────────────── */

function AppearanceSection({ settings }: { settings: CompanySettings | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const saved = (settings?.themeConfig ?? {}) as Partial<ThemeConfig>
  const [colors, setColors] = useState<Partial<ThemeConfig>>(saved)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setColors((settings?.themeConfig ?? {}) as Partial<ThemeConfig>)
  }, [settings?.themeConfig])

  function setColor(key: keyof ThemeConfig, value: string) {
    const next = { ...colors, [key]: value }
    setColors(next)
    applyTheme(next)  // live preview
  }

  function applyPreset(presetKey: string) {
    const preset = THEME_PRESETS[presetKey]
    if (!preset) return
    setColors(preset)
    applyTheme(preset)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/.netlify/functions/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeConfig: colors }),
      })
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      toast({ title: 'Appearance saved' })
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setColors({})
    clearTheme()
    await fetch('/.netlify/functions/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeConfig: {} }),
    })
    queryClient.invalidateQueries({ queryKey: ['/settings'] })
    toast({ title: 'Theme reset to default' })
  }

  const colorFields: Array<{ key: keyof ThemeConfig; label: string; description: string }> = [
    { key: 'primaryColor',      label: 'Primary Color',      description: 'Buttons, active nav, links' },
    { key: 'primaryForeground', label: 'Button Text',        description: 'Text on primary-colored backgrounds' },
    { key: 'backgroundColor',   label: 'Page Background',    description: 'Main app background' },
    { key: 'cardColor',         label: 'Card / Nav Color',   description: 'Cards, header, bottom nav' },
    { key: 'foregroundColor',   label: 'Text Color',         description: 'Main body text' },
    { key: 'borderColor',       label: 'Border Color',       description: 'Input borders, dividers' },
    { key: 'mutedColor',        label: 'Muted Background',   description: 'Chips, secondary surfaces' },
    { key: 'mutedForeground',   label: 'Muted Text',         description: 'Secondary / placeholder text' },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Appearance</CardTitle>
        <p className="text-xs text-muted-foreground">Customize colors across the entire app. Changes preview instantly.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Presets */}
        <div className="space-y-2">
          <label className="text-xs font-medium">Color Presets</label>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(THEME_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className="flex flex-col items-center gap-1.5 rounded-lg border p-2 hover:bg-muted/50 transition-colors text-center"
              >
                <div className="flex gap-1">
                  <div className="w-4 h-4 rounded-full border" style={{ background: preset.primaryColor }} />
                  <div className="w-4 h-4 rounded-full border" style={{ background: preset.backgroundColor }} />
                  <div className="w-4 h-4 rounded-full border" style={{ background: preset.cardColor }} />
                </div>
                <span className="text-[10px] leading-tight text-muted-foreground">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Individual color pickers */}
        <div className="space-y-2">
          <label className="text-xs font-medium">Custom Colors</label>
          <div className="space-y-2">
            {colorFields.map(({ key, label, description }) => (
              <div key={key} className="flex items-center gap-3">
                <input
                  type="color"
                  value={(colors[key] as string | undefined) ?? '#888888'}
                  onChange={e => setColor(key, e.target.value)}
                  className="h-9 w-9 rounded-md border cursor-pointer shrink-0"
                  title={label}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-tight">{label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {(colors[key] as string | undefined) ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1 min-h-[40px]" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button size="sm" className="flex-1 min-h-[40px]" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving…</> : <><Save className="h-4 w-4 mr-1" />Save Theme</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Nav Customization Section ─────────────────────────────────────────── */
function NavSection({ settings }: { settings: CompanySettings | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const savedItems: NavItemConfig[] = settings?.navConfig?.items ?? []
  const [items, setItems] = useState<NavItemConfig[]>(() =>
    ALL_NAV_ITEMS.map(def => {
      const saved = savedItems.find(s => s.id === def.id)
      if (saved) return { ...saved }
      const dflt = DEFAULT_NAV.find(d => d.id === def.id)
      return { id: def.id, visible: dflt?.visible ?? false }
    })
  )

  useEffect(() => {
    const saved: NavItemConfig[] = settings?.navConfig?.items ?? []
    setItems(ALL_NAV_ITEMS.map(def => {
      const s = saved.find(x => x.id === def.id)
      if (s) return { ...s }
      const d = DEFAULT_NAV.find(x => x.id === def.id)
      return { id: def.id, visible: d?.visible ?? false }
    }))
  }, [settings?.navConfig])

  function toggle(id: string) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, visible: !item.visible } : item))
  }

  function moveUp(index: number) {
    if (index === 0) return
    setItems(prev => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  function moveDown(index: number) {
    if (index === items.length - 1) return
    setItems(prev => {
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/.netlify/functions/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ navConfig: { items } }),
      })
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      toast({ title: 'Nav saved — changes apply immediately' })
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const visibleCount = items.filter(i => i.visible).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Navigation Bar</CardTitle>
        <p className="text-xs text-muted-foreground">
          Choose which pages appear in the bottom nav. Drag with ↑↓ to reorder.
          {visibleCount > 7 && <span className="text-amber-600"> Max 7 shown.</span>}
        </p>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.map((item, idx) => {
          const def = ALL_NAV_ITEMS.find(n => n.id === item.id)!
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors ${item.visible ? 'bg-muted/40' : 'opacity-50'}`}
            >
              {/* Visibility toggle */}
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${item.visible ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${item.visible ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="flex-1 text-sm font-medium">{def?.label}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{def?.path}</span>
              {/* Reorder arrows */}
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20 leading-none p-0.5">▲</button>
                <button onClick={() => moveDown(idx)} disabled={idx === items.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20 leading-none p-0.5">▼</button>
              </div>
            </div>
          )
        })}
        <div className="pt-2">
          <Button size="sm" className="w-full min-h-[40px]" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving…</> : <><Save className="h-4 w-4 mr-1" />Save Navigation</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── QuickBooks Section ────────────────────────────────────────────────── */
function QuickBooksSection({ settings }: { settings: CompanySettings | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: qbStatus, isLoading: statusLoading } = useQuery<{
    connected: boolean
    realmId: string | null
    expiresAt: string | null
    sandbox: boolean
  }>({
    queryKey: ['/qb-status'],
    queryFn: () => fetch('/.netlify/functions/qb?action=status').then(r => r.json()),
  })

  const disconnectMutation = useMutation({
    mutationFn: () => fetch('/.netlify/functions/qb?action=disconnect', { method: 'POST' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/qb-status'] })
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      toast({ title: 'QuickBooks disconnected' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const connected = qbStatus?.connected ?? settings?.qbConnected ?? false

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          QuickBooks Integration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Checking status…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {connected ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />Connected
                  {qbStatus?.sandbox && <span className="text-xs text-amber-600 ml-1">(Sandbox)</span>}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />Not connected
                </span>
              )}
            </div>

            {connected && qbStatus?.expiresAt && (
              <p className="text-xs text-muted-foreground">
                Token expires: {new Date(qbStatus.expiresAt).toLocaleString()}
              </p>
            )}

            {connected ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Invoices are auto-created in QuickBooks when customers sign quotes or service agreements.
                  For subscriptions, set up the recurring schedule manually in QuickBooks Online under Recurring Transactions.
                </p>
                <Button
                  variant="outline"
                  className="w-full min-h-[44px] text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate()}
                >
                  {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Disconnect QuickBooks
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Connect your QuickBooks Online account to auto-create invoices when customers sign. Requires <code className="bg-muted px-1 rounded text-xs">QB_CLIENT_ID</code> and <code className="bg-muted px-1 rounded text-xs">QB_CLIENT_SECRET</code> env vars to be set in Netlify.
                </p>
                <Button
                  className="w-full min-h-[44px]"
                  onClick={() => { window.location.href = '/.netlify/functions/qb?action=connect' }}
                >
                  <Link2 className="h-4 w-4 mr-2" />Connect QuickBooks
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ── SMS / Quo Section ────────────────────────────────────────────────── */
function SmsSection({ settings }: { settings: CompanySettings | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [apiKey, setApiKey] = useState(settings?.quoApiKey ?? '')
  const [fromNumber, setFromNumber] = useState(settings?.quoFromNumber ?? '')
  const [showKey, setShowKey] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    setApiKey(settings?.quoApiKey ?? '')
    setFromNumber(settings?.quoFromNumber ?? '')
  }, [settings?.quoApiKey, settings?.quoFromNumber])

  const saveMutation = useMutation({
    mutationFn: () => apiRequest('PATCH', '/settings', {
      quoApiKey: apiKey || null,
      quoFromNumber: fromNumber || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      toast({ title: 'SMS settings saved' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  async function handleTestSms() {
    if (!testPhone) return
    setTesting(true)
    try {
      const res = await fetch('/.netlify/functions/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', to: testPhone }),
      })
      const data = await res.json().catch(() => ({ message: `HTTP ${res.status}` }))
      if (!res.ok) {
        toast({ title: 'SMS test failed', description: data?.message ?? `HTTP ${res.status}`, variant: 'destructive' })
      } else {
        toast({ title: 'Test SMS sent!', description: `Check ${testPhone} for a test message.` })
      }
    } catch (err: unknown) {
      toast({ title: 'SMS test failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
    } finally {
      setTesting(false)
    }
  }

  const configured = !!(settings?.quoApiKey && settings?.quoFromNumber)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">SMS — Quo Integration</CardTitle>
          {configured
            ? <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 className="h-3.5 w-3.5" /> Configured</span>
            : <span className="flex items-center gap-1 text-xs text-muted-foreground"><AlertCircle className="h-3.5 w-3.5" /> Not configured</span>
          }
        </div>
        <p className="text-xs text-muted-foreground">
          Used to send automated quote visit confirmation texts to customers. Enter your Quo API credentials below.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Quo API Key</label>
          <div className="flex gap-2">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Your Quo API key"
              className="min-h-[40px] font-mono text-sm"
            />
            <Button variant="ghost" size="sm" onClick={() => setShowKey(s => !s)} className="shrink-0">
              {showKey ? 'Hide' : 'Show'}
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">From Phone Number</label>
          <Input
            type="tel"
            value={fromNumber}
            onChange={e => setFromNumber(e.target.value)}
            placeholder="+18655551234"
            className="min-h-[40px]"
          />
          <p className="text-[11px] text-muted-foreground">Your Quo outbound number in E.164 format (e.g. +18651234567)</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Set <code className="bg-muted px-1 rounded">QUO_BASE_URL</code> in your Netlify environment variables to your Quo API base URL (e.g. <code className="bg-muted px-1 rounded">https://api.yourdomain.com/v1</code>). The function will POST to <code className="bg-muted px-1 rounded">QUO_BASE_URL/messages</code>.
        </p>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="sm"
          className="min-h-[40px] w-full"
        >
          {saveMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : <><Save className="h-4 w-4 mr-2" />Save SMS Settings</>}
        </Button>

        {/* Test SMS */}
        {configured && (
          <div className="pt-1 border-t space-y-2">
            <label className="text-xs font-medium">Send a Test Message</label>
            <div className="flex gap-2">
              <Input
                type="tel"
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="+18651234567"
                className="min-h-[40px] flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestSms}
                disabled={testing || !testPhone}
                className="shrink-0 min-h-[40px]"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Test'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Sends a short test message to the number above. The actual error will appear here if it fails.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Google Calendar Section ──────────────────────────────────────────── */
function GoogleCalSection({ settings }: { settings: CompanySettings | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Live status from the google-cal function (more accurate than settings cache)
  const { data: gcStatus, isLoading: statusLoading } = useQuery<{
    connected: boolean
    calendarId: string | null
    expiresAt: string | null
  }>({
    queryKey: ['/google-cal-status'],
    queryFn: () => fetch('/.netlify/functions/google-cal?action=status').then(r => r.json()),
  })

  const disconnectMutation = useMutation({
    mutationFn: () =>
      fetch('/.netlify/functions/google-cal?action=disconnect', { method: 'POST' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/google-cal-status'] })
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      toast({ title: 'Google Calendar disconnected' })
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  })

  const connected = gcStatus?.connected ?? settings?.googleCalConnected ?? false

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Google Calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Checking status…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {connected ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />Connected
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />Not connected
                </span>
              )}
            </div>

            {connected && gcStatus?.calendarId && (
              <p className="text-xs text-muted-foreground">
                Syncing to: <span className="font-medium">{gcStatus.calendarId}</span>
              </p>
            )}

            {connected ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Jobs and quote visits are automatically pushed to Google Calendar when created or updated in the CRM. This is a one-way sync — changes made directly in Google Calendar are not reflected here.
                </p>
                <Button
                  variant="outline"
                  className="w-full min-h-[44px] text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate()}
                >
                  {disconnectMutation.isPending
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <RefreshCw className="h-4 w-4 mr-2" />}
                  Disconnect Google Calendar
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Connect Google Calendar to automatically push jobs and quote visits to your calendar when they're created or updated. Requires <code className="bg-muted px-1 rounded text-xs">GOOGLE_CLIENT_ID</code> and <code className="bg-muted px-1 rounded text-xs">GOOGLE_CLIENT_SECRET</code> env vars set in Netlify.
                </p>
                <Button
                  className="w-full min-h-[44px]"
                  onClick={() => { window.location.href = '/.netlify/functions/google-cal?action=connect' }}
                >
                  <Link2 className="h-4 w-4 mr-2" />Connect Google Calendar
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Main Settings Page ───────────────────────────────────────────────── */
export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: settings, isLoading } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet<CompanySettings>('/settings'),
  })

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      companyName: '',
      phone: '',
      email: '',
      address: '',
      quoteFooter: '',
    },
  })

  useEffect(() => {
    if (settings) {
      form.reset({
        companyName: settings.companyName ?? '',
        phone: settings.phone ?? '',
        email: settings.email ?? '',
        address: settings.address ?? '',
        quoteFooter: settings.quoteFooter ?? '',
      })
    }
  }, [settings, form])

  // Handle Google Calendar OAuth redirect params
  useEffect(() => {
    const hash = window.location.hash  // e.g. '#/settings?google_connected=1'
    const search = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
    const params = new URLSearchParams(search)
    if (params.get('google_connected') === '1') {
      toast({ title: 'Google Calendar connected', description: 'Jobs will now sync automatically.' })
      queryClient.invalidateQueries({ queryKey: ['/google-cal-status'] })
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      // Clean the URL
      window.history.replaceState(null, '', window.location.pathname + '#/settings')
    } else if (params.get('google_error')) {
      const errCode = params.get('google_error')
      const msg = errCode === 'denied' ? 'Authorization was cancelled.'
        : errCode === 'token'          ? 'Failed to exchange authorization code.'
        : 'An error occurred during Google authorization.'
      toast({ title: 'Google Calendar error', description: msg, variant: 'destructive' })
      window.history.replaceState(null, '', window.location.pathname + '#/settings')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateSettings = useMutation({
    mutationFn: (data: SettingsFormValues) => apiRequest('PATCH', '/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/settings'] })
      toast({ title: 'Settings saved', description: 'Company settings updated.' })
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  const handleLogoUploaded = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/settings'] })
  }, [queryClient])

  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-4 pb-2 space-y-4">
      <div>
        <h1 className="text-lg font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Company info shown on quotes and estimates.</p>
      </div>

      {/* Logo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Logo</CardTitle>
        </CardHeader>
        <CardContent>
          <LogoUpload
            currentLogoUrl={settings?.logoUrl ?? ''}
            onUploaded={handleLogoUploaded}
          />
        </CardContent>
      </Card>

      {/* Company Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Company Information</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => updateSettings.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} type="tel" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quoteFooter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quote Footer</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        placeholder="Terms, conditions, or thank-you message..."
                        className="min-h-[88px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full min-h-[44px]" disabled={updateSettings.isPending}>
                {updateSettings.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Settings
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Quote Attachments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QuoteAttachmentsSection />
        </CardContent>
      </Card>

      {/* Service Agreement Template */}
      <ServiceAgreementTemplateSection settings={settings ?? null} />

      {/* Appearance */}
      <AppearanceSection settings={settings ?? null} />

      {/* Navigation */}
      <NavSection settings={settings ?? null} />

      {/* QuickBooks */}
      <QuickBooksSection settings={settings ?? null} />

      {/* SMS / Quo */}
      <SmsSection settings={settings ?? null} />

      {/* Google Calendar */}
      <GoogleCalSection settings={settings ?? null} />
    </div>
  )
}
