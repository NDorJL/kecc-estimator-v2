import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiGet, apiPatch } from "@/lib/queryClient";
import { useQuoteContext } from "@/lib/quote-context";
import { useToast } from "@/hooks/use-toast";
import type { Quote, LineItem, CompanySettings, SubscriptionService, Contact } from "@/types";
import { MOWING_MONTHS, ALL_MONTHS, SEASONAL_CATEGORIES, computeSeasonalTotals } from "@/types";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Plus, Trash2, Eye, Download, ChevronLeft, CalendarCheck, RotateCcw, ChevronDown, ChevronRight, Paperclip, Briefcase, AlertTriangle, Send, CheckCircle2, Clock, Loader2, Pencil, X, CalendarPlus } from "lucide-react";
import { ScheduleQuoteSheet } from '@/components/ScheduleQuoteSheet'

function fmt(n: number): string {
  return "$" + n.toFixed(2);
}

const STATUS_COLORS: Record<string, string> = {
  draft: "secondary",
  sent: "default",
  accepted: "default",
  declined: "destructive",
};

function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_COLORS[status] ?? "secondary";
  const colors: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    accepted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    declined: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <Badge
      variant={variant as "default" | "secondary" | "destructive"}
      className={colors[status] ?? ""}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

interface AttachmentMeta {
  id: string;
  name: string;
  fileName: string;
  enabled: boolean;
  attachMode: "always" | "manual";
  sortOrder: number;
}

