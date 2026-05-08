import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Send, Loader2, User, Bot, CheckCircle2, Trash2, Settings, Plus, Clock,
  RefreshCw, RotateCcw,
} from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: Array<{ tool: string; result: string }>;
  error?: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  get_dashboard_stats: "Fetched stats",
  list_groups: "Listed groups",
  delete_group: "Deleted group",
  list_topics: "Listed topics",
  add_topic: "Added topic",
  delete_topic: "Deleted topic",
  set_required_members: "Updated member count",
  set_project_name: "Updated project name",
  set_deadline: "Updated deadline",
  update_rules: "Updated rules",
  toggle_require_leader: "Updated leader setting",
  toggle_require_topic: "Updated topic setting",
  list_projects: "Listed projects",
  create_project: "Created project",
  finalize_project: "Finalized project",
  get_current_settings: "Read settings",
};

const TOOL_ICONS: Record<string, React.ReactNode> = {
  get_dashboard_stats: <RefreshCw className="w-3 h-3" />,
  list_groups: <User className="w-3 h-3" />,
  delete_group: <Trash2 className="w-3 h-3" />,
  add_topic: <Plus className="w-3 h-3" />,
  delete_topic: <Trash2 className="w-3 h-3" />,
  set_deadline: <Clock className="w-3 h-3" />,
  get_current_settings: <Settings className="w-3 h-3" />,
};

const STARTER_PROMPTS = [
  "Show me the current dashboard stats",
  "What settings are currently configured?",
  "List all topics",
  "Add topic: Machine Learning",
  "Set deadline to 48 hours from now",
  "Set required members to 4",
];

interface AdminAIChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authHeader: () => Record<string, string>;
  onActionPerformed?: () => void;
}

export function AdminAIChat({ open, onOpenChange, authHeader, onActionPerformed }: AdminAIChatProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm your autonomous AI admin assistant. I can manage your student group portal — add topics, set deadlines, create projects, view stats, update rules, and more.\n\nJust tell me what you need done.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: userText,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Build history for context (exclude welcome message from API calls)
    const history = [...messages, userMsg]
      .filter(m => m.id !== "welcome")
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/admin/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ messages: history }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "AI request failed");

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || "Done.",
        actions: data.actions?.length ? data.actions : undefined,
      };

      setMessages(prev => [...prev, assistantMsg]);

      if (data.actions?.length) {
        onActionPerformed?.();
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: err.message || "Something went wrong. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "Chat cleared. How can I help you?",
      },
    ]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[480px] p-0 flex flex-col h-full"
      >
        <SheetHeader className="px-5 py-4 border-b bg-gradient-to-r from-primary/5 to-purple-500/5 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              AI Admin Assistant
              <Badge variant="secondary" className="text-xs font-normal">Autonomous</Badge>
            </SheetTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearHistory} title="Clear chat">
              <RotateCcw className="w-4 h-4 text-muted-foreground" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-left mt-1">
            Powered by OpenAI · Can perform real admin actions
          </p>
        </SheetHeader>

        {/* Messages area */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 min-h-0">
          <div className="py-4 space-y-4">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : msg.error
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>

                {/* Bubble */}
                <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : msg.error
                      ? "bg-destructive/10 text-destructive border border-destructive/20 rounded-tl-sm"
                      : "bg-muted rounded-tl-sm"
                  }`}>
                    {msg.content}
                  </div>

                  {/* Action badges */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.actions.map((action, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="text-xs gap-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                        >
                          {TOOL_ICONS[action.tool] ?? <CheckCircle2 className="w-3 h-3" />}
                          {TOOL_LABELS[action.tool] ?? action.tool}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Thinking & acting…</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Starter prompts — shown only on initial state */}
        {messages.length <= 1 && !loading && (
          <div className="px-4 pb-3 grid grid-cols-2 gap-1.5 shrink-0">
            {STARTER_PROMPTS.map(prompt => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className="text-left text-xs px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted/60 hover:border-primary/30 transition-colors text-muted-foreground leading-snug"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="px-4 py-3 border-t bg-background shrink-0">
          <form
            className="flex items-center gap-2"
            onSubmit={e => { e.preventDefault(); sendMessage(); }}
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask me anything or give me a command…"
              className="flex-1 h-10 text-sm"
              disabled={loading}
              data-testid="input-ai-chat"
            />
            <Button
              type="submit"
              size="icon"
              className="h-10 w-10 shrink-0"
              disabled={!input.trim() || loading}
              data-testid="button-ai-send"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            AI can perform real actions on your dashboard. Use with care.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
