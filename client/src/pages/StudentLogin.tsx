import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, GraduationCap, LogIn, UserPlus, Eye, EyeOff, ArrowLeft, User, CheckCircle, Mail } from "lucide-react";

// ======== Schemas ========
const loginSchema = z.object({
  studentId: z.string().min(1, "Student ID is required"),
  password: z.string().min(1, "Password is required"),
});
const SEMESTER_OPTIONS = ["1","2","3","4","5","6","7","8"];

const registerSchema = z.object({
  name: z.string().min(2, "Full name is required"),
  studentId: z.string().min(1, "Student ID is required"),
  email: z.string().email("Enter a valid email address"),
  semester: z.string().min(1, "Please select your semester"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

// ======== Helpers ========
function getStoredStudent(): { token: string; name: string; studentId: string; email: string; semester?: string | null } | null {
  try { return JSON.parse(localStorage.getItem("student_session") || "null"); } catch { return null; }
}
function storeStudent(token: string, account: { name: string; studentId: string; email: string; semester?: string | null }) {
  localStorage.setItem("student_session", JSON.stringify({ token, ...account }));
}

// ======== Welcome Screen ========
function WelcomeScreen({ name, onContinue }: { name: string; onContinue: () => void }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  React.useEffect(() => {
    const timer = setTimeout(onContinue, 3200);
    return () => clearTimeout(timer);
  }, [onContinue]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700">
      {/* Animated background blobs */}
      <motion.div
        className="absolute w-96 h-96 rounded-full bg-white/5 blur-3xl"
        animate={{ scale: [1, 1.2, 1], x: [0, 60, 0], y: [0, -40, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        style={{ top: "10%", left: "5%" }}
      />
      <motion.div
        className="absolute w-80 h-80 rounded-full bg-white/5 blur-3xl"
        animate={{ scale: [1, 1.15, 1], x: [0, -40, 0], y: [0, 60, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        style={{ bottom: "10%", right: "5%" }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 text-center px-8"
      >
        {/* Avatar circle */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
          className="mx-auto mb-8 w-28 h-28 rounded-full bg-white/20 backdrop-blur-sm border-4 border-white/40 flex items-center justify-center shadow-2xl"
        >
          <span className="text-4xl font-bold text-white">{initials}</span>
        </motion.div>

        {/* Greeting */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="text-white/70 text-lg mb-2 font-light tracking-wider uppercase"
        >
          Welcome back
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.5 }}
          className="text-4xl sm:text-5xl font-bold text-white mb-3 leading-tight"
        >
          {name.split(" ")[0]}
        </motion.h1>

        {name.split(" ").length > 1 && (
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.5 }}
            className="text-2xl sm:text-3xl font-semibold text-white/80 mb-8"
          >
            {name.split(" ").slice(1).join(" ")}
          </motion.h2>
        )}

        {/* Checkmark */}
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, type: "spring", stiffness: 200 }}
          className="flex justify-center mb-10"
        >
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-white" />
          </div>
        </motion.div>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0, duration: 0.5 }}
          className="text-white/60 text-sm mb-8"
        >
          Redirecting you to the dashboard…
        </motion.p>

        {/* Continue button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.4 }}
        >
          <Button
            onClick={onContinue}
            className="bg-white/20 hover:bg-white/30 text-white border border-white/30 backdrop-blur-sm px-8 py-3 rounded-full text-base font-medium transition-all"
            data-testid="button-welcome-continue"
          >
            Continue →
          </Button>
        </motion.div>

        {/* Progress bar */}
        <motion.div
          className="mt-8 h-0.5 bg-white/20 rounded-full overflow-hidden mx-auto max-w-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <motion.div
            className="h-full bg-white/60 rounded-full"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ delay: 1.2, duration: 2, ease: "linear" }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

// ======== Password Field ========
const PasswordField = React.forwardRef<HTMLInputElement, {
  label: string;
  placeholder?: string;
  error?: string;
  [key: string]: any;
}>(function PasswordField({ label, placeholder, error, ...props }, ref) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground/80">{label}</Label>
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          className="pr-10"
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShow(v => !v)}
          tabIndex={-1}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
});

// ======== Check-Email Screen ========
function CheckEmailScreen({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50 p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center"
      >
        <div className="mx-auto mb-6 w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
          <Mail className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Check your email!</h1>
        <p className="text-muted-foreground mb-1">A verification link has been sent to:</p>
        <p className="font-semibold text-primary text-sm mb-6 bg-primary/5 px-4 py-2 rounded-lg border border-primary/20 inline-block">{email}</p>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-border/50 p-5 mb-6 text-left space-y-2 shadow-sm">
          <p className="text-sm text-foreground font-medium">Next steps:</p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Open your email inbox</li>
            <li>Find the email from Student Group Portal</li>
            <li>Click the <strong>"Verify My Account"</strong> button</li>
            <li>You'll be logged in automatically</li>
          </ol>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Didn't receive it? Check your spam folder, or{" "}
          <button type="button" className="text-primary font-medium hover:underline" onClick={onBack}>
            register again
          </button>{" "}
          to resend.
        </p>
        <Button variant="ghost" onClick={() => window.location.href = "/"} className="gap-2 text-muted-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Button>
      </motion.div>
    </div>
  );
}

// ======== Main Page ========
export default function StudentLogin() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<"login" | "register">("login");
  const [loading, setLoading] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(false);
  const [welcomeName, setWelcomeName] = React.useState("");
  const [checkEmail, setCheckEmail] = React.useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = React.useState<boolean | null>(null);

  // Open register tab if ?tab=register
  React.useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("tab") === "register") setTab("register");
  }, [search]);

  // Check if feature is enabled
  React.useEffect(() => {
    fetch("/api/settings/student_login_enabled")
      .then(r => r.json())
      .then(d => setFeatureEnabled(d.value === "true"))
      .catch(() => setFeatureEnabled(false));
  }, []);

  // If already logged in, redirect home
  React.useEffect(() => {
    const session = getStoredStudent();
    if (session?.token) {
      fetch("/api/student/me", { headers: { Authorization: `Bearer ${session.token}` } })
        .then(r => r.ok ? navigate("/student-portal") : localStorage.removeItem("student_session"))
        .catch(() => {});
    }
  }, [navigate]);

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { studentId: "", password: "" },
  });
  const registerForm = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", studentId: "", email: "", password: "", confirmPassword: "" },
  });

  const handleLogin = async (data: LoginForm) => {
    setLoading(true);
    try {
      const res = await fetch("/api/student/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "UNVERIFIED") {
          toast({
            title: "Email not verified",
            description: "Please check your inbox and click the verification link to activate your account.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Login failed", description: json.message || "Login failed", variant: "destructive" });
        }
        return;
      }
      storeStudent(json.token, json.account);
      setWelcomeName(json.account.name);
      setShowWelcome(true);
    } catch (e: any) {
      toast({ title: "Login failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (data: RegisterForm) => {
    setLoading(true);
    try {
      const { confirmPassword: _, ...payload } = data;
      const res = await fetch("/api/student/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Registration failed");
      // Show the "check your email" screen
      setCheckEmail(json.email || data.email);
    } catch (e: any) {
      toast({ title: "Registration failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Show check-email screen after registration
  if (checkEmail) {
    return <CheckEmailScreen email={checkEmail} onBack={() => { setCheckEmail(null); setTab("register"); }} />;
  }

  // Feature disabled
  if (featureEnabled === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50 p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <GraduationCap className="w-12 h-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-semibold">Student accounts are currently disabled</h2>
            <p className="text-muted-foreground text-sm">This feature is not enabled by the administrator.</p>
            <Button variant="outline" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (featureEnabled === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showWelcome) {
    return <WelcomeScreen name={welcomeName} onContinue={() => navigate("/student-portal")} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50 p-4">
      {/* Back button */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="self-start mb-4 ml-2"
      >
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 text-muted-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Student Portal</h1>
          <p className="text-muted-foreground mt-1 text-sm">Sign in or create your account</p>
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl bg-white/70 backdrop-blur-sm border border-border/50 p-1 mb-6 shadow-sm">
          <button
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${tab === "login" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("login")}
            data-testid="tab-login"
          >
            <LogIn className="w-4 h-4" /> Sign In
          </button>
          <button
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${tab === "register" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("register")}
            data-testid="tab-register"
          >
            <UserPlus className="w-4 h-4" /> Register
          </button>
        </div>

        <AnimatePresence mode="wait">
          {tab === "login" ? (
            <motion.div
              key="login"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
            >
              <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-sm">
                <CardContent className="pt-6 pb-8 space-y-5">
                  <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="login-id" className="text-sm font-medium text-foreground/80">Student ID</Label>
                      <Input
                        id="login-id"
                        placeholder="e.g. BUS-24F-123"
                        data-testid="input-login-student-id"
                        className="uppercase"
                        autoCapitalize="characters"
                        {...loginForm.register("studentId", { setValueAs: (v: any) => String(v ?? "").toUpperCase().trim() })}
                      />
                      {loginForm.formState.errors.studentId && (
                        <p className="text-xs text-destructive">{loginForm.formState.errors.studentId.message}</p>
                      )}
                    </div>
                    <PasswordField
                      label="Password"
                      placeholder="Enter your password"
                      data-testid="input-login-password"
                      {...loginForm.register("password")}
                      error={loginForm.formState.errors.password?.message}
                    />
                    <Button
                      type="submit"
                      className="w-full h-11 gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-md"
                      disabled={loading}
                      data-testid="button-login-submit"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                      Sign In
                    </Button>
                  </form>
                  <p className="text-center text-sm text-muted-foreground">
                    Don't have an account?{" "}
                    <button
                      type="button"
                      className="text-primary font-medium hover:underline"
                      onClick={() => setTab("register")}
                    >
                      Register here
                    </button>
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="register"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
            >
              <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-sm">
                <CardContent className="pt-6 pb-8 space-y-5">
                  <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-name" className="text-sm font-medium text-foreground/80">Full Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="reg-name"
                          placeholder="Your full name"
                          className="pl-9"
                          data-testid="input-register-name"
                          {...registerForm.register("name")}
                        />
                      </div>
                      {registerForm.formState.errors.name && (
                        <p className="text-xs text-destructive">{registerForm.formState.errors.name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-id" className="text-sm font-medium text-foreground/80">Student ID</Label>
                      <Input
                        id="reg-id"
                        placeholder="e.g. BUS-24F-123"
                        data-testid="input-register-student-id"
                        className="uppercase"
                        autoCapitalize="characters"
                        {...registerForm.register("studentId", { setValueAs: (v: any) => String(v ?? "").toUpperCase().trim() })}
                      />
                      {registerForm.formState.errors.studentId && (
                        <p className="text-xs text-destructive">{registerForm.formState.errors.studentId.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-email" className="text-sm font-medium text-foreground/80">Email Address</Label>
                      <Input
                        id="reg-email"
                        type="email"
                        placeholder="your@email.com"
                        data-testid="input-register-email"
                        {...registerForm.register("email")}
                      />
                      {registerForm.formState.errors.email && (
                        <p className="text-xs text-destructive">{registerForm.formState.errors.email.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-semester" className="text-sm font-medium text-foreground/80">Semester</Label>
                      <select
                        id="reg-semester"
                        data-testid="select-register-semester"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...registerForm.register("semester")}
                      >
                        <option value="">Select your semester</option>
                        {SEMESTER_OPTIONS.map(s => (
                          <option key={s} value={s}>Semester {s}</option>
                        ))}
                      </select>
                      {registerForm.formState.errors.semester && (
                        <p className="text-xs text-destructive">{registerForm.formState.errors.semester.message}</p>
                      )}
                    </div>
                    <PasswordField
                      label="Password"
                      placeholder="At least 6 characters"
                      data-testid="input-register-password"
                      {...registerForm.register("password")}
                      error={registerForm.formState.errors.password?.message}
                    />
                    <PasswordField
                      label="Confirm Password"
                      placeholder="Repeat your password"
                      data-testid="input-register-confirm"
                      {...registerForm.register("confirmPassword")}
                      error={registerForm.formState.errors.confirmPassword?.message}
                    />
                    <Button
                      type="submit"
                      className="w-full h-11 gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-md"
                      disabled={loading}
                      data-testid="button-register-submit"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      Create Account
                    </Button>
                  </form>
                  <p className="text-center text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="text-primary font-medium hover:underline"
                      onClick={() => setTab("login")}
                    >
                      Sign in
                    </button>
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
