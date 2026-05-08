import * as React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, LogOut, GraduationCap, FileUp, UserCircle, LogIn } from "lucide-react";

type StudentProfile = { token: string; name: string; studentId: string; email: string } | null;

function getStoredStudent(): StudentProfile {
  try { return JSON.parse(localStorage.getItem("student_session") || "null"); } catch { return null; }
}

export function Navigation() {
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [projectName, setProjectName] = React.useState("");
  const [fileSubmitEnabled, setFileSubmitEnabled] = React.useState(false);
  const [studentLoginEnabled, setStudentLoginEnabled] = React.useState(false);
  const [student, setStudent] = React.useState<StudentProfile>(null);

  React.useEffect(() => {
    fetch("/api/settings/project_name")
      .then(res => res.json())
      .then(data => { if (data.value) setProjectName(data.value); });

    fetch("/api/settings/file_submission_enabled")
      .then(res => res.json())
      .then(data => setFileSubmitEnabled(data.value === "true"))
      .catch(() => setFileSubmitEnabled(false));

    fetch("/api/settings/student_login_enabled")
      .then(res => res.json())
      .then(data => {
        const enabled = data.value === "true";
        setStudentLoginEnabled(enabled);
        if (enabled) {
          const session = getStoredStudent();
          if (session?.token) {
            fetch("/api/student/me", { headers: { Authorization: `Bearer ${session.token}` } })
              .then(r => r.ok ? setStudent(session) : (localStorage.removeItem("student_session"), setStudent(null)))
              .catch(() => setStudent(null));
          }
        }
      })
      .catch(() => setStudentLoginEnabled(false));
  }, []);

  const handleStudentLogout = async () => {
    const session = getStoredStudent();
    if (session?.token) {
      await fetch("/api/student/logout", { method: "POST", headers: { Authorization: `Bearer ${session.token}` } });
      localStorage.removeItem("student_session");
    }
    setStudent(null);
    navigate("/");
  };

  const isAdminRoute = location.startsWith("/admin");
  const firstName = student?.name?.split(" ")[0] ?? "";

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center px-4 md:px-6">
        <Link href="/" className="mr-6 flex items-center space-x-2 transition-transform hover:scale-105">
          <GraduationCap className="h-6 w-6 text-primary" />
          <span className="hidden font-bold sm:inline-block text-lg bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600">
            {projectName || "StudentGroups"}
          </span>
        </Link>

        <div className="flex flex-1 items-center justify-end space-x-2">
          {/* File Submission link */}
          {fileSubmitEnabled && !isAdminRoute && (
            <Link href="/file-submit">
              <Button
                variant={location === "/file-submit" ? "default" : "ghost"}
                size="sm"
                className="gap-2"
              >
                <FileUp className="h-4 w-4" />
                <span className="hidden sm:inline">File Submission</span>
              </Button>
            </Link>
          )}

          {/* Student Portal link */}
          {studentLoginEnabled && !isAdminRoute && (
            student ? (
              <Link href="/student-portal">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-primary/30 text-primary hover:bg-primary/5"
                  data-testid="button-my-portal"
                >
                  <UserCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">My Portal</span>
                  <span className="sm:hidden">Portal</span>
                </Button>
              </Link>
            ) : (
              <Link href="/student-portal">
                <Button
                  variant={location === "/student-portal" ? "default" : "outline"}
                  size="sm"
                  className="gap-2 border-primary/30 text-primary hover:bg-primary/5"
                  data-testid="button-student-portal"
                >
                  <LogIn className="h-4 w-4" />
                  <span className="hidden sm:inline">Student Portal</span>
                  <span className="sm:hidden">Portal</span>
                </Button>
              </Link>
            )
          )}

          {/* Admin link for authenticated users */}
          {user && (
            <>
              <Link href="/admin">
                <Button
                  variant={location === "/admin" ? "default" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => logout()}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
