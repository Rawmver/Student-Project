import * as React from "react";
import { Navigation } from "@/components/Navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { Upload, FileText, CheckCircle, Loader2, AlertCircle, Lock, RotateCcw, Clock, TimerOff, FolderOpen, X, Plus, ShieldCheck, Wand2 } from "lucide-react";
import { differenceInSeconds } from "date-fns";

type Config = {
  enabled: boolean;
  maxSizeMb: number;
  requireLeader: boolean;
  requireTopic: boolean;
  activeProject: { id: number; name: string; status: string } | null;
  pageTitle: string;
  subjectHeading: string;
  projectTitle: string;
  deadline: string;
  acceptExtensions?: string;
  allowedMimes?: string[];
  typeLabels?: string[];
};

function FileDeadlineTimer({ deadline, onExpired }: { deadline: string; onExpired?: () => void }) {
  const [timeLeft, setTimeLeft] = React.useState(0);
  const dl = React.useMemo(() => deadline ? new Date(deadline) : null, [deadline]);

  React.useEffect(() => {
    if (!dl) return;
    if (dl <= new Date()) { onExpired?.(); return; }
    setTimeLeft(differenceInSeconds(dl, new Date()));
    const interval = setInterval(() => {
      const diff = differenceInSeconds(dl, new Date());
      if (diff <= 0) { clearInterval(interval); setTimeLeft(0); onExpired?.(); }
      else setTimeLeft(diff);
    }, 1000);
    return () => clearInterval(interval);
  }, [dl]);

  if (!dl || timeLeft <= 0) return null;
  const days = Math.floor(timeLeft / 86400);
  const hours = Math.floor((timeLeft % 86400) / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 shadow-lg">
      <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 animate-pulse" />
          <span className="font-medium text-sm sm:text-base">File Submission Deadline approaching!</span>
        </div>
        <div className="flex gap-4 text-center">
          {[{ v: days, l: "Days" }, { v: hours, l: "Hours" }, { v: minutes, l: "Mins" }, { v: seconds, l: "Secs" }].map(({ v, l }) => (
            <div key={l} className="flex flex-col min-w-[3rem]">
              <span className="text-xl font-bold font-mono leading-none">{v}</span>
              <span className="text-[10px] uppercase opacity-80">{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export default function FileSubmit() {
  const [config, setConfig] = React.useState<Config | null>(null);
  const [deadlinePassed, setDeadlinePassed] = React.useState(false);
  const [studentName, setStudentName] = React.useState("");
  const [studentId, setStudentId] = React.useState("");
  const [groupLeader, setGroupLeader] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState("");
  // Files the student picked that are NOT in an accepted format but COULD be
  // converted to PDF (DOCX / images / text). We hold them here and offer a
  // one-click "Convert to PDF" so the student doesn't have to leave the page.
  const [convertibleQueue, setConvertibleQueue] = React.useState<File[]>([]);
  const [convertingIdx, setConvertingIdx] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submittedInfo, setSubmittedInfo] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    window.scrollTo(0, 0);
    fetch("/api/file-submit/config").then(r => r.json()).then((c: Config) => {
      setConfig(c);
      if (c.deadline) {
        const d = new Date(c.deadline);
        if (!isNaN(d.getTime()) && d <= new Date()) setDeadlinePassed(true);
      }
    }).catch(() => setConfig({ enabled: false } as any));

    const saved = localStorage.getItem("file_submitted");
    if (saved) {
      setSubmitted(true);
      try { setSubmittedInfo(JSON.parse(saved)); } catch {}
    }
  }, []);

  const maxSizeMb = config?.maxSizeMb || 5;
  const MAX_SIZE = maxSizeMb * 1024 * 1024;

  // Detect — client-side — whether a rejected file is something our server
  // converter can turn into another format. Mirrors server/lib/fileConvert.ts.
  const isConvertible = (f: File) => {
    const ext = ("." + (f.name.split(".").pop() || "")).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".txt", ".md", ".csv", ".docx"].includes(ext);
  };
  const friendlyKind = (f: File) => {
    const ext = ("." + (f.name.split(".").pop() || "")).toLowerCase();
    if (ext === ".docx") return "Word document";
    if (ext === ".jpg" || ext === ".jpeg") return "JPG image";
    if (ext === ".png") return "PNG image";
    if (ext === ".txt") return "text file";
    if (ext === ".md") return "Markdown file";
    if (ext === ".csv") return "CSV file";
    return "file";
  };

  // Conversion targets the SERVER can produce per input kind. Mirror of
  // getAvailableTargetsForKind() in server/lib/fileConvert.ts. We keep it on
  // the client too so we don't need a round-trip just to render the buttons.
  type TargetSpec = { target: "pdf" | "txt" | "html" | "docx" | "xlsx" | "pptx"; ext: string; mime: string; label: string };
  const T = {
    pdf:  { target: "pdf"  as const, ext: "pdf",  mime: "application/pdf",                                                                  label: "PDF" },
    txt:  { target: "txt"  as const, ext: "txt",  mime: "text/plain",                                                                       label: "TXT" },
    html: { target: "html" as const, ext: "html", mime: "text/html",                                                                        label: "HTML" },
    docx: { target: "docx" as const, ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",          label: "Word (DOCX)" },
    xlsx: { target: "xlsx" as const, ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",                label: "Excel (XLSX)" },
    pptx: { target: "pptx" as const, ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",        label: "PowerPoint (PPTX)" },
  };
  const ALL_TARGETS: Record<string, TargetSpec[]> = {
    docx:  [T.pdf, T.txt, T.html, T.xlsx, T.pptx],
    text:  [T.pdf, T.txt, T.docx, T.xlsx, T.pptx],
    image: [T.pdf, T.docx, T.pptx],
  };
  /** Targets allowed for a file: intersect (what the converter can produce)
   *  with (what the admin allows for submission). */
  const targetsFor = (f: File): TargetSpec[] => {
    const ext = ("." + (f.name.split(".").pop() || "")).toLowerCase();
    let pool: TargetSpec[] = [];
    if (ext === ".docx") pool = ALL_TARGETS.docx;
    else if (ext === ".txt" || ext === ".md" || ext === ".csv") pool = ALL_TARGETS.text;
    else if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") pool = ALL_TARGETS.image;
    const allowed = config?.allowedMimes;
    if (!allowed || allowed.length === 0) return pool;
    return pool.filter(t => allowed.includes(t.mime));
  };

  const addFiles = (picked: FileList | null) => {
    setFileError("");
    if (!picked || picked.length === 0) return;
    const incoming = Array.from(picked);
    if (files.length + convertibleQueue.length + incoming.length > 2) {
      setFileError("You can upload a maximum of 2 files.");
      return;
    }
    const allowedTypes = config?.allowedMimes || DEFAULT_ALLOWED_TYPES;
    const accepted: File[] = [];
    const toConvert: File[] = [];
    for (const f of incoming) {
      if (f.size > MAX_SIZE) {
        setFileError(`"${f.name}" exceeds the ${maxSizeMb} MB limit.`);
        return;
      }
      if (allowedTypes.includes(f.type)) {
        accepted.push(f);
      } else if (isConvertible(f)) {
        toConvert.push(f);
      } else {
        setFileError(`"${f.name}" is not an allowed file type and can't be auto-converted.`);
        return;
      }
    }
    if (accepted.length) setFiles(prev => [...prev, ...accepted].slice(0, 2));
    if (toConvert.length) setConvertibleQueue(prev => [...prev, ...toConvert]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const removeConvertible = (idx: number) => {
    setConvertibleQueue(prev => prev.filter((_, i) => i !== idx));
  };

  // Hand the file off to the server, get a PDF blob back, and drop the
  // resulting File into the accepted-files list. The original is removed
  // from the conversion queue on success.
  // Tracks which (file index, target) is currently being converted so we
  // can show a per-button spinner instead of a global one.
  const [activeConvert, setActiveConvert] = React.useState<{ idx: number; target: string } | null>(null);

  const convertOne = async (idx: number, target: TargetSpec) => {
    const orig = convertibleQueue[idx];
    if (!orig || activeConvert) return;
    setActiveConvert({ idx, target: target.target });
    setConvertingIdx(idx);
    setFileError("");
    try {
      if (files.length >= 2) {
        setFileError("You already have 2 files queued — remove one before converting.");
        return;
      }
      const fd = new FormData();
      fd.append("file", orig);
      const res = await fetch(`/api/file-submit/convert?target=${target.target}`, { method: "POST", body: fd });
      if (!res.ok) {
        let msg = "Conversion failed.";
        try { msg = (await res.json()).message || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      if (blob.size > MAX_SIZE) {
        setFileError(`Converted file is larger than the ${maxSizeMb} MB limit. Try a smaller source file.`);
        return;
      }
      const stem = orig.name.replace(/\.[^.]+$/, "");
      const out = new File([blob], `${stem}.${target.ext}`, { type: target.mime });
      setFiles(prev => [...prev, out].slice(0, 2));
      setConvertibleQueue(prev => prev.filter((_, i) => i !== idx));
    } catch (e: any) {
      setFileError(e.message || "Conversion failed. Please try a different file.");
    } finally {
      setConvertingIdx(null);
      setActiveConvert(null);
    }
  };

  const resetForm = () => {
    localStorage.removeItem("file_submitted");
    setSubmitted(false);
    setSubmittedInfo(null);
    setStudentName(""); setStudentId(""); setGroupLeader(""); setTopic("");
    setFiles([]);
    setConvertibleQueue([]);
    setError(""); setFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.scrollTo(0, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!config?.activeProject) { setError("No active project is accepting submissions."); return; }
    if (!studentName.trim()) { setError("Student name is required."); return; }
    if (!studentId.trim()) { setError("Student ID is required."); return; }
    if (config.requireLeader && !groupLeader.trim()) { setError("Group leader is required."); return; }
    if (config.requireTopic && !topic.trim()) { setError("Project topic is required."); return; }
    if (files.length === 0) { setError("Please select at least one file."); return; }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("studentName", studentName.trim());
      fd.append("studentId", studentId.trim());
      fd.append("subject", config.subjectHeading || config.projectTitle || "");
      fd.append("groupLeader", groupLeader.trim());
      fd.append("topic", topic.trim());
      files.forEach(f => fd.append("files", f));

      const res = await fetch("/api/file-submit", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Submission failed");

      const info = {
        name: studentName.trim(),
        id: studentId.trim(),
        groupLeader: groupLeader.trim(),
        topic: topic.trim(),
        project: config.activeProject.name,
        files: files.map(f => f.name),
      };
      localStorage.setItem("file_submitted", JSON.stringify(info));
      setSubmittedInfo(info);
      setSubmitted(true);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (!config) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navigation />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!config.enabled) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navigation />
        <main className="flex-1 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4 max-w-md">
            <div className="mx-auto w-20 h-20 bg-muted rounded-full flex items-center justify-center">
              <Lock className="w-10 h-10 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-bold">Submissions Closed</h1>
            <p className="text-muted-foreground">File submissions are currently disabled. Please check back later.</p>
          </motion.div>
        </main>
      </div>
    );
  }

  if (!config.activeProject) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navigation />
        <main className="flex-1 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4 max-w-md" data-testid="status-no-active-project">
            <div className="mx-auto w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
              <FolderOpen className="w-10 h-10 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold">No Active Project</h1>
            <p className="text-muted-foreground">There is no project currently accepting submissions. Please wait for your instructor to start a new project.</p>
          </motion.div>
        </main>
      </div>
    );
  }

  if (deadlinePassed) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navigation />
        <main className="flex-1 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-5 max-w-md">
            <div className="mx-auto w-24 h-24 bg-destructive/10 rounded-full flex items-center justify-center">
              <TimerOff className="w-12 h-12 text-destructive" />
            </div>
            <h1 className="text-3xl font-bold text-destructive">Deadline Passed</h1>
            <p className="text-muted-foreground text-lg">The file submission deadline has passed. No more submissions are being accepted.</p>
          </motion.div>
        </main>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navigation />
        <FileDeadlineTimer deadline={config.deadline} onExpired={() => setDeadlinePassed(true)} />
        <main className="flex-1 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-6 max-w-md w-full">
            <div className="mx-auto w-24 h-24 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Files Submitted!</h1>
              <p className="text-muted-foreground text-lg">Your submission has been received successfully.</p>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-semibold text-green-700">
                <ShieldCheck className="w-3.5 h-3.5" />
                Virus scan passed — files are clean
              </div>
            </div>
            {submittedInfo && (
              <Card className="glass-card border-none text-left">
                <CardContent className="p-5 space-y-3">
                  {submittedInfo.project && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground font-medium">Project</span><span className="font-semibold">{submittedInfo.project}</span></div>
                  )}
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground font-medium">Name</span><span className="font-semibold">{submittedInfo.name}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground font-medium">Student ID</span><span className="font-semibold">{submittedInfo.id}</span></div>
                  {submittedInfo.groupLeader && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground font-medium">Group Leader</span><span className="font-semibold">{submittedInfo.groupLeader}</span></div>
                  )}
                  {submittedInfo.topic && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground font-medium">Topic</span><span className="font-semibold">{submittedInfo.topic}</span></div>
                  )}
                  {submittedInfo.files?.length > 0 && (
                    <div className="text-sm">
                      <span className="text-muted-foreground font-medium block mb-1">Files</span>
                      {submittedInfo.files.map((n: string, i: number) => <p key={i} className="font-semibold truncate">{n}</p>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <Button className="w-full h-12 text-base font-semibold gap-2" onClick={resetForm} data-testid="button-reset">
              <RotateCcw className="w-5 h-5" /> Submit Another
            </Button>
          </motion.div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navigation />
      <FileDeadlineTimer deadline={config.deadline} onExpired={() => setDeadlinePassed(true)} />
      <main className="flex-1 container max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-6 space-y-2">
          <motion.h1 initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600">
            {config.pageTitle || "File Submission"}
          </motion.h1>
          {config.subjectHeading && <p className="text-xl font-semibold text-foreground">{config.subjectHeading}</p>}
          {config.projectTitle && <p className="text-muted-foreground italic">{config.projectTitle}</p>}
        </div>

        {/* Active Project banner */}
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
          className="mb-6 p-4 rounded-xl bg-gradient-to-r from-primary/10 via-purple-500/10 to-pink-500/10 border border-primary/20 flex items-center gap-3"
          data-testid="banner-active-project">
          <FolderOpen className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase text-muted-foreground tracking-wider">Submitting to project</p>
            <p className="font-semibold truncate">{config.activeProject.name}</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="glass-card border-none shadow-2xl">
            <CardHeader className="bg-primary/5 border-b border-primary/10">
              <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5 text-primary" /> Upload Your Files</CardTitle>
              <CardDescription>Accepted: {config?.typeLabels?.join(", ") || "PDF, PPT, PPTX"} — up to {maxSizeMb} MB each — Max 2 files per submission</CardDescription>
            </CardHeader>
            <CardContent className="p-6 md:p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg text-sm font-medium" data-testid="text-error">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="studentName">Student Name</Label>
                  <Input id="studentName" placeholder="Enter your full name" value={studentName} onChange={e => setStudentName(e.target.value)} data-testid="input-student-name" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="studentId">Student ID</Label>
                  <Input id="studentId" placeholder="e.g. BUS-24F-123" value={studentId} onChange={e => setStudentId(e.target.value.toUpperCase())} className="uppercase" autoCapitalize="characters" data-testid="input-student-id" />
                </div>

                {config.requireLeader && (
                  <div className="space-y-2">
                    <Label htmlFor="groupLeader">Group Leader <span className="text-destructive">*</span></Label>
                    <Input id="groupLeader" placeholder="Group leader's full name" value={groupLeader} onChange={e => setGroupLeader(e.target.value)} data-testid="input-group-leader" />
                  </div>
                )}

                {config.requireTopic && (
                  <div className="space-y-2">
                    <Label htmlFor="topic">Project Topic <span className="text-destructive">*</span></Label>
                    <Input id="topic" placeholder="e.g. AI in Healthcare" value={topic} onChange={e => setTopic(e.target.value)} data-testid="input-topic" />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Project Files (up to 2)</Label>
                  <div className="space-y-3">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`file-item-${i}`}>
                        <FileText className="w-8 h-8 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{f.name}</p>
                          <p className="text-xs text-muted-foreground">{formatSize(f.size)}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive shrink-0"
                          onClick={() => removeFile(i)} data-testid={`button-remove-file-${i}`}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}

                    {/* Convertible files — instead of bouncing the student
                        with an error, offer one-click conversion to PDF. */}
                    {convertibleQueue.map((f, i) => {
                      const targets = targetsFor(f);
                      const acceptedLabels = config?.typeLabels?.join(", ") || "PDF, PPT, PPTX";
                      return (
                      <div
                        key={`conv-${i}`}
                        className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2"
                        data-testid={`convert-item-${i}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                            <Wand2 className="w-5 h-5 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate text-sm">{f.name}</p>
                            <p className="text-xs text-amber-800">
                              <b>"{friendlyKind(f)}" is not an accepted format.</b>{" "}
                              {targets.length === 0
                                ? `Accepted formats: ${acceptedLabels}.`
                                : targets.length === 1
                                  ? `Convert it to ${targets[0].label} (an accepted format) and we'll add it to your submission.`
                                  : `Pick one of the accepted formats below — we'll convert it for you and add it to your submission.`}
                            </p>
                            {f.name.toLowerCase().endsWith(".docx") && (
                              <p className="text-[11px] text-amber-700 mt-1 italic">
                                Note: when converting, only the text is preserved — images and complex formatting are dropped.
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-amber-700 hover:text-amber-900 shrink-0"
                            onClick={() => removeConvertible(i)}
                            disabled={convertingIdx === i}
                            data-testid={`button-remove-convert-${i}`}
                            aria-label="Remove"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {targets.length === 0 ? (
                          <p className="text-xs text-amber-800 italic px-1">
                            Your instructor hasn't enabled any of the formats this file can be converted to. Please convert it yourself or upload one of the accepted formats: {acceptedLabels}.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {targets.map(t => {
                              const isActive = activeConvert?.idx === i && activeConvert?.target === t.target;
                              return (
                                <Button
                                  key={t.target}
                                  type="button"
                                  className="flex-1 min-w-[120px] bg-amber-600 hover:bg-amber-700 text-white"
                                  size="sm"
                                  onClick={() => convertOne(i, t)}
                                  disabled={!!activeConvert || files.length >= 2}
                                  data-testid={`button-convert-${i}-${t.target}`}
                                >
                                  {isActive ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Converting…</>
                                  ) : (
                                    <><Wand2 className="mr-2 h-4 w-4" /> Convert to {t.label}</>
                                  )}
                                </Button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      );
                    })}

                    {files.length + convertibleQueue.length < 2 && (
                      <div
                        className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all group"
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="dropzone-files"
                      >
                        <Plus className="w-8 h-8 text-muted-foreground mx-auto mb-2 group-hover:text-primary transition-colors" />
                        <p className="font-medium text-foreground text-sm">{files.length === 0 ? "Click to add files" : "Add another file"}</p>
                        <p className="text-xs text-muted-foreground mt-1">{config?.typeLabels?.join(", ") || "PDF, PPT, PPTX"} — up to {maxSizeMb} MB</p>
                      </div>
                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      // Allow convertible formats in the picker too. The form
                      // only ADVERTISES the allowed formats (PDF, PPT, PPTX) in
                      // the visible help text — but if a student picks a DOCX,
                      // JPG, PNG, TXT, MD or CSV, the form catches it and
                      // offers a one-click convert-to-PDF instead of rejecting.
                      accept={`${config?.acceptExtensions || ".pdf,.ppt,.pptx"},.docx,.jpg,.jpeg,.png,.txt,.md,.csv`}
                      onChange={(e) => addFiles(e.target.files)}
                    />
                  </div>
                  {fileError && (
                    <p className="text-sm text-destructive flex items-center gap-1" data-testid="text-file-error">
                      <AlertCircle className="w-3 h-3" /> {fileError}
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1 h-12" onClick={resetForm} data-testid="button-reset-form">
                    <RotateCcw className="mr-2 h-4 w-4" /> Reset
                  </Button>
                  <Button type="submit" className="h-12 text-base font-semibold shadow-lg shadow-primary/25 flex-[2]" disabled={submitting} data-testid="button-submit">
                    {submitting ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning & uploading...</>
                    ) : (
                      <><Upload className="mr-2 h-4 w-4" /> Submit the File</>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
