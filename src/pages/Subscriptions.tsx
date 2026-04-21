import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useServices } from "@/lib/services-context";
import type { Subscription, SubscriptionService, ChangeHistoryEntry, ServiceAgreement } from "@/types";
import { MOWING_MONTHS, ALL_MONTHS, SEASONAL_CATEGORIES, computeSeasonalTotals } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, Download, Plus, Trash2, Pause, Play, XCircle, History, Archive, RotateCcw, ChevronDown, ChevronRight, FileSignature, Copy, CheckCircle2, Send } from "lucide-react";

const fmt = (n: number) => "$" + n.toFixed(2);
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  PAUSED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  CANCELED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  ARCHIVED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function SubCard({ sub, onView }: { sub: Subscription; onView: (sub: Subscription) => void }) {
  return (
    <Card className="cursor-pointer" onClick={() => onView(sub)}>
      <CardContent className="py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate">{sub.customerName}</span>
              <Badge className={STATUS_STYLES[sub.status] ?? ""}>{sub.status}</Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              <span>Started {new Date(sub.startDate).toLocaleDateString()}</span>
              <span className="font-medium text-green-700 dark:text-green-400">In: {fmt(sub.inSeasonMonthlyTotal)}/mo</span>
              <span className="font-medium text-muted-foreground">Off: {fmt(sub.offSeasonMonthlyTotal)}/mo</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SubscriptionsList({ onView }: { onView: (sub: Subscription) => void }) {
  const { data: subs = [], isLoading } = useQuery<Subscription[]>({
    queryKey: ["/subscriptions"],
    queryFn: () => fetch("/.netlify/functions/subscriptions").then(r => r.json()),
  });
  const [showArchived, setShowArchived] = useState(false);
  const activeSubs = subs.filter(s => s.status === "ACTIVE" || s.status === "PAUSED");
  const archivedSubs = subs.filter(s => s.status === "CANCELED" || s.status === "ARCHIVED");

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Active Subscriptions</h2>
      {isLoading && <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>}
      {!isLoading && activeSubs.length === 0 && (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No active subscriptions. Set a quote to "Accepted" to create one.</CardContent></Card>
      )}
      {activeSubs.map(sub => <SubCard key={sub.id} sub={sub} onView={onView} />)}
      {archivedSubs.length > 0 && (
        <div className="pt-2">
          <button type="button" onClick={() => setShowArchived(!showArchived)} className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors w-full">
            {showArchived ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Archive className="h-4 w-4" />Archived ({archivedSubs.length})
          </button>
          {showArchived && <div className="space-y-3 mt-3 opacity-75">{archivedSubs.map(sub => <SubCard key={sub.id} sub={sub} onView={onView} />)}</div>}
        </div>
      )}
    </div>
  );
}

function AddServiceDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (svc: SubscriptionService) => void }) {
  const { services: allServices } = useServices();
  const [selectedId, setSelectedId] = useState("");
  const [price, setPrice] = useState("");
  const [freq, setFreq] = useState("Monthly");
  const selected = allServices.find(s => s.id === selectedId);
  const handleAdd = () => {
    if (!selected || !price) return;
    const isSeasonal = SEASONAL_CATEGORIES.includes(selected.category);
    onAdd({ id: selected.id + "_" + Date.now(), serviceName: selected.name, category: selected.category, pricePerMonth: parseFloat(price), frequency: freq, seasonal: isSeasonal, activeMonths: isSeasonal ? [...MOWING_MONTHS] : [...ALL_MONTHS] });
    setSelectedId(""); setPrice(""); onClose();
  };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Service to Subscription</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label>Service</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Select a service" /></SelectTrigger>
              <SelectContent>{allServices.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.category})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Monthly Price</Label>
            <Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className="min-h-[44px]" placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label>Frequency</Label>
            <Select value={freq} onValueChange={setFreq}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Weekly">Weekly</SelectItem>
                <SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem>
                <SelectItem value="Monthly">Monthly</SelectItem>
                <SelectItem value="Quarterly">Quarterly</SelectItem>
                <SelectItem value="Annual">Annual</SelectItem>
                <SelectItem value="As Needed">As Needed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} className="w-full min-h-[44px]" disabled={!selectedId || !price}>Add Service</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangeHistoryDialog({ open, onClose, history }: { open: boolean; onClose: () => void; history: ChangeHistoryEntry[] }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Change History</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[400px] overflow-y-auto pt-2">
          {history.length === 0 && <p className="text-sm text-muted-foreground">No changes recorded.</p>}
          {history.map((entry, i) => (
            <div key={i} className="text-sm border-b pb-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{entry.changedBy}</span>
                <span>{new Date(entry.timestamp).toLocaleString()}</span>
              </div>
              <p className="mt-0.5">{entry.summary}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MonthSelector({ value, onChange }: { value: number[]; onChange: (months: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {MONTH_LABELS.map((label, i) => {
        const month = i + 1;
        const active = value.includes(month);
        return (
          <button key={month} type="button" onClick={() => onChange(active ? value.filter(m => m !== month) : [...value, month].sort((a, b) => a - b))}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

const AGREEMENT_STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  pending_signature: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  signed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  void: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const PLAN_OPTIONS = [
  { value: "residential_autopilot", label: "One-Service Autopilot (Residential)" },
  { value: "commercial_autopilot", label: "One-Service Autopilot (Commercial)" },
  { value: "residential_tcep", label: "TCEP — Total Care Exterior Plan (Residential)" },
  { value: "commercial_tcep", label: "TPC — Total Property Care (Commercial)" },
];

function AgreementSection({ sub }: { sub: Subscription }) {
  const { toast } = useToast();
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>("");

  const { data: agreements = [], isLoading, refetch } = useQuery<ServiceAgreement[]>({
    queryKey: ["/agreements", sub.id],
    queryFn: () =>
      fetch(`/.netlify/functions/agreements?subscriptionId=${sub.id}`)
        .then(r => r.json()),
  });

  // Most recent non-void agreement
  const activeAgreement = agreements.find(a => a.status !== "void") ?? null;

  const generateMutation = useMutation({
    mutationFn: async (quoteType: string) => {
      const res = await apiRequest("POST", "/agreements?action=generate-for-subscription", {
        subscriptionId: sub.id,
        contactId: sub.contactId,
        quoteType,
      });
      return res.json();
    },
    onSuccess: (data: { signUrl: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/agreements", sub.id] });
      queryClient.invalidateQueries({ queryKey: ["/subscriptions"] });
      refetch();
      setShowPlanPicker(false);
      // Copy sign URL to clipboard
      navigator.clipboard.writeText(data.signUrl).catch(() => {});
      toast({ title: "Agreement generated", description: "Sign link copied to clipboard." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleGenerate = () => {
    if (!selectedPlan) return;
    generateMutation.mutate(selectedPlan);
  };

  const handleCopyLink = () => {
    if (!activeAgreement?.acceptToken) return;
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/.netlify/functions/esign?token=${activeAgreement.acceptToken}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Sign link copied", description: "Send this link to the customer to sign." });
    }).catch(() => {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    });
  };

  const handleOpenLink = () => {
    if (!activeAgreement?.acceptToken) return;
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/.netlify/functions/esign?token=${activeAgreement.acceptToken}`;
    window.open(url, "_blank");
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <FileSignature className="h-4 w-4" /> Service Agreement
            </CardTitle>
            {!activeAgreement && !isLoading && (
              <Button size="sm" variant="outline" onClick={() => { setSelectedPlan(""); setShowPlanPicker(true); }} className="min-h-[36px]">
                <Send className="h-3.5 w-3.5 mr-1" /> Generate
              </Button>
            )}
            {activeAgreement && activeAgreement.status !== "signed" && (
              <Button size="sm" variant="outline" onClick={() => { setSelectedPlan(activeAgreement.quoteType ?? ""); setShowPlanPicker(true); }} className="min-h-[36px]">
                <Send className="h-3.5 w-3.5 mr-1" /> Regenerate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
          {!isLoading && !activeAgreement && (
            <p className="text-xs text-muted-foreground">No service agreement yet. Generate one to send to the customer for signing.</p>
          )}
          {activeAgreement && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={AGREEMENT_STATUS_STYLES[activeAgreement.status] ?? ""}>
                  {activeAgreement.status.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
                </Badge>
                {activeAgreement.quoteType && (
                  <span className="text-xs text-muted-foreground">
                    {PLAN_OPTIONS.find(p => p.value === activeAgreement.quoteType)?.label ?? activeAgreement.quoteType}
                  </span>
                )}
              </div>
              {activeAgreement.status === "signed" && activeAgreement.signedAt && (
                <div className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Signed {new Date(activeAgreement.signedAt).toLocaleDateString()}
                </div>
              )}
              {activeAgreement.status === "pending_signature" && (
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={handleCopyLink} className="min-h-[36px]">
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy Sign Link
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleOpenLink} className="min-h-[36px] text-muted-foreground">
                    Preview
                  </Button>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Created {new Date(activeAgreement.createdAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan Type Picker Dialog */}
      <Dialog open={showPlanPicker} onOpenChange={setShowPlanPicker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Agreement Plan Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Choose the plan type for this service agreement. This determines which legal template and benefit sections are included.</p>
            <div className="space-y-2">
              {PLAN_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedPlan(opt.value)}
                  className={`w-full text-left px-3 py-2.5 rounded-md border text-sm transition-colors ${
                    selectedPlan === opt.value
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!selectedPlan || generateMutation.isPending}
              className="w-full min-h-[44px]"
            >
              {generateMutation.isPending ? "Generating..." : "Generate Agreement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SubscriptionDetail({ sub, onBack }: { sub: Subscription; onBack: () => void }) {
  const { toast } = useToast();
  const [services, setServices] = useState<SubscriptionService[]>([]);
  const [history, setHistory] = useState<ChangeHistoryEntry[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [qbRef, setQbRef] = useState(sub.quickbooksReference ?? "");
  const [pauseDate, setPauseDate] = useState("");

  const { data: freshSub } = useQuery<Subscription>({
    queryKey: ["/subscriptions", sub.id],
    queryFn: () => fetch(`/.netlify/functions/subscriptions/${sub.id}`).then(r => r.json()),
  });
  const activeSub = freshSub ?? sub;

  useEffect(() => {
    setServices(Array.isArray(activeSub.services) ? activeSub.services : []);
    setHistory(Array.isArray(activeSub.changeHistory) ? activeSub.changeHistory : []);
    setQbRef(activeSub.quickbooksReference ?? "");
  }, [activeSub]);

  const totals = computeSeasonalTotals(services);

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/subscriptions/${activeSub.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/subscriptions", activeSub.id] });
      toast({ title: "Subscription updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveChanges = useCallback((updatedServices: SubscriptionService[], summary: string) => {
    const newTotals = computeSeasonalTotals(updatedServices);
    const newEntry: ChangeHistoryEntry = { timestamp: new Date().toISOString(), changedBy: "Owner", summary };
    const newHistory = [...history, newEntry];
    setHistory(newHistory);
    setServices(updatedServices);
    updateMutation.mutate({
      services: updatedServices,
      inSeasonMonthlyTotal: newTotals.inSeason,
      offSeasonMonthlyTotal: newTotals.offSeason,
      changeHistory: newHistory,
      quickbooksReference: qbRef || null,
    });
  }, [history, qbRef, updateMutation]);

  const handleServiceFieldChange = (idx: number, field: keyof SubscriptionService, value: unknown) => {
    const updated = [...services];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[idx] as any)[field] = value;
    setServices(updated);
  };

  const handleSaveAll = () => saveChanges(services, "Edited service details");
  const handleRemoveService = (idx: number) => { const removed = services[idx]; saveChanges(services.filter((_, i) => i !== idx), `Removed ${removed.serviceName}`); };
  const handleAddService = (svc: SubscriptionService) => saveChanges([...services, svc], `Added ${svc.serviceName}`);

  const handleStatusChange = (newStatus: "ACTIVE" | "PAUSED" | "CANCELED" | "ARCHIVED") => {
    const data: Record<string, unknown> = { status: newStatus };
    if (newStatus === "PAUSED" && pauseDate) data.pauseUntil = pauseDate;
    if (newStatus === "ACTIVE") data.pauseUntil = null;
    const newEntry: ChangeHistoryEntry = { timestamp: new Date().toISOString(), changedBy: "Owner", summary: `Status changed to ${newStatus}${newStatus === "PAUSED" && pauseDate ? ` until ${pauseDate}` : ""}` };
    const newHistory = [...history, newEntry];
    data.changeHistory = newHistory;
    setHistory(newHistory);
    updateMutation.mutate(data);
  };

  const handleDownloadPdf = () => {
    window.location.href = `/.netlify/functions/pdf-subscription?subscriptionId=${activeSub.id}`;
  };

  const isCanceled = activeSub.status === "CANCELED";
  const isArchived = activeSub.status === "ARCHIVED";
  const isReadOnly = isCanceled || isArchived;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="min-h-[40px]"><ChevronLeft className="h-4 w-4 mr-1" /> Back</Button>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowHistory(true)} className="min-h-[40px]"><History className="h-4 w-4 mr-1" /> History</Button>
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="min-h-[40px]"><Download className="h-4 w-4 mr-1" /> PDF</Button>
        </div>
      </div>

      <Card>
        <CardContent className="py-4 space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">{activeSub.customerName}</h2>
            <Badge className={STATUS_STYLES[activeSub.status] ?? ""}>{activeSub.status}</Badge>
          </div>
          {activeSub.businessName && <p className="text-sm text-muted-foreground">{activeSub.businessName}</p>}
          {activeSub.customerAddress && <p className="text-sm text-muted-foreground">{activeSub.customerAddress}</p>}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="bg-green-50 dark:bg-green-900/30 rounded p-2 text-center">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground">In-Season (Mar-Nov)</p>
              <p className="text-lg font-bold text-green-700 dark:text-green-400">{fmt(totals.inSeason)}<span className="text-xs font-normal">/mo</span></p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-2 text-center">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground">Off-Season (Dec-Feb)</p>
              <p className="text-lg font-bold">{fmt(totals.offSeason)}<span className="text-xs font-normal">/mo</span></p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Status Management</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            {activeSub.status === "ACTIVE" && (
              <>
                <div className="flex items-center gap-2">
                  <Input type="date" value={pauseDate} onChange={e => setPauseDate(e.target.value)} className="min-h-[40px] w-[160px]" />
                  <Button variant="outline" size="sm" onClick={() => handleStatusChange("PAUSED")} className="min-h-[40px]"><Pause className="h-4 w-4 mr-1" /> Pause</Button>
                </div>
                <Button variant="destructive" size="sm" onClick={() => handleStatusChange("CANCELED")} className="min-h-[40px]"><XCircle className="h-4 w-4 mr-1" /> Cancel</Button>
              </>
            )}
            {activeSub.status === "PAUSED" && (
              <>
                {activeSub.pauseUntil && <p className="text-xs text-muted-foreground self-center">Paused until {new Date(activeSub.pauseUntil).toLocaleDateString()}</p>}
                <Button variant="default" size="sm" onClick={() => handleStatusChange("ACTIVE")} className="min-h-[40px]"><Play className="h-4 w-4 mr-1" /> Reactivate</Button>
                <Button variant="destructive" size="sm" onClick={() => handleStatusChange("CANCELED")} className="min-h-[40px]"><XCircle className="h-4 w-4 mr-1" /> Cancel</Button>
              </>
            )}
            {isCanceled && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleStatusChange("ARCHIVED")} className="min-h-[40px]"><Archive className="h-4 w-4 mr-1" /> Archive</Button>
                <Button variant="default" size="sm" onClick={() => handleStatusChange("ACTIVE")} className="min-h-[40px]"><RotateCcw className="h-4 w-4 mr-1" /> Reactivate</Button>
              </>
            )}
            {isArchived && <Button variant="default" size="sm" onClick={() => handleStatusChange("ACTIVE")} className="min-h-[40px]"><RotateCcw className="h-4 w-4 mr-1" /> Restore to Active</Button>}
          </div>
        </CardContent>
      </Card>

      <AgreementSection sub={activeSub} />

      {!isReadOnly && (
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">QB Ref:</Label>
          <Input value={qbRef} onChange={e => setQbRef(e.target.value)} className="min-h-[36px] text-xs" placeholder="QuickBooks customer ID or note" />
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Services</CardTitle>
            {!isReadOnly && <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)} className="min-h-[36px]"><Plus className="h-4 w-4 mr-1" /> Add</Button>}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Service</TableHead>
                <TableHead className="text-xs">$/Mo</TableHead>
                <TableHead className="text-xs">Freq</TableHead>
                <TableHead className="text-xs">Seasonal</TableHead>
                <TableHead className="text-xs">Active Months</TableHead>
                {!isReadOnly && <TableHead className="text-xs w-10"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((svc, idx) => (
                <TableRow key={svc.id}>
                  <TableCell className="text-xs font-medium">{svc.serviceName}<span className="block text-[10px] text-muted-foreground">{svc.category}</span></TableCell>
                  <TableCell>
                    {isReadOnly ? <span className="text-xs">{fmt(svc.pricePerMonth)}</span> : (
                      <Input type="number" step="0.01" value={svc.pricePerMonth} onChange={e => handleServiceFieldChange(idx, "pricePerMonth", parseFloat(e.target.value) || 0)} className="min-h-[36px] w-[80px] text-xs" />
                    )}
                  </TableCell>
                  <TableCell>
                    {isReadOnly ? <span className="text-xs">{svc.frequency}</span> : (
                      <Select value={svc.frequency} onValueChange={v => handleServiceFieldChange(idx, "frequency", v)}>
                        <SelectTrigger className="min-h-[36px] w-[100px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Weekly">Weekly</SelectItem>
                          <SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem>
                          <SelectItem value="Monthly">Monthly</SelectItem>
                          <SelectItem value="Quarterly">Quarterly</SelectItem>
                          <SelectItem value="Annual">Annual</SelectItem>
                          <SelectItem value="As Needed">As Needed</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {isReadOnly ? <span className="text-xs">{svc.seasonal ? "Yes" : "No"}</span> : (
                      <Checkbox checked={svc.seasonal} onCheckedChange={v => { handleServiceFieldChange(idx, "seasonal", !!v); handleServiceFieldChange(idx, "activeMonths", v ? [...MOWING_MONTHS] : [...ALL_MONTHS]); }} />
                    )}
                  </TableCell>
                  <TableCell>
                    {svc.seasonal && !isReadOnly ? (
                      <MonthSelector value={svc.activeMonths} onChange={months => handleServiceFieldChange(idx, "activeMonths", months)} />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{svc.seasonal ? svc.activeMonths.map(m => MONTH_LABELS[m - 1]).join(", ") : "Year-Round"}</span>
                    )}
                  </TableCell>
                  {!isReadOnly && <TableCell><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveService(idx)}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!isReadOnly && <Button onClick={handleSaveAll} className="w-full min-h-[44px]" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving..." : "Save Changes"}</Button>}

      <AddServiceDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} onAdd={handleAddService} />
      <ChangeHistoryDialog open={showHistory} onClose={() => setShowHistory(false)} history={history} />
    </div>
  );
}

export default function Subscriptions() {
  const [viewingSub, setViewingSub] = useState<Subscription | null>(null);
  if (viewingSub) return <div className="p-4"><SubscriptionDetail sub={viewingSub} onBack={() => setViewingSub(null)} /></div>;
  return <div className="p-4"><SubscriptionsList onView={setViewingSub} /></div>;
}
