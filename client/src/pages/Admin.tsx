import * as React from "react";
import {
  Users,
  Search,
  Download,
  Trash2,
  Plus,
  AlertCircle,
  Loader2,
  PieChart,
  UserPlus,
  RefreshCcw,
  Lock,
  LayoutDashboard,
  LogOut,
  Edit,
  Clock as ClockIcon,
  BookOpen,
  MoreVertical,
  X,
  Sparkles,
  Send,
  ShieldCheck,
  Eye,
  EyeOff,
  Pencil,
  FileDown,
  FolderPlus,
  Folder,
  CheckCircle2,
  HelpCircle,
  Settings as SettingsIcon,
  KeyRound,
  ChevronDown,
  UploadCloud,
  GraduationCap,
  MailCheck,
  MailX,
  BadgeCheck,
  Megaphone,
  Inbox,
  AlertTriangle,
  Info,
  Star,
  Bell,
  CalendarDays,
  Upload,
  Paperclip,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGroups, useStats, useDeleteGroup, useTopics } from "@/hooks/use-groups";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AdminAIChat } from "@/components/AdminAIChat";
import { CredentialsPanel } from "@/components/admin/CredentialsPanel";
import { MessagesPanel } from "@/components/admin/MessagesPanel";
import { useQuery } from "@tanstack/react-query";

type AdminRole = "admin" | "viewer" | "editor" | "downloader";

const ROLE_LABELS: Record<string, { label: string; color: string; icon: React.ElementType; perms: string }> = {
  admin:      { label: "Admin",      color: "bg-purple-100 text-purple-700", icon: ShieldCheck, perms: "Full access" },
  viewer:     { label: "Viewer",     color: "bg-blue-100 text-blue-700",    icon: Eye,         perms: "View groups & stats only" },
  editor:     { label: "Editor",     color: "bg-green-100 text-green-700",  icon: Pencil,      perms: "View + Edit & delete groups" },
  downloader: { label: "Downloader", color: "bg-orange-100 text-orange-700", icon: FileDown,   perms: "View + Download Excel export" },
};

