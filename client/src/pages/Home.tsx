import * as React from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import Confetti from "react-confetti";
import { useWindowSize } from "react-use";

import { useCreateGroup, useTopics } from "@/hooks/use-groups";
import { createGroupRequestSchema, type CreateGroupRequest } from "@shared/schema";

import { Navigation } from "@/components/Navigation";
import { CountdownTimer } from "@/components/CountdownTimer";
import { RulesModal } from "@/components/RulesModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { UserCircle, Users, Trophy, Loader2, CheckCircle, Folder, Lock, Pencil, Clock, Info, MessageCircle } from "lucide-react";

type ActiveProject = { id: number; name: string; status: "active" | "finalized"; deadline: string | null } | null;

// Snapshot of a successful submission, persisted in localStorage so the
// "you have been submitted" popup survives page refreshes and the student
// can re-edit until the deadline.
type SubmissionRecord = {
  id: number;
  editToken: string;
  createdAt: string; // ISO
  members: Array<{ name: string; studentId: string; role: "leader" | "member"; topicId?: number | null }>;
};

export default function Home() {
  // Confirmed submission for this project (null = none). When set, the popup
  // is shown over the form and the form is locked unless the student clicks
  // "Re-edit Group".
  const [submission, setSubmission] = React.useState<SubmissionRecord | null>(null);
  const [showSubmittedDialog, setShowSubmittedDialog] = React.useState(false);
  // True after the user clicks "Re-edit Group" — switches the submit handler
  // from POST /api/groups to PUT /api/groups/:id/edit.
  const [isEditing, setIsEditing] = React.useState(false);
  // Confetti is fired briefly on successful submit/update.
  const [showConfetti, setShowConfetti] = React.useState(false);
  // Pending state for the re-edit (PUT) mutation.
  const [editPending, setEditPending] = React.useState(false);
  const [timeUp, setTimeUp] = React.useState(false);
  const [requiredMembers, setRequiredMembers] = React.useState(6);
  const [projectName, setProjectName] = React.useState("");
  const [requireLeader, setRequireLeader] = React.useState(true);
  const [requireTopic, setRequireTopic] = React.useState(true);
  // Active project gating: null = none, undefined = still loading
  const [activeProject, setActiveProject] = React.useState<ActiveProject | undefined>(undefined);
  // Resolved deadline for the active project (project.deadline first, then
  // legacy global setting). Drives both the countdown timer and the
  // re-edit button gating.
  const [effectiveDeadline, setEffectiveDeadline] = React.useState<Date | null>(null);
  const [rulesOpen, setRulesOpen] = React.useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = React.useState(false);
  const [feedbackName, setFeedbackName] = React.useState("");
  const [feedbackMessage, setFeedbackMessage] = React.useState("");
  const [feedbackError, setFeedbackError] = React.useState("");
  const [feedbackSent, setFeedbackSent] = React.useState(false);
  const { width, height } = useWindowSize();
  const { toast } = useToast();
  const createGroup = useCreateGroup();
  const { data: topics } = useTopics();

  // Force the page to start at the top on every load/refresh — overrides
  // the browser's default "restore previous scroll position" behavior so
  // students see the header (with the countdown timer) first instead of
  // landing on the footer. useLayoutEffect runs before paint so there's
  // no flash of mid-page content.
  React.useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  React.useEffect(() => {
    // Belt-and-suspenders: re-pin to top a beat after layout in case
    // late-mounting elements (orbs, modal, animations) shift the scroll.
    setTimeout(() => window.scrollTo(0, 0), 50);

    fetch("/api/settings/required_members")
      .then(res => res.json())
      .then(data => {
        if (data.value) setRequiredMembers(parseInt(data.value));
      });

    fetch("/api/settings/project_name")
      .then(res => res.json())
      .then(data => {
        if (data.value) setProjectName(data.value);
      });

    fetch("/api/settings/group_require_leader")
      .then(res => res.json())
      .then(data => { setRequireLeader(data.value !== "false"); });

    fetch("/api/settings/group_require_topic")
      .then(res => res.json())
      .then(data => { setRequireTopic(data.value !== "false"); });

    // Resolve active project so we can gate submissions per-project, and
    // resolve the effective deadline (project-scoped > legacy global setting).
    (async () => {
      let project: ActiveProject = null;
      try {
        const res = await fetch("/api/projects/active");
        const p = res.ok ? await res.json() : null;
        project = p && p.id ? p : null;
      } catch { project = null; }
      setActiveProject(project);

      let deadline: Date | null = null;
      if (project?.deadline) deadline = new Date(project.deadline);
      if (!deadline) {
        try {
          const r = await fetch("/api/settings/submission_deadline");
          const d = await r.json();
          if (d?.value) deadline = new Date(d.value);
        } catch { /* ignore */ }
      }
      if (deadline) {
        setEffectiveDeadline(deadline);
        if (new Date() > deadline) setTimeUp(true);
      }

      // Restore previous submission (per-project key) so the popup re-appears
      // on refresh and the student can re-edit if the deadline hasn't passed.
      const key = project ? `group_submission_${project.id}` : "group_submission_none";
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          // Strict shape validation — discard anything malformed so the
          // popup never crashes while rendering corrupted data.
          const isValid =
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.id === "number" &&
            typeof parsed.editToken === "string" &&
            typeof parsed.createdAt === "string" &&
            Array.isArray(parsed.members) &&
            parsed.members.every(
              (m: any) =>
                m &&
                typeof m.name === "string" &&
                typeof m.studentId === "string" &&
                (m.role === "leader" || m.role === "member"),
            );
          if (isValid) {
            const rec: SubmissionRecord = {
              id: parsed.id,
              editToken: parsed.editToken,
              createdAt: parsed.createdAt,
              members: parsed.members.map((m: any) => ({
                name: m.name,
                studentId: m.studentId,
                role: m.role,
                topicId: typeof m.topicId === "number" ? m.topicId : null,
              })),
            };
            setSubmission(rec);
            setShowSubmittedDialog(true);
          } else {
            // Drop corrupt entry so it doesn't haunt the user across reloads.
            localStorage.removeItem(key);
          }
        } catch {
          localStorage.removeItem(key);
        }
      } else {
        // Migrate the legacy boolean marker so existing students still see
        // a "you've submitted" popup (just without re-edit, since we don't
        // have their token).
        const legacyKey = project ? `group_submitted_${project.id}` : "group_submitted_none";
        if (localStorage.getItem(legacyKey)) {
          setSubmission({ id: 0, editToken: "", createdAt: "", members: [] });
          setShowSubmittedDialog(true);
        }
      }
    })();
  }, []);

  const form = useForm<CreateGroupRequest>({
    resolver: zodResolver(createGroupRequestSchema),
    defaultValues: {
      leader: { name: "", studentId: "", role: "leader", topicId: undefined as any },
      members: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "members",
  });

  React.useEffect(() => {
    const currentCount = fields.length;
    if (currentCount < requiredMembers) {
      for (let i = currentCount; i < requiredMembers; i++) {
        append({ name: "", studentId: "", role: "member", topicId: undefined as any });
      }
    } else if (currentCount > requiredMembers) {
      for (let i = currentCount - 1; i >= requiredMembers; i--) {
        remove(i);
      }
    }
  }, [requiredMembers, append, remove, fields.length]);

  const submissionsClosed =
    activeProject === null || (activeProject && activeProject.status === "finalized");

  const onSubmit = (data: CreateGroupRequest) => {
    if (submissionsClosed) {
      form.setError("root", { message: activeProject === null
        ? "No project is currently open for submissions. Please ask the admin to start a project."
        : "This project has been closed and is no longer accepting submissions." });
      return;
    }
    // Strip leader/topic depending on admin toggles
    const payload: CreateGroupRequest = {
      leader: requireLeader ? data.leader : undefined,
      members: requireTopic
        ? data.members
        : data.members.map(m => ({ ...m, topicId: null as any })),
    };
    if (requireLeader && payload.leader && !requireTopic) {
      payload.leader = { ...payload.leader, topicId: null as any };
    }

    const idList = [
      ...(requireLeader && payload.leader ? [payload.leader.studentId] : []),
      ...payload.members.map(m => m.studentId),
    ].filter(id => id?.trim() !== "");
    const uniqueIds = new Set(idList);
    if (uniqueIds.size !== idList.length) {
      form.setError("root", { message: "Duplicate Student IDs found. Every member must have a unique ID." });
      return;
    }

    if (requireTopic) {
      const leaderTopicMissing = requireLeader && !payload.leader?.topicId;
      const memberTopicMissing = payload.members.some(m => !m.topicId);
      if (leaderTopicMissing || memberTopicMissing) {
        form.setError("root", { message: "Please select a topic for all group members." });
        return;
      }
    }

    // Persist the new (or updated) submission record so the popup re-appears
    // on refresh and the student can re-edit until the deadline.
    const persist = (rec: SubmissionRecord) => {
      const key = activeProject ? `group_submission_${activeProject.id}` : "group_submission_none";
      localStorage.setItem(key, JSON.stringify(rec));
    };

    const memberSnapshot = (() => {
      const list: SubmissionRecord["members"] = [];
      if (requireLeader && payload.leader) {
        list.push({
          name: payload.leader.name,
          studentId: payload.leader.studentId,
          role: "leader",
          topicId: payload.leader.topicId ?? null,
        });
      }
      for (const m of payload.members) {
        list.push({
          name: m.name,
          studentId: m.studentId,
          role: "member",
          topicId: m.topicId ?? null,
        });
      }
      return list;
    })();

    if (isEditing && submission && submission.id && submission.editToken) {
      // Re-edit existing group
      setEditPending(true);
      (async () => {
        try {
          const res = await apiRequest(
            "PUT",
            `/api/groups/${submission.id}/edit`,
            { editToken: submission.editToken, payload },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || "Update failed");
          const updated: SubmissionRecord = {
            id: submission.id,
            editToken: submission.editToken,
            createdAt: submission.createdAt,
            members: memberSnapshot,
          };
          persist(updated);
          setSubmission(updated);
          setIsEditing(false);
          setShowSubmittedDialog(true);
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 4000);
          // Invalidate admin caches so the dashboard picks up the change.
          queryClient.invalidateQueries({
            predicate: q => Array.isArray(q.queryKey) &&
              (q.queryKey[0] === "/api/groups" || q.queryKey[0] === "/api/stats"),
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (err: any) {
          toast({ title: "Update failed", description: err.message || "Unknown error", variant: "destructive" });
        } finally {
          setEditPending(false);
        }
      })();
      return;
    }

    createGroup.mutate(payload, {
      onSuccess: (data: any) => {
        const rec: SubmissionRecord = {
          id: data.id,
          editToken: data.editToken || "",
          createdAt: data.createdAt || new Date().toISOString(),
          members: memberSnapshot,
        };
        persist(rec);
        setSubmission(rec);
        setShowSubmittedDialog(true);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
    });
  };

  // Pre-fill the form with the existing submission so the student can edit
  // it in place. Closes the popup; the form's submit button label flips to
  // "Update Group" via isEditing.
  const handleReEdit = () => {
    if (!submission) return;
    if (effectiveDeadline && new Date() > effectiveDeadline) {
      toast({
        title: "Deadline has passed",
        description: "Your group can no longer be edited.",
        variant: "destructive",
      });
      return;
    }
    const leader = submission.members.find(m => m.role === "leader");
    const memberList = submission.members.filter(m => m.role === "member");
    form.reset({
      leader: leader
        ? { name: leader.name, studentId: leader.studentId, role: "leader", topicId: (leader.topicId ?? undefined) as any }
        : { name: "", studentId: "", role: "leader", topicId: undefined as any },
      members: memberList.map(m => ({
        name: m.name,
        studentId: m.studentId,
        role: "member" as const,
        topicId: (m.topicId ?? undefined) as any,
      })),
    });
    setIsEditing(true);
    setShowSubmittedDialog(false);
    setTimeout(() => window.scrollTo({ top: 200, behavior: "smooth" }), 50);
  };

  const deadlinePassed = !!effectiveDeadline && new Date() > effectiveDeadline;

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      {/* Floating orbs background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
        <div style={{ animation: "float-orb 12s ease-in-out infinite" }}
          className="absolute top-[-80px] left-[-80px] w-[400px] h-[400px] rounded-full bg-gradient-to-br from-purple-500/20 to-indigo-500/10 blur-3xl" />
        <div style={{ animation: "float-orb-2 16s ease-in-out infinite" }}
          className="absolute top-[20%] right-[-100px] w-[350px] h-[350px] rounded-full bg-gradient-to-br from-pink-500/15 to-purple-500/10 blur-3xl" />
        <div style={{ animation: "float-orb-3 20s ease-in-out infinite" }}
          className="absolute bottom-[10%] left-[30%] w-[300px] h-[300px] rounded-full bg-gradient-to-br from-indigo-500/15 to-cyan-400/10 blur-3xl" />
        <div style={{ animation: "float-orb 18s ease-in-out infinite 4s" }}
          className="absolute bottom-[-60px] right-[20%] w-[250px] h-[250px] rounded-full bg-gradient-to-br from-violet-400/20 to-fuchsia-400/10 blur-3xl" />
      </div>

      <RulesModal open={rulesOpen} onOpenChange={setRulesOpen} />
      <Navigation />
      {showConfetti && <Confetti width={width} height={height} numberOfPieces={200} recycle={false} />}
      <CountdownTimer deadline={effectiveDeadline} />

      <main className="relative z-10 flex-1 container max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-10 space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: -30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="text-4xl md:text-5xl font-bold shimmer-text"
          >
            {projectName || "Group Registration"}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-muted-foreground text-lg max-w-2xl mx-auto"
          >
            {requireLeader
              ? `This project requires 1 leader + ${requiredMembers} members. Please also follow the rules below before submitting.`
              : `This project requires ${requiredMembers} member${requiredMembers === 1 ? "" : "s"}. Please also follow the rules below before submitting.`}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="mt-4 flex flex-wrap items-center justify-center gap-3"
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => setRulesOpen(true)}
              className="h-8 gap-1.5 rounded-full border-border bg-background px-3 text-xs font-medium shadow-sm"
              data-testid="button-open-rules"
            >
              <Info className="h-3.5 w-3.5" />
              Submission Rules
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFeedbackModalOpen(true)}
              className="h-8 gap-1.5 rounded-full border-border bg-background px-3 text-xs font-medium shadow-sm"
              data-testid="button-open-feedback"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Give Feedback
            </Button>
          </motion.div>

          {/* Active project indicator */}
          {activeProject && activeProject.status === "active" && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.4 }}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm font-medium border border-emerald-200 dark:border-emerald-800"
              data-testid="banner-active-project"
            >
              <Folder className="w-4 h-4" />
              Submitting to: <strong>{activeProject.name}</strong>
            </motion.div>
          )}
          {submissionsClosed && activeProject !== undefined && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.4 }}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-sm font-medium border border-amber-200 dark:border-amber-800"
              data-testid="banner-submissions-closed"
            >
              <Lock className="w-4 h-4" />
              {activeProject === null
                ? "No project is currently open. Submissions are closed."
                : `${activeProject.name} is closed for submissions.`}
            </motion.div>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5, ease: "easeOut" }}
          className="animated-border-card rounded-[calc(var(--radius)+2px)] shadow-2xl"
        >
          <Card className="glass-card border-none shadow-none">
            <CardHeader className="bg-primary/5 border-b border-primary/10">
              <CardTitle className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: [0, -15, 15, -10, 10, 0] }}
                  transition={{ duration: 0.8, delay: 1, repeat: Infinity, repeatDelay: 4 }}
                >
                  <Trophy className="w-5 h-5 text-primary" />
                </motion.div>
                Team Information
              </CardTitle>
              <CardDescription>
                {requireLeader
                  ? `1 Group Leader + ${requiredMembers} Member${requiredMembers === 1 ? "" : "s"} required for submission.`
                  : `${requiredMembers} Member${requiredMembers === 1 ? "" : "s"} required for submission.`}
              </CardDescription>
            </CardHeader>

            <CardContent className="p-6 md:p-8">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                  {form.formState.errors.root && (
                    <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm font-medium">
                      {form.formState.errors.root.message}
                    </div>
                  )}

                  {requireLeader && (
                    <>
                      <Separator />

                      {/* Leader Section */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-2 text-primary font-semibold text-lg">
                          <UserCircle className="w-6 h-6" />
                          <h3>Group Leader</h3>
                        </div>

                        <div className="grid md:grid-cols-2 gap-6 bg-secondary/30 p-6 rounded-xl border border-border/50">
                          <FormField
                            control={form.control}
                            name="leader.name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Full Name</FormLabel>
                                <FormControl>
                                  <Input placeholder="Leader Name" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="space-y-4">
                            <FormField
                              control={form.control}
                              name="leader.studentId"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Student ID</FormLabel>
                                  <FormControl>
                                    <Input placeholder="e.g. BUS-24F-123" {...field} className="uppercase" autoCapitalize="characters" onChange={e => field.onChange(e.target.value.toUpperCase())} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            {requireTopic && (
                              <FormField
                                control={form.control}
                                name="leader.topicId"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-sm font-medium">Project Topic</FormLabel>
                                    <Select
                                      onValueChange={(val) => field.onChange(Number(val))}
                                      value={field.value?.toString()}
                                    >
                                      <FormControl>
                                        <SelectTrigger className="h-10">
                                          <SelectValue placeholder="Select a topic" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {topics?.filter((topic: any) => {
                                          const selectedTopics = [
                                            form.watch("leader.topicId"),
                                            ...form.watch("members").map(m => m.topicId)
                                          ].filter(Boolean);
                                          return !selectedTopics.includes(topic.id) || field.value === topic.id;
                                        }).map((topic: any) => (
                                          <SelectItem key={topic.id} value={topic.id.toString()}>
                                            {topic.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  {/* Members Section */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 text-primary font-semibold text-lg">
                      <Users className="w-6 h-6" />
                      <h3>Team Members ({requiredMembers} {requiredMembers === 1 ? "Required" : "Required"})</h3>
                    </div>

                    <div className="grid gap-6">
                      {fields.map((field, index) => (
                        <motion.div
                          key={field.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 + index * 0.07, duration: 0.4, ease: "easeOut" }}
                          className="grid md:grid-cols-12 gap-4 items-start p-4 rounded-lg bg-card border hover:border-primary/50 hover:shadow-md hover:shadow-primary/10 transition-all duration-300"
                        >
                          <div className="md:col-span-1 flex items-center justify-center pt-3">
                            <span className="bg-primary/10 text-primary font-bold w-8 h-8 rounded-full flex items-center justify-center text-sm">
                              {index + 1}
                            </span>
                          </div>
                          <div className="md:col-span-6">
                            <FormField
                              control={form.control}
                              name={`members.${index}.name`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs uppercase text-muted-foreground">Member Name</FormLabel>
                                  <FormControl>
                                    <Input placeholder={`Member ${index + 1} Name`} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="md:col-span-5 space-y-4">
                            <FormField
                              control={form.control}
                              name={`members.${index}.studentId`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs uppercase text-muted-foreground">Student ID</FormLabel>
                                  <FormControl>
                                    <Input placeholder="e.g. BUS-24F-123" {...field} className="uppercase" autoCapitalize="characters" onChange={e => field.onChange(e.target.value.toUpperCase())} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            {requireTopic && (
                              <FormField
                                control={form.control}
                                name={`members.${index}.topicId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs uppercase text-muted-foreground">Project Topic</FormLabel>
                                    <Select
                                      onValueChange={(val) => field.onChange(Number(val))}
                                      value={field.value?.toString()}
                                    >
                                      <FormControl>
                                        <SelectTrigger className="h-10">
                                          <SelectValue placeholder="Select a topic" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {topics?.filter((topic: any) => {
                                          const selectedTopics = [
                                            form.watch("leader.topicId"),
                                            ...form.watch("members").map(m => m.topicId)
                                          ].filter(Boolean);
                                          return !selectedTopics.includes(topic.id) || field.value === topic.id;
                                        }).map((topic: any) => (
                                          <SelectItem key={topic.id} value={topic.id.toString()}>
                                            {topic.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-6">
                    {isEditing && (
                      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <Pencil className="w-4 h-4" />
                          Editing your existing submission. Saving will overwrite it.
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => { setIsEditing(false); setShowSubmittedDialog(true); }}
                          data-testid="button-cancel-edit"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                    {/* Force the user through "Re-edit Group" once they have
                        an active submission, so the form can't accidentally
                        create a duplicate group. */}
                    {submission && !isEditing && (
                      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <CheckCircle className="w-4 h-4" />
                          You have already submitted this group.
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowSubmittedDialog(true)}
                          data-testid="button-show-submission"
                        >
                          View submission
                        </Button>
                      </div>
                    )}
              <Button
                type="submit"
                data-testid="button-submit-group"
                className="w-full h-12 text-base font-semibold shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all"
                disabled={createGroup.isPending || editPending || timeUp || !!submissionsClosed || (!!submission && !isEditing)}
              >
                      {(createGroup.isPending || editPending) ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          {isEditing ? "Saving..." : "Submitting..."}
                        </>
                      ) : timeUp ? (
                        "Submission Deadline Passed"
                      ) : isEditing ? (
                        "Update Group"
                      ) : (
                        "Submit Group Registration"
                      )}
                    </Button>
                    <div className="flex flex-col items-center gap-4 mt-6">
                      <p className="text-sm text-muted-foreground">
                        By submitting, you confirm that all details are accurate and unique.
                      </p>
                      <Separator className="w-24" />
                    </div>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </motion.div>

        <Dialog open={feedbackModalOpen} onOpenChange={setFeedbackModalOpen}>
          <DialogContent className="sm:max-w-md w-[94vw] max-h-[88vh] overflow-y-auto rounded-2xl border-border bg-background p-0 shadow-xl">
            <div className="border-b border-border px-6 py-5">
              <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
                <MessageCircle className="h-5 w-5 text-primary" />
                Give Feedback
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">
                Share a quick note to help improve the form.
              </DialogDescription>
            </div>
            <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
              <div className="space-y-2">
                <label htmlFor="feedback-name" className="text-sm font-medium">Name (optional)</label>
                <Input
                  id="feedback-name"
                  data-testid="input-feedback-name"
                  value={feedbackName}
                  onChange={(e) => setFeedbackName(e.target.value)}
                  placeholder="Your name"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="feedback-message" className="text-sm font-medium">Feedback message</label>
                <textarea
                  id="feedback-message"
                  data-testid="input-feedback-message"
                  value={feedbackMessage}
                  onChange={(e) => {
                    setFeedbackMessage(e.target.value);
                    if (feedbackError) setFeedbackError("");
                  }}
                  placeholder="What would you like us to improve?"
                  className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              {feedbackError && <p className="text-sm text-destructive" data-testid="text-feedback-error">{feedbackError}</p>}
              {feedbackSent && <p className="text-sm text-emerald-600" data-testid="text-feedback-success">Thank you for your feedback!</p>}
              <Button
                type="button"
                onClick={() => {
                  const message = feedbackMessage.trim();
                  if (!message) {
                    setFeedbackError("Feedback message cannot be empty.");
                    setFeedbackSent(false);
                    return;
                  }
                  const entry = { name: feedbackName.trim(), message, createdAt: new Date().toISOString() };
                  const existing = JSON.parse(localStorage.getItem("student_feedback") || "[]");
                  localStorage.setItem("student_feedback", JSON.stringify([...existing, entry]));
                  setFeedbackMessage("");
                  setFeedbackName("");
                  setFeedbackError("");
                  setFeedbackSent(true);
                }}
                className="w-full h-11"
                data-testid="button-submit-feedback"
              >
                Submit Feedback
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>

      {/* SUBMISSION CONFIRMATION POPUP — replaces the legacy full-page screen.
          Shows the submitted IDs/names + submission time, with a re-edit
          button that's only enabled until the deadline. */}
      <Dialog
        open={showSubmittedDialog}
        onOpenChange={(o) => {
          // Don't auto-close when the deadline has passed — the popup is
          // their permanent confirmation. Otherwise allow dismiss.
          if (!o && deadlinePassed) return;
          setShowSubmittedDialog(o);
        }}
      >
        <DialogContent className="sm:max-w-lg" data-testid="dialog-submitted">
          <DialogHeader>
            <div className="mx-auto mb-3 w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <CheckCircle className="w-9 h-9 text-green-600 dark:text-green-400" />
            </div>
            <DialogTitle className="text-center text-2xl" data-testid="text-submitted-title">
              You have been submitted
            </DialogTitle>
            <DialogDescription className="text-center" data-testid="text-submitted-subtitle">
              Your group has been recorded for{" "}
              <strong>{activeProject?.name || "this project"}</strong>.
              {submission?.createdAt && (
                <>
                  {" "}Submitted on{" "}
                  <strong data-testid="text-submitted-time">
                    {new Date(submission.createdAt).toLocaleString()}
                  </strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {submission?.members && submission.members.length > 0 && (
            <div className="rounded-lg border bg-secondary/30 max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground bg-secondary/60">
                  <tr>
                    <th className="text-left px-3 py-2">Role</th>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Student ID</th>
                  </tr>
                </thead>
                <tbody>
                  {submission.members.map((m, i) => (
                    <tr
                      key={`${m.studentId}-${i}`}
                      className="border-t"
                      data-testid={`row-submitted-member-${i}`}
                    >
                      <td className="px-3 py-2">
                        {m.role === "leader" ? (
                          <span className="inline-flex items-center gap-1 text-primary font-medium">
                            <UserCircle className="w-3.5 h-3.5" /> Leader
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Member</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium" data-testid={`text-submitted-name-${i}`}>{m.name}</td>
                      <td className="px-3 py-2 font-mono text-xs" data-testid={`text-submitted-id-${i}`}>{m.studentId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {deadlinePassed ? (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-muted-foreground text-sm" data-testid="banner-deadline-passed">
              <Clock className="w-4 h-4 flex-shrink-0" />
              The deadline has passed — your submission is locked and can no longer be changed.
            </div>
          ) : effectiveDeadline ? (
            <div className="flex items-center gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200 text-sm" data-testid="banner-can-edit">
              <Clock className="w-4 h-4 flex-shrink-0" />
              You can re-edit your group until <strong>{effectiveDeadline.toLocaleString()}</strong>.
            </div>
          ) : null}

          <DialogFooter className="sm:justify-center gap-2">
            {!deadlinePassed && submission?.id ? (
              <Button
                onClick={handleReEdit}
                className="gap-2"
                data-testid="button-re-edit-group"
              >
                <Pencil className="w-4 h-4" />
                Re-edit the group
              </Button>
            ) : (
              <Button
                disabled
                variant="outline"
                className="gap-2"
                data-testid="button-re-edit-disabled"
              >
                <Lock className="w-4 h-4" />
                Editing closed
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
