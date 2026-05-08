import * as React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MessageSquare, Send, HelpCircle, AlertTriangle, Sparkles, Loader2, CheckCircle2, Clock } from "lucide-react";

type Category = "question" | "issue" | "feedback";
interface Message {
  id: number;
  category: Category;
  subject: string;
  body: string;
  adminReply: string | null;
  isReadByStudent: boolean;
  status: "open" | "replied" | "closed";
  createdAt: string;
  repliedAt: string | null;
}

const CAT_META: Record<Category, { label: string; icon: React.ReactNode; color: string }> = {
  question: { label: "Question",  icon: <HelpCircle className="w-3.5 h-3.5" />,    color: "bg-blue-100 text-blue-700"   },
  issue:    { label: "Issue",     icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "bg-red-100 text-red-700"     },
  feedback: { label: "Feedback",  icon: <Sparkles className="w-3.5 h-3.5" />,      color: "bg-purple-100 text-purple-700" },
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

function authHeader(): Record<string, string> {
  try {
    const s = JSON.parse(localStorage.getItem("student_session") || "null");
    return s?.token ? { Authorization: `Bearer ${s.token}` } : {};
  } catch { return {}; }
}

export function MessagesTab() {
  const { toast } = useToast();
  const [category, setCategory] = React.useState<Category>("question");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  const { data: messages = [], isLoading } = useQuery<Message[]>({
    queryKey: ["/api/student/messages"],
    queryFn: async () => {
      const r = await fetch("/api/student/messages", { headers: authHeader() });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  // Auto-mark unread replies as read when this tab opens.
  React.useEffect(() => {
    const hasUnread = messages.some(m => !m.isReadByStudent);
    if (!hasUnread) return;
    fetch("/api/student/messages/mark-read", { method: "POST", headers: authHeader() })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/student/messages"] }))
      .catch(() => {});
  }, [messages]);

  const sendMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/student/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ category, subject: subject.trim(), body: body.trim() }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed to send");
      return r.json();
    },
    onSuccess: () => {
      setSubject(""); setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/student/messages"] });
      toast({ title: "Sent!", description: "The admin has been notified. You'll see their reply here." });
    },
    onError: (err: any) => toast({ title: "Couldn't send", description: err.message, variant: "destructive" }),
  });

  const canSend = subject.trim().length >= 2 && body.trim().length >= 5 && !sendMut.isPending;

  return (
    <div className="max-w-3xl mx-auto space-y-6 px-4 py-6">
      <Card className="glass-card border-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="w-5 h-5 text-primary" /> Contact Admin
          </CardTitle>
          <p className="text-xs text-muted-foreground">Send a question, report an issue, or share feedback. The admin will reply here.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">What's this about?</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger data-testid="select-message-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="question">Question</SelectItem>
                <SelectItem value="issue">Issue / Problem</SelectItem>
                <SelectItem value="feedback">Feedback / Suggestion</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Subject</Label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value.slice(0, 200))}
              placeholder="e.g. Can't upload my submission"
              maxLength={200}
              data-testid="input-message-subject"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Message</Label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value.slice(0, 4000))}
              placeholder="Describe what's on your mind…"
              rows={5}
              maxLength={4000}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              data-testid="textarea-message-body"
            />
            <p className="text-[10px] text-muted-foreground text-right">{body.length}/4000</p>
          </div>
          <Button
            className="w-full"
            disabled={!canSend}
            onClick={() => sendMut.mutate()}
            data-testid="button-send-message"
          >
            {sendMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send to Admin
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-card border-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your Conversations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No messages yet. Send your first one above!</p>
          ) : (
            messages.map(m => {
              const cat = CAT_META[m.category];
              return (
                <div
                  key={m.id}
                  className="rounded-lg border bg-card p-3 space-y-2"
                  data-testid={`card-message-${m.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`${cat.color} border-none flex items-center gap-1 text-[10px] px-1.5 py-0`}>
                          {cat.icon} {cat.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {relTime(m.createdAt)}
                        </span>
                        {!m.isReadByStudent && m.adminReply && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">New reply</Badge>
                        )}
                      </div>
                      <p className="font-semibold text-sm break-words">{m.subject}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{m.body}</p>
                    </div>
                  </div>
                  {m.adminReply ? (
                    <div className="rounded-md bg-primary/5 border border-primary/20 p-2.5 mt-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-medium text-primary">Admin replied</span>
                        {m.repliedAt && <span className="text-[10px] text-muted-foreground">· {relTime(m.repliedAt)}</span>}
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.adminReply}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Awaiting admin reply…</p>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
