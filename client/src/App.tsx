import * as React from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";

import Home from "@/pages/Home";
import NotFound from "@/pages/not-found";

const Admin = React.lazy(() => import("@/pages/Admin"));
const FileSubmit = React.lazy(() => import("@/pages/FileSubmit"));
const StudentLogin = React.lazy(() => import("@/pages/StudentLogin"));
const StudentVerify = React.lazy(() => import("@/pages/StudentVerify"));
const StudentPortal = React.lazy(() => import("@/pages/StudentPortal"));

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-violet-50">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/admin">
        <React.Suspense fallback={<PageFallback />}>
          <Admin />
        </React.Suspense>
      </Route>
      <Route path="/file-submit">
        <React.Suspense fallback={<PageFallback />}>
          <FileSubmit />
        </React.Suspense>
      </Route>
      <Route path="/student-login">
        <React.Suspense fallback={<PageFallback />}>
          <StudentLogin />
        </React.Suspense>
      </Route>
      <Route path="/student-verify">
        <React.Suspense fallback={<PageFallback />}>
          <StudentVerify />
        </React.Suspense>
      </Route>
      <Route path="/student-portal">
        <React.Suspense fallback={<PageFallback />}>
          <StudentPortal />
        </React.Suspense>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