function PdfExportDialog({
  open,
  onClose,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  onExport: (selectedManualIds: string[]) => void;
}) {
  const { data: attachments = [] } = useQuery<AttachmentMeta[]>({
    queryKey: ["/attachments"],
    queryFn: () => fetch("/.netlify/functions/attachments").then(r => r.json()),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const manualAtts = attachments.filter(a => a.enabled && a.attachMode === "manual");
  const alwaysAtts = attachments.filter(a => a.enabled && a.attachMode === "always");
  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Download PDF</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {alwaysAtts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Always included</p>
              {alwaysAtts.map(a => (
                <div key={a.id} className="flex items-center gap-2 py-1">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs">{a.name}</span>
                </div>
              ))}
            </div>
          )}
          {manualAtts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Optional attachments</p>
              {manualAtts.map(a => (
                <div key={a.id} className="flex items-center gap-2 py-1">
                  <Checkbox id={`att-${a.id}`} checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                  <label htmlFor={`att-${a.id}`} className="text-xs cursor-pointer">{a.name}</label>
                </div>
              ))}
            </div>
          )}
          {alwaysAtts.length === 0 && manualAtts.length === 0 && (
            <p className="text-xs text-muted-foreground">No attachments configured. Download quote PDF only.</p>
          )}
        </div>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => { onExport(Array.from(selected)); onClose(); }}>
            <Download className="h-4 w-4 mr-1" />Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuoteCreateForm({ onDone }: { onDone: () => void }) {
  const { cartItems, clearCart } = useQuoteContext();
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [quoteType, setQuoteType] = useState("residential_onetime");
  const [notes, setNotes] = useState("");

  // Contact picker state
  const [contactSearch, setContactSearch] = useState("");
  const [showContactDrop, setShowContactDrop] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const contactDropRef = useRef<HTMLDivElement>(null);

  const { data: allContacts = [] } = useQuery<Contact[]>({
    queryKey: ['/contacts'],
    queryFn: () => apiGet('/contacts'),
    staleTime: 60_000,
  });

  const filteredContacts = contactSearch.length >= 1
    ? allContacts.filter(c =>
        c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
        (c.phone ?? '').includes(contactSearch)
      ).slice(0, 8)
    : [];

  function selectContact(contact: Contact) {
    setSelectedContact(contact);
    setCustomerName(contact.name);
    setCustomerPhone(contact.phone ?? '');
    setCustomerEmail(contact.email ?? '');
    setBusinessName(contact.businessName ?? '');
    setContactSearch('');
    setShowContactDrop(false);
  }

  function clearContact() {
    setSelectedContact(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
    setBusinessName('');
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (contactDropRef.current && !contactDropRef.current.contains(e.target as Node)) {
        setShowContactDrop(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const onetimeItems = cartItems.filter(i => !i.isSubscription);
  const subItems = cartItems.filter(i => i.isSubscription);
  const onetimeTotal = onetimeItems.reduce((s, i) => s + i.lineTotal, 0);
  const monthlySubtotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal), 0);
  const total = onetimeTotal + monthlySubtotal;

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/quotes", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/leads"] });
      clearCart();
      toast({ title: "Quote created", description: "Quote saved successfully." });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || cartItems.length === 0) return;
    createMutation.mutate({
      customerName: customerName.trim(),
      customerAddress: customerAddress.trim() || null,
      customerPhone: customerPhone.trim() || null,
      customerEmail: customerEmail.trim() || null,
      businessName: businessName.trim() || null,
      quoteType,
      lineItems: cartItems,
      subtotal: total,
      total,
      notes: notes.trim() || null,
      contactId: selectedContact?.id ?? null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* ── Contact picker ── */}
      <div className="space-y-1.5" ref={contactDropRef}>
        <Label className="text-xs">Link to Existing Contact (optional)</Label>
        {selectedContact ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{selectedContact.name}</p>
              {selectedContact.phone && <p className="text-xs text-muted-foreground">{selectedContact.phone}</p>}
            </div>
            <button type="button" onClick={clearContact} className="shrink-0 rounded p-1 hover:bg-muted">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Input
              placeholder="Search contacts by name or phone…"
              value={contactSearch}
              onChange={e => { setContactSearch(e.target.value); setShowContactDrop(true); }}
              onFocus={() => setShowContactDrop(true)}
              className="min-h-[44px]"
            />
            {showContactDrop && filteredContacts.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border bg-popover shadow-lg overflow-hidden">
                {filteredContacts.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-muted transition-colors"
                    onMouseDown={() => selectContact(c)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="customerName">Customer Name *</Label>
        <Input id="customerName" value={customerName} onChange={e => setCustomerName(e.target.value)} required className="min-h-[44px]" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="customerAddress">Address</Label>
        <Input id="customerAddress" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} className="min-h-[44px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="customerPhone">Phone</Label>
          <Input id="customerPhone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="min-h-[44px]" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customerEmail">Email</Label>
          <Input id="customerEmail" type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="min-h-[44px]" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="businessName">Business Name (optional)</Label>
        <Input id="businessName" value={businessName} onChange={e => setBusinessName(e.target.value)} className="min-h-[44px]" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="quoteType">Quote Type</Label>
        <Select value={quoteType} onValueChange={setQuoteType}>
          <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="residential_onetime">Residential One-Time</SelectItem>
            <SelectItem value="commercial_onetime">Commercial One-Time</SelectItem>
            <SelectItem value="residential_tcep">Residential TCEP/TCP</SelectItem>
            <SelectItem value="commercial_tcep">Commercial TCEP/TCP</SelectItem>
            <SelectItem value="residential_autopilot">Residential Autopilot</SelectItem>
            <SelectItem value="commercial_autopilot">Commercial Autopilot</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="min-h-[44px]" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Line Items ({cartItems.length})</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {cartItems.map((item, idx) => (
            <div key={idx} className="flex justify-between text-xs">
              <span className="truncate flex-1 mr-2">{item.serviceName}{item.description ? ` — ${item.description}` : ""}</span>
              <span className="shrink-0 font-medium">{fmt(item.lineTotal)}{item.isSubscription ? "/mo" : ""}</span>
            </div>
          ))}
          <div className="border-t pt-2 mt-2 flex justify-between text-sm font-semibold">
            <span>Total</span><span>{fmt(total)}{subItems.length > 0 ? "/mo" : ""}</span>
          </div>
        </CardContent>
      </Card>
      <Button type="submit" className="w-full min-h-[44px]" disabled={!customerName.trim() || cartItems.length === 0 || createMutation.isPending}>
        {createMutation.isPending ? "Saving..." : "Save Quote"}
      </Button>
    </form>
  );
}

interface EditLineItem extends LineItem { _key: string }

export function QuoteDetail({ quote, onBack, onUpdate }: { quote: Quote; onBack: () => void; onUpdate: (q: Quote) => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  // ── Edit mode state ──────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBusiness, setEditBusiness] = useState('');
  const [editQuoteType, setEditQuoteType] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCreatedAt, setEditCreatedAt] = useState('');
  const [editItems, setEditItems] = useState<EditLineItem[]>([]);

  const startEdit = () => {
    setEditName(quote.customerName);
    setEditAddress(quote.customerAddress ?? '');
    setEditPhone(quote.customerPhone ?? '');
    setEditEmail(quote.customerEmail ?? '');
    setEditBusiness(quote.businessName ?? '');
    setEditQuoteType(quote.quoteType);
    setEditNotes(quote.notes ?? '');
    setEditCreatedAt(quote.createdAt.slice(0, 10)); // YYYY-MM-DD
    setEditItems(
      (Array.isArray(quote.lineItems) ? quote.lineItems : []).map((item, i) => ({
        ...item,
        _key: `existing-${i}-${item.serviceId ?? i}`,
      }))
    );
    setIsEditing(true);
  };

  const cancelEdit = () => setIsEditing(false);

  const updateItem = (key: string, field: 'unitPrice' | 'quantity' | 'serviceName' | 'description', raw: string) => {
    setEditItems(prev => prev.map(it => {
      if (it._key !== key) return it;
      if (field === 'unitPrice') {
        const price = parseFloat(raw) || 0;
        const lineTotal = price * it.quantity;
        return { ...it, unitPrice: price, lineTotal };
      }
      if (field === 'quantity') {
        const qty = parseFloat(raw) || 0;
        const lineTotal = it.unitPrice * qty;
        return { ...it, quantity: qty, lineTotal };
      }
      return { ...it, [field]: raw };
    }));
  };

  const removeItem = (key: string) => setEditItems(prev => prev.filter(it => it._key !== key));

  const addItem = () => {
    const key = `new-${Date.now()}`;
    setEditItems(prev => [...prev, {
      _key: key,
      serviceId: '',
      serviceName: 'Custom Item',
      description: '',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      isSubscription: false,
      category: '',
    }]);
  };

  const saveEditMutation = useMutation({
    mutationFn: async () => {
      const items = editItems.map(({ _key: _k, ...rest }) => rest);
      const onetimeTotal = items.filter(i => !i.isSubscription).reduce((s, i) => s + (Number(i.lineTotal) || 0), 0);
      const monthlyTotal = items.filter(i => i.isSubscription).reduce((s, i) => s + (Number(i.monthlyAmount ?? i.lineTotal) || 0), 0);
      const total = onetimeTotal + monthlyTotal;
      // Guard against null/undefined createdAt before slicing
      const originalDate = quote.createdAt ? quote.createdAt.slice(0, 10) : '';
      const payload: Record<string, unknown> = {
        customerName: editName.trim(),
        customerAddress: editAddress.trim() || null,
        customerPhone: editPhone.trim() || null,
        customerEmail: editEmail.trim() || null,
        businessName: editBusiness.trim() || null,
        quoteType: editQuoteType || 'residential_onetime',
        lineItems: items,
        subtotal: total,
        total,
        notes: editNotes.trim() || null,
      };
      // Only include createdAt if the user actually changed the date
      if (editCreatedAt && originalDate && editCreatedAt !== originalDate) {
        payload.createdAt = new Date(editCreatedAt + 'T12:00:00').toISOString();
      }
      return apiPatch<Quote>(`/quotes/${quote.id}`, payload);
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['/quotes'] });
      queryClient.invalidateQueries({ queryKey: ['/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/contacts'] });
      onUpdate(updated);
      setIsEditing(false);
      toast({ title: 'Quote updated' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const copyEsignLink = async () => {
    if (!quote.acceptToken) {
      toast({ title: 'No link available', description: 'This quote has no signing link. Try re-saving it.', variant: 'destructive' });
      return;
    }
    const url = `${window.location.origin}/.netlify/functions/esign?token=${quote.acceptToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Quote link copied!', description: 'Paste it into a text message or email and send to your customer. They\'ll see the full quote and can sign right there.' });
    } catch {
      // Clipboard blocked — show the URL so they can copy manually
      toast({ title: 'Copy this link and send to your customer', description: url });
    }
  };

  const createSubscriptionFromQuote = async () => {
    const lineItems: LineItem[] = Array.isArray(quote.lineItems) ? quote.lineItems : [];
    const subServices: SubscriptionService[] = lineItems
      .filter(i => i.isSubscription)
      .map(i => {
        const isSeasonal = SEASONAL_CATEGORIES.includes(i.category);
        return {
          id: i.serviceId + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          serviceName: i.serviceName,
          category: i.category,
          description: i.description,
          pricePerMonth: i.monthlyAmount ?? i.lineTotal,
          frequency: i.frequency ?? "Monthly",
          seasonal: isSeasonal,
          activeMonths: isSeasonal ? [...MOWING_MONTHS] : [...ALL_MONTHS],
        };
      });
    if (subServices.length === 0) return null;
    const totals = computeSeasonalTotals(subServices);
    const res = await apiRequest("POST", "/subscriptions", {
      customerName: quote.customerName,
      customerAddress: quote.customerAddress,
      customerPhone: quote.customerPhone,
      customerEmail: quote.customerEmail,
      businessName: quote.businessName,
      status: "ACTIVE",
      startDate: new Date().toISOString().slice(0, 10),
      services: subServices,
      inSeasonMonthlyTotal: totals.inSeason,
      offSeasonMonthlyTotal: totals.offSeason,
      changeHistory: [{ timestamp: new Date().toISOString(), changedBy: "Owner", summary: "Subscription created from quote " + quote.id.slice(0, 8).toUpperCase() }],
    });
    return res.json();
  };

  const activateSubMutation = useMutation({
    mutationFn: createSubscriptionFromQuote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/subscriptions"] });
      toast({ title: "Subscription activated" });
      setLocation("/subscriptions");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const convertToJobMutation = useMutation({
    mutationFn: async () => {
      const items: LineItem[] = Array.isArray(quote.lineItems) ? quote.lineItems : [];
      const onetimeItems = items.filter(i => !i.isSubscription);
      if (onetimeItems.length === 0) throw new Error("No one-time services found on this quote.");
      const serviceName = onetimeItems.length === 1
        ? onetimeItems[0].serviceName
        : onetimeItems.map(i => i.serviceName).join(", ");
      const res = await apiRequest("POST", "/jobs", {
        quoteId: quote.id,
        contactId: quote.contactId ?? null,
        jobType: "one_time",
        serviceName,
        status: "scheduled",
        customerName: quote.customerName,
        customerAddress: quote.customerAddress ?? null,
        customerPhone: quote.customerPhone ?? null,
        customerEmail: quote.customerEmail ?? null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/jobs"] });
      toast({ title: "Job created", description: "Find it in the Jobs tab to set a date and contractor." });
      setLocation("/jobs");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ["/settings"],
    queryFn: () => fetch("/.netlify/functions/settings").then(r => r.json()),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/quotes/${quote.id}`, { status });
      if (status === "accepted" && quote.status !== "accepted") {
        try { await createSubscriptionFromQuote(); } catch { /* best effort */ }
      }
      return res.json();
    },
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/subscriptions"] });
      if (status === "accepted") toast({ title: "Quote accepted", description: "Subscription auto-created in the Subs tab." });
      else toast({ title: "Status updated" });
    },
  });

  const trashMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/quotes/${quote.id}/trash`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/quotes"] });
      toast({ title: "Moved to trash" });
      onBack();
    },
  });

  const lineItems: LineItem[] = Array.isArray(quote.lineItems) ? quote.lineItems : [];
  const onetimeItems = lineItems.filter(i => !i.isSubscription);
  const subItems = lineItems.filter(i => i.isSubscription);
  const onetimeSubtotal = onetimeItems.reduce((s, i) => s + i.lineTotal, 0);
  const monthlySubtotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal), 0);
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  const handleDownloadPdf = async (selectedManualIds: string[]) => {
    const params = new URLSearchParams({ quoteId: quote.id });
    if (selectedManualIds.length > 0) params.set("attachments", selectedManualIds.join(","));
    const functionPath = `/.netlify/functions/pdf-quote?${params.toString()}`;
    const filename = `KECC-Estimate-${quote.customerName.replace(/\s+/g, "-")}-${quote.id.slice(0, 8).toUpperCase()}.pdf`;

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isIOS) {
      // navigator.share() MUST be called synchronously from the user gesture — any await
      // before it (e.g. fetching a blob) invalidates the gesture token on iOS and causes
      // a silent failure that falls through to blob navigation, which soft-locks the webview.
      // Fix: share the URL directly (no fetch). User taps "Open in Safari" from the Share
      // sheet → Safari downloads the PDF via Content-Disposition: attachment with its full UI.
      if (navigator.share) {
        try {
          await navigator.share({
            url: `${window.location.origin}${functionPath}`,
            title: filename,
          });
        } catch (err) {
          if (err instanceof Error && err.name !== "AbortError") {
            toast({ title: "Share failed", description: String(err), variant: "destructive" });
          }
        }
      } else {
        // Very old iOS without Share API — copy the link so they can open it in Safari manually
        try { await navigator.clipboard.writeText(`${window.location.origin}${functionPath}`); } catch { /* ignore */ }
        toast({ title: "Link copied", description: "Paste it in Safari to download the PDF." });
      }
      return;
    }

    // Android / desktop: fetch → blob → <a download>
    setIsPdfLoading(true);
    try {
      const res = await fetch(functionPath);
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      toast({ title: "PDF export failed", description: String(err), variant: "destructive" });
    } finally {
      setIsPdfLoading(false);
    }
  };

  const qt = quote.quoteType ?? "";
  let planBadgeLabel = "";
  if (qt.includes("autopilot")) planBadgeLabel = "One-Service Autopilot Plan";
  else if (qt.startsWith("residential") && qt.includes("tcep")) planBadgeLabel = "TCEP Residential";
  else if (qt.startsWith("commercial") && qt.includes("tcep")) planBadgeLabel = "TPC Commercial";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={isEditing ? cancelEdit : onBack} className="min-h-[44px]">
          <ChevronLeft className="h-4 w-4 mr-1" />{isEditing ? 'Cancel' : 'Back'}
        </Button>
        <div className="flex gap-2 flex-wrap">
          {isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={cancelEdit} className="min-h-[44px]">
                <X className="h-4 w-4 mr-1" />Discard
              </Button>
              <Button size="sm" onClick={() => saveEditMutation.mutate()} disabled={saveEditMutation.isPending || !editName.trim()} className="min-h-[44px]">
                {saveEditMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving…</> : 'Save Changes'}
              </Button>
            </>
          ) : (
            <>
              {/* ── Primary: Send Quote link ── */}
              {quote.status !== "accepted" && quote.status !== "declined" ? (
                <Button size="sm" onClick={copyEsignLink} className="min-h-[44px] bg-green-700 hover:bg-green-800 text-white">
                  <Send className="h-4 w-4 mr-1.5" />Send Quote
                </Button>
              ) : quote.signedAt ? (
                <span className="flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400 px-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Signed {new Date(quote.signedAt).toLocaleDateString()}
                </span>
              ) : null}

              {/* ── Post-acceptance actions ── */}
              {quote.status === "accepted" && (
                <Button variant="default" size="sm" onClick={() => activateSubMutation.mutate()} disabled={activateSubMutation.isPending} className="min-h-[44px] bg-green-700 hover:bg-green-800">
                  <CalendarCheck className="h-4 w-4 mr-1" />
                  {activateSubMutation.isPending ? "Activating..." : "Activate Sub"}
                </Button>
              )}
              {/* Schedule Job — only appears after e-sign */}
              {quote.signedAt && (
                <Button variant="default" size="sm" className="min-h-[44px] bg-primary" onClick={() => setShowSchedule(true)}>
                  <CalendarPlus className="h-4 w-4 mr-1" />Schedule Job
                </Button>
              )}

              {/* ── Secondary: Edit, status, PDF (small), trash ── */}
              <Button variant="outline" size="sm" onClick={startEdit} className="min-h-[44px]">
                <Pencil className="h-4 w-4 mr-1" />Edit
              </Button>
              <Select value={quote.status} onValueChange={val => updateStatusMutation.mutate(val)}>
                <SelectTrigger className="min-h-[44px] w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px] text-muted-foreground" onClick={() => setShowExportDialog(true)} disabled={isPdfLoading} title="Download PDF">
                {isPdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" className="min-h-[44px] min-w-[44px] text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => trashMutation.mutate()}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <PdfExportDialog open={showExportDialog} onClose={() => setShowExportDialog(false)} onExport={handleDownloadPdf} />

      {/* Edit mode: quote type selector above the card */}
      {isEditing && (
        <div className="flex items-center gap-3 px-1">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Quote Type</Label>
          <Select value={editQuoteType} onValueChange={setEditQuoteType}>
            <SelectTrigger className="min-h-[36px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="residential_onetime">Residential One-Time</SelectItem>
              <SelectItem value="commercial_onetime">Commercial One-Time</SelectItem>
              <SelectItem value="residential_tcep">Residential TCEP/TCP</SelectItem>
              <SelectItem value="commercial_tcep">Commercial TCEP/TCP</SelectItem>
              <SelectItem value="residential_autopilot">Residential Autopilot</SelectItem>
              <SelectItem value="commercial_autopilot">Commercial Autopilot</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="bg-white text-black p-6 rounded-lg border dark:bg-white dark:text-black">
        {isEditing && (
          <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700 flex items-center gap-1.5">
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            Editing quote — changes save when you tap <strong>Save Changes</strong> above.
          </div>
        )}

        {/* ── E-sign status banner ─────────────────────────────────────── */}
        {!isEditing && quote.signedAt ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-300 px-4 py-3 flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Signed</p>
              <p className="text-xs text-green-700">
                {quote.customerName} signed on{' '}
                {new Date(quote.signedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}{' '}
                at {new Date(quote.signedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ) : !isEditing && quote.status === 'sent' ? (
          <div className="mb-4 rounded-md bg-amber-50 border border-amber-300 px-4 py-3 flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Awaiting Signature</p>
              <p className="text-xs text-amber-700">
                This quote has been sent but has not been signed yet.
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">{settings?.companyName ?? "Knox Exterior Care Co."}</h2>
            {settings?.address && <p className="text-sm text-gray-600">{settings.address}</p>}
            {settings?.phone && <p className="text-sm text-gray-600">{settings.phone}</p>}
            {settings?.email && <p className="text-sm text-gray-600">{settings.email}</p>}
          </div>
          <div className="text-right">
            {settings?.logoUrl
              ? <img src={settings.logoUrl} alt="Logo" className="h-24 max-w-[240px] object-contain" />
              : <div className="h-24 w-40 border-2 border-dashed border-gray-300 flex items-center justify-center text-sm text-gray-400">LOGO</div>
            }
          </div>
        </div>
        <hr className="mb-4" />
        {planBadgeLabel && !isEditing && (
          <div className="mb-3">
            <Badge variant="outline" className="text-xs text-green-700 border-green-300">{planBadgeLabel}</Badge>
          </div>
        )}
        <div className="flex justify-between mb-4 gap-4">
          <div className="flex-1">
            <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Estimate For</p>
            {isEditing ? (
              <div className="space-y-1.5">
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-semibold bg-white text-black"
                  placeholder="Customer name *"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white text-black"
                  placeholder="Business name (optional)"
                  value={editBusiness}
                  onChange={e => setEditBusiness(e.target.value)}
                />
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white text-black"
                  placeholder="Address"
                  value={editAddress}
                  onChange={e => setEditAddress(e.target.value)}
                />
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white text-black"
                  placeholder="Phone"
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                />
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white text-black"
                  placeholder="Email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                />
              </div>
            ) : (
              <>
                <p className="font-semibold">{quote.customerName}</p>
                {quote.businessName && <p className="text-sm text-gray-600">{quote.businessName}</p>}
                {quote.customerAddress && <p className="text-sm text-gray-600">{quote.customerAddress}</p>}
                {quote.customerPhone && <p className="text-sm text-gray-600">{quote.customerPhone}</p>}
                {quote.customerEmail && <p className="text-sm text-gray-600">{quote.customerEmail}</p>}
              </>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-500 uppercase font-semibold">Estimate #</p>
            <p className="font-mono text-sm">{quote.id.slice(0, 8).toUpperCase()}</p>
            <p className="text-xs text-gray-500 mt-1">{new Date(quote.createdAt).toLocaleDateString()}</p>
            <StatusBadge status={quote.status} />
          </div>
        </div>

        {/* Line items — editable when isEditing */}
        {isEditing ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase font-semibold">Line Items</p>
            {editItems.map(item => (
              <div key={item._key} className="grid grid-cols-[1fr_60px_80px_80px_32px] gap-1.5 items-center border-b pb-2">
                <div>
                  <input
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-medium bg-white text-black"
                    value={item.serviceName}
                    onChange={e => updateItem(item._key, 'serviceName', e.target.value)}
                    placeholder="Service name"
                  />
                  <input
                    className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs text-gray-500 bg-white mt-0.5"
                    value={item.description ?? ''}
                    onChange={e => updateItem(item._key, 'description', e.target.value)}
                    placeholder="Description (optional)"
                  />
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="border border-gray-300 rounded px-2 py-1 text-xs text-right bg-white text-black w-full"
                  value={item.quantity}
                  onChange={e => updateItem(item._key, 'quantity', e.target.value)}
                  title="Quantity"
                />
                <div className="flex items-center">
                  <span className="text-xs text-gray-400 mr-0.5">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="border border-gray-300 rounded px-1 py-1 text-xs text-right bg-white text-black w-full"
                    value={item.unitPrice}
                    onChange={e => updateItem(item._key, 'unitPrice', e.target.value)}
                    title="Unit price"
                  />
                </div>
                <div className="text-xs font-semibold text-right text-gray-700">
                  {fmt(item.lineTotal)}{item.isSubscription ? '/mo' : ''}
                </div>
                <button
                  onClick={() => removeItem(item._key)}
                  className="p-1 text-red-400 hover:text-red-600 rounded"
                  title="Remove line"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={addItem}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add line item
            </button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-black">Service</TableHead>
                <TableHead className="text-black">Description</TableHead>
                <TableHead className="text-right text-black">Qty</TableHead>
                <TableHead className="text-right text-black">Unit Price</TableHead>
                <TableHead className="text-right text-black">Frequency</TableHead>
                <TableHead className="text-right text-black">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium">{item.serviceName}</TableCell>
                  <TableCell className="text-sm text-gray-600">{item.description ?? ""}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{fmt(item.unitPrice)}</TableCell>
                  <TableCell className="text-right">{item.frequency ?? "One-Time"}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(item.lineTotal)}{item.isSubscription ? "/mo" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Totals */}
        {(() => {
          const displayItems = isEditing ? editItems : lineItems;
          const dispOnetime = displayItems.filter(i => !i.isSubscription).reduce((s, i) => s + i.lineTotal, 0);
          const dispMonthly = displayItems.filter(i => i.isSubscription).reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal), 0);
          const dispTotal = dispOnetime + dispMonthly;
          return (
            <div className="mt-4 space-y-1 text-right">
              {dispOnetime > 0 && (
                <div className="flex justify-end gap-4">
                  <span className="text-sm text-gray-600">One-Time Subtotal:</span>
                  <span className="font-semibold w-24">{fmt(dispOnetime)}</span>
                </div>
              )}
              {dispMonthly > 0 && (
                <div className="flex justify-end gap-4">
                  <span className="text-sm text-gray-600">Monthly Subscription:</span>
                  <span className="font-semibold w-24">{fmt(dispMonthly)}/mo</span>
                </div>
              )}
              <div className="flex justify-end gap-4 border-t pt-2 mt-2">
                <span className="font-semibold">Total:</span>
                <span className="text-lg font-bold w-24">{fmt(dispTotal)}</span>
              </div>
            </div>
          );
        })()}

        {/* Notes */}
        {isEditing ? (
          <>
            <div className="mt-6">
              <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Notes</p>
              <textarea
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white text-black resize-none"
                rows={3}
                placeholder="Add notes…"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
              />
            </div>
            <div className="mt-4">
              <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Quote Date</p>
              <p className="text-xs text-gray-400 mb-1">Change to backdate this quote for historical records</p>
              <input
                type="date"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white text-black"
                value={editCreatedAt}
                onChange={e => setEditCreatedAt(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </>
        ) : quote.notes ? (
          <div className="mt-6">
            <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
          </div>
        ) : null}
        {quote.signedAt ? (
          <div className="mt-8 pt-4 border-t border-gray-200">
            <div className="flex items-start gap-3 rounded-lg bg-green-50 border border-green-200 p-4">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-green-800">E-Signed by {quote.customerName}</p>
                <p className="text-xs text-green-700">
                  Signed on {new Date(quote.signedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at {new Date(quote.signedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </p>
                {quote.signedIp && (
                  <p className="text-xs text-green-600/70">IP address: {quote.signedIp}</p>
                )}
                <p className="text-xs text-green-600/70">Digital signature on file · Legally binding electronic acceptance</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-8 pt-4">
            <div className="flex justify-between items-end gap-8">
              <div className="flex-1"><div className="border-b border-gray-400 mb-1" /><p className="text-xs text-gray-500">Customer Signature</p></div>
              <div className="flex-1"><div className="border-b border-gray-400 mb-1" /><p className="text-xs text-gray-500">Date</p></div>
            </div>
          </div>
        )}
        {settings?.quoteFooter && (
          <div className="mt-6 pt-4 border-t">
            <p className="text-xs text-gray-500 text-center">{settings.quoteFooter}</p>
          </div>
        )}
      </div>

      {/* Schedule Job sheet — triggered from detail action bar */}
      <ScheduleQuoteSheet
        quote={quote}
        open={showSchedule}
        onClose={() => setShowSchedule(false)}
      />
    </div>
  );
}

function QuotesList({ onViewQuote }: { onViewQuote: (quote: Quote) => void }) {
  const { toast } = useToast();
  const { cartItems, setIsCreatingQuote } = useQuoteContext();
  const [trashOpen, setTrashOpen] = useState(false);
  const [scheduleQuote, setScheduleQuote] = useState<Quote | null>(null);

  const { data: allQuotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ["/quotes"],
    queryFn: () => fetch("/.netlify/functions/quotes").then(r => r.json()),
  });

  const { data: trashedQuotes = [] } = useQuery<Quote[]>({
    queryKey: ["/quotes?trashed=true"],
    queryFn: () => fetch("/.netlify/functions/quotes?trashed=true").then(r => r.json()),
  });

  const activeQuotes = allQuotes.filter(q => !q.trashedAt);

  const trashMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/quotes/${id}/trash`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/quotes"] }); queryClient.invalidateQueries({ queryKey: ["/leads"] }); toast({ title: "Moved to trash" }); },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/quotes/${id}/restore`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/quotes"] }); queryClient.invalidateQueries({ queryKey: ["/quotes?trashed=true"] }); toast({ title: "Quote restored" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/quotes/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/quotes?trashed=true"] }); queryClient.invalidateQueries({ queryKey: ["/quotes"] }); queryClient.invalidateQueries({ queryKey: ["/leads"] }); toast({ title: "Quote permanently deleted" }); },
  });

  const emptyTrashMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", "/quotes/trash/empty"); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/quotes?trashed=true"] }); toast({ title: "Trash emptied" }); },
  });

  const QuoteCard = ({ quote, trashed = false }: { quote: Quote; trashed?: boolean }) => {
    const date = new Date(quote.createdAt);
    const typeLabel = quote.quoteType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const isExpired = quote.expiresAt && new Date(quote.expiresAt) < new Date() && quote.status !== 'accepted';
    return (
      <Card className={trashed ? "opacity-60" : "cursor-pointer"}>
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0" onClick={!trashed ? () => onViewQuote(quote) : undefined}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold truncate">{quote.customerName}</span>
                {!trashed && <StatusBadge status={quote.status} />}
                {trashed && <Badge variant="destructive" className="text-[10px]">Trash</Badge>}
                {isExpired && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-400 flex items-center gap-0.5">
                    <AlertTriangle className="h-2.5 w-2.5" />Expired
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                <span>{date.toLocaleDateString()}</span>
                <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
                <span className="font-medium text-foreground">{fmt(quote.total)}</span>
                {quote.expiresAt && !isExpired && (
                  <span className="text-amber-600">Expires {new Date(quote.expiresAt).toLocaleDateString()}</span>
                )}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {!trashed && (
                <>
                  {quote.signedAt && (
                    <Button
                      variant="ghost" size="icon" className="h-9 w-9 text-primary"
                      title="Schedule job"
                      onClick={e => { e.stopPropagation(); setScheduleQuote(quote); }}
                    >
                      <CalendarPlus className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onViewQuote(quote)}><Eye className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={e => { e.stopPropagation(); trashMutation.mutate(quote.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </>
              )}
              {trashed && (
                <>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-green-700" onClick={() => restoreMutation.mutate(quote.id)} title="Restore"><RotateCcw className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => deleteMutation.mutate(quote.id)} title="Delete permanently"><Trash2 className="h-3.5 w-3.5" /></Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Saved Quotes</h2>
        {cartItems.length > 0 && (
          <Button size="sm" onClick={() => setIsCreatingQuote(true)} className="min-h-[44px]">
            <Plus className="h-4 w-4 mr-1" />New Quote ({cartItems.length} items)
          </Button>
        )}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>}
      {!isLoading && activeQuotes.length === 0 && (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No quotes yet. Add items to the cart on the Calculator tab, then create a quote.</CardContent></Card>
      )}
      {activeQuotes.map(quote => <QuoteCard key={quote.id} quote={quote} />)}
      {trashedQuotes.length > 0 && (
        <Collapsible open={trashOpen} onOpenChange={setTrashOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full flex items-center justify-between text-muted-foreground h-9 px-2">
              <div className="flex items-center gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="text-xs">Trash ({trashedQuotes.length})</span>
              </div>
              {trashOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 mt-1">
            <div className="flex justify-end">
              <Button variant="destructive" size="sm" className="text-xs h-8" onClick={() => emptyTrashMutation.mutate()} disabled={emptyTrashMutation.isPending}>Empty Trash</Button>
            </div>
            {trashedQuotes.map(quote => <QuoteCard key={quote.id} quote={quote} trashed />)}
          </CollapsibleContent>
        </Collapsible>
      )}

      {scheduleQuote && (
        <ScheduleQuoteSheet
          quote={scheduleQuote}
          open={!!scheduleQuote}
          onClose={() => setScheduleQuote(null)}
        />
      )}
    </div>
  );
}

export default function Quotes() {
  const { isCreatingQuote, setIsCreatingQuote } = useQuoteContext();
  const [viewingQuote, setViewingQuote] = useState<Quote | null>(null);

  // If we arrived from a lead card's "Edit Quote" button, auto-open that quote.
  // URL looks like /#/quotes?quote=<id>  (wouter hash routing).
  const { data: allQuotes } = useQuery<Quote[]>({
    queryKey: ['/quotes'],
    queryFn: () => apiGet<Quote[]>('/quotes'),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (viewingQuote || !allQuotes) return;
    const hash = window.location.hash;
    const qStart = hash.indexOf('?');
    if (qStart < 0) return;
    const params = new URLSearchParams(hash.slice(qStart + 1));
    const quoteId = params.get('quote');
    if (!quoteId) return;
    const found = allQuotes.find(q => q.id === quoteId);
    if (found) setViewingQuote(found);
  }, [allQuotes, viewingQuote]);

  if (viewingQuote) {
    return (
      <div className="p-4">
        <QuoteDetail
          quote={viewingQuote}
          onBack={() => setViewingQuote(null)}
          onUpdate={(updated) => setViewingQuote(updated)}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {isCreatingQuote ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Create Quote</h2>
            <Button variant="ghost" size="sm" onClick={() => setIsCreatingQuote(false)} className="min-h-[44px]">Cancel</Button>
          </div>
          <QuoteCreateForm onDone={() => setIsCreatingQuote(false)} />
        </>
      ) : (
        <QuotesList onViewQuote={setViewingQuote} />
      )}
    </div>
  );
}