export default function Admin() {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [adminRole, setAdminRole] = React.useState<AdminRole>("admin");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loginError, setLoginError] = React.useState("");
  const [newDeadlineHours, setNewDeadlineHours] = React.useState("");
  const [newDeadlineMinutes, setNewDeadlineMinutes] = React.useState("");
  // Per-project deadline inline editor: projectId → datetime-local string being edited
  const [projectDeadlineEdits, setProjectDeadlineEdits] = React.useState<Record<number, string>>({});
  const [projectDeadlineSaving, setProjectDeadlineSaving] = React.useState<number | null>(null);
  const [rules, setRules] = React.useState("");
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [projectName, setProjectName] = React.useState("");
  const [memberCount, setMemberCount] = React.useState("");
  const [newTopicName, setNewTopicName] = React.useState("");
  const [editingTopic, setEditingTopic] = React.useState<any>(null);
  const [editingGroup, setEditingGroup] = React.useState<any>(null);
  // Admin-side "Create Group" dialog. Same shape as editingGroup but with
  // no `id` and an explicit `projectId` (defaults to active project).
  const [creatingGroup, setCreatingGroup] = React.useState<{
    projectId: number | null;
    members: Array<{ name: string; studentId: string; role: "leader" | "member"; topicId: number | null }>;
  } | null>(null);
  const [createSaving, setCreateSaving] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("dashboard");
  // Dashboard project filter ("all" / number / "none")
  const [groupsProjectFilter, setGroupsProjectFilter] = React.useState<string>("all");
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [isAiLoading, setIsAiLoading] = React.useState(false);
  const [aiChatOpen, setAiChatOpen] = React.useState(false);

  // Staff management state
  const [staffList, setStaffList] = React.useState<Array<{ username: string; role: string }>>([]);
  const [newStaffUsername, setNewStaffUsername] = React.useState("");
  const [newStaffPassword, setNewStaffPassword] = React.useState("");
  const [newStaffRole, setNewStaffRole] = React.useState("viewer");
  const [isAddingStaff, setIsAddingStaff] = React.useState(false);

  // Student accounts management
  const [studentAccountsList, setStudentAccountsList] = React.useState<Array<{
    id: number; name: string; studentId: string; email: string; isVerified: boolean; createdAt: string;
  }>>([]);
  const [studentSearchTerm, setStudentSearchTerm] = React.useState("");
  const [studentActionLoading, setStudentActionLoading] = React.useState<number | null>(null);

  // Student login toggle
  const [studentLoginEnabled, setStudentLoginEnabled] = React.useState(false);

  // File submissions state
  const [fileSubmissionsEnabled, setFileSubmissionsEnabled] = React.useState(false);
  const [fileSubmissionsList, setFileSubmissionsList] = React.useState<any[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);
  const [fileSubmissionTitle, setFileSubmissionTitle] = React.useState("File Submission");
  const [fileSubmissionSubjectLabel, setFileSubmissionSubjectLabel] = React.useState("");
  const [fileSubmissionProjectTitle, setFileSubmissionProjectTitle] = React.useState("");
  const [isDownloadingZip, setIsDownloadingZip] = React.useState(false);
  const [fileDeadlineHours, setFileDeadlineHours] = React.useState("");
  const [fileDeadlineMinutes, setFileDeadlineMinutes] = React.useState("");

  // Projects state
  const [projects, setProjects] = React.useState<any[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<number | null>(null);
  const [activeGroupProjectId, setActiveGroupProjectId] = React.useState<number | null>(null);
  const [activeFileProjectId, setActiveFileProjectId] = React.useState<number | null>(null);

  // Allowed file types for file submissions
  const [allowedFileTypes, setAllowedFileTypes] = React.useState<string[]>(["pdf", "ppt"]);
  const [showNewProjectDialog, setShowNewProjectDialog] = React.useState(false);
  const [newProjectName, setNewProjectName] = React.useState("");
  // Per-project deadline collected at the same time as the project name.
  // Format: "YYYY-MM-DDTHH:mm" (datetime-local). Empty = no deadline.
  const [newProjectDeadline, setNewProjectDeadline] = React.useState("");
  const [newProjectType, setNewProjectType] = React.useState<"both" | "group" | "file">("both");
  const [creatingProject, setCreatingProject] = React.useState(false);

  // Collapsible sections (file submissions tab)
  const [collapseProjects, setCollapseProjects] = React.useState(false);
  const [collapseFormSettings, setCollapseFormSettings] = React.useState(false);
  const [collapseSubmittedFiles, setCollapseSubmittedFiles] = React.useState(false);

  // Admin upload dialog (no restrictions)
  const [showAdminUpload, setShowAdminUpload] = React.useState(false);
  const [adminUploadProjectId, setAdminUploadProjectId] = React.useState<string>("");
  const [adminUploadName, setAdminUploadName] = React.useState("");
  const [adminUploadStudentId, setAdminUploadStudentId] = React.useState("");
  const [adminUploadLeader, setAdminUploadLeader] = React.useState("");
  const [adminUploadTopic, setAdminUploadTopic] = React.useState("");
  const [adminUploadSubject, setAdminUploadSubject] = React.useState("");
  const [adminUploadFiles, setAdminUploadFiles] = React.useState<File[]>([]);
  const [adminUploadBusy, setAdminUploadBusy] = React.useState(false);

  // Submission settings (file submission form)
  const [maxFileSizeMb, setMaxFileSizeMb] = React.useState("5");
  const [requireLeader, setRequireLeader] = React.useState(false);
  const [requireTopic, setRequireTopic] = React.useState(false);

  // Group submission form field toggles
  const [groupRequireLeader, setGroupRequireLeader] = React.useState(true);
  const [groupRequireTopic, setGroupRequireTopic] = React.useState(true);

  // 2FA OTP step (admin only)
  const [otpStep, setOtpStep] = React.useState(false);
  const [otpCode, setOtpCode] = React.useState("");
  const [otpEmailHint, setOtpEmailHint] = React.useState("");
  const [otpError, setOtpError] = React.useState("");
  const [otpLoading, setOtpLoading] = React.useState(false);
  const [otpResendBusy, setOtpResendBusy] = React.useState(false);

  // Forgot password (magic link)
  const [showForgotDialog, setShowForgotDialog] = React.useState(false);
  const [forgotMessage, setForgotMessage] = React.useState("");
  const [forgotError, setForgotError] = React.useState("");
  const [forgotLoading, setForgotLoading] = React.useState(false);

  // Announcements
  const [announcements, setAnnouncements] = React.useState<Array<{ id: number; title: string; content: string; priority: string; createdAt: string }>>([]);
  const [annTitle, setAnnTitle] = React.useState("");
  const [annContent, setAnnContent] = React.useState("");
  const [annPriority, setAnnPriority] = React.useState("info");
  const [annLoading, setAnnLoading] = React.useState(false);

  // Calendar Events
  const [calEventsList, setCalEventsList] = React.useState<Array<{ id: number; title: string; description: string | null; eventType: string; eventDate: string; startTime: string | null; endTime: string | null; semester: string; filePath: string | null; fileName: string | null; fileMimeType: string | null; createdAt: string }>>([]);
  const [calEvTitle, setCalEvTitle] = React.useState("");
  const [calEvDesc, setCalEvDesc] = React.useState("");
  const [calEvType, setCalEvType] = React.useState("other");
  const [calEvDate, setCalEvDate] = React.useState("");
  const [calEvStartTime, setCalEvStartTime] = React.useState("");
  const [calEvEndTime, setCalEvEndTime] = React.useState("");
  const [calEvSemester, setCalEvSemester] = React.useState("all");
  const [calEvLoading, setCalEvLoading] = React.useState(false);
  const [calEvEditId, setCalEvEditId] = React.useState<number | null>(null);

  const { toast } = useToast();
  const groupsFilterValue: number | "all" | "none" =
    groupsProjectFilter === "all" || groupsProjectFilter === "none"
      ? (groupsProjectFilter as "all" | "none")
      : (parseInt(groupsProjectFilter) as number);
  const { data: groups, isLoading, refetch } = useGroups(groupsFilterValue);
  const { data: stats, refetch: refetchStats } = useStats(groupsFilterValue);
  const { data: topics } = useTopics();
  const deleteGroup = useDeleteGroup();

  const isAdmin = adminRole === "admin";
  const canEdit = adminRole === "admin" || adminRole === "editor";
  const canDownload = adminRole === "admin" || adminRole === "editor" || adminRole === "downloader";

  React.useEffect(() => {
    const handleResize = () => {
      setIsSidebarOpen(window.innerWidth >= 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  React.useEffect(() => {
    const savedAuth = localStorage.getItem("admin_auth");
    const savedRole = localStorage.getItem("admin_role") as AdminRole | null;
    if (savedAuth && savedRole) {
      setIsAuthenticated(true);
      setAdminRole(savedRole);
      loadSettings();
    }
  }, []);

  React.useEffect(() => {
    const interval = setInterval(() => {
      if (isAuthenticated) { refetch(); refetchStats(); }
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated, refetch, refetchStats]);

  // Admin-side unread message count → sidebar badge on the "Messages" tab.
  // Declared at top-level (before any conditional render) to comply with React's rules of hooks.
  const { data: msgUnread = 0 } = useQuery<number>({
    queryKey: ["/api/admin/messages", "unread-count"],
    enabled: isAuthenticated && adminRole === "admin",
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await fetch("/api/admin/messages", {
        headers: { Authorization: `Basic ${localStorage.getItem("admin_auth") || ""}` },
      });
      if (!r.ok) return 0;
      const list = await r.json();
      return Array.isArray(list) ? list.filter((m: any) => !m.isReadByAdmin).length : 0;
    },
  });

  const loadSettings = () => {
    fetch("/api/settings/rules").then(r => r.json()).then(d => setRules(d.value || ""));
    fetch("/api/settings/project_name").then(r => r.json()).then(d => setProjectName(d.value || ""));
    fetch("/api/settings/required_members").then(r => r.json()).then(d => setMemberCount(d.value || ""));
    fetch("/api/settings/file_submission_enabled").then(r => r.json()).then(d => setFileSubmissionsEnabled(d.value === "true"));
    fetch("/api/settings/file_submission_title").then(r => r.json()).then(d => { if (d.value) setFileSubmissionTitle(d.value); });
    fetch("/api/settings/file_submission_subject_label").then(r => r.json()).then(d => { setFileSubmissionSubjectLabel(d.value || ""); });
    fetch("/api/settings/file_submission_project_title").then(r => r.json()).then(d => { setFileSubmissionProjectTitle(d.value || ""); });
    fetch("/api/settings/file_submission_max_size_mb").then(r => r.json()).then(d => { if (d.value) setMaxFileSizeMb(d.value); });
    fetch("/api/settings/file_submission_require_leader").then(r => r.json()).then(d => setRequireLeader(d.value === "true"));
    fetch("/api/settings/file_submission_require_topic").then(r => r.json()).then(d => setRequireTopic(d.value === "true"));
    fetch("/api/settings/group_require_leader").then(r => r.json()).then(d => setGroupRequireLeader(d.value !== "false"));
    fetch("/api/settings/group_require_topic").then(r => r.json()).then(d => setGroupRequireTopic(d.value !== "false"));
    fetch("/api/settings/student_login_enabled").then(r => r.json()).then(d => setStudentLoginEnabled(d.value === "true"));
    // Load projects up front so the "Create Group" picker (and any other
    // dashboard code that needs the list) has data even before the user
    // visits the File submissions / Group project tab.
    fetch("/api/admin/projects", { headers: authHeader() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d) {
          setProjects(d.projects || []);
          setActiveProjectId(d.activeProjectId);
          setActiveGroupProjectId(d.activeGroupProjectId ?? d.activeProjectId);
          setActiveFileProjectId(d.activeFileProjectId ?? d.activeProjectId);
        }
      })
      .catch(() => { /* ignore */ });
    fetch("/api/settings/allowed_file_types").then(r => r.json()).then(d => {
      if (d.value) try { setAllowedFileTypes(JSON.parse(d.value)); } catch {}
    }).catch(() => {});
  };

  const loadFileSubmissions = async () => {
    setIsLoadingFiles(true);
    try {
      const [subRes, projRes] = await Promise.all([
        fetch("/api/admin/file-submissions", { headers: authHeader() }),
        fetch("/api/admin/projects", { headers: authHeader() }),
      ]);
      if (subRes.ok) setFileSubmissionsList(await subRes.json());
      if (projRes.ok) {
        const pdata = await projRes.json();
        setProjects(pdata.projects || []);
        setActiveProjectId(pdata.activeProjectId);
        setActiveGroupProjectId(pdata.activeGroupProjectId ?? pdata.activeProjectId);
        setActiveFileProjectId(pdata.activeFileProjectId ?? pdata.activeProjectId);
      }
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast({ title: "Error", description: "Project name is required", variant: "destructive" });
      return;
    }
    // Optional but if provided, must be in the future.
    if (newProjectDeadline) {
      const d = new Date(newProjectDeadline);
      if (isNaN(d.getTime())) {
        toast({ title: "Error", description: "Invalid deadline", variant: "destructive" });
        return;
      }
      if (d.getTime() <= Date.now()) {
        toast({ title: "Error", description: "Deadline must be in the future", variant: "destructive" });
        return;
      }
    }
    setCreatingProject(true);
    try {
      const res = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({
          name: newProjectName.trim(),
          deadline: newProjectDeadline ? new Date(newProjectDeadline).toISOString() : null,
          projectType: newProjectType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create");
      toast({
        title: "Project created",
        description: newProjectDeadline
          ? `"${data.name}" is now accepting submissions until ${new Date(newProjectDeadline).toLocaleString()}.`
          : `"${data.name}" is now accepting submissions.`,
      });
      setShowNewProjectDialog(false);
      setNewProjectName("");
      setNewProjectDeadline("");
      loadFileSubmissions();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreatingProject(false);
    }
  };

  const handleFinalizeProject = async (id: number, name: string) => {
    if (!confirm(`Finalize project "${name}"? Students will no longer be able to submit to it.`)) return;
    try {
      const res = await fetch(`/api/admin/projects/${id}/finalize`, { method: "POST", headers: authHeader() });
      if (!res.ok) throw new Error((await res.json()).message);
      toast({ title: "Finalized", description: `"${name}" is now locked.` });
      loadFileSubmissions();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteProject = async (id: number, name: string) => {
    if (!confirm(`PERMANENTLY delete project "${name}" and ALL its submissions/files? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/projects/${id}`, { method: "DELETE", headers: authHeader() });
      if (!res.ok) throw new Error((await res.json()).message);
      toast({ title: "Deleted", description: `"${name}" removed.` });
      loadFileSubmissions();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleForgotPassword = async () => {
    setForgotError("");
    setForgotMessage("");
    setForgotLoading(true);
    try {
      const res = await fetch("/api/auth/admin/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setForgotError(data.message || "Failed to send reset link."); return; }
      setForgotMessage(data.message || "Check your inbox for a sign-in link.");
    } catch (err: any) {
      setForgotError(err.message || "Network error");
    } finally {
      setForgotLoading(false);
    }
  };

  // Finalize an admin session (post-OTP or post-magic-link) by storing the
  // server-issued bearer credential and entering the dashboard.
  const completeAdminLogin = (sessionAuth: string) => {
    localStorage.setItem("admin_auth", sessionAuth);
    localStorage.setItem("admin_role", "admin");
    setAdminRole("admin");
    setIsAuthenticated(true);
    setOtpStep(false); setOtpCode(""); setOtpError(""); setOtpEmailHint("");
    setUsername(""); setPassword("");
    loadSettings();
    refetch();
    refetchStats();
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError("");
    setOtpLoading(true);
    try {
      const res = await fetch("/api/auth/admin/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, code: otpCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setOtpError(data.message || "Invalid code"); return; }
      completeAdminLogin(data.sessionAuth);
    } catch (err: any) {
      setOtpError(err.message || "Network error");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleOtpResend = async () => {
    setOtpError("");
    setOtpResendBusy(true);
    try {
      const res = await fetch("/api/auth/admin/otp/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setOtpError(data.message || "Resend failed"); return; }
      toast({ title: "New code sent", description: `A fresh code was emailed to ${data.email || "your inbox"}.` });
    } catch (err: any) {
      setOtpError(err.message || "Network error");
    } finally {
      setOtpResendBusy(false);
    }
  };

  // Consume a magic-link sign-in token from the URL (?magic=...) once on mount.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("magic");
    if (!token) return;
    // Strip the token from the visible URL immediately.
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      try {
        const res = await fetch("/api/auth/admin/magic/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ title: "Sign-in link invalid", description: data.message || "Please request a new link.", variant: "destructive" });
          return;
        }
        completeAdminLogin(data.sessionAuth);
        toast({ title: "Signed in", description: "Welcome back. Don't forget to update your password from settings." });
      } catch (err: any) {
        toast({ title: "Sign-in failed", description: err.message || "Network error", variant: "destructive" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStaff = async () => {
    const auth = localStorage.getItem("admin_auth");
    const res = await fetch("/api/admin/staff", { headers: { Authorization: `Basic ${auth}` } });
    if (res.ok) setStaffList(await res.json());
  };

  const loadStudentAccounts = async () => {
    const res = await fetch("/api/admin/students", { headers: authHeader() });
    if (res.ok) setStudentAccountsList(await res.json());
  };

  const loadAnnouncements = async () => {
    const res = await fetch("/api/announcements");
    if (res.ok) setAnnouncements(await res.json());
  };

  const loadCalendarEvents = async () => {
    const res = await fetch("/api/calendar/events", { headers: authHeader() });
    if (res.ok) setCalEventsList(await res.json());
  };

  React.useEffect(() => {
    if (activeTab === "staff" && isAdmin) loadStaff();
    if (activeTab === "students" && isAdmin) loadStudentAccounts();
    if (activeTab === "file-submissions" || activeTab === "group-project" || activeTab === "dashboard") loadFileSubmissions();
    if (activeTab === "announcements" && isAdmin) loadAnnouncements();
    if (activeTab === "calendar" && isAdmin) loadCalendarEvents();
  }, [activeTab, isAdmin]);

  const handleCreateAnnouncement = async () => {
    if (!annTitle.trim() || !annContent.trim()) return;
    setAnnLoading(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ title: annTitle.trim(), content: annContent.trim(), priority: annPriority }),
      });
      if (res.ok) {
        const newAnn = await res.json();
        setAnnouncements(prev => [...prev, newAnn]);
        setAnnTitle(""); setAnnContent(""); setAnnPriority("info");
        toast({ title: "Announcement posted" });
      } else toast({ title: "Failed to post", variant: "destructive" });
    } finally { setAnnLoading(false); }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    const res = await fetch(`/api/admin/announcements/${id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok) { setAnnouncements(prev => prev.filter(a => a.id !== id)); toast({ title: "Announcement deleted" }); }
    else toast({ title: "Failed to delete", variant: "destructive" });
  };

  const [calEvFile, setCalEvFile] = React.useState<File | null>(null);
  const [calEvRemoveExisting, setCalEvRemoveExisting] = React.useState(false);

  const resetCalEvForm = () => { setCalEvEditId(null); setCalEvTitle(""); setCalEvDesc(""); setCalEvType("other"); setCalEvDate(""); setCalEvStartTime(""); setCalEvEndTime(""); setCalEvSemester("all"); setCalEvFile(null); setCalEvRemoveExisting(false); };

  const handleSaveCalEvent = async () => {
    if (!calEvTitle.trim() || !calEvDate.trim()) return;
    setCalEvLoading(true);
    try {
      const body = { title: calEvTitle.trim(), description: calEvDesc.trim() || null, eventType: calEvType, eventDate: calEvDate, startTime: calEvStartTime || null, endTime: calEvEndTime || null, semester: calEvSemester || "all" };
      const res = calEvEditId !== null
        ? await fetch(`/api/admin/calendar/events/${calEvEditId}`, { method: "PUT", headers: { ...authHeader(), "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/admin/calendar/events", { method: "POST", headers: { ...authHeader(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      let event = await res.json();
      // Remove existing file if requested
      if (calEvRemoveExisting && !calEvFile) {
        const delRes = await fetch(`/api/admin/calendar/events/${event.id}/file`, { method: "DELETE", headers: authHeader() });
        if (delRes.ok) event = await delRes.json();
      }
      // Upload new file if selected
      if (calEvFile) {
        const formData = new FormData();
        formData.append("file", calEvFile);
        const upRes = await fetch(`/api/admin/calendar/events/${event.id}/upload`, { method: "POST", headers: authHeader(), body: formData });
        if (upRes.ok) event = await upRes.json();
      }
      if (calEvEditId !== null) {
        setCalEventsList(prev => prev.map(e => e.id === calEvEditId ? event : e));
        toast({ title: "Event updated" });
      } else {
        setCalEventsList(prev => [...prev, event].sort((a, b) => a.eventDate.localeCompare(b.eventDate)));
        toast({ title: "Event created" });
      }
      resetCalEvForm();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setCalEvLoading(false); }
  };

  const handleDeleteCalEvent = async (id: number) => {
    const res = await fetch(`/api/admin/calendar/events/${id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok) { setCalEventsList(prev => prev.filter(e => e.id !== id)); toast({ title: "Event deleted" }); }
  };

  const handleCalEvFileUpload = async (id: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/admin/calendar/events/${id}/upload`, { method: "POST", headers: authHeader(), body: formData });
    if (res.ok) { const updated = await res.json(); setCalEventsList(prev => prev.map(e => e.id === id ? updated : e)); toast({ title: "File attached" }); }
  };

  const handleCalEvRemoveFile = async (id: number) => {
    const res = await fetch(`/api/admin/calendar/events/${id}/file`, { method: "DELETE", headers: authHeader() });
    if (res.ok) { const updated = await res.json(); setCalEventsList(prev => prev.map(e => e.id === id ? updated : e)); toast({ title: "File removed" }); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const auth = btoa(`${username}:${password}`);
    try {
      const res = await fetch("/api/auth/check", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(data.message || "Invalid username or password");
        return;
      }
      // Admin → 2FA step (server already emailed the OTP).
      if (data.otpRequired) {
        setOtpEmailHint(data.email || "");
        setOtpStep(true);
        setOtpCode("");
        setOtpError("");
        return;
      }
      // Staff → straight in with the basic-auth credentials.
      const role: AdminRole = data.role || "viewer";
      localStorage.setItem("admin_auth", auth);
      localStorage.setItem("admin_role", role);
      setAdminRole(role);
      setIsAuthenticated(true);
      loadSettings();
      refetch();
      refetchStats();
    } catch {
      setLoginError("Connection error. Please try again.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_auth");
    localStorage.removeItem("admin_role");
    setIsAuthenticated(false);
  };

  const authHeader = () => ({ Authorization: `Basic ${localStorage.getItem("admin_auth")}` });

  const handleUpdateDeadline = async () => {
    try {
      const date = new Date();
      date.setHours(date.getHours() + (parseInt(newDeadlineHours) || 0));
      date.setMinutes(date.getMinutes() + (parseInt(newDeadlineMinutes) || 0));
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ key: "submission_deadline", value: date.toISOString() }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Success", description: "Deadline updated" });
    } catch {
      toast({ title: "Error", description: "Failed to update deadline", variant: "destructive" });
    }
  };

  const handleSaveProjectDeadline = async (projectId: number, deadlineStr: string | null) => {
    setProjectDeadlineSaving(projectId);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/deadline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ deadline: deadlineStr ? new Date(deadlineStr).toISOString() : null }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Update failed"); }
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, deadline: deadlineStr ? new Date(deadlineStr).toISOString() : null } : p));
      setProjectDeadlineEdits(prev => { const next = { ...prev }; delete next[projectId]; return next; });
      toast({ title: "Deadline saved", description: deadlineStr ? `Set to ${new Date(deadlineStr).toLocaleString()}` : "Deadline cleared" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setProjectDeadlineSaving(null);
    }
  };

  const handleUpdateRules = async () => {
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ key: "rules", value: rules }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Success", description: "Rules updated" });
    } catch {
      toast({ title: "Error", description: "Failed to update rules", variant: "destructive" });
    }
  };

  const handleUpdateMemberCount = async () => {
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ key: "required_members", value: memberCount }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Success", description: "Member count updated" });
    } catch {
      toast({ title: "Error", description: "Failed to update member count", variant: "destructive" });
    }
  };

  const handleChangePassword = async () => {
    try {
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match");
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
      const [user] = atob(localStorage.getItem("admin_auth")!).split(":");
      localStorage.setItem("admin_auth", btoa(`${user}:${newPassword}`));
      toast({ title: "Success", description: "Password updated" });
      setOldPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleUpdateProjectName = async () => {
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ key: "project_name", value: projectName }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Success", description: "Project name updated" });
    } catch {
      toast({ title: "Error", description: "Failed to update project name", variant: "destructive" });
    }
  };

  const [editSaving, setEditSaving] = React.useState(false);

  const updateMemberField = (memberIndex: number, field: string, value: any) => {
    if (!editingGroup) return;
    const updated = editingGroup.members.map((m: any, i: number) =>
      i === memberIndex ? { ...m, [field]: value } : m
    );
    setEditingGroup({ ...editingGroup, members: updated });
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup) return;
    const leader = editingGroup.members.find((m: any) => m.role === "leader");
    const mems = editingGroup.members.filter((m: any) => m.role === "member");
    for (const m of mems) {
      if (!m.name.trim() || !m.studentId.trim()) {
        toast({ title: "Validation Error", description: "Every member needs a name and student ID.", variant: "destructive" });
        return;
      }
    }
    if (leader && (!leader.name.trim() || !leader.studentId.trim())) {
      toast({ title: "Validation Error", description: "Leader name and student ID are required.", variant: "destructive" });
      return;
    }
    setEditSaving(true);
    try {
      const payload: any = {
        members: mems.map((m: any) => ({ name: m.name.trim(), studentId: m.studentId.trim(), role: "member", topicId: m.topicId ?? null })),
      };
      if (leader) {
        payload.leader = { name: leader.name.trim(), studentId: leader.studentId.trim(), role: "leader", topicId: leader.topicId ?? null };
      }
      const res = await fetch(`/api/groups/${editingGroup.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Update failed"); }
      toast({ title: "Success", description: "Group updated successfully" });
      setEditingGroup(null);
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const addEditMemberRow = () => {
    if (!editingGroup) return;
    setEditingGroup({ ...editingGroup, members: [...editingGroup.members, { id: null, groupId: editingGroup.id, topicId: null, name: "", studentId: "", role: "member", topic: null }] });
  };

  const removeEditMemberRow = (idx: number) => {
    if (!editingGroup) return;
    const updated = editingGroup.members.filter((_: any, i: number) => i !== idx);
    setEditingGroup({ ...editingGroup, members: updated });
  };

  // Open the "Create Group" dialog with the right number of empty rows
  // (uses the project-level required_members + group_require_leader settings).
  const openCreateGroup = () => {
    const required = parseInt(memberCount || "6") || 6;
    const initialMembers: typeof creatingGroup extends infer T ? T extends { members: infer M } ? M : never : never =
      [] as any;
    if (groupRequireLeader) {
      initialMembers.push({ name: "", studentId: "", role: "leader" as const, topicId: null });
    }
    for (let i = 0; i < required; i++) {
      initialMembers.push({ name: "", studentId: "", role: "member" as const, topicId: null });
    }
    // Default project: the current filter if a specific one is chosen,
    // else the active project, else the first project, else null.
    let pid: number | null = null;
    if (groupsProjectFilter !== "all" && groupsProjectFilter !== "none") {
      const n = parseInt(groupsProjectFilter);
      if (!isNaN(n)) pid = n;
    }
    if (pid == null) pid = activeGroupProjectId;
    if (pid == null && projects.length > 0) pid = projects[0].id;
    setCreatingGroup({ projectId: pid, members: initialMembers });
  };

  const updateCreateMemberField = (idx: number, field: string, value: any) => {
    if (!creatingGroup) return;
    const next = creatingGroup.members.map((m, i) =>
      i === idx ? { ...m, [field]: value } : m,
    );
    setCreatingGroup({ ...creatingGroup, members: next });
  };

  const addCreateMemberRow = () => {
    if (!creatingGroup) return;
    setCreatingGroup({
      ...creatingGroup,
      members: [
        ...creatingGroup.members,
        { name: "", studentId: "", role: "member", topicId: null },
      ],
    });
  };

  const removeCreateMemberRow = (idx: number) => {
    if (!creatingGroup) return;
    setCreatingGroup({
      ...creatingGroup,
      members: creatingGroup.members.filter((_, i) => i !== idx),
    });
  };

  const handleCreateGroupSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingGroup) return;
    const leader = creatingGroup.members.find(m => m.role === "leader");
    const memberRows = creatingGroup.members.filter(m => m.role === "member");

    if (groupRequireLeader && (!leader || !leader.name.trim() || !leader.studentId.trim())) {
      toast({ title: "Error", description: "Leader name and student ID are required.", variant: "destructive" });
      return;
    }
    if (memberRows.length === 0) {
      toast({ title: "Error", description: "Add at least one member.", variant: "destructive" });
      return;
    }
    for (const m of memberRows) {
      if (!m.name.trim() || !m.studentId.trim()) {
        toast({ title: "Error", description: "Every member needs a name and student ID.", variant: "destructive" });
        return;
      }
    }
    // Local duplicate check (the server also enforces this)
    const allIds = [
      ...(leader ? [leader.studentId.trim()] : []),
      ...memberRows.map(m => m.studentId.trim()),
    ];
    if (new Set(allIds).size !== allIds.length) {
      toast({ title: "Error", description: "Duplicate student IDs in this group.", variant: "destructive" });
      return;
    }

    setCreateSaving(true);
    try {
      const payload = {
        leader: groupRequireLeader && leader
          ? { name: leader.name.trim(), studentId: leader.studentId.trim(), role: "leader", topicId: leader.topicId ?? null }
          : undefined,
        members: memberRows.map(m => ({
          name: m.name.trim(),
          studentId: m.studentId.trim(),
          role: "member" as const,
          topicId: m.topicId ?? null,
        })),
      };
      // Always send projectId explicitly so the server doesn't silently
      // fall back to the active project. "none" is the wire signal for
      // "no project" (admin/editor only).
      const qs = creatingGroup.projectId != null
        ? `?projectId=${creatingGroup.projectId}`
        : "?projectId=none";
      const res = await fetch(`/api/groups${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create group");
      toast({ title: "Success", description: `Group created${creatingGroup.projectId ? "" : " (no project)"}` });
      setCreatingGroup(null);
      refetch();
      refetchStats();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreateSaving(false);
    }
  };

  const handleAddStaff = async () => {
    if (!newStaffUsername || !newStaffPassword) {
      toast({ title: "Error", description: "Fill in all fields", variant: "destructive" });
      return;
    }
    setIsAddingStaff(true);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ username: newStaffUsername, password: newStaffPassword, role: newStaffRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: "Success", description: `Staff account "${newStaffUsername}" created` });
      setNewStaffUsername(""); setNewStaffPassword(""); setNewStaffRole("viewer");
      loadStaff();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleDeleteStaff = async (uname: string) => {
    if (!confirm(`Remove staff account "${uname}"?`)) return;
    try {
      await fetch(`/api/admin/staff/${uname}`, { method: "DELETE", headers: authHeader() });
      toast({ title: "Removed", description: `"${uname}" removed` });
      loadStaff();
    } catch {
      toast({ title: "Error", description: "Failed to remove", variant: "destructive" });
    }
  };

  const handleAiAction = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    try {
      const res = await fetch("/api/admin/ai-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "AI action failed");
      toast({ title: "AI Success", description: data.message });
      setAiPrompt("");
      refetch(); refetchStats();
    } catch (err: any) {
      toast({ title: "AI Error", description: err.message, variant: "destructive" });
    } finally {
      setIsAiLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-2xl border-none glass-card">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold">{otpStep ? "Verify it's you" : "Admin Login"}</CardTitle>
            <CardDescription>
              {otpStep
                ? <>We emailed a 6-digit code to <b>{otpEmailHint || "your inbox"}</b>. Enter it below to continue.</>
                : "Enter your credentials to access the dashboard"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!otpStep ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" data-testid="input-username" />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <div className="relative">
                    <Input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" data-testid="input-password" className="pr-10" />
                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1} data-testid="button-toggle-password">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {loginError && <p className="text-sm text-destructive font-medium" data-testid="text-login-error">{loginError}</p>}
                <Button type="submit" className="w-full h-11" data-testid="button-login">Login</Button>
                <div className="text-center pt-1">
                  <button type="button" onClick={() => { setShowForgotDialog(true); setForgotMessage(""); setForgotError(""); }}
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    data-testid="link-forgot-password">
                    <HelpCircle className="w-3 h-3" /> Forgot password?
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleOtpVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp-code">Verification code</Label>
                  <Input
                    id="otp-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="text-center text-2xl tracking-[0.5em] font-mono h-14"
                    data-testid="input-otp-code"
                    autoFocus
                  />
                </div>
                {otpError && <p className="text-sm text-destructive font-medium" data-testid="text-otp-error">{otpError}</p>}
                <Button type="submit" className="w-full h-11" disabled={otpLoading || otpCode.length !== 6} data-testid="button-otp-verify">
                  {otpLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Verify & sign in
                </Button>
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => { setOtpStep(false); setOtpCode(""); setOtpError(""); }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                    data-testid="button-otp-back"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={handleOtpResend}
                    disabled={otpResendBusy}
                    className="text-sm text-primary hover:underline disabled:opacity-50"
                    data-testid="button-otp-resend"
                  >
                    {otpResendBusy ? "Sending…" : "Resend code"}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Forgot password dialog (magic-link flow) */}
        <Dialog open={showForgotDialog} onOpenChange={(o) => { setShowForgotDialog(o); if (!o) { setForgotMessage(""); setForgotError(""); } }}>
          <DialogContent className="sm:max-w-md" data-testid="dialog-forgot-password">
            <DialogHeader>
              <DialogTitle>Reset admin access</DialogTitle>
              <DialogDescription>
                We'll email a one-time sign-in link to the admin email on file.
                Click the link to log in without a password — you can then set a new one in Settings.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {forgotMessage ? (
                <p className="text-sm p-3 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200" data-testid="text-forgot-success">
                  {forgotMessage}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The link expires in 15 minutes and can only be used once.
                </p>
              )}
              {forgotError && <p className="text-sm text-destructive font-medium" data-testid="text-forgot-error">{forgotError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForgotDialog(false)}>Close</Button>
              <Button onClick={handleForgotPassword} disabled={forgotLoading || !!forgotMessage} data-testid="button-forgot-submit">
                {forgotLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {forgotMessage ? "Sent" : "Send sign-in link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const filteredGroups = groups?.filter((group: any) =>
    group.members.some((m: any) =>
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.studentId.toLowerCase().includes(searchTerm.toLowerCase())
    )
  ) || [];

  const allSidebarTabs = [
    { id: "dashboard", label: "Dashboard", icon: PieChart, adminOnly: false },
    { id: "group-data", label: "Group Data", icon: Users, adminOnly: false },
    { id: "group-project", label: "Group Project", icon: Folder, adminOnly: false },
    { id: "file-submissions", label: "File Submissions", icon: FileDown, adminOnly: false },
    { id: "announcements", label: "Announcements", icon: Megaphone, adminOnly: true },
    { id: "messages", label: "Messages", icon: Inbox, adminOnly: true },
    { id: "calendar", label: "Calendar", icon: CalendarDays, adminOnly: true },
    { id: "students", label: "Student Accounts", icon: GraduationCap, adminOnly: true },
    { id: "staff", label: "Staff Management", icon: UserPlus, adminOnly: true },
    { id: "settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
    { id: "credentials", label: "Credentials", icon: KeyRound, adminOnly: true },
    { id: "password", label: "Change Password", icon: Lock, adminOnly: true },
  ];

  const visibleTabs = allSidebarTabs.filter(t => !t.adminOnly || isAdmin);
  const roleInfo = ROLE_LABELS[adminRole] || ROLE_LABELS.viewer;

  return (
    <div className="min-h-screen bg-secondary/30 flex overflow-hidden">
      {/* Mobile overlay */}
      {isSidebarOpen && window.innerWidth < 1024 && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        "bg-background border-r flex flex-col fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
        !isSidebarOpen && "-translate-x-full"
      )}>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-primary">
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-sm">Admin System</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Role Badge */}
        <div className="px-4 py-3 border-b bg-secondary/40">
          <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold", roleInfo.color)}>
            <roleInfo.icon className="w-3 h-3" />
            {roleInfo.label}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{roleInfo.perms}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {visibleTabs.map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              className="w-full justify-start gap-2"
              onClick={() => { setActiveTab(tab.id); if (window.innerWidth < 1024) setIsSidebarOpen(false); }}
              data-testid={`sidebar-tab-${tab.id}`}
            >
              <tab.icon className="w-4 h-4" /> <span className="flex-1 text-left">{tab.label}</span>
              {tab.id === "messages" && msgUnread > 0 && (
                <span
                  className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold"
                  data-testid="badge-messages-unread"
                >
                  {msgUnread > 99 ? "99+" : msgUnread}
                </span>
              )}
            </Button>
          ))}
        </nav>

        <div className="p-4 border-t">
          <Button
            variant="ghost" size="sm"
            onClick={handleLogout}
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <LogOut className="w-4 h-4" /> Logout
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <div className="bg-background border-b h-16 flex items-center px-4 lg:px-8 justify-between sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
              <MoreVertical className="w-5 h-5" />
            </Button>
            <h1 className="font-bold text-xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600 capitalize truncate max-w-[200px] md:max-w-none">
              {visibleTabs.find(t => t.id === activeTab)?.label || activeTab}
            </h1>
          </div>

          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-primary border-primary/30 hover:bg-primary/5"
                onClick={() => setAiChatOpen(true)}
                data-testid="button-ai-command"
              >
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">AI Assistant</span>
              </Button>
              <AdminAIChat
                open={aiChatOpen}
                onOpenChange={setAiChatOpen}
                authHeader={authHeader}
                onActionPerformed={() => { refetch(); refetchStats(); }}
              />
            </>
          )}
        </div>

        {/* Page Content */}
        <main className="p-4 lg:p-8 overflow-y-auto flex-1 bg-secondary/30">

          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="relative overflow-hidden border-none bg-gradient-to-br from-purple-500/10 to-indigo-500/10">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1.5 text-purple-700 font-medium"><Users className="w-4 h-4" /> Total Groups</CardDescription>
                    <CardTitle className="text-4xl font-extrabold text-purple-700">{stats?.totalGroups || 0}</CardTitle>
                  </CardHeader>
                  <div className="absolute -bottom-3 -right-3 opacity-10"><Users className="w-20 h-20" /></div>
                </Card>
                <Card className="relative overflow-hidden border-none bg-gradient-to-br from-blue-500/10 to-cyan-500/10">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1.5 text-blue-700 font-medium"><UserPlus className="w-4 h-4" /> Total Students</CardDescription>
                    <CardTitle className="text-4xl font-extrabold text-blue-700">{stats?.totalStudents || 0}</CardTitle>
                  </CardHeader>
                  <div className="absolute -bottom-3 -right-3 opacity-10"><UserPlus className="w-20 h-20" /></div>
                </Card>
                <Card className="relative overflow-hidden border-none bg-gradient-to-br from-green-500/10 to-emerald-500/10">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1.5 text-green-700 font-medium"><Folder className="w-4 h-4" /> Active Projects</CardDescription>
                    <CardTitle className="text-4xl font-extrabold text-green-700">{projects.filter(p => p.status === "active").length}</CardTitle>
                  </CardHeader>
                  <div className="absolute -bottom-3 -right-3 opacity-10"><Folder className="w-20 h-20" /></div>
                </Card>
                <Card className="relative overflow-hidden border-none bg-gradient-to-br from-orange-500/10 to-amber-500/10">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1.5 text-orange-700 font-medium"><Upload className="w-4 h-4" /> File Submissions</CardDescription>
                    <CardTitle className="text-4xl font-extrabold text-orange-700">{fileSubmissionsList.length}</CardTitle>
                  </CardHeader>
                  <div className="absolute -bottom-3 -right-3 opacity-10"><Upload className="w-20 h-20" /></div>
                </Card>
              </div>

              <Card className="border-none bg-gradient-to-r from-primary/5 via-purple-500/5 to-pink-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="w-5 h-5 text-primary" /> Quick Access</CardTitle>
                  <CardDescription>Navigate to any section of the admin panel</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {visibleTabs.filter(t => t.id !== "dashboard").map(tab => (
                      <Button
                        key={tab.id}
                        variant="outline"
                        className="h-auto py-4 px-4 flex flex-col items-center gap-2 hover:bg-primary/5 hover:border-primary/30 transition-all"
                        onClick={() => setActiveTab(tab.id)}
                        data-testid={`quick-nav-${tab.id}`}
                      >
                        <tab.icon className="w-6 h-6 text-primary" />
                        <span className="text-sm font-medium">{tab.label}</span>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {(() => {
                const activeGroupProject = projects.find(p => p.id === activeGroupProjectId && p.status === "active");
                const activeFileProject = projects.find(p => p.id === activeFileProjectId && p.status === "active");
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2"><Folder className="w-4 h-4 text-primary" /> Active Group Project</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {activeGroupProject ? (
                          <div className="flex items-center gap-3 p-3 rounded-xl border border-green-200 bg-green-50/50">
                            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-green-700"><Folder className="w-5 h-5" /></div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold truncate">{activeGroupProject.name}</p>
                              <p className="text-xs text-muted-foreground">Accepting group submissions</p>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-4 text-sm text-muted-foreground border border-dashed rounded-xl">No active group project</div>
                        )}
                      </CardContent>
                    </Card>
                    <Card className="border-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2"><FileDown className="w-4 h-4 text-blue-600" /> Active File Project</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {activeFileProject ? (
                          <div className="flex items-center gap-3 p-3 rounded-xl border border-blue-200 bg-blue-50/50">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700"><FileDown className="w-5 h-5" /></div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold truncate">{activeFileProject.name}</p>
                              <p className="text-xs text-muted-foreground">Accepting file submissions</p>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-4 text-sm text-muted-foreground border border-dashed rounded-xl">No active file project</div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}
            </div>
          )}

          {/* GROUP DATA — groups table with project filter */}
          {activeTab === "group-data" && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or student ID..."
                    className="pl-10 h-11"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    data-testid="input-search-groups"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Select value={groupsProjectFilter} onValueChange={setGroupsProjectFilter}>
                    <SelectTrigger className="h-11 w-[200px]" data-testid="select-groups-project">
                      <Folder className="w-4 h-4 mr-1.5 text-primary" />
                      <SelectValue placeholder="Filter by project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All projects</SelectItem>
                      <SelectItem value="none">No project (legacy)</SelectItem>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}{p.id === activeGroupProjectId ? " · active" : p.status === "finalized" ? " · closed" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" className="h-11 gap-2" onClick={() => refetch()} data-testid="button-refresh-groups">
                    <RefreshCcw className="w-4 h-4" /> Refresh
                  </Button>
                  {canEdit && (
                    <Button className="h-11 gap-2" onClick={openCreateGroup} data-testid="button-open-create-group">
                      <UserPlus className="w-4 h-4" /> Create Group
                    </Button>
                  )}
                  {canDownload && (
                    <Button className="h-11 gap-2" onClick={async () => {
                      const qs = groupsProjectFilter === "all" ? "" :
                                 groupsProjectFilter === "none" ? "?projectId=none" :
                                 `?projectId=${groupsProjectFilter}`;
                      const res = await fetch(`/api/export/excel${qs}`, { headers: authHeader() });
                      if (!res.ok) { toast({ title: "Error", description: "Export failed", variant: "destructive" }); return; }
                      const blob = await res.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      const name = groupsProjectFilter === "all" ? "submissions.xlsx"
                                 : groupsProjectFilter === "none" ? "submissions-no-project.xlsx"
                                 : `submissions-project-${groupsProjectFilter}.xlsx`;
                      a.href = url; a.download = name; a.click();
                    }} data-testid="button-export-excel">
                      <Download className="w-4 h-4" /> Export Excel
                    </Button>
                  )}
                </div>
              </div>

              <Card className="glass-card border-none overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-primary/5 border-b border-primary/10">
                        <th className="p-4 font-semibold">Group</th>
                        <th className="p-4 font-semibold">Leader</th>
                        <th className="p-4 font-semibold">Members</th>
                        <th className="p-4 font-semibold">Date</th>
                        {(canDownload || canEdit) && <th className="p-4 font-semibold text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {isLoading ? (
                        <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></td></tr>
                      ) : filteredGroups.length === 0 ? (
                        <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">No groups found</td></tr>
                      ) : filteredGroups.map((group: any) => {
                        const serial = (group as any).projectSerial
                          ? String((group as any).projectSerial).padStart(2, "0")
                          : String(group.id);
                        return (
                        <tr key={group.id} className="hover:bg-primary/5 transition-colors">
                          <td className="p-4 align-top font-bold text-primary">
                            <div data-testid={`text-group-serial-${group.id}`}>Group #{serial}</div>
                            {(group as any).project ? (
                              <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary" data-testid={`badge-project-${group.id}`}>
                                <Folder className="w-2.5 h-2.5" />{(group as any).project.name}
                              </div>
                            ) : (
                              <div className="mt-1 text-[10px] text-muted-foreground italic">no project</div>
                            )}
                          </td>
                          <td className="p-4 align-top">
                            <div className="font-medium">{group.members.find((m: any) => m.role === "leader")?.name}</div>
                            <div className="text-xs text-muted-foreground">{group.members.find((m: any) => m.role === "leader")?.studentId}</div>
                            <div className="mt-1 inline-flex px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase">
                              {(group.members.find((m: any) => m.role === "leader") as any)?.topic?.name}
                            </div>
                          </td>
                          <td className="p-4 align-top">
                            {group.members.filter((m: any) => m.role === "member").map((m: any) => (
                              <div key={m.id} className="text-sm mb-2">
                                <div className="font-medium">{m.name}</div>
                                <div className="text-[11px] text-muted-foreground">{m.studentId} • {(m as any).topic?.name}</div>
                              </div>
                            ))}
                          </td>
                          <td className="p-4 align-top text-sm text-muted-foreground">
                            {new Date(group.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-4 align-top text-right">
                            <div className="flex justify-end gap-2 flex-wrap">
                              {canEdit && (
                                <>
                                  <Button
                                    variant="ghost" size="icon"
                                    onClick={() => setEditingGroup(JSON.parse(JSON.stringify(group)))}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" className="text-destructive"
                                    onClick={async () => {
                                      if (confirm("Delete this group?")) {
                                        await deleteGroup.mutateAsync(group.id);
                                        refetch();
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* NEW PROJECT DIALOG — top-level so it's available from every tab */}
          <Dialog open={showNewProjectDialog} onOpenChange={(o) => { setShowNewProjectDialog(o); if (!o) { setNewProjectName(""); setNewProjectDeadline(""); setNewProjectType("both"); } }}>
            <DialogContent className="sm:max-w-md" data-testid="dialog-new-project">
              <DialogHeader>
                <DialogTitle>Start a New Project Cycle</DialogTitle>
                <DialogDescription>
                  A new folder will be created and this project will become the active one for the selected submission types.
                  Any previously active project remains visible but stops accepting new submissions.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="new-project-name">Project Name</Label>
                  <Input id="new-project-name" value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                    placeholder="e.g. Spring 2026 - Final Reports"
                    onKeyDown={e => { if (e.key === "Enter") handleCreateProject(); }}
                    data-testid="input-new-project-name" />
                </div>
                <div className="space-y-2">
                  <Label>Project Type</Label>
                  <Select value={newProjectType} onValueChange={(v: "both" | "group" | "file") => setNewProjectType(v)}>
                    <SelectTrigger data-testid="select-new-project-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">Both (Group + File Submissions)</SelectItem>
                      <SelectItem value="group">Group Submissions Only</SelectItem>
                      <SelectItem value="file">File Submissions Only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose whether this project accepts group submissions, file submissions, or both.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-project-deadline">
                    Submission Deadline <span className="text-muted-foreground text-xs">(optional)</span>
                  </Label>
                  <Input
                    id="new-project-deadline"
                    type="datetime-local"
                    value={newProjectDeadline}
                    onChange={e => setNewProjectDeadline(e.target.value)}
                    data-testid="input-new-project-deadline"
                  />
                  <p className="text-xs text-muted-foreground">
                    Drives the countdown timer on the student page. After this time, students can no longer submit
                    (or re-edit) for this project. Leave blank for no deadline.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowNewProjectDialog(false)}>Cancel</Button>
                <Button onClick={handleCreateProject} disabled={creatingProject} data-testid="button-create-project">
                  {creatingProject ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FolderPlus className="w-4 h-4 mr-2" />}
                  Create &amp; Activate
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* EDIT GROUP DIALOG */}
          <Dialog open={!!editingGroup} onOpenChange={(open) => { if (!open) setEditingGroup(null); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Group #{editingGroup?.id}</DialogTitle>
                <DialogDescription>Update names, student IDs, and topic assignments. You can also add or remove members.</DialogDescription>
              </DialogHeader>
              {editingGroup && (
                <form onSubmit={handleUpdateGroup} className="space-y-5 pt-2">
                  {/* Leader — only shown when leader is required and group has one */}
                  {groupRequireLeader && (() => {
                    const leaderIdx = editingGroup.members.findIndex((m: any) => m.role === "leader");
                    if (leaderIdx === -1) return null;
                    const leader = editingGroup.members[leaderIdx];
                    return (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-primary uppercase tracking-wide">Leader</p>
                        <div className="p-4 border rounded-xl space-y-3 bg-primary/5">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Name</Label>
                              <Input
                                value={leader.name || ""}
                                onChange={e => updateMemberField(leaderIdx, "name", e.target.value)}
                                placeholder="Leader name"
                                data-testid="input-edit-leader-name"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Student ID</Label>
                              <Input
                                value={leader.studentId || ""}
                                onChange={e => updateMemberField(leaderIdx, "studentId", e.target.value.toUpperCase())}
                                placeholder="e.g. BUS-24F-123"
                                className="uppercase"
                                autoCapitalize="characters"
                                data-testid="input-edit-leader-id"
                              />
                            </div>
                          </div>
                          {groupRequireTopic && (
                            <div className="space-y-1">
                              <Label className="text-xs">Topic</Label>
                              <Select
                                value={leader.topicId ? String(leader.topicId) : "none"}
                                onValueChange={v => updateMemberField(leaderIdx, "topicId", v === "none" ? null : parseInt(v))}
                              >
                                <SelectTrigger><SelectValue placeholder="Select topic" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">— No topic —</SelectItem>
                                  {(topics ?? []).map((t: any) => (
                                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Members */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-primary uppercase tracking-wide">Members</p>
                      <Button type="button" size="sm" variant="outline" onClick={addEditMemberRow} className="gap-1 text-xs">
                        <Plus className="w-3 h-3" /> Add Member
                      </Button>
                    </div>
                    {editingGroup.members.map((m: any, idx: number) => {
                      if (m.role !== "member") return null;
                      return (
                        <div key={idx} className="p-4 border rounded-xl space-y-3 relative">
                          <Button
                            type="button" size="icon" variant="ghost"
                            className="absolute top-2 right-2 w-6 h-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeEditMemberRow(idx)}
                            data-testid={`button-remove-edit-member-${idx}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Name</Label>
                              <Input
                                value={m.name}
                                onChange={e => updateMemberField(idx, "name", e.target.value)}
                                placeholder="Member name"
                                data-testid={`input-edit-member-name-${idx}`}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Student ID</Label>
                              <Input
                                value={m.studentId}
                                onChange={e => updateMemberField(idx, "studentId", e.target.value.toUpperCase())}
                                placeholder="e.g. BUS-24F-123"
                                className="uppercase"
                                autoCapitalize="characters"
                                data-testid={`input-edit-member-id-${idx}`}
                              />
                            </div>
                          </div>
                          {groupRequireTopic && (
                            <div className="space-y-1">
                              <Label className="text-xs">Topic</Label>
                              <Select
                                value={m.topicId ? String(m.topicId) : "none"}
                                onValueChange={v => updateMemberField(idx, "topicId", v === "none" ? null : parseInt(v))}
                              >
                                <SelectTrigger><SelectValue placeholder="Select topic" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">— No topic —</SelectItem>
                                  {(topics ?? []).map((t: any) => (
                                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {editingGroup.members.filter((m: any) => m.role === "member").length === 0 && (
                      <p className="text-sm text-muted-foreground italic text-center py-4">No members yet — click "Add Member" to begin.</p>
                    )}
                  </div>

                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setEditingGroup(null)}>Cancel</Button>
                    <Button type="submit" disabled={editSaving} data-testid="button-save-edit-group">
                      {editSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {/* CREATE GROUP — admin-only, lets staff add a group manually
              for any project (bypasses the public deadline gate). */}
          <Dialog open={!!creatingGroup} onOpenChange={(open) => { if (!open) setCreatingGroup(null); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-group">
              <DialogHeader>
                <DialogTitle>Create New Group</DialogTitle>
                <DialogDescription>
                  Manually add a group for the selected project. Student IDs must be unique within the project.
                </DialogDescription>
              </DialogHeader>
              {creatingGroup && (
                <form onSubmit={handleCreateGroupSave} className="space-y-5 pt-2">
                  {/* Project picker */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Project</Label>
                    <Select
                      value={creatingGroup.projectId != null ? String(creatingGroup.projectId) : "none"}
                      onValueChange={v =>
                        setCreatingGroup({
                          ...creatingGroup,
                          projectId: v === "none" ? null : parseInt(v),
                        })
                      }
                    >
                      <SelectTrigger data-testid="select-create-group-project">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— No project —</SelectItem>
                        {projects.map(p => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}{p.id === activeGroupProjectId ? " · active" : p.status === "finalized" ? " · closed" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Leader */}
                  {groupRequireLeader && (() => {
                    const leaderIdx = creatingGroup.members.findIndex(m => m.role === "leader");
                    const leader = leaderIdx >= 0 ? creatingGroup.members[leaderIdx] : null;
                    if (!leader) return null;
                    return (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-primary uppercase tracking-wide">Leader</p>
                        <div className="p-4 border rounded-xl space-y-3 bg-primary/5">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Name</Label>
                              <Input
                                value={leader.name}
                                onChange={e => updateCreateMemberField(leaderIdx, "name", e.target.value)}
                                placeholder="Leader name"
                                data-testid="input-create-leader-name"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Student ID</Label>
                              <Input
                                value={leader.studentId}
                                onChange={e => updateCreateMemberField(leaderIdx, "studentId", e.target.value.toUpperCase())}
                                placeholder="e.g. BUS-24F-123"
                                className="uppercase"
                                autoCapitalize="characters"
                                data-testid="input-create-leader-id"
                              />
                            </div>
                          </div>
                          {groupRequireTopic && (
                            <div className="space-y-1">
                              <Label className="text-xs">Topic</Label>
                              <Select
                                value={leader.topicId ? String(leader.topicId) : "none"}
                                onValueChange={v => updateCreateMemberField(leaderIdx, "topicId", v === "none" ? null : parseInt(v))}
                              >
                                <SelectTrigger><SelectValue placeholder="Select topic" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">— No topic —</SelectItem>
                                  {(topics ?? []).map((t: any) => (
                                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Members */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-primary uppercase tracking-wide">Members</p>
                      <Button type="button" variant="outline" size="sm" onClick={addCreateMemberRow} data-testid="button-create-add-member">
                        <Plus className="w-4 h-4 mr-1" /> Add member
                      </Button>
                    </div>
                    {creatingGroup.members.map((m, idx) => {
                      if (m.role !== "member") return null;
                      const memberRowIdx = creatingGroup.members
                        .filter((mm, i) => mm.role === "member" && i <= idx).length - 1;
                      return (
                        <div key={idx} className="p-4 border rounded-xl space-y-3 relative">
                          <div className="absolute top-2 right-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeCreateMemberRow(idx)}
                              data-testid={`button-create-remove-member-${memberRowIdx}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Name</Label>
                              <Input
                                value={m.name}
                                onChange={e => updateCreateMemberField(idx, "name", e.target.value)}
                                placeholder="Member name"
                                data-testid={`input-create-member-name-${memberRowIdx}`}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Student ID</Label>
                              <Input
                                value={m.studentId}
                                onChange={e => updateCreateMemberField(idx, "studentId", e.target.value.toUpperCase())}
                                placeholder="e.g. BUS-24F-123"
                                className="uppercase"
                                autoCapitalize="characters"
                                data-testid={`input-create-member-id-${memberRowIdx}`}
                              />
                            </div>
                          </div>
                          {groupRequireTopic && (
                            <div className="space-y-1">
                              <Label className="text-xs">Topic</Label>
                              <Select
                                value={m.topicId ? String(m.topicId) : "none"}
                                onValueChange={v => updateCreateMemberField(idx, "topicId", v === "none" ? null : parseInt(v))}
                              >
                                <SelectTrigger><SelectValue placeholder="Select topic" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">— No topic —</SelectItem>
                                  {(topics ?? []).map((t: any) => (
                                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setCreatingGroup(null)}>Cancel</Button>
                    <Button type="submit" disabled={createSaving} data-testid="button-create-group-save">
                      {createSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Create Group"}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {/* GROUP PROJECT — manage project cycles for group submissions */}
          {activeTab === "group-project" && (
            <div className="max-w-4xl space-y-6">
              {/* Active project banner */}
              <Card className="glass-card border-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Folder className="w-5 h-5 text-primary" /> Active Group Project
                  </CardTitle>
                  <CardDescription>
                    Groups submitted on the home page are stored under the active project. Finalize a project to stop accepting new groups.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const active = projects.find(p => p.id === activeGroupProjectId && p.status === "active");
                    if (active) {
                      const count = (groups || []).filter((g: any) => g.projectId === active.id).length;
                      return (
                        <div className="flex items-center justify-between flex-wrap gap-3 p-4 rounded-xl border border-primary/40 bg-primary/5" data-testid="active-project-banner">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-primary/15 text-primary shrink-0">
                              <Folder className="w-6 h-6" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-lg truncate">{active.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {count} group{count !== 1 ? "s" : ""} submitted · accepting new submissions
                              </p>
                            </div>
                          </div>
                          {isAdmin && (
                            <Button onClick={() => handleFinalizeProject(active.id, active.name)} data-testid="button-finalize-active">
                              <CheckCircle2 className="w-4 h-4 mr-2" /> Finalize Project
                            </Button>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div className="text-center py-8 border border-dashed rounded-xl">
                        <Folder className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                        <p className="font-semibold">No active project</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          Students cannot submit groups until you start a new project.
                        </p>
                        {isAdmin && (
                          <Button onClick={() => setShowNewProjectDialog(true)} data-testid="button-start-from-empty">
                            <FolderPlus className="w-4 h-4 mr-2" /> Start New Project
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* All group projects list */}
              <Card className="glass-card border-none">
                <CardHeader className="flex-row items-center justify-between flex-wrap gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      <Folder className="w-5 h-5 text-primary" /> All Group Projects
                    </CardTitle>
                    <CardDescription>
                      View, download Excel, finalize, or delete each project cycle.
                    </CardDescription>
                  </div>
                  {isAdmin && (
                    <Button onClick={() => setShowNewProjectDialog(true)} data-testid="button-new-group-project">
                      <FolderPlus className="w-4 h-4 mr-2" /> Start New Project
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {projects.length === 0 ? (
                    <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
                      No projects yet.
                    </div>
                  ) : (
                    projects.map(p => {
                      const groupCount = (groups || []).filter((g: any) => g.projectId === p.id).length;
                      const isActive = p.id === activeGroupProjectId && p.status === "active";
                      return (
                        <div key={p.id}
                          className={cn(
                            "p-4 rounded-xl border flex items-center gap-3 flex-wrap",
                            isActive ? "border-primary/40 bg-primary/5" : "bg-background/60"
                          )}
                          data-testid={`group-project-row-${p.id}`}>
                          <div className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                            isActive ? "bg-primary/15 text-primary" : p.status === "finalized" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                          )}>
                            {p.status === "finalized" ? <CheckCircle2 className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold truncate">{p.name}</p>
                              {isActive && <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-primary text-primary-foreground">Active</span>}
                              {p.status === "finalized" && <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-green-600 text-white">Finalized</span>}
                            </div>
                            <p className="text-xs text-muted-foreground">{groupCount} group{groupCount !== 1 ? "s" : ""}</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {canDownload && groupCount > 0 && (
                              <Button variant="outline" size="sm" onClick={async () => {
                                const res = await fetch(`/api/export/excel?projectId=${p.id}`, { headers: authHeader() });
                                if (!res.ok) { toast({ title: "Error", description: "Excel download failed", variant: "destructive" }); return; }
                                const blob = await res.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `groups-${p.folderName || p.id}.xlsx`;
                                a.click();
                                window.URL.revokeObjectURL(url);
                              }} data-testid={`button-export-excel-${p.id}`}>
                                <Download className="w-4 h-4 mr-1" /> Excel
                              </Button>
                            )}
                            {isAdmin && isActive && (
                              <Button variant="default" size="sm" onClick={() => handleFinalizeProject(p.id, p.name)} data-testid={`button-finalize-group-${p.id}`}>
                                <CheckCircle2 className="w-4 h-4 mr-1" /> Finalize
                              </Button>
                            )}
                            {isAdmin && (
                              <Button variant="ghost" size="icon" className="text-destructive"
                                onClick={() => handleDeleteProject(p.id, p.name)} data-testid={`button-delete-group-project-${p.id}`}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* FILE SUBMISSIONS */}
          {activeTab === "file-submissions" && (
            <div className="max-w-4xl space-y-6">
              {isAdmin && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">
                  <SettingsIcon className="w-4 h-4 flex-shrink-0 text-primary" />
                  <span>File submission settings (enable/disable, deadline, page customization) are in the <button className="font-semibold text-primary underline underline-offset-2" onClick={() => setActiveTab("settings")}>Settings</button> tab.</span>
                </div>
              )}

              {/* Submitted files list — grouped by project */}
              <Card className="glass-card border-none overflow-hidden">
                <CardHeader
                  className="flex-row items-center justify-between flex-wrap gap-2 cursor-pointer select-none hover:bg-primary/5 transition-colors"
                  onClick={() => setCollapseSubmittedFiles(v => !v)}
                  data-testid="header-submitted-files"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform shrink-0", collapseSubmittedFiles && "-rotate-90")} />
                    <div className="min-w-0">
                      <CardTitle>Submitted Files</CardTitle>
                      <CardDescription>{fileSubmissionsList.length} submission{fileSubmissionsList.length !== 1 ? "s" : ""} across {projects.length} project{projects.length !== 1 ? "s" : ""}</CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    {canDownload && fileSubmissionsList.length > 0 && (
                      <Button variant="default" size="sm" disabled={isDownloadingZip}
                        onClick={async () => {
                          setIsDownloadingZip(true);
                          try {
                            const res = await fetch("/api/admin/file-submissions/export-zip", { headers: authHeader() });
                            if (!res.ok) { toast({ title: "Error", description: "ZIP export failed", variant: "destructive" }); return; }
                            const blob = await res.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = "all-submissions.zip"; a.click();
                            window.URL.revokeObjectURL(url);
                          } finally { setIsDownloadingZip(false); }
                        }} data-testid="button-download-all-zip">
                        {isDownloadingZip ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                        Download All as ZIP
                      </Button>
                    )}
                    {canEdit && (
                      <Button variant="default" size="sm" onClick={() => {
                        setAdminUploadProjectId(activeFileProjectId ? String(activeFileProjectId) : "");
                        setAdminUploadName(""); setAdminUploadStudentId("");
                        setAdminUploadLeader(""); setAdminUploadTopic(""); setAdminUploadSubject("");
                        setAdminUploadFiles([]);
                        setShowAdminUpload(true);
                      }} data-testid="button-admin-upload">
                        <UploadCloud className="w-4 h-4 mr-2" /> Upload File
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={loadFileSubmissions} data-testid="button-refresh">
                      <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoadingFiles ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                  ) : fileSubmissionsList.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <FileDown className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>No files submitted yet.</p>
                    </div>
                  ) : (() => {
                    // Group submissions by project, sorted by project name
                    const groupsMap = new Map<string, { project: any; subs: any[] }>();
                    for (const sub of fileSubmissionsList) {
                      const key = sub.project ? `${sub.project.name}__${sub.projectId}` : "__no_project__";
                      if (!groupsMap.has(key)) groupsMap.set(key, { project: sub.project, subs: [] });
                      groupsMap.get(key)!.subs.push(sub);
                    }
                    const groupedArr = Array.from(groupsMap.entries()).sort((a, b) => {
                      const aName = a[1].project?.name || "ZZZ";
                      const bName = b[1].project?.name || "ZZZ";
                      return aName.localeCompare(bName);
                    });
                    return (
                      <div>
                        {groupedArr.map(([key, { project, subs }]) => (
                          <div key={key} className="border-b last:border-b-0">
                            <div className="bg-primary/5 px-4 py-2.5 flex items-center gap-2 sticky top-0">
                              <Folder className="w-4 h-4 text-primary" />
                              <p className="font-semibold text-sm flex-1 truncate">{project?.name || "(No project)"}</p>
                              {project?.status === "finalized" && (
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-green-600 text-white">Finalized</span>
                              )}
                              <span className="text-xs text-muted-foreground">{subs.length} file{subs.length !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="divide-y divide-border/50">
                              {subs.map((sub: any) => {
                                const sizeFmt = (b: number) => b > 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`;
                                const isPdf = sub.mimeType === "application/pdf";
                                return (
                                  <div key={sub.id} className="flex items-center gap-4 p-4 hover:bg-primary/5 transition-colors" data-testid={`submission-${sub.id}`}>
                                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold shrink-0",
                                      isPdf ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700")}>
                                      {isPdf ? "PDF" : "PPT"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-semibold truncate">{sub.studentName} <span className="text-xs font-normal text-muted-foreground">· {sub.studentId}</span></p>
                                      {(sub.groupLeader || sub.topic) && (
                                        <p className="text-xs text-muted-foreground truncate">
                                          {sub.groupLeader && <>Leader: {sub.groupLeader}</>}
                                          {sub.groupLeader && sub.topic && " · "}
                                          {sub.topic && <>Topic: {sub.topic}</>}
                                        </p>
                                      )}
                                      <p className="text-xs text-muted-foreground truncate">
                                        <span className="font-medium">{sub.fileName}</span> · {sizeFmt(sub.fileSize)}
                                        {sub.file2Name && <> · <span className="font-medium">{sub.file2Name}</span> · {sizeFmt(sub.file2Size)}</>}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground">{new Date(sub.createdAt).toLocaleString()}</p>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                      {canDownload && (
                                        <Button variant="ghost" size="icon" title="Download file 1"
                                          onClick={async () => {
                                            const res = await fetch(`/api/admin/file-submissions/${sub.id}/download?file=1`, { headers: authHeader() });
                                            if (!res.ok) { toast({ title: "Error", description: "Download failed", variant: "destructive" }); return; }
                                            const blob = await res.blob();
                                            const url = window.URL.createObjectURL(blob);
                                            const a = document.createElement("a");
                                            a.href = url; a.download = sub.fileName; a.click();
                                            window.URL.revokeObjectURL(url);
                                          }} data-testid={`button-download-${sub.id}-1`}>
                                          <Download className="w-4 h-4" />
                                        </Button>
                                      )}
                                      {canDownload && sub.file2Name && (
                                        <Button variant="ghost" size="icon" title="Download file 2"
                                          onClick={async () => {
                                            const res = await fetch(`/api/admin/file-submissions/${sub.id}/download?file=2`, { headers: authHeader() });
                                            if (!res.ok) { toast({ title: "Error", description: "Download failed", variant: "destructive" }); return; }
                                            const blob = await res.blob();
                                            const url = window.URL.createObjectURL(blob);
                                            const a = document.createElement("a");
                                            a.href = url; a.download = sub.file2Name; a.click();
                                            window.URL.revokeObjectURL(url);
                                          }} data-testid={`button-download-${sub.id}-2`}>
                                          <Download className="w-4 h-4 opacity-60" />
                                        </Button>
                                      )}
                                      {canEdit && (
                                        <Button variant="ghost" size="icon" className="text-destructive"
                                          onClick={async () => {
                                            if (!confirm(`Delete submission from ${sub.studentName}?`)) return;
                                            await fetch(`/api/admin/file-submissions/${sub.id}`, { method: "DELETE", headers: authHeader() });
                                            loadFileSubmissions();
                                            toast({ title: "Deleted", description: "File submission removed" });
                                          }} data-testid={`button-delete-${sub.id}`}>
                                          <Trash2 className="w-4 h-4" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Admin upload dialog (no restrictions) */}
              <Dialog open={showAdminUpload} onOpenChange={setShowAdminUpload}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-admin-upload">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <UploadCloud className="w-5 h-5 text-primary" /> Admin File Upload
                    </DialogTitle>
                    <DialogDescription>
                      Upload any file (any type, any size) on behalf of a student. Bypasses deadlines, toggles, and file-type filters.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-2">
                    {/* Project picker */}
                    <div className="space-y-1.5">
                      <Label>Target Project</Label>
                      <Select value={adminUploadProjectId || "none"} onValueChange={(v) => setAdminUploadProjectId(v === "none" ? "" : v)}>
                        <SelectTrigger data-testid="select-upload-project"><SelectValue placeholder="Choose project" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No project (loose file)</SelectItem>
                          {projects.map(p => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.name} {p.id === activeFileProjectId ? "· active" : p.status === "finalized" ? "· finalized" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Required fields */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Student Name <span className="text-destructive">*</span></Label>
                        <Input value={adminUploadName} onChange={e => setAdminUploadName(e.target.value)} placeholder="Full name" data-testid="input-upload-name" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Student ID <span className="text-destructive">*</span></Label>
                        <Input value={adminUploadStudentId} onChange={e => setAdminUploadStudentId(e.target.value.toUpperCase())} placeholder="e.g. BUS-25F-100" className="uppercase" autoCapitalize="characters" data-testid="input-upload-student-id" />
                      </div>
                    </div>

                    {/* Optional fields */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Group Leader</Label>
                        <Input value={adminUploadLeader} onChange={e => setAdminUploadLeader(e.target.value)} placeholder="(optional)" data-testid="input-upload-leader" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Topic</Label>
                        <Input value={adminUploadTopic} onChange={e => setAdminUploadTopic(e.target.value)} placeholder="(optional)" data-testid="input-upload-topic" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground">Subject</Label>
                      <Input value={adminUploadSubject} onChange={e => setAdminUploadSubject(e.target.value)} placeholder="(optional)" data-testid="input-upload-subject" />
                    </div>

                    {/* File picker */}
                    <div className="space-y-1.5">
                      <Label>Files (1 – 2)</Label>
                      <div className="border-2 border-dashed rounded-lg p-4 text-center bg-muted/30">
                        <input
                          type="file"
                          multiple
                          id="admin-upload-files"
                          className="hidden"
                          onChange={(e) => {
                            const fl = Array.from(e.target.files || []).slice(0, 2);
                            setAdminUploadFiles(fl);
                          }}
                          data-testid="input-upload-files"
                        />
                        <label htmlFor="admin-upload-files" className="cursor-pointer flex flex-col items-center gap-2">
                          <UploadCloud className="w-8 h-8 text-primary" />
                          <span className="text-sm font-medium">Click to choose file(s)</span>
                          <span className="text-xs text-muted-foreground">Any type, any size — no restrictions</span>
                        </label>
                      </div>
                      {adminUploadFiles.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {adminUploadFiles.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs p-2 bg-primary/5 rounded">
                              <FileDown className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="font-medium truncate flex-1">{f.name}</span>
                              <span className="text-muted-foreground">
                                {f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(2)} MB` : `${(f.size / 1024).toFixed(1)} KB`}
                              </span>
                              <button type="button" className="text-destructive hover:text-destructive/80"
                                onClick={() => setAdminUploadFiles(prev => prev.filter((_, idx) => idx !== i))}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowAdminUpload(false)} disabled={adminUploadBusy}>Cancel</Button>
                    <Button
                      disabled={adminUploadBusy || !adminUploadName.trim() || !adminUploadStudentId.trim() || adminUploadFiles.length === 0}
                      onClick={async () => {
                        setAdminUploadBusy(true);
                        try {
                          const fd = new FormData();
                          fd.append("studentName", adminUploadName.trim());
                          fd.append("studentId", adminUploadStudentId.trim());
                          if (adminUploadLeader.trim()) fd.append("groupLeader", adminUploadLeader.trim());
                          if (adminUploadTopic.trim()) fd.append("topic", adminUploadTopic.trim());
                          if (adminUploadSubject.trim()) fd.append("subject", adminUploadSubject.trim());
                          if (adminUploadProjectId) fd.append("projectId", adminUploadProjectId);
                          for (const f of adminUploadFiles) fd.append("files", f);
                          const res = await fetch(`/api/admin/file-submit${adminUploadProjectId ? `?projectId=${adminUploadProjectId}` : ""}`, {
                            method: "POST",
                            headers: { ...authHeader() },
                            body: fd,
                          });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            toast({ title: "Upload failed", description: data.message || "Could not upload file", variant: "destructive" });
                            return;
                          }
                          toast({ title: "Uploaded", description: "File added successfully" });
                          setShowAdminUpload(false);
                          loadFileSubmissions();
                        } catch (err: any) {
                          toast({ title: "Upload failed", description: err.message || "Network error", variant: "destructive" });
                        } finally {
                          setAdminUploadBusy(false);
                        }
                      }}
                      data-testid="button-do-upload"
                    >
                      {adminUploadBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
                      Upload
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* UNIFIED SETTINGS */}
          {activeTab === "settings" && (
            <div className="max-w-3xl space-y-10">

              {/* ── SECTION 1: Group Submission Settings ─────────────────── */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">Group Submission Settings</h2>
                    <p className="text-sm text-muted-foreground">Configure the group formation form shown to students</p>
                  </div>
                </div>
                <div className="space-y-4">

                  {/* Project Name */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><LayoutDashboard className="w-4 h-4 text-primary" /> Project Name</CardTitle>
                      <CardDescription>The project name appears as the title on the student registration page.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-3 items-end">
                      <div className="flex-1 space-y-1">
                        <Input placeholder="e.g. CS101 Group Registration" value={projectName} onChange={e => setProjectName(e.target.value)} />
                      </div>
                      <Button onClick={handleUpdateProjectName}>Save</Button>
                    </CardContent>
                  </Card>

                  {/* Required Members */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Required Members per Group</CardTitle>
                      <CardDescription>Set how many members (excluding the leader) each group must have.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-3 items-end">
                      <div className="flex-1">
                        <Input type="number" min="1" placeholder="e.g. 6" value={memberCount} onChange={e => setMemberCount(e.target.value)} />
                      </div>
                      <Button onClick={handleUpdateMemberCount}>Save</Button>
                    </CardContent>
                  </Card>

                  {/* Form Field Toggles */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><SettingsIcon className="w-4 h-4 text-primary" /> Form Fields</CardTitle>
                      <CardDescription>Control which optional fields appear on the group submission form.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between p-3 border rounded-xl bg-background/60">
                        <div>
                          <p className="font-semibold text-sm">Require Group Leader</p>
                          <p className="text-xs text-muted-foreground">When off, the "Group Leader" section is hidden.</p>
                        </div>
                        <Switch checked={groupRequireLeader} onCheckedChange={async (val) => {
                          setGroupRequireLeader(val);
                          await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "group_require_leader", value: String(val) }) });
                          toast({ title: "Updated", description: `Group leader is now ${val ? "required" : "hidden"}` });
                        }} data-testid="switch-group-require-leader" />
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-xl bg-background/60">
                        <div>
                          <p className="font-semibold text-sm">Require Project Topic</p>
                          <p className="text-xs text-muted-foreground">When off, the "Project Topic" dropdown is hidden.</p>
                        </div>
                        <Switch checked={groupRequireTopic} onCheckedChange={async (val) => {
                          setGroupRequireTopic(val);
                          await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "group_require_topic", value: String(val) }) });
                          toast({ title: "Updated", description: `Project topic is now ${val ? "required" : "hidden"}` });
                        }} data-testid="switch-group-require-topic" />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Submission Rules */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /> Submission Rules</CardTitle>
                      <CardDescription>Displayed to students when they first visit the site.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <textarea
                        className="w-full h-40 p-3 text-sm bg-background border rounded-md font-mono resize-y"
                        value={rules}
                        onChange={e => setRules(e.target.value)}
                        placeholder="Write the submission rules here..."
                      />
                      <Button className="w-full" onClick={handleUpdateRules}>Update Rules</Button>
                    </CardContent>
                  </Card>

                  {/* Project Topics */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /> Project Topics</CardTitle>
                          <CardDescription>Topics that student groups can choose from.</CardDescription>
                        </div>
                        <Dialog>
                          <DialogTrigger asChild><Button size="sm">Add Topic</Button></DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Add New Topic</DialogTitle><DialogDescription>Enter a name for the new project topic.</DialogDescription></DialogHeader>
                            <div className="space-y-4 pt-4">
                              <div className="space-y-2"><Label>Topic Name</Label><Input value={newTopicName} onChange={e => setNewTopicName(e.target.value)} placeholder="e.g. Artificial Intelligence" /></div>
                              <Button className="w-full" onClick={async () => { const res = await fetch("/api/admin/topics", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ name: newTopicName }) }); if (res.ok) { setNewTopicName(""); refetch(); window.location.reload(); } }}>Create Topic</Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {topics?.map((topic: any) => (
                        <div key={topic.id} className="flex items-center justify-between p-3 border rounded-lg bg-background/50">
                          <div>
                            <div className="font-semibold text-sm">{topic.name}</div>
                            <div className="text-xs text-muted-foreground">{topic.description || "No description"}</div>
                          </div>
                          <div className="flex gap-1">
                            <Dialog>
                              <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingTopic(topic)}><Edit className="w-4 h-4" /></Button></DialogTrigger>
                              <DialogContent>
                                <DialogHeader><DialogTitle>Edit Topic</DialogTitle><DialogDescription>Update the topic name.</DialogDescription></DialogHeader>
                                <div className="space-y-4 pt-4">
                                  <Input value={editingTopic?.name || ""} onChange={e => setEditingTopic({ ...editingTopic, name: e.target.value })} />
                                  <Button className="w-full" onClick={async () => { await fetch(`/api/admin/topics/${editingTopic.id}`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ name: editingTopic.name }) }); setEditingTopic(null); window.location.reload(); }}>Update Topic</Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={async () => { if (confirm("Delete this topic?")) { await fetch(`/api/admin/topics/${topic.id}`, { method: "DELETE", headers: authHeader() }); window.location.reload(); } }}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </div>
                      ))}
                      {(!topics || topics.length === 0) && <p className="text-sm text-muted-foreground text-center py-3">No topics yet.</p>}
                      <div className="p-3 border border-dashed rounded-lg bg-primary/5 text-sm text-primary flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Tip: Add "Own Choice" to give students flexibility.</div>
                    </CardContent>
                  </Card>

                  {/* Project Deadlines */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><ClockIcon className="w-4 h-4 text-primary" /> Project Deadlines</CardTitle>
                      <CardDescription>Set the submission deadline per project cycle. Drives the live countdown timer on the student page.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {projects.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic py-4 text-center">No projects yet. Create a project cycle in File Submissions first.</p>
                      ) : (
                        projects.map(p => {
                          const isActive = p.id === activeGroupProjectId || p.id === activeFileProjectId;
                          const editValue = projectDeadlineEdits[p.id];
                          const isDirty = editValue !== undefined;
                          const isSaving = projectDeadlineSaving === p.id;
                          const currentDeadlineLocal = p.deadline ? new Date(p.deadline).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
                          const inputDefault = p.deadline ? new Date(new Date(p.deadline).getTime() - new Date(p.deadline).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
                          return (
                            <div key={p.id} className={`p-3 border rounded-xl space-y-2 ${isActive ? "border-primary/40 bg-primary/5" : "bg-background/60"}`}>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? "bg-green-500" : p.status === "finalized" ? "bg-muted-foreground" : "bg-yellow-500"}`} />
                                  <span className="font-semibold text-sm truncate">{p.name}</span>
                                  {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-bold uppercase flex-shrink-0">Active</span>}
                                  {p.status === "finalized" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-bold uppercase flex-shrink-0">Closed</span>}
                                </div>
                                <span className="text-xs text-muted-foreground flex-shrink-0">{currentDeadlineLocal ? <span className="flex items-center gap-1"><ClockIcon className="w-3 h-3" />{currentDeadlineLocal}</span> : <span className="italic">No deadline</span>}</span>
                              </div>
                              <div className="flex gap-2 items-center">
                                <Input type="datetime-local" className="flex-1" value={isDirty ? editValue : inputDefault} onChange={e => setProjectDeadlineEdits(prev => ({ ...prev, [p.id]: e.target.value }))} data-testid={`input-project-deadline-${p.id}`} />
                                <Button size="sm" disabled={isSaving || !isDirty} onClick={() => handleSaveProjectDeadline(p.id, editValue || null)} data-testid={`button-save-deadline-${p.id}`}>{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Button>
                                {p.deadline && <Button size="sm" variant="outline" disabled={isSaving} onClick={() => { setProjectDeadlineEdits(prev => ({ ...prev, [p.id]: "" })); handleSaveProjectDeadline(p.id, null); }} data-testid={`button-clear-deadline-${p.id}`}>Clear</Button>}
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div className="border-t pt-3 mt-2">
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Global Fallback Deadline</p>
                        <p className="text-xs text-muted-foreground mb-3">Used only if no project deadline is set. Set relative to now.</p>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div className="space-y-1"><Label className="text-xs">Hours from now</Label><Input type="number" min="0" placeholder="0" value={newDeadlineHours} onChange={e => setNewDeadlineHours(e.target.value)} data-testid="input-deadline-hours" /></div>
                          <div className="space-y-1"><Label className="text-xs">Minutes from now</Label><Input type="number" min="0" max="59" placeholder="0" value={newDeadlineMinutes} onChange={e => setNewDeadlineMinutes(e.target.value)} data-testid="input-deadline-minutes" /></div>
                        </div>
                        <Button className="w-full" onClick={handleUpdateDeadline} data-testid="button-set-global-deadline">Set Global Deadline</Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* ── SECTION 2: File Submission Settings ──────────────────── */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <FileDown className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">File Submission Settings</h2>
                    <p className="text-sm text-muted-foreground">Configure the file upload form at /file-submit</p>
                  </div>
                </div>
                <div className="space-y-4">

                  {/* Enable/Disable */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><FileDown className="w-4 h-4 text-primary" /> File Submission Access</CardTitle>
                      <CardDescription>When enabled, students can upload files at /file-submit. A navigation link also appears.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between p-3 border rounded-xl bg-background/60">
                        <div>
                          <p className="font-semibold text-sm">File Submissions</p>
                          <p className="text-xs text-muted-foreground">Currently: <span className={fileSubmissionsEnabled ? "text-green-600 font-medium" : "text-destructive font-medium"}>{fileSubmissionsEnabled ? "Enabled" : "Disabled"}</span></p>
                        </div>
                        <Button onClick={async () => { const newVal = !fileSubmissionsEnabled; await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_enabled", value: String(newVal) }) }); setFileSubmissionsEnabled(newVal); toast({ title: "Updated", description: `File submissions ${newVal ? "enabled" : "disabled"}` }); }} variant={fileSubmissionsEnabled ? "destructive" : "default"} className="min-w-[100px]">{fileSubmissionsEnabled ? "Disable" : "Enable"}</Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Deadline */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><ClockIcon className="w-4 h-4 text-primary" /> File Submission Deadline</CardTitle>
                      <CardDescription>Set a countdown timer for the file submission form.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Hours</Label><Input type="number" min="0" placeholder="0" value={fileDeadlineHours} onChange={e => setFileDeadlineHours(e.target.value)} /></div>
                        <div className="space-y-1"><Label className="text-xs">Minutes</Label><Input type="number" min="0" max="59" placeholder="0" value={fileDeadlineMinutes} onChange={e => setFileDeadlineMinutes(e.target.value)} /></div>
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={async () => { const date = new Date(); date.setHours(date.getHours() + (parseInt(fileDeadlineHours) || 0)); date.setMinutes(date.getMinutes() + (parseInt(fileDeadlineMinutes) || 0)); await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_deadline", value: date.toISOString() }) }); toast({ title: "Deadline Set", description: `Set to ${date.toLocaleString()}` }); setFileDeadlineHours(""); setFileDeadlineMinutes(""); }}>Set Deadline</Button>
                        <Button variant="outline" onClick={async () => { await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_deadline", value: "" }) }); toast({ title: "Cleared" }); }}>Clear</Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Page Customization */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><SettingsIcon className="w-4 h-4 text-primary" /> Page Customization</CardTitle>
                      <CardDescription>Texts shown to students on the file submission page.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-3 items-end">
                        <div className="flex-1 space-y-1"><Label className="text-xs font-semibold">Page Title</Label><p className="text-xs text-muted-foreground">Main heading at top of page</p><Input value={fileSubmissionTitle} onChange={e => setFileSubmissionTitle(e.target.value)} placeholder="e.g. File Submission" /></div>
                        <Button onClick={async () => { await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_title", value: fileSubmissionTitle }) }); toast({ title: "Saved" }); }}>Save</Button>
                      </div>
                      <div className="flex gap-3 items-end">
                        <div className="flex-1 space-y-1"><Label className="text-xs font-semibold">Subject Heading</Label><p className="text-xs text-muted-foreground">Bold subtitle (e.g. course name)</p><Input value={fileSubmissionSubjectLabel} onChange={e => setFileSubmissionSubjectLabel(e.target.value)} placeholder="e.g. Management Information Systems" /></div>
                        <Button onClick={async () => { await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_subject_label", value: fileSubmissionSubjectLabel }) }); toast({ title: "Saved" }); }}>Save</Button>
                      </div>
                      <div className="flex gap-3 items-end">
                        <div className="flex-1 space-y-1"><Label className="text-xs font-semibold">Project Title</Label><p className="text-xs text-muted-foreground">Italic text below subject</p><Input value={fileSubmissionProjectTitle} onChange={e => setFileSubmissionProjectTitle(e.target.value)} placeholder="e.g. 7 Habits of Highly Effective People" /></div>
                        <Button onClick={async () => { await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_project_title", value: fileSubmissionProjectTitle }) }); toast({ title: "Saved" }); }}>Save</Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Project Cycles */}
                  <Card className="glass-card border-none">
                    <CardHeader className="flex-row items-center justify-between flex-wrap gap-3 cursor-pointer select-none hover:bg-primary/5 transition-colors rounded-t-xl pb-3" onClick={() => setCollapseProjects(v => !v)} data-testid="header-projects">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform shrink-0", collapseProjects && "-rotate-90")} />
                        <div className="min-w-0">
                          <CardTitle className="text-base flex items-center gap-2"><Folder className="w-4 h-4 text-primary" /> Project Cycles</CardTitle>
                          <CardDescription>Manage submission cycles. Finalize to lock and start a new one.</CardDescription>
                        </div>
                      </div>
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); setShowNewProjectDialog(true); }} data-testid="button-new-project"><FolderPlus className="w-4 h-4 mr-2" /> New Project</Button>
                    </CardHeader>
                    {!collapseProjects && (
                      <CardContent className="space-y-2">
                        {projects.length === 0 ? (
                          <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">No projects yet. Click "New Project" to begin.</div>
                        ) : (
                          projects.map(p => {
                            const count = fileSubmissionsList.filter(s => s.projectId === p.id).length;
                            const isActive = p.id === activeFileProjectId && p.status === "active";
                            return (
                              <div key={p.id} className={cn("p-3 rounded-xl border flex items-center gap-3 flex-wrap", isActive ? "border-primary/40 bg-primary/5" : "bg-background/60")} data-testid={`project-row-${p.id}`}>
                                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", isActive ? "bg-primary/15 text-primary" : p.status === "finalized" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")}>
                                  {p.status === "finalized" ? <CheckCircle2 className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold text-sm truncate">{p.name}</p>
                                    {isActive && <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-primary text-primary-foreground">Active</span>}
                                    {p.status === "finalized" && <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-green-600 text-white">Finalized</span>}
                                  </div>
                                  <p className="text-xs text-muted-foreground">{count} submission{count !== 1 ? "s" : ""} · {p.folderName}</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  {canDownload && count > 0 && <Button variant="outline" size="sm" onClick={async () => { const res = await fetch(`/api/admin/file-submissions/export-zip?projectId=${p.id}`, { headers: authHeader() }); if (!res.ok) { toast({ title: "Error", description: "Download failed", variant: "destructive" }); return; } const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${p.folderName}.zip`; a.click(); window.URL.revokeObjectURL(url); }} data-testid={`button-zip-project-${p.id}`}><Download className="w-4 h-4 mr-1" />ZIP</Button>}
                                  {isActive && <Button variant="default" size="sm" onClick={() => handleFinalizeProject(p.id, p.name)} data-testid={`button-finalize-${p.id}`}><CheckCircle2 className="w-4 h-4 mr-1" />Finalize</Button>}
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteProject(p.id, p.name)} data-testid={`button-delete-project-${p.id}`}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </CardContent>
                    )}
                  </Card>

                  {/* Allowed File Types */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><Paperclip className="w-4 h-4 text-primary" /> Allowed File Types</CardTitle>
                      <CardDescription>Select which file types students can upload.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {[
                        { key: "pdf", label: "PDF Documents (.pdf)" },
                        { key: "ppt", label: "PowerPoint (.ppt, .pptx)" },
                        { key: "doc", label: "Word Documents (.doc, .docx)" },
                        { key: "xls", label: "Excel Spreadsheets (.xls, .xlsx)" },
                        { key: "zip", label: "ZIP Archives (.zip)" },
                        { key: "image", label: "Images (.jpg, .png, .gif, .webp)" },
                        { key: "txt", label: "Text Files (.txt)" },
                      ].map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-3 p-3 border rounded-xl bg-background/60 cursor-pointer hover:bg-primary/5 transition-colors" data-testid={`checkbox-filetype-${key}`}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={allowedFileTypes.includes(key)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...allowedFileTypes, key]
                                : allowedFileTypes.filter(t => t !== key);
                              if (next.length === 0) { toast({ title: "Error", description: "At least one file type must be selected", variant: "destructive" }); return; }
                              setAllowedFileTypes(next);
                            }}
                          />
                          <span className="text-sm font-medium">{label}</span>
                        </label>
                      ))}
                      <Button className="w-full" onClick={async () => {
                        await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "allowed_file_types", value: JSON.stringify(allowedFileTypes) }) });
                        toast({ title: "Saved", description: `Allowed: ${allowedFileTypes.join(", ").toUpperCase()}` });
                      }} data-testid="button-save-file-types">Save File Types</Button>
                    </CardContent>
                  </Card>

                  {/* Submission Form Settings */}
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><SettingsIcon className="w-4 h-4 text-primary" /> Submission Form Fields</CardTitle>
                      <CardDescription>Control required fields and maximum file size for uploaded files.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-3 items-end">
                        <div className="flex-1 space-y-1"><Label className="text-xs font-semibold">Maximum File Size (MB)</Label><p className="text-xs text-muted-foreground">Allowed range: 1–100 MB</p><Input type="number" min="1" max="100" value={maxFileSizeMb} onChange={e => setMaxFileSizeMb(e.target.value)} data-testid="input-max-size" /></div>
                        <Button onClick={async () => { const v = Math.max(1, Math.min(100, parseInt(maxFileSizeMb) || 5)); await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_max_size_mb", value: String(v) }) }); setMaxFileSizeMb(String(v)); toast({ title: "Saved", description: `Max file size: ${v} MB` }); }} data-testid="button-save-max-size">Save</Button>
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-xl bg-background/60">
                        <div><p className="font-semibold text-sm">Require Group Leader Field</p><p className="text-xs text-muted-foreground">Students must enter the group leader's name.</p></div>
                        <Switch checked={requireLeader} onCheckedChange={async (val) => { setRequireLeader(val); await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_require_leader", value: String(val) }) }); toast({ title: "Updated" }); }} data-testid="switch-require-leader" />
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-xl bg-background/60">
                        <div><p className="font-semibold text-sm">Require Project Topic Field</p><p className="text-xs text-muted-foreground">Students must enter the project topic.</p></div>
                        <Switch checked={requireTopic} onCheckedChange={async (val) => { setRequireTopic(val); await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "file_submission_require_topic", value: String(val) }) }); toast({ title: "Updated" }); }} data-testid="switch-require-topic" />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* ── SECTION 3: Student Portal Settings ───────────────────── */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">Student Portal Settings</h2>
                    <p className="text-sm text-muted-foreground">Control access to the student login and portal features</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <Card className="glass-card border-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> Student Login Page</CardTitle>
                      <CardDescription>When enabled, students can register and sign in at /student-login. A "Student Login" button appears in the navigation bar.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between p-3 border rounded-xl bg-background/60">
                        <div>
                          <p className="font-semibold text-sm">Student Login</p>
                          <p className="text-xs text-muted-foreground">Currently: <span className={studentLoginEnabled ? "text-green-600 font-medium" : "text-muted-foreground font-medium"}>{studentLoginEnabled ? "Enabled" : "Disabled"}</span></p>
                        </div>
                        <Switch checked={studentLoginEnabled} onCheckedChange={async (val) => { setStudentLoginEnabled(val); await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json", ...authHeader() }, body: JSON.stringify({ key: "student_login_enabled", value: String(val) }) }); toast({ title: "Updated", description: `Student login ${val ? "enabled" : "disabled"}` }); }} data-testid="switch-student-login-enabled" />
                      </div>
                    </CardContent>
                  </Card>
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">
                    <GraduationCap className="w-4 h-4 flex-shrink-0 text-primary" />
                    <span>To manage student accounts (view, reset passwords, delete), go to the <button className="font-semibold text-primary underline underline-offset-2" onClick={() => setActiveTab("students")}>Student Accounts</button> tab.</span>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* STUDENT ACCOUNTS */}
          {activeTab === "students" && (
            <div className="max-w-5xl space-y-6">
              <Card className="glass-card border-none">
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <GraduationCap className="w-5 h-5 text-primary" /> Registered Students
                      </CardTitle>
                      <CardDescription>All student accounts. Unverified accounts cannot log in until their email is confirmed.</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" className="gap-2" onClick={loadStudentAccounts} data-testid="btn-refresh-students">
                      <RefreshCcw className="w-4 h-4" /> Refresh
                    </Button>
                  </div>
                  <div className="pt-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name, student ID or email..."
                        value={studentSearchTerm}
                        onChange={e => setStudentSearchTerm(e.target.value)}
                        className="pl-9"
                        data-testid="input-student-search"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {studentAccountsList.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>No student accounts registered yet.</p>
                    </div>
                  ) : (() => {
                    const q = studentSearchTerm.toLowerCase();
                    const filtered = studentAccountsList.filter(s =>
                      s.name.toLowerCase().includes(q) ||
                      s.studentId.toLowerCase().includes(q) ||
                      s.email.toLowerCase().includes(q)
                    );
                    const verified = filtered.filter(s => s.isVerified).length;
                    const unverified = filtered.filter(s => !s.isVerified).length;
                    return (
                      <>
                        {/* Summary badges */}
                        <div className="flex gap-3 mb-4 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                            <MailCheck className="w-3.5 h-3.5" /> {verified} Verified
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                            <MailX className="w-3.5 h-3.5" /> {unverified} Pending Verification
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary text-muted-foreground text-xs font-semibold">
                            Total: {filtered.length}
                          </span>
                        </div>

                        {filtered.length === 0 ? (
                          <p className="text-muted-foreground text-sm text-center py-6">No results match your search.</p>
                        ) : (
                          <div className="space-y-2">
                            {filtered.map(student => (
                              <div key={student.id}
                                data-testid={`row-student-${student.id}`}
                                className="flex items-center justify-between p-4 border rounded-xl bg-background/60 gap-3 flex-wrap"
                              >
                                {/* Avatar + info */}
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm shrink-0">
                                    {student.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-sm truncate">{student.name}</p>
                                    <p className="text-xs text-muted-foreground">ID: {student.studentId}</p>
                                    <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                                  </div>
                                </div>

                                {/* Status + actions */}
                                <div className="flex items-center gap-2 shrink-0">
                                  {student.isVerified ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                                      <BadgeCheck className="w-3.5 h-3.5" /> Verified
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                                      <MailX className="w-3.5 h-3.5" /> Unverified
                                    </span>
                                  )}

                                  {!student.isVerified && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-xs gap-1 text-green-700 border-green-200 hover:bg-green-50"
                                      disabled={studentActionLoading === student.id}
                                      data-testid={`btn-verify-student-${student.id}`}
                                      onClick={async () => {
                                        setStudentActionLoading(student.id);
                                        const res = await fetch(`/api/admin/students/${student.id}/verify`, {
                                          method: "POST", headers: authHeader(),
                                        });
                                        setStudentActionLoading(null);
                                        if (res.ok) {
                                          toast({ title: "Verified", description: `${student.name} has been manually verified.` });
                                          loadStudentAccounts();
                                        } else {
                                          toast({ title: "Error", description: "Could not verify student.", variant: "destructive" });
                                        }
                                      }}
                                    >
                                      {studentActionLoading === student.id
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <BadgeCheck className="w-3 h-3" />}
                                      Verify
                                    </Button>
                                  )}

                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                                    disabled={studentActionLoading === student.id}
                                    data-testid={`btn-delete-student-${student.id}`}
                                    onClick={async () => {
                                      if (!confirm(`Delete ${student.name}'s account? This cannot be undone.`)) return;
                                      setStudentActionLoading(student.id);
                                      const res = await fetch(`/api/admin/students/${student.id}`, {
                                        method: "DELETE", headers: authHeader(),
                                      });
                                      setStudentActionLoading(null);
                                      if (res.ok) {
                                        toast({ title: "Deleted", description: `${student.name}'s account has been removed.` });
                                        loadStudentAccounts();
                                      } else {
                                        toast({ title: "Error", description: "Could not delete student.", variant: "destructive" });
                                      }
                                    }}
                                  >
                                    {studentActionLoading === student.id
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : <Trash2 className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
          )}

          {/* STAFF MANAGEMENT */}
          {activeTab === "staff" && (
            <div className="max-w-4xl space-y-6">
              {/* Create account */}
              <Card className="glass-card border-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-primary" /> Create Staff Account
                  </CardTitle>
                  <CardDescription>Give others limited access to the admin panel with specific roles.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Username</Label>
                      <Input placeholder="e.g. teacher1" value={newStaffUsername} onChange={e => setNewStaffUsername(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Password</Label>
                      <Input type="password" placeholder="Password" value={newStaffPassword} onChange={e => setNewStaffPassword(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={newStaffRole} onValueChange={setNewStaffRole}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer — View only</SelectItem>
                          <SelectItem value="editor">Editor — View + Edit/Delete</SelectItem>
                          <SelectItem value="downloader">Downloader — View + Export</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Role descriptions */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                    {["viewer", "editor", "downloader"].map(r => {
                      const info = ROLE_LABELS[r];
                      return (
                        <div key={r} className={cn("p-3 rounded-lg border text-xs space-y-1", newStaffRole === r ? "border-primary/50 bg-primary/5" : "")}>
                          <div className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold text-[11px]", info.color)}>
                            <info.icon className="w-3 h-3" /> {info.label}
                          </div>
                          <p className="text-muted-foreground">{info.perms}</p>
                        </div>
                      );
                    })}
                  </div>

                  <Button className="w-full" onClick={handleAddStaff} disabled={isAddingStaff}>
                    {isAddingStaff ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Account
                  </Button>
                </CardContent>
              </Card>

              {/* Existing staff */}
              <Card className="glass-card border-none">
                <CardHeader>
                  <CardTitle>Existing Staff Accounts</CardTitle>
                  <CardDescription>Staff can log in at the same /admin page using their credentials.</CardDescription>
                </CardHeader>
                <CardContent>
                  {staffList.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-6">No staff accounts yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {staffList.map(staff => {
                        const info = ROLE_LABELS[staff.role] || ROLE_LABELS.viewer;
                        return (
                          <div key={staff.username} className="flex items-center justify-between p-4 border rounded-lg bg-background/50">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                                {staff.username[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold text-sm">{staff.username}</div>
                                <div className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold mt-0.5", info.color)}>
                                  <info.icon className="w-2.5 h-2.5" /> {info.label}
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="ghost" size="icon" className="text-destructive"
                              onClick={() => handleDeleteStaff(staff.username)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ANNOUNCEMENTS */}
          {activeTab === "announcements" && (
            <div className="max-w-3xl space-y-6">
              <Card className="glass-card border-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Megaphone className="w-5 h-5 text-primary" /> Post Announcement
                  </CardTitle>
                  <CardDescription>Announcements are visible to all logged-in students on their portal.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input placeholder="e.g. Deadline extended" value={annTitle} onChange={e => setAnnTitle(e.target.value)} data-testid="input-ann-title" />
                  </div>
                  <div className="space-y-2">
                    <Label>Message</Label>
                    <textarea
                      className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                      placeholder="Write the full notice here…"
                      value={annContent}
                      onChange={e => setAnnContent(e.target.value)}
                      data-testid="textarea-ann-content"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={annPriority} onValueChange={setAnnPriority}>
                      <SelectTrigger data-testid="select-ann-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info"><span className="flex items-center gap-2"><Info className="w-4 h-4 text-blue-500" /> Info</span></SelectItem>
                        <SelectItem value="warning"><span className="flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" /> Warning</span></SelectItem>
                        <SelectItem value="important"><span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" /> Important</span></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleCreateAnnouncement} disabled={annLoading || !annTitle.trim() || !annContent.trim()} className="w-full gap-2" data-testid="button-post-announcement">
                    {annLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    Post Announcement
                  </Button>
                </CardContent>
              </Card>

              <Card className="glass-card border-none">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Posted Announcements</span>
                    <span className="text-sm font-normal text-muted-foreground">{announcements.length} total</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {announcements.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Megaphone className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-sm">No announcements posted yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {[...announcements].reverse().map(ann => {
                        const colors: Record<string, string> = {
                          important: "border-l-4 border-l-red-400 bg-red-50",
                          warning: "border-l-4 border-l-amber-400 bg-amber-50",
                          info: "border-l-4 border-l-blue-400 bg-blue-50",
                        };
                        return (
                          <div key={ann.id} className={`rounded-lg p-4 flex items-start gap-3 ${colors[ann.priority] || colors.info}`}>
                            {ann.priority === "important" && <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />}
                            {ann.priority === "warning" && <Star className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />}
                            {ann.priority === "info" && <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm">{ann.title}</p>
                              <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{ann.content}</p>
                              <p className="text-xs text-muted-foreground/60 mt-2">{new Date(ann.createdAt).toLocaleString()}</p>
                            </div>
                            <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 flex-shrink-0"
                              onClick={() => handleDeleteAnnouncement(ann.id)} data-testid={`button-delete-ann-${ann.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "calendar" && (
            <div className="max-w-3xl space-y-6">
              <Card className="glass-card border-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-primary" />
                    {calEvEditId !== null ? "Edit Event" : "Create Calendar Event"}
                  </CardTitle>
                  <CardDescription>Events appear on student calendars. Attach files (PDFs, docs) students can download.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label>Event Title *</Label>
                      <Input placeholder="e.g. Final Project Submission" value={calEvTitle} onChange={e => setCalEvTitle(e.target.value)} data-testid="input-cal-title" />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select value={calEvType} onValueChange={setCalEvType}>
                        <SelectTrigger data-testid="select-cal-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="assignment">📝 Assignment</SelectItem>
                          <SelectItem value="exam">📋 Exam</SelectItem>
                          <SelectItem value="activity">🎯 Activity</SelectItem>
                          <SelectItem value="holiday">🎉 Holiday</SelectItem>
                          <SelectItem value="other">📌 Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Date *</Label>
                      <Input type="date" value={calEvDate} onChange={e => setCalEvDate(e.target.value)} data-testid="input-cal-date" />
                    </div>
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input type="time" value={calEvStartTime} onChange={e => setCalEvStartTime(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input type="time" value={calEvEndTime} onChange={e => setCalEvEndTime(e.target.value)} />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Visible To</Label>
                      <Select value={calEvSemester} onValueChange={setCalEvSemester}>
                        <SelectTrigger data-testid="select-cal-semester"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">🌐 All Semesters</SelectItem>
                          {["1","2","3","4","5","6","7","8"].map(s => (
                            <SelectItem key={s} value={s}>Semester {s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Description</Label>
                      <textarea
                        className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                        placeholder="Describe the event, requirements, or instructions…"
                        value={calEvDesc}
                        onChange={e => setCalEvDesc(e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Attach File <span className="text-muted-foreground font-normal">(optional — PDF, Word, etc. up to 50 MB)</span></Label>
                      {/* Show existing file when editing */}
                      {calEvEditId !== null && (() => {
                        const existing = calEventsList.find(e => e.id === calEvEditId);
                        if (existing?.fileName && !calEvRemoveExisting && !calEvFile) {
                          return (
                            <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30 text-sm">
                              <Paperclip className="w-4 h-4 text-primary flex-shrink-0" />
                              <span className="flex-1 truncate font-medium">{existing.fileName}</span>
                              <button type="button" className="text-xs text-destructive hover:underline flex-shrink-0" onClick={() => setCalEvRemoveExisting(true)}>Remove</button>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {/* File picker */}
                      {(calEvEditId === null || calEvRemoveExisting || !calEventsList.find(e => e.id === calEvEditId)?.fileName) && !calEvFile && (
                        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-5 cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors" data-testid="label-cal-file-upload">
                          <Upload className="w-6 h-6 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground text-center">Click to choose a file, or drag and drop</span>
                          <input type="file" className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip" data-testid="input-cal-file" onChange={e => { const f = e.target.files?.[0]; if (f) { setCalEvFile(f); setCalEvRemoveExisting(false); } e.target.value = ""; }} />
                        </label>
                      )}
                      {/* Selected file preview */}
                      {calEvFile && (
                        <div className="flex items-center gap-2 p-2 rounded-md border border-primary/30 bg-primary/5 text-sm">
                          <Paperclip className="w-4 h-4 text-primary flex-shrink-0" />
                          <span className="flex-1 truncate font-medium">{calEvFile.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">{(calEvFile.size / 1024 / 1024).toFixed(1)} MB</span>
                          <button type="button" className="text-xs text-destructive hover:underline flex-shrink-0" onClick={() => setCalEvFile(null)}>Remove</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveCalEvent} disabled={calEvLoading || !calEvTitle.trim() || !calEvDate.trim()} className="flex-1 gap-2" data-testid="button-save-cal-event">
                      {calEvLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                      {calEvEditId !== null ? "Save Changes" : "Create Event"}
                    </Button>
                    {calEvEditId !== null && (
                      <Button variant="outline" onClick={resetCalEvForm}>Cancel</Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card border-none">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>All Events</span>
                    <span className="text-sm font-normal text-muted-foreground">{calEventsList.length} total</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {calEventsList.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CalendarDays className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-sm">No calendar events yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {calEventsList.map(ev => {
                        const typeColors: Record<string, string> = {
                          assignment: "border-l-4 border-l-red-400 bg-red-50",
                          exam: "border-l-4 border-l-orange-400 bg-orange-50",
                          activity: "border-l-4 border-l-green-400 bg-green-50",
                          holiday: "border-l-4 border-l-blue-400 bg-blue-50",
                          other: "border-l-4 border-l-gray-400 bg-gray-50",
                        };
                        const typeLabels: Record<string, string> = { assignment: "📝 Assignment", exam: "📋 Exam", activity: "🎯 Activity", holiday: "🎉 Holiday", other: "📌 Other" };
                        return (
                          <div key={ev.id} className={`rounded-lg p-4 ${typeColors[ev.eventType] || typeColors.other}`}>
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="text-xs font-semibold text-muted-foreground">{typeLabels[ev.eventType]}</span>
                                  <span className="text-xs text-muted-foreground font-medium">{ev.eventDate}{ev.startTime ? ` · ${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ""}` : ""}</span>
                                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{ev.semester === "all" ? "🌐 All" : `Sem ${ev.semester}`}</span>
                                </div>
                                <p className="font-semibold text-sm">{ev.title}</p>
                                {ev.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{ev.description}</p>}
                                <div className="mt-2">
                                  {ev.fileName ? (
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <a href={`/api/calendar/events/${ev.id}/file`} target="_blank" rel="noreferrer" className="text-xs text-primary underline flex items-center gap-1">
                                        <Download className="w-3 h-3" /> {ev.fileName}
                                      </a>
                                      <button onClick={() => handleCalEvRemoveFile(ev.id)} className="text-xs text-destructive hover:underline">Remove file</button>
                                      <label className="text-xs text-muted-foreground cursor-pointer hover:underline flex items-center gap-1">
                                        <Upload className="w-3 h-3" /> Replace
                                        <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCalEvFileUpload(ev.id, f); e.target.value = ""; }} />
                                      </label>
                                    </div>
                                  ) : (
                                    <label className="text-xs text-primary cursor-pointer hover:underline flex items-center gap-1 w-fit">
                                      <Upload className="w-3 h-3" /> Attach file
                                      <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCalEvFileUpload(ev.id, f); e.target.value = ""; }} />
                                    </label>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-1 flex-shrink-0">
                                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-edit-cal-${ev.id}`}
                                  onClick={() => { setCalEvEditId(ev.id); setCalEvTitle(ev.title); setCalEvDesc(ev.description || ""); setCalEvType(ev.eventType); setCalEvDate(ev.eventDate); setCalEvStartTime(ev.startTime || ""); setCalEvEndTime(ev.endTime || ""); setCalEvSemester(ev.semester || "all"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" data-testid={`button-delete-cal-${ev.id}`}
                                  onClick={() => handleDeleteCalEvent(ev.id)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "credentials" && isAdmin && (
            <CredentialsPanel adminAuthHeader={`Basic ${localStorage.getItem("admin_auth") || ""}`} />
          )}

          {activeTab === "messages" && isAdmin && (
            <MessagesPanel adminAuthHeader={`Basic ${localStorage.getItem("admin_auth") || ""}`} />
          )}

          {activeTab === "password" && (
            <Card className="max-w-2xl glass-card border-none">
              <CardHeader><CardTitle>Change Admin Password</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Current Password</Label><Input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} /></div>
                <div className="space-y-2"><Label>New Password</Label><Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></div>
                <div className="space-y-2"><Label>Confirm New Password</Label><Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></div>
                <Button className="w-full" onClick={handleChangePassword}>Update Password</Button>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
