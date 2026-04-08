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
import { Save, Loader2, Upload, X, ImageIcon, Paperclip, FileText, Trash2, Plus } from 'lucide-react'

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
    </div>
  )
}
