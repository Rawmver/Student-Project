import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Home, Users, Megaphone, StickyNote, User, LogOut, Clock,
  BookOpen, Upload, ChevronRight, Plus, Trash2, Bell,
  AlertTriangle, Info, Star, Calendar, CheckCircle2, XCircle,
  GraduationCap, FileText, ArrowLeft, Edit3, Shield, Wifi,
  FolderOpen, FolderPlus, Download, Send, HardDrive, File,
  ChevronDown, Loader2, Tv, Sparkles, Search,
  Lightbulb, Zap, PlayCircle, X, Gamepad2, Send as SendIcon, RotateCcw,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LibraryTab } from "@/components/student/LibraryTab";
import { MessagesTab } from "@/components/student/MessagesTab";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Push notification helpers ─────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
function getStoredStudent(): { token: string; name: string; studentId: string; email: string; semester?: string | null } | null {
  try { return JSON.parse(localStorage.getItem("student_session") || "null"); } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = "home" | "group" | "announcements" | "notes" | "files" | "profile" | "calendar" | "virtual-room" | "library" | "messages";

type CalendarEvent = {
  id: number; title: string; description: string | null; eventType: string;
  eventDate: string; startTime: string | null; endTime: string | null;
  filePath: string | null; fileName: string | null; fileMimeType: string | null;
  createdAt: string;
};
interface Note { id: string; title: string; body: string; createdAt: string; }
interface Announcement { id: number; title: string; content: string; priority: "info" | "warning" | "important"; createdAt: string; }
interface Project { id: number; name: string; status: string; deadline: string | null; }
interface GroupMember { id: number; name: string; studentId: string; role: string; topicId?: number | null; topic?: { name: string } | null; }
interface GroupProject { id: number; name: string; status: string; deadline: string | null; folderName?: string; }
interface GroupData { id: number; projectId: number | null; editToken?: string; createdAt: string; members: GroupMember[]; project?: GroupProject | null; projectSerial?: number; }
interface SFolder { id: number; name: string; fileCount: number; createdAt: string; }
interface SFile { id: number; folderId: number | null; originalName: string; mimeType: string; size: number; submittedToProjectId: number | null; submittedAt: string | null; createdAt: string; }

// ── Countdown hook ────────────────────────────────────────────────────────────
function useCountdown(deadline: string | null) {
  const [remaining, setRemaining] = React.useState({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
  React.useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) { setRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining({ days: d, hours: h, minutes: m, seconds: s, expired: false });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return remaining;
}

// ── Priority styling ──────────────────────────────────────────────────────────
function priorityConfig(p: string) {
  if (p === "important") return { color: "bg-red-50 border-red-200 text-red-800", icon: <AlertTriangle className="w-4 h-4 text-red-500" />, badge: "bg-red-100 text-red-700" };
  if (p === "warning") return { color: "bg-amber-50 border-amber-200 text-amber-800", icon: <Star className="w-4 h-4 text-amber-500" />, badge: "bg-amber-100 text-amber-700" };
  return { color: "bg-blue-50 border-blue-200 text-blue-800", icon: <Info className="w-4 h-4 text-blue-500" />, badge: "bg-blue-100 text-blue-700" };
}

// ── Home Tab ──────────────────────────────────────────────────────────────────
function HomeTab({ student, project, announcements, hasGroup, onNavigate }: {
  student: { name: string; studentId: string; email: string };
  project: Project | null;
  announcements: Announcement[];
  hasGroup: boolean;
  onNavigate: (tab: Tab) => void;
}) {
  const countdown = useCountdown(project?.deadline ?? null);
  const initials = student.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const greet = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="space-y-5 pb-6">
      {/* Hero greeting card */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 p-5 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="text-white/70 text-sm font-light">{greet()},</p>
            <h2 className="text-xl font-bold truncate">{student.name}</h2>
            <p className="text-white/60 text-xs mt-0.5">ID: {student.studentId}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 bg-white/15 rounded-full px-3 py-1 text-xs font-medium">
            <GraduationCap className="w-3 h-3" /> Student Portal
          </span>
          {hasGroup && (
            <span className="inline-flex items-center gap-1.5 bg-green-400/30 rounded-full px-3 py-1 text-xs font-medium">
              <CheckCircle2 className="w-3 h-3" /> Group Submitted
            </span>
          )}
        </div>
      </div>

      {/* Active project / deadline */}
      {project ? (
        <div className="rounded-2xl border border-purple-100 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-purple-50 border-b border-purple-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-semibold text-purple-800">Active Project</span>
            <Badge className="ml-auto text-xs bg-purple-100 text-purple-700 border-0">{project.status}</Badge>
          </div>
          <div className="p-4">
            <p className="font-semibold text-gray-800 mb-3">{project.name}</p>
            {project.deadline ? (
              countdown.expired ? (
                <div className="flex items-center gap-2 text-red-500 text-sm">
                  <XCircle className="w-4 h-4" /> Deadline has passed
                </div>
              ) : (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Submission closes in:</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[["Days", countdown.days], ["Hrs", countdown.hours], ["Min", countdown.minutes], ["Sec", countdown.seconds]].map(([label, val]) => (
                      <div key={label} className="text-center bg-gradient-to-b from-violet-50 to-indigo-50 rounded-xl py-2 border border-purple-100">
                        <p className="text-lg font-bold text-purple-700">{String(val).padStart(2, "0")}</p>
                        <p className="text-xs text-purple-500">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <p className="text-sm text-gray-500 flex items-center gap-1.5"><Clock className="w-4 h-4" /> No deadline set</p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 flex items-center gap-3 text-gray-500">
          <XCircle className="w-5 h-5 text-gray-300" />
          <p className="text-sm">No active project right now</p>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: <Users className="w-5 h-5" />, label: "My Group", desc: "View submission", tab: "group" as Tab, color: "from-violet-500 to-purple-600" },
            { icon: <Calendar className="w-5 h-5" />, label: "Calendar", desc: "Events & deadlines", tab: "calendar" as Tab, color: "from-purple-500 to-violet-600" },
            { icon: <Megaphone className="w-5 h-5" />, label: "Announcements", desc: `${announcements.length} notice${announcements.length !== 1 ? "s" : ""}`, tab: "announcements" as Tab, color: "from-blue-500 to-indigo-600" },
            { icon: <HardDrive className="w-5 h-5" />, label: "My Storage", desc: "Folders & files", tab: "files" as Tab, color: "from-teal-500 to-cyan-600" },
            { icon: <StickyNote className="w-5 h-5" />, label: "My Notes", desc: "Personal notes", tab: "notes" as Tab, color: "from-amber-500 to-orange-500" },
            { icon: <User className="w-5 h-5" />, label: "Profile", desc: "Account info", tab: "profile" as Tab, color: "from-emerald-500 to-teal-600" },
          ].map((item, i, arr) => (
            <button key={item.tab} onClick={() => onNavigate(item.tab)} data-testid={`quick-action-${item.tab}`}
              className={`rounded-2xl bg-white border border-gray-100 shadow-sm p-4 text-left hover:shadow-md transition-shadow active:scale-95${i === arr.length - 1 && arr.length % 2 !== 0 ? " col-span-2" : ""}`}
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center text-white mb-3`}>
                {item.icon}
              </div>
              <p className="font-semibold text-gray-800 text-sm">{item.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Recent announcements */}
      {announcements.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Recent Notices</h3>
            <button onClick={() => onNavigate("announcements")} className="text-xs text-purple-600 font-medium">See all →</button>
          </div>
          <div className="space-y-2">
            {announcements.slice(-2).reverse().map(ann => {
              const cfg = priorityConfig(ann.priority);
              return (
                <div key={ann.id} className={`rounded-xl border p-3 flex gap-3 items-start ${cfg.color}`}>
                  <div className="mt-0.5 flex-shrink-0">{cfg.icon}</div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{ann.title}</p>
                    <p className="text-xs mt-0.5 opacity-80 line-clamp-2">{ann.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── My Group Tab ──────────────────────────────────────────────────────────────
function DeadlineStatusBadge({ deadline, status }: { deadline: string | null; status?: string }) {
  if (status === "finalized") {
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"><XCircle className="w-3 h-3" />Finalized</span>;
  }
  if (!deadline) {
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"><Clock className="w-3 h-3" />No Deadline</span>;
  }
  const passed = new Date(deadline) <= new Date();
  if (passed) {
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-600"><XCircle className="w-3 h-3" />Deadline Passed</span>;
  }
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle2 className="w-3 h-3" />Deadline Active</span>;
}

function MyGroupTab({ student, project }: { student: { token: string; studentId: string }; project: Project | null }) {
  const { data: allGroups = [], isLoading } = useQuery<GroupData[]>({
    queryKey: ["/api/student/my-groups-history"],
    queryFn: async () => {
      const r = await fetch("/api/student/my-groups-history", {
        headers: { Authorization: `Bearer ${student.token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
  });

  // Sort: groups with active deadline first, then by submission date desc
  const sortedGroups = [...allGroups].sort((a, b) => {
    const aActive = a.project?.deadline ? new Date(a.project.deadline) > new Date() : false;
    const bActive = b.project?.deadline ? new Date(b.project.deadline) > new Date() : false;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // The current active-project group (if any)
  const activeGroup = project ? sortedGroups.find(g => g.projectId === project.id) : null;

  const handleEdit = (g: GroupData) => {
    if (!g.projectId) return;
    const key = `group_submission_${g.projectId}`;
    const stored = (() => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } })();
    const editToken = stored?.editToken || g.editToken;
    if (!editToken) { alert("Edit token not available."); return; }
    window.location.href = `/?edit=${g.id}&token=${editToken}`;
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading your groups…</p>
      </div>
    );
  }

  if (allGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mb-4">
          <Users className="w-8 h-8 text-purple-300" />
        </div>
        <p className="text-gray-700 font-semibold text-lg">No submissions yet</p>
        <p className="text-sm text-gray-400 mt-2 max-w-xs">Your Student ID hasn't been linked to any group submission yet.</p>
        {project && (
          <Button className="mt-6 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-full px-6" onClick={() => window.location.href = "/"}>
            Go to Submission Form
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Summary banner */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-50 border border-purple-100 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-800 text-sm">My Group History</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {allGroups.length} submission{allGroups.length !== 1 ? "s" : ""} found for your Student ID
            </p>
          </div>
          <div className="flex flex-col gap-1 items-end flex-shrink-0">
            {(() => {
              const active = allGroups.filter(g => g.project?.deadline ? new Date(g.project.deadline) > new Date() : false).length;
              const passed = allGroups.filter(g => g.project?.deadline ? new Date(g.project.deadline) <= new Date() : false).length;
              return (
                <>
                  {active > 0 && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700">{active} active</span>}
                  {passed > 0 && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-600">{passed} closed</span>}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Current active project notice */}
      {project && !activeGroup && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 flex gap-2 items-start">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800">No submission for current project</p>
            <p className="text-xs text-amber-600 mt-0.5">You haven't submitted a group for <strong>{project.name}</strong> yet.</p>
            <Button size="sm" className="mt-2 bg-amber-500 hover:bg-amber-600 text-white rounded-full text-xs px-4" onClick={() => window.location.href = "/"}>
              Submit Now
            </Button>
          </div>
        </div>
      )}

      {/* Group cards */}
      <div className="space-y-3">
        {sortedGroups.map((g, idx) => {
          const isCurrentProject = project && g.projectId === project.id;
          const leader = g.members.find(m => m.role === "leader");
          const regularMembers = g.members.filter(m => m.role === "member");
          const deadline = g.project?.deadline ?? null;
          const deadlinePassed = deadline ? new Date(deadline) <= new Date() : false;
          const canEdit = isCurrentProject && !deadlinePassed;
          const projectName = g.project?.name ?? (g.projectId ? `Project #${g.projectId}` : "No Project");
          const submittedDate = new Date(g.createdAt);

          return (
            <div
              key={g.id}
              className={cn(
                "rounded-2xl border overflow-hidden",
                isCurrentProject
                  ? "border-purple-200 bg-gradient-to-br from-violet-50 to-indigo-50 shadow-sm"
                  : "border-gray-100 bg-white"
              )}
              data-testid={`group-card-${g.id}`}
            >
              {/* Card header */}
              <div className={cn("px-4 pt-4 pb-3", isCurrentProject ? "" : "")}>
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800 text-sm">
                        {isCurrentProject ? "Current: " : ""}{projectName}
                      </span>
                      {isCurrentProject && (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Current Project</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <DeadlineStatusBadge deadline={deadline} status={g.project?.status} />
                      {deadline && (
                        <span className="text-[10px] text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {deadlinePassed ? "Closed" : "Closes"} {new Date(deadline).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-gray-400">Group #{g.projectSerial ?? g.id}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{submittedDate.toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {/* Members */}
              <div className="px-4 pb-3 space-y-1.5">
                {leader && (
                  <div className="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2 border border-amber-100">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                      {leader.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 truncate">{leader.name}</p>
                      <p className="text-[10px] text-gray-400">{leader.studentId}</p>
                    </div>
                    <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px] px-1.5 py-0 flex-shrink-0">👑 Leader</Badge>
                  </div>
                )}
                {regularMembers.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 truncate">{m.name}</p>
                      <p className="text-[10px] text-gray-400">{m.studentId}</p>
                      {m.topic && <p className="text-[10px] text-purple-600">{m.topic.name}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer actions */}
              {canEdit && (
                <div className="px-4 pb-4">
                  <Button
                    onClick={() => handleEdit(g)}
                    variant="outline"
                    className="w-full rounded-xl border-purple-200 text-purple-700 gap-2 py-4 text-sm"
                    data-testid={`button-edit-group-${g.id}`}
                  >
                    <Edit3 className="w-4 h-4" /> Re-edit This Submission
                  </Button>
                </div>
              )}
              {isCurrentProject && deadlinePassed && (
                <div className="mx-4 mb-4 rounded-xl bg-red-50 border border-red-100 px-3 py-2 flex gap-2 text-red-600 text-xs">
                  <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>Deadline passed — editing is no longer allowed.</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Announcements Tab ─────────────────────────────────────────────────────────
function AnnouncementsTab({ announcements }: { announcements: Announcement[] }) {
  if (!announcements.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
          <Bell className="w-8 h-8 text-blue-200" />
        </div>
        <p className="text-gray-600 font-semibold">No announcements yet</p>
        <p className="text-sm text-gray-400 mt-1">Check back later for notices from your instructor.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-6">
      {[...announcements].reverse().map(ann => {
        const cfg = priorityConfig(ann.priority);
        return (
          <motion.div key={ann.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border p-4 ${cfg.color}`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0">{cfg.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-semibold text-sm">{ann.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${cfg.badge}`}>
                    {ann.priority}
                  </span>
                </div>
                <p className="text-sm opacity-80 leading-relaxed">{ann.content}</p>
                <p className="text-xs opacity-50 mt-2">{new Date(ann.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Files Tab (Cloud Storage) ─────────────────────────────────────────────────
function FilesTab({ student, project }: { student: { token: string }; project: Project | null }) {
  const { toast } = useToast();
  const [expandedFolder, setExpandedFolder] = React.useState<number | null>(null);
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [uploading, setUploading] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingUploadFolder, setPendingUploadFolder] = React.useState<number | null>(null);

  const authHeaders = { Authorization: `Bearer ${student.token}` };

  const { data: folders = [], isLoading: foldersLoading, refetch: refetchFolders } = useQuery<SFolder[]>({
    queryKey: ["/api/student/storage/folders"],
    queryFn: async () => {
      const r = await fetch("/api/student/storage/folders", { headers: authHeaders });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 0,
  });

  const { data: filesInFolder = [], refetch: refetchFiles } = useQuery<SFile[]>({
    queryKey: ["/api/student/storage/folders", expandedFolder, "files"],
    enabled: expandedFolder !== null,
    queryFn: async () => {
      const r = await fetch(`/api/student/storage/folders/${expandedFolder}/files`, { headers: authHeaders });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 0,
  });

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    const r = await fetch("/api/student/storage/folders", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName.trim() }),
    });
    if (r.ok) {
      toast({ title: "Folder created" });
      setNewFolderName(""); setCreatingFolder(false);
      refetchFolders();
    } else {
      const j = await r.json().catch(() => ({}));
      toast({ title: "Error", description: j.message || "Failed to create folder", variant: "destructive" });
    }
  };

  const deleteFolder = async (id: number) => {
    if (!confirm("Delete this folder and all its files?")) return;
    const r = await fetch(`/api/student/storage/folders/${id}`, { method: "DELETE", headers: authHeaders });
    if (r.ok) {
      toast({ title: "Folder deleted" });
      if (expandedFolder === id) setExpandedFolder(null);
      refetchFolders();
    }
  };

  const handleFileSelect = (folderId: number) => {
    setPendingUploadFolder(folderId);
    fileInputRef.current?.click();
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || pendingUploadFolder === null) return;
    e.target.value = "";
    setUploading(pendingUploadFolder);
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch(`/api/student/storage/folders/${pendingUploadFolder}/files`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      });
      if (r.ok) {
        toast({ title: "File uploaded", description: file.name });
        if (expandedFolder === pendingUploadFolder) refetchFiles();
        refetchFolders();
      } else {
        const j = await r.json().catch(() => ({}));
        toast({ title: "Upload failed", description: j.message || "Could not upload file", variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(null); setPendingUploadFolder(null);
    }
  };

  const deleteFile = async (id: number) => {
    const r = await fetch(`/api/student/storage/files/${id}`, { method: "DELETE", headers: authHeaders });
    if (r.ok) { toast({ title: "File deleted" }); refetchFiles(); refetchFolders(); }
  };

  const downloadFile = (id: number, name: string) => {
    const a = document.createElement("a");
    a.href = `/api/student/storage/files/${id}/download`;
    a.download = name;
    // Pass auth token via URL param for download (since anchor can't set headers)
    a.href = `/api/student/storage/files/${id}/download?_token=${encodeURIComponent(student.token)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const submitToProject = async (id: number) => {
    if (!project) return;
    const r = await fetch(`/api/student/storage/files/${id}/submit`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    if (r.ok) {
      toast({ title: "Submitted!", description: `File submitted to ${project.name}` });
      refetchFiles();
    } else {
      toast({ title: "Submit failed", variant: "destructive" });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fileIcon = (mime: string) => {
    if (mime.includes("pdf")) return "📄";
    if (mime.includes("word") || mime.includes("document")) return "📝";
    if (mime.includes("presentation") || mime.includes("powerpoint")) return "📊";
    if (mime.includes("sheet") || mime.includes("excel")) return "📈";
    if (mime.includes("image")) return "🖼️";
    if (mime.includes("zip") || mime.includes("rar")) return "🗜️";
    return "📎";
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} />

      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-100 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-800">My Cloud Storage</h3>
            <p className="text-xs text-gray-500">{folders.length} folder{folders.length !== 1 ? "s" : ""} · Up to 20 MB per file</p>
          </div>
          <Button
            size="sm"
            onClick={() => setCreatingFolder(true)}
            className="ml-auto gap-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-full text-xs px-3"
            data-testid="button-new-folder"
          >
            <FolderPlus className="w-3.5 h-3.5" /> New Folder
          </Button>
        </div>
      </div>

      {/* Create folder form */}
      {creatingFolder && (
        <div className="rounded-2xl border border-teal-200 bg-white shadow-sm p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">New Folder</p>
          <input
            autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setCreatingFolder(false); }}
            placeholder="Folder name…"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400"
            data-testid="input-folder-name"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={createFolder} disabled={!newFolderName.trim()}
              className="bg-teal-600 hover:bg-teal-700 text-white rounded-full px-4"
              data-testid="button-create-folder">Create</Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreatingFolder(false); setNewFolderName(""); }} className="rounded-full px-4">Cancel</Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!foldersLoading && folders.length === 0 && !creatingFolder && (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mb-4">
            <HardDrive className="w-8 h-8 text-teal-200" />
          </div>
          <p className="text-gray-600 font-semibold">No folders yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">Create a folder to start organizing and uploading your assignment files.</p>
          <Button onClick={() => setCreatingFolder(true)} className="mt-5 gap-2 bg-teal-600 hover:bg-teal-700 text-white rounded-full px-5" data-testid="button-create-first-folder">
            <FolderPlus className="w-4 h-4" /> Create First Folder
          </Button>
        </div>
      )}

      {/* Loading */}
      {foldersLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        </div>
      )}

      {/* Folder list */}
      <div className="space-y-2">
        {folders.map(folder => {
          const isOpen = expandedFolder === folder.id;
          return (
            <div key={folder.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              {/* Folder header row */}
              <div className="flex items-center gap-3 px-4 py-3.5">
                <button onClick={() => setExpandedFolder(isOpen ? null : folder.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                    <FolderOpen className="w-4.5 h-4.5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 text-sm truncate">{folder.name}</p>
                    <p className="text-xs text-gray-400">{folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""}</p>
                  </div>
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 ml-auto" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 ml-auto" />}
                </button>
                <button
                  onClick={() => handleFileSelect(folder.id)}
                  disabled={uploading === folder.id}
                  className="p-2 rounded-full bg-teal-50 text-teal-600 hover:bg-teal-100 transition-colors flex-shrink-0"
                  title="Upload file"
                  data-testid={`button-upload-${folder.id}`}
                >
                  {uploading === folder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => deleteFolder(folder.id)}
                  className="p-2 rounded-full text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
                  title="Delete folder"
                  data-testid={`button-delete-folder-${folder.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Files list (expanded) */}
              {isOpen && (
                <div className="border-t border-gray-50 bg-gray-50/50 px-3 py-2 space-y-1.5">
                  {filesInFolder.length === 0 ? (
                    <div className="text-center py-6 text-sm text-gray-400">
                      No files yet — tap <Upload className="inline w-3.5 h-3.5 mx-1" /> to upload
                    </div>
                  ) : (
                    filesInFolder.map(file => (
                      <div key={file.id} className="rounded-xl bg-white border border-gray-100 px-3 py-2.5 flex items-center gap-2">
                        <span className="text-lg flex-shrink-0">{fileIcon(file.mimeType)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{file.originalName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
                            {file.submittedToProjectId && (
                              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Submitted
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => downloadFile(file.id, file.originalName)}
                            className="p-1.5 rounded-full text-gray-400 hover:bg-blue-50 hover:text-blue-500 transition-colors"
                            title="Download" data-testid={`button-download-${file.id}`}>
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          {project && !file.submittedToProjectId && (
                            <button onClick={() => submitToProject(file.id)}
                              className="p-1.5 rounded-full text-gray-400 hover:bg-violet-50 hover:text-violet-600 transition-colors"
                              title={`Submit to ${project.name}`} data-testid={`button-submit-${file.id}`}>
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => deleteFile(file.id)}
                            className="p-1.5 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="Delete" data-testid={`button-delete-file-${file.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {project && (
        <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 flex gap-2 text-xs text-violet-700">
          <Send className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Tap the <strong>send</strong> icon on any file to submit it directly to <strong>{project.name}</strong>.</span>
        </div>
      )}
    </div>
  );
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────
function NotesTab() {
  const STORE_KEY = "student_portal_notes";
  const [notes, setNotes] = React.useState<Note[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
  });
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const { toast } = useToast();

  const save = (next: Note[]) => { setNotes(next); localStorage.setItem(STORE_KEY, JSON.stringify(next)); };

  const addNote = () => {
    if (!title.trim() && !body.trim()) return;
    const note: Note = { id: crypto.randomUUID(), title: title.trim() || "Untitled", body: body.trim(), createdAt: new Date().toISOString() };
    save([...notes, note]);
    setTitle(""); setBody(""); setAdding(false);
    toast({ title: "Note saved" });
  };

  const deleteNote = (id: string) => { save(notes.filter(n => n.id !== id)); };

  return (
    <div className="space-y-4 pb-6">
      {!adding ? (
        <button onClick={() => setAdding(true)} data-testid="button-add-note"
          className="w-full rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 p-4 flex items-center justify-center gap-2 text-amber-600 font-medium hover:border-amber-300 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add a note
        </button>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-white shadow-sm p-4 space-y-3">
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Note title…"
            className="w-full bg-transparent text-base font-semibold placeholder-gray-300 outline-none border-b border-gray-100 pb-2"
            data-testid="input-note-title"
          />
          <textarea
            value={body} onChange={e => setBody(e.target.value)}
            placeholder="Write your note here…"
            rows={4}
            className="w-full bg-transparent text-sm placeholder-gray-300 outline-none resize-none leading-relaxed"
            data-testid="input-note-body"
          />
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={addNote} className="bg-amber-500 hover:bg-amber-600 text-white rounded-full px-4" data-testid="button-save-note">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setTitle(""); setBody(""); }} className="rounded-full px-4">Cancel</Button>
          </div>
        </div>
      )}

      {notes.length === 0 && !adding && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <StickyNote className="w-12 h-12 text-amber-200 mb-3" />
          <p className="text-gray-500 font-medium">No notes yet</p>
          <p className="text-sm text-gray-400 mt-1">Tap the button above to add your first note.</p>
        </div>
      )}

      <AnimatePresence>
        {[...notes].reverse().map(note => (
          <motion.div key={note.id}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}
            className="rounded-2xl bg-amber-50 border border-amber-100 p-4 relative group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-amber-900 text-sm">{note.title}</p>
                {note.body && <p className="text-sm text-amber-800/70 mt-1 leading-relaxed whitespace-pre-wrap">{note.body}</p>}
                <p className="text-xs text-amber-600/50 mt-2">{new Date(note.createdAt).toLocaleDateString()}</p>
              </div>
              <button onClick={() => deleteNote(note.id)} data-testid={`button-delete-note-${note.id}`}
                className="p-1.5 rounded-full text-amber-400 hover:bg-amber-200 hover:text-red-500 transition-colors flex-shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ student, onLogout }: { student: { name: string; studentId: string; email: string }; onLogout: () => void }) {
  const initials = student.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="space-y-4 pb-6">
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 p-6 text-white text-center shadow-lg">
        <div className="w-20 h-20 rounded-full bg-white/20 border-4 border-white/40 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl font-bold">{initials}</span>
        </div>
        <h2 className="text-xl font-bold">{student.name}</h2>
        <p className="text-white/70 text-sm mt-1">Student</p>
      </div>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        {[
          { icon: <User className="w-4 h-4 text-purple-500" />, label: "Full Name", value: student.name },
          { icon: <Shield className="w-4 h-4 text-purple-500" />, label: "Student ID", value: student.studentId },
          { icon: <Wifi className="w-4 h-4 text-purple-500" />, label: "Email", value: student.email },
        ].map((item, i, arr) => (
          <div key={item.label} className={`flex items-center gap-4 px-4 py-3.5 ${i < arr.length - 1 ? "border-b border-gray-50" : ""}`}>
            <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center flex-shrink-0">{item.icon}</div>
            <div className="min-w-0">
              <p className="text-xs text-gray-400">{item.label}</p>
              <p className="font-medium text-gray-800 text-sm truncate">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <a href="/" className="flex items-center gap-4 px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 transition-colors">
          <div className="w-8 h-8 rounded-full bg-violet-50 flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4 h-4 text-violet-500" />
          </div>
          <span className="font-medium text-gray-800 text-sm">Group Submission Form</span>
          <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
        </a>
        <a href="/file-submit" className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors">
          <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Upload className="w-4 h-4 text-blue-500" />
          </div>
          <span className="font-medium text-gray-800 text-sm">File Submission</span>
          <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
        </a>
      </div>

      <button onClick={onLogout} data-testid="button-logout"
        className="w-full rounded-2xl bg-red-50 border border-red-100 p-4 flex items-center justify-center gap-2 text-red-600 font-medium hover:bg-red-100 transition-colors"
      >
        <LogOut className="w-4 h-4" /> Sign Out
      </button>

      <p className="text-center text-xs text-gray-300">Student Group Portal</p>
    </div>
  );
}

// ── Calendar helpers ───────────────────────────────────────────────────────────
const CAL_TYPE_DOT: Record<string, string> = {
  assignment: "bg-red-500", exam: "bg-orange-500", activity: "bg-green-500",
  holiday: "bg-blue-500", other: "bg-gray-400",
};
const CAL_TYPE_BADGE: Record<string, string> = {
  assignment: "bg-red-50 text-red-700 border-red-200",
  exam: "bg-orange-50 text-orange-700 border-orange-200",
  activity: "bg-green-50 text-green-700 border-green-200",
  holiday: "bg-blue-50 text-blue-700 border-blue-200",
  other: "bg-gray-50 text-gray-700 border-gray-200",
};
const CAL_TYPE_LABEL: Record<string, string> = {
  assignment: "Assignment", exam: "Exam", activity: "Activity", holiday: "Holiday", other: "Other",
};

function EventCard({ event }: { event: CalendarEvent }) {
  const badge = CAL_TYPE_BADGE[event.eventType] || CAL_TYPE_BADGE.other;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5 ${badge}`}>
          {CAL_TYPE_LABEL[event.eventType]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm">{event.title}</p>
          {event.startTime && (
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {event.startTime}{event.endTime ? ` – ${event.endTime}` : ""}
            </p>
          )}
          {event.description && <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{event.description}</p>}
          {event.fileName && (
            <a href={`/api/calendar/events/${event.id}/file`} target="_blank" rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-700 bg-purple-50 rounded-lg px-3 py-1.5 font-medium border border-purple-100">
              <Download className="w-3 h-3" /> {event.fileName}
            </a>
          )}
        </div>
        <p className="text-xs text-gray-400 flex-shrink-0">
          {new Date(event.eventDate + "T00:00:00").toLocaleDateString("default", { month: "short", day: "numeric" })}
        </p>
      </div>
    </div>
  );
}

// ── Calendar Tab ───────────────────────────────────────────────────────────────
function CalendarTab({ semester }: { semester?: string | null }) {
  const todayDate = new Date();
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const [viewYear, setViewYear] = React.useState(todayDate.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(todayDate.getMonth());
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);

  const semParam = semester && semester !== "" ? `?semester=${encodeURIComponent(semester)}` : "";
  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/events", semester ?? "all"],
    queryFn: async () => {
      const r = await fetch(`/api/calendar/events${semParam}`);
      if (!r.ok) throw new Error("Failed to load events");
      return r.json();
    },
  });

  const eventsByDate = React.useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      if (!map[ev.eventDate]) map[ev.eventDate] = [];
      map[ev.eventDate].push(ev);
    }
    return map;
  }, [events]);

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthName = new Date(viewYear, viewMonth).toLocaleString("default", { month: "long" });

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];

  const upcoming = React.useMemo(() => {
    const limit = new Date(todayDate);
    limit.setDate(limit.getDate() + 30);
    const limitStr = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, "0")}-${String(limit.getDate()).padStart(2, "0")}`;
    return events.filter(e => e.eventDate >= todayStr && e.eventDate <= limitStr);
  }, [events, todayStr]);

  const reminders = React.useMemo(() => {
    const tomorrow = new Date(todayDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(todayDate);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tomorrowStr = fmt(tomorrow);
    const dayAfterStr = fmt(dayAfter);

    return events
      .filter(e =>
        (e.eventType === "assignment" || e.eventType === "exam") &&
        (e.eventDate === todayStr || e.eventDate === tomorrowStr || e.eventDate === dayAfterStr)
      )
      .map(e => {
        let urgency: "today" | "tomorrow" | "2days";
        if (e.eventDate === todayStr) urgency = "today";
        else if (e.eventDate === tomorrowStr) urgency = "tomorrow";
        else urgency = "2days";
        return { ...e, urgency };
      })
      .sort((a, b) => {
        const order = { today: 0, tomorrow: 1, "2days": 2 };
        return order[a.urgency] - order[b.urgency];
      });
  }, [events, todayStr]);

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Reminder alerts for upcoming assignments & exams */}
      {reminders.length > 0 && (
        <div className="space-y-2">
          {reminders.map(r => {
            const isToday = r.urgency === "today";
            const label = isToday ? "TODAY" : r.urgency === "tomorrow" ? "TOMORROW" : "IN 2 DAYS";
            const typeLabel = r.eventType === "exam" ? "Exam" : "Assignment";
            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "rounded-2xl p-3.5 flex items-start gap-3 border shadow-sm",
                  isToday
                    ? "bg-red-50 border-red-200"
                    : "bg-orange-50 border-orange-200"
                )}
                data-testid={`reminder-${r.id}`}
              >
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
                  isToday ? "bg-red-500" : "bg-orange-500"
                )}>
                  <AlertTriangle className="w-4.5 h-4.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn(
                      "text-[10px] font-black tracking-wider uppercase px-1.5 py-0.5 rounded",
                      isToday ? "bg-red-500 text-white" : "bg-orange-500 text-white"
                    )}>
                      {label}
                    </span>
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border",
                      r.eventType === "exam"
                        ? "bg-orange-50 text-orange-700 border-orange-200"
                        : "bg-red-50 text-red-700 border-red-200"
                    )}>
                      {typeLabel}
                    </span>
                  </div>
                  <p className={cn(
                    "text-sm font-bold mt-1",
                    isToday ? "text-red-800" : "text-orange-800"
                  )}>{r.title}</p>
                  {r.startTime && (
                    <p className={cn("text-xs mt-0.5 flex items-center gap-1", isToday ? "text-red-600" : "text-orange-600")}>
                      <Clock className="w-3 h-3" /> {r.startTime}{r.endTime ? ` – ${r.endTime}` : ""}
                    </p>
                  )}
                  {r.description && (
                    <p className={cn("text-xs mt-1 leading-relaxed", isToday ? "text-red-700/80" : "text-orange-700/80")}>{r.description}</p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Calendar card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Month nav */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" data-testid="button-cal-prev">
            <ChevronRight className="w-4 h-4 rotate-180 text-gray-600" />
          </button>
          <span className="font-semibold text-gray-800">{monthName} {viewYear}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" data-testid="button-cal-next">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-50">
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-2">{d}</div>
          ))}
        </div>
        {/* Day grid */}
        <div className="grid grid-cols-7 gap-px p-1">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const ds = `${viewYear}-${String(viewMonth + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const isToday = ds === todayStr;
            const isSel = ds === selectedDate;
            const dots = [...new Set((eventsByDate[ds] || []).map(e => e.eventType))].slice(0, 3);
            const hasReminder = reminders.some(r => r.eventDate === ds);
            return (
              <button key={day} onClick={() => setSelectedDate(isSel ? null : ds)} data-testid={`cal-day-${ds}`}
                className={cn(
                  "relative flex flex-col items-center py-1 px-0.5 rounded-xl transition-colors",
                  isSel ? "bg-purple-600" : hasReminder ? "bg-red-50 ring-2 ring-red-400 ring-offset-1" : isToday ? "bg-purple-50" : "hover:bg-gray-50"
                )}
              >
                {hasReminder && !isSel && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                )}
                <span className={cn(
                  "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full",
                  isSel ? "text-white" : hasReminder ? "text-red-700 font-bold" : isToday ? "text-purple-700 font-bold" : "text-gray-700"
                )}>{day}</span>
                {dots.length > 0 && (
                  <div className="flex gap-0.5 mb-0.5">
                    {dots.map(t => <span key={t} className={`w-1.5 h-1.5 rounded-full ${isSel ? "bg-white/70" : CAL_TYPE_DOT[t]}`} />)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {/* Legend */}
        <div className="px-4 pb-3 pt-1 border-t border-gray-50 flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(CAL_TYPE_LABEL).map(([type, label]) => (
            <span key={type} className="flex items-center gap-1 text-xs text-gray-500">
              <span className={`w-2 h-2 rounded-full ${CAL_TYPE_DOT[type]}`} /> {label}
            </span>
          ))}
        </div>
      </div>

      {/* Selected day events */}
      {selectedDate && (
        <div className="space-y-3">
          <h3 className="font-semibold text-gray-700 text-sm px-1">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("default", { weekday: "long", month: "long", day: "numeric" })}
          </h3>
          {selectedEvents.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-sm text-gray-400">No events on this day</div>
          ) : selectedEvents.map(ev => <EventCard key={ev.id} event={ev} />)}
        </div>
      )}

      {/* Upcoming events (next 30 days) */}
      {!selectedDate && upcoming.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-gray-700 text-sm px-1 flex items-center gap-2">
            <Bell className="w-4 h-4 text-purple-500" /> Upcoming — Next 30 Days
          </h3>
          {upcoming.map(ev => <EventCard key={ev.id} event={ev} />)}
        </div>
      )}

      {/* Empty state */}
      {events.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <Calendar className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No events scheduled</p>
          <p className="text-sm text-gray-400 mt-1">Your instructor hasn't posted any events yet</p>
        </div>
      )}
    </div>
  );
}

// ── Virtual Room Tab ───────────────────────────────────────────────────────────
interface AiExplanation {
  title?: string;
  summary?: string;
  keyPoints?: { heading: string; detail: string }[];
  realWorldExample?: string;
  quickFact?: string;
  searchQueries?: string[];
}

interface YtVideo {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

function VirtualRoomTab({ student }: { student: { token: string } }) {
  const [topic, setTopic] = React.useState("");
  const [inputVal, setInputVal] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [explanation, setExplanation] = React.useState<AiExplanation | null>(null);
  const [error, setError] = React.useState("");
  const [videos, setVideos] = React.useState<YtVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = React.useState(false);
  const [playingVideo, setPlayingVideo] = React.useState<YtVideo | null>(null);
  const { toast } = useToast();

  const fetchVideos = async (query: string) => {
    setLoadingVideos(true);
    try {
      const res = await fetch(`/api/student/virtual-room/videos?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${student.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.videos)) setVideos(data.videos);
      }
    } catch { /* silently fail — videos are optional */ }
    finally { setLoadingVideos(false); }
  };

  const handleSearch = async (searchTopic?: string) => {
    const q = (searchTopic ?? inputVal).trim();
    if (!q) return;
    setLoading(true);
    setError("");
    setExplanation(null);
    setVideos([]);
    setPlayingVideo(null);
    setTopic(q);
    try {
      const res = await fetch("/api/student/virtual-room/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${student.token}` },
        body: JSON.stringify({ topic: q }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      const data: AiExplanation = await res.json();
      setExplanation(data);
      const videoQuery = data.searchQueries?.[0] || q;
      fetchVideos(videoQuery + " explained tutorial");
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 p-4 text-white">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <Tv className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-base">Virtual Study Room</h2>
            <p className="text-xs text-violet-200">AI explanations + video lessons on any topic</p>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex gap-2 mt-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-300 pointer-events-none" />
            <input
              className="w-full bg-white/15 border border-white/30 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-violet-300 outline-none focus:bg-white/25 transition-colors"
              placeholder="Type any study topic…"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              data-testid="input-virtual-room-topic"
            />
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={loading || !inputVal.trim()}
            className="bg-white text-violet-700 rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-violet-50 transition-colors flex-shrink-0"
            data-testid="button-virtual-room-search"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "Thinking…" : "Explain"}
          </button>
        </div>
      </div>

      {/* Play Room — interactive AI roleplay */}
      <StudyPlayRoom student={student} />

      {/* Suggested topics */}
      {!explanation && !loading && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Try a topic</p>
          <div className="flex flex-wrap gap-2">
            {["Supply & Demand", "Machine Learning", "DNA Replication", "French Revolution", "Ohm's Law", "Cash Flow Statement", "Newton's Laws"].map(t => (
              <button
                key={t}
                onClick={() => { setInputVal(t); handleSearch(t); }}
                className="text-xs bg-violet-50 text-violet-700 border border-violet-100 rounded-full px-3 py-1.5 font-medium hover:bg-violet-100 transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="rounded-2xl border border-violet-100 bg-violet-50 p-8 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white animate-pulse" />
          </div>
          <p className="font-semibold text-violet-800 text-sm">AI is preparing your explanation…</p>
          <p className="text-xs text-violet-500">Finding the best way to explain "{topic}"</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex gap-3 items-start">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div><p className="font-semibold text-red-700 text-sm">Couldn't load explanation</p><p className="text-xs text-red-500 mt-0.5">{error}</p></div>
        </div>
      )}

      {/* AI Explanation */}
      {explanation && !loading && (
        <div className="space-y-3">
          {/* Title + Summary */}
          <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-violet-600 flex-shrink-0" />
              <span className="text-xs font-bold text-violet-600 uppercase tracking-wider">AI Explanation</span>
            </div>
            <h3 className="font-bold text-gray-900 text-base mb-2">{explanation.title || topic}</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{explanation.summary}</p>
          </div>

          {/* Key Points */}
          {explanation.keyPoints && explanation.keyPoints.length > 0 && (
            <div className="rounded-2xl bg-white border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Key Points</span>
              </div>
              <div className="space-y-3">
                {explanation.keyPoints.map((kp, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{kp.heading}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{kp.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Real-world example */}
          {explanation.realWorldExample && (
            <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Real-World Example</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{explanation.realWorldExample}</p>
            </div>
          )}

          {/* Quick Fact */}
          {explanation.quickFact && (
            <div className="rounded-2xl bg-green-50 border border-green-100 p-3 flex gap-3">
              <Star className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Quick Fact</p>
                <p className="text-sm text-gray-700">{explanation.quickFact}</p>
              </div>
            </div>
          )}

          {/* Video Player — inline embedded */}
          {playingVideo && (
            <div className="rounded-2xl overflow-hidden shadow-lg border border-gray-200">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-900">
                <div className="flex-1 min-w-0 mr-2">
                  <p className="text-xs font-semibold text-white truncate">{playingVideo.title}</p>
                  <p className="text-[10px] text-gray-400 truncate">{playingVideo.channel}</p>
                </div>
                <button
                  onClick={() => setPlayingVideo(null)}
                  className="text-gray-400 hover:text-white p-1"
                  data-testid="close-video-player"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative w-full bg-black" style={{ paddingBottom: "56.25%" }}>
                <iframe
                  key={playingVideo.videoId}
                  src={`https://www.youtube.com/embed/${playingVideo.videoId}?rel=0&modestbranding=1`}
                  className="absolute inset-0 w-full h-full border-0"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  title={playingVideo.title}
                  data-testid="youtube-player-iframe"
                />
              </div>
              <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                <a
                  href={`https://www.youtube.com/watch?v=${playingVideo.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-gray-400 hover:text-red-500 flex items-center gap-1"
                  data-testid="open-in-youtube-link"
                >
                  <PlayCircle className="w-3 h-3" />
                  Having trouble? Open directly on YouTube
                </a>
              </div>
            </div>
          )}

          {/* Video Lessons Section */}
          <div className="rounded-2xl bg-white border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <PlayCircle className="w-4 h-4 text-red-500" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Video Lessons</span>
            </div>

            {loadingVideos && (
              <div className="flex items-center gap-2 py-6 justify-center text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Finding videos...</span>
              </div>
            )}

            {!loadingVideos && videos.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No videos found for this topic</p>
            )}

            {videos.length > 0 && (
              <div className="space-y-2">
                {videos.map((v, i) => (
                  <button
                    key={v.videoId}
                    onClick={() => setPlayingVideo(v)}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-xl border w-full text-left transition-all",
                      playingVideo?.videoId === v.videoId
                        ? "border-red-300 bg-red-50 ring-1 ring-red-200"
                        : "border-gray-100 bg-gray-50 hover:bg-red-50 hover:border-red-100"
                    )}
                    data-testid={`video-card-${i}`}
                  >
                    <div className="relative w-24 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                      <img src={v.thumbnail} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <PlayCircle className="w-6 h-6 text-white drop-shadow" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-snug">{v.title}</p>
                      <p className="text-[10px] text-gray-400 mt-1 truncate">{v.channel}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {explanation.searchQueries && explanation.searchQueries.length > 1 && (
              <div className="mt-3 pt-3 border-t border-gray-50">
                <p className="text-[10px] text-gray-400 mb-2 font-medium uppercase tracking-wider">More searches</p>
                <div className="flex flex-wrap gap-1.5">
                  {explanation.searchQueries.slice(1).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => { setPlayingVideo(null); fetchVideos(q); }}
                      className="text-[11px] rounded-full px-3 py-1.5 font-medium bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600 border border-gray-200 hover:border-red-200 transition-colors"
                      data-testid={`video-search-chip-${i}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Search another topic */}
          <button
            onClick={() => { setExplanation(null); setTopic(""); setInputVal(""); }}
            className="w-full text-sm text-violet-600 font-medium py-3 rounded-2xl border border-violet-100 bg-violet-50 hover:bg-violet-100 transition-colors"
          >
            Search Another Topic
          </button>
        </div>
      )}
    </div>
  );
}

// ── Study Play Room ──────────────────────────────────────────────────────────
// Interactive AI roleplay tutor. Student picks a topic → AI runs a scenario
// where the student plays a role and applies the concept. Stateless on the
// server — chat history is kept here and sent each turn.
type PlayMsg = { role: "user" | "assistant"; content: string };

// Parses the AI's mandatory [[META]]{...}[[/META]] block out of a reply.
// Returns the cleaned narrative + parsed meta. Defensive: if the block is
// missing or malformed, we degrade gracefully so the chat still works.
type PlayMeta = { xp: number; choices: string[]; badge: string; title: string };
function parsePlayMeta(raw: string): { narrative: string; meta: PlayMeta } {
  const fallback: PlayMeta = { xp: 0, choices: [], badge: "", title: "" };
  // Match ALL meta blocks (the model occasionally emits more than one).
  // We strip every block from the narrative and parse the LAST valid one,
  // because that's the most up-to-date state for the turn.
  const re = /\[\[META\]\]([\s\S]+?)\[\[\/META\]\]/g;
  const matches = [...raw.matchAll(re)];
  if (matches.length === 0) return { narrative: raw.trim(), meta: fallback };
  const narrative = raw.replace(re, "").trim();
  // Try blocks from last to first; first one that parses cleanly wins.
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(matches[i][1]);
      return {
        narrative,
        meta: {
          xp: typeof parsed.xp === "number" ? Math.max(0, Math.min(25, parsed.xp)) : 0,
          choices: Array.isArray(parsed.choices) ? parsed.choices.filter((c: any) => typeof c === "string").slice(0, 3) : [],
          badge: typeof parsed.badge === "string" ? parsed.badge.trim() : "",
          title: typeof parsed.title === "string" ? parsed.title.trim() : "",
        },
      };
    } catch { /* try next */ }
  }
  return { narrative, meta: fallback };
}

function StudyPlayRoom({ student }: { student: { token: string } }) {
  const [open, setOpen] = React.useState(false);
  const [topic, setTopic] = React.useState("");
  const [topicInput, setTopicInput] = React.useState("");
  const [messages, setMessages] = React.useState<PlayMsg[]>([]);
  const [draft, setDraft] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  // Engagement state (Self-Determination Theory + variable rewards).
  // xp starts at 5 (endowed-progress effect — students push harder when the
  // bar isn't empty). Level = floor(xp / 100) + 1.
  const [xp, setXp] = React.useState(5);
  const [title, setTitle] = React.useState("Novice");
  const [badges, setBadges] = React.useState<string[]>([]);
  const [choices, setChoices] = React.useState<string[]>([]);
  const [streak, setStreak] = React.useState(0);
  const [xpBurst, setXpBurst] = React.useState<number | null>(null);
  const [newBadge, setNewBadge] = React.useState<string | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  const PRESETS = [
    "Supply & Demand", "Photosynthesis", "Negotiating a Salary",
    "French Revolution", "Compound Interest", "Newton's 3rd Law",
    "Marketing a Startup", "Climate Change Policy",
  ];

  const level = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;

  React.useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, loading]);

  // Auto-clear XP burst + badge popups (variable-reward dopamine moment).
  React.useEffect(() => {
    if (xpBurst === null) return;
    const t = setTimeout(() => setXpBurst(null), 1500);
    return () => clearTimeout(t);
  }, [xpBurst]);
  React.useEffect(() => {
    if (!newBadge) return;
    const t = setTimeout(() => setNewBadge(null), 3500);
    return () => clearTimeout(t);
  }, [newBadge]);

  // Single in-flight turn at a time. `gameIdRef` is bumped on every reset/new
  // game so a late-arriving response from a previous game cannot overwrite
  // the new game's state (race-condition guard).
  const inFlightRef = React.useRef(false);
  const gameIdRef = React.useRef(0);
  async function callTurn(currentTopic: string, history: PlayMsg[], userMessage?: string) {
    if (inFlightRef.current) return;
    const myGameId = gameIdRef.current;
    inFlightRef.current = true;
    setLoading(true);
    setChoices([]);  // hide stale choice chips while the next turn loads
    if (userMessage) setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    try {
      const res = await fetch("/api/student/study-play/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${student.token}` },
        body: JSON.stringify({ topic: currentTopic, history, userMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "AI request failed");
      // If the user reset / started a new game while we were waiting, drop this reply.
      if (myGameId !== gameIdRef.current) return;
      const { narrative, meta } = parsePlayMeta(data.reply);
      setMessages(prev => [...prev, { role: "assistant", content: narrative }]);
      // Apply engagement updates. All updates use functional setState so they
      // are safe against any stale-closure / interleaving issues.
      if (meta.xp > 0) {
        setXp(prev => prev + meta.xp);
        setXpBurst(meta.xp);
        setStreak(s => s + 1);
      }
      if (meta.title) setTitle(meta.title);
      if (meta.badge) {
        setBadges(prev => {
          if (prev.includes(meta.badge)) return prev;
          // Only fire the celebration banner the first time we see this badge.
          setNewBadge(meta.badge);
          return [...prev, meta.badge];
        });
      }
      setChoices(meta.choices);
    } catch (e: any) {
      if (myGameId !== gameIdRef.current) return;  // ignore errors from abandoned games too
      if (userMessage) setMessages(prev => {
        const last = prev[prev.length - 1];
        return last && last.role === "user" && last.content === userMessage ? prev.slice(0, -1) : prev;
      });
      toast({ title: "Game master unavailable", description: e.message, variant: "destructive" });
    } finally {
      inFlightRef.current = false;
      if (myGameId === gameIdRef.current) setLoading(false);
    }
  }

  function startGame(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    gameIdRef.current += 1;  // any in-flight reply for an old game will be discarded
    inFlightRef.current = false;
    setTopic(trimmed);
    setTopicInput(trimmed);
    setMessages([]);
    setDraft("");
    setXp(5);            // endowed-progress reset
    setTitle("Novice");
    setBadges([]);
    setChoices([]);
    setStreak(0);
    setLoading(false);
    callTurn(trimmed, []);
  }

  function sendTurn(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    if (!text || loading || !topic) return;
    if (!textOverride) setDraft("");
    callTurn(topic, messages, text);
  }

  function resetGame() {
    gameIdRef.current += 1;  // discard any late reply from the abandoned game
    inFlightRef.current = false;
    setTopic("");
    setMessages([]);
    setDraft("");
    setChoices([]);
    setBadges([]);
    setXp(5);
    setTitle("Novice");
    setStreak(0);
    setLoading(false);
  }

  // Very lightweight markdown-ish renderer (bold + italic + line breaks).
  function renderRich(text: string) {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let last = 0; let m: RegExpExecArray | null; let i = 0;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("**")) parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
      else parts.push(<em key={i++} className="text-violet-700">{tok.slice(1, -1)}</em>);
      last = m.index + tok.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.map((p, idx) =>
      typeof p === "string"
        ? <React.Fragment key={`s${idx}`}>{p.split("\n").map((line, li, arr) => <React.Fragment key={li}>{line}{li < arr.length - 1 && <br />}</React.Fragment>)}</React.Fragment>
        : p
    );
  }

  return (
    <div className="rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-pink-50 overflow-hidden" data-testid="card-study-play">
      {/* Header / launcher */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-fuchsia-50/60 transition-colors"
        data-testid="button-toggle-play-room"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 flex items-center justify-center flex-shrink-0 shadow">
          <Gamepad2 className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-gray-900">Play Room</h3>
            <Badge className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-100 text-[10px] px-1.5 py-0">NEW</Badge>
          </div>
          <p className="text-xs text-gray-500 truncate">Learn a topic by playing it — AI runs a live scenario.</p>
        </div>
        <ChevronDown className={cn("w-5 h-5 text-fuchsia-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-fuchsia-100 p-3 space-y-3">
          {!topic && (
            <>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-white border border-fuchsia-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-fuchsia-400"
                  placeholder="Enter a topic… e.g. Supply & Demand"
                  value={topicInput}
                  onChange={e => setTopicInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && startGame(topicInput)}
                  data-testid="input-play-topic"
                />
                <button
                  onClick={() => startGame(topicInput)}
                  disabled={!topicInput.trim() || loading}
                  className="bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-1.5 disabled:opacity-50 hover:opacity-90 transition-opacity"
                  data-testid="button-start-play"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {loading ? "Loading…" : "Start"}
                </button>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-1">Pick a quick scenario</p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map(p => (
                    <button
                      key={p}
                      onClick={() => startGame(p)}
                      disabled={loading}
                      className="text-[11px] bg-white border border-fuchsia-200 text-fuchsia-700 rounded-full px-2.5 py-1 font-medium hover:bg-fuchsia-100 transition-colors disabled:opacity-50"
                      data-testid={`chip-play-preset-${p.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {topic && (
            <>
              <div className="flex items-center gap-2 px-1">
                <Badge className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-100 text-[10px]">TOPIC</Badge>
                <p className="text-xs font-semibold text-gray-700 truncate flex-1" data-testid="text-play-topic">{topic}</p>
                <button
                  onClick={resetGame}
                  className="text-[11px] text-gray-500 hover:text-fuchsia-600 flex items-center gap-1 font-medium"
                  data-testid="button-reset-play"
                >
                  <RotateCcw className="w-3 h-3" /> New game
                </button>
              </div>

              {/* Engagement HUD — XP bar + level + title + streak.
                  Endowed-progress effect: students push harder when bar is non-empty. */}
              <div className="rounded-xl bg-gradient-to-r from-fuchsia-100 via-pink-100 to-amber-50 border border-fuchsia-200 p-2.5 space-y-1.5 relative overflow-hidden">
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className="flex items-center gap-1.5 text-fuchsia-800" data-testid="text-play-title">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-600 text-white text-[10px]">{level}</span>
                    {title}
                  </span>
                  <span className="flex items-center gap-2 text-amber-700">
                    {streak > 1 && (
                      <span className="flex items-center gap-0.5" data-testid="text-play-streak" title="Turn streak">
                        🔥 {streak}
                      </span>
                    )}
                    <span data-testid="text-play-xp">{xp} XP</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/60 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-fuchsia-500 to-pink-500 transition-all duration-500"
                    style={{ width: `${xpInLevel}%` }}
                  />
                </div>
                {xpBurst !== null && (
                  <div
                    className="absolute right-2 top-1 text-amber-600 font-bold text-sm pointer-events-none animate-bounce"
                    data-testid="text-xp-burst"
                  >
                    +{xpBurst} XP
                  </div>
                )}
              </div>

              {/* Earned badges (social proof + collection mechanic) */}
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1" data-testid="container-play-badges">
                  {badges.map((b, i) => (
                    <span
                      key={i}
                      className="text-[10px] bg-amber-100 border border-amber-300 text-amber-800 rounded-full px-2 py-0.5 font-semibold"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              )}

              {/* Surprise badge celebration (variable-reward dopamine pop) */}
              {newBadge && (
                <div
                  className="rounded-xl bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-200 border-2 border-amber-400 p-2.5 text-center font-bold text-amber-900 text-sm animate-pulse"
                  data-testid="banner-new-badge"
                >
                  🎉 New badge unlocked: <span className="font-extrabold">{newBadge}</span>
                </div>
              )}

              <div
                ref={scrollerRef}
                className="bg-white border border-fuchsia-100 rounded-xl p-3 max-h-[420px] overflow-y-auto space-y-2.5"
                data-testid="container-play-messages"
              >
                {messages.length === 0 && loading && (
                  <div className="flex items-center gap-2 text-sm text-fuchsia-600 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Setting the scene…</span>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-2xl px-3 py-2 text-sm leading-relaxed max-w-[88%]",
                      m.role === "assistant"
                        ? "bg-fuchsia-50 border border-fuchsia-100 text-gray-800"
                        : "bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white ml-auto"
                    )}
                    data-testid={`message-${m.role}-${i}`}
                  >
                    {m.role === "assistant" && (
                      <div className="flex items-center gap-1 mb-1">
                        <Gamepad2 className="w-3 h-3 text-fuchsia-600" />
                        <span className="text-[10px] font-bold text-fuchsia-600 uppercase tracking-wider">Game Master</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{renderRich(m.content)}</div>
                  </div>
                ))}
                {loading && messages.length > 0 && (
                  <div className="bg-fuchsia-50 border border-fuchsia-100 rounded-2xl px-3 py-2 max-w-[88%] flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-fuchsia-600" />
                    <span className="text-xs text-fuchsia-600">Game master is thinking…</span>
                  </div>
                )}
              </div>

              {/* Choice chips — choice architecture from Self-Determination Theory.
                  Reduces friction (no typing) while preserving autonomy (free-text still works). */}
              {choices.length > 0 && !loading && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">Quick actions</p>
                  <div className="flex flex-col gap-1.5">
                    {choices.map((c, i) => (
                      <button
                        key={i}
                        onClick={() => sendTurn(c)}
                        disabled={loading}
                        className="text-left text-xs bg-white border border-fuchsia-200 hover:border-fuchsia-400 hover:bg-fuchsia-50 text-gray-800 rounded-xl px-3 py-2 font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                        data-testid={`button-play-choice-${i}`}
                      >
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-100 text-fuchsia-700 text-[10px] font-bold flex-shrink-0">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="flex-1">{c}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  className="flex-1 bg-white border border-fuchsia-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-fuchsia-400 disabled:opacity-50"
                  placeholder={loading ? "Wait for the game master…" : "Or type your own move…"}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendTurn())}
                  disabled={loading}
                  data-testid="input-play-message"
                />
                <button
                  onClick={() => sendTurn()}
                  disabled={!draft.trim() || loading}
                  className="bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white rounded-xl px-3 py-2.5 disabled:opacity-50 hover:opacity-90 transition-opacity"
                  data-testid="button-send-play"
                  aria-label="Send"
                >
                  <SendIcon className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[10px] text-gray-400 text-center">Tip: type <span className="font-mono">end</span> to wrap up & get a debrief.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bottom Navigation ─────────────────────────────────────────────────────────
// Bottom nav kept lean (5 items) so labels don't merge on small screens.
// Storage / Notices / Notes are still reachable via the Home dashboard quick actions.
const NAV_ITEMS: { tab: Tab; icon: React.ReactNode; label: string }[] = [
  { tab: "home", icon: <Home className="w-5 h-5" />, label: "Home" },
  { tab: "virtual-room", icon: <Tv className="w-5 h-5" />, label: "Study" },
  { tab: "library", icon: <BookOpen className="w-5 h-5" />, label: "Books" },
  { tab: "calendar", icon: <Calendar className="w-5 h-5" />, label: "Calendar" },
  { tab: "profile", icon: <User className="w-5 h-5" />, label: "Profile" },
];

// ── Messages bell (shows unread reply count from admin) ──────────────────────
function MessagesBellButton({ onClick }: { onClick: () => void }) {
  const { data: messages } = useQuery<Array<{ isReadByStudent: boolean; adminReply: string | null }>>({
    queryKey: ["/api/student/messages"],
    queryFn: async () => {
      try {
        const s = JSON.parse(localStorage.getItem("student_session") || "null");
        if (!s?.token) return [];
        const r = await fetch("/api/student/messages", { headers: { Authorization: `Bearer ${s.token}` } });
        if (!r.ok) return [];
        return r.json();
      } catch { return []; }
    },
    refetchInterval: 60_000,
  });
  const unread = (messages || []).filter(m => !m.isReadByStudent && m.adminReply).length;
  return (
    <button onClick={onClick} className="relative p-1" data-testid="button-messages-bell">
      <MessageSquare className="w-5 h-5 text-gray-400" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-violet-600 rounded-full text-white text-xs flex items-center justify-center font-bold">
          {Math.min(unread, 9)}
        </span>
      )}
    </button>
  );
}

// ── Auth Gate (shown at /student-portal when not logged in) ───────────────────
function AuthGate() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50 flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <GraduationCap className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Student Portal</h1>
          <p className="text-gray-500 text-sm mt-1">Your personal academic dashboard</p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {[
            { icon: <Users className="w-5 h-5" />, label: "My Group", color: "from-violet-500 to-purple-600" },
            { icon: <Megaphone className="w-5 h-5" />, label: "Notices", color: "from-blue-500 to-indigo-600" },
            { icon: <Calendar className="w-5 h-5" />, label: "Calendar", color: "from-purple-500 to-violet-600" },
            { icon: <HardDrive className="w-5 h-5" />, label: "Cloud Storage", color: "from-teal-500 to-cyan-600" },
            { icon: <StickyNote className="w-5 h-5" />, label: "Notes", color: "from-amber-500 to-orange-500" },
            { icon: <User className="w-5 h-5" />, label: "Profile", color: "from-emerald-500 to-teal-600" },
          ].map((item, i, arr) => (
            <div key={item.label} className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3${i === arr.length - 1 && arr.length % 2 !== 0 ? " col-span-2" : ""}`}>
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center text-white flex-shrink-0`}>
                {item.icon}
              </div>
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <Button
            onClick={() => navigate("/student-login")}
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-base shadow-md hover:shadow-lg transition-shadow"
            data-testid="button-sign-in"
          >
            <LogOut className="w-5 h-5 mr-2 rotate-180" /> Sign In to Continue
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="w-full h-11 rounded-2xl border-gray-200 text-gray-600 gap-2"
            data-testid="button-back-home"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </Button>
        </div>
        <p className="text-center text-xs text-gray-400 mt-6">Sign in with your Student ID and password</p>
      </motion.div>
    </div>
  );
}

// ── Main Portal Page ──────────────────────────────────────────────────────────
export default function StudentPortal() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = React.useState<Tab>("home");
  const { toast } = useToast();

  // Re-read from localStorage on each render so it's fresh after login redirect
  const [student, setStudent] = React.useState(() => getStoredStudent());

  // Refresh session state when component mounts/re-mounts
  React.useEffect(() => {
    const s = getStoredStudent();
    setStudent(s);
  }, []);

  React.useEffect(() => {
    if (!student?.token) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const res = await fetch("/api/push/vapid-key");
        const { publicKey } = await res.json();
        if (!publicKey) return;

        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const existing = await reg.pushManager.getSubscription();
        const sub = existing || await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        const subJson = sub.toJSON();
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${student.token}`,
          },
          body: JSON.stringify({
            endpoint: subJson.endpoint,
            keys: subJson.keys,
          }),
        });
      } catch (err) {
        console.error("Push subscription error:", err);
      }
    })();
  }, [student?.token]);

  const { data: project } = useQuery<Project | null>({
    queryKey: ["/api/projects/active"],
    enabled: !!student,
    queryFn: async () => {
      const r = await fetch("/api/projects/active");
      if (r.status === 404) return null;
      return r.json();
    },
    staleTime: 30000,
  });

  const { data: announcements = [] } = useQuery<Announcement[]>({
    queryKey: ["/api/announcements"],
    enabled: !!student,
    queryFn: async () => {
      const r = await fetch("/api/announcements");
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60000,
  });

  const { data: myGroup } = useQuery<GroupData | null>({
    queryKey: ["/api/student/my-submission", project?.id],
    enabled: !!project?.id && !!student,
    queryFn: async () => {
      const r = await fetch(`/api/student/my-submission?projectId=${project!.id}`, {
        headers: { Authorization: `Bearer ${student!.token}` },
      });
      if (r.status === 404) return null;
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
    staleTime: 30000,
  });

  const handleLogout = async () => {
    if (student?.token) {
      await fetch("/api/student/logout", { method: "POST", headers: { Authorization: `Bearer ${student.token}` } }).catch(() => {});
    }
    localStorage.removeItem("student_session");
    setStudent(null);
    toast({ title: "Signed out successfully" });
    navigate("/student-login");
  };

  // Show auth gate instead of blank screen when not logged in
  if (!student) return <AuthGate />;

  const tabTitles: Record<Tab, string> = {
    home: "Dashboard",
    group: "My Group",
    calendar: "Calendar",
    files: "My Storage",
    announcements: "Announcements",
    notes: "My Notes",
    profile: "Profile",
    "virtual-room": "Study Room",
    library: "Library",
    messages: "Messages",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-20 shadow-sm">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
          <GraduationCap className="w-4 h-4 text-white" />
        </div>
        <h1 className="font-semibold text-gray-800">{tabTitles[activeTab]}</h1>
        <div className="ml-auto flex items-center gap-1">
          {activeTab !== "messages" && (
            <MessagesBellButton onClick={() => setActiveTab("messages")} />
          )}
          {announcements.length > 0 && activeTab !== "announcements" && (
            <button onClick={() => setActiveTab("announcements")} className="relative p-1" data-testid="button-announcements-bell">
              <Bell className="w-5 h-5 text-gray-400" />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">{Math.min(announcements.length, 9)}</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 max-w-lg mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {activeTab === "home" && (
              <HomeTab student={student} project={project ?? null} announcements={announcements} hasGroup={!!myGroup} onNavigate={setActiveTab} />
            )}
            {activeTab === "group" && (
              <MyGroupTab student={student} project={project ?? null} />
            )}
            {activeTab === "files" && <FilesTab student={student} project={project ?? null} />}
            {activeTab === "calendar" && <CalendarTab semester={student.semester} />}
            {activeTab === "announcements" && <AnnouncementsTab announcements={announcements} />}
            {activeTab === "notes" && <NotesTab />}
            {activeTab === "profile" && <ProfileTab student={student} onLogout={handleLogout} />}
            {activeTab === "virtual-room" && <VirtualRoomTab student={student} />}
            {activeTab === "library" && <LibraryTab studentToken={student.token} />}
            {activeTab === "messages" && <MessagesTab />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom navigation */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 shadow-lg z-20">
        <div className="flex max-w-lg mx-auto">
          {NAV_ITEMS.map(item => {
            const active = activeTab === item.tab;
            const badge = item.tab === "announcements" && announcements.length > 0;
            return (
              <button key={item.tab} onClick={() => setActiveTab(item.tab)} data-testid={`nav-${item.tab}`}
                className={cn("flex-1 flex flex-col items-center gap-1 py-3 relative transition-colors", active ? "text-purple-600" : "text-gray-400 hover:text-gray-600")}
              >
                {badge && !active && (
                  <span className="absolute top-2 right-[calc(50%-10px)] w-2 h-2 bg-red-500 rounded-full" />
                )}
                <span className={cn("transition-all", active ? "scale-110" : "")}>{item.icon}</span>
                <span className="text-xs font-medium">{item.label}</span>
                {active && <span className="absolute bottom-0 inset-x-4 h-0.5 bg-purple-600 rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
