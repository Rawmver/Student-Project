import * as React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Inbox, Loader2, Send, HelpCircle, AlertTriangle, Sparkles, Trash2, Filter, CheckCheck, Mail, MailOpen } from "lucide-react";

type Category = "question" | "issue" | "feedback";
interface Msg {
  id: number;
  studentName: string;
  studentId: string;
  studentEmail: string;
  category: Category;
  subject: string;
  body: string;
  adminReply: string | null;
  isReadByAdmin: boolean;
  status: "open" | "replied" | "closed";
  createdAt: string;
  repliedAt: string | null;
}

const CAT_META: Record<Category, { label: string; icon: React.ReactNode; color: string }> = {
  question: { label: "Question",  icon: <HelpCircle className="w-3 h-3" />,    color: "bg-blue-100 text-blue-700"   },
  issue:    { label: "Issue",     icon: <AlertTriangle className="w-3 h-3" />, color: "bg-red-100 text-red-700"     },
  feedback: { label: "Feedback",  icon: <Sparkles className="w-3 h-3" />,      color: "bg-purple-100 text-purple-700" },
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props { adminAuthHeader: string }

export function MessagesPanel({ adminAuthHeader }: Props) {
  const { toast } = useToast();
  const [filter, setFilter] = React.useState<"all" | "unread" | "open" | "replied" | Category>("all");
  const [draftReplies, setDraftReplies] = React.useState<Record<number, string>>({});
  const headers = { Authorization: adminAuthHeader, "Content-Type": "application/json" };

  const { data: messages = [], isLoading, refetch } = useQuery<Msg[]>({
    queryKey: ["/api/admin/messages"],
    queryFn: async () => {
      const r = await fetch("/api/admin/messages", { headers: { Authorization: adminAuthHeader } });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    refetchInterval: 20_000,
  });

  // Mark all unread as read when this panel opens (clears bell badge).
  React.useEffect(() => {
    const hasUnread = messages.some(m => !m.isReadByAdmin);
    if (!hasUnread) return;
    fetch("/api/admin/messages/mark-all-read", { method: "POST", headers: { Authorization: adminAuthHeader } })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/admin/messages"] }))
      .catch(() => {});
  }, [messages, adminAuthHeader]);

  const replyMut = useMutation({
    mutationFn: async ({ id, reply }: { id: number; reply: string }) => {
      const r = await fetch(`/api/admin/messages/${id}/reply`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reply }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed");
      return r.json();
    },
    onSuccess: (_d, vars) => {
      setDraftReplies(prev => { const c = { ...prev }; delete c[vars.id]; return c; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messages"] });
      toast({ title: "Reply sent", description: "The student will see your reply on their next visit." });
    },
    onError: (err: any) => toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/messages/${id}`, { method: "DELETE", headers: { Authorization: adminAuthHeader } });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messages"] });
      toast({ title: "Deleted" });
    },
  });

  const filtered = messages.filter(m => {
    if (filter === "all") return true;
    if (filter === "unread") return !m.isReadByAdmin;
    if (filter === "open" || filter === "replied") return m.status === filter;
    return m.category === filter;
  });

  const counts = {
    total: messages.length,
    unread: messages.filter(m => !m.isReadByAdmin).length,
    open: messages.filter(m => m.status === "open").length,
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="w-6 h-6 text-primary" /> Messages
          </h2>
          <p className="text-sm text-muted-foreground">
            {counts.total} total · {counts.unread} unread · {counts.open} awaiting reply
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="w-[180px]" data-testid="select-message-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({counts.total})</SelectItem>
              <SelectItem value="unread">Unread ({counts.unread})</SelectItem>
              <SelectItem value="open">Awaiting reply ({counts.open})</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
              <SelectItem value="question">Questions</SelectItem>
              <SelectItem value="issue">Issues</SelectItem>
              <SelectItem value="feedback">Feedback</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-messages">
            <CheckCheck className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card className="glass-card border-none">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No messages match this filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(m => {
            const cat = CAT_META[m.category];
            const draft = draftReplies[m.id] ?? "";
            return (
              <Card key={m.id} className="glass-card border-none" data-testid={`card-admin-message-${m.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`${cat.color} border-none flex items-center gap-1 text-[10px] px-1.5 py-0`}>
                          {cat.icon} {cat.label}
                        </Badge>
                        {!m.isReadByAdmin && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 flex items-center gap-1">
                            <Mail className="w-3 h-3" /> New
                          </Badge>
                        )}
                        {m.status === "replied" && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex items-center gap-1">
                            <MailOpen className="w-3 h-3" /> Replied
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{relTime(m.createdAt)}</span>
                      </div>
                      <CardTitle className="text-base leading-snug break-words">{m.subject}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        From <span className="font-medium text-foreground">{m.studentName}</span>
                        {" · "}{m.studentId}{" · "}
                        <a href={`mailto:${m.studentEmail}`} className="underline hover:text-primary">{m.studentEmail}</a>
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { if (confirm("Delete this message?")) deleteMut.mutate(m.id); }}
                      data-testid={`button-delete-message-${m.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-md bg-muted/40 p-3">
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  {m.adminReply ? (
                    <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
                      <p className="text-xs font-medium text-primary mb-1">Your reply{m.repliedAt && ` · ${relTime(m.repliedAt)}`}</p>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.adminReply}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        value={draft}
                        onChange={e => setDraftReplies(p => ({ ...p, [m.id]: e.target.value.slice(0, 4000) }))}
                        placeholder="Type a reply…"
                        rows={3}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                        data-testid={`textarea-reply-${m.id}`}
                      />
                      <Button
                        size="sm"
                        disabled={draft.trim().length < 1 || replyMut.isPending}
                        onClick={() => replyMut.mutate({ id: m.id, reply: draft.trim() })}
                        data-testid={`button-send-reply-${m.id}`}
                      >
                        {replyMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                        Send Reply
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
