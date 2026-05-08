import * as React from "react";
import { motion } from "framer-motion";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, Mail, ArrowLeft } from "lucide-react";

function storeStudent(token: string, account: { name: string; studentId: string; email: string }) {
  localStorage.setItem("student_session", JSON.stringify({ token, ...account }));
}

function WelcomeScreen({ name, onContinue }: { name: string; onContinue: () => void }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  React.useEffect(() => {
    const t = setTimeout(onContinue, 3000);
    return () => clearTimeout(t);
  }, [onContinue]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700">
      <motion.div className="absolute w-96 h-96 rounded-full bg-white/5 blur-3xl"
        animate={{ scale: [1, 1.2, 1], x: [0, 60, 0] }} transition={{ duration: 8, repeat: Infinity }} style={{ top: "10%", left: "5%" }} />
      <motion.div className="absolute w-80 h-80 rounded-full bg-white/5 blur-3xl"
        animate={{ scale: [1, 1.15, 1], x: [0, -40, 0] }} transition={{ duration: 10, repeat: Infinity }} style={{ bottom: "10%", right: "5%" }} />

      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }}
        className="relative z-10 text-center px-8"
      >
        <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className="mx-auto mb-6 w-28 h-28 rounded-full bg-white/20 backdrop-blur-sm border-4 border-white/40 flex items-center justify-center shadow-2xl"
        >
          <span className="text-4xl font-bold text-white">{initials}</span>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="flex justify-center mb-4"
        >
          <div className="w-10 h-10 rounded-full bg-green-400/30 flex items-center justify-center ring-2 ring-green-300/50">
            <CheckCircle className="w-5 h-5 text-green-200" />
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="text-white/70 text-base mb-2 tracking-wider uppercase font-light"
        >Email verified! Welcome back</motion.p>

        <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
          className="text-4xl sm:text-5xl font-bold text-white mb-8 leading-tight"
        >
          {name.split(" ")[0]}
          {name.split(" ").length > 1 && (
            <span className="block text-2xl sm:text-3xl text-white/80 font-semibold mt-1">
              {name.split(" ").slice(1).join(" ")}
            </span>
          )}
        </motion.h1>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
          className="text-white/60 text-sm mb-6"
        >Your account is now active. Redirecting…</motion.p>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0 }}>
          <Button onClick={onContinue}
            className="bg-white/20 hover:bg-white/30 text-white border border-white/30 backdrop-blur-sm px-8 py-3 rounded-full"
          >Continue →</Button>
        </motion.div>

        <motion.div className="mt-6 h-0.5 bg-white/20 rounded-full overflow-hidden mx-auto max-w-xs"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
        >
          <motion.div className="h-full bg-white/60 rounded-full" initial={{ width: "0%" }}
            animate={{ width: "100%" }} transition={{ delay: 1.1, duration: 2, ease: "linear" }} />
        </motion.div>
      </motion.div>
    </div>
  );
}

export default function StudentVerify() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [status, setStatus] = React.useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [accountName, setAccountName] = React.useState("");
  const [showWelcome, setShowWelcome] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token") || "";

    if (!token) {
      setErrorMessage("No verification token found in the URL.");
      setStatus("error");
      return;
    }

    fetch(`/api/student/verify?token=${encodeURIComponent(token)}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || "Verification failed");
        storeStudent(data.token, data.account);
        setAccountName(data.account.name);
        setShowWelcome(true);
        setStatus("success");
      })
      .catch(e => {
        setErrorMessage(e.message || "Something went wrong");
        setStatus("error");
      });
  }, [search]);

  if (showWelcome) {
    return <WelcomeScreen name={accountName} onContinue={() => navigate("/student-portal")} />;
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50 gap-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4 text-center px-6"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-lg font-semibold text-foreground">Verifying your email…</p>
          <p className="text-muted-foreground text-sm">Please wait a moment</p>
        </motion.div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50 p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center space-y-4"
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Verification failed</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">{errorMessage}</p>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={() => navigate("/student-login?tab=register")}
              className="w-full gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              Register again
            </Button>
            <Button variant="ghost" onClick={() => navigate("/")} className="gap-2 text-muted-foreground">
              <ArrowLeft className="w-4 h-4" /> Back to Home
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return null;
}
