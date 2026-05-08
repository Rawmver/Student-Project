import * as React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Loader2, ShieldAlert, Database, Globe, ToggleLeft, Send, Bell } from "lucide-react";

interface Credential {
  key: string;
  group: string;
  label: string;
  description: string;
  secret: boolean;
  hasValue: boolean;
  source: "db" | "env" | "none";
  maskedValue: string;
  type?: "boolean" | "select";
  options?: string[];
}

const QK = ["/api/admin/credentials"] as const;

function SourceBadge({ source }: { source: Credential["source"] }) {
  if (source === "db") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200" data-testid="badge-source-db"><Database className="w-3 h-3 mr-1" /> Custom (panel)</Badge>;
  if (source === "env") return <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 dark:bg-sky-900/40 dark:text-sky-200" data-testid="badge-source-env"><Globe className="w-3 h-3 mr-1" /> From .env</Badge>;
  return <Badge variant="outline" className="text-muted-foreground" data-testid="badge-source-none">Not set</Badge>;
}

export function CredentialsPanel({ adminAuthHeader }: { adminAuthHeader: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Credential | null>(null);
  const [newValue, setNewValue] = React.useState("");
  const [showRaw, setShowRaw] = React.useState(false);

  const { data, isLoading, refetch } = useQuery<{ credentials: Credential[] }>({
    queryKey: QK,
    queryFn: async () => {
      const res = await fetch("/api/admin/credentials", { headers: { Authorization: adminAuthHeader } });
      if (!res.ok) throw new Error("Failed to load credentials");
      return res.json();
    },
  });

  const saveMut = useMutation({
    mutationFn: async (vars: { key: string; value: string }) => {
      const res = await fetch(`/api/admin/credentials/${vars.key}`, {
        method: "PATCH",
        headers: { Authorization: adminAuthHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ value: vars.value }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK });
      toast({ title: "Credential saved", description: "The new value is in effect immediately — no restart needed." });
      setEditing(null);
      setNewValue("");
      setShowRaw(false);
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const [testEmailTo, setTestEmailTo] = React.useState("");

  const testEmailMut = useMutation({
    mutationFn: async (to: string) => {
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { Authorization: adminAuthHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.message || "Test email failed");
      return j;
    },
    onSuccess: (j: any) => toast({ title: "Test email sent", description: `Sent via ${j.provider} to ${j.to}. Check the inbox.` }),
    onError: (err: any) => toast({ title: "Test email failed", description: err.message, variant: "destructive" }),
  });

  const testNotifyMut = useMutation({
    mutationFn: async (force: boolean) => {
      const res = await fetch("/api/admin/notify/test", {
        method: "POST",
        headers: { Authorization: adminAuthHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      return res.json();
    },
    onSuccess: (j: any) => {
      if (!j.results || j.results.length === 0) {
        toast({ title: "No channels enabled", description: j.message, variant: "destructive" });
        return;
      }
      const ok = j.results.filter((r: any) => r.ok).map((r: any) => r.channel).join(", ") || "none";
      const fail = j.results.filter((r: any) => !r.ok).map((r: any) => `${r.channel}: ${r.message}`).join(" • ");
      toast({
        title: j.ok ? "Test alerts sent" : "Some channels failed",
        description: `OK: ${ok}${fail ? ` — Failed: ${fail}` : ""}`,
        variant: j.ok ? "default" : "destructive",
      });
    },
    onError: (err: any) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const clearMut = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch(`/api/admin/credentials/${key}`, {
        method: "DELETE",
        headers: { Authorization: adminAuthHeader },
      });
      if (!res.ok) throw new Error((await res.json()).message || "Clear failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK });
      toast({ title: "Credential cleared", description: "Reverted to the .env value (if any)." });
    },
    onError: (err: any) => toast({ title: "Clear failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading credentials…</div>;
  }

  // Group by .group
  const grouped = (data?.credentials || []).reduce<Record<string, Credential[]>>((acc, c) => {
    (acc[c.group] = acc[c.group] || []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900">
        <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold mb-1">About credentials</p>
          <p className="leading-relaxed">
            Values pasted here override the corresponding <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/60">.env</code> variable and take effect immediately — no server restart needed. Click <b>Clear</b> to delete a custom value and revert to the <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/60">.env</code> value (if any).
          </p>
          <p className="leading-relaxed mt-2">
            <b>Cannot be edited here:</b> <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/60">DATABASE_URL</code> (needed before the DB is reachable) and <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/60">SESSION_SECRET</code> (changing it logs everyone out). Edit those in your hosting provider's secrets / env panel.
          </p>
        </div>
      </div>

      {/* Quick actions: verify the active email provider and notification channels work end-to-end. */}
      <Card className="glass-card border-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Send className="w-4 h-4 text-primary" /> Quick test actions</CardTitle>
          <p className="text-xs text-muted-foreground">After switching providers or toggling channels, send a test through them to confirm everything works.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              placeholder="your@email.com"
              value={testEmailTo}
              onChange={e => setTestEmailTo(e.target.value)}
              className="sm:max-w-[260px]"
              data-testid="input-test-email-to"
            />
            <Button
              size="sm"
              onClick={() => testEmailMut.mutate(testEmailTo.trim())}
              disabled={!testEmailTo.includes("@") || testEmailMut.isPending}
              data-testid="button-send-test-email"
            >
              {testEmailMut.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Sending…</> : <><Send className="w-4 h-4 mr-1" /> Send test email</>}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => testNotifyMut.mutate(false)}
              disabled={testNotifyMut.isPending}
              data-testid="button-send-test-alert"
            >
              <Bell className="w-4 h-4 mr-1" /> Send test alert (enabled channels)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => testNotifyMut.mutate(true)}
              disabled={testNotifyMut.isPending}
              data-testid="button-send-test-alert-force"
            >
              <Bell className="w-4 h-4 mr-1" /> Force-test all configured channels
            </Button>
          </div>
        </CardContent>
      </Card>

      {Object.entries(grouped).map(([group, items]) => (
        <div key={group} className="space-y-3">
          <h3 className="text-base font-semibold text-foreground/80 px-1">{group}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map(c => {
              const isBool = c.type === "boolean";
              const isSelect = c.type === "select";
              const boolOn = isBool && (c.maskedValue || "").toLowerCase() === "true";
              const selectVal = isSelect ? (c.maskedValue || c.options?.[0] || "") : "";
              return (
              <Card key={c.key} className="glass-card border-none" data-testid={`card-cred-${c.key}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {isBool ? <ToggleLeft className="w-4 h-4 text-primary" /> : <KeyRound className="w-4 h-4 text-primary" />}
                      {c.label}
                    </CardTitle>
                    <SourceBadge source={c.source} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{c.description}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isBool ? (
                    <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2.5">
                      <span className="text-sm font-medium" data-testid={`text-cred-value-${c.key}`}>
                        {boolOn ? "On" : "Off"}
                      </span>
                      <Switch
                        checked={boolOn}
                        disabled={saveMut.isPending}
                        onCheckedChange={(v) => saveMut.mutate({ key: c.key, value: v ? "true" : "false" })}
                        data-testid={`switch-cred-${c.key}`}
                      />
                    </div>
                  ) : isSelect ? (
                    <Select
                      value={selectVal}
                      onValueChange={(v) => saveMut.mutate({ key: c.key, value: v })}
                      disabled={saveMut.isPending}
                    >
                      <SelectTrigger className="bg-muted/60" data-testid={`select-cred-${c.key}`}>
                        <SelectValue placeholder="Choose…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(c.options || []).map(opt => (
                          <SelectItem key={opt} value={opt} data-testid={`option-cred-${c.key}-${opt}`}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="font-mono text-xs px-2.5 py-2 rounded-md bg-muted/60 text-foreground/80 break-all min-h-[34px]" data-testid={`text-cred-value-${c.key}`}>
                      {c.hasValue ? c.maskedValue : <span className="italic text-muted-foreground">empty</span>}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {!isBool && !isSelect && (
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1"
                        onClick={() => { setEditing(c); setNewValue(""); setShowRaw(!c.secret); }}
                        data-testid={`button-edit-cred-${c.key}`}
                      >
                        {c.source === "db" ? "Edit" : "Set custom value"}
                      </Button>
                    )}
                    {c.source === "db" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={isBool || isSelect ? "flex-1" : ""}
                        onClick={() => { if (confirm(`Clear ${c.label}? It will revert to the .env value (if any).`)) clearMut.mutate(c.key); }}
                        disabled={clearMut.isPending}
                        data-testid={`button-clear-cred-${c.key}`}
                      >
                        {isBool || isSelect ? "Reset to default" : "Clear"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        </div>
      ))}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={open => { if (!open) { setEditing(null); setNewValue(""); setShowRaw(false); } }}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-credential">
          <DialogHeader>
            <DialogTitle>{editing?.label}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed pt-1">{editing?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="cred-new-value" className="text-sm">New value</Label>
            <Input
              id="cred-new-value"
              type={editing?.secret && !showRaw ? "password" : "text"}
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder={editing?.secret ? "Paste your secret here" : "Type the new value"}
              className="font-mono text-xs"
              autoFocus
              data-testid="input-cred-new-value"
            />
            {editing?.secret && (
              <button
                type="button"
                onClick={() => setShowRaw(s => !s)}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                data-testid="button-toggle-cred-visibility"
              >
                {showRaw ? "Hide value" : "Show value"}
              </button>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => editing && saveMut.mutate({ key: editing.key, value: newValue })}
              disabled={!newValue.trim() || saveMut.isPending}
              data-testid="button-save-cred"
            >
              {saveMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
